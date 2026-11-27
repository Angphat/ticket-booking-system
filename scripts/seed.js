'use strict';

// Creates the first admin account and a few sample events.
// Usage: npm run seed
const bcrypt = require('bcryptjs');
const { openDb } = require('../src/db');
const { createStore } = require('../src/services/store');

async function main() {
  const db = openDb(process.env.DB_FILE || './data/tickets.db');
  const store = createStore(db);

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';

  if (!email || password.length < 8) {
    console.log('Skipping admin: set ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars) in .env');
  } else if (store.findUserByEmail(email)) {
    console.log(`Admin already exists: ${email}`);
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    store.createUser({ email, passwordHash, role: 'admin' });
    console.log(`Admin created: ${email}`);
  }

  if (store.listEvents().length === 0) {
    const day = 24 * 60 * 60 * 1000;
    const samples = [
      { name: 'Bangkok Rock Night', venue: 'Impact Arena', offset: 14, totalSeats: 100 },
      { name: 'Jazz by the River', venue: 'Riverside Hall', offset: 21, totalSeats: 60 },
      { name: 'Tech Talk Live', venue: 'Siam Auditorium', offset: 30, totalSeats: 40 },
    ];
    for (const s of samples) {
      store.createEvent({
        name: s.name,
        venue: s.venue,
        startsAt: new Date(Date.now() + s.offset * day).toISOString(),
        totalSeats: s.totalSeats,
      });
    }
    console.log(`Created ${samples.length} sample events`);
  } else {
    console.log('Events already exist, not adding samples');
  }

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
