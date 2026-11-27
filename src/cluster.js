'use strict';

const cluster = require('node:cluster');
const os = require('node:os');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { openDb } = require('./db');

// [SCALABILITY: Efficient Use of Resources -> Cluster Module]
// One Node.js process uses ONE CPU core. The primary process starts one worker per core;
// all workers share the same port and the primary spreads incoming connections between
// them (round-robin). That is built-in load balancing inside a single machine.
if (cluster.isPrimary) {
  const config = loadConfig(); // fail fast on bad config before starting workers
  const logger = createLogger(config);

  // Create the database file and tables ONCE, before the workers start using it.
  openDb(config.dbFile).close();

  const count = config.workers > 0 ? config.workers : os.availableParallelism();
  let shuttingDown = false;
  logger.info(`primary ${process.pid} starting ${count} workers`);
  if (count > 1 && !config.redisUrl) {
    logger.warn('REDIS_URL is not set: each worker keeps its own in-memory cache, so cache hits are not shared between workers');
  }

  for (let i = 0; i < count; i += 1) cluster.fork();

  // Self-healing: if a worker crashes, start a new one.
  cluster.on('exit', (worker, code, signal) => {
    logger.warn('worker exited', { workerPid: worker.process.pid, code, signal });
    if (shuttingDown) {
      const alive = Object.values(cluster.workers).filter(Boolean).length;
      if (alive === 0) process.exit(0);
      return;
    }
    setTimeout(() => cluster.fork(), 1000);
  });

  const stop = () => {
    shuttingDown = true;
    for (const worker of Object.values(cluster.workers)) {
      if (worker) worker.process.kill('SIGTERM');
    }
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} else {
  require('./server')
    .start()
    .catch((err) => {
      console.error('Worker failed to start:', err.message);
      process.exit(1);
    });
}
