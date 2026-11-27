"use strict";

// Race-condition demo: N different users try to book THE SAME seat at the same moment.
// Expected result: exactly ONE success (201) and N-1 conflicts (409), even when the server
// runs as several cluster workers.
//
// Usage:  npm run race            (15 users)
//         npm run race -- 30      (30 users, max 50)
// The server must be running and must use the same DB_FILE as this script.
const bcrypt = require("bcryptjs");
const { openDb } = require("../src/db");
const { createStore } = require("../src/services/store");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PASSWORD = "Race-Test-123";

async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  return { status: res.status, data, pid: res.headers.get("x-worker-pid") };
}

async function main() {
  const n = Math.min(
    Math.max(Number.parseInt(process.argv[2], 10) || 15, 2),
    50,
  );

  // Prepare users and a fresh event directly in the database (registration is rate limited on purpose).
  const db = openDb(process.env.DB_FILE || "./data/tickets.db");
  const store = createStore(db);
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const event = store.createEvent({
    name: `Race Test ${new Date().toISOString()}`,
    venue: "Test Arena",
    startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    totalSeats: 50,
  });
  const emails = [];
  for (let i = 1; i <= n; i += 1) {
    const email = `racer${i}@test.local`;
    if (!store.findUserByEmail(email))
      store.createUser({ email, passwordHash });
    emails.push(email);
  }
  db.close();

  // Log in a few users at a time. The login rate limit (10) counts requests that are still
  // being processed, and password hashing is slow, so 30 simultaneous logins would be
  // blocked by our own brute-force protection. Only the BOOKING step must be simultaneous.
  console.log(`Logging in ${n} users...`);
  const logins = [];
  for (let i = 0; i < emails.length; i += 5) {
    const batch = emails.slice(i, i + 5);
    logins.push(
      ...(await Promise.all(
        batch.map((email) =>
          post("/api/auth/login", { email, password: PASSWORD }),
        ),
      )),
    );
  }
  const tokens = logins.map((l) => l.data && l.data.token);
  if (tokens.some((t) => !t)) {
    const failed = logins.find((l) => !l.data || !l.data.token);
    console.error("Login failed:", failed.status, JSON.stringify(failed.data));
    if (failed.status === 429) {
      console.error(
        "The login rate limit is active (counters are kept in server memory).",
      );
      console.error(
        "Stop the server with Ctrl+C, start it again, then re-run this script.",
      );
    }
    process.exit(1);
  }

  console.log(
    `${n} users book seat #1 of event ${event.id} at the same moment...`,
  );
  const results = await Promise.all(
    tokens.map((t) => post(`/api/events/${event.id}/book`, { seat: 1 }, t)),
  );

  const byStatus = {};
  const workers = new Set();
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.pid) workers.add(r.pid);
  }

  console.log("\nResults by HTTP status:", byStatus);
  console.log(
    `Answered by ${workers.size} different process(es): ${[...workers].join(", ")}`,
  );

  const successes = byStatus[201] || 0;
  if (successes === 1 && (byStatus[409] || 0) === n - 1) {
    console.log("\nPASS: exactly one booking succeeded, no double booking.");
  } else {
    console.log(
      "\nCHECK: expected 1x201 and the rest 409. See the status counts above.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
