'use strict';

// [CI/CD] Unit tests for the booking logic. They use an in-memory database,
// so they are fast and need no setup: this is what runs on every push in GitHub Actions.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createStore } = require('../src/services/store');

function rejectsWith(fn, code, status) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code);
    assert.equal(err.status, status);
    return true;
  });
}

describe('booking logic', () => {
  let db;
  let store;
  let alice;
  let bob;
  let event;

  beforeEach(() => {
    db = openDb(':memory:');
    store = createStore(db, { maxSeatsPerUser: 4 });
    alice = store.createUser({ email: 'alice@test.local', passwordHash: 'hash-a' });
    bob = store.createUser({ email: 'bob@test.local', passwordHash: 'hash-b' });
    event = store.createEvent({
      name: 'Test Concert',
      venue: 'Test Hall',
      startsAt: '2030-01-01T10:00:00.000Z',
      totalSeats: 10,
    });
  });

  afterEach(() => db.close());

  it('books a free seat', () => {
    const booking = store.bookSeat({ userId: alice.id, eventId: event.id, seat: 3 });
    assert.equal(booking.seat, 3);
    assert.equal(booking.eventId, event.id);
    assert.deepEqual(store.getSeatMap(event.id).takenSeats, [3]);
  });

  it('does not allow the same seat to be booked twice (different users)', () => {
    store.bookSeat({ userId: alice.id, eventId: event.id, seat: 5 });
    rejectsWith(() => store.bookSeat({ userId: bob.id, eventId: event.id, seat: 5 }), 'SEAT_TAKEN', 409);
    assert.equal(store.getSeatMap(event.id).takenSeats.length, 1);
  });

  it('does not allow the same user to book the same seat twice', () => {
    store.bookSeat({ userId: alice.id, eventId: event.id, seat: 5 });
    rejectsWith(() => store.bookSeat({ userId: alice.id, eventId: event.id, seat: 5 }), 'SEAT_TAKEN', 409);
  });

  it('allows the same seat number in different events', () => {
    const other = store.createEvent({
      name: 'Other',
      venue: 'Hall',
      startsAt: '2030-02-01T10:00:00.000Z',
      totalSeats: 10,
    });
    store.bookSeat({ userId: alice.id, eventId: event.id, seat: 1 });
    const booking = store.bookSeat({ userId: bob.id, eventId: other.id, seat: 1 });
    assert.equal(booking.seat, 1);
  });

  it('rejects invalid seat numbers', () => {
    for (const seat of [0, -1, 1.5, '3', null, undefined, NaN]) {
      rejectsWith(() => store.bookSeat({ userId: alice.id, eventId: event.id, seat }), 'INVALID_SEAT', 400);
    }
    rejectsWith(() => store.bookSeat({ userId: alice.id, eventId: event.id, seat: 11 }), 'INVALID_SEAT', 400);
  });

  it('rejects an unknown event', () => {
    rejectsWith(() => store.bookSeat({ userId: alice.id, eventId: 999, seat: 1 }), 'EVENT_NOT_FOUND', 404);
  });

  it('limits how many seats one user can hold per event (anti-bot rule)', () => {
    for (let seat = 1; seat <= 4; seat += 1) {
      store.bookSeat({ userId: alice.id, eventId: event.id, seat });
    }
    rejectsWith(() => store.bookSeat({ userId: alice.id, eventId: event.id, seat: 5 }), 'SEAT_LIMIT', 403);
    // another user is not affected
    assert.equal(store.bookSeat({ userId: bob.id, eventId: event.id, seat: 5 }).seat, 5);
  });

  it('frees the seat after the owner cancels', () => {
    const booking = store.bookSeat({ userId: alice.id, eventId: event.id, seat: 2 });
    store.cancelBooking({ bookingId: booking.id, userId: alice.id });
    assert.deepEqual(store.getSeatMap(event.id).takenSeats, []);
    assert.equal(store.bookSeat({ userId: bob.id, eventId: event.id, seat: 2 }).seat, 2);
  });

  it('does not let a user cancel someone else\'s booking', () => {
    const booking = store.bookSeat({ userId: alice.id, eventId: event.id, seat: 2 });
    rejectsWith(() => store.cancelBooking({ bookingId: booking.id, userId: bob.id }), 'BOOKING_NOT_FOUND', 404);
    assert.deepEqual(store.getSeatMap(event.id).takenSeats, [2]);
  });

  it('counts seats in the event list', () => {
    store.bookSeat({ userId: alice.id, eventId: event.id, seat: 1 });
    store.bookSeat({ userId: bob.id, eventId: event.id, seat: 2 });
    const [listed] = store.listEvents();
    assert.equal(listed.totalSeats, 10);
    assert.equal(listed.seatsTaken, 2);
    assert.equal(listed.seatsAvailable, 8);
  });

  it('lists only the bookings of the given user', () => {
    store.bookSeat({ userId: alice.id, eventId: event.id, seat: 1 });
    store.bookSeat({ userId: bob.id, eventId: event.id, seat: 2 });
    const mine = store.listUserBookings(alice.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].seat, 1);
    assert.equal(mine[0].eventName, 'Test Concert');
  });

  it('rejects a duplicate email', () => {
    rejectsWith(() => store.createUser({ email: 'alice@test.local', passwordHash: 'x' }), 'EMAIL_TAKEN', 409);
  });

  it('treats SQL injection text as plain data (parameterized queries)', () => {
    const evil = "x'); DROP TABLE users; --";
    const created = store.createEvent({
      name: evil,
      venue: 'Hall',
      startsAt: '2030-03-01T10:00:00.000Z',
      totalSeats: 5,
    });
    assert.equal(created.name, evil);
    assert.equal(store.findUserByEmail("alice@test.local' OR '1'='1"), undefined);
    assert.ok(store.findUserByEmail('alice@test.local')); // users table still exists
  });
});
