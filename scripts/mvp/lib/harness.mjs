// ============================================================================
// QF-MVP-00 — Tiny, dependency-free assertion harness for the MVP test runner.
//
// Deterministic and offline: no I/O, no clock-dependent behaviour, no globals
// beyond JSON/Object. Suites import these helpers and throw AssertionError on a
// failed expectation; the runner (run.mjs) catches, tallies, and reports.
// ============================================================================

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

function fmt(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (value instanceof Uint8Array) return `Uint8Array(${value.length})[${Array.from(value).join(',')}]`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

export function assert(condition, message) {
  if (!condition) throw new AssertionError(message || 'expected condition to be truthy');
}

export function assertEqual(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    throw new AssertionError(`${message || 'assertEqual'}: expected ${fmt(expected)} but got ${fmt(actual)}`);
  }
}

export function assertNotEqual(actual, forbidden, message) {
  if (Object.is(actual, forbidden)) {
    throw new AssertionError(`${message || 'assertNotEqual'}: expected value to differ from ${fmt(forbidden)}`);
  }
}

export function assertDeepEqual(actual, expected, message) {
  if (!deepEqual(actual, expected)) {
    throw new AssertionError(`${message || 'assertDeepEqual'}: expected ${fmt(expected)} but got ${fmt(actual)}`);
  }
}

export function assertMatch(value, regex, message) {
  if (typeof value !== 'string' || !regex.test(value)) {
    throw new AssertionError(`${message || 'assertMatch'}: ${fmt(value)} does not match ${regex}`);
  }
}

export function assertTrue(value, message) {
  assertEqual(value, true, message || 'expected exactly true');
}

export function assertFalse(value, message) {
  assertEqual(value, false, message || 'expected exactly false');
}
