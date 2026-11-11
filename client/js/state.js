/**
 * Central UI State Manager.
 */

export const EXPLORER_PAGE_SIZE = 8;

export function createEmptyExplorerTabState() {
  return {
    initialized: false,
    items: [],
    seenKeys: new Set(),
    loadedApiPages: new Set(),
    nextApiPage: 1,
    hasMore: false,
    lastApiPage: null,
    totalKnownCount: null,
    isLoading: false,
    isLoadingMore: false,
    error: null,
    searchQuery: '',
    filter: 'all', // 'all' | 'forks'
    sort: 'stars', // 'stars' | 'updated' | 'name'
    currentPage: 1,
    pageSize: EXPLORER_PAGE_SIZE
  };
}

function getRepoDedupeKey(repo) {
  if (!repo) return '';
  if (repo.id !== undefined && repo.id !== null) return `id:${repo.id}`;
  if (repo.full_name) return `fn:${String(repo.full_name).toLowerCase()}`;
  return `name:${String(repo.name || '').toLowerCase()}`;
}

export function getFilteredSortedExplorerItems(tabState) {
  if (!tabState || !Array.isArray(tabState.items)) return [];

  let list = tabState.items;
  if (tabState.filter === 'forks') {
    list = list.filter((repo) => Boolean(repo.fork));
  }

  const query = (tabState.searchQuery || '').trim().toLowerCase();
  if (query) {
    list = list.filter((repo) => {
      const name = (repo.name || '').toLowerCase();
      const fullName = (repo.full_name || '').toLowerCase();
      const desc = (repo.description || '').toLowerCase();
      const lang = (repo.language || '').toLowerCase();
      const owner = (repo.owner?.login || '').toLowerCase();
      return name.includes(query)
        || fullName.includes(query)
        || desc.includes(query)
        || lang.includes(query)
        || owner.includes(query);
    });
  }

  const sorted = [...list];
  if (tabState.sort === 'updated') {
    sorted.sort((a, b) => Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0));
  } else if (tabState.sort === 'name') {
    sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
  } else {
    sorted.sort((a, b) => {
      const starDiff = (b.stars || 0) - (a.stars || 0);
      if (starDiff !== 0) return starDiff;
      return Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0);
    });
  }

  return sorted;
}

export const state = {
  uiState: 'idle', // 'idle' | 'loading' | 'success' | 'error'
  currentData: null,
  activeTab: 'overview',
  repoSort: 'stars', // 'stars' | 'updated' | 'name'
  isLoading: false,
  error: null,
  explorer: {
    repositories: createEmptyExplorerTabState(),
    stars: createEmptyExplorerTabState()
  },

  resetExplorerState(data = null) {
    const repoState = createEmptyExplorerTabState();
    const starState = createEmptyExplorerTabState();

    if (data && data.user) {
      const publicRepos = typeof data.user.public_repos === 'number'
        ? data.user.public_repos
        : data.user.stats?.public_repos;
      if (typeof publicRepos === 'number') {
        repoState.totalKnownCount = publicRepos;
      }

      const starredCount = typeof data.user.stats?.starred_count === 'number'
        ? data.user.stats.starred_count
        : data.user.starred_count;
      if (typeof starredCount === 'number') {
        starState.totalKnownCount = starredCount;
      }
      if (Array.isArray(data.repositories)) {
        for (const repo of data.repositories) {
          const key = getRepoDedupeKey(repo);
          if (key && !repoState.seenKeys.has(key)) {
            repoState.seenKeys.add(key);
            repoState.items.push(repo);
          }
        }
        repoState.initialized = true;
        repoState.loadedApiPages.add(1);
        const pagination = data.repositories_pagination;
        repoState.hasMore = pagination
          ? Boolean(pagination.hasNext)
          : (data.repositories.length === 100 && (repoState.totalKnownCount === null || repoState.totalKnownCount > 100));
        repoState.nextApiPage = pagination?.nextPage || (repoState.hasMore ? 2 : null);
        repoState.lastApiPage = pagination?.lastPage || null;
      }
    }

    this.explorer = {
      repositories: repoState,
      stars: starState
    };
  },

  getExplorerState(tab = this.activeTab) {
    if (tab === 'repositories') return this.explorer.repositories;
    if (tab === 'stars') return this.explorer.stars;
    return null;
  },

  setExplorerTabLoading(tab, loading, { isLoadMore = false } = {}) {
    const tabState = this.getExplorerState(tab);
    if (!tabState) return;
    if (loading) {
      tabState.error = null;
      tabState.isLoading = !isLoadMore;
      tabState.isLoadingMore = Boolean(isLoadMore);
    } else {
      tabState.isLoading = false;
      tabState.isLoadingMore = false;
    }
  },

  appendExplorerApiPage(tab, payload) {
    const tabState = this.getExplorerState(tab);
    if (!tabState || !payload) return;

    const incoming = Array.isArray(payload.repositories) ? payload.repositories : [];
    for (const repo of incoming) {
      const key = getRepoDedupeKey(repo);
      if (key && !tabState.seenKeys.has(key)) {
        tabState.seenKeys.add(key);
        tabState.items.push(repo);
      }
    }

    const pageNum = Number(payload.page) || tabState.nextApiPage || 1;
    tabState.loadedApiPages.add(pageNum);

    const pagination = payload.pagination || {};
    const inferredHasMore = typeof pagination.hasNext === 'boolean'
      ? pagination.hasNext
      : incoming.length >= (Number(payload.per_page) || 100);

    tabState.hasMore = inferredHasMore;
    tabState.nextApiPage = pagination.nextPage || (inferredHasMore ? pageNum + 1 : null);
    if (pagination.lastPage) {
      tabState.lastApiPage = pagination.lastPage;
    }
    if (typeof payload.total_count === 'number' && Number.isFinite(payload.total_count)) {
      tabState.totalKnownCount = Math.max(payload.total_count, tabState.items.length);
    }
    if (!inferredHasMore && tabState.filter === 'all' && !tabState.searchQuery) {
      // Exact loaded count once final API page is reached
      if (tab === 'stars' || tabState.totalKnownCount === null) {
        tabState.totalKnownCount = Math.max(tabState.items.length, tabState.totalKnownCount || 0);
      }
    }

    tabState.initialized = true;
    tabState.isLoading = false;
    tabState.isLoadingMore = false;
    tabState.error = null;
  },

  setExplorerTabError(tab, error) {
    const tabState = this.getExplorerState(tab);
    if (!tabState) return;
    tabState.error = error;
    tabState.isLoading = false;
    tabState.isLoadingMore = false;
  },

  setExplorerSearch(tab, query) {
    const tabState = this.getExplorerState(tab);
    if (!tabState) return;
    tabState.searchQuery = query;
    tabState.currentPage = 1;
  },

  setExplorerFilter(tab, filter) {
    const tabState = this.getExplorerState(tab);
    if (!tabState) return;
    tabState.filter = filter;
    tabState.currentPage = 1;
  },

  setExplorerSort(tab, sort) {
    const tabState = this.getExplorerState(tab);
    if (!tabState) return;
    tabState.sort = sort;
    tabState.currentPage = 1;
    if (tab === 'repositories') {
      this.repoSort = sort;
    }
  },

  setExplorerPage(tab, page) {
    const tabState = this.getExplorerState(tab);
    if (!tabState) return;
    tabState.currentPage = Math.max(1, parseInt(page, 10) || 1);
  },

  setIdle() {
    this.uiState = 'idle';
    this.currentData = null;
    this.isLoading = false;
    this.error = null;
    this.activeTab = 'overview';
    this.resetExplorerState(null);
  },

  setLoading(loading) {
    this.isLoading = loading;
    if (loading) {
      this.uiState = 'loading';
      this.error = null;
    } else if (!this.currentData && !this.error) {
      this.uiState = 'idle';
    }
  },

  setData(data) {
    this.currentData = data;
    this.isLoading = false;
    this.error = null;
    this.activeTab = 'overview';
    this.uiState = data ? 'success' : 'idle';
    this.resetExplorerState(data);
  },

  setError(error) {
    this.error = error;
    this.currentData = null;
    this.isLoading = false;
    this.uiState = 'error';
  },

  setActiveTab(tab) {
    this.activeTab = tab;
  },

  setRepoSort(sort) {
    this.repoSort = sort;
    if (this.explorer?.repositories) {
      this.explorer.repositories.sort = sort;
      this.explorer.repositories.currentPage = 1;
    }
  }
};

