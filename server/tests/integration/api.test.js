/**
 * Integration tests for Express API endpoints using Supertest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { profileCache } from '../../src/utils/cache.js';

describe('Express API Integration Tests', () => {
  beforeEach(() => {
    profileCache.clear();
  });

  describe('GET /api/health', () => {
    it('should return 200 OK with health status and cache stats', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('cache');
      expect(res.body.cache.size).toBe(0);
    });
  });

  describe('Input Validation on GET /api/profile/:username', () => {
    it('should return 400 for usernames starting with a hyphen', async () => {
      const res = await request(app).get('/api/profile/-octocat');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid Username');
    });

    it('should return 400 for usernames ending with a hyphen', async () => {
      const res = await request(app).get('/api/profile/octocat-');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid Username');
    });

    it('should return 400 for usernames with consecutive hyphens', async () => {
      const res = await request(app).get('/api/profile/octo--cat');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid Username');
    });

    it('should return 400 for usernames exceeding 39 characters', async () => {
      const tooLong = 'a'.repeat(40);
      const res = await request(app).get(`/api/profile/${tooLong}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid Username');
    });

    it('should return 400 for usernames containing special characters', async () => {
      const res = await request(app).get('/api/profile/octo%20cat');
      expect(res.status).toBe(400);
    });
  });

  describe('Caching behavior on /api/profile/:username', () => {
    it('should return X-Cache: HIT when payload is present in cache', async () => {
      const mockPayload = {
        user: { login: 'cached-user', name: 'Cached User' },
        popular_repositories: [],
        top_languages: []
      };

      // Seed cache directly
      profileCache.set('cached-user', mockPayload);

      const res = await request(app).get('/api/profile/cached-user');
      expect(res.status).toBe(200);
      expect(res.headers['x-cache']).toBe('HIT');
      expect(res.body.user.login).toBe('cached-user');
    });
  });
});

