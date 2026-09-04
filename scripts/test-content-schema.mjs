/**
 * Smoke tests — js/core/contentSchema.js (Smart Booking normalize).
 * Run: node scripts/test-content-schema.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = readFileSync(path.join(root, 'js/core/contentSchema.js'), 'utf8');
const sandbox = { window: {}, globalThis: {}, console };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.runInNewContext(src, sandbox, { filename: 'contentSchema.js' });

const normalize = sandbox.DFOPS_normalizeBookingSettings;
assert.ok(typeof normalize === 'function', 'DFOPS_normalizeBookingSettings exported');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('✓', name);
  } catch (e) {
    console.error('✗', name);
    console.error(' ', e.message || e);
    process.exitCode = 1;
  }
}

test('null / non-object is a no-op', () => {
  normalize(null);
  normalize(undefined);
  normalize('x');
});

test('legacy bookingUrl + booksyUrl collapse to booking_url', () => {
  const pl = { contact: { bookingUrl: ' https://booksy.com/x ', booksyUrl: 'https://ignored.example' } };
  normalize(pl);
  assert.equal(pl.contact.booking_url, 'https://booksy.com/x');
  assert.equal(pl.contact.bookingUrl, 'https://booksy.com/x');
  assert.equal(pl.contact.booksyUrl, 'https://booksy.com/x');
  assert.equal(pl.contact.booksyIframeUrl, '');
});

test('empty URL → schedule; Calendly → embed; other URL → button', () => {
  const empty = { contact: {} };
  normalize(empty);
  assert.equal(empty.settings.booking_mode, 'schedule');

  const cal = { contact: { booking_url: 'https://calendly.com/studio' } };
  normalize(cal);
  assert.equal(cal.settings.booking_mode, 'embed');

  const booksy = { contact: { booking_url: 'https://booksy.com/pl' } };
  normalize(booksy);
  assert.equal(booksy.settings.booking_mode, 'button');
});

test('valid booking_mode is preserved', () => {
  const pl = { contact: { booking_url: 'https://calendly.com/x' }, settings: { booking_mode: 'both' } };
  normalize(pl);
  assert.equal(pl.settings.booking_mode, 'both');
});

if (process.exitCode) {
  console.error('Failed.');
  process.exit(process.exitCode);
}
console.log(`\n${passed} tests passed.`);
