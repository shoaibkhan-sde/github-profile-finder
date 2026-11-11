/**
 * Standard GitHub language color map.
 */
const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Sass: '#a53b70',
  Python: '#3572A5',
  Java: '#b07219',
  Ruby: '#701516',
  Go: '#00ADD8',
  Rust: '#dea584',
  PHP: '#4F5D95',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Shell: '#89e051',
  PowerShell: '#012456',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Astro: '#ff5a03',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  Dart: '#00B4AB',
  'Jupyter Notebook': '#DA5B0B',
  Dockerfile: '#384d54',
  Makefile: '#427819',
  SQL: '#e38c00',
  Lua: '#000080',
  Scala: '#c22d40',
  Elixir: '#6e4a7e',
  Haskell: '#5e5086',
  R: '#198CE7',
  'Objective-C': '#438eff',
  Other: '#8b949e'
};

const MAX_REPOS_WINDOW = 100;
const TOP_LANGUAGES_LIMIT = 5;

export function getLanguageColor(language) {
  return LANGUAGE_COLORS[language] || '#8b949e';
}

/**
 * Analyzes primary repository languages using the single repository-list response (`per_page=100`,
 * sorted by recently updated), excluding forks and null-language repositories.
 * Calculates percentages against repositories that have a detected primary language (not byte-level).
 *
 * @param {Array<Object>} repositories Up to the latest 100 repositories from GitHub's repo-list endpoint
 * @returns {{
 *   languages: Array<{name: string, count: number, percentage: number, color: string}>,
 *   meta: Object
 * }}
 */
export function analyzeRepositoryLanguages(repositories = []) {
  const windowRepos = Array.isArray(repositories) ? repositories.slice(0, MAX_REPOS_WINDOW) : [];
  const counts = Object.create(null);
  let analyzedRepos = 0;
  let excludedForks = 0;
  let ignoredNullLanguage = 0;

  for (const repo of windowRepos) {
    if (!repo || typeof repo !== 'object') continue;

    if (repo.fork === true) {
      excludedForks += 1;
      continue;
    }

    const lang = typeof repo.language === 'string' ? repo.language.trim() : '';
    if (!lang) {
      ignoredNullLanguage += 1;
      continue;
    }

    counts[lang] = (counts[lang] || 0) + 1;
    analyzedRepos += 1;
  }

  const meta = {
    method: 'primary_language',
    byte_level: false,
    window_limit: MAX_REPOS_WINDOW,
    fetched_repos: windowRepos.length,
    excluded_forks: excludedForks,
    ignored_null_language: ignoredNullLanguage,
    analyzed_repos: analyzedRepos,
    cached: false,
    basis: 'Based on latest 100 repositories',
    note: 'Counts primary repository language across up to the latest 100 non-fork repositories, not byte-level percentages.'
  };

  if (analyzedRepos === 0) {
    return { languages: [], meta };
  }

  const languages = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_LANGUAGES_LIMIT)
    .map(([name, count]) => ({
      name,
      count,
      percentage: Number(((count / analyzedRepos) * 100).toFixed(1)),
      color: getLanguageColor(name)
    }));

  return { languages, meta };
}

/**
 * Returns the top 5 most common primary languages for compatibility.
 *
 * @param {Array<Object>} repositories
 * @returns {Array<{name: string, count: number, percentage: number, color: string}>}
 */
export function calculateLanguageDistribution(repositories = []) {
  return analyzeRepositoryLanguages(repositories).languages;
}
