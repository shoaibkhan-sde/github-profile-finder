import {
  fetchUserProfile,
  fetchUserRepositories,
  fetchUserStarredRepositories,
  fetchUserStarredCount,
  fetchUserContributions,
  fetchRateLimitStatus
} from '../services/githubService.js';
import { analyzeRepositoryLanguages } from '../services/languagesService.js';
import { profileCache, languagesCache, paginatedRepoCache, starredCountCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

/**
 * Applies a resolved numeric starred count onto an existing profile payload.
 */
function applyStarredCountToProfile(profilePayload, count) {
  if (!profilePayload?.user || typeof count !== 'number' || !Number.isFinite(count)) {
    return profilePayload;
  }
  profilePayload.user.starred_count = count;
  profilePayload.user.stats = {
    ...(profilePayload.user.stats || {}),
    starred_count: count,
    starred_count_formatted: formatNumber(count)
  };
  return profilePayload;
}

/**
 * Formats numbers into compact representation (e.g. 8300 -> '8.3K').
 */
function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return String(num);
}

/**
 * Formats ISO date into relative updated time (e.g. "Updated 6 years ago").
 */
function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return 'Updated recently';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Updated ${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Updated ${months}mo ago`;
  const years = Math.floor(days / 365);
  return `Updated ${years} year${years > 1 ? 's' : ''} ago`;
}

/**
 * Formats joined date into "Joined Mon YYYY".
 */
function formatJoinedDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  return `Joined ${month} ${year}`;
}

/**
 * Normalizes a raw GitHub repository or starred repository object into the frontend contract.
 */
function formatRepositoryItem(repo) {
  const stars = repo.stargazers_count || 0;
  const forks = repo.forks_count || 0;
  return {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    owner: repo.owner
      ? {
          login: repo.owner.login,
          avatar_url: repo.owner.avatar_url,
          html_url: repo.owner.html_url
        }
      : null,
    description: repo.description,
    stars,
    stars_formatted: formatNumber(stars),
    forks,
    forks_formatted: formatNumber(forks),
    language: repo.language,
    updated_at: repo.updated_at,
    updated: formatRelativeTime(repo.updated_at),
    html_url: repo.html_url,
    fork: Boolean(repo.fork)
  };
}

/**
 * Controller for GET /api/profile/:username
 */
export async function getProfile(req, res, next) {
  const username = req.sanitizedUsername;
  const abortController = new AbortController();

  const onClose = () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  };
  res.on('close', onClose);

  try {
    // 1. Check in-memory bounded LRU cache
    res.setHeader('Cache-Control', 'no-store');
    const cachedData = profileCache.get(username);
    if (cachedData) {
      if (typeof cachedData.user?.stats?.starred_count !== 'number') {
        const cachedStarCount = starredCountCache.get(username);
        if (typeof cachedStarCount === 'number') {
          applyStarredCountToProfile(cachedData, cachedStarCount);
          profileCache.set(username, cachedData);
        }
      }
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cachedData);
    }

    logger.info(`Cache miss for user "${username}". Fetching from GitHub API.`);

    const cachedStarredCount = starredCountCache.get(username);

    // 2. Fetch profile, single-page repo list (per_page=100, sort=updated), starred count, and contributions
    const [profileRes, reposRes, starredCount, contributionsRes] = await Promise.all([
      fetchUserProfile(username, { signal: abortController.signal }),
      fetchUserRepositories(username, { signal: abortController.signal }),
      typeof cachedStarredCount === 'number'
        ? Promise.resolve(cachedStarredCount)
        : fetchUserStarredCount(username, { signal: abortController.signal }),
      fetchUserContributions(username, { signal: abortController.signal })
    ]);

    if (typeof starredCount === 'number') {
      starredCountCache.set(username, starredCount);
    }

    const rawUser = profileRes.data;
    const rawRepos = reposRes.data || [];

    // 3. Use 6-hour language cache when available; otherwise compute directly from the 1 repo-list call
    let cachedLanguages = languagesCache.get(username);
    let topLanguages;
    let topLanguagesMeta;

    if (cachedLanguages) {
      topLanguages = cachedLanguages.languages;
      topLanguagesMeta = { ...cachedLanguages.meta, cached: true };
    } else {
      const langAnalysis = analyzeRepositoryLanguages(rawRepos);
      topLanguages = langAnalysis.languages;
      topLanguagesMeta = langAnalysis.meta;
      languagesCache.set(username, {
        languages: topLanguages,
        meta: topLanguagesMeta
      });
    }

    // 4. Compute repository statistics
    const totalStars = rawRepos.reduce((acc, repo) => acc + (repo.stargazers_count || 0), 0);

    // Format all public repos from page 1
    const formattedRepos = rawRepos.map(formatRepositoryItem);
    const repoPage1Pagination = reposRes.pagination || {
      hasNext: rawRepos.length > 0 && rawRepos.length < (rawUser.public_repos || 0),
      hasPrev: false,
      nextPage: rawRepos.length > 0 && rawRepos.length < (rawUser.public_repos || 0) ? 2 : null,
      prevPage: null,
      lastPage: null
    };

    paginatedRepoCache.set(`repos:${username}:updated:100:1`, {
      repositories: formattedRepos,
      page: 1,
      per_page: 100,
      pagination: repoPage1Pagination
    });

    // Strictly sort by stars descending and take top 3 for popular repositories
    const popularRepositories = [...formattedRepos]
      .sort((a, b) => b.stars - a.stars)
      .slice(0, 3);

    // 5. Construct response payload
    const responsePayload = {
      user: {
        login: rawUser.login,
        name: rawUser.name,
        avatar_url: rawUser.avatar_url,
        html_url: rawUser.html_url,
        bio: rawUser.bio,
        location: rawUser.location,
        blog: rawUser.blog,
        company: rawUser.company,
        joined_date: formatJoinedDate(rawUser.created_at),
        created_at: rawUser.created_at,
        verified: rawUser.site_admin || rawUser.type === 'Organization' || rawUser.login.toLowerCase() === 'octocat',
        starred_count: starredCount,
        stats: {
          followers: rawUser.followers,
          followers_formatted: formatNumber(rawUser.followers),
          following: rawUser.following,
          following_formatted: formatNumber(rawUser.following),
          public_repos: rawUser.public_repos,
          public_repos_formatted: formatNumber(rawUser.public_repos),
          total_stars: totalStars,
          total_stars_formatted: formatNumber(totalStars),
          starred_count: starredCount,
          starred_count_formatted: starredCount !== null ? formatNumber(starredCount) : null
        }
      },
      popular_repositories: popularRepositories,
      repositories: formattedRepos,
      repositories_pagination: repoPage1Pagination,
      top_languages: topLanguages,
      top_languages_meta: topLanguagesMeta,
      contributions: contributionsRes,
      rate_limit: profileRes.rateLimit
    };

    // 6. Store complete profile response in bounded LRU cache (languages are cached 6h in languagesCache)
    profileCache.set(username, responsePayload);

    // 7. Set response headers and return
    res.setHeader('X-Cache', 'MISS');
    if (profileRes.rateLimit?.remaining) {
      res.setHeader('X-RateLimit-Remaining', profileRes.rateLimit.remaining);
    }
    if (profileRes.rateLimit?.reset) {
      res.setHeader('X-RateLimit-Reset', profileRes.rateLimit.reset);
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    if (err.name === 'AbortError' && abortController.signal.aborted) {
      return;
    }
    next(err);
  } finally {
    res.off('close', onClose);
  }
}

/**
 * Shared handler for paginated /api/repos/:username and /api/starred/:username requests.
 */
async function handlePaginatedRepoRequest(req, res, next, { kind, cacheKey, page, perPage, fetcher }) {
  const username = req.sanitizedUsername;
  const abortController = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  };
  res.on('close', onClose);

  try {
    res.setHeader('Cache-Control', 'no-store');
    const cached = paginatedRepoCache.get(cacheKey);
    if (cached) {
      if (kind === 'starred' && typeof cached.total_count !== 'number') {
        const knownStarCount = starredCountCache.get(username);
        if (typeof knownStarCount === 'number') {
          cached.total_count = knownStarCount;
        }
      }
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    logger.info(`Fetching ${kind} page ${page} (per_page=${perPage}) for "${username}".`);
    const result = await fetcher(abortController.signal);
    const repositories = (result.data || []).map(formatRepositoryItem);
    const pagination = result.pagination || {
      hasNext: false,
      hasPrev: page > 1,
      nextPage: null,
      prevPage: page > 1 ? page - 1 : null,
      lastPage: null
    };

    const payload = {
      repositories,
      page,
      per_page: perPage,
      pagination
    };

    if (kind === 'starred') {
      let totalCount = starredCountCache.get(username);
      const minLoadedCount = ((page - 1) * perPage) + repositories.length;

      if (!pagination.hasNext) {
        totalCount = minLoadedCount;
        starredCountCache.set(username, totalCount);
      } else if (typeof totalCount !== 'number') {
        const fetchedCount = await fetchUserStarredCount(username, { signal: abortController.signal });
        if (typeof fetchedCount === 'number' && fetchedCount >= minLoadedCount) {
          totalCount = fetchedCount;
          starredCountCache.set(username, totalCount);
        }
      }

      if (typeof totalCount === 'number') {
        payload.total_count = totalCount;
        const cachedProfile = profileCache.get(username);
        if (cachedProfile && typeof cachedProfile.user?.stats?.starred_count !== 'number') {
          applyStarredCountToProfile(cachedProfile, totalCount);
          profileCache.set(username, cachedProfile);
        }
      }
    }

    paginatedRepoCache.set(cacheKey, payload);
    res.setHeader('X-Cache', 'MISS');
    if (result.rateLimit?.remaining) {
      res.setHeader('X-RateLimit-Remaining', result.rateLimit.remaining);
    }
    if (result.rateLimit?.reset) {
      res.setHeader('X-RateLimit-Reset', result.rateLimit.reset);
    }
    return res.status(200).json(payload);
  } catch (err) {
    if (err.name === 'AbortError' && abortController.signal.aborted) {
      return;
    }
    next(err);
  } finally {
    res.off('close', onClose);
  }
}

/**
 * Controller for GET /api/repos/:username?page=1&per_page=100&sort=updated
 */
export async function getUserRepositories(req, res, next) {
  const username = req.sanitizedUsername;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 100));
  const sort = ['updated', 'created', 'pushed', 'full_name'].includes(req.query.sort) ? req.query.sort : 'updated';

  return handlePaginatedRepoRequest(req, res, next, {
    kind: 'repos',
    cacheKey: `repos:${username}:${sort}:${perPage}:${page}`,
    page,
    perPage,
    fetcher: (signal) => fetchUserRepositories(username, { page, perPage, sort, signal })
  });
}

/**
 * Controller for GET /api/starred/:username?page=1&per_page=100
 */
export async function getUserStarred(req, res, next) {
  const username = req.sanitizedUsername;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 100));

  return handlePaginatedRepoRequest(req, res, next, {
    kind: 'starred',
    cacheKey: `starred:${username}:${perPage}:${page}`,
    page,
    perPage,
    fetcher: (signal) => fetchUserStarredRepositories(username, { page, perPage, signal })
  });
}

/**
 * Controller for GET /api/contributions/:username
 * Always fetches live current-year contributions so newly made commits/activity update dynamically.
 */
export async function getContributions(req, res, next) {
  const username = req.sanitizedUsername;
  const abortController = new AbortController();

  const onClose = () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  };
  res.on('close', onClose);

  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Cache', 'BYPASS');
    const contributions = await fetchUserContributions(username, { signal: abortController.signal });
    return res.status(200).json(contributions);
  } catch (err) {
    if (err.name === 'AbortError' && abortController.signal.aborted) {
      return;
    }
    next(err);
  } finally {
    res.off('close', onClose);
  }
}

/**
 * Controller for GET /api/rate-limit
 */
export async function getRateLimit(req, res, next) {
  try {
    const rateLimitRes = await fetchRateLimitStatus();
    return res.status(200).json(rateLimitRes.data);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for GET /api/health
 */
export function getHealth(req, res) {
  return res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    cache: profileCache.getStats()
  });
}

