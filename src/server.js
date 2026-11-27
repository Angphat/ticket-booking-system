'use strict';

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { openDb } = require('./db');
const { createStore } = require('./services/store');
const { createCache } = require('./cache');
const { createApp } = require('./app');

async function start() {
  const config = loadConfig();
  const logger = createLogger(config);

  const db = openDb(config.dbFile);
  const store = createStore(db, { maxSeatsPerUser: config.maxSeatsPerUser });
  const cache = await createCache({ redisUrl: config.redisUrl, logger });
  const app = createApp({ store, cache, config, logger });

  const server = app.listen(config.port, () => {
    logger.info(`server listening on port ${config.port}`, { cache: cache.kind });
  });

  // [SECURITY #5] Timeouts so slow clients cannot hold connections forever (slowloris).
  server.headersTimeout = 10 * 1000;
  server.requestTimeout = 15 * 1000;

  // Graceful shutdown: stop taking new connections, finish current ones, then exit.
  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received, shutting down`);
    setTimeout(() => process.exit(1), 10 * 1000).unref();
    server.close(async () => {
      await cache.close();
      db.close();
      process.exit(0);
    });
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// Run directly with "node src/server.js". When loaded by cluster.js or tests, nothing starts by itself.
if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = { start };
