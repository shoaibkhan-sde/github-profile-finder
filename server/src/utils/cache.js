/**
 * Bounded In-Memory LRU Cache with Time-To-Live (TTL) support.
 *
 * Implements a Map-based Least Recently Used (LRU) eviction strategy
 * with zero external dependencies and safe memory bounds.
 */
export class MemoryCache {
  /**
   * @param {Object} options
   * @param {number} [options.maxSize=500] Maximum number of items in cache
   * @param {number} [options.defaultTtlMs=300000] Default TTL in milliseconds (5 minutes)
   */
  constructor({ maxSize = 500, defaultTtlMs = 300000 } = {}) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Generates a normalized cache key.
   * @param {string} key
   * @returns {string}
   */
  _normalizeKey(key) {
    return String(key).trim().toLowerCase();
  }

  /**
   * Retrieves an item from cache if it exists and has not expired.
   * Promotes item to most recently used.
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    const normKey = this._normalizeKey(key);
    const entry = this.store.get(normKey);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.store.delete(normKey);
      this.misses++;
      return null;
    }

    // Refresh LRU order by deleting and re-inserting
    this.store.delete(normKey);
    this.store.set(normKey, entry);

    this.hits++;
    return entry.value;
  }

  /**
   * Stores an item with a given TTL.
   * Evicts the oldest item if capacity is exceeded.
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlMs] Custom TTL in ms
   */
  set(key, value, ttlMs = this.defaultTtlMs) {
    const normKey = this._normalizeKey(key);

    // If key already exists, delete first to re-order
    if (this.store.has(normKey)) {
      this.store.delete(normKey);
    } else if (this.store.size >= this.maxSize) {
      // Evict the least recently used item (the first key in Map)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(normKey, {
      value,
      expiresAt: Date.now() + ttlMs,
      cachedAt: new Date().toISOString()
    });
  }

  /**
   * Checks whether an unexpired item exists in cache.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Deletes an item from the cache.
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    return this.store.delete(this._normalizeKey(key));
  }

  /**
   * Clears all items and resets counters.
   */
  clear() {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Returns cache metrics and current size.
   * @returns {Object}
   */
  getStats() {
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses)).toFixed(3) : '0.000'
    };
  }
}

// Global profile cache instance initialized with 5-minute TTL
export const profileCache = new MemoryCache({
  maxSize: 500,
  defaultTtlMs: (parseInt(process.env.CACHE_TTL_SECONDS, 10) || 300) * 1000
});

// Top Languages cache initialized with 6-hour TTL to minimize GitHub API requests
export const LANGUAGES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const languagesCache = new MemoryCache({
  maxSize: 500,
  defaultTtlMs: LANGUAGES_CACHE_TTL_MS
});

// Bounded cache for on-demand paginated /repos and /starred API pages (5-minute TTL)
export const paginatedRepoCache = new MemoryCache({
  maxSize: 500,
  defaultTtlMs: (parseInt(process.env.CACHE_TTL_SECONDS, 10) || 300) * 1000
});

// Bounded cache for exact starred repository counts (5-minute TTL)
export const starredCountCache = new MemoryCache({
  maxSize: 500,
  defaultTtlMs: (parseInt(process.env.CACHE_TTL_SECONDS, 10) || 300) * 1000
});

