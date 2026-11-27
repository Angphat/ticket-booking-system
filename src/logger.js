'use strict';

const winston = require('winston');

// [SCALABILITY: Monitoring and Logging] Winston with JSON logs (console + file).
// [SECURITY #9] Structured logs. Never log passwords, tokens or secrets.
function createLogger(config) {
  const transports = [new winston.transports.Console()];
  if (config.logFile) {
    transports.push(new winston.transports.File({ filename: config.logFile }));
  }

  return winston.createLogger({
    level: config.logLevel,
    silent: config.isTest,
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    defaultMeta: { pid: process.pid },
    transports,
  });
}

module.exports = { createLogger };
