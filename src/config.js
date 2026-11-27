'use strict';

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

// [SECURITY #1/#9] All settings and secrets come from environment variables.
// Nothing secret is written in the source code.
function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  let jwtSecret = env.JWT_SECRET;
  if (!jwtSecret && isTest) {
    jwtSecret = 'test-only-secret-test-only-secret-0123456789';
  }
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set a long random value.');
  }
  if (isProd && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production.');
  }

  return {
    nodeEnv,
    isProd,
    isTest,
    port: toInt(env.PORT, 3000),
    dbFile: env.DB_FILE || './data/tickets.db',

    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '1h',
    bcryptRounds: isTest ? 4 : toInt(env.BCRYPT_ROUNDS, 10),

    // [SCALABILITY] Redis cache (optional) and cluster size
    redisUrl: env.REDIS_URL || '',
    cacheTtlSeconds: toInt(env.CACHE_TTL_SECONDS, 15),
    workers: toInt(env.WORKERS, 0), // 0 = one worker per CPU core
    trustProxy: toInt(env.TRUST_PROXY, 0),

    // Business rule that also slows down bots: max seats one user can hold per event
    maxSeatsPerUser: toInt(env.MAX_SEATS_PER_USER, 4),

    logLevel: env.LOG_LEVEL || 'info',
    logFile: isTest ? '' : (env.LOG_FILE ?? 'logs/combined.log'),

    // [SECURITY #3/#5] Rate limits (per IP, or per user for booking)
    limits: {
      global: { windowMs: 60 * 1000, limit: 120 },
      login: { windowMs: 15 * 60 * 1000, limit: 10 },
      register: { windowMs: 60 * 60 * 1000, limit: 20 },
      booking: { windowMs: 60 * 1000, limit: 20 },
    },
  };
}

module.exports = { loadConfig };
