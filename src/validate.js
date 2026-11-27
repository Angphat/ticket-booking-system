'use strict';

const { ServiceError } = require('./services/store');

// [SECURITY #1/#6] Validate every piece of untrusted input: check the TYPE first
// (a JSON body can contain objects/arrays instead of strings), then the length and format.

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function bad(message) {
  return new ServiceError(400, 'VALIDATION_ERROR', message);
}

function asObject(body) {
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

function cleanString(value, label, min, max) {
  if (typeof value !== 'string') throw bad(`${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw bad(`${label} must be ${min}-${max} characters`);
  }
  // Defense in depth against stored XSS: clients must still escape output,
  // but we also refuse HTML angle brackets in free-text fields.
  if (/[<>]/.test(trimmed)) throw bad(`${label} must not contain < or >`);
  return trimmed;
}

function parseEmail(value) {
  if (typeof value !== 'string') throw bad('email must be a string');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw bad('email is not valid');
  return email;
}

// Registration: enforce the password policy.
function parseRegistration(body) {
  const data = asObject(body);
  const email = parseEmail(data.email);
  const { password } = data;
  if (typeof password !== 'string') throw bad('password must be a string');
  // bcrypt only uses the first 72 BYTES, so longer passwords are refused.
  const bytes = Buffer.byteLength(password, 'utf8');
  if (password.length < 8 || bytes > 72) throw bad('password must be 8-72 characters');
  return { email, password };
}

// Login: do not reveal the password policy, just require sane types/sizes.
function parseLogin(body) {
  const data = asObject(body);
  const email = parseEmail(data.email);
  const { password } = data;
  if (typeof password !== 'string' || password.length === 0 || password.length > 200) {
    throw bad('password is required');
  }
  return { email, password };
}

function parseId(value, label) {
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value) || Number(value) < 1) {
    throw bad(`${label} is not valid`);
  }
  return Number(value);
}

function parseSeat(body) {
  const { seat } = asObject(body);
  if (!Number.isInteger(seat) || seat < 1) throw bad('seat must be a positive integer');
  return seat;
}

function parseEventInput(body) {
  const data = asObject(body);
  const name = cleanString(data.name, 'name', 1, 100);
  const venue = cleanString(data.venue, 'venue', 1, 100);

  if (typeof data.startsAt !== 'string' || data.startsAt.length > 40) {
    throw bad('startsAt must be an ISO date string');
  }
  const time = Date.parse(data.startsAt);
  if (Number.isNaN(time)) throw bad('startsAt must be an ISO date string');

  const { totalSeats } = data;
  if (!Number.isInteger(totalSeats) || totalSeats < 1 || totalSeats > 10000) {
    throw bad('totalSeats must be an integer between 1 and 10000');
  }

  return { name, venue, startsAt: new Date(time).toISOString(), totalSeats };
}

module.exports = { parseRegistration, parseLogin, parseId, parseSeat, parseEventInput };
