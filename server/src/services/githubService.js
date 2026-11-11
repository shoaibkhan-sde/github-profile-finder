import { logger } from '../utils/logger.js';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const REQUEST_TIMEOUT_MS = 8000;

const GRAPHQL_CONTRIBUTION_LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4
};

/**
 * Builds request headers for GitHub API calls.
 * Applies optional Authorization header if process.env.GITHUB_TOKEN is configured.
 */
function getHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'GitHubProfileFinder-App'
  };

  const token = process.env.GITHUB_TOKEN;
  if (token && token !== 'your_github_personal_access_token_here' && token.trim().length > 0) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  return headers;
}

/**
 * Executes a fetch request with request-timeout and optional external AbortSignal support.
 */
async function githubFetch(url, options = {}, { responseType = 'json', externalSignal = null } = {}) {
  if (externalSignal?.aborted) {
    const abortError = new Error('Request was cancelled.');
    abortError.name = 'AbortError';
    throw abortError;
  }

  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(responseType === 'text' ? { 'User-Agent': 'GitHubProfileFinder-App' } : getHeaders()),
        ...options.headers
      },
      signal: controller.signal
    });

    const rateLimit = {
      limit: res.headers?.get?.('x-ratelimit-limit') ?? null,
      remaining: res.headers?.get?.('x-ratelimit-remaining') ?? null,
      reset: res.headers?.get?.('x-ratelimit-reset') ?? null,
      retryAfter: res.headers?.get?.('retry-after') ?? null
    };

    if (!res.ok) {
      if (res.status === 404) {
        const error = new Error('GitHub user not found.');
        error.status = 404;
        error.name = 'NotFoundError';
        throw error;
      }

      if (res.status === 401) {
        const error = new Error('GitHub API authentication failed. Please check GITHUB_TOKEN.');
        error.status = 401;
        error.name = 'AuthenticationError';
        throw error;
      }

      if (res.status === 403 || res.status === 429) {
        const error = new Error('GitHub API rate limit exceeded. Please try again later.');
        error.status = 429;
        error.name = 'RateLimitExceeded';
        error.rateLimitReset = rateLimit.reset;
        error.retryAfter =
          rateLimit.retryAfter ||
          (rateLimit.reset ? Math.max(1, rateLimit.reset - Math.floor(Date.now() / 1000)) : 60);
        throw error;
      }

      const error = new Error(`GitHub API responded with status ${res.status}.`);
      error.status = res.status >= 500 ? 502 : res.status;
      error.name = 'GitHubApiError';
      throw error;
    }

    const data = responseType === 'text'
      ? (typeof res.text === 'function' ? await res.text() : '')
      : await res.json();
    const linkHeader = res.headers?.get?.('link') ?? '';
    return { data, rateLimit, etag: res.headers?.get?.('etag') ?? null, linkHeader };
  } catch (err) {
    if (err.name === 'AbortError') {
      if (externalSignal?.aborted && !timedOut) {
        const cancelError = new Error('Request cancelled by client.');
        cancelError.name = 'AbortError';
        throw cancelError;
      }
      const timeoutError = new Error('Request to GitHub API timed out.');
      timeoutError.status = 504;
      timeoutError.name = 'GatewayTimeout';
      throw timeoutError;
    }
    if (!err.status) {
      const upstreamError = new Error('Failed to communicate with GitHub API upstream.');
      upstreamError.status = 502;
      upstreamError.name = 'BadGateway';
      throw upstreamError;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

/**
 * Parses GitHub RFC 8288 Link headers to determine next/prev/last page metadata.
 * @param {string} linkHeader
 */
export function parseLinkPagination(linkHeader = '') {
  const result = {
    hasNext: false,
    hasPrev: false,
    nextPage: null,
    prevPage: null,
    lastPage: null
  };
  if (!linkHeader || typeof linkHeader !== 'string') {
    return result;
  }

  for (const part of linkHeader.split(',')) {
    const urlMatch = part.match(/<([^>]+)>/);
    const relMatch = part.match(/;\s*rel=["']?([^"';]+)["']?/i);
    if (!urlMatch || !relMatch) continue;
    const urlStr = urlMatch[1];
    const rels = relMatch[1].toLowerCase().trim().split(/\s+/);
    try {
      const parsedUrl = new URL(urlStr);
      const pageNum = parseInt(parsedUrl.searchParams.get('page'), 10);
      if (!Number.isFinite(pageNum) || pageNum < 1) continue;
      if (rels.includes('next')) {
        result.hasNext = true;
        result.nextPage = pageNum;
      }
      if (rels.includes('prev')) {
        result.hasPrev = true;
        result.prevPage = pageNum;
      }
      if (rels.includes('last')) {
        result.lastPage = pageNum;
      }
    } catch {
      // Ignore malformed Link URLs
    }
  }
  return result;
}

/**
 * Fetches basic public profile info for a user.
 * @param {string} username
 */
export async function fetchUserProfile(username, { signal } = {}) {
  const url = `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}`;
  return await githubFetch(url, {}, { externalSignal: signal });
}

/**
 * Fetches a page of public repositories for a user.
 * Uses GET /users/{username}/repos?per_page=100&page=1&sort=updated by default.
 * @param {string} username
 */
export async function fetchUserRepositories(username, { page = 1, perPage = 100, sort = 'updated', signal } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePerPage = Math.min(100, Math.max(1, parseInt(perPage, 10) || 100));
  const safeSort = ['updated', 'created', 'pushed', 'full_name'].includes(sort) ? sort : 'updated';
  const url = `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}/repos?per_page=${safePerPage}&page=${safePage}&sort=${encodeURIComponent(safeSort)}`;
  const res = await githubFetch(url, {}, { externalSignal: signal });
  const repos = Array.isArray(res.data) ? res.data : [];
  return {
    data: repos,
    rateLimit: res.rateLimit || null,
    pagination: parseLinkPagination(res.linkHeader)
  };
}

/**
 * Fetches a page of repositories starred by a user.
 * Uses GET /users/{username}/starred?per_page=100&page=1.
 * @param {string} username
 */
export async function fetchUserStarredRepositories(username, { page = 1, perPage = 100, signal } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePerPage = Math.min(100, Math.max(1, parseInt(perPage, 10) || 100));
  const url = `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}/starred?per_page=${safePerPage}&page=${safePage}`;
  const res = await githubFetch(url, {}, { externalSignal: signal });
  const repos = Array.isArray(res.data) ? res.data : [];
  return {
    data: repos,
    rateLimit: res.rateLimit || null,
    pagination: parseLinkPagination(res.linkHeader)
  };
}

/**
 * Fetches the exact count of repositories starred by a user via a single
 * per_page=1 request and inspecting GitHub's Link rel="last" pagination header.
 * Returns null if the count cannot be determined cleanly (never substitutes repo stars).
 *
 * @param {string} username
 */
export async function fetchUserStarredCount(username, { signal } = {}) {
  const url = `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}/starred?per_page=1`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await githubFetch(url, {}, { externalSignal: signal });
      const pagination = parseLinkPagination(res.linkHeader);
      if (pagination.lastPage !== null) {
        return pagination.lastPage;
      }
      if (Array.isArray(res.data)) {
        return res.data.length;
      }
      return null;
    } catch (err) {
      if (err.name === 'AbortError' && signal?.aborted) throw err;
      if (err.name === 'NotFoundError' || err.name === 'RateLimitExceeded' || attempt === 1) {
        logger.warn(`Could not retrieve starred count for ${username}: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

/**
 * Formats contribution totals uniformly (e.g. "1 contribution in 2026", "546 contributions in 2026").
 */
function formatContributionsSummary(count, periodLabel) {
  const safeCount = Number.isFinite(count) ? count : 0;
  return `${safeCount.toLocaleString('en-US')} contribution${safeCount === 1 ? '' : 's'} ${periodLabel}`;
}

/**
 * Parses GitHub's public `https://github.com/users/{username}/contributions` HTML calendar
 * into structured weekly columns matching the GraphQL contributionCalendar schema.
 */
export function parsePublicContributionsHtml(html, { year = null } = {}) {
  if (typeof html !== 'string' || !html.includes('data-date=')) {
    return null;
  }

  const headerText = html.split(/<table\b/i)[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const totalMatch =
    headerText.match(/([\d,]+)\s+contributions?\s+in\s+(?:the\s+last\s+year|(\d{4}))/i) ||
    headerText.match(/([\d,]+)\s+contributions?/i);
  const periodLabel = year ? `in ${year}` : (totalMatch?.[2] ? `in ${totalMatch[2]}` : 'in the last year');

  // Map component ID -> tooltip text (e.g. "12 contributions on November 6.")
  const tooltipById = new Map();
  const tooltipRegex = /<tool-tip\b[^>]*for="([^"]+)"[^>]*>([^<]+)<\/tool-tip>/gi;
  let tipMatch;
  while ((tipMatch = tooltipRegex.exec(html)) !== null) {
    tooltipById.set(tipMatch[1], tipMatch[2].replace(/\s+/g, ' ').trim());
  }

  // Extract each calendar day cell (`data-date="YYYY-MM-DD"`, `data-level="0..4"`, `id="..."`)
  const daysByDate = new Map();
  const cellRegex = /<td\b[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*>/gi;
  const yearPrefix = year ? `${year}-` : null;
  let cellMatch;
  while ((cellMatch = cellRegex.exec(html)) !== null) {
    const tag = cellMatch[0];
    const date = cellMatch[1];
    if (yearPrefix && !date.startsWith(yearPrefix)) {
      continue;
    }
    const levelMatch = tag.match(/data-level="([0-4])"/i);
    const idMatch = tag.match(/\bid="([^"]+)"/i);

    const level = levelMatch ? parseInt(levelMatch[1], 10) : 0;
    const tooltip = idMatch ? tooltipById.get(idMatch[1]) || '' : '';
    let count = 0;
    if (tooltip) {
      const countMatch = tooltip.match(/^([\d,]+)\s+contribution/i);
      if (countMatch) {
        count = parseInt(countMatch[1].replace(/,/g, ''), 10);
      }
    }

    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    daysByDate.set(date, {
      date,
      weekday,
      level,
      count,
      tooltip: tooltip || `${date}`
    });
  }

  if (daysByDate.size === 0) {
    return null;
  }

  const sortedDays = Array.from(daysByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const summedCount = sortedDays.reduce((sum, day) => sum + (Number(day.count) || 0), 0);
  const resolvedCount = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : summedCount;
  const totalInYear = totalMatch || year
    ? formatContributionsSummary(resolvedCount, periodLabel)
    : 'Activity in the last year';

  const weeks = [];
  let currentWeek = null;

  for (const day of sortedDays) {
    if (!currentWeek || day.weekday === 0) {
      currentWeek = { contributionDays: [] };
      weeks.push(currentWeek);
    }
    currentWeek.contributionDays.push(day);
  }

  return {
    authenticated: false,
    live: true,
    source: 'github-calendar',
    ...(year ? { year } : {}),
    total_contributions: resolvedCount,
    total_in_year: totalInYear,
    weeks: year ? weeks : weeks.slice(-53)
  };
}

/**
 * Fetches live GitHub contribution calendar data:
 * 1) Uses authenticated GitHub GraphQL API when GITHUB_TOKEN is configured.
 * 2) Falls back to GitHub's official public user contributions calendar endpoint when unauthenticated.
 *
 * @param {string} username
 */
export async function fetchUserContributions(username, { signal } = {}) {
  const token = process.env.GITHUB_TOKEN;
  const hasToken = token && token !== 'your_github_personal_access_token_here' && token.trim().length > 0;
  const currentYear = new Date().getUTCFullYear();
  const yearPrefix = `${currentYear}-`;
  const fromIso = `${currentYear}-01-01T00:00:00Z`;
  const toIso = `${currentYear}-12-31T23:59:59Z`;

  if (hasToken) {
    const query = `
      query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  contributionCount
                  contributionLevel
                  date
                  weekday
                }
              }
            }
          }
        }
      }
    `;

    try {
      const res = await githubFetch(
        `${GITHUB_API_BASE}/graphql`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query,
            variables: { login: username, from: fromIso, to: toIso }
          })
        },
        { externalSignal: signal }
      );

      const calendar = res.data?.data?.user?.contributionsCollection?.contributionCalendar;
      if (calendar && Array.isArray(calendar.weeks)) {
        const normalizedWeeks = calendar.weeks
          .map((week) => ({
            contributionDays: (week.contributionDays || [])
              .filter((day) => typeof day?.date === 'string' && day.date.startsWith(yearPrefix))
              .map((day) => ({
                date: day.date,
                weekday: day.weekday,
                count: day.contributionCount,
                level: Object.hasOwn(GRAPHQL_CONTRIBUTION_LEVELS, day.contributionLevel)
                  ? GRAPHQL_CONTRIBUTION_LEVELS[day.contributionLevel]
                  : 0,
                tooltip: `${day.contributionCount} contribution${day.contributionCount === 1 ? '' : 's'} on ${day.date}`
              }))
          }))
          .filter((week) => week.contributionDays.length > 0);

        const totalCount = Number(calendar.totalContributions) || 0;
        return {
          authenticated: true,
          live: true,
          source: 'graphql',
          year: currentYear,
          total_contributions: totalCount,
          total_in_year: formatContributionsSummary(totalCount, `in ${currentYear}`),
          weeks: normalizedWeeks
        };
      }
    } catch (err) {
      if (err.name === 'AbortError' && signal?.aborted) throw err;
      logger.warn(`GraphQL contributions failed for ${username}, trying public calendar: ${err.message}`);
    }
  }

  // Public GitHub contribution calendar endpoint scoped to Jan–Dec of the current year
  try {
    const calendarUrl = `https://github.com/users/${encodeURIComponent(username)}/contributions?from=${currentYear}-01-01&to=${currentYear}-12-31`;
    const res = await githubFetch(
      calendarUrl,
      {
        headers: {
          Accept: 'text/html',
          'X-Requested-With': 'XMLHttpRequest'
        }
      },
      { responseType: 'text', externalSignal: signal }
    );

    const parsed = parsePublicContributionsHtml(res.data, { year: currentYear });
    if (parsed) {
      return parsed;
    }
  } catch (err) {
    if (err.name === 'AbortError' && signal?.aborted) throw err;
    logger.warn(`Could not retrieve public contributions for ${username}: ${err.message}`);
  }

  return {
    authenticated: false,
    live: false,
    year: currentYear,
    total_contributions: null,
    message: 'Live contribution calendar unavailable right now.',
    total_in_year: null,
    weeks: []
  };
}

/**
 * Retrieves the current rate limit status from GitHub.
 */
export async function fetchRateLimitStatus() {
  const url = `${GITHUB_API_BASE}/rate_limit`;
  return await githubFetch(url);
}
