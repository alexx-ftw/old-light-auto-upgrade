'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const core = require('../docs/metrics-core.js');
const source = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, '../docs/metrics-core.js'), 'utf8');
const NOW = Date.parse('2026-10-15T12:00:00Z');
const FIRST = '00000000-0000-4000-8000-000000000001';
const SECOND = '00000000-0000-4000-8000-000000000002';
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
function fixture(enabled = true) {
  let now = NOW, perf = 100, permission = { enabled, generation: FIRST }, stored;
  let afterConsentRead = null;
  const calls = { consent: 0, read: 0, write: 0, perf: 0 };
  const metrics = core.create({ version: '1.17.8', now: () => now, newGeneration: () => SECOND,
    performanceNow: () => { calls.perf++; if (perf instanceof Error) throw perf; return perf; },
    readConsent() { calls.consent++; const result = clone(permission); const hook = afterConsentRead;
      afterConsentRead = null; hook?.(); return result; },
    writeConsent(value) { permission = clone(value); },
    read() { calls.read++; return clone(stored); },
    write(value) { calls.write++; stored = clone(value); }, remove() { stored = undefined; },
  });
  return { metrics, calls, now(value) { now = value; }, perf(value) { perf = value; },
    permission(value) { permission = clone(value); }, stored: () => clone(stored),
    afterConsentRead(value) { afterConsentRead = value; } };
}
const counts = metrics => Object.assign({}, ...clone(metrics.snapshot()).days.map(day => day.counts));

function integration(remote) {
  let now = NOW, perf = 100, failWrite = false, failRead = false;
  const storage = new Map();
  const begin = source.indexOf('  function createLocalMetrics(');
  const end = source.indexOf('  function installMetricsPanel(', begin);
  assert.ok(begin >= 0 && end > begin);
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ SCRIPT_VERSION: '1.17.8', Date: Clock, crypto, remote,
    performance: { now: () => perf },
    localStorage: { getItem: key => { if (failRead) throw Error('SecurityError'); return storage.get(key) ?? null; },
      setItem(key, value) { if (failWrite) throw Error('QuotaExceededError'); storage.set(key, value); },
      removeItem: key => storage.delete(key) },
  });
  vm.runInContext(coreSource, context);
  const metrics = vm.runInContext(source.slice(begin, end) + ';createLocalMetrics(remote)', context);
  return { metrics, storage, now(value) { now = value; }, perf(value) { perf = value; },
    failWrite(value) { failWrite = value; }, failRead(value) { failRead = value; } };
}

test('review: no opt-in means no counters, performance-clock reads, or per-tick consent reads', () => {
  const h = fixture(false);
  for (let i = 0; i < 10000; i++) { h.now(NOW + i); assert.equal(h.metrics.startTiming(), null); }
  assert.equal(h.calls.consent, 1); assert.equal(h.calls.read, 0);
  assert.equal(h.calls.write, 0); assert.equal(h.calls.perf, 0);
  h.now(NOW + 60000); assert.equal(h.metrics.startTiming(), null); assert.equal(h.calls.consent, 2);
});

test('review: sampled tokens are opaque, identity-bound, single-use and throttled before storage access', () => {
  const h = fixture(); const token = h.metrics.startTiming();
  assert.ok(Object.isFrozen(token)); assert.equal(JSON.stringify(token), '{}');
  assert.equal(h.metrics.finishTiming({}), false);
  const reads = h.calls.consent;
  for (let i = 0; i < 10000; i++) { h.now(NOW + i); assert.equal(h.metrics.startTiming(), null); }
  assert.equal(h.calls.consent, reads);
  h.perf(103); assert.equal(h.metrics.finishTiming(token), true);
  assert.equal(h.metrics.finishTiming(token), false);
  assert.deepEqual(counts(h.metrics), { 'performance.step.lt4ms': 1 });
  h.now(NOW + 59999); assert.equal(h.metrics.startTiming(), null);
  h.now(NOW + 60000); assert.ok(h.metrics.startTiming());
});

test('review: every exact duration boundary maps to one closed local category without timestamps', () => {
  const h = fixture();
  const cases = [[0,'lt4ms'],[3.999,'lt4ms'],[4,'lt16ms'],[15.999,'lt16ms'],[16,'lt50ms'],
    [49.999,'lt50ms'],[50,'lt200ms'],[199.999,'lt200ms'],[200,'gte200ms'],[60000,'gte200ms']];
  const expected = {};
  cases.forEach(([duration,bucket],index) => {
    h.now(NOW + index * 60000); h.perf(100); const token = h.metrics.startTiming();
    h.perf(100 + duration); assert.equal(h.metrics.finishTiming(token), true);
    const key = 'performance.step.' + bucket; expected[key] = (expected[key] || 0) + 1;
  });
  assert.deepEqual(counts(h.metrics), expected);
  assert.deepEqual(Object.keys(h.metrics.snapshot()).sort(), ['days','schema','version']);
  const report = JSON.stringify(h.metrics.snapshot());
  for (const secret of [FIRST, String(NOW), 'duration', 'timestamp', 'start']) assert.equal(report.includes(secret), false);
});

test('review: malformed starts and ends cannot record or throw into the scheduler', () => {
  for (const bad of [NaN, Infinity, -1, '100', null, {}, Error('clock failed')]) {
    const h = fixture(); h.perf(bad); assert.equal(h.metrics.startTiming(), null);
    assert.equal(h.calls.write, 0);
  }
  for (const bad of [NaN, Infinity, -1, 99, 60101, '102', null, {}, Error('clock failed')]) {
    const h = fixture(); const token = h.metrics.startTiming(); h.perf(bad);
    assert.equal(h.metrics.finishTiming(token), false); assert.equal(h.calls.write, 0);
  }
});

test('review: same-tab revoke, clear and re-enable invalidate an in-flight token', () => {
  for (const action of [metrics => metrics.setEnabled(false), metrics => metrics.clear(),
    metrics => { metrics.setEnabled(false); metrics.setEnabled(true); }]) {
    const h = fixture(); const token = h.metrics.startTiming(); action(h.metrics); h.perf(102);
    assert.equal(h.metrics.finishTiming(token), false); assert.deepEqual(counts(h.metrics), {});
  }
});

test('review: another tab revoking or rotating consent before finish invalidates the sample', () => {
  for (const permission of [{ enabled: false, generation: FIRST }, { enabled: true, generation: SECOND }]) {
    const h = fixture(); const token = h.metrics.startTiming(); h.permission(permission); h.perf(102);
    assert.equal(h.metrics.finishTiming(token), false); assert.equal(h.calls.write, 0);
  }
});

test('review: consent rotating after finish validation cannot import the sample into a new generation', () => {
  const h = fixture(); const token = h.metrics.startTiming(); h.perf(102);
  // Deterministic cross-tab interleave: the read returns the old permission,
  // then another tab completes revoke + opt-in before record reads storage.
  h.afterConsentRead(() => h.permission({ enabled: true, generation: SECOND }));
  assert.equal(h.metrics.finishTiming(token), false);
  assert.equal(h.calls.write, 0); assert.deepEqual(counts(h.metrics), {});
});

test('review: a stale token cannot consume a replacement token after the sample interval', () => {
  const h = fixture(); const old = h.metrics.startTiming(); h.now(NOW + 60000);
  const current = h.metrics.startTiming(); h.perf(110);
  assert.equal(h.metrics.finishTiming(old), false); assert.equal(h.metrics.finishTiming(current), true);
  assert.deepEqual(counts(h.metrics), { 'performance.step.lt16ms': 1 });
});

test('review: inactive remote stays inactive and local bins never enter its event forwarding', () => {
  const events = [], durations = [];
  const h = integration({ isEnabled: () => false, record: (...args) => events.push(args), duration: (...args) => durations.push(args) });
  h.metrics.setEnabled(true); const token = h.metrics.startTiming(); h.perf(106); h.metrics.finishTiming(token);
  assert.deepEqual(counts(h.metrics), { 'performance.step.lt16ms': 1 });
  assert.deepEqual(events, []); assert.deepEqual(durations, []);
  assert.deepEqual([...h.storage.keys()].sort(), ['old-light-auto-upgrade:metrics-consent:v1','old-light-auto-upgrade:metrics:v1']);
});

test('review: local sampling throttle and local opt-out do not throttle independent remote timings', () => {
  const durations = [];
  const h = integration({ isEnabled: () => true, duration: (...args) => durations.push(args) });
  h.metrics.setEnabled(true);
  for (let i = 0; i < 3; i++) {
    h.perf(100); const token = h.metrics.startTiming(); h.perf(106); h.metrics.finishTiming(token);
  }
  assert.equal(h.metrics.getStatus().total, 1); assert.equal(durations.length, 3);
  h.metrics.clear(); h.perf(100); const token = h.metrics.startTiming(); h.perf(106); h.metrics.finishTiming(token);
  assert.equal(h.metrics.getStatus().total, 0); assert.equal(durations.length, 4);
});

test('review: remote measurement ends before local persistence and metrics-panel refresh work', () => {
  const durations = [];
  const h = integration({ isEnabled: () => true, duration: (...args) => durations.push(args) });
  h.metrics.setEnabled(true);
  // The panel refresh runs after the helper step and can itself take time.
  h.metrics.onChange(() => h.perf(500));
  const token = h.metrics.startTiming(); h.perf(110); h.metrics.finishTiming(token);
  assert.deepEqual(durations, [['helper.step',10]]);
});

test('review: a failed timing write immediately notifies the existing metrics status panel', () => {
  const h = integration(null); h.metrics.setEnabled(true);
  let state;
  h.metrics.onChange(() => { state = clone(h.metrics.getStatus()); });
  const token = h.metrics.startTiming(); h.failWrite(true); h.perf(102);
  assert.doesNotThrow(() => h.metrics.finishTiming(token));
  assert.equal(state?.enabled, false); assert.equal(state?.storageError, true);
});


test('review: backwards wall-clock adjustments re-anchor without extra probes or write bursts', () => {
  const h = fixture(); const token = h.metrics.startTiming(); h.perf(102);
  assert.equal(h.metrics.finishTiming(token), true);
  const before = { ...h.calls };
  for (let i = 1; i <= 10000; i++) {
    h.now(NOW - i); assert.equal(h.metrics.startTiming(), null);
  }
  assert.deepEqual(h.calls, before);
  h.now(NOW - 10000 + 59999); assert.equal(h.metrics.startTiming(), null);
  h.now(NOW - 10000 + 60000); assert.ok(h.metrics.startTiming());
});

test('review: local measurement ends before its own consent-validation storage read', () => {
  const h = fixture(); const token = h.metrics.startTiming(); h.perf(110);
  h.afterConsentRead(() => h.perf(210));
  assert.equal(h.metrics.finishTiming(token), true);
  assert.deepEqual(counts(h.metrics), { 'performance.step.lt16ms': 1 });
});

test('review: failed sampled consent read refreshes status without a token or per-tick retry', () => {
  const h = integration(null); h.metrics.setEnabled(true);
  let notified = 0, state;
  h.metrics.onChange(() => { notified++; state = clone(h.metrics.getStatus()); });
  h.failRead(true);
  assert.doesNotThrow(() => { assert.equal(h.metrics.startTiming(), null); });
  assert.equal(notified, 1); assert.equal(state.enabled, false); assert.equal(state.storageError, true);
  for (let i = 0; i < 10000; i++) assert.equal(h.metrics.startTiming(), null);
  assert.equal(notified, 1);
});
