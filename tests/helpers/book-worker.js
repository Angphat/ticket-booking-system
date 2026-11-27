'use strict';

// Helper process for concurrency.test.js. It behaves like ONE cluster worker:
// it opens its own database connection, waits until a shared start time, then books a seat.
const { openDb } = require('../../src/db');
const { createStore } = require('../../src/services/store');

const [dbFile, userId, eventId, seat, startAt] = process.argv.slice(2);

const db = openDb(dbFile);
const store = createStore(db, { maxSeatsPerUser: 4 });

// Every worker waits for the same moment so they really collide.
const waitMs = Number(startAt) - Date.now();
if (waitMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);

try {
  const booking = store.bookSeat({ userId: Number(userId), eventId: Number(eventId), seat: Number(seat) });
  console.log(JSON.stringify({ ok: true, id: booking.id }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, code: err.code || 'ERROR', message: err.message }));
} finally {
  db.close();
}
