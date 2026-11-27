'use strict';

// Cache key for the (read-heavy) event list.
const EVENTS_CACHE_KEY = 'events:list';
const MEMORY_MAX_ENTRIES = 500;

// Fallback cache: lives inside one process only.
function createMemoryCache() {
  const entries = new Map();
  return {
    kind: 'memory',
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return null;
      }
      return JSON.parse(entry.json);
    },
    async set(key, value, ttlSeconds) {
      if (entries.size >= MEMORY_MAX_ENTRIES) entries.clear();
      entries.set(key, { json: JSON.stringify(value), expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async del(key) {
      entries.delete(key);
    },
    async close() {
      entries.clear();
    },
  };
}

// [SCALABILITY: Performance Optimization -> Caching with Redis]
// Same idea as the article's getCachedData(), but using the promise API of
// node-redis v4 (the article's callback style belongs to the old v3 client).
// One Redis is shared by every cluster worker, so all workers see the same cache.
async function createRedisCache(url, logger) {
  const { createClient } = require('redis');
  let ready = false;

  const client = createClient({
    url,
    disableOfflineQueue: true, // fail fast (-> cache miss) instead of waiting while Redis is down
    socket: {
      reconnectStrategy: (retries) => {
        if (!ready) return retries >= 2 ? new Error('Redis unreachable') : 300;
        return Math.min(retries * 200, 3000);
      },
    },
  });
  client.on('error', (err) => logger.warn('redis error', { message: err.message }));
  await client.connect();
  ready = true;

  // The cache must never take the app down: any Redis error just means "cache miss".
  return {
    kind: 'redis',
    async get(key) {
      try {
        const raw = await client.get(key);
        return raw === null ? null : JSON.parse(raw);
      } catch (err) {
        logger.warn('cache get failed', { message: err.message });
        return null;
      }
    },
    async set(key, value, ttlSeconds) {
      try {
        await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
      } catch (err) {
        logger.warn('cache set failed', { message: err.message });
      }
    },
    async del(key) {
      try {
        await client.del(key);
      } catch (err) {
        logger.warn('cache del failed', { message: err.message });
      }
    },
    async close() {
      try {
        await client.quit();
      } catch (err) {
        // connection already closed
      }
    },
  };
}

async function createCache({ redisUrl, logger }) {
  if (redisUrl) {
    try {
      const cache = await createRedisCache(redisUrl, logger);
      logger.info('cache: using Redis');
      return cache;
    } catch (err) {
      logger.warn('cache: Redis unavailable, falling back to in-memory cache', { message: err.message });
    }
  }
  logger.info('cache: using in-memory cache');
  return createMemoryCache();
}

module.exports = { createCache, createMemoryCache, EVENTS_CACHE_KEY };
