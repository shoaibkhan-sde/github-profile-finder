/**
 * Integration tests covering Authenticated vs Unauthenticated modes,
 * partial/upstream API failures, caching, and API routing fallbacks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import {
  profileCache,
  languagesCache,
  paginatedRepoCache,
  starredCountCache
} from '../../src/utils/cache.js';

function clearAllCaches() {
  profileCache.clear();
  languagesCache.clear();
  paginatedRepoCache.clear();
  starredCountCache.clear();
}

describe('Authenticated & Unauthenticated Modes + API Failure Handling', () => {
  const originalToken = process.env.GITHUB_TOKEN;
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAllCaches();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });

  describe('Authenticated vs Unauthenticated Modes', () => {
    it('sends Bearer Authorization header to api.github.com and uses GraphQL contributions in authenticated mode', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test_valid_token_123456';
      const seenAuthByHost = [];

      global.fetch = vi.fn().mockImplementation((url, options = {}) => {
        const urlStr = String(url);
        const authHeader = options.headers?.Authorization || null;
        seenAuthByHost.push({ url: urlStr, hasAuth: Boolean(authHeader), authHeader });

        if (urlStr.includes('/graphql')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                user: {
                  contributionsCollection: {
                    contributionCalendar: {
                      totalContributions: 321,
                      weeks: [
                        {
                          contributionDays: [
                            {
                              date: `${new Date().getUTCFullYear()}-02-10`,
                              weekday: 2,
                              contributionCount: 4,
                              contributionLevel: 'SECOND_QUARTILE'
                            },
                            {
                              date: `${new Date().getUTCFullYear()}-02-11`,
                              weekday: 3,
                              contributionCount: 1,
                              contributionLevel: 'constructor'
                            }
                          ]
                        }
                      ]
                    }
                  }
                }
              }
            })
          });
        }

        if (urlStr.includes('/starred?per_page=1')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({
              link: '<https://api.github.com/users/authuser/starred?per_page=1&page=19>; rel="last"'
            }),
            json: async () => [{ id: 1 }]
          });
        }

        if (urlStr.includes('/repos')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'x-ratelimit-remaining': '4998', 'x-ratelimit-limit': '5000' }),
            json: async () => [
              {
                id: 10,
                name: 'auth-repo',
                full_name: 'authuser/auth-repo',
                fork: false,
                language: 'TypeScript',
                stargazers_count: 42,
                forks_count: 5,
                updated_at: '2026-01-10T00:00:00Z',
                html_url: 'https://github.com/authuser/auth-repo'
              }
            ]
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': '1900000000'
          }),
          json: async () => ({
            login: 'authuser',
            name: 'Auth User',
            avatar_url: 'https://avatars.githubusercontent.com/u/1',
            html_url: 'https://github.com/authuser',
            created_at: '2020-01-01T00:00:00Z',
            followers: 10,
            following: 5,
            public_repos: 1
          })
        });
      });

      const res = await request(app).get('/api/profile/authuser');
      expect(res.status).toBe(200);
      expect(res.body.contributions.authenticated).toBe(true);
      expect(res.body.contributions.source).toBe('graphql');
      expect(res.body.contributions.total_contributions).toBe(321);
      // Unknown/prototype key level safely defaults to 0 instead of function lookup
      expect(res.body.contributions.weeks[0].contributionDays[1].level).toBe(0);
      expect(res.body.user.stats.starred_count).toBe(19);
      expect(res.body.rate_limit.limit).toBe('5000');

      const apiCalls = seenAuthByHost.filter((c) => c.url.startsWith('https://api.github.com'));
      expect(apiCalls.length).toBeGreaterThanOrEqual(4);
      expect(apiCalls.every((c) => c.authHeader === 'Bearer ghp_test_valid_token_123456')).toBe(true);
    });

    it('falls back from GraphQL to public HTML calendar without leaking Authorization token to github.com', async () => {
      process.env.GITHUB_TOKEN = 'ghp_secret_must_not_go_to_html';
      const currentYear = new Date().getUTCFullYear();
      let htmlAuthHeader = 'unset';

      global.fetch = vi.fn().mockImplementation((url, options = {}) => {
        const urlStr = String(url);
        if (urlStr.includes('/graphql')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ data: { user: null } })
          });
        }

        if (urlStr.startsWith('https://github.com/users/')) {
          htmlAuthHeader = options.headers?.Authorization ?? null;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            text: async () => `
              <h2>7 contributions in ${currentYear}</h2>
              <table><tbody><tr>
                <td id="day-1" data-date="${currentYear}-03-01" data-level="2"></td>
              </tr></tbody></table>
              <tool-tip for="day-1">7 contributions on March 1.</tool-tip>
            `
          });
        }

        if (urlStr.includes('/starred')) {
          return Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
        }
        if (urlStr.includes('/repos')) {
          return Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            login: 'orgaccount',
            type: 'Organization',
            avatar_url: 'https://avatars.githubusercontent.com/u/2',
            html_url: 'https://github.com/orgaccount',
            created_at: '2018-01-01T00:00:00Z',
            followers: 100,
            following: 0,
            public_repos: 0
          })
        });
      });

      const res = await request(app).get('/api/profile/orgaccount');
      expect(res.status).toBe(200);
      expect(res.body.contributions.authenticated).toBe(false);
      expect(res.body.contributions.source).toBe('github-calendar');
      expect(res.body.contributions.total_contributions).toBe(7);
      expect(htmlAuthHeader).toBeNull();
    });

    it('runs in unauthenticated mode when GITHUB_TOKEN is missing or placeholder', async () => {
      for (const tokenVal of [undefined, '', '   ', 'your_github_personal_access_token_here']) {
        clearAllCaches();
        if (tokenVal === undefined) {
          delete process.env.GITHUB_TOKEN;
        } else {
          process.env.GITHUB_TOKEN = tokenVal;
        }

        const currentYear = new Date().getUTCFullYear();
        const requestUrls = [];
        const authHeaders = [];

        global.fetch = vi.fn().mockImplementation((url, options = {}) => {
          const urlStr = String(url);
          requestUrls.push(urlStr);
          authHeaders.push(options.headers?.Authorization ?? null);

          if (urlStr.startsWith('https://github.com/users/')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'text/html' }),
              text: async () => `
                <h2>3 contributions in ${currentYear}</h2>
                <table><tbody><tr><td id="d1" data-date="${currentYear}-01-15" data-level="1"></td></tr></tbody></table>
                <tool-tip for="d1">3 contributions on January 15.</tool-tip>
              `
            });
          }
          if (urlStr.includes('/starred')) {
            return Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
          }
          if (urlStr.includes('/repos')) {
            return Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '57' }),
            json: async () => ({
              login: 'unauthuser',
              avatar_url: 'https://avatars.githubusercontent.com/u/3',
              html_url: 'https://github.com/unauthuser',
              created_at: '2021-01-01T00:00:00Z',
              followers: 1,
              following: 1,
              public_repos: 0
            })
          });
        });

        const res = await request(app).get('/api/profile/unauthuser');
        expect(res.status).toBe(200);
        expect(requestUrls.some((u) => u.includes('/graphql'))).toBe(false);
        expect(authHeaders.every((h) => h === null)).toBe(true);
        expect(res.body.contributions.authenticated).toBe(false);
        expect(res.body.contributions.source).toBe('github-calendar');
        expect(res.body.rate_limit.limit).toBe('60');
      }
    });

    it('reports authenticated (5000) vs unauthenticated (60) quota via GET /api/rate-limit', async () => {
      global.fetch = vi.fn().mockImplementation((_url, options = {}) => {
        const isAuthed = Boolean(options.headers?.Authorization);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            resources: {
              core: {
                limit: isAuthed ? 5000 : 60,
                remaining: isAuthed ? 4999 : 59,
                reset: 1900000000
              }
            }
          })
        });
      });

      process.env.GITHUB_TOKEN = 'ghp_valid_token';
      const authedRes = await request(app).get('/api/rate-limit');
      expect(authedRes.status).toBe(200);
      expect(authedRes.body.resources.core.limit).toBe(5000);

      delete process.env.GITHUB_TOKEN;
      const unauthRes = await request(app).get('/api/rate-limit');
      expect(unauthRes.status).toBe(200);
      expect(unauthRes.body.resources.core.limit).toBe(60);
    });
  });

  describe('API Failure & Partial Degradation Scenarios', () => {
    it('returns 401 AuthenticationError when GitHub rejects an invalid token without leaking the token', async () => {
      process.env.GITHUB_TOKEN = 'ghp_revoked_secret_token_999';
      const errLogs = [];
      const warnLogs = [];
      const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => errLogs.push(args.join(' ')));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => warnLogs.push(args.join(' ')));

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers()
      });

      const res = await request(app).get('/api/profile/octocat');
      errSpy.mockRestore();
      warnSpy.mockRestore();

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('AuthenticationError');
      expect(JSON.stringify(res.body)).not.toContain('ghp_revoked_secret_token_999');
      expect([...errLogs, ...warnLogs].join('\n')).not.toContain('ghp_revoked_secret_token_999');
    });

    it('maps GitHub 5xx upstream errors to 502 Bad Gateway', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers()
      });

      const res = await request(app).get('/api/profile/octocat');
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('GitHubApiError');
      expect(res.body.message).toContain('503');
    });

    it('maps upstream network failures (TypeError / ECONNREFUSED) to 502 BadGateway instead of 500', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED'));

      const res = await request(app).get('/api/profile/octocat');
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('BadGateway');
      expect(res.body.message).toBe('Failed to communicate with GitHub API upstream.');
    });

    it('maps malformed non-JSON HTTP 200 upstream body (SyntaxError) to 502 BadGateway', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
        text: async () => '<html>bad gateway</html>'
      });

      const res = await request(app).get('/api/profile/octocat');
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('BadGateway');
    });

    it('degrades gracefully on partial failures (starred count 500 & contributions down still returns 200 profile)', async () => {
      delete process.env.GITHUB_TOKEN;

      global.fetch = vi.fn().mockImplementation((url) => {
        const urlStr = String(url);
        if (urlStr.includes('/starred?per_page=1')) {
          return Promise.resolve({ ok: false, status: 500, headers: new Headers() });
        }
        if (urlStr.startsWith('https://github.com/users/')) {
          return Promise.resolve({ ok: false, status: 503, headers: new Headers() });
        }
        if (urlStr.includes('/repos')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => [
              {
                id: 1,
                name: 'core-lib',
                stargazers_count: 150,
                forks_count: 10,
                language: 'Go',
                updated_at: '2026-01-01T00:00:00Z',
                html_url: 'https://github.com/partial/core-lib'
              }
            ]
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            login: 'partial',
            avatar_url: 'https://avatars.githubusercontent.com/u/4',
            html_url: 'https://github.com/partial',
            created_at: '2022-01-01T00:00:00Z',
            followers: 25,
            following: 2,
            public_repos: 1
          })
        });
      });

      const res = await request(app).get('/api/profile/partial');
      expect(res.status).toBe(200);
      expect(res.body.user.login).toBe('partial');
      expect(res.body.user.stats.total_stars).toBe(150);
      // Never substitutes repo stars when starred count fails
      expect(res.body.user.stats.starred_count).toBeNull();
      expect(res.body.contributions.live).toBe(false);
      expect(res.body.contributions.weeks).toEqual([]);
    });

    it('handles paginated /api/repos/:username and /api/starred/:username with clamping, sorting allowlist, caching, and error propagation', async () => {
      let fetchCalls = 0;
      global.fetch = vi.fn().mockImplementation((url) => {
        fetchCalls += 1;
        const urlStr = String(url);
        if (urlStr.includes('/starred')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'x-ratelimit-remaining': '50' }),
            json: async () => [
              {
                id: 99,
                name: 'starred-lib',
                full_name: 'org/starred-lib',
                owner: { login: 'org', avatar_url: 'https://avatars.githubusercontent.com/u/9', html_url: 'https://github.com/org' },
                stargazers_count: 800,
                forks_count: 40,
                language: 'Rust',
                updated_at: '2026-01-01T00:00:00Z',
                html_url: 'https://github.com/org/starred-lib'
              }
            ]
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => []
        });
      });

      // Unknown sort falls back to updated; per_page=999 clamps to 100
      const repoRes = await request(app).get('/api/repos/octocat?page=-5&per_page=999&sort=invalidSort');
      expect(repoRes.status).toBe(200);
      expect(repoRes.body.page).toBe(1);
      expect(repoRes.body.per_page).toBe(100);
      expect(String(global.fetch.mock.calls[0][0])).toContain('sort=updated');
      expect(String(global.fetch.mock.calls[0][0])).toContain('per_page=100');

      const starRes1 = await request(app).get('/api/starred/octocat?page=1&per_page=100');
      expect(starRes1.status).toBe(200);
      expect(starRes1.headers['x-cache']).toBe('MISS');
      expect(starRes1.body.total_count).toBe(1);

      const callsBeforeCacheHit = fetchCalls;
      const starRes2 = await request(app).get('/api/starred/octocat?page=1&per_page=100');
      expect(starRes2.status).toBe(200);
      expect(starRes2.headers['x-cache']).toBe('HIT');
      expect(fetchCalls).toBe(callsBeforeCacheHit);

      // Failure on /api/starred/:username propagates cleanly
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '45' })
      });
      const rateErrRes = await request(app).get('/api/starred/otheruser?page=1&per_page=100');
      expect(rateErrRes.status).toBe(429);
      expect(rateErrRes.body.error).toBe('RateLimitExceeded');
    });

    it('returns structured JSON 404 for unknown /api routes and unsupported HTTP methods instead of HTML', async () => {
      const unknownRoute = await request(app).get('/api/nonexistent-endpoint');
      expect(unknownRoute.status).toBe(404);
      expect(unknownRoute.headers['content-type']).toContain('application/json');
      expect(unknownRoute.body.error).toBe('NotFoundError');

      const badMethod = await request(app).post('/api/profile/octocat').send({ test: 1 });
      expect(badMethod.status).toBe(404);
      expect(badMethod.headers['content-type']).toContain('application/json');
      expect(badMethod.body.error).toBe('NotFoundError');
    });
  });
});

