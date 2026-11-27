'use strict';

// Express 4 does not catch rejected promises from async handlers by itself.
// This wrapper forwards them to the central error handler.
// [SCALABILITY: Error Handling] one place for all errors, the app does not crash.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
