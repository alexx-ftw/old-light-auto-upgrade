'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../docs/metrics-core.js');
const { randomUUID } = require('node:crypto');
function harness() {
  let now = Date.parse('2026-10-15T12:00:00Z'), perf = 100, permission, stored;
  const counts = { read: 0, perf: 0, write: 0 };
  const clone = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
  const options = { version: '1.17.8', now: () => now, performanceNow: () => { counts.perf++; return perf; },
    newGeneration: randomUUID, readConsent: () => { counts.read++; return clone(permission); },
    writeConsent: v => { permission = clone(v); }, read: () => clone(stored),
    write: v => { counts.write++; stored = clone(v); }, remove: () => { stored = undefined; } };
  const metrics = core.create(options);
  return { metrics, counts, options, set perf(v) { perf = v; }, set now(v) { now = v; },
    advance(ms = 60000) { now += ms; perf += ms; },
    get permission() { return clone(permission); }, set permission(v) { permission = clone(v); },
    get stored() { return clone(stored); },
    events() { return Object.assign({}, ...metrics.snapshot().days.map(d => d.counts)); } };
}
test('local timing is opt-in and disabled ticks do not read the performance clock or write storage', () => {
  const h = harness();
  for (let i = 0; i < 10000; i++) { assert.equal(h.metrics.startTiming(), null); h.metrics.finishTiming(null); }
  assert.equal(h.counts.perf, 0); assert.equal(h.counts.write, 0); assert.equal(h.counts.read, 1);
});
test('local timing records only closed bins at exact boundaries, never raw durations', () => {
  for (const [duration, bucket] of [[0,'lt4ms'],[3.999,'lt4ms'],[4,'lt16ms'],[15.999,'lt16ms'],[16,'lt50ms'],[49.999,'lt50ms'],[50,'lt200ms'],[199.999,'lt200ms'],[200,'gte200ms'],[60000,'gte200ms']]) {
    const h = harness(); h.metrics.setEnabled(true); const token = h.metrics.startTiming(); h.perf = 100 + duration;
    assert.ok(token); assert.deepEqual(token, {}); assert.equal(h.metrics.finishTiming(token), true);
    assert.deepEqual(h.events(), { ['performance.step.' + bucket]: 1 });
    assert.deepEqual(Object.keys(h.metrics.snapshot()).sort(), ['days','schema','version']);
    assert.equal(h.metrics.finishTiming(token), false);
  }
});
test('sampling gates both storage reads and performance clocks for repeated scheduler ticks', () => {
  const h = harness(); h.metrics.setEnabled(true); const token = h.metrics.startTiming(); h.metrics.finishTiming(token);
  const before = { ...h.counts };
  for (let i = 0; i < 10000; i++) assert.equal(h.metrics.startTiming(), null);
  assert.deepEqual(h.counts, before);
  h.advance(59999); assert.equal(h.metrics.startTiming(), null);
  h.advance(1); assert.ok(h.metrics.startTiming());
});
test('opt-out, clear and opt-out/opt-in cannot retain a sample from previous consent', () => {
  for (const change of [h => h.metrics.setEnabled(false), h => h.metrics.clear(),
    h => { h.metrics.setEnabled(false); h.metrics.setEnabled(true); },
    h => { h.permission = { enabled:true, generation:randomUUID() }; }]) {
    const h = harness(); h.metrics.setEnabled(true); const token = h.metrics.startTiming(); change(h);
    assert.equal(h.metrics.finishTiming(token), false); assert.deepEqual(h.events(), {});
  }
});
test('turning on later never backfills disabled steps and explicit activation permits the next sample', () => {
  const h = harness(); assert.equal(h.metrics.startTiming(), null); h.metrics.setEnabled(true);
  assert.equal(h.metrics.finishTiming(null), false); assert.ok(h.metrics.startTiming());
});
test('invalid and throwing clocks cannot record or interrupt game work', () => {
  for (const end of [NaN, Infinity, -1, 99, 60101, '110']) {
    const h = harness(); h.metrics.setEnabled(true); const token = h.metrics.startTiming(); h.perf = end;
    assert.equal(h.metrics.finishTiming(token), false); assert.deepEqual(h.events(), {});
  }
  for (const begin of [NaN, Infinity, -1, '100']) {
    const h = harness(); h.metrics.setEnabled(true); h.perf = begin; assert.equal(h.metrics.startTiming(), null);
  }
  const h = harness(); h.metrics.setEnabled(true); h.options.performanceNow = () => { throw Error('private'); };
  assert.equal(h.metrics.startTiming(), null); assert.equal(h.metrics.isEnabled(), true);
});
test('a new sample supersedes an unfinished older token without retaining unbounded history', () => {
  const h = harness(); h.metrics.setEnabled(true); const old = h.metrics.startTiming(); h.advance(); const current = h.metrics.startTiming();
  assert.equal(h.metrics.finishTiming(old), false); assert.equal(h.metrics.finishTiming({}), false);
  assert.equal(h.metrics.finishTiming(current), true); assert.deepEqual(h.events(), {'performance.step.lt4ms':1});
});
