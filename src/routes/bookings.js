'use strict';

const express = require('express');
const { asyncHandler } = require('../http');
const { EVENTS_CACHE_KEY } = require('../cache');
const { parseId } = require('../validate');

function createBookingsRouter({ store, cache, auth, logger }) {
  const router = express.Router();

  router.get('/me', auth.requireAuth, (req, res) => {
    res.json({ bookings: store.listUserBookings(req.user.id) });
  });

  // [SECURITY #8] Authorization: a user can only cancel THEIR OWN booking.
  // Someone else's booking id answers 404, exactly like a booking that does not exist.
  router.delete('/:id', auth.requireAuth, asyncHandler(async (req, res) => {
    const bookingId = parseId(req.params.id, 'booking id');
    store.cancelBooking({ bookingId, userId: req.user.id });
    await cache.del(EVENTS_CACHE_KEY);
    logger.info('booking cancelled', { userId: req.user.id, bookingId });
    res.status(204).end();
  }));

  return router;
}

module.exports = { createBookingsRouter };
