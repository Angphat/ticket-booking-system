'use strict';

// Proves that booking is safe when SEVERAL PROCESSES (like cluster workers) hit the same
// database file at the same time. Each helper process has its own database connection.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { createStore } = require('../src/services/store');

const WORKER = path.join(__dirname, 'helpers', 'book-worker.js');

function runWorker(dbFile, userId, eventId, seat, startAt) {
  return new Promise((resolve, reject) => {
    const args = ['--no-warnings', WORKER, dbFile, String(userId), String(eventId), String(seat), String(startAt)];
    execFile(process.execPath, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(`worker failed: ${err.message}\n${stderr}`));
      return resolve(JSON.parse(stdout.trim()));
    });
  });
}

describe('concurrent booking from several processes', () => {
  let dir;
  let dbFile;
  let db;
  let store;
  let users;
  let event;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tickets-test-'));
    dbFile = path.join(dir, 'race.db');
    db = openDb(dbFile);
    store = createStore(db, { maxSeatsPerUser: 4 });
    users = [];
    for (let i = 1; i <= 8; i += 1) {
      users.push(store.createUser({ email: `user${i}@test.local`, passwordHash: 'x' }));
    }
    event = store.createEvent({
      name: 'Race Concert',
      venue: 'Arena',
      startsAt: '2030-01-01T10:00:00.000Z',
      totalSeats: 20,
    });
  });

  after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('8 users racing for the SAME seat: exactly one wins', async () => {
    const startAt = Date.now() + 2000;
    const results = await Promise.all(users.map((u) => runWorker(dbFile, u.id, event.id, 7, startAt)));

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    assert.equal(winners.length, 1, `expected 1 winner, got ${JSON.stringify(results)}`);
    assert.equal(losers.length, 7);
    assert.ok(losers.every((r) => r.code === 'SEAT_TAKEN'), JSON.stringify(losers));

    const taken = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE event_id = ? AND seat = 7').get(event.id);
    assert.equal(taken.n, 1);
  });

  it('1 user racing for 8 DIFFERENT seats: the per-user limit (4) still holds', async () => {
    // A fresh event, so the result does not depend on who won the previous test.
    const fresh = store.createEvent({
      name: 'Limit Concert',
      venue: 'Arena',
      startsAt: '2030-02-01T10:00:00.000Z',
      totalSeats: 20,
    });
    const startAt = Date.now() + 2000;
    const seats = [1, 2, 3, 4, 5, 6, 8, 9];
    const results = await Promise.all(seats.map((s) => runWorker(dbFile, users[0].id, fresh.id, s, startAt)));

    const winners = results.filter((r) => r.ok);
    assert.equal(winners.length, 4, `expected 4 successes, got ${JSON.stringify(results)}`);
    assert.ok(results.filter((r) => !r.ok).every((r) => r.code === 'SEAT_LIMIT'), JSON.stringify(results));

    const mine = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND event_id = ?')
      .get(users[0].id, fresh.id);
    assert.equal(mine.n, 4);
  });
});
