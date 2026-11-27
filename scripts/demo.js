'use strict';

// Walks through the main features against a RUNNING server and prints readable results,
// so you can take screenshots for your report.
//
// Usage:  npm run demo                 (normal demo)
//         npm run demo -- --bruteforce (also triggers the login rate limit)
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = 'Demo-Pass-12345';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = text;
    }
  }
  return { status: res.status, headers: res.headers, data };
}

function show(title, r, extra = '') {
  const body = JSON.stringify(r.data);
  console.log(`\n>> ${title}`);
  console.log(`   HTTP ${r.status}${extra}  ${body && body.length > 160 ? `${body.slice(0, 160)}...` : body || ''}`);
}

async function main() {
  const health = await call('GET', '/health');
  show('GET /health', health);

  const first = await call('GET', '/api/events');
  show('GET /api/events (first call)', first, `  X-Cache: ${first.headers.get('x-cache')}`);
  const second = await call('GET', '/api/events');
  const cacheNote = second.headers.get('x-cache') === 'HIT'
    ? '   <- served from cache'
    : '   <- MISS: with the in-memory cache every cluster worker has its own copy. Use Redis (REDIS_URL) or "npm start" to see HIT.';
  show('GET /api/events (second call)', second, `  X-Cache: ${second.headers.get('x-cache')}${cacheNote}`);

  const events = (second.data && second.data.events) || [];
  if (events.length === 0) {
    console.log('\nNo events found. Run "npm run seed" first, then run the demo again.');
    return;
  }
  const eventId = events[0].id;

  const stamp = Date.now();
  const alice = `alice+${stamp}@demo.local`;
  const bob = `bob+${stamp}@demo.local`;

  show('Register Alice', await call('POST', '/api/auth/register', { body: { email: alice, password: PASSWORD } }));
  show('Register Bob', await call('POST', '/api/auth/register', { body: { email: bob, password: PASSWORD } }));
  show('Register with a weak password', await call('POST', '/api/auth/register', {
    body: { email: `weak+${stamp}@demo.local`, password: '123' },
  }));

  const aliceLogin = await call('POST', '/api/auth/login', { body: { email: alice, password: PASSWORD } });
  const bobLogin = await call('POST', '/api/auth/login', { body: { email: bob, password: PASSWORD } });
  show('Alice logs in', { ...aliceLogin, data: { token: '(hidden)' } });
  const aliceToken = aliceLogin.data && aliceLogin.data.token;
  const bobToken = bobLogin.data && bobLogin.data.token;

  // Pick a random seat so the demo can be run many times.
  const seat = 1 + Math.floor(Math.random() * events[0].totalSeats);

  show('Book without a token', await call('POST', `/api/events/${eventId}/book`, { body: { seat } }));
  show(`Alice books seat ${seat}`, await call('POST', `/api/events/${eventId}/book`, { token: aliceToken, body: { seat } }));
  show(`Bob tries the SAME seat ${seat}`, await call('POST', `/api/events/${eventId}/book`, { token: bobToken, body: { seat } }));
  show('Bob (not an admin) tries to create an event', await call('POST', '/api/events', {
    token: bobToken,
    body: { name: 'Hack', venue: 'X', startsAt: '2030-01-01T00:00:00Z', totalSeats: 10 },
  }));
  show('Alice lists her bookings', await call('GET', '/api/bookings/me', { token: aliceToken }));

  const events2 = await call('GET', '/api/events');
  show('GET /api/events after booking', events2, `  X-Cache: ${events2.headers.get('x-cache')}   (MISS expected: the booking cleared the cache)`);

  const h = health.headers;
  console.log('\n>> Security headers set by Helmet');
  console.log(`   x-content-type-options: ${h.get('x-content-type-options')}`);
  console.log(`   x-frame-options: ${h.get('x-frame-options')}`);
  console.log(`   content-security-policy: ${(h.get('content-security-policy') || '').slice(0, 60)}...`);
  console.log(`   x-powered-by: ${h.get('x-powered-by')}   (null = hidden)`);
  console.log(`   x-worker-pid: ${h.get('x-worker-pid')}   (process that answered)`);

  if (process.argv.includes('--bruteforce')) {
    console.log('\n>> Brute-force simulation: wrong passwords for the same account until the server blocks us');
    let blockedAt = 0;
    for (let i = 1; i <= 60 && !blockedAt; i += 1) {
      const r = await call('POST', '/api/auth/login', { body: { email: alice, password: `wrong-${i}` } });
      if (i <= 12 || r.status === 429) console.log(`   attempt ${String(i).padStart(2)} -> HTTP ${r.status}`);
      if (r.status === 429) blockedAt = i;
    }
    if (blockedAt) {
      console.log(`   Blocked by the rate limiter at attempt ${blockedAt}. Restart the server to reset the counter.`);
      console.log('   (With "npm start" this is attempt 11. In cluster mode every worker counts separately, so it takes longer.)');
    } else {
      console.log('   Not blocked within 60 attempts. Is the login limit configured too high?');
    }
  }
}

main().catch((err) => {
  console.error('Demo failed. Is the server running? ', err.message);
  process.exit(1);
});
