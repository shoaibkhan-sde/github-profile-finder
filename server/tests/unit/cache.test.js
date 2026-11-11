/**
 * Unit tests for Bounded In-Memory LRU Cache.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCache } from '../../src/utils/cache.js';

describe('MemoryCache (LRU + TTL)', () => {
  let cache;

  beforeEach(() => {
    cache = new MemoryCache({ maxSize: 3, defaultTtlMs: 1000 });
  });

  it('should store and retrieve values correctly', () => {
    cache.set('octocat', { name: 'The Octocat' });
    expect(cache.get('octocat')).toEqual({ name: 'The Octocat' });
    expect(cache.has('octocat')).toBe(true);
  });

  it('should normalize keys (case-insensitive and trimmed)', () => {
    cache.set('  OctoCat  ', { name: 'Normalized' });
    expect(cache.get('octocat')).toEqual({ name: 'Normalized' });
    expect(cache.has('OCTOCAT')).toBe(true);
  });

  it('should return null for nonexistent keys and track misses', () => {
    expect(cache.get('nonexistent')).toBeNull();
    const stats = cache.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);
  });

  it('should evict the least recently used item when capacity is exceeded', () => {
    cache.set('item1', 'A');
    cache.set('item2', 'B');
    cache.set('item3', 'C');

    // Access item1 to make it most recently used (LRU becomes item2)
    cache.get('item1');

    // Add item4, which should evict item2
    cache.set('item4', 'D');

    expect(cache.get('item1')).toBe('A');
    expect(cache.get('item2')).toBeNull(); // Evicted!
    expect(cache.get('item3')).toBe('C');
    expect(cache.get('item4')).toBe('D');
  });

  it('should expire items after TTL elapsed', async () => {
    cache.set('shortLived', 'temp', 50); // 50ms TTL
    expect(cache.get('shortLived')).toBe('temp');

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(cache.get('shortLived')).toBeNull();
  });

  it('should clear all entries cleanly', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.getStats().size).toBe(2);

    cache.clear();
    expect(cache.getStats().size).toBe(0);
    expect(cache.get('a')).toBeNull();
  });
});

