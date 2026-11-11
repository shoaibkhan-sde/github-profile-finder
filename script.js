/**
 * GitHub Profile Finder — Frontend Client Logic
 * Exact Visual Fidelity & Robust API / Fallback Integration
 */

const SESSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_SESSION_CACHE_ENTRIES = 50;
const sessionProfileCache = new Map();
let activeSearchController = null;
let activeSearchPromise = null;
let activeSearchUser = null;
let rateLimitedUntil = 0;

let currentProfile = null;
let activeTab = 'overview';
let uiState = 'idle'; // 'idle' | 'loading' | 'success' | 'error'

function setUiState(nextState) {
  uiState = nextState;
  const resultsEl = document.getElementById('profile-results');
  const emptyEl = document.getElementById('empty-state');
  const dashboardContainer = resultsEl ? resultsEl.querySelector('.dashboard-container') : null;
  if (resultsEl) resultsEl.dataset.uiState = nextState;
  const isIdle = nextState === 'idle';
  if (emptyEl) emptyEl.hidden = !isIdle;
  if (dashboardContainer) dashboardContainer.hidden = isIdle;

  if (isIdle) {
    currentProfile = null;
    const profileContainer = document.getElementById('profile-card-container');
    const langContainer = document.getElementById('top-languages-container');
    const heatmapGrid = document.getElementById('heatmap-grid');
    if (profileContainer) profileContainer.innerHTML = '';
    if (langContainer) langContainer.innerHTML = '';
    if (heatmapGrid) heatmapGrid.innerHTML = '';
  }
}

function updateStandaloneClearButton() {
  const input = document.getElementById('username');
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn && input) {
    clearBtn.hidden = input.value.trim().length === 0;
  }
}

function renderStandaloneError(message, username) {
  const profileContainer = document.getElementById('profile-card-container');
  if (!profileContainer) return;
  profileContainer.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card profile-unified-card standalone-state-card';
  const heading = document.createElement('h2');
  heading.textContent = 'Unable to Load Profile';
  heading.style.color = '#0F172A';
  heading.style.marginBottom = '6px';
  const desc = document.createElement('p');
  desc.textContent = message;
  desc.style.color = '#475569';
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'standalone-retry-btn';
  retryBtn.textContent = 'Try Again';
  retryBtn.addEventListener('click', () => performSearch(username));
  card.append(heading, desc, retryBtn);
  profileContainer.appendChild(card);
}

function renderStandaloneLoading(username) {
  const profileContainer = document.getElementById('profile-card-container');
  const langContainer = document.getElementById('top-languages-container');
  const contribSubtitle = document.getElementById('contrib-subtitle');
  const heatmapGrid = document.getElementById('heatmap-grid');
  if (profileContainer) {
    profileContainer.innerHTML = `<div class="card profile-unified-card standalone-state-card"><p style="color:#475569;">Loading profile for ${username}...</p></div>`;
  }
  if (langContainer) {
    langContainer.innerHTML = '<p style="color:#64748B;font-size:0.85rem;">Loading languages...</p>';
  }
  if (contribSubtitle) {
    contribSubtitle.textContent = 'Loading contributions...';
  }
  if (heatmapGrid) {
    heatmapGrid.innerHTML = '';
  }
}

// Helper: Format numbers (e.g. 8300 -> 8.3K)
function formatMetric(num) {
  if (num === null || num === undefined) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
}

// Helper: Format Joined Date (e.g. Jan 2011)
function formatJoinedDate(isoString) {
  if (!isoString) return 'Joined recently';
  const d = new Date(isoString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Joined ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Helper: Language Dot Colors
function getLanguageColor(lang) {
  const map = {
    javascript: '#f1e05a',
    typescript: '#3178c6',
    html: '#e34c26',
    css: '#563d7c',
    scss: '#c6538c',
    ruby: '#701516',
    python: '#3572A5',
    java: '#b07219',
    go: '#00ADD8',
    rust: '#dea584',
    php: '#4F5D95',
    'c++': '#f34b7d',
    c: '#555555',
    'c#': '#178600',
    shell: '#89e051',
    vue: '#41b883',
    svelte: '#ff3e00',
    kotlin: '#A97BFF',
    swift: '#F05138',
    dart: '#00B4AB',
    'jupyter notebook': '#DA5B0B',
    dockerfile: '#384d54',
    sql: '#e38c00'
  };
  return map[(lang || '').toLowerCase()] || '#8b949e';
}

// Render Unified Left Profile Card
function renderProfileCard(user, repos = [], tab = 'overview') {
  const container = document.getElementById('profile-card-container');
  if (!container) return;

  const totalStars = repos.reduce((acc, r) => acc + (r.stars || r.stargazers_count || 0), 0) || user.total_stars || 0;

  // Strict: Top 3 Popular Repos on Overview
  let displayRepos = [...repos];
  if (tab === 'overview') {
    displayRepos = displayRepos
      .sort((a, b) => (b.stars || b.stargazers_count || 0) - (a.stars || a.stargazers_count || 0))
      .slice(0, 3);
  } else if (tab === 'stars') {
    displayRepos = displayRepos
      .filter((r) => (r.stars || r.stargazers_count || 0) > 0)
      .sort((a, b) => (b.stars || b.stargazers_count || 0) - (a.stars || a.stargazers_count || 0));
  }

  container.innerHTML = `
    <div class="card profile-unified-card">
      <!-- 1. Profile Header -->
      <div class="profile-header">
        <div class="avatar-wrapper">
          <img class="avatar-img" src="${user.avatar_url || 'https://github.com/identicons/octocat.png'}" alt="${user.login}" />
        </div>
        <div class="profile-info">
          <div class="profile-headline-row">
            <div class="username-with-badge">
              <h2 class="username-heading">${user.login}</h2>
              ${user.verified !== false ? `
                <span class="verified-badge" title="Verified Account">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                </span>
              ` : ''}
            </div>
            <div class="profile-actions">
              <a href="${user.html_url || '#'}" target="_blank" rel="noopener noreferrer" class="btn-follow">
                <i data-lucide="user-plus"></i>
                <span>Follow</span>
              </a>
              <a href="${user.html_url || '#'}" target="_blank" rel="noopener noreferrer" class="btn-profile-link" title="Open GitHub Profile">
                <i data-lucide="external-link"></i>
              </a>
            </div>
          </div>

          ${user.name ? `<div class="display-name">${user.name}</div>` : ''}
          ${user.bio ? `<p class="profile-bio">${user.bio}</p>` : ''}

          <div class="profile-metadata-row">
            ${user.location ? `
              <div class="meta-item">
                <i data-lucide="map-pin"></i>
                <span>${user.location}</span>
              </div>
            ` : ''}
            ${user.blog ? `
              <div class="meta-item">
                <i data-lucide="link"></i>
                <a href="${user.blog.startsWith('http') ? user.blog : 'https://' + user.blog}" target="_blank" rel="noopener noreferrer">${user.blog.replace(/^https?:\/\//, '')}</a>
              </div>
            ` : ''}
            <div class="meta-item">
              <i data-lucide="calendar"></i>
              <span>${formatJoinedDate(user.created_at)}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Four Stats Cards -->
      <div class="stats-grid">
        <div class="stat-card stat-card-followers">
          <i data-lucide="users"></i>
          <div class="stat-content">
            <div class="stat-value">${formatMetric(user.followers)}</div>
            <div class="stat-label">Followers</div>
          </div>
        </div>

        <div class="stat-card stat-card-following">
          <i data-lucide="user-check"></i>
          <div class="stat-content">
            <div class="stat-value">${formatMetric(user.following)}</div>
            <div class="stat-label">Following</div>
          </div>
        </div>

        <div class="stat-card stat-card-repos">
          <i data-lucide="code-2"></i>
          <div class="stat-content">
            <div class="stat-value">${user.public_repos || repos.length || 0}</div>
            <div class="stat-label">Public Repos</div>
          </div>
        </div>

        <div class="stat-card stat-card-stars">
          <i data-lucide="star"></i>
          <div class="stat-content">
            <div class="stat-value">${formatMetric(totalStars)}</div>
            <div class="stat-label">Total Stars</div>
          </div>
        </div>
      </div>

      <!-- 3. Navigation Tabs -->
      <nav class="tabs-nav" aria-label="Profile Sections">
        <button class="tab-btn ${tab === 'overview' ? 'active' : ''}" data-tab="overview">
          <i data-lucide="layout-grid"></i>
          <span>Overview</span>
        </button>
        <button class="tab-btn ${tab === 'repositories' ? 'active' : ''}" data-tab="repositories">
          <i data-lucide="book-marked"></i>
          <span>Repositories</span>
          <span class="tab-badge">${user.public_repos || repos.length || 0}</span>
        </button>
        <button class="tab-btn ${tab === 'stars' ? 'active' : ''}" data-tab="stars">
          <i data-lucide="star"></i>
          <span>Stars</span>
          <span class="tab-badge">${formatMetric(totalStars)}</span>
        </button>
      </nav>

      <!-- 4. Repositories Section -->
      <div class="repos-section">
        <div class="repos-header">
          <h3 class="section-title">
            <i data-lucide="${tab === 'overview' ? 'flame' : 'book-marked'}"></i>
            <span>${tab === 'overview' ? 'Popular Repositories' : (tab === 'stars' ? 'Starred Repositories' : 'All Repositories')}</span>
          </h3>
          ${tab === 'overview' ? `
            <button class="view-all-link" id="view-all-repos-btn">
              <span>View All Repositories</span>
              <i data-lucide="arrow-right"></i>
            </button>
          ` : ''}
        </div>

        <div class="repo-list">
          ${displayRepos.map((repo) => `
            <article class="repo-card">
              <div class="repo-card-header">
                <i data-lucide="bookmark" class="repo-icon"></i>
                <a href="${repo.html_url}" target="_blank" rel="noopener noreferrer" class="repo-title">${repo.name}</a>
              </div>
              ${repo.description ? `<p class="repo-description">${repo.description}</p>` : ''}
              <div class="repo-card-meta">
                <div class="repo-meta-left">
                  <div class="meta-metric">
                    <i data-lucide="star"></i>
                    <span>${formatMetric(repo.stars || repo.stargazers_count || 0)}</span>
                  </div>
                  <div class="meta-metric">
                    <i data-lucide="git-fork"></i>
                    <span>${formatMetric(repo.forks || 0)}</span>
                  </div>
                  ${repo.language ? `
                    <div class="meta-metric">
                      <span class="language-dot" style="background-color: ${getLanguageColor(repo.language)}"></span>
                      <span>${repo.language}</span>
                    </div>
                  ` : ''}
                </div>
                <div class="repo-updated-text">Updated recently</div>
              </div>
            </article>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Attach tab click events
  container.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      activeTab = targetTab;
      renderProfileCard(currentProfile.user, currentProfile.repositories, activeTab);
      refreshLucide();
    });
  });

  const viewAllBtn = container.querySelector('#view-all-repos-btn');
  if (viewAllBtn) {
    viewAllBtn.addEventListener('click', () => {
      activeTab = 'repositories';
      renderProfileCard(currentProfile.user, currentProfile.repositories, activeTab);
      refreshLucide();
    });
  }

  refreshLucide();
}

// Render Top Languages
function renderTopLanguages(languages = [], meta = null) {
  const container = document.getElementById('top-languages-container');
  const captionEl = document.getElementById('languages-caption');
  const methodEl = document.getElementById('languages-methodology');
  if (!container) return;

  if (captionEl) {
    captionEl.textContent = 'Based on latest 100 repositories';
    if (meta && typeof meta.analyzed_repos === 'number') {
      captionEl.title = `Analyzed ${meta.analyzed_repos} non-fork repositories with detected primary languages out of ${meta.fetched_repos ?? meta.analyzed_repos} fetched (not byte-level percentages).`;
    } else {
      captionEl.removeAttribute('title');
    }
  }

  container.innerHTML = '';

  if (!languages || languages.length === 0) {
    if (methodEl) methodEl.hidden = true;
    const emptyNotice = document.createElement('p');
    emptyNotice.className = 'language-empty-msg';
    emptyNotice.textContent = 'No detected primary languages in latest repositories.';
    container.appendChild(emptyNotice);
    return;
  }

  languages.forEach((lang) => {
    const row = document.createElement('div');
    row.className = 'language-item';
    if (typeof lang.count === 'number' && meta && typeof meta.analyzed_repos === 'number') {
      row.title = `${lang.name}: ${lang.percentage.toFixed(1)}% (${lang.count} of ${meta.analyzed_repos} repositories, primary language)`;
    } else {
      row.title = `${lang.name}: ${lang.percentage.toFixed(1)}% (primary repository language)`;
    }

    const label = document.createElement('div');
    label.className = 'language-label';
    const dot = document.createElement('span');
    dot.className = 'language-dot';
    dot.style.backgroundColor = lang.color || getLanguageColor(lang.name);
    const nameSpan = document.createElement('span');
    nameSpan.textContent = lang.name;
    label.append(dot, nameSpan);

    const track = document.createElement('div');
    track.className = 'progress-track';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${Math.min(100, Math.max(0, lang.percentage))}%`;
    fill.style.backgroundColor = 'var(--blue)';
    track.appendChild(fill);

    const pct = document.createElement('div');
    pct.className = 'language-pct';
    pct.textContent = `${lang.percentage.toFixed(1)}%`;

    row.append(label, track, pct);
    container.appendChild(row);
  });

  if (methodEl) {
    methodEl.hidden = false;
  }
}

// Render Real Contributions Heatmap
function renderContributions(contrib = {}) {
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const displayYear = Number(contrib?.year) || new Date().getUTCFullYear();
  const yearPrefix = `${displayYear}-`;
  const rawWeeks = Array.isArray(contrib?.weeks) ? contrib.weeks : [];
  const weeks = rawWeeks
    .map((week) => ({
      contributionDays: (Array.isArray(week?.contributionDays) ? week.contributionDays : []).filter(
        (day) => !day?.date || day.date.startsWith(yearPrefix)
      )
    }))
    .filter((week) => week.contributionDays.length > 0);

  const subtitle = document.getElementById('contrib-subtitle');
  if (subtitle) {
    if (contrib?.total_in_year) {
      subtitle.textContent = contrib.total_in_year;
    } else if (typeof contrib?.total_contributions === 'number') {
      const n = contrib.total_contributions;
      subtitle.textContent = `${n.toLocaleString('en-US')} contribution${n === 1 ? '' : 's'} in ${displayYear}`;
    } else {
      subtitle.textContent = `Activity in ${displayYear}`;
    }
  }

  const monthsRow = document.getElementById('heatmap-months');
  const grid = document.getElementById('heatmap-grid');
  if (!grid) return;

  grid.innerHTML = '';
  if (monthsRow) {
    monthsRow.innerHTML = '';
  }

  if (weeks.length === 0) {
    grid.style.removeProperty('--heatmap-cols');
    grid.classList.add('is-empty');
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'contrib-empty-msg';
    emptyMsg.textContent = contrib?.live === false
      ? 'Contribution calendar temporarily unavailable.'
      : `No contribution activity recorded in ${displayYear}.`;
    grid.appendChild(emptyMsg);
    return;
  }

  grid.classList.remove('is-empty');
  const colCount = weeks.length;
  grid.style.setProperty('--heatmap-cols', String(colCount));

  if (monthsRow) {
    monthsRow.style.setProperty('--heatmap-cols', String(colCount));
    let lastPlacedCol = -4;
    let lastMonth = -1;

    weeks.forEach((week, weekIdx) => {
      const days = Array.isArray(week?.contributionDays) ? week.contributionDays : [];
      if (days.length === 0) return;

      const firstOfMonth = days.find((d) => d?.date && d.date.endsWith('-01'));
      const candidateDay = firstOfMonth || (weekIdx === 0 ? days.find((d) => d?.date) : null);
      if (!candidateDay?.date) return;

      const monthNum = Number(candidateDay.date.slice(5, 7)) - 1;
      if (Number.isNaN(monthNum) || monthNum < 0 || monthNum > 11 || monthNum === lastMonth) return;

      if (weekIdx - lastPlacedCol < 3) {
        if (lastPlacedCol === 0 && monthsRow.lastElementChild) {
          monthsRow.removeChild(monthsRow.lastElementChild);
        } else {
          return;
        }
      }

      const span = document.createElement('span');
      span.textContent = MONTH_NAMES[monthNum];
      span.style.gridColumnStart = String(weekIdx + 1);
      monthsRow.appendChild(span);

      lastPlacedCol = weekIdx;
      lastMonth = monthNum;
    });
  }

  weeks.forEach((week, weekIdx) => {
    const days = Array.isArray(week?.contributionDays) ? week.contributionDays : [];
    days.forEach((day, dayIdx) => {
      const weekday = typeof day?.weekday === 'number' && day.weekday >= 0 && day.weekday <= 6
        ? day.weekday
        : Math.min(6, dayIdx);

      const level = Math.min(4, Math.max(0, Number(day?.level) || 0));
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      cell.style.gridColumnStart = String(weekIdx + 1);
      cell.style.gridRowStart = String(weekday + 1);
      cell.setAttribute('data-level', String(level));

      const tooltip = day?.tooltip || (day?.date ? `${day.count ?? 0} contributions on ${day.date}` : '');
      if (tooltip) {
        cell.title = tooltip;
        cell.setAttribute('aria-label', tooltip);
      }

      grid.appendChild(cell);
    });
  });
}

// Helper: Analyze primary languages from the single latest-100 repo-list response (not byte-level)
function analyzePrimaryLanguages(repositories = []) {
  const windowRepos = Array.isArray(repositories) ? repositories.slice(0, 100) : [];
  const counts = {};
  let analyzedRepos = 0;
  let excludedForks = 0;
  let ignoredNullLanguage = 0;

  windowRepos.forEach((repo) => {
    if (!repo || typeof repo !== 'object') return;
    if (repo.fork === true) {
      excludedForks += 1;
      return;
    }
    const lang = typeof repo.language === 'string' ? repo.language.trim() : '';
    if (!lang) {
      ignoredNullLanguage += 1;
      return;
    }
    counts[lang] = (counts[lang] || 0) + 1;
    analyzedRepos += 1;
  });

  const meta = {
    method: 'primary_language',
    byte_level: false,
    window_limit: 100,
    fetched_repos: windowRepos.length,
    excluded_forks: excludedForks,
    ignored_null_language: ignoredNullLanguage,
    analyzed_repos: analyzedRepos,
    basis: 'Based on latest 100 repositories'
  };

  if (analyzedRepos === 0) {
    return { languages: [], meta };
  }

  const languages = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([name, count]) => ({
      name,
      count,
      percentage: Number(((count / analyzedRepos) * 100).toFixed(1)),
      color: getLanguageColor(name)
    }));

  return { languages, meta };
}

// Helper: Refresh Lucide Icons safely
function refreshLucide() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

async function fetchLiveStandaloneContributions(clean, signal) {
  try {
    const res = await fetch(`/api/contributions/${encodeURIComponent(clean)}`, {
      cache: 'no-store',
      signal
    });
    if (!res.ok) return null;
    const contrib = await res.json();
    return contrib && contrib.live ? contrib : null;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return null;
  }
}

// Search Logic
function performSearch(username) {
  const clean = (username || '').trim();
  const statusEl = document.getElementById('search-status');
  const methodEl = document.getElementById('languages-methodology');
  if (methodEl) methodEl.hidden = true;

  if (!clean) {
    if (activeSearchController) {
      activeSearchController.abort();
      activeSearchController = null;
      activeSearchPromise = null;
      activeSearchUser = null;
    }
    if (statusEl) statusEl.textContent = '';
    setUiState('idle');
    updateStandaloneClearButton();
    return Promise.resolve();
  }

  const cacheKey = clean.toLowerCase();

  // Deduplicate identical in-flight search
  if (activeSearchPromise && activeSearchUser === cacheKey) {
    return activeSearchPromise;
  }

  // Cancel any outdated search when username changes
  if (activeSearchController) {
    activeSearchController.abort();
  }
  const controller = new AbortController();
  activeSearchController = controller;
  activeSearchUser = cacheKey;

  if (sessionProfileCache.has(cacheKey)) {
    const cached = sessionProfileCache.get(cacheKey);
    if (Date.now() - cached.cachedAt < SESSION_CACHE_TTL_MS) {
      currentProfile = cached.profile;
      activeTab = 'overview';
      setUiState('success');
      renderProfileCard(currentProfile.user, currentProfile.repositories, activeTab);
      renderTopLanguages(currentProfile.top_languages, currentProfile.top_languages_meta);
      renderContributions(currentProfile.contributions);

      const refreshPromise = fetchLiveStandaloneContributions(clean, controller.signal)
        .then((freshContrib) => {
          if (freshContrib && activeSearchUser === cacheKey) {
            currentProfile = { ...currentProfile, contributions: freshContrib };
            sessionProfileCache.set(cacheKey, { profile: currentProfile, cachedAt: cached.cachedAt });
            renderContributions(currentProfile.contributions);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (activeSearchController === controller) {
            activeSearchController = null;
            activeSearchPromise = null;
            activeSearchUser = null;
          }
        });
      activeSearchPromise = refreshPromise;
      return refreshPromise;
    }
    sessionProfileCache.delete(cacheKey);
  }

  // Never repeatedly retry while GitHub rate limit cooldown is active
  if (Date.now() < rateLimitedUntil) {
    const waitSec = Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
    const rateMsg = `GitHub API rate limit reached. Please wait ~${waitSec}s before trying again.`;
    if (statusEl) statusEl.textContent = rateMsg;
    setUiState('error');
    renderStandaloneError(rateMsg, clean);
    if (activeSearchController === controller) {
      activeSearchController = null;
      activeSearchPromise = null;
      activeSearchUser = null;
    }
    return Promise.resolve();
  }

  if (statusEl) statusEl.textContent = '';
  setUiState('loading');
  renderStandaloneLoading(clean);
  updateStandaloneClearButton();

  const runPromise = (async () => {
    // Try Express backend API first
    let backendHttpFailure = null;
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(clean)}`, {
        cache: 'no-store',
        signal: controller.signal
      });
      if (res.ok) {
        const json = await res.json();
        let payload = json && json.user ? json : json?.data;
        if (payload) {
          if (res.headers.get('x-cache') === 'HIT') {
            const freshContrib = await fetchLiveStandaloneContributions(clean, controller.signal);
            if (freshContrib) {
              payload = { ...payload, contributions: freshContrib };
            }
          }
          const rawUser = payload.user || {};
          const normalizedUser = rawUser.stats
            ? {
                ...rawUser,
                followers: rawUser.followers ?? rawUser.stats.followers,
                following: rawUser.following ?? rawUser.stats.following,
                public_repos: rawUser.public_repos ?? rawUser.stats.public_repos,
                total_stars: rawUser.total_stars ?? rawUser.stats.total_stars
              }
            : rawUser;
          currentProfile = { ...payload, user: normalizedUser };
          if (sessionProfileCache.size >= MAX_SESSION_CACHE_ENTRIES) {
            const oldestKey = sessionProfileCache.keys().next().value;
            if (oldestKey !== undefined) sessionProfileCache.delete(oldestKey);
          }
          sessionProfileCache.set(cacheKey, { profile: currentProfile, cachedAt: Date.now() });
          activeTab = 'overview';
          setUiState('success');
          renderProfileCard(currentProfile.user, currentProfile.repositories, activeTab);
          renderTopLanguages(currentProfile.top_languages, currentProfile.top_languages_meta);
          renderContributions(currentProfile.contributions);
          return;
        }
      } else if ([400, 403, 404, 429].includes(res.status)) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 403 || res.status === 429) {
          const retrySec = Number(errJson?.retryAfter) || Number(res.headers.get('retry-after')) || 60;
          rateLimitedUntil = Date.now() + Math.min(Math.max(retrySec, 15), 3600) * 1000;
        }
        backendHttpFailure = errJson?.message || `Unable to load profile "${clean}" (HTTP ${res.status}).`;
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Backend API unreachable, fall through to direct public GitHub API
    }

    if (backendHttpFailure) {
      if (statusEl) statusEl.textContent = backendHttpFailure;
      setUiState('error');
      renderStandaloneError(backendHttpFailure, clean);
      return;
    }

    // Fallback: Direct GitHub API using a single per_page=100 repo-list request (no per-repo /languages calls)
    try {
      const [userRes, reposRes] = await Promise.all([
        fetch(`https://api.github.com/users/${encodeURIComponent(clean)}`, { signal: controller.signal }),
        fetch(
          `https://api.github.com/users/${encodeURIComponent(clean)}/repos?sort=updated&per_page=100`,
          { signal: controller.signal }
        )
      ]);

      if (!userRes.ok || !reposRes.ok) {
        const failedRes = !userRes.ok ? userRes : reposRes;
        if (failedRes.status === 403 || failedRes.status === 429) {
          const retrySec = Number(failedRes.headers.get('retry-after')) || 60;
          rateLimitedUntil = Date.now() + Math.min(Math.max(retrySec, 15), 3600) * 1000;
          const rateMsg = 'GitHub API rate limit exceeded. Please wait before searching again.';
          if (statusEl) statusEl.textContent = rateMsg;
          setUiState('error');
          renderStandaloneError(rateMsg, clean);
          return;
        }

        const errMsg = failedRes.status === 404
          ? `User "${clean}" not found on GitHub.`
          : `Unable to load GitHub profile "${clean}" (HTTP ${failedRes.status}).`;
        if (statusEl) statusEl.textContent = errMsg;
        setUiState('error');
        renderStandaloneError(errMsg, clean);
        return;
      }

      const [userData, reposJson] = await Promise.all([userRes.json(), reposRes.json()]);
      const latestRepos = Array.isArray(reposJson) ? reposJson : [];
      const langAnalysis = analyzePrimaryLanguages(latestRepos);

      currentProfile = {
        user: {
          login: userData.login,
          name: userData.name || userData.login,
          avatar_url: userData.avatar_url,
          bio: userData.bio,
          location: userData.location,
          blog: userData.blog,
          company: userData.company,
          created_at: userData.created_at,
          followers: userData.followers,
          following: userData.following,
          public_repos: userData.public_repos,
          total_stars: latestRepos.reduce((acc, r) => acc + (r.stargazers_count || 0), 0),
          verified: true,
          html_url: userData.html_url
        },
        repositories: latestRepos.map((r) => ({
          name: r.name,
          description: r.description,
          language: r.language,
          stars: r.stargazers_count,
          stargazers_count: r.stargazers_count,
          forks: r.forks_count,
          updated_at: r.updated_at,
          html_url: r.html_url
        })),
        top_languages: langAnalysis.languages,
        top_languages_meta: langAnalysis.meta,
        contributions: {
          live: false,
          total_in_year: 'Contribution graph requires the backend server',
          weeks: []
        }
      };

      if (sessionProfileCache.size >= MAX_SESSION_CACHE_ENTRIES) {
        const oldestKey = sessionProfileCache.keys().next().value;
        if (oldestKey !== undefined) sessionProfileCache.delete(oldestKey);
      }
      sessionProfileCache.set(cacheKey, { profile: currentProfile, cachedAt: Date.now() });

      activeTab = 'overview';
      setUiState('success');
      renderProfileCard(currentProfile.user, currentProfile.repositories, activeTab);
      renderTopLanguages(currentProfile.top_languages, currentProfile.top_languages_meta);
      renderContributions(currentProfile.contributions);
    } catch (e) {
      if (e.name === 'AbortError') return;
      const failMsg = 'Network error while fetching GitHub profile. Please check your connection and try again.';
      if (statusEl) statusEl.textContent = failMsg;
      setUiState('error');
      renderStandaloneError(failMsg, clean);
    } finally {
      if (activeSearchController === controller) {
        activeSearchController = null;
        activeSearchPromise = null;
        activeSearchUser = null;
      }
    }
  })();

  activeSearchPromise = runPromise;
  return runPromise;
}

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  // 1. Start cleanly in idle empty state
  setUiState('idle');
  updateStandaloneClearButton();

  // 2. Search Form
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('username');
  const clearBtn = document.getElementById('clear-search-btn');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = searchInput ? searchInput.value : '';
      performSearch(val);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      updateStandaloneClearButton();
      if (!searchInput.value.trim() && uiState !== 'idle') {
        const statusEl = document.getElementById('search-status');
        if (statusEl) statusEl.textContent = '';
        setUiState('idle');
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      const statusEl = document.getElementById('search-status');
      if (statusEl) statusEl.textContent = '';
      updateStandaloneClearButton();
      setUiState('idle');
      if (searchInput) searchInput.focus();
    });
  }

  const emptyStateEl = document.getElementById('empty-state');
  if (emptyStateEl) {
    emptyStateEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-example-user]');
      if (!btn) return;
      const example = btn.getAttribute('data-example-user');
      if (!example) return;
      if (searchInput) searchInput.value = example;
      updateStandaloneClearButton();
      performSearch(example);
    });
  }

  // 3. Theme Toggle
  const getSavedOrDefaultTheme = () => {
    try {
      const saved = localStorage.getItem('theme');
      return saved === 'light' || saved === 'dark' ? saved : 'dark';
    } catch {
      return 'dark';
    }
  };

  const renderThemeIcon = (theme) => {
    const iconName = theme === 'light' ? 'sun' : 'moon';
    const existingIcon = document.getElementById('theme-icon');
    if (!existingIcon) return;

    if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function' && typeof existingIcon.replaceWith === 'function') {
      const replacement = document.createElement('i');
      replacement.id = 'theme-icon';
      replacement.setAttribute('data-lucide', iconName);
      existingIcon.replaceWith(replacement);
      refreshLucide();
      return;
    }

    const svgPaths = iconName === 'sun'
      ? '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';

    existingIcon.setAttribute('data-lucide', iconName);
    if (String(existingIcon.tagName).toLowerCase() === 'svg') {
      existingIcon.innerHTML = svgPaths;
    } else {
      existingIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPaths}</svg>`;
    }
  };

  const applyTheme = (theme) => {
    const normalizedTheme = theme === 'light' ? 'light' : 'dark';
    const isDark = normalizedTheme === 'dark';

    document.documentElement.setAttribute('data-theme', normalizedTheme);
    if (document.body && document.body.classList) {
      document.body.classList.toggle('light', !isDark);
      document.body.classList.toggle('dark', isDark);
    }

    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
      const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
      themeBtn.setAttribute('aria-pressed', String(isDark));
      themeBtn.setAttribute('aria-label', label);
      themeBtn.setAttribute('title', label);
    }

    renderThemeIcon(normalizedTheme);

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', isDark ? '#0D1117' : '#FFFFFF');
    }

    try {
      localStorage.setItem('theme', normalizedTheme);
    } catch {
      // Ignore storage failures in restricted browsing contexts.
    }
  };

  applyTheme(getSavedOrDefaultTheme());
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle && !themeToggle.dataset.bound) {
    themeToggle.dataset.bound = 'true';
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      applyTheme(isDark ? 'light' : 'dark');
    });
  }

  refreshLucide();
});

