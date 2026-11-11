/**
 * Frontend API Service for communicating with the Node.js Express backend.
 * Implements request cancellation, status code handling, and rate limit tracking.
 */

let activeController = null;
let activePromise = null;
let currentPendingUsername = null;
let rateLimitedUntil = 0;

const SESSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_SESSION_CACHE_ENTRIES = 50;
const MAX_TAB_PAGE_CACHE_ENTRIES = 200;
const sessionCache = new Map();
const tabPageCache = new Map();
const explorerInFlight = new Map();

export class ApiError extends Error {
  constructor(message, status, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.error = details.error || 'RequestFailed';
    this.rateLimitReset = details.rateLimitReset;
    this.retryAfter = details.retryAfter;
  }
}

function setRateLimitCooldown(status, data, headers) {
  if (status === 403 || status === 429) {
    const retryAfterSec = Number(data?.retryAfter) || Number(headers?.get?.('retry-after')) || 60;
    rateLimitedUntil = Date.now() + Math.min(Math.max(retryAfterSec, 15), 3600) * 1000;
  }
}

function createRateLimitGuardError() {
  const remainingSeconds = Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
  return new ApiError(
    `GitHub API rate limit reached. Please wait ~${remainingSeconds}s before trying again.`,
    429,
    { error: 'RateLimitExceeded', retryAfter: remainingSeconds }
  );
}

function normalizeFetchError(err, abortMessage = 'Search was superseded by a newer query.') {
  if (err?.name === 'AbortError') {
    const abortError = new Error(abortMessage);
    abortError.name = 'AbortError';
    return abortError;
  }
  if (err instanceof ApiError) {
    return err;
  }
  return new ApiError(
    'Unable to reach the server. Please check your network connection and try again.',
    0,
    { error: 'NetworkError' }
  );
}

function setBoundedCacheEntry(cacheMap, key, value, maxSize) {
  if (cacheMap.has(key)) {
    cacheMap.delete(key);
  } else if (cacheMap.size >= maxSize) {
    const oldestKey = cacheMap.keys().next().value;
    if (oldestKey !== undefined) {
      cacheMap.delete(oldestKey);
    }
  }
  cacheMap.set(key, value);
}

function getTabCacheKey(username, kind, page = 1) {
  const normalized = String(username || '').trim().toLowerCase();
  const safeKind = kind === 'starred' ? 'starred' : 'repos';
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  return `${safeKind}:${normalized}:100:${safePage}`;
}

function seedReposFirstPageCache(username, data) {
  if (!username || !data || !Array.isArray(data.repositories)) return;
  const cacheKey = getTabCacheKey(username, 'repos', 1);
  setBoundedCacheEntry(tabPageCache, cacheKey, {
    repositories: data.repositories,
    page: 1,
    per_page: 100,
    pagination: data.repositories_pagination || {
      hasNext: data.repositories.length === 100,
      hasPrev: false,
      nextPage: data.repositories.length === 100 ? 2 : null,
      prevPage: null,
      lastPage: null
    },
    cachedAt: Date.now()
  }, MAX_TAB_PAGE_CACHE_ENTRIES);
}

/**
 * Cancels in-flight paginated explorer requests (all, or excluding a specific username).
 * @param {string | null} [exceptUsername]
 */
export function abortExplorerRequests(exceptUsername = null) {
  const normalizedExcept = exceptUsername ? exceptUsername.trim().toLowerCase() : null;
  for (const [key, entry] of explorerInFlight.entries()) {
    if (!normalizedExcept || entry.username !== normalizedExcept) {
      entry.controller.abort();
      explorerInFlight.delete(key);
    }
  }
}

/**
 * Clears the in-memory session cache (or a single username entry).
 * @param {string} [username]
 */
export function clearSessionCache(username) {
  if (username) {
    const normalized = username.trim().toLowerCase();
    sessionCache.delete(normalized);
    for (const key of Array.from(tabPageCache.keys())) {
      if (key.includes(`:${normalized}:`)) {
        tabPageCache.delete(key);
      }
    }
    for (const [key, entry] of explorerInFlight.entries()) {
      if (entry.username === normalized) {
        entry.controller.abort();
        explorerInFlight.delete(key);
      }
    }
    return;
  }
  sessionCache.clear();
  tabPageCache.clear();
  abortExplorerRequests();
  rateLimitedUntil = 0;
}

/**
 * Updates cached profile metadata when an actual starred repository count resolves.
 * @param {string} username
 * @param {number} count
 */
export function syncProfileStarredCount(username, count) {
  const normalized = username?.trim().toLowerCase();
  if (!normalized || typeof count !== 'number' || !Number.isFinite(count)) return;
  const cached = sessionCache.get(normalized);
  if (!cached?.data?.user) return;

  const formatted = count >= 1000000
    ? (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
    : count >= 1000
      ? (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
      : String(count);

  const updatedUser = {
    ...cached.data.user,
    starred_count: count,
    stats: {
      ...(cached.data.user.stats || {}),
      starred_count: count,
      starred_count_formatted: formatted
    }
  };

  sessionCache.set(normalized, {
    ...cached,
    data: { ...cached.data, user: updatedUser }
  });
}

/**
 * Fetches live current-year contributions without stale caching so totals stay up to date.
 */
async function fetchLiveContributions(normalizedUsername, signal) {
  try {
    const res = await fetch(`/api/contributions/${encodeURIComponent(normalizedUsername)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal
    });
    if (!res.ok) {
      setRateLimitCooldown(res.status, null, res.headers);
      return null;
    }
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const contrib = isJson ? await res.json() : null;
    return contrib && contrib.live ? contrib : null;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return null;
  }
}

/**
 * Fetches user profile, repositories, statistics, and language distributions.
 * Caches profile/languages for 6 hours while keeping current-year contributions fresh,
 * deduplicates in-flight calls, cancels outdated requests when username changes,
 * and never repeatedly retries rate-limited (403/429) responses.
 *
 * @param {string} username
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<Object>}
 */
export async function fetchProfile(username, { forceRefresh = false } = {}) {
  const normalized = username.trim().toLowerCase();

  // Never repeatedly hammer a rate-limited API while cooldown is active
  if (Date.now() < rateLimitedUntil && !sessionCache.has(normalized)) {
    throw createRateLimitGuardError();
  }

  // Avoid duplicate network requests if the exact same username is already in-flight
  if (activePromise && currentPendingUsername === normalized && !forceRefresh) {
    return activePromise;
  }

  // Cancel any outdated in-flight requests when username changes or force refreshing
  if (activeController) {
    activeController.abort();
  }
  abortExplorerRequests(forceRefresh ? null : normalized);

  const controller = new AbortController();
  activeController = controller;
  currentPendingUsername = normalized;

  if (!forceRefresh && sessionCache.has(normalized)) {
    const cached = sessionCache.get(normalized);
    if (Date.now() - cached.cachedAt < SESSION_CACHE_TTL_MS) {
      // Refresh LRU position
      sessionCache.delete(normalized);
      sessionCache.set(normalized, cached);

      const cachedPromise = (async () => {
        try {
          const liveContributions = Date.now() >= rateLimitedUntil
            ? await fetchLiveContributions(normalized, controller.signal)
            : null;
          const updatedData = liveContributions
            ? { ...cached.data, contributions: liveContributions }
            : cached.data;
          sessionCache.set(normalized, { ...cached, data: updatedData });
          seedReposFirstPageCache(normalized, updatedData);
          return {
            data: updatedData,
            isCached: true,
            rateLimitRemaining: cached.rateLimitRemaining,
            rateLimitReset: cached.rateLimitReset
          };
        } catch (err) {
          if (err.name === 'AbortError') {
            const abortError = new Error('Search was superseded by a newer query.');
            abortError.name = 'AbortError';
            throw abortError;
          }
          seedReposFirstPageCache(normalized, cached.data);
          return {
            data: cached.data,
            isCached: true,
            rateLimitRemaining: cached.rateLimitRemaining,
            rateLimitReset: cached.rateLimitReset
          };
        } finally {
          if (activeController === controller) {
            activeController = null;
            activePromise = null;
            currentPendingUsername = null;
          }
        }
      })();

      activePromise = cachedPromise;
      return cachedPromise;
    }
    sessionCache.delete(normalized);
  }

  const requestPromise = (async () => {
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(normalized)}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        },
        cache: 'no-store',
        signal: controller.signal
      });

      const isJson = res.headers.get('content-type')?.includes('application/json');
      const data = isJson ? await res.json() : null;

      if (!res.ok) {
        setRateLimitCooldown(res.status, data, res.headers);
        const errorMessage = data?.message || `Request failed with HTTP status ${res.status}`;
        throw new ApiError(errorMessage, res.status, data || {});
      }

      if (!data || typeof data !== 'object' || !data.user) {
        throw new ApiError('Received an unexpected response from the server.', 502, {
          error: 'InvalidResponse'
        });
      }

      const isServerCacheHit = res.headers.get('x-cache') === 'HIT';
      let finalData = data;
      if (isServerCacheHit) {
        const liveContributions = await fetchLiveContributions(normalized, controller.signal);
        if (liveContributions) {
          finalData = { ...data, contributions: liveContributions };
        }
      }

      const rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
      const rateLimitReset = res.headers.get('x-ratelimit-reset');

      setBoundedCacheEntry(sessionCache, normalized, {
        data: finalData,
        rateLimitRemaining,
        rateLimitReset,
        cachedAt: Date.now()
      }, MAX_SESSION_CACHE_ENTRIES);
      seedReposFirstPageCache(normalized, finalData);

      return {
        data: finalData,
        isCached: isServerCacheHit,
        rateLimitRemaining,
        rateLimitReset
      };
    } catch (err) {
      throw normalizeFetchError(err, 'Search was superseded by a newer query.');
    } finally {
      if (activeController === controller) {
        activeController = null;
        activePromise = null;
        currentPendingUsername = null;
      }
    }
  })();

  activePromise = requestPromise;
  return requestPromise;
}

/**
 * Fetches a single page (per_page=100) of repositories or starred repositories
 * on demand with per-username caching, in-flight request deduplication,
 * cancellation on user change, and rate-limit cooldown tracking.
 *
 * @param {string} username
 * @param {'repos' | 'starred'} [kind='repos']
 * @param {number} [page=1]
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<{ repositories: Array, page: number, per_page: number, pagination: Object, isCached: boolean }>}
 */
export async function fetchTabRepositoriesPage(username, kind = 'repos', page = 1, { forceRefresh = false } = {}) {
  const normalized = username?.trim().toLowerCase();
  if (!normalized) {
    throw new ApiError('Username is required.', 400, { error: 'InvalidUsername' });
  }

  const safeKind = kind === 'starred' ? 'starred' : 'repos';
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const cacheKey = getTabCacheKey(normalized, safeKind, safePage);

  if (!forceRefresh && tabPageCache.has(cacheKey)) {
    const cached = tabPageCache.get(cacheKey);
    if (Date.now() - cached.cachedAt < SESSION_CACHE_TTL_MS) {
      tabPageCache.delete(cacheKey);
      tabPageCache.set(cacheKey, cached);
      return {
        repositories: cached.repositories,
        page: cached.page,
        per_page: cached.per_page,
        pagination: cached.pagination,
        total_count: cached.total_count ?? null,
        isCached: true
      };
    }
    tabPageCache.delete(cacheKey);
  }

  if (Date.now() < rateLimitedUntil) {
    throw createRateLimitGuardError();
  }

  if (!forceRefresh && explorerInFlight.has(cacheKey)) {
    return explorerInFlight.get(cacheKey).promise;
  }

  const controller = new AbortController();
  const endpoint = safeKind === 'starred'
    ? `/api/starred/${encodeURIComponent(normalized)}?per_page=100&page=${safePage}`
    : `/api/repos/${encodeURIComponent(normalized)}?per_page=100&page=${safePage}&sort=updated`;

  const promise = (async () => {
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });

      const isJson = res.headers.get('content-type')?.includes('application/json');
      const data = isJson ? await res.json() : null;

      if (!res.ok) {
        setRateLimitCooldown(res.status, data, res.headers);
        const errorMessage = data?.message || `Request failed with HTTP status ${res.status}`;
        throw new ApiError(errorMessage, res.status, data || {});
      }

      if (!data || typeof data !== 'object' || !Array.isArray(data.repositories)) {
        throw new ApiError('Received an unexpected repository response from the server.', 502, {
          error: 'InvalidResponse'
        });
      }

      const payload = {
        repositories: Array.isArray(data?.repositories) ? data.repositories : [],
        page: Number(data?.page) || safePage,
        per_page: Number(data?.per_page) || 100,
        pagination: data?.pagination || {
          hasNext: false,
          hasPrev: safePage > 1,
          nextPage: null,
          prevPage: safePage > 1 ? safePage - 1 : null,
          lastPage: null
        },
        total_count: typeof data?.total_count === 'number' ? data.total_count : null,
        isCached: res.headers.get('x-cache') === 'HIT'
      };

      setBoundedCacheEntry(tabPageCache, cacheKey, {
        ...payload,
        cachedAt: Date.now()
      }, MAX_TAB_PAGE_CACHE_ENTRIES);

      return payload;
    } catch (err) {
      throw normalizeFetchError(err, 'Repository request was cancelled because the user changed.');
    } finally {
      const currentEntry = explorerInFlight.get(cacheKey);
      if (currentEntry && currentEntry.controller === controller) {
        explorerInFlight.delete(cacheKey);
      }
    }
  })();

  explorerInFlight.set(cacheKey, { controller, username: normalized, promise });
  return promise;
}

let contribRefreshController = null;

/**
 * Fetches live current-year contributions for a loaded profile and updates sessionCache.
 */
export async function fetchContributions(username) {
  const normalized = username?.trim().toLowerCase();
  if (!normalized || Date.now() < rateLimitedUntil) return null;

  if (contribRefreshController) {
    contribRefreshController.abort();
  }
  const controller = new AbortController();
  contribRefreshController = controller;

  try {
    const liveContributions = await fetchLiveContributions(normalized, controller.signal);
    if (liveContributions && sessionCache.has(normalized)) {
      const cached = sessionCache.get(normalized);
      sessionCache.set(normalized, {
        ...cached,
        data: { ...cached.data, contributions: liveContributions }
      });
    }
    return liveContributions;
  } catch (err) {
    if (err.name === 'AbortError') return null;
    throw err;
  } finally {
    if (contribRefreshController === controller) {
      contribRefreshController = null;
    }
  }
}

/**
 * Fetches health status and cache metrics.
 */
export async function fetchHealth() {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error('Health check failed');
  return await res.json();
}

/**
 * Fetches current rate-limit quota from backend.
 */
export async function fetchRateLimit() {
  const res = await fetch('/api/rate-limit');
  if (!res.ok) throw new Error('Rate limit check failed');
  return await res.json();
}

