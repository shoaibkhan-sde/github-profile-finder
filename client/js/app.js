import {
  fetchProfile,
  fetchContributions,
  fetchTabRepositoriesPage,
  syncProfileStarredCount,
  abortExplorerRequests,
  ApiError
} from './api.js?v=7';
import {
  getSearchHistory,
  saveSearchHistory,
  removeSearchHistoryItem,
  clearSearchHistory
} from './history.js';
import { state } from './state.js?v=6';
import {
  renderProfileCard,
  renderTopLanguages,
  renderContributions,
  renderLoadingSkeleton,
  renderErrorState,
  renderHistoryDropdown,
  setDashboardActiveTab,
  renderRightExplorerPanel,
  updateExplorerControlsAndResults,
  updateStarredTabBadge,
  getExplorerPaginationInfo,
  syncUiState,
  announce
} from './dom.js?v=13';

let explorerSearchTimer = null;

function clearExplorerDebounce() {
  if (explorerSearchTimer) {
    clearTimeout(explorerSearchTimer);
    explorerSearchTimer = null;
  }
}

/**
 * Validates GitHub username format according to official rules:
 * - 1-39 alphanumeric characters or single hyphens
 * - Cannot start or end with a hyphen
 * - Cannot have consecutive hyphens
 */
function isValidUsername(username) {
  if (!username || typeof username !== 'string') return false;
  const trimmed = username.trim();
  if (trimmed.length < 1 || trimmed.length > 39) return false;
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(trimmed);
}

/**
 * Updates visibility of the search clear button based on current input value.
 */
function updateClearButtonVisibility() {
  const searchInput = document.getElementById('username') || document.getElementById('search-input');
  const clearBtn = document.getElementById('clear-search-btn');
  if (!clearBtn || !searchInput) return;

  const hasText = searchInput.value.trim().length > 0;
  clearBtn.hidden = !hasText;
}

/**
 * Transitions the UI cleanly back to the idle empty state.
 */
export function resetToIdle({ clearInput = false } = {}) {
  clearExplorerDebounce();
  abortExplorerRequests();

  const searchInput = document.getElementById('username') || document.getElementById('search-input');
  if (clearInput && searchInput) {
    searchInput.value = '';
  }
  updateClearButtonVisibility();

  const searchStatus = document.getElementById('search-status');
  if (searchStatus) {
    searchStatus.textContent = '';
  }

  hideHistoryDropdown();

  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('user')) {
      url.searchParams.delete('user');
      window.history.replaceState({}, '', url.toString());
    }
  } catch (e) {
    // Ignore URL errors in non-standard environments
  }

  state.setIdle();
  syncUiState('idle');
  announce('Search cleared. Showing empty state.');
}

/**
 * Searches for a GitHub username, manages loading/error states, updates history, and renders cards.
 *
 * @param {string} username
 * @param {{ forceRefresh?: boolean }} [options]
 */
export async function handleSearch(username, { forceRefresh = false } = {}) {
  clearExplorerDebounce();

  const cleanUsername = username?.trim();
  if (!cleanUsername) {
    resetToIdle();
    return;
  }

  // Validate format before making backend request
  if (!isValidUsername(cleanUsername)) {
    const validationError = new ApiError(
      `"${cleanUsername}" is not a valid GitHub username. GitHub usernames may only contain alphanumeric characters or single hyphens, and cannot start or end with a hyphen.`,
      400
    );
    state.setError(validationError);
    syncUiState('error');
    renderErrorState(validationError);
    const searchStatus = document.getElementById('search-status');
    if (searchStatus) {
      searchStatus.textContent = `"${cleanUsername}" is not a valid GitHub username.`;
    }
    announce(`Validation error: ${validationError.message}`);
    return;
  }

  const searchStatus = document.getElementById('search-status');
  if (searchStatus) {
    searchStatus.textContent = '';
  }

  // Close history dropdown
  hideHistoryDropdown();

  // Update input text
  const searchInput = document.getElementById('username') || document.getElementById('search-input');
  if (searchInput && searchInput.value !== cleanUsername) {
    searchInput.value = cleanUsername;
  }
  updateClearButtonVisibility();

  state.setLoading(true);
  syncUiState('loading');
  renderLoadingSkeleton();
  announce(`Searching GitHub for ${cleanUsername}...`);

  try {
    const response = await fetchProfile(cleanUsername, { forceRefresh });
    const profileData = response.data;

    // Save successful query to recent history
    saveSearchHistory(cleanUsername);

    // Update central state
    state.setData(profileData);
    syncUiState('success');

    // Render unified left card and right column cards
    renderProfileCard(state.currentData.user, state.currentData.repositories, state.activeTab, state.repoSort);
    renderTopLanguages(state.currentData.top_languages, state.currentData.top_languages_meta);
    renderContributions(state.currentData.contributions, state.currentData?.user?.login);
    window.__ghFinderLastContribSync = Date.now();

    // Self-heal missing starred count immediately in background without waiting for a tab click
    const initialStarredCount = state.currentData.user?.stats?.starred_count ?? state.currentData.user?.starred_count;
    if (typeof initialStarredCount !== 'number') {
      void prefetchStarredFirstPage(state.currentData.user?.login || cleanUsername);
    }

    announce(`Profile for ${cleanUsername} loaded successfully.`);
  } catch (err) {
    if (err.name === 'AbortError') {
      // Newer query superseded this one, ignore
      return;
    }

    state.setError(err);
    syncUiState('error');
    renderErrorState(err, () => handleSearch(cleanUsername, { forceRefresh: true }));
    announce(`Error loading profile: ${err.message}`);
  }
}

/**
 * Hides the history dropdown.
 */
function hideHistoryDropdown() {
  const dropdown = document.getElementById('history-dropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
  }
}

/**
 * Shows the search history dropdown populated with recent searches.
 */
function showHistoryDropdown() {
  const items = getSearchHistory();
  renderHistoryDropdown(
    items,
    (selectedUser) => {
      handleSearch(selectedUser);
    },
    () => {
      clearSearchHistory();
      hideHistoryDropdown();
    },
    (userToRemove) => {
      removeSearchHistoryItem(userToRemove);
      showHistoryDropdown();
    }
  );
}

/**
 * Silently preloads page 1 of Starred repositories (max 100) to resolve
 * missing starred counts immediately or warm the Starred tab before click.
 * @param {string} username
 */
async function prefetchStarredFirstPage(username) {
  if (!username) return;
  const tabState = state.getExplorerState('stars');
  if (!tabState || tabState.initialized || tabState.isLoading) return;

  try {
    const payload = await fetchTabRepositoriesPage(username, 'starred', 1);
    if (state.currentData?.user?.login?.toLowerCase() !== username.toLowerCase()) {
      return;
    }
    if (tabState.initialized) return;

    state.appendExplorerApiPage('stars', payload);
    const resolvedTotal = typeof payload.total_count === 'number'
      ? payload.total_count
      : (typeof tabState.totalKnownCount === 'number'
        ? tabState.totalKnownCount
        : (!tabState.hasMore ? tabState.items.length : null));
    if (typeof resolvedTotal === 'number') {
      syncProfileStarredCount(username, resolvedTotal);
      updateStarredTabBadge(resolvedTotal);
    }
    if (state.activeTab === 'stars') {
      renderRightExplorerPanel('stars', tabState);
    }
  } catch {
    // Keep silent on background self-heal/warmup; clicking Starred surfaces explicit errors.
  }
}

/**
 * Fetches one on-demand API page (per_page=100) for Repositories or Stars explorer tabs.
 * @param {'repositories' | 'stars'} tabName
 * @param {number | null} [targetUiPage=null]
 */
async function loadExplorerApiPage(tabName, targetUiPage = null) {
  const username = state.currentData?.user?.login;
  const tabState = state.getExplorerState(tabName);
  if (!username || !tabState || tabState.isLoadingMore) return;
  if (tabState.isLoading && tabState.initialized) return;

  const kind = tabName === 'stars' ? 'starred' : 'repos';
  const apiPageToFetch = tabState.initialized ? tabState.nextApiPage : 1;
  if (!apiPageToFetch) return;

  const isLoadMore = tabState.initialized && tabState.items.length > 0;
  state.setExplorerTabLoading(tabName, true, { isLoadMore });

  if (state.activeTab === tabName) {
    renderRightExplorerPanel(tabName, tabState);
  }

  try {
    const payload = await fetchTabRepositoriesPage(username, kind, apiPageToFetch);
    if (state.currentData?.user?.login?.toLowerCase() !== username.toLowerCase()) {
      return;
    }

    state.appendExplorerApiPage(tabName, payload);
    if (tabName === 'stars') {
      const resolvedTotal = typeof tabState.totalKnownCount === 'number'
        ? tabState.totalKnownCount
        : (!tabState.hasMore ? tabState.items.length : null);
      if (typeof resolvedTotal === 'number') {
        syncProfileStarredCount(username, resolvedTotal);
      }
    }
    if (targetUiPage !== null) {
      state.setExplorerPage(tabName, targetUiPage);
    }

    if (state.activeTab === tabName) {
      renderRightExplorerPanel(tabName, tabState);
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      state.setExplorerTabLoading(tabName, false, { isLoadMore });
      return;
    }
    if (state.currentData?.user?.login?.toLowerCase() !== username.toLowerCase()) {
      return;
    }
    state.setExplorerTabError(tabName, err);
    if (state.activeTab === tabName) {
      updateExplorerControlsAndResults(tabName, tabState);
    }
  }
}

/**
 * Switches between Overview, Repositories, and Stars tabs while preserving
 * cached data and DOM elements (including Top Languages and Contributions heatmap).
 * @param {'overview' | 'repositories' | 'stars'} tabName
 */
export function switchTab(tabName) {
  if (!state.currentData || !tabName) return;
  if (!['overview', 'repositories', 'stars'].includes(tabName)) return;
  if (tabName === state.activeTab) return;

  clearExplorerDebounce();
  state.setActiveTab(tabName);
  setDashboardActiveTab(tabName);

  if (tabName === 'overview') {
    return;
  }

  const tabState = state.getExplorerState(tabName);
  renderRightExplorerPanel(tabName, tabState);

  if (!tabState.initialized && !tabState.isLoading) {
    loadExplorerApiPage(tabName, 1);
  }
}

/**
 * Binds all interactive controls: search form, tabs, sorting, keyboard, and theme toggle.
 */
const THEME_ICON_MARKUP = {
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>',
  sun: '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>',
};

function getSavedOrDefaultTheme() {
  try {
    const saved = localStorage.getItem('theme');
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  } catch {
    return 'dark';
  }
}

function renderThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  if (!icon) return;
  icon.innerHTML = theme === 'light' ? THEME_ICON_MARKUP.sun : THEME_ICON_MARKUP.moon;
}

function applyTheme(theme) {
  const normalizedTheme = theme === 'light' ? 'light' : 'dark';
  const isDark = normalizedTheme === 'dark';

  document.documentElement.setAttribute('data-theme', normalizedTheme);
  if (document.body?.classList) {
    document.body.classList.toggle('light', !isDark);
    document.body.classList.toggle('dark', isDark);
  }

  const themeBtn = document.getElementById('theme-toggle') || document.getElementById('theme-toggle-btn');
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
}

const DESKTOP_SEARCH_PLACEHOLDER = 'Enter a GitHub username (e.g. octocat)';
const MOBILE_SEARCH_PLACEHOLDER = 'Enter a GitHub username';

function syncResponsiveSearchPlaceholder(searchInput) {
  if (!searchInput) return;
  const isCompact = window.matchMedia?.('(max-width: 480px)')?.matches ?? false;
  searchInput.placeholder = isCompact ? MOBILE_SEARCH_PLACEHOLDER : DESKTOP_SEARCH_PLACEHOLDER;
}

function initEventListeners() {
  // 1. Theme Toggle
  applyTheme(getSavedOrDefaultTheme());
  const themeBtn = document.getElementById('theme-toggle') || document.getElementById('theme-toggle-btn');
  if (themeBtn && !themeBtn.dataset.bound) {
    themeBtn.dataset.bound = 'true';
    themeBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      applyTheme(isDark ? 'light' : 'dark');
    });
  }

  // 2. Search Form & Input
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('username') || document.getElementById('search-input');

  if (searchInput && !searchInput.dataset.placeholderBound) {
    searchInput.dataset.placeholderBound = 'true';
    syncResponsiveSearchPlaceholder(searchInput);
    const compactMq = window.matchMedia?.('(max-width: 480px)');
    compactMq?.addEventListener?.('change', () => syncResponsiveSearchPlaceholder(searchInput));
  }

  if (searchForm && !searchForm.dataset.bound) {
    searchForm.dataset.bound = 'true';
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = searchInput?.value || '';
      handleSearch(val);
    });
  }

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = 'true';
    // Show history on input focus or click
    searchInput.addEventListener('focus', () => {
      showHistoryDropdown();
    });
    searchInput.addEventListener('click', (e) => {
      e.stopPropagation();
      showHistoryDropdown();
    });
    // Return to idle when the user clears the current search text
    searchInput.addEventListener('input', () => {
      updateClearButtonVisibility();
      if (!searchInput.value.trim() && state.uiState !== 'idle') {
        resetToIdle();
      }
    });
  }

  const clearSearchBtn = document.getElementById('clear-search-btn');
  if (clearSearchBtn && !clearSearchBtn.dataset.bound) {
    clearSearchBtn.dataset.bound = 'true';
    clearSearchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetToIdle({ clearInput: true });
      searchInput?.focus();
    });
  }

  // Example username buttons in empty state
  const emptyStateEl = document.getElementById('empty-state');
  if (emptyStateEl && !emptyStateEl.dataset.bound) {
    emptyStateEl.dataset.bound = 'true';
    emptyStateEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-example-user]');
      if (!btn) return;
      const exampleUser = btn.getAttribute('data-example-user');
      if (!exampleUser) return;
      if (searchInput) {
        searchInput.value = exampleUser;
      }
      updateClearButtonVisibility();
      handleSearch(exampleUser);
    });
  }

  // Hide history dropdown on clicks outside
  document.addEventListener('click', (e) => {
    const searchContainer = document.querySelector('.search-container-relative');
    if (searchContainer && !searchContainer.contains(e.target)) {
      hideHistoryDropdown();
    }
  });

  // Refit recent search chips on viewport resize while dropdown is open
  if (!window.__ghFinderResizeBound) {
    window.__ghFinderResizeBound = true;
    window.addEventListener('resize', () => {
      const dropdown = document.getElementById('history-dropdown');
      if (dropdown && dropdown.style.display === 'block') {
        showHistoryDropdown();
      }
    });
  }

  // Refresh live current-year contributions when returning to tab after making commits on GitHub
  if (!window.__ghFinderVisibilityBound) {
    window.__ghFinderVisibilityBound = true;
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden || state.uiState !== 'success') return;
      const login = state.currentData?.user?.login;
      if (!login) return;
      const lastSync = window.__ghFinderLastContribSync || 0;
      if (Date.now() - lastSync < 15000) return;
      window.__ghFinderLastContribSync = Date.now();
      try {
        const freshContrib = await fetchContributions(login);
        if (
          freshContrib &&
          state.uiState === 'success' &&
          state.currentData?.user?.login?.toLowerCase() === login.toLowerCase()
        ) {
          state.currentData.contributions = freshContrib;
          renderContributions(freshContrib, login);
        }
      } catch (err) {
        // Ignore abort / transient background refresh failures
      }
    });
  }

  // 3. Delegated Events on Profile Container (Tabs, Hover Warmup & View All Repos)
  const profileContainer = document.getElementById('profile-card-container');
  if (profileContainer && !profileContainer.dataset.delegationBound) {
    profileContainer.dataset.delegationBound = 'true';

    const handleStarsTabWarmup = (e) => {
      if (!state.currentData) return;
      const starTab = e.target.closest('#tab-stars');
      if (!starTab) return;
      const starState = state.getExplorerState('stars');
      if (!starState || starState.initialized || starState.isLoading || starState.error) return;
      void prefetchStarredFirstPage(state.currentData.user?.login);
    };

    profileContainer.addEventListener('mouseover', handleStarsTabWarmup);
    profileContainer.addEventListener('focusin', handleStarsTabWarmup);

    profileContainer.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.tab-btn');
      if (tabBtn && state.currentData) {
        switchTab(tabBtn.dataset.tab);
        return;
      }

      const viewAllBtn = e.target.closest('#view-all-repos-btn');
      if (viewAllBtn && state.currentData) {
        switchTab('repositories');
      }
    });
  }

  // 4. Delegated Events on Right Explorer Panel (Search, Filters, Sort, Pagination, Retry)
  const explorerPanel = document.getElementById('explorer-right-panel');
  if (explorerPanel && !explorerPanel.dataset.delegationBound) {
    explorerPanel.dataset.delegationBound = 'true';

    const applySearchValue = (value, immediate = false) => {
      const tabName = state.activeTab;
      if (tabName !== 'repositories' && tabName !== 'stars') return;
      clearExplorerDebounce();

      const runUpdate = () => {
        if (!state.currentData || state.activeTab !== tabName) return;
        const tabState = state.getExplorerState(tabName);
        if (!tabState) return;
        state.setExplorerSearch(tabName, value);
        updateExplorerControlsAndResults(tabName, tabState);
      };

      if (immediate) {
        runUpdate();
      } else {
        explorerSearchTimer = setTimeout(runUpdate, 220);
      }
    };

    explorerPanel.addEventListener('input', (e) => {
      if (e.target.id === 'explorer-search-input') {
        applySearchValue(e.target.value, false);
      }
    });

    explorerPanel.addEventListener('search', (e) => {
      if (e.target.id === 'explorer-search-input') {
        applySearchValue(e.target.value, true);
      }
    });

    explorerPanel.addEventListener('change', (e) => {
      if (e.target.id === 'explorer-sort-select') {
        const tabName = state.activeTab;
        const tabState = state.getExplorerState(tabName);
        if (!tabState) return;
        state.setExplorerSort(tabName, e.target.value);
        updateExplorerControlsAndResults(tabName, tabState);
      }
    });

    explorerPanel.addEventListener('click', (e) => {
      if (!state.currentData) return;
      const tabName = state.activeTab;
      const tabState = state.getExplorerState(tabName);
      if (!tabState) return;

      const filterBtn = e.target.closest('.explorer-filter-btn');
      if (filterBtn) {
        const nextFilter = filterBtn.dataset.filter;
        if (nextFilter && nextFilter !== tabState.filter) {
          state.setExplorerFilter(tabName, nextFilter);
          updateExplorerControlsAndResults(tabName, tabState);
        }
        return;
      }

      const pageBtn = e.target.closest('.page-btn[data-page]');
      if (pageBtn && !pageBtn.disabled) {
        const requestedPage = Math.max(1, parseInt(pageBtn.dataset.page, 10) || 1);
        const info = getExplorerPaginationInfo(tabState);
        const endIdx = requestedPage * tabState.pageSize;

        if (tabState.hasMore && endIdx > info.filteredCount && info.isUnfiltered) {
          loadExplorerApiPage(tabName, requestedPage);
          return;
        }

        if (requestedPage <= info.totalDisplayPages && requestedPage !== info.currentPage) {
          state.setExplorerPage(tabName, requestedPage);
          updateExplorerControlsAndResults(tabName, tabState);
          const rect = explorerPanel.getBoundingClientRect?.();
          if (rect && rect.top < 0) {
            explorerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
        return;
      }

      const actionBtn = e.target.closest('[data-action]');
      if (!actionBtn) return;
      const action = actionBtn.dataset.action;

      if (action === 'retry-explorer' || action === 'load-next-batch') {
        loadExplorerApiPage(tabName, null);
      } else if (action === 'reset-explorer-filters') {
        clearExplorerDebounce();
        state.setExplorerFilter(tabName, 'all');
        state.setExplorerSearch(tabName, '');
        const searchEl = document.getElementById('explorer-search-input');
        if (searchEl) searchEl.value = '';
        updateExplorerControlsAndResults(tabName, tabState);
      }
    });
  }
}

/**
 * Application Bootstrap.
 */
function initApp() {
  initEventListeners();
  updateClearButtonVisibility();

  // Check URL query parameters only when profile restoration is explicitly requested (?user=...)
  const params = new URLSearchParams(window.location.search);
  const userParam = params.get('user');

  if (userParam && isValidUsername(userParam)) {
    handleSearch(userParam);
  } else {
    resetToIdle({ clearInput: true });
  }
}

// Auto-run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
