import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, parsePhone, formatPhone, guessCountry } from '../src/lib/phone.js';

test('normalizePhone strips everything except digits', () => {
  assert.equal(normalizePhone('+92 332-040 7479'), '923320407479');
  assert.equal(normalizePhone('(0332) 0407479'), '03320407479');
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone(3320407479), '3320407479');
});

test('parsePhone validates length', () => {
  assert.deepEqual(parsePhone('03320407479'), { ok: true, number: '03320407479' });
  assert.equal(parsePhone('12').ok, false);
  assert.equal(parsePhone('1'.repeat(16)).ok, false);
  assert.equal(parsePhone('abc').ok, false);
  assert.equal(parsePhone('').ok, false);
});

test('formatPhone groups common Pakistani and Indian formats', () => {
  assert.equal(formatPhone('03320407479'), '0332 0407479');
  assert.equal(formatPhone('923320407479'), '+92 332 0407479');
  assert.equal(formatPhone('919876543210'), '+91 98765 43210');
  assert.equal(formatPhone('9876543210'), '98765 43210');
  assert.equal(formatPhone('1234567'), '1234567');
});

test('guessCountry recognises PK and IN prefixes', () => {
  assert.equal(guessCountry('03320407479'), 'Pakistan');
  assert.equal(guessCountry('923320407479'), 'Pakistan');
  assert.equal(guessCountry('919876543210'), 'India');
  assert.equal(guessCountry('9876543210'), 'India');
  assert.equal(guessCountry('1234567'), '');
});
