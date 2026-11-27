'use strict';

const rateLimit = require('express-rate-limit');

// [SECURITY #3 Brute-force prevention, #5 DoS protection]
// [BOT PROTECTION] Booking is limited per USER, login/register per IP.
//
// Note: the counters live in each process's memory, so with N cluster workers the
// effective limit is up to N times higher. For an exact shared limit, use a Redis store
// (rate-limit-redis). See README "Limitations".
function createLimiters({ limits, logger }) {
  function make(name, options, extra = {}) {
    return rateLimit({
      windowMs: options.windowMs,
      limit: options.limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (req, res) => {
        logger.warn('rate limit exceeded', { limiter: name, ip: req.ip });
        res.status(429).json({
          error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
        });
      },
      ...extra,
    });
  }

  return {
    global: make('global', limits.global),
    // Only FAILED logins count, so normal users are never locked out by logging in successfully.
    login: make('login', limits.login, { skipSuccessfulRequests: true }),
    register: make('register', limits.register),
    // Must be placed AFTER requireAuth because it uses req.user.
    booking: make('booking', limits.booking, { keyGenerator: (req) => `user:${req.user.id}` }),
  };
}

module.exports = { createLimiters };
