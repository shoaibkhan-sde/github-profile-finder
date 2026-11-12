import { getLanguageColor, formatNumber } from './utils.js';
import { getFilteredSortedExplorerItems } from './state.js?v=6';

/**
 * Validates URLs to allow only safe HTTP(S) protocols, preventing javascript:/data: XSS.
 * @param {string | null | undefined} rawUrl
 * @param {string} [fallback='#']
 * @returns {string}
 */
export function sanitizeHttpUrl(rawUrl, fallback = '#') {
  if (!rawUrl || typeof rawUrl !== 'string') return fallback;
  const trimmed = rawUrl.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    // Reject malformed or non-HTTP(S) URLs
  }
  return fallback;
}

/**
 * Updates the Starred tab badge count without re-rendering the entire profile card.
 * @param {number | null | undefined} count
 */
export function updateStarredTabBadge(count) {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return;
  const tabStarBadge = document.getElementById('tab-star-count');
  if (tabStarBadge) {
    tabStarBadge.textContent = formatNumber(count);
  }
}

/**
 * Creates an SVG icon element safely without unsafe HTML injection.
 */
function createSvgIcon(pathData, viewBox = '0 0 24 24', strokeWidth = 2, fill = 'none') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', fill);
  if (fill === 'none') {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', strokeWidth.toString());
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  svg.innerHTML = pathData;
  return svg;
}

/**
 * Announces text to screen readers via aria-live region.
 */
export function announce(message) {
  const el = document.getElementById('live-announcer');
  if (el) {
    el.textContent = message;
  }
}

/**
 * Synchronizes the results container with explicit UI state: 'idle' | 'loading' | 'success' | 'error'.
 */
export function syncUiState(uiState = 'idle') {
  const resultsSection = document.getElementById('profile-results');
  const emptyStateEl = document.getElementById('empty-state');
  const dashboardContainer = resultsSection?.querySelector('.dashboard-container');

  if (resultsSection) {
    resultsSection.dataset.uiState = uiState;
  }

  const isIdle = uiState === 'idle';
  if (emptyStateEl) {
    emptyStateEl.hidden = !isIdle;
  }
  if (dashboardContainer) {
    dashboardContainer.hidden = isIdle;
  }

  if (isIdle) {
    const profileContainer = document.getElementById('profile-card-container');
    const langContainer = document.getElementById('top-languages-container');
    const heatmapMonths = document.getElementById('heatmap-months');
    const heatmapGrid = document.getElementById('heatmap-grid');
    const contribSubtitle = document.getElementById('contrib-subtitle');
    const dashboardGrid = document.getElementById('dashboard-grid');
    const overviewRightPanel = document.getElementById('overview-right-panel');
    const explorerRightPanel = document.getElementById('explorer-right-panel');

    if (profileContainer) profileContainer.innerHTML = '';
    if (langContainer) langContainer.innerHTML = '';
    if (heatmapMonths) heatmapMonths.innerHTML = '';
    if (heatmapGrid) {
      heatmapGrid.innerHTML = '';
      heatmapGrid.classList.remove('is-empty');
      heatmapGrid.closest('.heatmap-container')?.classList.remove('is-empty');
    }
    if (contribSubtitle) contribSubtitle.textContent = '';
    if (dashboardGrid) dashboardGrid.dataset.activeTab = 'overview';
    if (overviewRightPanel) overviewRightPanel.hidden = false;
    if (explorerRightPanel) {
      explorerRightPanel.hidden = true;
      explorerRightPanel.innerHTML = '';
      delete explorerRightPanel.dataset.renderedTab;
    }
  }
}

/**
 * Synchronizes active dashboard tab UI across the left card tabs,
 * left Popular Repositories section, grid column weights, and right panel views
 * without destroying preserved DOM nodes (avatar or contributions heatmap).
 */
export function setDashboardActiveTab(activeTab = 'overview') {
  const safeTab = ['overview', 'repositories', 'stars'].includes(activeTab) ? activeTab : 'overview';
  const dashboardGrid = document.getElementById('dashboard-grid');
  const overviewRightPanel = document.getElementById('overview-right-panel');
  const explorerRightPanel = document.getElementById('explorer-right-panel');
  const overviewReposSection = document.getElementById('overview-repos-section');
  const profileContainer = document.getElementById('profile-card-container');

  if (dashboardGrid) {
    dashboardGrid.dataset.activeTab = safeTab;
  }

  if (profileContainer) {
    profileContainer.querySelectorAll('.tab-btn').forEach((btn) => {
      const isMatch = btn.dataset.tab === safeTab;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', String(isMatch));
    });
  }

  const isOverview = safeTab === 'overview';
  if (overviewReposSection) {
    overviewReposSection.hidden = !isOverview;
  }
  if (overviewRightPanel) {
    overviewRightPanel.hidden = !isOverview;
  }
  if (explorerRightPanel) {
    explorerRightPanel.hidden = isOverview;
  }
}

/**
 * Renders the single unified left-column card containing:
 * 1. Profile Header (Avatar, username, badge, name, bio, metadata, actions)
 * 2. 4 Colored Statistics Cards
 * 3. Navigation Tabs (Overview, Repositories, Stars)
 * 4. Popular Repositories Section (Top 3 on Overview tab only; full explorers use right column)
 */
export function renderProfileCard(user, repos = [], activeTab = 'overview', repoSort = 'stars') {
  const container = document.getElementById('profile-card-container');
  if (!container) return;

  container.innerHTML = '';

  const explorerRightPanel = document.getElementById('explorer-right-panel');
  if (explorerRightPanel) {
    explorerRightPanel.innerHTML = '';
    delete explorerRightPanel.dataset.renderedTab;
  }

  const card = document.createElement('div');
  card.className = 'card profile-unified-card fade-in';

  // ==========================================
  // 1. Profile Header
  // ==========================================
  const header = document.createElement('div');
  header.className = 'profile-header';

  // Avatar
  const avatarWrapper = document.createElement('div');
  avatarWrapper.className = 'avatar-wrapper';
  const img = document.createElement('img');
  img.className = 'avatar-img';
  img.src = sanitizeHttpUrl(user.avatar_url, '');
  img.alt = `${user.login}'s avatar`;
  img.width = 82;
  img.height = 82;
  img.loading = 'lazy';
  avatarWrapper.appendChild(img);
  header.appendChild(avatarWrapper);

  // Info
  const info = document.createElement('div');
  info.className = 'profile-info';

  // Headline Row: Username + Badge + Actions
  const headlineRow = document.createElement('div');
  headlineRow.className = 'profile-headline-row';

  const userGroup = document.createElement('div');
  userGroup.className = 'username-with-badge';
  const username = document.createElement('h1');
  username.className = 'username-heading';
  username.textContent = user.login;
  userGroup.appendChild(username);

  if (user.verified) {
    const badge = document.createElement('span');
    badge.className = 'verified-badge';
    badge.title = 'Verified account';
    badge.setAttribute('aria-label', 'Verified account');
    const checkSvg = createSvgIcon(
      '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>',
      '0 0 24 24',
      0,
      'currentColor'
    );
    badge.appendChild(checkSvg);
    userGroup.appendChild(badge);
  }
  headlineRow.appendChild(userGroup);

  // Actions: [↗] External GitHub Link
  const actions = document.createElement('div');
  actions.className = 'profile-actions';

  const extBtn = document.createElement('a');
  extBtn.href = sanitizeHttpUrl(user.html_url, '#');
  extBtn.target = '_blank';
  extBtn.rel = 'noopener noreferrer';
  extBtn.className = 'btn-icon-ext';
  extBtn.setAttribute('aria-label', `View ${user.login}'s profile on GitHub`);
  extBtn.title = 'View on GitHub';
  extBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
      <polyline points="15 3 21 3 21 9"></polyline>
      <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>
  `;
  actions.appendChild(extBtn);
  headlineRow.appendChild(actions);
  info.appendChild(headlineRow);

  // Name (The Octocat)
  if (user.name) {
    const fullName = document.createElement('div');
    fullName.className = 'profile-fullname';
    fullName.textContent = user.name;
    info.appendChild(fullName);
  }

  // Bio
  if (user.bio) {
    const bio = document.createElement('p');
    bio.className = 'profile-bio';
    bio.textContent = user.bio;
    info.appendChild(bio);
  }

  // Meta Row (Location, Blog/Website, Joined Date)
  const metaRow = document.createElement('div');
  metaRow.className = 'profile-meta-row';

  // Location
  if (user.location) {
    const locItem = document.createElement('span');
    locItem.className = 'profile-meta-item';
    const locSvg = createSvgIcon(
      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle>'
    );
    locSvg.setAttribute('width', '14');
    locSvg.setAttribute('height', '14');
    locItem.appendChild(locSvg);

    const locText = document.createElement('span');
    locText.textContent = user.location;
    locItem.appendChild(locText);
    metaRow.appendChild(locItem);
  }

  // Blog / Website
  if (user.blog) {
    const candidateBlogUrl = user.blog.startsWith('http://') || user.blog.startsWith('https://')
      ? user.blog
      : `https://${user.blog}`;
    const blogUrl = sanitizeHttpUrl(candidateBlogUrl, '');
    if (blogUrl) {
      const blogItem = document.createElement('span');
      blogItem.className = 'profile-meta-item';

      const linkSvg = createSvgIcon(
        '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>'
      );
      linkSvg.setAttribute('width', '14');
      linkSvg.setAttribute('height', '14');
      blogItem.appendChild(linkSvg);

      const blogLink = document.createElement('a');
      blogLink.href = blogUrl;
      blogLink.target = '_blank';
      blogLink.rel = 'noopener noreferrer';
      blogLink.className = 'profile-link';
      blogLink.textContent = user.blog;
      blogItem.appendChild(blogLink);
      metaRow.appendChild(blogItem);
    }
  }

  // Joined Date
  if (user.joined_date || user.created_at) {
    const joinedItem = document.createElement('span');
    joinedItem.className = 'profile-meta-item';

    const calSvg = createSvgIcon(
      '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>'
    );
    calSvg.setAttribute('width', '14');
    calSvg.setAttribute('height', '14');
    joinedItem.appendChild(calSvg);

    const joinedText = document.createElement('span');
    joinedText.textContent = user.joined_date || `Joined ${new Date(user.created_at).getFullYear()}`;
    joinedItem.appendChild(joinedText);
    metaRow.appendChild(joinedItem);
  }

  info.appendChild(metaRow);
  header.appendChild(info);
  card.appendChild(header);

  // ==========================================
  // 2. 4 Colored Statistics Cards
  // ==========================================
  const statsGrid = document.createElement('div');
  statsGrid.className = 'stats-grid';

  const statsConfigs = [
    {
      label: 'Followers',
      value: user.stats?.followers_formatted ?? String(user.stats?.followers ?? 0),
      cls: 'stat-card-followers',
      icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>'
    },
    {
      label: 'Following',
      value: user.stats?.following_formatted ?? String(user.stats?.following ?? 0),
      cls: 'stat-card-following',
      icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>'
    },
    {
      label: 'Public Repos',
      value: user.stats?.public_repos_formatted ?? String(user.stats?.public_repos ?? 0),
      cls: 'stat-card-repos',
      icon: '<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>'
    },
    {
      label: 'Total Repo Stars',
      tooltip: 'Combined stars received by your public repositories.',
      value: user.stats?.total_stars_formatted ?? String(user.stats?.total_stars ?? 0),
      cls: 'stat-card-stars',
      icon: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>'
    }
  ];

  statsConfigs.forEach((cfg) => {
    const item = document.createElement('div');
    item.className = `stat-card ${cfg.cls}`;

    const iconSvg = createSvgIcon(cfg.icon);
    iconSvg.setAttribute('class', 'stat-icon');
    item.appendChild(iconSvg);

    const content = document.createElement('div');
    content.className = 'stat-content';

    const val = document.createElement('span');
    val.className = 'stat-value';
    val.textContent = cfg.value;
    content.appendChild(val);

    const lbl = document.createElement('span');
    lbl.className = 'stat-label';
    lbl.textContent = cfg.label;

    if (cfg.tooltip) {
      const labelRow = document.createElement('span');
      labelRow.className = 'stat-label-row';
      labelRow.appendChild(lbl);

      const infoWrap = document.createElement('span');
      infoWrap.className = 'stat-info-wrap';

      const infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'stat-info-btn';
      infoBtn.setAttribute('aria-label', cfg.tooltip);
      infoBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
      `;

      const tooltipBubble = document.createElement('span');
      tooltipBubble.className = 'stat-tooltip';
      tooltipBubble.setAttribute('role', 'tooltip');
      tooltipBubble.textContent = cfg.tooltip;

      infoWrap.appendChild(infoBtn);
      infoWrap.appendChild(tooltipBubble);
      labelRow.appendChild(infoWrap);
      content.appendChild(labelRow);
    } else {
      content.appendChild(lbl);
    }

    item.appendChild(content);
    statsGrid.appendChild(item);
  });

  card.appendChild(statsGrid);

  // ==========================================
  // 3. Navigation Tabs (Inside Unified Card)
  // ==========================================
  const tabsNav = document.createElement('nav');
  tabsNav.className = 'tabs-nav';
  tabsNav.setAttribute('aria-label', 'Profile Sections Navigation');
  tabsNav.setAttribute('role', 'tablist');

  const reposCountText = user.stats?.public_repos_formatted ?? String(user.stats?.public_repos ?? repos.length);
  const rawStarredCount = typeof user.stats?.starred_count === 'number'
    ? user.stats.starred_count
    : (typeof user.starred_count === 'number' ? user.starred_count : null);
  const starredCountText = rawStarredCount !== null
    ? (user.stats?.starred_count_formatted ?? formatNumber(rawStarredCount))
    : '—';

  tabsNav.innerHTML = `
    <button class="tab-btn ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview" id="tab-overview" role="tab" aria-selected="${activeTab === 'overview'}">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
      </svg>
      <span>Overview</span>
    </button>
    <button class="tab-btn ${activeTab === 'repositories' ? 'active' : ''}" data-tab="repositories" id="tab-repositories" role="tab" aria-selected="${activeTab === 'repositories'}">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
      </svg>
      <span>Repositories</span>
      <span class="tab-badge" id="tab-repo-count">${reposCountText}</span>
    </button>
    <button class="tab-btn ${activeTab === 'stars' ? 'active' : ''}" data-tab="stars" id="tab-stars" role="tab" aria-selected="${activeTab === 'stars'}">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
      <span>Starred</span>
      <span class="tab-badge" id="tab-star-count">${starredCountText}</span>
    </button>
  `;
  card.appendChild(tabsNav);

  // ==========================================
  // 4. Popular Repositories Section (Overview Tab Only)
  // ==========================================
  const reposSection = document.createElement('section');
  reposSection.id = 'overview-repos-section';
  reposSection.className = 'repos-section';
  reposSection.setAttribute('aria-labelledby', 'repos-section-heading');
  reposSection.hidden = activeTab !== 'overview';

  const reposHeader = document.createElement('div');
  reposHeader.className = 'repos-header';
  reposHeader.innerHTML = `
    <h2 id="repos-section-heading" class="section-title">
      <span>🔥</span> Popular Repositories
    </h2>
    <button class="view-all-link" id="view-all-repos-btn" aria-label="View all repositories">
      <span>View All Repositories</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
      </svg>
    </button>
  `;
  reposSection.appendChild(reposHeader);

  const reposListContainer = document.createElement('div');
  reposListContainer.id = 'repos-list-container';
  reposListContainer.className = 'repo-list';
  reposSection.appendChild(reposListContainer);

  card.appendChild(reposSection);
  container.appendChild(card);

  // Render Popular Repositories (top 3) inside the Overview section and sync layout tab state
  renderRepositories(repos, 'overview', repoSort);
  setDashboardActiveTab(activeTab);
}

/**
 * Builds a single repository card element shared by Overview (top 3) and Right Explorer panels.
 * Shows repository owner (`owner / repo`) when `showOwner` is true (Stars tab), plus fork badge when forked.
 */
export function createRepoCardElement(repo, { showOwner = false } = {}) {
  const card = document.createElement('article');
  card.className = 'repo-card';

  const cardHeader = document.createElement('div');
  cardHeader.className = 'repo-card-header';

  const repoIcon = createSvgIcon(
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>'
  );
  repoIcon.setAttribute('class', 'repo-icon');
  cardHeader.appendChild(repoIcon);

  const link = document.createElement('a');
  link.href = sanitizeHttpUrl(repo.html_url, '#');
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'repo-title';

  if (showOwner && (repo.owner?.login || (repo.full_name && repo.full_name.includes('/')))) {
    const ownerLogin = repo.owner?.login || repo.full_name.split('/')[0];
    const ownerSpan = document.createElement('span');
    ownerSpan.className = 'repo-owner-name';
    ownerSpan.textContent = ownerLogin;
    const slashSpan = document.createElement('span');
    slashSpan.className = 'repo-owner-slash';
    slashSpan.textContent = ' / ';
    const repoNameSpan = document.createElement('span');
    repoNameSpan.className = 'repo-name-strong';
    repoNameSpan.textContent = repo.name || '';
    link.appendChild(ownerSpan);
    link.appendChild(slashSpan);
    link.appendChild(repoNameSpan);
  } else {
    link.textContent = repo.name || '';
  }

  cardHeader.appendChild(link);

  if (repo.fork) {
    const forkBadge = document.createElement('span');
    forkBadge.className = 'repo-fork-badge';
    forkBadge.textContent = 'Fork';
    cardHeader.appendChild(forkBadge);
  }

  card.appendChild(cardHeader);

  if (repo.description) {
    const desc = document.createElement('p');
    desc.className = 'repo-description';
    desc.textContent = repo.description;
    card.appendChild(desc);
  }

  const meta = document.createElement('div');
  meta.className = 'repo-card-meta';

  const metaLeft = document.createElement('div');
  metaLeft.className = 'repo-meta-left';

  const stars = document.createElement('span');
  stars.className = 'repo-meta-item';
  const starSvg = createSvgIcon(
    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>'
  );
  starSvg.setAttribute('width', '13');
  starSvg.setAttribute('height', '13');
  stars.appendChild(starSvg);
  const starsCountSpan = document.createElement('span');
  starsCountSpan.textContent = String(repo.stars_formatted ?? (repo.stars ?? repo.stargazers_count ?? 0));
  stars.appendChild(starsCountSpan);
  metaLeft.appendChild(stars);

  const forks = document.createElement('span');
  forks.className = 'repo-meta-item';
  const forkSvg = createSvgIcon(
    '<line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path>'
  );
  forkSvg.setAttribute('width', '13');
  forkSvg.setAttribute('height', '13');
  forks.appendChild(forkSvg);
  const forksCountSpan = document.createElement('span');
  forksCountSpan.textContent = String(repo.forks_formatted ?? (repo.forks ?? repo.forks_count ?? 0));
  forks.appendChild(forksCountSpan);
  metaLeft.appendChild(forks);

  if (repo.language) {
    const lang = document.createElement('span');
    lang.className = 'repo-meta-item';

    const dot = document.createElement('span');
    dot.className = 'language-dot';
    dot.style.backgroundColor = repo.language_color || getLanguageColor(repo.language);
    lang.appendChild(dot);

    const langName = document.createElement('span');
    langName.textContent = repo.language;
    lang.appendChild(langName);

    metaLeft.appendChild(lang);
  }

  meta.appendChild(metaLeft);

  if (repo.updated || repo.updated_at) {
    const updated = document.createElement('span');
    updated.className = 'repo-updated-text';
    updated.textContent = repo.updated || `Updated ${new Date(repo.updated_at).toLocaleDateString()}`;
    meta.appendChild(updated);
  }

  card.appendChild(meta);
  return card;
}

/**
 * Renders top-3 popular repositories inside the Overview section of the left unified card.
 * Full repository and starred explorers render inside the right-column panel.
 */
export function renderRepositories(repos = [], activeTab = 'overview', repoSort = 'stars') {
  const container = document.getElementById('repos-list-container');
  if (!container) return;

  container.innerHTML = '';

  if (!repos || repos.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'empty-repos-notice';
    emptyNotice.style.padding = '20px 0';
    emptyNotice.style.textAlign = 'center';
    emptyNotice.style.color = 'var(--color-slate-500)';
    emptyNotice.style.fontSize = '0.85rem';
    emptyNotice.textContent = 'No public repositories found for this account.';
    container.appendChild(emptyNotice);
    return;
  }

  const displayRepos = [...repos]
    .sort((a, b) => (b.stars || b.stargazers_count || 0) - (a.stars || a.stargazers_count || 0))
    .slice(0, 3);

  displayRepos.forEach((repo) => {
    container.appendChild(createRepoCardElement(repo, { showOwner: activeTab === 'stars' }));
  });
}

/**
 * Builds compact page number sequence with ellipsis (e.g. [1, 2, 3, 4, '...', 8]).
 */
export function buildPaginationSequence(current, total) {
  if (total <= 1) return [1];
  if (total <= 6) {
    return Array.from({ length: total }, (_, idx) => idx + 1);
  }
  if (current <= 3) {
    return [1, 2, 3, 4, '...', total];
  }
  if (current >= total - 2) {
    return [1, '...', total - 3, total - 2, total - 1, total];
  }
  return [1, '...', current - 1, current, current + 1, '...', total];
}

function getExplorerHeaderCountLabel(tab, tabState) {
  if (!tabState) return '0';
  if (tab === 'stars') {
    if (!tabState.initialized && tabState.totalKnownCount !== null) {
      return tabState.totalKnownCount.toLocaleString();
    }
    if (!tabState.hasMore) {
      return tabState.items.length.toLocaleString();
    }
    if (tabState.totalKnownCount !== null && tabState.totalKnownCount >= tabState.items.length) {
      return tabState.totalKnownCount.toLocaleString();
    }
    return `${tabState.items.length.toLocaleString()}+`;
  }

  const count = tabState.totalKnownCount ?? tabState.items.length;
  return count.toLocaleString();
}

function getExplorerFilterLabels(tab, tabState) {
  const loadedItems = Array.isArray(tabState?.items) ? tabState.items : [];
  const forksLoaded = loadedItems.filter((r) => Boolean(r.fork)).length;
  const allDisplay = getExplorerHeaderCountLabel(tab, tabState);
  const forksSuffix = tabState?.hasMore ? '+' : '';
  return {
    all: `All (${allDisplay})`,
    forks: `Forks (${forksLoaded}${forksSuffix})`
  };
}

export function getExplorerPaginationInfo(tabState) {
  const filtered = getFilteredSortedExplorerItems(tabState);
  const pageSize = tabState?.pageSize || 8;
  const filteredCount = filtered.length;
  const isUnfiltered = !tabState?.searchQuery?.trim() && tabState?.filter === 'all';
  const hasMore = Boolean(tabState?.hasMore);

  let totalDisplayPages;
  if (!hasMore) {
    totalDisplayPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  } else if (isUnfiltered) {
    // Full loaded pages (e.g. 12 from 100 items) plus 1 next-on-demand boundary page
    const fullLocalPages = Math.floor(filteredCount / pageSize);
    totalDisplayPages = Math.max(1, fullLocalPages + 1);
  } else {
    totalDisplayPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  }

  const safePage = Math.min(Math.max(1, tabState?.currentPage || 1), totalDisplayPages);
  const startIdx = (safePage - 1) * pageSize;
  const pageItems = filtered.slice(startIdx, startIdx + pageSize);

  return {
    filtered,
    filteredCount,
    pageSize,
    totalDisplayPages,
    currentPage: safePage,
    pageItems,
    isUnfiltered,
    hasMore
  };
}

/**
 * Ensures the Explorer card shell exists for the active explorer tab (`repositories` | `stars`)
 * without rebuilding the search input while typing, then updates the results and pagination.
 */
export function renderRightExplorerPanel(activeTab, tabState) {
  const panel = document.getElementById('explorer-right-panel');
  if (!panel || !tabState) return;

  const isStars = activeTab === 'stars';
  const existingCard = panel.querySelector('.explorer-card');

  if (!existingCard || panel.dataset.renderedTab !== activeTab) {
    panel.dataset.renderedTab = activeTab;
    const countLabel = getExplorerHeaderCountLabel(activeTab, tabState);
    const filterLabels = getExplorerFilterLabels(activeTab, tabState);
    const titleText = isStars ? `Starred Repositories (${countLabel})` : `Repositories (${countLabel})`;
    const titleIcon = isStars
      ? '<svg class="explorer-title-icon explorer-title-icon--star" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'
      : '<svg class="explorer-title-icon explorer-title-icon--folder" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"></path></svg>';

    panel.innerHTML = `
      <section class="card explorer-card fade-in" aria-labelledby="explorer-heading">
        <div class="explorer-header-row">
          <div class="explorer-title-group">
            ${titleIcon}
            <h2 id="explorer-heading" class="explorer-heading">${titleText}</h2>
          </div>
          <div class="explorer-search-wrapper">
            <svg class="explorer-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              id="explorer-search-input"
              class="explorer-search-input"
              type="search"
              placeholder="${isStars ? 'Search starred repositories...' : 'Search repositories...'}"
              aria-label="${isStars ? 'Search starred repositories' : 'Search repositories'}"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>

        <div class="explorer-controls-row">
          <div class="explorer-filter-group" role="group" aria-label="Filter repositories by type">
            <button type="button" class="explorer-filter-btn" data-filter="all">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
              <span data-filter-label="all">${filterLabels.all}</span>
            </button>
            <button type="button" class="explorer-filter-btn" data-filter="forks">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <line x1="6" y1="3" x2="6" y2="15"></line>
                <circle cx="18" cy="6" r="3"></circle>
                <circle cx="6" cy="18" r="3"></circle>
                <path d="M18 9a9 9 0 0 1-9 9"></path>
              </svg>
              <span data-filter-label="forks">${filterLabels.forks}</span>
            </button>
          </div>

          <div class="explorer-sort-wrap">
            <label for="explorer-sort-select" class="sr-only">Sort repositories</label>
            <select id="explorer-sort-select" class="explorer-sort-select" aria-label="Sort repositories">
              <option value="stars">Sort: Most Stars</option>
              <option value="updated">Sort: Recently Updated</option>
              <option value="name">Sort: Name A–Z</option>
            </select>
            <svg class="explorer-sort-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>

        <div id="explorer-list-container" class="explorer-repo-list"></div>
        <div id="explorer-pagination-container" class="explorer-footer"></div>
      </section>
    `;
  }

  updateExplorerControlsAndResults(activeTab, tabState);
}

/**
 * Updates only dynamic portions of the Explorer card (heading counts, filter active states,
 * search value when out of sync, sort value, repository list, and pagination bar).
 */
export function updateExplorerControlsAndResults(activeTab, tabState) {
  const panel = document.getElementById('explorer-right-panel');
  if (!panel || !tabState) return;

  const isStars = activeTab === 'stars';
  const headingEl = document.getElementById('explorer-heading');
  const countLabel = getExplorerHeaderCountLabel(activeTab, tabState);
  if (headingEl) {
    headingEl.textContent = isStars
      ? `Starred Repositories (${countLabel})`
      : `Repositories (${countLabel})`;
  }

  if (isStars && tabState.initialized) {
    if (!tabState.hasMore) {
      updateStarredTabBadge(tabState.items.length);
    } else if (typeof tabState.totalKnownCount === 'number') {
      updateStarredTabBadge(tabState.totalKnownCount);
    }
  }

  const filterLabels = getExplorerFilterLabels(activeTab, tabState);
  const filterGroup = panel.querySelector('.explorer-filter-group');
  if (filterGroup) {
    filterGroup.querySelectorAll('.explorer-filter-btn').forEach((btn) => {
      const f = btn.dataset.filter;
      btn.classList.toggle('active', f === tabState.filter);
      const labelSpan = btn.querySelector('[data-filter-label]');
      if (labelSpan && f && filterLabels[f]) {
        labelSpan.textContent = filterLabels[f];
      }
    });
  }

  const searchInput = document.getElementById('explorer-search-input');
  if (searchInput && document.activeElement !== searchInput && searchInput.value !== tabState.searchQuery) {
    searchInput.value = tabState.searchQuery;
  }

  const sortSelect = document.getElementById('explorer-sort-select');
  if (sortSelect && sortSelect.value !== tabState.sort) {
    sortSelect.value = tabState.sort;
  }

  const listContainer = document.getElementById('explorer-list-container');
  const footerContainer = document.getElementById('explorer-pagination-container');
  if (!listContainer || !footerContainer) return;

  listContainer.innerHTML = '';
  footerContainer.innerHTML = '';

  if (tabState.isLoading && tabState.items.length === 0) {
    for (let i = 0; i < 5; i += 1) {
      const skel = document.createElement('div');
      skel.className = 'skeleton skeleton-explorer-card';
      listContainer.appendChild(skel);
    }
    return;
  }

  if (tabState.error && tabState.items.length === 0) {
    const errBox = document.createElement('div');
    errBox.className = 'explorer-empty-state explorer-error-state';
    const isRate = tabState.error.status === 429 || tabState.error.status === 403;
    errBox.innerHTML = `
      <p class="explorer-empty-title">${isRate ? 'GitHub API Rate Limit Reached' : 'Unable to Load Repositories'}</p>
      <p class="explorer-empty-msg"></p>
      <button type="button" class="btn-retry explorer-retry-btn" data-action="retry-explorer">Try Again</button>
    `;
    errBox.querySelector('.explorer-empty-msg').textContent =
      tabState.error.message || 'An unexpected network error occurred.';
    listContainer.appendChild(errBox);
    return;
  }

  const info = getExplorerPaginationInfo(tabState);

  if (info.filteredCount === 0) {
    const emptyBox = document.createElement('div');
    emptyBox.className = 'explorer-empty-state';
    const msg = document.createElement('p');
    msg.className = 'explorer-empty-msg';

    if (tabState.items.length === 0) {
      msg.textContent = isStars
        ? 'No starred repositories found for this account.'
        : 'No public repositories found for this account.';
      emptyBox.appendChild(msg);
    } else {
      msg.textContent = tabState.hasMore
        ? `No matches in the first ${tabState.items.length} loaded repositories.`
        : 'No repositories match your current search or filter.';
      emptyBox.appendChild(msg);

      const actionsRow = document.createElement('div');
      actionsRow.className = 'explorer-empty-actions';

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'explorer-secondary-btn';
      resetBtn.dataset.action = 'reset-explorer-filters';
      resetBtn.textContent = 'Reset filters';
      actionsRow.appendChild(resetBtn);

      if (tabState.hasMore) {
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'explorer-secondary-btn';
        moreBtn.dataset.action = 'load-next-batch';
        moreBtn.textContent = tabState.isLoadingMore ? 'Loading...' : 'Load next 100';
        moreBtn.disabled = Boolean(tabState.isLoadingMore);
        actionsRow.appendChild(moreBtn);
      }

      emptyBox.appendChild(actionsRow);
    }

    listContainer.appendChild(emptyBox);
    return;
  }

  info.pageItems.forEach((repo) => {
    listContainer.appendChild(createRepoCardElement(repo, { showOwner: isStars }));
  });

  if (tabState.isLoadingMore) {
    const loadingBanner = document.createElement('div');
    loadingBanner.className = 'explorer-inline-status';
    loadingBanner.textContent = 'Loading next batch of repositories...';
    footerContainer.appendChild(loadingBanner);
  } else if (tabState.error && tabState.items.length > 0) {
    const errBanner = document.createElement('div');
    errBanner.className = 'explorer-inline-error';
    const errText = document.createElement('span');
    errText.textContent = tabState.error.message || 'Failed to load next page.';
    errBanner.appendChild(errText);
    const retryMoreBtn = document.createElement('button');
    retryMoreBtn.type = 'button';
    retryMoreBtn.className = 'explorer-secondary-btn';
    retryMoreBtn.dataset.action = 'retry-explorer';
    retryMoreBtn.textContent = 'Retry';
    errBanner.appendChild(retryMoreBtn);
    footerContainer.appendChild(errBanner);
  }

  if (tabState.hasMore && (tabState.searchQuery.trim() || tabState.filter !== 'all')) {
    const batchNotice = document.createElement('div');
    batchNotice.className = 'explorer-batch-notice';
    const batchText = document.createElement('span');
    batchText.textContent = `Showing matches in first ${tabState.items.length} loaded`;
    batchNotice.appendChild(batchText);

    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.type = 'button';
    loadMoreBtn.className = 'explorer-link-btn';
    loadMoreBtn.dataset.action = 'load-next-batch';
    loadMoreBtn.textContent = tabState.isLoadingMore ? 'Loading...' : 'Load next 100';
    loadMoreBtn.disabled = Boolean(tabState.isLoadingMore);
    batchNotice.appendChild(loadMoreBtn);
    footerContainer.appendChild(batchNotice);
  }

  if (info.totalDisplayPages > 1 || info.hasMore) {
    const nav = document.createElement('nav');
    nav.className = 'explorer-pagination';
    nav.setAttribute('aria-label', 'Repository pagination');

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'page-btn page-btn-nav';
    prevBtn.dataset.page = String(Math.max(1, info.currentPage - 1));
    prevBtn.disabled = info.currentPage <= 1 || Boolean(tabState.isLoadingMore);
    prevBtn.innerHTML = '&lsaquo; Previous';
    nav.appendChild(prevBtn);

    const sequence = buildPaginationSequence(info.currentPage, info.totalDisplayPages);
    sequence.forEach((entry) => {
      if (entry === '...') {
        const dots = document.createElement('span');
        dots.className = 'page-ellipsis';
        dots.setAttribute('aria-hidden', 'true');
        dots.textContent = '...';
        nav.appendChild(dots);
        return;
      }

      const pageBtn = document.createElement('button');
      pageBtn.type = 'button';
      pageBtn.className = `page-btn ${entry === info.currentPage ? 'active' : ''}`;
      pageBtn.dataset.page = String(entry);
      pageBtn.textContent = String(entry);
      pageBtn.disabled = Boolean(tabState.isLoadingMore);
      if (entry === info.currentPage) {
        pageBtn.setAttribute('aria-current', 'page');
      }
      nav.appendChild(pageBtn);
    });

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'page-btn page-btn-nav';
    nextBtn.dataset.page = String(info.currentPage + 1);
    const atFinalPage = info.currentPage >= info.totalDisplayPages && !info.hasMore;
    nextBtn.disabled = atFinalPage || Boolean(tabState.isLoadingMore);
    nextBtn.innerHTML = 'Next &rsaquo;';
    nav.appendChild(nextBtn);

    footerContainer.appendChild(nav);
  }
}

/**
 * Renders the Top Languages progress bars card without altering its visual styling.
 * Indicates clearly that counts reflect the latest up to 100 repositories by primary language (not byte-level).
 */
export function renderTopLanguages(languages = [], meta = null) {
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

  languages.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'language-item';
    if (typeof item.count === 'number' && meta && typeof meta.analyzed_repos === 'number') {
      row.title = `${item.name}: ${item.percentage.toFixed(1)}% (${item.count} of ${meta.analyzed_repos} repositories, primary language)`;
    } else {
      row.title = `${item.name}: ${item.percentage.toFixed(1)}% (primary repository language)`;
    }

    // Label with dot
    const label = document.createElement('div');
    label.className = 'language-label';

    const dot = document.createElement('span');
    dot.className = 'language-dot';
    dot.style.backgroundColor = item.color || getLanguageColor(item.name);
    label.appendChild(dot);

    const name = document.createElement('span');
    name.textContent = item.name;
    label.appendChild(name);
    row.appendChild(label);

    // Progress bar track & fill
    const track = document.createElement('div');
    track.className = 'progress-track';

    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${Math.min(100, Math.max(0, item.percentage))}%`;
    track.appendChild(fill);
    row.appendChild(track);

    // Percentage text
    const pct = document.createElement('div');
    pct.className = 'language-pct';
    pct.textContent = `${item.percentage.toFixed(1)}%`;
    row.appendChild(pct);

    container.appendChild(row);
  });

  if (methodEl) {
    methodEl.hidden = false;
  }
}

const SAMPLE_EMPTY_CALENDAR_USERS = new Set(['google', 'github', 'vercel']);

function buildEmptyYearCalendarWeeks(year) {
  const safeYear = Number.isInteger(year) && year > 1970 ? year : new Date().getUTCFullYear();
  const weeks = [];
  let currentWeek = [];
  const start = new Date(Date.UTC(safeYear, 0, 1));
  const end = new Date(Date.UTC(safeYear, 11, 31));

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const weekday = d.getUTCDay();
    if (weekday === 0 && currentWeek.length > 0) {
      weeks.push({ contributionDays: currentWeek });
      currentWeek = [];
    }
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const date = `${yyyy}-${mm}-${dd}`;
    currentWeek.push({
      date,
      weekday,
      count: 0,
      level: 0,
      tooltip: `0 contributions on ${date}`
    });
  }

  if (currentWeek.length > 0) {
    weeks.push({ contributionDays: currentWeek });
  }

  return weeks;
}

/**
 * Renders the real GitHub Contributions Calendar (~53 weeks x 7 days).
 * Never renders fabricated placeholder activity when live data is unavailable,
 * except for the 3 empty-state sample organization examples (google, github, vercel)
 * where a clean 0-contribution year grid keeps the sample experience consistent.
 */
export function renderContributions(contribData = {}, username = '') {
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const displayYear = Number(contribData?.year) || new Date().getUTCFullYear();
  const yearPrefix = `${displayYear}-`;
  const rawWeeks = Array.isArray(contribData?.weeks) ? contribData.weeks : [];
  let weeks = rawWeeks
    .map((week) => ({
      contributionDays: (Array.isArray(week?.contributionDays) ? week.contributionDays : []).filter(
        (day) => !day?.date || day.date.startsWith(yearPrefix)
      )
    }))
    .filter((week) => week.contributionDays.length > 0);

  const normalizedUsername = String(username || contribData?.username || '').trim().toLowerCase();
  const useSampleEmptyCalendar = weeks.length === 0 && SAMPLE_EMPTY_CALENDAR_USERS.has(normalizedUsername);
  if (useSampleEmptyCalendar) {
    weeks = buildEmptyYearCalendarWeeks(displayYear);
  }

  const subtitle = document.getElementById('contrib-subtitle');
  if (subtitle) {
    if (contribData?.total_in_year) {
      subtitle.textContent = contribData.total_in_year;
    } else if (typeof contribData?.total_contributions === 'number') {
      const n = contribData.total_contributions;
      subtitle.textContent = `${n.toLocaleString('en-US')} contribution${n === 1 ? '' : 's'} in ${displayYear}`;
    } else if (useSampleEmptyCalendar) {
      subtitle.textContent = `0 contributions in ${displayYear}`;
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
    grid.closest('.heatmap-container')?.classList.add('is-empty');
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'contrib-empty-msg';
    emptyMsg.textContent = contribData?.live === false
      ? 'Contribution calendar temporarily unavailable.'
      : `No contribution activity recorded in ${displayYear}.`;
    grid.appendChild(emptyMsg);
    return;
  }

  grid.classList.remove('is-empty');
  grid.closest('.heatmap-container')?.classList.remove('is-empty');
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

      // Avoid cramping labels when a partial starting week ends right before the next month
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

/**
 * Renders shimmering loading skeletons for all 3 dashboard cards while live data is in-flight.
 */
export function renderLoadingSkeleton() {
  const dashboardGrid = document.getElementById('dashboard-grid');
  const overviewRightPanel = document.getElementById('overview-right-panel');
  const explorerRightPanel = document.getElementById('explorer-right-panel');
  if (dashboardGrid) dashboardGrid.dataset.activeTab = 'overview';
  if (overviewRightPanel) overviewRightPanel.hidden = false;
  if (explorerRightPanel) {
    explorerRightPanel.hidden = true;
    explorerRightPanel.innerHTML = '';
    delete explorerRightPanel.dataset.renderedTab;
  }

  // 1. Profile unified card skeleton
  const profileContainer = document.getElementById('profile-card-container');
  if (profileContainer) {
    profileContainer.innerHTML = `
      <div class="card profile-unified-card" style="pointer-events: none;" aria-busy="true" aria-label="Loading profile data">
        <div class="profile-header">
          <div class="skeleton skeleton-circle"></div>
          <div class="profile-info" style="width: 100%;">
            <div class="skeleton skeleton-line" style="width: 180px; height: 24px; margin-bottom: 10px;"></div>
            <div class="skeleton skeleton-line" style="width: 240px; height: 16px; margin-bottom: 8px;"></div>
            <div class="skeleton skeleton-line" style="width: 80%; height: 14px; margin-bottom: 12px;"></div>
            <div class="skeleton skeleton-line" style="width: 60%; height: 14px;"></div>
          </div>
        </div>
        <div class="stats-grid" style="margin-top: 14px;">
          <div class="skeleton skeleton-stat-box"></div>
          <div class="skeleton skeleton-stat-box"></div>
          <div class="skeleton skeleton-stat-box"></div>
          <div class="skeleton skeleton-stat-box"></div>
        </div>
        <div style="margin-top: 18px;">
          <div class="skeleton skeleton-line" style="width: 140px; height: 20px; margin-bottom: 12px;"></div>
          <div class="skeleton skeleton-repo-card"></div>
          <div class="skeleton skeleton-repo-card"></div>
          <div class="skeleton skeleton-repo-card"></div>
        </div>
      </div>
    `;
  }

  // 2. Top Languages card skeleton
  const methodEl = document.getElementById('languages-methodology');
  if (methodEl) methodEl.hidden = true;
  const langContainer = document.getElementById('top-languages-container');
  if (langContainer) {
    langContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 14px; padding: 4px 0;">
        <div class="skeleton skeleton-line" style="height: 14px; width: 100%;"></div>
        <div class="skeleton skeleton-line" style="height: 14px; width: 100%;"></div>
        <div class="skeleton skeleton-line" style="height: 14px; width: 100%;"></div>
        <div class="skeleton skeleton-line" style="height: 14px; width: 100%;"></div>
      </div>
    `;
  }

  // 3. Contributions subtitle and heatmap skeleton
  const contribSubtitle = document.getElementById('contrib-subtitle');
  if (contribSubtitle) {
    contribSubtitle.innerHTML = '<span class="skeleton" style="display: inline-block; width: 160px; height: 14px; border-radius: 4px;"></span>';
  }
  const heatmapMonths = document.getElementById('heatmap-months');
  if (heatmapMonths) heatmapMonths.innerHTML = '';
  const heatmapGrid = document.getElementById('heatmap-grid');
  if (heatmapGrid) {
    heatmapGrid.classList.remove('is-empty');
    heatmapGrid.closest('.heatmap-container')?.classList.remove('is-empty');
    heatmapGrid.innerHTML = '<div class="skeleton heatmap-skeleton"></div>';
  }
}

/**
 * Renders an accessible, helpful Error State card when search fails or rate limit is reached.
 */
export function renderErrorState(error, onRetry) {
  const dashboardGrid = document.getElementById('dashboard-grid');
  const overviewRightPanel = document.getElementById('overview-right-panel');
  const explorerRightPanel = document.getElementById('explorer-right-panel');
  if (dashboardGrid) dashboardGrid.dataset.activeTab = 'overview';
  if (overviewRightPanel) overviewRightPanel.hidden = false;
  if (explorerRightPanel) {
    explorerRightPanel.hidden = true;
    explorerRightPanel.innerHTML = '';
    delete explorerRightPanel.dataset.renderedTab;
  }

  const profileContainer = document.getElementById('profile-card-container');
  if (!profileContainer) return;

  profileContainer.innerHTML = '';

  const isNotFound = error.status === 404;
  const isRateLimited = error.status === 429 || error.status === 403;
  const isNetworkError = error.error === 'NetworkError' || error.status === 0;

  let title = 'Unable to Load Profile';
  let message = error.message || 'An unexpected error occurred while fetching user data. Please try again.';
  let iconSvg = '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>';

  if (isNotFound) {
    title = 'User Not Found';
    message = 'We could not find a public GitHub user with that username. Please verify the spelling and try again.';
    iconSvg = '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="18" y1="8" x2="23" y2="13"></line><line x1="23" y1="8" x2="18" y2="13"></line>';
  } else if (isRateLimited) {
    title = 'GitHub API Rate Limit Exceeded';
    message = error.message || 'The public GitHub API rate limit has been reached. Please wait before searching again or configure a GITHUB_TOKEN.';
    iconSvg = '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>';
  } else if (isNetworkError) {
    title = 'Network Connection Error';
    message = error.message || 'Unable to reach the server. Please check your network connection and try again.';
  }

  const errorCard = document.createElement('div');
  errorCard.className = 'card profile-unified-card error-card fade-in';

  const iconWrapper = document.createElement('div');
  iconWrapper.className = 'error-icon-wrapper';
  iconWrapper.setAttribute('aria-hidden', 'true');
  const errSvg = createSvgIcon(iconSvg);
  errSvg.setAttribute('width', '28');
  errSvg.setAttribute('height', '28');
  iconWrapper.appendChild(errSvg);

  const titleEl = document.createElement('h2');
  titleEl.className = 'error-title';
  titleEl.textContent = title;

  const messageEl = document.createElement('p');
  messageEl.className = 'error-message';
  messageEl.textContent = message;

  errorCard.appendChild(iconWrapper);
  errorCard.appendChild(titleEl);
  errorCard.appendChild(messageEl);

  if (typeof onRetry === 'function') {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn-retry';
    retryBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/>
      </svg>
      <span>Try Again</span>
    `;
    retryBtn.addEventListener('click', onRetry);
    errorCard.appendChild(retryBtn);
  }

  profileContainer.appendChild(errorCard);

  // Clear secondary cards with friendly placeholders
  const methodEl = document.getElementById('languages-methodology');
  if (methodEl) methodEl.hidden = true;
  const langContainer = document.getElementById('top-languages-container');
  if (langContainer) {
    langContainer.innerHTML = '<p style="text-align: center; color: var(--color-slate-400); font-size: 0.8rem; padding: 10px 0;">No language data available.</p>';
  }

  const contribSubtitle = document.getElementById('contrib-subtitle');
  if (contribSubtitle) {
    contribSubtitle.textContent = 'Activity data unavailable';
  }
}

/**
 * Renders the search history dropdown chips below the search bar.
 */
export function renderHistoryDropdown(historyItems = [], onSelect, onClear, onRemove) {
  const dropdown = document.getElementById('history-dropdown');
  if (!dropdown) return;

  dropdown.innerHTML = '';

  if (!historyItems || historyItems.length === 0) {
    dropdown.style.display = 'none';
    return;
  }

  dropdown.style.display = 'block';

  // Dropdown Header: "Recent Searches" + "Clear All"
  const header = document.createElement('div');
  header.className = 'history-header';

  const title = document.createElement('span');
  title.textContent = 'Recent Searches';
  header.appendChild(title);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-clear-history';
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear All';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof onClear === 'function') onClear();
  });
  header.appendChild(clearBtn);
  dropdown.appendChild(header);

  // Chips List (single row: max 4 short usernames, fewer if long)
  const list = document.createElement('div');
  list.className = 'history-list';
  dropdown.appendChild(list);

  const maxVisibleChips = 4;
  const candidates = historyItems.slice(0, maxVisibleChips);

  for (let i = 0; i < candidates.length; i += 1) {
    const item = candidates[i];
    const chip = document.createElement('div');
    chip.className = 'history-chip';
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');

    // Clock icon
    const clockSvg = createSvgIcon(
      '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
      '0 0 24 24',
      2
    );
    clockSvg.setAttribute('width', '12');
    clockSvg.setAttribute('height', '12');
    chip.appendChild(clockSvg);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'history-chip-label';
    nameSpan.textContent = item;
    chip.appendChild(nameSpan);

    // Remove chip button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-chip';
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', `Remove ${item} from search history`);
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof onRemove === 'function') onRemove(item);
    });
    chip.appendChild(removeBtn);

    // Select action
    chip.addEventListener('click', () => {
      if (typeof onSelect === 'function') onSelect(item);
    });
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (typeof onSelect === 'function') onSelect(item);
      }
    });

    list.appendChild(chip);

    // Keep all visible recent usernames on a single line with proper right breathing room
    if (i > 0 && list.clientWidth > 0 && list.scrollWidth > list.clientWidth) {
      list.removeChild(chip);
      break;
    }
  }
}
