import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';

describe('Full-Stack Static & Routing Integration', () => {
  it('serves the index.html on GET /', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('GitHub Profile');
    expect(res.text).toContain('Finder');
    expect(res.text).toContain('id="search-form"');
    expect(res.text).toContain('id="history-dropdown"');
    expect(res.text).toContain('https://github.com/shoaibkhan-sde');
    expect(res.text).toContain('<link rel="icon" href="/favicon.ico" sizes="any">');
    expect(res.text).toContain('<link rel="icon" type="image/png" href="/github-profile-finder-favicon.png">');
    expect(res.text).toContain('<link rel="apple-touch-icon" href="/github-profile-finder-favicon.png">');
    expect(res.text).toContain('<meta name="google-site-verification" content="Vp1D6d2-UePtuTK1XZVRsgzpGIoD4wt6oz1TYJhOyvs" />');
  });

  it('serves favicon.ico and github-profile-finder-favicon.png from the public directory', async () => {
    const icoRes = await request(app).get('/favicon.ico');
    expect(icoRes.status).toBe(200);
    expect(icoRes.headers['content-type']).toMatch(/icon/);

    const pngRes = await request(app).get('/github-profile-finder-favicon.png');
    expect(pngRes.status).toBe(200);
    expect(pngRes.headers['content-type']).toContain('image/png');
  });

  it('serves valid sitemap.xml and robots.txt pointing to the production URL', async () => {
    const sitemapRes = await request(app).get('/sitemap.xml');
    expect(sitemapRes.status).toBe(200);
    expect(sitemapRes.headers['content-type']).toMatch(/xml/);
    expect(sitemapRes.text).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(sitemapRes.text).toContain('<loc>https://github-profile-finder-api.onrender.com/</loc>');
    expect(sitemapRes.text).not.toContain('example.com');

    const robotsRes = await request(app).get('/robots.txt');
    expect(robotsRes.status).toBe(200);
    expect(robotsRes.headers['content-type']).toContain('text/plain');
    expect(robotsRes.text).toContain('User-agent: *');
    expect(robotsRes.text).toContain('Allow: /');
    expect(robotsRes.text).toContain('Sitemap: https://github-profile-finder-api.onrender.com/sitemap.xml');
  });

  it('serves CSS stylesheets', async () => {
    const res = await request(app).get('/css/components.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.text).toContain('.profile-unified-card');
  });

  it('serves client JavaScript modules', async () => {
    const res = await request(app).get('/js/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.text).toContain('handleSearch');
  });

  it('responds with ok and cache metrics on GET /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.cache).toBeDefined();
    expect(typeof res.body.uptime).toBe('number');
  });

  it('returns 400 for invalid username syntax', async () => {
    const res = await request(app).get('/api/profile/invalid--user');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid Username');
  });
});
