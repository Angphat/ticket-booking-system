'use strict';

const jwt = require('jsonwebtoken');
const { ServiceError } = require('../services/store');

// [SECURITY #8 Authentication and Authorization]
function createAuth({ config, store }) {
  function signToken(user) {
    return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: config.jwtExpiresIn, // tokens expire
    });
  }

  // Authentication: who is calling?
  function requireAuth(req, res, next) {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return next(new ServiceError(401, 'UNAUTHENTICATED', 'Missing or malformed Authorization header'));
    }

    let payload;
    try {
      // Pin the algorithm so a forged token cannot choose its own ("alg: none" attack).
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch (err) {
      return next(new ServiceError(401, 'INVALID_TOKEN', 'Invalid or expired token'));
    }

    // Load the user from the database on every request: a deleted user or a changed
    // role takes effect immediately, we never trust the role stored inside the token.
    const user = store.findUserById(Number(payload.sub));
    if (!user) {
      return next(new ServiceError(401, 'INVALID_TOKEN', 'Invalid or expired token'));
    }

    req.user = { id: user.id, email: user.email, role: user.role };
    return next();
  }

  // Authorization: is this user allowed to do this? Checked on the server for every protected route.
  function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
      return next(new ServiceError(403, 'FORBIDDEN', 'Administrator access required'));
    }
    return next();
  }

  return { signToken, requireAuth, requireAdmin };
}

module.exports = { createAuth };
