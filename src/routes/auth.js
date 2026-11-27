'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { asyncHandler } = require('../http');
const { parseRegistration, parseLogin } = require('../validate');
const { ServiceError } = require('../services/store');

function createAuthRouter({ store, auth, limiters, config, logger }) {
  const router = express.Router();

  // Used when the email does not exist, so a wrong email takes as long as a wrong
  // password (stops attackers from discovering which emails are registered).
  const dummyHash = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

  router.post('/register', limiters.register, asyncHandler(async (req, res) => {
    const { email, password } = parseRegistration(req.body);

    // [SECURITY #2] Passwords are stored as bcrypt HASHES (one-way), never as plain text.
    // The async version is used so the event loop is not blocked while hashing.
    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

    const user = store.createUser({ email, passwordHash });
    logger.info('user registered', { userId: user.id });
    res.status(201).json({ id: user.id, email: user.email });
  }));

  router.post('/login', limiters.login, asyncHandler(async (req, res) => {
    const { email, password } = parseLogin(req.body);

    const user = store.findUserByEmail(email);
    const passwordOk = await bcrypt.compare(password, user ? user.password_hash : dummyHash);

    if (!user || !passwordOk) {
      logger.warn('login failed', { ip: req.ip }); // never log the password
      // Same message for "no such user" and "wrong password".
      throw new ServiceError(401, 'BAD_CREDENTIALS', 'Invalid email or password');
    }

    res.json({
      token: auth.signToken(user),
      tokenType: 'Bearer',
      expiresIn: config.jwtExpiresIn,
    });
  }));

  return router;
}

module.exports = { createAuthRouter };
