'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// The UNIQUE (event_id, seat) constraint is the final guard against double booking.
// Even if two processes try to insert the same seat at the same moment,
// the database lets exactly one of them succeed.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  venue       TEXT NOT NULL,
  starts_at   TEXT NOT NULL,
  total_seats INTEGER NOT NULL CHECK (total_seats BETWEEN 1 AND 10000),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  seat       INTEGER NOT NULL CHECK (seat >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id, seat)
);

CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id);
`;

function openDb(file) {
  const inMemory = file === ':memory:';
  if (!inMemory) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  const db = new DatabaseSync(file);
  // Wait up to 5s for a lock instead of failing instantly when several
  // processes (cluster workers) use the same file.
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  if (!inMemory) {
    // WAL mode lets many readers work while one writer writes.
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec(SCHEMA);
  return db;
}

function isUniqueViolation(err) {
  return Boolean(err) && /UNIQUE constraint failed/i.test(String(err.message));
}

module.exports = { openDb, isUniqueViolation };
