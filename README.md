# Event Ticket Booking API

**Author:** [Royhan Phattanawiwat] · **Course:** [Web Programming] · **Repository:** [YOUR GITHUB REPO URL]

A REST API for booking numbered seats at events, written in Node.js (Express). It is a **personal project built to apply three assigned articles** to one real application:

| #   | Assigned article                                                                                                                                | Applied in this project       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | [Node.js CI/CD – W3Schools](https://www.w3schools.com/nodejs/nodejs_ci_cd.asp)                                                                  | [CI/CD](#1-cicd)              |
| 2   | [Security Practices for Node.js Applications – GeeksforGeeks](https://www.geeksforgeeks.org/node-js/best-security-practices-in-node-js/)        | [Security](#2-security)       |
| 3   | [Building Scalable Applications with NodeJS – GeeksforGeeks](https://www.geeksforgeeks.org/node-js/building-scalable-applications-with-nodejs/) | [Scalability](#3-scalability) |

**Why a ticket-booking system?** It naturally needs all three topics: many people fight for the same seat at the same moment (scalability), accounts and bots must be controlled (security), and the "never sell a seat twice" rule must be protected by automated tests on every change (CI/CD).

---

## Quick start

Requires **Node.js 22.13 or newer** (the app uses the built-in `node:sqlite` module).

```bash
npm install                 # installs dependencies and creates package-lock.json
cp .env.example .env        # then edit .env and set JWT_SECRET
npm test                    # 46 tests
npm run seed                # creates an admin account and 3 sample events
npm start                   # single process on http://localhost:3000
# or
npm run start:cluster       # one worker per CPU core
```

With Docker (app + Redis, cluster mode):

```bash
docker compose up --build
docker compose exec app node scripts/seed.js
```

Try it while the server is running:

```bash
npm run demo                  # walks through register, login, booking, conflicts, headers
npm run demo -- --bruteforce  # also triggers the login rate limit
npm run race -- 20            # 20 users book the SAME seat at the same moment
npm run users                 # shows the stored bcrypt password hashes
```

## API

| Method & path               | Auth  | Description                                                                    |
| --------------------------- | ----- | ------------------------------------------------------------------------------ |
| `GET /health`               | –     | Status, process id, cache type                                                 |
| `POST /api/auth/register`   | –     | `{email, password}` → 201                                                      |
| `POST /api/auth/login`      | –     | `{email, password}` → `{token}` (JWT)                                          |
| `GET /api/events`           | –     | Event list with seats taken/available (**cached**, header `X-Cache: HIT/MISS`) |
| `GET /api/events/:id/seats` | –     | Taken seat numbers (always live)                                               |
| `POST /api/events`          | admin | Create an event                                                                |
| `POST /api/events/:id/book` | user  | `{seat}` → 201, or 409 if the seat is taken                                    |
| `GET /api/bookings/me`      | user  | My bookings                                                                    |
| `DELETE /api/bookings/:id`  | owner | Cancel my booking (someone else's booking → 404)                               |

## Project structure

```
src/
  config.js            settings and secrets from environment variables
  logger.js            Winston structured logging
  db.js                SQLite schema (UNIQUE(event_id, seat) prevents double booking)
  cache.js             Redis cache with in-memory fallback
  validate.js          input validation
  http.js              async error wrapper
  app.js               Express app: Helmet, body limit, rate limits, routes, error handler
  server.js            single-process entry point + graceful shutdown
  cluster.js           multi-process entry point (cluster module)
  middleware/          auth.js (JWT, roles), limiters.js (rate limiting)
  routes/              auth.js, events.js, bookings.js
  services/store.js    all database access and the booking logic
scripts/               seed.js, demo.js, race-test.js
tests/                 store, concurrency, validate, cache-config, api
.github/workflows/ci.yml    CI/CD pipeline
Dockerfile, docker-compose.yml
```

---

## 1. CI/CD

Article: _Node.js CI/CD (W3Schools)_. Pipeline: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

| Concept from the article                                                    | Where it is in this project                                                                                                                                                        |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Continuous Integration** – build and test on every push                   | Job `test` runs on every push and pull request to `main`                                                                                                                           |
| **GitHub Actions** as the tool                                              | `.github/workflows/ci.yml`                                                                                                                                                         |
| Basic workflow: checkout → setup-node → install → test                      | Same steps, using `actions/checkout@v4` and `actions/setup-node@v4`                                                                                                                |
| **Matrix builds** over several Node versions                                | Node `22.x` and `24.x` (the article shows 16/18/20; this app needs ≥ 22.13 for `node:sqlite`)                                                                                      |
| **Caching** dependencies                                                    | `cache: npm` in `setup-node`                                                                                                                                                       |
| `npm ci` instead of `npm install`                                           | "Install dependencies" step (needs the committed `package-lock.json`)                                                                                                              |
| **Linting** step                                                            | `npm run lint` (ESLint, `eslint.config.js`)                                                                                                                                        |
| **Test** step                                                               | `npm test` (Node's built-in test runner, 46 tests, in-memory database so tests are isolated)                                                                                       |
| **Security scan** (`npm audit`)                                             | `npm audit --omit=dev --audit-level=high`                                                                                                                                          |
| **Continuous Delivery** – always deployable                                 | Job `deploy-staging` builds the Docker image and pushes it to GitHub Container Registry (`:staging` and `:<commit sha>`), only on `main` and only after tests pass (`needs: test`) |
| **Continuous Deployment** with **manual approval** for production           | Job `promote-production` uses the `production` environment; add _required reviewers_ in Settings → Environments to make it wait for approval                                       |
| **Environment strategy** Development → Testing → Staging → Production       | local → `test` job → `staging` environment → `production` environment                                                                                                              |
| **Docker**: version tags, multi-stage build, non-root user, `.dockerignore` | [`Dockerfile`](Dockerfile) (`node:22-alpine`, two stages, `USER node`), [`.dockerignore`](.dockerignore)                                                                           |
| **Docker Compose** for local development, including Redis                   | [`docker-compose.yml`](docker-compose.yml)                                                                                                                                         |
| Pin Node version                                                            | `.nvmrc`, `engines` in `package.json`, matrix, Docker tag                                                                                                                          |
| Store secrets securely                                                      | `.env` is git-ignored; CI uses `secrets.GITHUB_TOKEN` only                                                                                                                         |
| Monitor build time and success rate                                         | Visible in the GitHub _Actions_ tab                                                                                                                                                |

**What the tests protect (the "booking logic must never sell a seat twice" rule):**
`tests/store.test.js` (13 tests: double booking, invalid seats, per-user limit, cancel rules, SQL-injection text), `tests/concurrency.test.js` (separate OS processes race for the same seat on one database file: exactly one wins), `tests/api.test.js` (16 end-to-end HTTP tests: auth, authorization, caching, headers, rate limits), `tests/validate.test.js`, `tests/cache-config.test.js`.

Not applied: Jenkins, GitLab CI, CircleCI (only GitHub Actions is used), container vulnerability scanning, deployment to a real server (the pipeline publishes the image to a registry).

## 2. Security

Article: _Security Practices for Node.js Applications (GeeksforGeeks)_, sections 1–9.

| #   | Article section                                                                                  | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Application security controls** – supported versions, validate input, keep secrets out of code | `engines` + CI matrix use current Node versions. Every request field is type-checked and length-checked in [`src/validate.js`](src/validate.js). Secrets come from environment variables ([`src/config.js`](src/config.js)); the app refuses to start without `JWT_SECRET` (and requires ≥ 32 characters in production).                                                                                                                           |
| 2   | **Passwords and database protection** – hash with bcrypt/Argon2, least privilege                 | Passwords are stored only as **bcrypt hashes** (`bcryptjs`, cost 10) in [`src/routes/auth.js`](src/routes/auth.js); the async API is used so the event loop is not blocked. Login compares against a dummy hash when the email is unknown, so wrong-email and wrong-password look the same (same message, similar timing). _Least-privilege DB accounts do not apply to a single-file SQLite database._ Password-reset tokens are not implemented. |
| 3   | **Brute-force prevention** – rate limits on login                                                | `express-rate-limit` in [`src/middleware/limiters.js`](src/middleware/limiters.js): 10 failed logins per 15 min per IP (successful logins are not counted), 20 registrations per hour. Returns HTTP 429. _MFA and progressive delays are not implemented._                                                                                                                                                                                         |
| 4   | **XSS protection**                                                                               | The API only returns JSON (no HTML pages). Free-text fields reject `<` and `>`. Helmet sends a Content-Security-Policy. No cookies are used (the JWT travels in the `Authorization` header).                                                                                                                                                                                                                                                       |
| 5   | **DoS protection** – rate limits, body-size limits, timeouts, safe regex                         | Global limit 120 requests/min per IP; booking limit 20/min **per user**; `express.json({limit: '10kb'})` (→ 413); `headersTimeout` 10 s and `requestTimeout` 15 s in [`src/server.js`](src/server.js); the only regexes are simple and bounded (email, ids).                                                                                                                                                                                       |
| 6   | **NoSQL injection protection** (this project uses SQL, same principle)                           | Every query uses bound parameters (`?`) in [`src/services/store.js`](src/services/store.js), never string concatenation. Request fields must be the expected type, so `{"$ne": null}` is rejected with 400 before reaching the database. Tested with injection strings.                                                                                                                                                                            |
| 7   | **Secure headers and connections**                                                               | **Helmet** (`app.use(helmet())`), `X-Powered-By` removed. Error responses never contain stack traces (they go to the log only). HTTPS must be terminated by the hosting platform / reverse proxy; set `TRUST_PROXY=1` behind one.                                                                                                                                                                                                                  |
| 8   | **Authentication and authorization**                                                             | JWT (HS256 pinned, 1 h expiry) in [`src/middleware/auth.js`](src/middleware/auth.js). The user is **re-loaded from the database on every request**, so deleted users and role changes take effect at once. Roles are checked on the server (`requireAdmin`); users can only cancel their own bookings. _Token revocation after a password change is not implemented (there is no password-change endpoint)._                                       |
| 9   | **Dependency and configuration security**                                                        | `npm audit` in CI; `.env` is git-ignored; structured logs with Winston that never contain passwords or tokens.                                                                                                                                                                                                                                                                                                                                     |

**Bot protection for ticketing:** booking is rate-limited per user, and one user can hold at most 4 seats per event (`MAX_SEATS_PER_USER`). This check runs inside a database transaction, so it also holds when many requests arrive at once.

## 3. Scalability

Article: _Building Scalable Applications with NodeJS (GeeksforGeeks)_.

| Article section                                   | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Asynchronous, non-blocking I/O**                | HTTP handling and bcrypt hashing are asynchronous. _Trade-off:_ the built-in `node:sqlite` API is synchronous; queries take well under a millisecond, and the cluster (below) keeps other workers responsive.                                                                                                                                                                                                                   |
| **Efficient use of resources → Cluster module**   | [`src/cluster.js`](src/cluster.js): a primary process forks one worker per CPU core (`WORKERS` to override). Workers share one port and the primary distributes connections round-robin (on Linux and macOS; on Windows the operating system distributes them). A crashed worker is restarted. The `redis` package is loaded lazily, only when `REDIS_URL` is set.                                                              |
| **Modularization**                                | Config, logging, database, cache, validation, middleware, routes and services are separate modules (see _Project structure_).                                                                                                                                                                                                                                                                                                   |
| **Performance optimization → Caching with Redis** | [`src/cache.js`](src/cache.js): the event list is cached (`CACHE_TTL_SECONDS`, default 15 s) and the cache is cleared on every booking, cancellation or new event. `X-Cache: HIT/MISS` shows what happened. Uses the promise API of `node-redis` v4 (the article's callback style is the old v3 API). Falls back to an in-memory cache if Redis is not configured or unreachable. Seat availability (`/seats`) is never cached. |
| **Load balancing**                                | Done by the cluster module inside one machine (round-robin). The response header `X-Worker-Pid` shows which worker answered. Nginx is not used, see _Limitations_.                                                                                                                                                                                                                                                              |
| **Error handling**                                | Central Express error handler, `asyncHandler` forwards rejected promises to it, uniform JSON errors, graceful shutdown on SIGTERM/SIGINT, workers restarted after a crash.                                                                                                                                                                                                                                                      |
| **Security best practices**                       | See section 2.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Monitoring and logging**                        | Winston JSON logs to console and `logs/combined.log`, one line per request (method, URL, status, duration, process id), plus `GET /health`.                                                                                                                                                                                                                                                                                     |
| **Scalability strategies**                        | _Stateless:_ authentication uses JWT, so no worker keeps session state and any worker can serve any request. _Horizontal scaling:_ achieved across CPU cores. _Microservices:_ not applied (see _Limitations_).                                                                                                                                                                                                                 |
| **CI/CD**                                         | See section 1.                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Correct under concurrency.** Scaling is only useful if the result stays correct. A seat is protected twice: the booking runs inside `BEGIN IMMEDIATE` (one writer at a time across all processes, including the "max 4 seats" check), and the table has `UNIQUE (event_id, seat)` as a last line of defence.

**Demonstrations**

```bash
npm run start:cluster        # terminal 1
npm run race -- 30           # terminal 2
```

Example result: `30 users book seat #1 at the same moment` → `{ '201': 1, '409': 29 }`, answered by 3 different worker processes → `PASS`.

Optional load test of the cache (needs `npx autocannon`):

```bash
CACHE_TTL_SECONDS=0 npm start      # baseline: cache disabled
npx autocannon -c 50 -d 10 http://localhost:3000/api/events
npm start                          # cache enabled
npx autocannon -c 50 -d 10 http://localhost:3000/api/events
```

(Note: the global rate limit of 120 requests/min would block a load test; for the test, raise `limits.global` in `src/config.js` temporarily.)

## Testing

```bash
npm test        # all tests
npm run lint    # ESLint
```

| File                         | Tests | Covers                                                                          |
| ---------------------------- | ----- | ------------------------------------------------------------------------------- |
| `tests/store.test.js`        | 13    | booking rules, cancel rules, per-user limit, SQL-injection strings              |
| `tests/concurrency.test.js`  | 2     | several OS processes racing on one database file                                |
| `tests/validate.test.js`     | 8     | input validation, wrong types, hostile input                                    |
| `tests/cache-config.test.js` | 7     | cache TTL/delete/copy behaviour, configuration rules                            |
| `tests/api.test.js`          | 16    | HTTP end-to-end: auth, roles, cache HIT/MISS, headers, 413/400/404, rate limits |

## Limitations (honest notes)

- **SQLite is a single-machine database.** Clustering across CPU cores works because all workers share one file safely (WAL mode + transactions). Running several servers on different machines behind Nginx would require a network database such as PostgreSQL; that is outside the scope of this assignment.
- **Rate-limit counters are kept per worker** (in memory), so with N workers the real limit is up to N times higher (the demo shows the brute-force block at attempt 11 with `npm start` and later in cluster mode). A shared store such as `rate-limit-redis` would fix this.
- **In-memory cache is per worker.** With several workers, use Redis (`REDIS_URL`) so all workers share one cache; otherwise `X-Cache: HIT` may not appear. A cached list can be up to `CACHE_TTL_SECONDS` old on workers that did not see the change; the booking itself is never affected because it is checked against the database.
- `node:sqlite` is marked _experimental_ by Node.js (it prints a warning at start-up); its API is stable enough for this use but may change in future versions.
- Not implemented: web front-end, e-mail verification, password reset, MFA, payment.
- Microservices and PM2 from the scalability article were not used; the Node.js cluster module covers the same need on one machine.
