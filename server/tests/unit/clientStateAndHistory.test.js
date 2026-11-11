import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSearchHistory,
  saveSearchHistory,
  removeSearchHistoryItem,
  clearSearchHistory
} from '../../../client/js/history.js';
import { state, getFilteredSortedExplorerItems } from '../../../client/js/state.js';
import { formatNumber, getLanguageColor, formatJoinedDate } from '../../../client/js/utils.js';

describe('Client History Manager (history.js)', () => {
  beforeEach(() => {
    let store = {};
    global.localStorage = {
      getItem: (key) => store[key] || null,
      setItem: (key, value) => {
        store[key] = String(value);
      },
      removeItem: (key) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      }
    };
    clearSearchHistory();
  });

  it('should return empty array when no history exists', () => {
    expect(getSearchHistory()).toEqual([]);
  });

  it('should save search items and move recently searched item to front', () => {
    saveSearchHistory('octocat');
    saveSearchHistory('torvalds');
    saveSearchHistory('gaearon');

    expect(getSearchHistory()).toEqual(['gaearon', 'torvalds', 'octocat']);

    // Re-searching octocat should move it to the front
    saveSearchHistory('octocat');
    expect(getSearchHistory()).toEqual(['octocat', 'gaearon', 'torvalds']);
  });

  it('should limit history to a maximum of 6 items', () => {
    const users = ['user1', 'user2', 'user3', 'user4', 'user5', 'user6', 'user7'];
    users.forEach((u) => saveSearchHistory(u));

    const history = getSearchHistory();
    expect(history.length).toBe(6);
    expect(history[0]).toBe('user7');
    expect(history.includes('user1')).toBe(false);
  });

  it('should remove a single item from search history', () => {
    saveSearchHistory('octocat');
    saveSearchHistory('torvalds');

    removeSearchHistoryItem('octocat');
    expect(getSearchHistory()).toEqual(['torvalds']);
  });

  it('should clear all items on clearSearchHistory', () => {
    saveSearchHistory('octocat');
    saveSearchHistory('torvalds');

    clearSearchHistory();
    expect(getSearchHistory()).toEqual([]);
  });
});

describe('Client State Manager (state.js)', () => {
  beforeEach(() => {
    state.setData(null);
  });

  it('should transition to loading state and clear prior error', () => {
    state.setError(new Error('Previous error'));
    state.setLoading(true);

    expect(state.isLoading).toBe(true);
    expect(state.error).toBeNull();
  });

  it('should store data and reset tab to overview', () => {
    state.setActiveTab('stars');
    const mockData = { user: { login: 'octocat' } };
    state.setData(mockData);

    expect(state.isLoading).toBe(false);
    expect(state.currentData).toEqual(mockData);
    expect(state.activeTab).toBe('overview');
  });

  it('should update activeTab and repoSort correctly', () => {
    state.setActiveTab('repositories');
    expect(state.activeTab).toBe('repositories');

    state.setRepoSort('updated');
    expect(state.repoSort).toBe('updated');
  });

  it('should initialize explorer repositories from profile data and filter/sort cleanly', () => {
    const sampleRepos = [
      { id: 1, name: 'zebra', fork: false, stars: 5, language: 'TypeScript', updated_at: '2026-01-01T00:00:00Z' },
      { id: 2, name: 'alpha', fork: true, stars: 100, language: 'JavaScript', updated_at: '2026-03-01T00:00:00Z' },
      { id: 3, name: 'beta', fork: false, stars: 25, language: 'Python', updated_at: '2026-02-01T00:00:00Z' }
    ];
    state.setData({
      user: { login: 'octocat', public_repos: 3, starred_count: 10 },
      repositories: sampleRepos,
      repositories_pagination: { hasNext: false, hasPrev: false, nextPage: null, prevPage: null, lastPage: 1 }
    });

    expect(state.explorer.repositories.initialized).toBe(true);
    expect(state.explorer.repositories.items).toHaveLength(3);
    expect(state.explorer.stars.initialized).toBe(false);

    state.setExplorerFilter('repositories', 'forks');
    state.setExplorerSort('repositories', 'name');
    const forkAlpha = getFilteredSortedExplorerItems(state.explorer.repositories);
    expect(forkAlpha.map((r) => r.name)).toEqual(['alpha']);

    state.setExplorerFilter('repositories', 'all');
    state.setExplorerSearch('repositories', 'alpha');
    const matched = getFilteredSortedExplorerItems(state.explorer.repositories);
    expect(matched.map((r) => r.name)).toEqual(['alpha']);
  });
});

describe('Client Utilities (utils.js)', () => {
  it('should format numbers correctly into compact K and M strings', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(850)).toBe('850');
    expect(formatNumber(1200)).toBe('1.2K');
    expect(formatNumber(8300)).toBe('8.3K');
    expect(formatNumber(1500000)).toBe('1.5M');
  });

  it('should return correct GitHub language color and fallback for unknown language', () => {
    expect(getLanguageColor('JavaScript')).toBe('#f1e05a');
    expect(getLanguageColor('TypeScript')).toBe('#3178c6');
    expect(getLanguageColor('Python')).toBe('#3572A5');
    expect(getLanguageColor('UnknownLangXYZ')).toBe('#8b949e');
  });

  it('should format joined dates into Mon YYYY format', () => {
    expect(formatJoinedDate('2011-01-25T18:44:36Z')).toBe('Joined Jan 2011');
  });
});

