import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  analyzeRepositoryLanguages,
  calculateLanguageDistribution,
  getLanguageColor
} from '../../src/services/languagesService.js';
import {
  fetchUserRepositories,
  parsePublicContributionsHtml,
  fetchUserContributions
} from '../../src/services/githubService.js';
import { getContributions } from '../../src/controllers/profileController.js';
import {
  languagesCache,
  LANGUAGES_CACHE_TTL_MS
} from '../../src/utils/cache.js';

describe('Languages Service — Optimized Single-Request Primary Language Analysis', () => {
  beforeEach(() => {
    languagesCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('excludes forks, ignores null/empty languages, and computes percentages over detected repos', () => {
    const repos = [
      { name: 'r1', fork: false, language: 'JavaScript' },
      { name: 'r2', fork: false, language: 'JavaScript' },
      { name: 'r3', fork: false, language: 'TypeScript' },
      { name: 'r4', fork: true, language: 'Rust' },
      { name: 'r5', fork: false, language: null },
      { name: 'r6', fork: false, language: '' },
      { name: 'r7', fork: false, language: 'Python' }
    ];

    const { languages, meta } = analyzeRepositoryLanguages(repos);

    expect(meta).toMatchObject({
      method: 'primary_language',
      byte_level: false,
      window_limit: 100,
      fetched_repos: 7,
      excluded_forks: 1,
      ignored_null_language: 2,
      analyzed_repos: 4,
      basis: 'Based on latest 100 repositories'
    });

    // Denominator is 4 (r1, r2, r3, r7)
    expect(languages).toEqual([
      { name: 'JavaScript', count: 2, percentage: 50.0, color: '#f1e05a' },
      { name: 'Python', count: 1, percentage: 25.0, color: '#3572A5' },
      { name: 'TypeScript', count: 1, percentage: 25.0, color: '#3178c6' }
    ]);
  });

  it('caps analysis window at latest 100 repositories and displays top 5 languages only', () => {
    const sixLanguagesPlusExtra = [
      ...Array.from({ length: 30 }, (_, i) => ({ name: `ts-${i}`, fork: false, language: 'TypeScript' })),
      ...Array.from({ length: 25 }, (_, i) => ({ name: `js-${i}`, fork: false, language: 'JavaScript' })),
      ...Array.from({ length: 20 }, (_, i) => ({ name: `py-${i}`, fork: false, language: 'Python' })),
      ...Array.from({ length: 15 }, (_, i) => ({ name: `go-${i}`, fork: false, language: 'Go' })),
      ...Array.from({ length: 6 }, (_, i) => ({ name: `java-${i}`, fork: false, language: 'Java' })),
      ...Array.from({ length: 4 }, (_, i) => ({ name: `css-${i}`, fork: false, language: 'CSS' })),
      // Items past 100 should not be included if caller passes > 100
      ...Array.from({ length: 20 }, (_, i) => ({ name: `rb-${i}`, fork: false, language: 'Ruby' }))
    ];

    const { languages, meta } = analyzeRepositoryLanguages(sixLanguagesPlusExtra);

    expect(meta.fetched_repos).toBe(100);
    expect(meta.analyzed_repos).toBe(100);
    expect(languages).toHaveLength(5);
    expect(languages.map((l) => l.name)).toEqual(['TypeScript', 'JavaScript', 'Python', 'Go', 'Java']);
    expect(languages[0].percentage).toBe(30.0);
    expect(languages[4].percentage).toBe(6.0);
  });

  it('returns empty array when user has only forks, null languages, or zero repositories', () => {
    expect(calculateLanguageDistribution([])).toEqual([]);
    expect(calculateLanguageDistribution([{ fork: true, language: 'Go' }, { fork: false, language: null }])).toEqual([]);
  });

  it('caches language results with a 6-hour TTL', () => {
    expect(LANGUAGES_CACHE_TTL_MS).toBe(6 * 60 * 60 * 1000);
    languagesCache.set('Octocat', { languages: [{ name: 'HTML', count: 2, percentage: 100 }], meta: { cached: false } });
    expect(languagesCache.get('octocat')).not.toBeNull();
  });

  it('returns standard GitHub color hex codes with fallback', () => {
    expect(getLanguageColor('JavaScript')).toBe('#f1e05a');
    expect(getLanguageColor('TypeScript')).toBe('#3178c6');
    expect(getLanguageColor('UnknownLang123')).toBe('#8b949e');
  });
});

describe('GitHub Service — Single-Request Repo Fetch, Error Handling & Contributions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('makes exactly one request with sort=updated&per_page=100 even if Link header has next page', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      name: `repo-${i}`,
      fork: false,
      language: 'Go'
    }));

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ link: '<https://api.github.com/user/1/repos?page=2>; rel="next"' }),
      json: async () => page1
    });

    const result = await fetchUserRepositories('google');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestedUrl).toContain('/users/google/repos');
    expect(requestedUrl).toContain('sort=updated');
    expect(requestedUrl).toContain('per_page=100');
    expect(result.data).toHaveLength(100);
  });

  it('never retries a rate-limited (403 / 429) response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '60' })
    });

    await expect(fetchUserRepositories('torvalds')).rejects.toMatchObject({
      status: 429,
      name: 'RateLimitExceeded'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parses real contribution calendar cells, levels, tooltips, and yearly total from HTML', () => {
    const sampleHtml = `
      <h2>42 contributions in the last year</h2>
      <table>
        <tbody>
          <tr>
            <td id="day-0" data-date="2025-11-09" data-level="0" class="ContributionCalendar-day"></td>
            <td id="day-1" data-date="2025-11-10" data-level="3" class="ContributionCalendar-day"></td>
          </tr>
        </tbody>
      </table>
      <tool-tip for="day-0">No contributions on November 9.</tool-tip>
      <tool-tip for="day-1">7 contributions on November 10.</tool-tip>
    `;

    const parsed = parsePublicContributionsHtml(sampleHtml);
    expect(parsed).not.toBeNull();
    expect(parsed.total_in_year).toBe('42 contributions in the last year');
    expect(parsed.live).toBe(true);
    expect(parsed.weeks[0].contributionDays).toEqual([
      {
        date: '2025-11-09',
        weekday: 0,
        level: 0,
        count: 0,
        tooltip: 'No contributions on November 9.'
      },
      {
        date: '2025-11-10',
        weekday: 1,
        level: 3,
        count: 7,
        tooltip: '7 contributions on November 10.'
      }
    ]);
  });

  it('scopes parsed public contribution cells and summary to the requested calendar year (Jan–Dec)', () => {
    const sampleHtml = `
      <h2>15 contributions in 2026</h2>
      <table>
        <tbody>
          <tr>
            <td id="day-prev" data-date="2025-12-31" data-level="2" class="ContributionCalendar-day"></td>
            <td id="day-jan" data-date="2026-01-01" data-level="1" class="ContributionCalendar-day"></td>
            <td id="day-dec" data-date="2026-12-31" data-level="3" class="ContributionCalendar-day"></td>
          </tr>
        </tbody>
      </table>
      <tool-tip for="day-prev">4 contributions on December 31.</tool-tip>
      <tool-tip for="day-jan">2 contributions on January 1.</tool-tip>
      <tool-tip for="day-dec">13 contributions on December 31.</tool-tip>
    `;

    const parsed = parsePublicContributionsHtml(sampleHtml, { year: 2026 });
    expect(parsed).not.toBeNull();
    expect(parsed.total_in_year).toBe('15 contributions in 2026');
    expect(parsed.weeks).toHaveLength(1);
    expect(parsed.weeks[0].contributionDays.map((d) => d.date)).toEqual(['2026-01-01', '2026-12-31']);
  });

  it('scopes GraphQL contribution queries to currentYear Jan 1 – Dec 31 and filters prior-year days', async () => {
    const currentYear = new Date().getUTCFullYear();
    const prevYear = currentYear - 1;
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token';

    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: {
            user: {
              contributionsCollection: {
                contributionCalendar: {
                  totalContributions: 12,
                  weeks: [
                    {
                      contributionDays: [
                        {
                          date: `${prevYear}-12-28`,
                          weekday: 0,
                          contributionCount: 5,
                          contributionLevel: 'SECOND_QUARTILE'
                        },
                        {
                          date: `${currentYear}-01-01`,
                          weekday: 4,
                          contributionCount: 4,
                          contributionLevel: 'SECOND_QUARTILE'
                        },
                        {
                          date: `${currentYear}-12-31`,
                          weekday: 4,
                          contributionCount: 8,
                          contributionLevel: 'THIRD_QUARTILE'
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

      const result = await fetchUserContributions('dev');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('/graphql');
      const payload = JSON.parse(options.body);
      expect(payload.variables.from).toBe(`${currentYear}-01-01T00:00:00Z`);
      expect(payload.variables.to).toBe(`${currentYear}-12-31T23:59:59Z`);

      const allDates = result.weeks.flatMap((w) => w.contributionDays.map((d) => d.date));
      expect(allDates).toEqual([`${currentYear}-01-01`, `${currentYear}-12-31`]);
      expect(result.total_in_year).toBe(`12 contributions in ${currentYear}`);
    } finally {
      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
    }
  });

  it('scopes unauthenticated contributions fallback URL to currentYear Jan 1 – Dec 31 and strips prior-year days', async () => {
    const currentYear = new Date().getUTCFullYear();
    const prevYear = currentYear - 1;
    const originalToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    try {
      const sampleHtml = `
        <h2>9 contributions in ${currentYear}</h2>
        <table>
          <tbody>
            <tr>
              <td id="d-prev" data-date="${prevYear}-12-30" data-level="2" class="ContributionCalendar-day"></td>
              <td id="d-cur1" data-date="${currentYear}-01-05" data-level="1" class="ContributionCalendar-day"></td>
              <td id="d-cur2" data-date="${currentYear}-11-12" data-level="3" class="ContributionCalendar-day"></td>
            </tr>
          </tbody>
        </table>
        <tool-tip for="d-prev">3 contributions on December 30.</tool-tip>
        <tool-tip for="d-cur1">2 contributions on January 5.</tool-tip>
        <tool-tip for="d-cur2">7 contributions on November 12.</tool-tip>
      `;

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => sampleHtml
      });

      const result = await fetchUserContributions('dev');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestedUrl = String(fetchMock.mock.calls[0][0]);
      expect(requestedUrl).toContain(
        `/users/dev/contributions?from=${currentYear}-01-01&to=${currentYear}-12-31`
      );
      const allDates = result.weeks.flatMap((w) => w.contributionDays.map((d) => d.date));
      expect(allDates).toEqual([`${currentYear}-01-05`, `${currentYear}-11-12`]);
      expect(result.total_in_year).toBe(`9 contributions in ${currentYear}`);
    } finally {
      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
    }
  });

  it('handles tag-wrapped counts, singular 1 contribution, and zero-contribution current-year HTML', () => {
    const tagWrappedHtml = `
      <h2><span>1</span> contribution in 2026</h2>
      <table><tbody><tr>
        <td id="d1" data-date="2026-06-15" data-level="1" class="ContributionCalendar-day"></td>
      </tr></tbody></table>
      <tool-tip for="d1">1 contribution on June 15.</tool-tip>
    `;
    const singular = parsePublicContributionsHtml(tagWrappedHtml, { year: 2026 });
    expect(singular.total_in_year).toBe('1 contribution in 2026');
    expect(singular.total_contributions).toBe(1);

    const noContribHtml = `
      <h2>No contributions in 2026</h2>
      <table><tbody><tr>
        <td id="d0" data-date="2026-01-01" data-level="0" class="ContributionCalendar-day"></td>
      </tr></tbody></table>
      <tool-tip for="d0">No contributions on January 1.</tool-tip>
    `;
    const zeroParsed = parsePublicContributionsHtml(noContribHtml, { year: 2026 });
    expect(zeroParsed.total_in_year).toBe('0 contributions in 2026');
    expect(zeroParsed.total_contributions).toBe(0);
  });

  it('returns fresh dynamically updated contributions from getContributions without stale caching', async () => {
    const currentYear = new Date().getUTCFullYear();
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token';

    let mockCount = 546;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        data: {
          user: {
            contributionsCollection: {
              contributionCalendar: {
                totalContributions: mockCount,
                weeks: [
                  {
                    contributionDays: [
                      {
                        date: `${currentYear}-01-01`,
                        weekday: 4,
                        contributionCount: mockCount,
                        contributionLevel: 'THIRD_QUARTILE'
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      })
    }));

    try {
      const makeRes = () => {
        const headers = {};
        return {
          headers,
          statusCode: null,
          body: null,
          writableEnded: false,
          on: vi.fn(),
          off: vi.fn(),
          setHeader: (k, v) => {
            headers[k.toLowerCase()] = v;
          },
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(payload) {
            this.body = payload;
            this.writableEnded = true;
            return this;
          }
        };
      };

      const res1 = makeRes();
      await getContributions({ sanitizedUsername: 'shoaibkhan-sde' }, res1, vi.fn());
      expect(res1.statusCode).toBe(200);
      expect(res1.headers['cache-control']).toBe('no-store');
      expect(res1.headers['x-cache']).toBe('BYPASS');
      expect(res1.body.total_in_year).toBe(`546 contributions in ${currentYear}`);

      // Simulate user making a new contribution
      mockCount = 547;
      const res2 = makeRes();
      await getContributions({ sanitizedUsername: 'shoaibkhan-sde' }, res2, vi.fn());
      expect(res2.statusCode).toBe(200);
      expect(res2.body.total_in_year).toBe(`547 contributions in ${currentYear}`);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
    }
  });
});
