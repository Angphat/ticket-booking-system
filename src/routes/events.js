'use strict';

const express = require('express');
const { asyncHandler } = require('../http');
const { EVENTS_CACHE_KEY } = require('../cache');
const { parseId, parseSeat, parseEventInput } = require('../validate');

function createEventsRouter({ store, cache, auth, limiters, config, logger }) {
  const router = express.Router();

  // [SCALABILITY: Caching] The event list is read far more often than it changes.
  // First request -> database (X-Cache: MISS), next requests -> cache (X-Cache: HIT).
  router.get('/', asyncHandler(async (req, res) => {
    const cached = await cache.get(EVENTS_CACHE_KEY);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json({ events: cached });
    }

    const events = store.listEvents();
    await cache.set(EVENTS_CACHE_KEY, events, config.cacheTtlSeconds);
    res.set('X-Cache', 'MISS');
    return res.json({ events });
  }));

  // Not cached: the seat map must always be accurate.
  router.get('/:id/seats', (req, res) => {
    const eventId = parseId(req.params.id, 'event id');
    res.json(store.getSeatMap(eventId));
  });

  router.post('/', auth.requireAuth, auth.requireAdmin, asyncHandler(async (req, res) => {
    const input = parseEventInput(req.body);
    const event = store.createEvent(input);
    await cache.del(EVENTS_CACHE_KEY); // the cached list is now out of date
    logger.info('event created', { eventId: event.id, by: req.user.id });
    res.status(201).json({ event });
  }));

  router.post('/:id/book', auth.requireAuth, limiters.booking, asyncHandler(async (req, res) => {
    const eventId = parseId(req.params.id, 'event id');
    const seat = parseSeat(req.body);

    try {
      const booking = store.bookSeat({ userId: req.user.id, eventId, seat });
      await cache.del(EVENTS_CACHE_KEY); // seat counts changed
      logger.info('seat booked', { userId: req.user.id, eventId, seat });
      res.status(201).json({ booking });
    } catch (err) {
      if (err.code === 'SEAT_TAKEN') {
        logger.warn('double booking prevented', { userId: req.user.id, eventId, seat });
      }
      throw err;
    }
  }));

  return router;
}

module.exports = { createEventsRouter };
