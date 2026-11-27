'use strict';

const { isUniqueViolation } = require('../db');

class ServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.code = code;
  }
}

function toEvent(row) {
  return {
    id: row.id,
    name: row.name,
    venue: row.venue,
    startsAt: row.starts_at,
    totalSeats: row.total_seats,
    seatsTaken: row.seats_taken,
    seatsAvailable: row.total_seats - row.seats_taken,
  };
}

// All SQL lives here and ALWAYS uses bound parameters (?), never string concatenation.
// [SECURITY #6] This is the SQL equivalent of "don't pass untrusted input into query filters".
function createStore(db, { maxSeatsPerUser = 4 } = {}) {
  const sql = {
    insertUser: db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)'),
    userByEmail: db.prepare('SELECT id, email, password_hash, role FROM users WHERE email = ?'),
    userById: db.prepare('SELECT id, email, role FROM users WHERE id = ?'),

    insertEvent: db.prepare('INSERT INTO events (name, venue, starts_at, total_seats) VALUES (?, ?, ?, ?)'),
    eventById: db.prepare(`
      SELECT e.id, e.name, e.venue, e.starts_at, e.total_seats,
             (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id) AS seats_taken
      FROM events e WHERE e.id = ?`),
    allEvents: db.prepare(`
      SELECT e.id, e.name, e.venue, e.starts_at, e.total_seats, COUNT(b.id) AS seats_taken
      FROM events e LEFT JOIN bookings b ON b.event_id = e.id
      GROUP BY e.id ORDER BY e.starts_at, e.id`),
    takenSeats: db.prepare('SELECT seat FROM bookings WHERE event_id = ? ORDER BY seat'),

    countUserSeats: db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND event_id = ?'),
    insertBooking: db.prepare('INSERT INTO bookings (user_id, event_id, seat) VALUES (?, ?, ?)'),
    deleteBooking: db.prepare('DELETE FROM bookings WHERE id = ? AND user_id = ?'),
    userBookings: db.prepare(`
      SELECT b.id, b.event_id, e.name AS event_name, b.seat, b.created_at
      FROM bookings b JOIN events e ON e.id = b.event_id
      WHERE b.user_id = ? ORDER BY b.id`),
  };

  // ---------- users ----------
  function createUser({ email, passwordHash, role = 'user' }) {
    try {
      const info = sql.insertUser.run(email, passwordHash, role);
      return { id: Number(info.lastInsertRowid), email, role };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ServiceError(409, 'EMAIL_TAKEN', 'This email is already registered');
      }
      throw err;
    }
  }

  function findUserByEmail(email) {
    return sql.userByEmail.get(email);
  }

  function findUserById(id) {
    return sql.userById.get(id);
  }

  // ---------- events ----------
  function createEvent({ name, venue, startsAt, totalSeats }) {
    const info = sql.insertEvent.run(name, venue, startsAt, totalSeats);
    return toEvent(sql.eventById.get(Number(info.lastInsertRowid)));
  }

  function listEvents() {
    return sql.allEvents.all().map(toEvent);
  }

  function getSeatMap(eventId) {
    const row = sql.eventById.get(eventId);
    if (!row) throw new ServiceError(404, 'EVENT_NOT_FOUND', 'Event not found');
    return {
      eventId: row.id,
      name: row.name,
      totalSeats: row.total_seats,
      takenSeats: sql.takenSeats.all(eventId).map((r) => r.seat),
    };
  }

  // ---------- bookings ----------
  // The heart of the project: book ONE seat, atomically.
  //
  //  - BEGIN IMMEDIATE takes the database write lock first, so the
  //    "count my seats -> insert" steps cannot interleave with another
  //    process doing the same thing (important with cluster workers).
  //  - UNIQUE (event_id, seat) guarantees a seat can never be booked twice,
  //    even if everything above failed.
  function bookSeat({ userId, eventId, seat }) {
    if (!Number.isInteger(seat) || seat < 1) {
      throw new ServiceError(400, 'INVALID_SEAT', 'Seat must be a positive whole number');
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const event = sql.eventById.get(eventId);
      if (!event) {
        throw new ServiceError(404, 'EVENT_NOT_FOUND', 'Event not found');
      }
      if (seat > event.total_seats) {
        throw new ServiceError(400, 'INVALID_SEAT', `Seat must be between 1 and ${event.total_seats}`);
      }

      const { n } = sql.countUserSeats.get(userId, eventId);
      if (n >= maxSeatsPerUser) {
        throw new ServiceError(403, 'SEAT_LIMIT', `You can hold at most ${maxSeatsPerUser} seats per event`);
      }

      let info;
      try {
        info = sql.insertBooking.run(userId, eventId, seat);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ServiceError(409, 'SEAT_TAKEN', 'This seat has already been booked');
        }
        throw err;
      }

      const booking = { id: Number(info.lastInsertRowid), eventId, seat };
      db.exec('COMMIT');
      return booking;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackErr) {
        // No active transaction to roll back; nothing else to do.
      }
      throw err;
    }
  }

  function cancelBooking({ bookingId, userId }) {
    // The "AND user_id = ?" part is the authorization check:
    // you can only cancel your own bookings.
    const info = sql.deleteBooking.run(bookingId, userId);
    if (info.changes === 0) {
      throw new ServiceError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }
  }

  function listUserBookings(userId) {
    return sql.userBookings.all(userId).map((r) => ({
      id: r.id,
      eventId: r.event_id,
      eventName: r.event_name,
      seat: r.seat,
      createdAt: r.created_at,
    }));
  }

  return {
    createUser,
    findUserByEmail,
    findUserById,
    createEvent,
    listEvents,
    getSeatMap,
    bookSeat,
    cancelBooking,
    listUserBookings,
  };
}

module.exports = { createStore, ServiceError };
