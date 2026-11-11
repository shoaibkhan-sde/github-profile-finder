/**
 * Integration and Error-handling tests for GitHub API Service and Error Handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { profileCache } from '../../src/utils/cache.js';

describe('GitHub API Service & Error Translation Integration', () => {
  beforeEach(() => {
    profileCache.clear();
    vi.restoreAllMocks();
  });

  it('should return 404 when GitHub reports user not found', async () => {
    // Mock global fetch to simulate GitHub 404
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({
        'x-ratelimit-remaining': '55',
        'x-ratelimit-reset': '1700000000'
      })
    });

    try {
      const res = await request(app).get('/api/profile/unknownnonexistentuser');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NotFoundError');
      expect(res.body.message).toBe('GitHub user not found.');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should return 429 when GitHub rate limit is exceeded', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': '1700003600',
        'retry-after': '60'
      })
    });

    try {
      const res = await request(app).get('/api/profile/octocat');
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('RateLimitExceeded');
      expect(res.body).toHaveProperty('rateLimitReset');
      expect(res.body).toHaveProperty('retryAfter');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should return 504 on request timeout', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(() => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    try {
      const res = await request(app).get('/api/profile/octocat');
      expect(res.status).toBe(504);
      expect(res.body.error).toBe('GatewayTimeout');
      expect(res.body.message).toBe('Request to GitHub API timed out.');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should successfully fetch, aggregate, and cache a complete profile', async () => {
    const originalFetch = global.fetch;
    
    // Mock responses for user, repos, and graphql
    global.fetch = vi.fn().mockImplementation((url) => {
      const urlStr = String(url);
      if (urlStr.includes('/graphql')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({
            data: {
              user: {
                contributionsCollection: {
                  contributionCalendar: {
                    totalContributions: 540,
                    weeks: []
                  }
                }
              }
            }
          })
        });
      }

      if (urlStr.includes('/repos')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({
            'x-ratelimit-remaining': '59',
            'x-ratelimit-reset': '1700000000'
          }),
          json: () => Promise.resolve([
            {
              id: 101,
              name: 'super-repo',
              stargazers_count: 500,
              forks_count: 50,
              language: 'JavaScript',
              updated_at: '2024-01-01T00:00:00Z',
              html_url: 'https://github.com/mock-user/super-repo'
            },
            {
              id: 102,
              name: 'mega-repo',
              stargazers_count: 1200,
              forks_count: 100,
              language: 'TypeScript',
              updated_at: '2024-02-01T00:00:00Z',
              html_url: 'https://github.com/mock-user/mega-repo'
            },
            {
              id: 103,
              name: 'mini-repo',
              stargazers_count: 10,
              forks_count: 2,
              language: 'HTML',
              updated_at: '2023-01-01T00:00:00Z',
              html_url: 'https://github.com/mock-user/mini-repo'
            },
            {
              id: 104,
              name: 'fourth-repo',
              stargazers_count: 5,
              forks_count: 1,
              language: 'CSS',
              updated_at: '2022-01-01T00:00:00Z',
              html_url: 'https://github.com/mock-user/fourth-repo'
            }
          ])
        });
      }

      // Default: /users/mock-user
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '1700000000'
        }),
        json: () => Promise.resolve({
          login: 'mock-user',
          name: 'Mock User',
          avatar_url: 'https://avatars.githubusercontent.com/u/12345',
          html_url: 'https://github.com/mock-user',
          bio: 'A test user bio',
          location: 'Remote',
          blog: 'https://example.com',
          created_at: '2020-01-01T00:00:00Z',
          followers: 1500,
          following: 20,
          public_repos: 4
        })
      });
    });

    try {
      // 1. Initial request (Cache MISS)
      const res = await request(app).get('/api/profile/mock-user');
      expect(res.status).toBe(200);
      expect(res.headers['x-cache']).toBe('MISS');
      expect(res.body.user.login).toBe('mock-user');
      expect(res.body.user.stats.followers_formatted).toBe('1.5K');
      expect(res.body.user.stats.total_stars).toBe(1715); // 1200 + 500 + 10 + 5
      expect(res.body.user.stats.total_stars_formatted).toBe('1.7K');

      // Strictly top 3 popular repos
      expect(res.body.popular_repositories).toHaveLength(3);
      expect(res.body.popular_repositories[0].name).toBe('mega-repo');
      expect(res.body.popular_repositories[1].name).toBe('super-repo');
      expect(res.body.popular_repositories[2].name).toBe('mini-repo');

      // 2. Second request (Cache HIT)
      const cachedRes = await request(app).get('/api/profile/mock-user');
      expect(cachedRes.status).toBe(200);
      expect(cachedRes.headers['x-cache']).toBe('HIT');
      expect(cachedRes.body.user.login).toBe('mock-user');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

