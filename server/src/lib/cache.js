/**
 * Result cache keyed by normalised phone number.
 *
 * Uses Redis when REDIS_URL is configured (ioredis keeps a pooled connection
 * with automatic reconnects), otherwise an in-process node-cache instance.
 * Both back-ends expose the same tiny async interface.
 */
import NodeCache from 'node-cache';
import { config } from '../config.js';
import { logger } from './logger.js';

const KEY_PREFIX = 'lookup:';

function createMemoryCache(ttlSeconds) {
  const store = new NodeCache({ stdTTL: ttlSeconds, checkperiod: 600, useClones: false });
  return {
    kind: 'memory',
    async get(key) {
      return store.get(KEY_PREFIX + key) ?? null;
    },
    async set(key, value, ttl = ttlSeconds) {
      store.set(KEY_PREFIX + key, value, ttl);
    },
    async del(key) {
      store.del(KEY_PREFIX + key);
    },
    async close() {
      store.close();
    },
  };
}

async function createRedisCache(url, ttlSeconds) {
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  redis.on('error', (err) => logger.warn('redis_error', { message: err.message }));
  await redis.connect();
  return {
    kind: 'redis',
    async get(key) {
      const raw = await redis.get(KEY_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    },
    async set(key, value, ttl = ttlSeconds) {
      await redis.set(KEY_PREFIX + key, JSON.stringify(value), 'EX', ttl);
    },
    async del(key) {
      await redis.del(KEY_PREFIX + key);
    },
    async close() {
      await redis.quit();
    },
  };
}

/**
 * Build the cache. Falls back to memory if Redis cannot be reached at boot so
 * the app still works (with a warning) when Redis is misconfigured.
 */
export async function createCache(options = {}) {
  const ttlSeconds = options.ttlSeconds ?? config.cache.ttlSeconds;
  const redisUrl = options.redisUrl ?? config.cache.redisUrl;
  if (redisUrl) {
    try {
      const cache = await createRedisCache(redisUrl, ttlSeconds);
      logger.info('cache_ready', { kind: 'redis' });
      return cache;
    } catch (err) {
      logger.warn('redis_unavailable_falling_back_to_memory', { message: err.message });
    }
  }
  const cache = createMemoryCache(ttlSeconds);
  logger.info('cache_ready', { kind: 'memory' });
  return cache;
}
