'use strict';

const express = require('express');
const helmet = require('helmet');
const { ServiceError } = require('./services/store');
const { createAuth } = require('./middleware/auth');
const { createLimiters } = require('./middleware/limiters');
const { createAuthRouter } = require('./routes/auth');
const { createEventsRouter } = require('./routes/events');
const { createBookingsRouter } = require('./routes/bookings');

// The app is built by a factory function so tests can create it with an in-memory
// database, a fake cache and different limits.
function createApp({ store, cache, config, logger, limits }) {
  const app = express();
  const limiters = createLimiters({ limits: { ...config.limits, ...limits }, logger });
  const auth = createAuth({ config, store });

  app.disable('x-powered-by'); // do not advertise the framework
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  // [SECURITY #7] Secure HTTP headers (CSP, nosniff, HSTS, frameguard, ...) with Helmet.
  app.use(helmet());

  // [SCALABILITY: Monitoring and Logging] one structured log line per request.
  // X-Worker-Pid shows WHICH cluster worker answered, handy to prove load is shared.
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.set('X-Worker-Pid', String(process.pid));
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info('request', {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms: Math.round(ms * 10) / 10,
      });
    });
    next();
  });

  // [SECURITY #5] Request bodies are limited to 10 KB.
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', pid: process.pid, cache: cache.kind });
  });

  app.use('/api', limiters.global);
  app.use('/api/auth', createAuthRouter({ store, auth, limiters, config, logger }));
  app.use('/api/events', createEventsRouter({ store, cache, auth, limiters, config, logger }));
  app.use('/api/bookings', createBookingsRouter({ store, cache, auth, logger }));

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // [SCALABILITY: Error Handling] / [SECURITY #7] central error handler.
  // Clients get a short message; stack traces only go to the log, never to the response.
  app.use((err, req, res, next) => {
    if (err instanceof ServiceError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'Request body is too large' } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
    }
    logger.error('unhandled error', { message: err.message, stack: err.stack });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  return app;
}

module.exports = { createApp };
