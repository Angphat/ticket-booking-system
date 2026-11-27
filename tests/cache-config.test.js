'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryCache } = require('../src/cache');
const { loadConfig } = require('../src/config');

describe('memory cache', () => {
  it('stores and returns values, and returns copies', async () => {
    const cache = createMemoryCache();
    await cache.set('k', { a: 1 }, 10);
    const first = await cache.get('k');
    assert.equal(first.a, 1);
    first.a = 99; // changing the copy must not change the cache
    assert.equal((await cache.get('k')).a, 1);
  });

  it('returns null for missing keys and after delete', async () => {
    const cache = createMemoryCache();
    assert.equal(await cache.get('missing'), null);
    await cache.set('k', [1, 2], 10);
    await cache.del('k');
    assert.equal(await cache.get('k'), null);
  });

  it('expires entries after the TTL', async () => {
    const cache = createMemoryCache();
    await cache.set('k', 'v', 0.05); // 50 ms
    assert.equal(await cache.get('k'), 'v');
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(await cache.get('k'), null);
  });
});

describe('config', () => {
  it('refuses to start without JWT_SECRET', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'development' }), /JWT_SECRET/);
  });

  it('refuses a short JWT_SECRET in production', () => {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'too-short' }), /at least 32/);
  });

  it('reads settings from the environment', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(40),
      PORT: '8080',
      REDIS_URL: 'redis://localhost:6379',
      WORKERS: '3',
    });
    assert.equal(c.port, 8080);
    assert.equal(c.redisUrl, 'redis://localhost:6379');
    assert.equal(c.workers, 3);
    assert.equal(c.isProd, true);
    assert.equal(c.bcryptRounds, 10);
  });

  it('has safe defaults', () => {
    const c = loadConfig({ NODE_ENV: 'development', JWT_SECRET: 'dev-secret' });
    assert.equal(c.port, 3000);
    assert.equal(c.maxSeatsPerUser, 4);
    assert.equal(c.cacheTtlSeconds, 15);
    assert.equal(c.redisUrl, '');
  });
});
