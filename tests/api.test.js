'use strict';

process.env.NODE_ENV = 'test';

// [CI/CD] End-to-end API tests: a real HTTP server on a random port, an in-memory database,
// real requests with fetch(). They also prove the SECURITY and CACHING features work.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/logger');
const { openDb } = require('../src/db');
const { createStore } = require('../src/services/store');
const { createMemoryCache } = require('../src/cache');
const { createApp } = require('../src/app');

const config = loadConfig({ NODE_ENV: 'test' });
const logger = createLogger(config);
const PASSWORD = 'Correct-Horse-1';

async function startApp(limits) {
  const db = openDb(':memory:');
  const store = createStore(db, { maxSeatsPerUser: config.maxSeatsPerUser });
  const cache = createMemoryCache();
  const app = createApp({ store, cache, config, logger, limits });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { token, body, raw } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, {
      method,
      headers,
      body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
  }

  async function register(email) {
    return call('POST', '/api/auth/register', { body: { email, password: PASSWORD } });
  }

  async function login(email, password = PASSWORD) {
    return call('POST', '/api/auth/login', { body: { email, password } });
  }

  async function tokenFor(email) {
    await register(email);
    const res = await login(email);
    return res.data.token;
  }

  async function close() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  return { db, store, call, register, login, tokenFor, close };
}

describe('API: authentication, bookings, caching, security', () => {
  let t;
  let adminToken;
  let aliceToken;
  let bobToken;
  let eventId;

  before(async () => {
    t = await startApp();
    const adminHash = await bcrypt.hash(PASSWORD, config.bcryptRounds);
    t.store.createUser({ email: 'admin@test.local', passwordHash: adminHash, role: 'admin' });
    adminToken = (await t.login('admin@test.local')).data.token;
    aliceToken = await t.tokenFor('alice@test.local');
    bobToken = await t.tokenFor('bob@test.local');
  });

  after(() => t.close());

  // ---------- authentication ----------
  it('registers a user and stores only a bcrypt hash, never the password', async () => {
    const res = await t.register('carol@test.local');
    assert.equal(res.status, 201);
    assert.equal(res.data.email, 'carol@test.local');
    assert.equal(res.data.password, undefined);

    const row = t.db.prepare('SELECT password_hash FROM users WHERE email = ?').get('carol@test.local');
    assert.ok(row.password_hash.startsWith('$2'), 'should be a bcrypt hash');
    assert.ok(!row.password_hash.includes(PASSWORD));
  });

  it('rejects duplicate email, weak password and wrongly typed input', async () => {
    assert.equal((await t.register('alice@test.local')).status, 409);

    const weak = await t.call('POST', '/api/auth/register', { body: { email: 'weak@test.local', password: '123' } });
    assert.equal(weak.status, 400);

    // an object instead of a string must not reach the database layer
    const injection = await t.call('POST', '/api/auth/login', {
      body: { email: { $ne: null }, password: { $ne: null } },
    });
    assert.equal(injection.status, 400);
  });

  it('logs in with the right password and refuses the wrong one with a generic message', async () => {
    const ok = await t.login('alice@test.local');
    assert.equal(ok.status, 200);
    assert.ok(ok.data.token);

    const wrongPassword = await t.login('alice@test.local', 'Wrong-Password-1');
    const unknownUser = await t.login('nobody@test.local');
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownUser.status, 401);
    assert.equal(wrongPassword.data.error.message, unknownUser.data.error.message);
  });

  it('refuses requests without a valid token', async () => {
    assert.equal((await t.call('GET', '/api/bookings/me')).status, 401);
    assert.equal((await t.call('GET', '/api/bookings/me', { token: 'not.a.jwt' })).status, 401);
    assert.equal((await t.call('POST', '/api/events/1/book', { body: { seat: 1 } })).status, 401);
  });

  // ---------- authorization ----------
  it('lets only an admin create events', async () => {
    const body = { name: 'Rock Night', venue: 'Arena', startsAt: '2030-05-01T19:00:00Z', totalSeats: 10 };

    assert.equal((await t.call('POST', '/api/events', { token: aliceToken, body })).status, 403);

    const created = await t.call('POST', '/api/events', { token: adminToken, body });
    assert.equal(created.status, 201);
    eventId = created.data.event.id;
    assert.equal(created.data.event.totalSeats, 10);
  });

  it('validates event input', async () => {
    const bad = await t.call('POST', '/api/events', {
      token: adminToken,
      body: { name: '<script>alert(1)</script>', venue: 'Arena', startsAt: '2030-05-01T19:00:00Z', totalSeats: 10 },
    });
    assert.equal(bad.status, 400);

    const badSeats = await t.call('POST', '/api/events', {
      token: adminToken,
      body: { name: 'X', venue: 'Y', startsAt: '2030-05-01T19:00:00Z', totalSeats: -5 },
    });
    assert.equal(badSeats.status, 400);
  });

  // ---------- caching ----------
  it('serves the event list from cache on the second request and refreshes after a booking', async () => {
    const first = await t.call('GET', '/api/events');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-cache'), 'MISS');

    const second = await t.call('GET', '/api/events');
    assert.equal(second.headers.get('x-cache'), 'HIT');
    assert.equal(second.data.events[0].seatsTaken, 0);

    const booked = await t.call('POST', `/api/events/${eventId}/book`, { token: aliceToken, body: { seat: 1 } });
    assert.equal(booked.status, 201);

    const third = await t.call('GET', '/api/events');
    assert.equal(third.headers.get('x-cache'), 'MISS', 'booking must clear the cache');
    assert.equal(third.data.events[0].seatsTaken, 1);
    assert.equal(third.data.events[0].seatsAvailable, 9);
  });

  // ---------- booking rules ----------
  it('does not allow double booking through the API', async () => {
    const res = await t.call('POST', `/api/events/${eventId}/book`, { token: bobToken, body: { seat: 1 } });
    assert.equal(res.status, 409);
    assert.equal(res.data.error.code, 'SEAT_TAKEN');
  });

  it('validates the booking request', async () => {
    const base = `/api/events/${eventId}/book`;
    assert.equal((await t.call('POST', base, { token: bobToken, body: { seat: '2' } })).status, 400);
    assert.equal((await t.call('POST', base, { token: bobToken, body: { seat: 99 } })).status, 400);
    assert.equal((await t.call('POST', base, { token: bobToken, body: {} })).status, 400);
    assert.equal((await t.call('POST', '/api/events/abc/book', { token: bobToken, body: { seat: 1 } })).status, 400);
    assert.equal((await t.call('POST', '/api/events/9999/book', { token: bobToken, body: { seat: 1 } })).status, 404);
  });

  it('limits seats per user (anti-bot rule)', async () => {
    const base = `/api/events/${eventId}/book`;
    for (const seat of [2, 3, 4, 5]) {
      assert.equal((await t.call('POST', base, { token: bobToken, body: { seat } })).status, 201);
    }
    const fifth = await t.call('POST', base, { token: bobToken, body: { seat: 6 } });
    assert.equal(fifth.status, 403);
    assert.equal(fifth.data.error.code, 'SEAT_LIMIT');
  });

  it('lets a user cancel only their own booking', async () => {
    const mine = await t.call('GET', '/api/bookings/me', { token: aliceToken });
    assert.equal(mine.data.bookings.length, 1);
    const bookingId = mine.data.bookings[0].id;

    // Bob cannot cancel Alice's booking
    assert.equal((await t.call('DELETE', `/api/bookings/${bookingId}`, { token: bobToken })).status, 404);
    // Alice can
    assert.equal((await t.call('DELETE', `/api/bookings/${bookingId}`, { token: aliceToken })).status, 204);

    const seats = await t.call('GET', `/api/events/${eventId}/seats`);
    assert.ok(!seats.data.takenSeats.includes(1), 'seat 1 should be free again');
  });

  // ---------- security headers and error handling ----------
  it('sets security headers and hides the framework', async () => {
    const res = await t.call('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('content-security-policy'));
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.ok(res.headers.get('x-worker-pid'));
  });

  it('rejects oversized and malformed JSON bodies without leaking details', async () => {
    const big = await t.call('POST', '/api/auth/login', { raw: JSON.stringify({ email: 'a@b.cc', password: 'x'.repeat(20000) }) });
    assert.equal(big.status, 413);

    const broken = await t.call('POST', '/api/auth/login', { raw: '{ not json' });
    assert.equal(broken.status, 400);
    assert.equal(broken.data.error.code, 'INVALID_JSON');

    const missing = await t.call('GET', '/api/does-not-exist');
    assert.equal(missing.status, 404);
    assert.ok(!JSON.stringify(missing.data).includes('at '), 'no stack trace in responses');
  });
});

describe('API: rate limiting', () => {
  it('blocks brute-force login attempts with 429', async () => {
    const t = await startApp({ login: { windowMs: 60000, limit: 3 } });
    try {
      await t.register('victim@test.local');
      const codes = [];
      for (let i = 0; i < 5; i += 1) {
        codes.push((await t.login('victim@test.local', `wrong-password-${i}`)).status);
      }
      assert.deepEqual(codes, [401, 401, 401, 429, 429]);

      // even the correct password is blocked while the limit is active
      assert.equal((await t.login('victim@test.local')).status, 429);
    } finally {
      await t.close();
    }
  });

  it('does not count successful logins against the limit', async () => {
    const t = await startApp({ login: { windowMs: 60000, limit: 2 } });
    try {
      await t.register('good@test.local');
      for (let i = 0; i < 5; i += 1) {
        assert.equal((await t.login('good@test.local')).status, 200);
      }
    } finally {
      await t.close();
    }
  });

  it('rate limits booking requests per user', async () => {
    const t = await startApp({ booking: { windowMs: 60000, limit: 2 } });
    try {
      const token = await t.tokenFor('fast@test.local');
      const event = t.store.createEvent({ name: 'E', venue: 'V', startsAt: '2030-01-01T00:00:00.000Z', totalSeats: 50 });
      const codes = [];
      for (let seat = 1; seat <= 4; seat += 1) {
        codes.push((await t.call('POST', `/api/events/${event.id}/book`, { token, body: { seat } })).status);
      }
      assert.deepEqual(codes, [201, 201, 429, 429]);
    } finally {
      await t.close();
    }
  });
});
