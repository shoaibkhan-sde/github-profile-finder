/**
 * LocalStorage Recent Search History Manager.
 * Stores up to 6 unique recent searches with instant access and clear actions.
 */

const STORAGE_KEY = 'gh_profile_search_history';
const MAX_HISTORY_ITEMS = 6;

export function getSearchHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSearchHistory(username) {
  if (!username || typeof username !== 'string') return;
  const clean = username.trim().toLowerCase();
  if (!clean) return;

  try {
    const existing = getSearchHistory();
    // Remove if already exists (to move to front)
    const filtered = existing.filter((item) => item.toLowerCase() !== clean);
    const updated = [clean, ...filtered].slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Could not save search history to localStorage:', e);
  }
}

export function removeSearchHistoryItem(username) {
  if (!username) return;
  const clean = username.trim().toLowerCase();
  try {
    const existing = getSearchHistory();
    const updated = existing.filter((item) => item.toLowerCase() !== clean);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Could not remove search item:', e);
  }
}

export function clearSearchHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Could not clear search history:', e);
  }
}

