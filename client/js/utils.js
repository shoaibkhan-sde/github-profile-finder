/**
 * Formats numbers into compact representation (e.g. 8300 -> '8.3K', 1200000 -> '1.2M').
 */
export function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

/**
 * Standard GitHub language color mapping.
 */
export const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  HTML: '#e34c26',
  CSS: '#563d7c',
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
  Vue: '#41b883',
  Other: '#8b949e'
};

export function getLanguageColor(language) {
  return LANGUAGE_COLORS[language] || '#8b949e';
}

/**
 * Converts ISO date to "Joined Mon YYYY"
 */
export function formatJoinedDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const month = date.toLocaleString('default', { month: 'short' });
  const year = date.getFullYear();
  return `Joined ${month} ${year}`;
}

