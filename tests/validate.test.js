'use strict';

// [SECURITY #1] Input validation tests: wrong types, wrong sizes, hostile input.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRegistration, parseLogin, parseId, parseSeat, parseEventInput,
} = require('../src/validate');

function rejects(fn) {
  assert.throws(fn, (err) => {
    assert.equal(err.status, 400);
    assert.equal(err.code, 'VALIDATION_ERROR');
    return true;
  });
}

describe('validation', () => {
  it('accepts a valid registration and normalizes the email', () => {
    const r = parseRegistration({ email: '  Alice@Example.COM ', password: 'Correct-Horse-1' });
    assert.equal(r.email, 'alice@example.com');
    assert.equal(r.password, 'Correct-Horse-1');
  });

  it('rejects bad emails', () => {
    for (const email of ['', 'no-at-sign', 'a@b', 'a b@c.com', 'a@@c.com', 'x'.repeat(300) + '@a.com']) {
      rejects(() => parseRegistration({ email, password: 'Correct-Horse-1' }));
    }
  });

  it('rejects short or too long passwords (bcrypt only reads 72 bytes)', () => {
    rejects(() => parseRegistration({ email: 'a@b.com', password: 'short' }));
    rejects(() => parseRegistration({ email: 'a@b.com', password: 'x'.repeat(73) }));
    rejects(() => parseRegistration({ email: 'a@b.com', password: 'ก'.repeat(30) })); // 90 bytes
  });

  it('rejects non-string values such as injection objects, arrays and numbers', () => {
    rejects(() => parseLogin({ email: { $ne: null }, password: 'x' }));
    rejects(() => parseLogin({ email: 'a@b.com', password: { $gt: '' } }));
    rejects(() => parseLogin({ email: ['a@b.com'], password: 'x' }));
    rejects(() => parseRegistration({ email: 'a@b.com', password: 12345678 }));
    rejects(() => parseRegistration(null));
    rejects(() => parseRegistration('a string'));
    rejects(() => parseRegistration([]));
  });

  it('parses ids strictly', () => {
    assert.equal(parseId('42', 'id'), 42);
    for (const bad of ['0', '-1', '1.5', 'abc', '', '1e3', '12345678901', undefined, 5]) {
      rejects(() => parseId(bad, 'id'));
    }
  });

  it('parses seats strictly', () => {
    assert.equal(parseSeat({ seat: 7 }), 7);
    for (const seat of [0, -3, 1.5, '7', null, undefined, NaN]) {
      rejects(() => parseSeat({ seat }));
    }
    rejects(() => parseSeat(undefined));
  });

  it('parses event input and normalizes the date', () => {
    const e = parseEventInput({ name: ' Rock Night ', venue: 'Arena', startsAt: '2030-05-01T19:00:00Z', totalSeats: 50 });
    assert.equal(e.name, 'Rock Night');
    assert.equal(e.startsAt, '2030-05-01T19:00:00.000Z');
    assert.equal(e.totalSeats, 50);
  });

  it('rejects bad event input (HTML in text, bad date, bad seat count)', () => {
    const ok = { name: 'N', venue: 'V', startsAt: '2030-05-01T19:00:00Z', totalSeats: 10 };
    rejects(() => parseEventInput({ ...ok, name: '<script>alert(1)</script>' }));
    rejects(() => parseEventInput({ ...ok, name: '' }));
    rejects(() => parseEventInput({ ...ok, venue: 'x'.repeat(101) }));
    rejects(() => parseEventInput({ ...ok, startsAt: 'not a date' }));
    rejects(() => parseEventInput({ ...ok, startsAt: 123 }));
    rejects(() => parseEventInput({ ...ok, totalSeats: 0 }));
    rejects(() => parseEventInput({ ...ok, totalSeats: 10001 }));
    rejects(() => parseEventInput({ ...ok, totalSeats: '10' }));
  });
});
