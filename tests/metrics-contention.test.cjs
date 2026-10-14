'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../docs/metrics-core.js');
const clone = value => value === undefined ? undefined : structuredClone(value);
const G1 = '00000000-0000-4000-8000-000000000001';
const G2 = '00000000-0000-4000-8000-000000000002';
const NOW = Date.UTC(2026, 9, 14, 12);
const day = counts => ({ date: '2026-10-14', counts });
function harness() {
  let stored = { schema: 1, version: '1.16.6', generation: G1, days: [day({ 'helper.loaded': 1 })] };
  let permission = { enabled: true, generation: G1 }, now = NOW;
  const writes = [];
  const options = { version: '1.16.6', now: () => now,
    readConsent: () => clone(permission), writeConsent: value => { permission = clone(value); },
    read: () => clone(stored), write: value => { writes.push(clone(value)); stored = clone(value); },
    remove: () => { stored = undefined; }, newGeneration: () => G2 };
  return { options, metrics: core.create(options), writes,
    get state() { return clone(stored); }, set state(value) { stored = clone(value); },
    get consent() { return clone(permission); }, set consent(value) { permission = clone(value); },
    get now() { return now; }, set now(value) { now = value; } };
}
function ambiguousFirstWrite(h) {
  const before = h.state, write = h.options.write;
  h.options.write = value => {
    write(value);
    if (h.writes.length === 1) h.state = before;
  };
}

test('metrics contention: a delayed valid tab write cannot permanently stop another tab', () => {
  const h = harness(); h.state = { ...h.state, days: [] };
  const a = h.metrics;
  let second;
  const b = core.create({ ...h.options, write(value) {
    assert.equal(a.record('helper.loaded'), true);
    const ordinary = h.options.write;
    let pending = true;
    h.options.write = next => {
      ordinary(next);
      if (pending) { pending = false; ordinary(value); }
    };
    second = a.record('helper.loaded');
    h.options.write = ordinary;
  } });
  assert.equal(b.record('helper.loaded'), true);
  assert.equal(second, true);
  assert.equal(a.getStatus().enabled, true);
  assert.equal(a.getStatus().errorCode, null);
  assert.equal(h.writes.length, 4, 'one bounded recovery write, not a retry loop');
  assert.equal(a.record('settings.changed'), true);
  // Without storage CAS these remain approximate; no exact-accounting promise.
  assert.deepEqual(a.snapshot().days, [day({ 'helper.loaded': 2, 'settings.changed': 1 })]);
});

test('metrics contention: the single retry rereads and preserves newer counter fields', () => {
  const h = harness(), before = h.state, read = h.options.read;
  ambiguousFirstWrite(h);
  let reads = 0;
  h.options.read = () => {
    const result = read();
    if (++reads === 2) h.state = { ...before, days: [day({ 'helper.loaded': 1, 'settings.changed': 5 })] };
    return result;
  };
  assert.equal(h.metrics.record('helper.loaded'), true);
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.metrics.snapshot().days, [day({ 'helper.loaded': 2, 'settings.changed': 5 })]);
});

test('metrics contention: two silently ignored writes still stop collection', () => {
  const h = harness(); let attempts = 0;
  h.options.write = () => { attempts++; };
  assert.equal(h.metrics.record('helper.loaded'), false);
  assert.equal(attempts, 2);
  assert.equal(h.metrics.getStatus().errorCode, 'write-unverified');
  assert.equal(h.metrics.isEnabled(), false);
  assert.equal(h.metrics.record('helper.loaded'), false);
  assert.equal(attempts, 2);
});

test('metrics contention: an explicit or asynchronous storage failure is never retried', async () => {
  for (const fail of [() => false, () => { throw new Error('PRIVATE'); }, async () => { throw new Error('PRIVATE'); }]) {
    const h = harness(); let attempts = 0;
    h.options.write = () => { attempts++; return fail(); };
    assert.equal(h.metrics.record('helper.loaded'), false);
    assert.equal(attempts, 1);
    assert.equal(h.metrics.getStatus().errorCode, 'write-failed');
    assert.equal(JSON.stringify(h.metrics.getStatus()).includes('PRIVATE'), false);
  }
  await new Promise(resolve => setImmediate(resolve));
});

test('metrics contention: opt-out before retry stays off and removes stale bytes', () => {
  const h = harness(), read = h.options.read;
  ambiguousFirstWrite(h);
  let reads = 0;
  h.options.read = () => {
    const result = read();
    if (++reads === 2) h.consent = { enabled: false, generation: G1 };
    return result;
  };
  assert.equal(h.metrics.record('helper.loaded'), false);
  assert.equal(h.writes.filter(value => value.days.length).length, 1);
  assert.equal(h.consent.enabled, false);
  assert.deepEqual(h.state.days, []);
  assert.deepEqual(h.metrics.snapshot().days, []);
});

test('metrics contention: off then on cannot replay an old event into new consent', () => {
  const h = harness(), readConsent = h.options.readConsent;
  ambiguousFirstWrite(h);
  let reads = 0;
  h.options.readConsent = () => {
    if (++reads === 5) {
      h.consent = { enabled: true, generation: G2 };
      h.state = { ...h.state, generation: G2, days: [] };
    }
    return readConsent();
  };
  assert.equal(h.metrics.record('helper.loaded'), false);
  assert.equal(h.writes.length, 1);
  assert.equal(h.consent.generation, G2);
  assert.deepEqual(h.metrics.snapshot().days, []);
  assert.equal(h.metrics.record('settings.changed'), true);
  assert.deepEqual(h.metrics.snapshot().days, [day({ 'settings.changed': 1 })]);
});

test('metrics contention: revocation during the fresh counter read prevents the retry write', () => {
  const h = harness(), read = h.options.read;
  ambiguousFirstWrite(h);
  let reads = 0;
  h.options.read = () => {
    const result = read();
    if (++reads === 3) { h.consent = { enabled: false, generation: G1 }; h.state = { ...h.state, days: [] }; }
    return result;
  };
  assert.equal(h.metrics.record('helper.loaded'), false);
  assert.equal(h.writes.length, 1);
  assert.equal(h.consent.enabled, false);
  assert.deepEqual(h.metrics.snapshot().days, []);
});

test('metrics contention: retry uses the fresh UTC day and still purges expired history', () => {
  const h = harness(); h.now = Date.UTC(2026, 9, 14, 23, 59, 59, 999);
  h.state = { ...h.state, days: [{ date: '2026-09-15', counts: { 'helper.loaded': 7 } }, day({ 'helper.loaded': 1 })] };
  const read = h.options.read; ambiguousFirstWrite(h); let reads = 0;
  h.options.read = () => { const result = read(); if (++reads === 2) h.now++; return result; };
  assert.equal(h.metrics.record('helper.loaded'), true);
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.metrics.snapshot().days, [day({ 'helper.loaded': 1 }), { date: '2026-10-15', counts: { 'helper.loaded': 1 } }]);
});

test('metrics contention: saturated counters are already verified and need no retry', () => {
  const h = harness(); h.state = { ...h.state, days: [day({ 'helper.loaded': core.MAX_COUNT })] };
  assert.equal(h.metrics.record('helper.loaded'), true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.metrics.getStatus().total, core.MAX_COUNT);
});
