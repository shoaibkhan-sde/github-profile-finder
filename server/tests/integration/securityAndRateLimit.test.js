/**
 * Integration & Unit Security, Rate-Limit, Cooldown, and XSS Protection Tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { MemoryCache, profileCache, paginatedRepoCache } from '../../src/utils/cache.js';
import { logger } from '../../src/utils/logger.js';
import { analyzeRepositoryLanguages } from '../../src/services/languagesService.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import {
  fetchProfile,
  fetchTabRepositoriesPage,
  fetchContributions,
  clearSessionCache
} from '../../../client/js/api.js';
import {
  sanitizeHttpUrl,
  renderErrorState,
  createRepoCardElement
} from '../../../client/js/dom.js';

class TestElement {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.listeners = {};
    this._className = '';
    this._textContent = '';
    this._innerHTML = '';
    this.hidden = false;
    this.classList = {
      add: (...cls) => {
        const s = new Set(this._className.split(/\s+/).filter(Boolean));
        cls.forEach((c) => s.add(c));
        this._className = Array.from(s).join(' ');
      },
      toggle: (cls, force) => {
        const s = new Set(this._className.split(/\s+/).filter(Boolean));
        if (force === true) s.add(cls);
        else if (force === false) s.delete(cls);
        this._className = Array.from(s).join(' ');
      },
      contains: (cls) => this._className.split(/\s+/).includes(cls)
    };
  }
  set className(val) {
    this._className = String(val || '');
  }
  get className() {
    return this._className;
  }
  set textContent(val) {
    this._textContent = String(val ?? '');
  }
  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map((c) => c.textContent).join('');
  }
  set innerHTML(val) {
    this._innerHTML = String(val || '');
    if (val === '') {
      this.children = [];
      this._textContent = '';
    }
  }
  get innerHTML() {
    return this._innerHTML;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return this.attributes[k];
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  addEventListener(evt, fn) {
    this.listeners[evt] = fn;
  }
}

describe('Rate-Limit Behavior, Security Controls & Client Resilience', () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    CLIENT_ORIGIN: process.env.CLIENT_ORIGIN,
    RATE_LIMIT_MAX_REQUESTS: process.env.RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS
  };

  beforeEach(() => {
    profileCache.clear();
    paginatedRepoCache.clear();
    clearSessionCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete global.document;
  });

  describe('Rate-Limit Behavior (Express Limiter + Upstream GitHub + Client Cooldown)', () => {
    it('enforces express-rate-limit after max requests and emits standard RateLimit-* headers', async () => {
      process.env.RATE_LIMIT_MAX_REQUESTS = '3';
      process.env.RATE_LIMIT_WINDOW_MS = '60000';
      const limitedApp = createApp();

      const r1 = await request(limitedApp).get('/api/health');
      expect(r1.status).toBe(200);
      expect(r1.headers['ratelimit-limit']).toBe('3');
      expect(r1.headers['ratelimit-remaining']).toBe('2');

      const r2 = await request(limitedApp).get('/api/health');
      expect(r2.status).toBe(200);
      expect(r2.headers['ratelimit-remaining']).toBe('1');

      const r3 = await request(limitedApp).get('/api/health');
      expect(r3.status).toBe(200);
      expect(r3.headers['ratelimit-remaining']).toBe('0');

      const r4 = await request(limitedApp).get('/api/health');
      expect(r4.status).toBe(429);
      expect(r4.body.error).toBe('TooManyRequests');
      expect(r4.body.message).toContain('Too many requests');
    });

    it('always includes positive retryAfter on 403/429 upstream rate limit even when reset timestamp equals now', async () => {
      const app = createApp();
      const nowEpoch = Math.floor(Date.now() / 1000);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Headers({
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(nowEpoch)
        })
      });

      const res = await request(app).get('/api/repos/octocat');
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('RateLimitExceeded');
      expect(res.body.retryAfter).toBeGreaterThanOrEqual(1);
    });

    it('client API activates cooldown on 429, blocks uncached requests & explorer calls, serves cached data, and validates JSON payloads', async () => {
      let fetchCount = 0;

      // 1. Seed a cached profile for cacheddev first
      global.fetch = vi.fn().mockImplementation(async (url) => {
        fetchCount += 1;
        if (String(url).includes('/api/profile/cacheddev')) {
          return new Response(
            JSON.stringify({
              user: { login: 'cacheddev', public_repos: 1 },
              repositories: [{ id: 1, name: 'one', stars: 3 }],
              contributions: { live: true, weeks: [] }
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json', 'x-cache': 'MISS' }
            }
          );
        }
        return new Response(
          JSON.stringify({
            error: 'RateLimitExceeded',
            message: 'GitHub API rate limit exceeded.',
            retryAfter: 30
          }),
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '30' }
          }
        );
      });

      const cachedOk = await fetchProfile('cacheddev');
      expect(cachedOk.data.user.login).toBe('cacheddev');

      // 2. Hit 429 on uncached user -> activates cooldown
      await expect(fetchProfile('ratelimiteduser')).rejects.toMatchObject({
        status: 429,
        error: 'RateLimitExceeded'
      });

      const countAtCooldownStart = fetchCount;

      // 3. Subsequent uncached fetchProfile, fetchTabRepositoriesPage, and fetchContributions short-circuit without calling fetch()
      await expect(fetchProfile('anotheruser')).rejects.toMatchObject({
        status: 429,
        error: 'RateLimitExceeded'
      });
      await expect(fetchTabRepositoriesPage('cacheddev', 'starred', 1)).rejects.toMatchObject({
        status: 429,
        error: 'RateLimitExceeded'
      });
      const contribDuringCooldown = await fetchContributions('cacheddev');
      expect(contribDuringCooldown).toBeNull();
      expect(fetchCount).toBe(countAtCooldownStart);

      // 4. Cached profile remains accessible from sessionCache during cooldown
      const fromCacheDuringCooldown = await fetchProfile('cacheddev');
      expect(fromCacheDuringCooldown.isCached).toBe(true);
      expect(fromCacheDuringCooldown.data.user.login).toBe('cacheddev');

      // 5. After clearing cooldown, HTML 200 non-JSON response fails cleanly with 502 InvalidResponse
      clearSessionCache();
      global.fetch = vi.fn().mockResolvedValue(
        new Response('<html>oops</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })
      );
      await expect(fetchProfile('htmluser')).rejects.toMatchObject({
        status: 502,
        error: 'InvalidResponse'
      });
    });

    it('client API aborts outdated profile requests when username changes', async () => {
      const aborted = [];
      global.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            aborted.push(true);
            const e = new Error('Aborted');
            e.name = 'AbortError';
            reject(e);
          });
          if (String(_url).includes('seconduser')) {
            resolve(
              new Response(
                JSON.stringify({ user: { login: 'seconduser' }, repositories: [] }),
                { status: 200, headers: { 'content-type': 'application/json' } }
              )
            );
          }
        });
      });

      const p1 = fetchProfile('firstuser').catch((err) => err);
      const p2 = fetchProfile('seconduser');

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(aborted).toHaveLength(1);
      expect(r1.name).toBe('AbortError');
      expect(r2.data.user.login).toBe('seconduser');
    });
  });

  describe('Security Controls (Headers, CORS, Path Traversal, Injection, Token Redaction, XSS)', () => {
    it('sets Helmet security headers and strict CSP directives', async () => {
      const app = createApp();
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['referrer-policy']).toBeTruthy();

      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("connect-src 'self' https://api.github.com");
    });

    it('enforces CORS allowlist in production with 403 while permitting allowlisted & no-origin requests', async () => {
      process.env.NODE_ENV = 'production';
      process.env.CLIENT_ORIGIN = 'https://trusted.example.com';
      const prodApp = createApp();

      const blocked = await request(prodApp)
        .get('/api/health')
        .set('Origin', 'https://evil.example.net');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toBe('CorsError');

      const allowed = await request(prodApp)
        .get('/api/health')
        .set('Origin', 'https://trusted.example.com');
      expect(allowed.status).toBe(200);
      expect(allowed.headers['access-control-allow-origin']).toBe('https://trusted.example.com');

      const sameHost = await request(prodApp)
        .get('/api/health')
        .set('Host', 'app.onrender.com')
        .set('Origin', 'https://app.onrender.com');
      expect(sameHost.status).toBe(200);

      const sameOrigin = await request(prodApp).get('/api/health');
      expect(sameOrigin.status).toBe(200);
    });

    it('blocks path traversal and never exposes server/.env or secrets', async () => {
      const app = createApp();
      const sensitivePaths = [
        '/.env',
        '/server/.env',
        '/../server/.env',
        '/%2e%2e/server/.env',
        '/..%2fserver%2f.env'
      ];

      for (const p of sensitivePaths) {
        const res = await request(app).get(p);
          expect(res.text).not.toContain('GITHUB_TOKEN=');
        expect(res.text).not.toContain('RATE_LIMIT_MAX_REQUESTS=');
      }

      const apiTraversal = await request(app).get('/api/profile/..%2f..%2fetc%2fpasswd');
      expect(apiTraversal.status).toBe(400);
      expect(apiTraversal.body.error).toBe('Invalid Username');
    });

    it('rejects XSS, SQLi, and malformed usernames across every parameterized API route', async () => {
      const app = createApp();
      const endpoints = ['/api/profile', '/api/repos', '/api/starred', '/api/contributions'];
      const payloads = [
        '<script>alert(1)</script>',
        'octo--cat',
        '-leading',
        'trailing-',
        'a'.repeat(40),
        "admin' OR '1'='1",
        'user%00name'
      ];

      for (const base of endpoints) {
        for (const payload of payloads) {
          const res = await request(app).get(`${base}/${encodeURIComponent(payload)}`);
          expect(res.status).toBe(400);
        }
      }
    });

    it('enforces 10kb JSON body size limit and hides internal 500 error messages in production', async () => {
      process.env.NODE_ENV = 'production';
      const prodApp = createApp();

      const oversized = { data: 'x'.repeat(12000) };
      const res = await request(prodApp)
        .post('/api/health')
        .set('Content-Type', 'application/json')
        .send(oversized);
      expect(res.status).toBe(413);

      // Verify central errorHandler masks sensitive details on 500 in production
      const mockRes = {
        statusCode: 0,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.body = payload;
          return this;
        }
      };
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      errorHandler(new Error('SQL syntax error at /srv/app/secret.js line 42'), {}, mockRes, () => {});
      errSpy.mockRestore();

      expect(mockRes.statusCode).toBe(500);
      expect(mockRes.body.message).toBe('An unexpected error occurred while processing your request.');
      expect(mockRes.body.message).not.toContain('/srv/app');
    });

    it('redacts Bearer tokens and query/header secrets in logger output', () => {
      const logs = [];
      const logSpy = vi.spyOn(console, 'error').mockImplementation((...args) => logs.push(args.join(' ')));

      logger.error('Failed auth with Bearer ghp_SecretTokenValue123 and token=abc_secret_xyz&key=my_api_key_99');
      logSpy.mockRestore();

      const combined = logs.join('\n');
      expect(combined).toContain('Bearer [REDACTED]');
      expect(combined).toContain('token=[REDACTED]');
      expect(combined).toContain('key=[REDACTED]');
      expect(combined).not.toContain('ghp_SecretTokenValue123');
      expect(combined).not.toContain('abc_secret_xyz');
      expect(combined).not.toContain('my_api_key_99');
    });

    it('resists prototype pollution in MemoryCache and analyzeRepositoryLanguages', () => {
      const cache = new MemoryCache();
      cache.set('__proto__', { polluted: true });
      cache.set('constructor', { ctor: true });
      cache.set('toString', { str: true });

      expect({}.polluted).toBeUndefined();
      expect(cache.get('__proto__')).toEqual({ polluted: true });
      expect(cache.get('constructor')).toEqual({ ctor: true });

      const { languages, meta } = analyzeRepositoryLanguages([
        { name: 'r1', fork: false, language: 'constructor' },
        { name: 'r2', fork: false, language: 'toString' },
        { name: 'r3', fork: false, language: '__proto__' }
      ]);

      expect(meta.analyzed_repos).toBe(3);
      expect(languages.map((l) => l.count)).toEqual([1, 1, 1]);
      expect(languages[0].percentage).toBe(33.3);
    });

    it('blocks dangerous URL schemes and neutralizes HTML/XSS payloads in client DOM rendering', () => {
      expect(sanitizeHttpUrl('https://github.com/octocat')).toBe('https://github.com/octocat');
      expect(sanitizeHttpUrl('http://example.com/docs')).toBe('http://example.com/docs');
      expect(sanitizeHttpUrl('javascript:alert(1)')).toBe('#');
      expect(sanitizeHttpUrl('  JAVASCRIPT:alert(document.cookie)  ')).toBe('#');
      expect(sanitizeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
      expect(sanitizeHttpUrl('vbscript:msgbox(1)', '')).toBe('');

      const created = [];
      const profileContainer = new TestElement('div');
      profileContainer.id = 'profile-card-container';

      global.document = {
        getElementById: (id) => (id === 'profile-card-container' ? profileContainer : null),
        createElement: (tag) => {
          const el = new TestElement(tag);
          created.push(el);
          return el;
        },
        createElementNS: (_ns, tag) => {
          const el = new TestElement(tag);
          created.push(el);
          return el;
        }
      };

      const xssMsg = '"<img src=x onerror=alert(1)>" is not a valid GitHub username.';
      renderErrorState({ status: 400, message: xssMsg });

      const errorCard = profileContainer.children[0];
      const messageEl = errorCard.children.find((c) => c.className === 'error-message');
      expect(messageEl).toBeTruthy();
      expect(messageEl.textContent).toBe(xssMsg);
      // Verify textContent was used rather than innerHTML tag parsing
      expect(errorCard.innerHTML).toBe('');
      expect(messageEl.innerHTML).toBe('');

      const card = createRepoCardElement({
        name: '<svg onload=alert(1)>',
        description: '<script>evil()</script>',
        stars_formatted: '<img src=x onerror=alert(1)>',
        forks_formatted: '12',
        language: 'JavaScript',
        html_url: 'javascript:alert(1)'
      });
      const header = card.children[0];
      const titleLink = header.children.find((c) => c.tagName === 'A');
      expect(titleLink.href).toBe('#');
      expect(titleLink.textContent).toBe('<svg onload=alert(1)>');
      const starSpan = card.children[2].children[0].children[0].children[1];
      expect(starSpan.innerHTML).toBe('');
      expect(starSpan.textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it('marks both heatmap container and grid as is-empty when contributions are unavailable, and clears on valid weeks', async () => {
      const { renderContributions } = await import('../../../client/js/dom.js');

      function makeClassList() {
        const set = new Set();
        return {
          add: (...cls) => cls.forEach((c) => set.add(c)),
          remove: (...cls) => cls.forEach((c) => set.delete(c)),
          toggle: (c, force) => (force ? set.add(c) : set.delete(c)),
          contains: (c) => set.has(c)
        };
      }

      const containerEl = { classList: makeClassList() };
      const monthsRow = { innerHTML: '', style: { setProperty: () => {} }, appendChild: () => {} };
      const children = [];
      const gridEl = {
        innerHTML: '',
        classList: makeClassList(),
        style: { setProperty: () => {}, removeProperty: () => {} },
        closest: (sel) => (sel === '.heatmap-container' ? containerEl : null),
        appendChild: (node) => children.push(node)
      };
      const subtitleEl = { textContent: '' };

      global.document = {
        getElementById: (id) => {
          if (id === 'heatmap-grid') return gridEl;
          if (id === 'heatmap-months') return monthsRow;
          if (id === 'contrib-subtitle') return subtitleEl;
          return null;
        },
        createElement: (tag) => {
          const el = new TestElement(tag);
          el.classList = makeClassList();
          return el;
        }
      };

      renderContributions({ totalContributions: 0, live: false, weeks: [] });
      expect(gridEl.classList.contains('is-empty')).toBe(true);
      expect(containerEl.classList.contains('is-empty')).toBe(true);
      expect(children.at(-1).textContent).toBe('Contribution calendar temporarily unavailable.');

      renderContributions({
        totalContributions: 3,
        year: 2026,
        live: true,
        weeks: [{ contributionDays: [{ date: '2026-01-01', contributionCount: 3, level: 2 }] }]
      });
      expect(gridEl.classList.contains('is-empty')).toBe(false);
      expect(containerEl.classList.contains('is-empty')).toBe(false);
    });

    it('renders a clean 0-contribution year grid ONLY for google, github, and vercel sample orgs when weeks are empty', async () => {
      const { renderContributions } = await import('../../../client/js/dom.js');

      function makeClassList() {
        const set = new Set();
        return {
          add: (...cls) => cls.forEach((c) => set.add(c)),
          remove: (...cls) => cls.forEach((c) => set.delete(c)),
          toggle: (c, force) => (force ? set.add(c) : set.delete(c)),
          contains: (c) => set.has(c)
        };
      }

      const containerEl = { classList: makeClassList() };
      const monthNodes = [];
      const monthsRow = {
        innerHTML: '',
        style: { setProperty: () => {} },
        appendChild: (node) => monthNodes.push(node),
        removeChild: () => {},
        get lastElementChild() {
          return monthNodes.at(-1) || null;
        }
      };
      const gridNodes = [];
      const gridEl = {
        innerHTML: '',
        classList: makeClassList(),
        style: { setProperty: () => {}, removeProperty: () => {} },
        closest: (sel) => (sel === '.heatmap-container' ? containerEl : null),
        appendChild: (node) => gridNodes.push(node)
      };
      const subtitleEl = { textContent: '' };

      global.document = {
        getElementById: (id) => {
          if (id === 'heatmap-grid') return gridEl;
          if (id === 'heatmap-months') return monthsRow;
          if (id === 'contrib-subtitle') return subtitleEl;
          return null;
        },
        createElement: (tag) => {
          const el = new TestElement(tag);
          el.classList = makeClassList();
          return el;
        }
      };

      for (const sampleLogin of ['google', 'github', 'Vercel']) {
        gridNodes.length = 0;
        monthNodes.length = 0;
        renderContributions({ totalContributions: null, year: 2026, live: false, weeks: [] }, sampleLogin);
        expect(gridEl.classList.contains('is-empty')).toBe(false);
        expect(containerEl.classList.contains('is-empty')).toBe(false);
        expect(subtitleEl.textContent).toBe('0 contributions in 2026');
        expect(gridNodes.length).toBe(365);
        expect(gridNodes.every((cell) => cell.className === 'heatmap-cell' && cell.attributes['data-level'] === '0')).toBe(true);
        expect(monthNodes.map((m) => m.textContent)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
      }

      // Non-sample orgs/users must preserve existing unavailable fallback
      gridNodes.length = 0;
      monthNodes.length = 0;
      renderContributions({ totalContributions: null, year: 2026, live: false, weeks: [] }, 'facebook');
      expect(gridEl.classList.contains('is-empty')).toBe(true);
      expect(containerEl.classList.contains('is-empty')).toBe(true);
      expect(subtitleEl.textContent).toBe('Activity in 2026');
      expect(gridNodes.length).toBe(1);
      expect(gridNodes[0].textContent).toBe('Contribution calendar temporarily unavailable.');
    });
  });
});

