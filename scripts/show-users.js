'use strict';

// Shows what is really stored in the users table.
// Evidence for "passwords are stored as bcrypt hashes, never as plain text".
// Usage: npm run users
const { openDb } = require('../src/db');

const db = openDb(process.env.DB_FILE || './data/tickets.db');
const rows = db.prepare('SELECT id, email, role, password_hash FROM users ORDER BY id LIMIT 10').all();

if (rows.length === 0) {
  console.log('No users yet. Run "npm run seed" or register one first.');
} else {
  for (const row of rows) {
    console.log(`#${row.id}  ${row.email}  (${row.role})`);
    console.log(`     password_hash: ${row.password_hash}`);
  }
  console.log('\nThe password_hash column holds a one-way bcrypt hash ($2a$10$...), never the password itself.');
}
db.close();
