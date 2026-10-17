'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../docs/metrics-core.js');
const TODAY = Date.parse('2026-10-13T12:34:56.789Z');
const DAY = 86400000;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const GENERATION = '00000000-0000-4000-8000-000000000001';
let sequence = 1;
const freshGeneration = () => '00000000-0000-4000-8000-' + (++sequence).toString(16).padStart(12, '0');
const state = (patch = {}) => ({ schema: 1, version: '1.12.0', generation: GENERATION, days: [], ...patch });
const row = (date, counts) => ({ date, counts });

function fixture(initial, overrides = {}) {
  let stored = clone(initial);
  let permission = initial === undefined ? undefined : { enabled: true, generation: GENERATION };
  let now = TODAY;
  const calls = { read: 0, write: 0, remove: 0 };
  const options = {
    version: '1.12.0', now: () => now, newGeneration: freshGeneration,
    readConsent() { return clone(permission); },
    writeConsent(value) { permission = clone(value); },
    read() { calls.read += 1; return clone(stored); },
    write(value) { calls.write += 1; stored = clone(value); },
    remove() { calls.remove += 1; stored = undefined; },
    ...overrides,
  };
  const metrics = core.create(options);
  return {
    metrics, options, calls,
    stored: () => clone(stored),
    consent: () => clone(permission),
    replaceConsent: value => { permission = clone(value); },
    replace: value => { stored = clone(value); },
    time: value => { now = value; },
  };
}

test('standalone UMD module exports a frozen API and the same browser global', () => {
  assert.equal(global.OldLightMetricsCore, core);
  assert.equal(typeof core.create, 'function');
  assert.equal(Object.isFrozen(core), true);
  assert.equal(Object.isFrozen(core.EVENTS), true);
  assert.equal(Object.isFrozen(core.create()), true);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/metrics-core.js'), 'utf8'), context);
  assert.equal(typeof context.OldLightMetricsCore.create, 'function');
});

test('defaults off without creating storage or accumulating a pending buffer', () => {
  const f = fixture();
  assert.equal(f.metrics.isEnabled(), false);
  assert.equal(f.metrics.record('helper.loaded'), false);
  assert.deepEqual(f.metrics.snapshot(), { schema: 1, version: '1.12.0', days: [] });
  assert.deepEqual(f.metrics.getStatus(), { enabled: false, storageError: false, days: 0, total: 0, deletionPending: false, errorCode: null });
  assert.equal(f.calls.write, 0);
  assert.equal(f.calls.remove, 0);
  assert.equal(f.metrics.setEnabled(true), true);
  assert.deepEqual(f.stored(), state({ generation: f.consent().generation }));
  assert.equal(f.metrics.getStatus().total, 0);
});

test('requires a boolean and confirms persisted opt-in before collecting', () => {
  const f = fixture();
  for (const value of [1, 'true', {}, null, undefined, new Boolean(true)]) {
    assert.equal(f.metrics.setEnabled(value), false);
  }
  assert.equal(f.calls.write, 0);
  assert.equal(f.metrics.setEnabled(true), true);
  assert.equal(f.metrics.record('helper.loaded'), true);
  assert.equal(f.metrics.record('helper.loaded'), true);
  assert.equal(f.metrics.getStatus().total, 2);
  assert.deepEqual(f.metrics.snapshot().days, [row('2026-10-13', { 'helper.loaded': 2 })]);
});

test('collects each fixed event and rejects names, payloads, identifiers and arbitrary dimensions', () => {
  const f = fixture(state());
  const sensitive = { userId: 'private-id', url: 'https://private.invalid/?token=secret', coordinates: '12:3:4', message: 'secret-message', stack: 'secret-stack', accessToken: 'secret-token' };
  for (const name of core.EVENTS) assert.equal(f.metrics.record(name, sensitive), true, name);
  for (const name of ['__proto__', 'constructor', 'prototype', 'ui.tab.backup', 'custom:event', 'error.runtime:secret', '', sensitive, Symbol('helper.loaded'), null]) {
    assert.equal(f.metrics.record(name), false);
  }
  assert.equal(f.metrics.getStatus().total, core.EVENTS.length);
  const serialized = JSON.stringify(f.metrics.snapshot());
  for (const value of Object.values(sensitive)) assert.equal(serialized.includes(value), false);
  assert.deepEqual(Object.keys(f.metrics.snapshot()).sort(), ['days', 'schema', 'version']);
  assert.deepEqual(Object.keys(f.metrics.snapshot().days[0]).sort(), ['counts', 'date']);
});

test('sanitizes stored fields and never exports unknown payloads or prototypes', () => {
  const raw = state({ userId: 'secret-user', coordinates: [1, 2, 3], days: [row('2026-10-13', JSON.parse('{"helper.loaded":3,"error.runtime":1,"unknown.secret":9,"__proto__":123,"constructor":42}'))] });
  raw.days[0].stack = 'secret-stack';
  const f = fixture(raw);
  assert.deepEqual(f.metrics.snapshot(), { schema: 1, version: '1.12.0', days: [row('2026-10-13', { 'helper.loaded': 3, 'error.runtime': 1 })] });
  assert.equal(f.metrics.record('settings.changed'), true);
  assert.deepEqual(Object.keys(f.stored()).sort(), ['days', 'generation', 'schema', 'version']);
  assert.equal({}.polluted, undefined);
});

test('version is a bounded numeric release, never a free-form dimension', () => {
  for (const version of ['user@example.test', '1.2.3-secret-user', '9999999.1.1', 'https://secret.test/', {}, ['1.2.3'], null]) {
    const f = fixture(undefined, { version });
    assert.equal(f.metrics.setEnabled(true), true);
    assert.equal(f.metrics.snapshot().version, 'unknown');
    assert.equal(f.stored().version, 'unknown');
  }
});

test('changing helper version resets aggregates but preserves explicit consent', () => {
  const f = fixture(state({ version: '1.11.0', days: [row('2026-10-13', { 'helper.loaded': 50 })] }));
  assert.equal(f.metrics.isEnabled(), true);
  assert.deepEqual(f.metrics.snapshot().days, []);
  assert.equal(f.metrics.record('helper.loaded'), true);
  assert.deepEqual(f.stored(), state({ days: [row('2026-10-13', { 'helper.loaded': 1 })] }));
});

test('retains exactly the current UTC day and preceding 29 days, rejects future days', () => {
  const dates = [];
  for (let i = -40; i <= 2; i += 1) dates.push(row(new Date(TODAY + i * DAY).toISOString().slice(0, 10), { 'helper.loaded': 1 }));
  const f = fixture(state({ days: dates.reverse() }));
  const snapshot = f.metrics.snapshot();
  assert.equal(snapshot.days.length, 30);
  assert.equal(snapshot.days[0].date, '2026-09-14');
  assert.equal(snapshot.days.at(-1).date, '2026-10-13');
  assert.equal(f.metrics.record('settings.changed'), true);
  assert.equal(f.stored().days.length, 30);
  f.time(Date.parse('2026-10-14T00:00:00Z'));
  assert.equal(f.metrics.record('helper.loaded'), true);
  assert.equal(f.stored().days.length, 30);
  assert.equal(f.stored().days[0].date, '2026-09-15');
});

test('UTC rollover creates a new bucket without precise timestamps', () => {
  const f = fixture(state());
  f.time(Date.parse('2026-10-13T23:59:59.999Z'));
  assert.equal(f.metrics.record('helper.loaded'), true);
  f.time(Date.parse('2026-10-14T00:00:00.000Z'));
  assert.equal(f.metrics.record('helper.loaded'), true);
  assert.deepEqual(f.metrics.snapshot().days, [row('2026-10-13', { 'helper.loaded': 1 }), row('2026-10-14', { 'helper.loaded': 1 })]);
});

test('ignores malformed dates, rows and counts and combines duplicates with saturation', () => {
  const f = fixture(state({ days: [
    row('2026-10-13', { 'helper.loaded': core.MAX_COUNT, 'backup.failed': -5, 'error.storage': 1.2, 'drive.error': '9' }),
    row('2026-10-13', { 'helper.loaded': 100, 'drive.error': Number.MAX_SAFE_INTEGER, 'backup.imported': 0 }),
    row('2026-02-30', { 'helper.loaded': 1 }), row('2026-10-13T00:00:00Z', { 'helper.loaded': 1 }),
    row('2026-10-12', ['helper.loaded']), row('2026-10-11', { 'helper.loaded': 1e30 }),
    row('2026-10-10', {}), null, [], 'private',
  ] }));
  assert.deepEqual(f.metrics.snapshot().days, [row('2026-10-13', { 'helper.loaded': core.MAX_COUNT, 'drive.error': core.MAX_COUNT })]);
  assert.equal(f.metrics.record('helper.loaded'), true);
  assert.equal(f.metrics.getStatus().total, core.MAX_COUNT * 2);
});

test('returns fresh detached snapshots', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
  const snapshot = f.metrics.snapshot();
  snapshot.days[0].counts['helper.loaded'] = 999;
  snapshot.days.push(row('2026-10-14', { 'helper.loaded': 50 }));
  assert.equal(f.metrics.getStatus().total, 4);
  assert.equal(f.stored().days.length, 1);
});

test('disable persists explicit off and deletes all counters before reporting success', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
  assert.equal(f.metrics.setEnabled(false), true);
  assert.deepEqual(f.stored(), state({ generation: f.consent().generation }));
  assert.equal(f.consent().enabled, false);
  assert.equal(f.metrics.record('helper.loaded'), false);
  assert.equal(f.metrics.isEnabled(), false);
  assert.deepEqual(f.metrics.snapshot().days, []);
  assert.equal(core.create(f.options).isEnabled(), false);
  assert.equal(f.metrics.setEnabled(true), true);
  assert.equal(f.metrics.getStatus().total, 0);
});

test('clear deletes aggregates and persists off until a new explicit opt-in', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
  assert.equal(f.metrics.clear(), true);
  assert.equal(f.metrics.isEnabled(), false);
  assert.deepEqual(f.stored(), state({ generation: f.consent().generation }));
  assert.equal(f.consent().enabled, false);
  assert.equal(f.metrics.record('helper.loaded'), false);
  assert.equal(f.metrics.setEnabled(true), true);
  assert.equal(f.metrics.record('helper.loaded'), true);
  assert.equal(f.metrics.clear(), true);
  assert.deepEqual(f.stored(), state({ generation: f.consent().generation }));
  assert.equal(f.consent().enabled, false);
});

test('stale instances reread consent before recording or clearing and cannot reactivate an opt-out', () => {
  const f = fixture(state());
  const other = core.create(f.options);
  assert.equal(f.metrics.isEnabled(), true);
  assert.equal(f.metrics.record('helper.loaded'), true);
  assert.equal(other.setEnabled(false), true);
  const writes = f.calls.write;
  assert.equal(f.metrics.record('helper.loaded'), false);
  assert.equal(f.calls.write, writes);
  assert.equal(f.metrics.isEnabled(), false);
  assert.equal(f.metrics.clear(), true);
  assert.equal(f.consent().enabled, false);
});

test('sequential instances merge counts using fresh read-modify-write', () => {
  const f = fixture(state());
  const other = core.create(f.options);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(f.metrics.record('helper.loaded'), true);
    assert.equal(other.record('settings.changed'), true);
  }
  assert.equal(f.metrics.getStatus().total, 10);
  assert.deepEqual(f.metrics.snapshot().days, [row('2026-10-13', { 'helper.loaded': 5, 'settings.changed': 5 })]);
});

test('corrupt and unsupported root states fail closed without collecting', () => {
  for (const raw of ['{"enabled":true}', 1, true, [], {}, state({ schema: 2 }), state({ days: {} }), state({ days: new Array(1001).fill(null) })]) {
    const f = fixture(raw);
    assert.doesNotThrow(() => f.metrics.getStatus());
    assert.equal(f.metrics.isEnabled(), false);
    assert.equal(f.metrics.record('helper.loaded'), false);
    assert.deepEqual(f.metrics.snapshot().days, []);
    assert.equal(f.metrics.getStatus().errorCode, 'invalid-state');
    assert.equal(f.calls.write, 0);
    assert.equal(f.metrics.setEnabled(true), true);
    assert.equal(f.metrics.isEnabled(), true);
  }
});

test('never invokes getters or conversion hooks from persisted state', () => {
  let invoked = 0;
  const raw = state({ days: [row('2026-10-13', { 'helper.loaded': 2 })] });
  Object.defineProperty(raw.days[0].counts, 'error.runtime', { enumerable: true, get() { invoked += 1; throw new Error('private'); } });
  raw.toJSON = () => { invoked += 1; throw new Error('private'); };
  const f = fixture(state(), { read: () => raw });
  assert.deepEqual(f.metrics.snapshot().days, [row('2026-10-13', { 'helper.loaded': 2 })]);
  assert.equal(invoked, 0);
  Object.defineProperty(raw, 'schema', { get() { invoked += 1; return 1; } });
  assert.equal(f.metrics.isEnabled(), false);
  assert.equal(invoked, 0);
});

test('hostile prototypes and proxy traps fail closed without throwing', () => {
  for (const raw of [new Date(), Object.create({ enabled: true }), new Proxy({}, { getPrototypeOf() { throw new Error('private'); } })]) {
    const f = fixture(state(), { read: () => raw });
    assert.doesNotThrow(() => f.metrics.snapshot());
    assert.equal(f.metrics.isEnabled(), false);
    assert.equal(f.metrics.record('helper.loaded'), false);
  }
});

test('read errors disable this instance until a new explicit successful opt-in', () => {
  const f = fixture(state());
  const original = f.options.read;
  f.options.read = () => { throw new Error('private storage diagnostic'); };
  assert.doesNotThrow(() => f.metrics.record('helper.loaded'));
  assert.deepEqual(f.metrics.snapshot().days, []);
  assert.equal(f.metrics.getStatus().storageError, true);
  assert.equal(f.metrics.getStatus().errorCode, 'read-failed');
  assert.equal(JSON.stringify(f.metrics.getStatus()).includes('private'), false);
  f.options.read = original;
  assert.equal(f.metrics.record('helper.loaded'), false);
  assert.equal(f.metrics.setEnabled(true), true);
  assert.equal(f.metrics.record('helper.loaded'), true);
});

test('failed or silently ignored opt-in writes never enable collection', () => {
  for (const write of [() => { throw new Error('private'); }, () => false, () => {}]) {
    const f = fixture(undefined, { writeConsent: write });
    assert.equal(f.metrics.setEnabled(true), false);
    assert.equal(f.metrics.isEnabled(), false);
    assert.equal(f.metrics.record('helper.loaded'), false);
    assert.equal(f.metrics.getStatus().storageError, true);
  }
});

test('record write failure does not throw or allow later implicit resume', () => {
  const f = fixture(state());
  const original = f.options.write;
  f.options.write = () => { throw new Error('private'); };
  assert.equal(f.metrics.record('helper.loaded'), false);
  assert.equal(f.metrics.getStatus().enabled, false);
  assert.equal(f.metrics.getStatus().storageError, true);
  f.options.write = original;
  assert.equal(f.metrics.record('helper.loaded'), false);
  assert.equal(f.metrics.setEnabled(true), true);
  assert.equal(f.metrics.record('helper.loaded'), true);
});

test('failed disable stops collection locally and explicitly reports counters may remain', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }), {
    write() { throw new Error('cannot write'); }, remove() { throw new Error('cannot remove'); },
  });
  assert.equal(f.metrics.setEnabled(false), false);
  assert.equal(f.metrics.isEnabled(), false);
  assert.equal(f.metrics.record('helper.loaded'), false);
  assert.equal(f.metrics.getStatus().deletionPending, true);
  assert.equal(f.metrics.getStatus().storageError, true);
  assert.equal(f.stored().days[0].counts['helper.loaded'], 4);
  assert.deepEqual(f.metrics.snapshot().days, []);
});

test('failed disable recovers by verified removal and persists off when possible', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
  const original = f.options.write;
  let attempts = 0;
  f.options.write = value => { if (++attempts === 1) throw new Error('temporary'); original(value); };
  assert.equal(f.metrics.setEnabled(false), true);
  assert.equal(f.calls.remove, 1);
  assert.equal(f.stored(), undefined);
  assert.equal(f.consent().enabled, false);
  assert.equal(f.metrics.getStatus().storageError, false);
  assert.equal(f.metrics.getStatus().deletionPending, false);
});

test('failed counter write recovers by verified deletion with consent safely stored elsewhere', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }), { write() { throw new Error('cannot write'); } });
  assert.equal(f.metrics.setEnabled(false), true);
  assert.equal(f.stored(), undefined);
  assert.equal(f.metrics.getStatus().enabled, false);
  assert.equal(f.metrics.getStatus().storageError, false);
  assert.equal(f.metrics.getStatus().deletionPending, false);
});

test('silently ignored remove does not pretend counters were deleted', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }), { write() {}, remove() {} });
  assert.equal(f.metrics.clear(), false);
  assert.equal(f.metrics.getStatus().deletionPending, true);
  assert.equal(f.stored().days.length, 1);
});

test('clear fallback deletion keeps independently persisted consent off', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
  const original = f.options.write;
  let attempts = 0;
  f.options.write = value => { if (++attempts === 1) throw new Error('temporary'); original(value); };
  assert.equal(f.metrics.clear(), true);
  assert.equal(f.stored(), undefined);
  assert.equal(f.consent().enabled, false);
  assert.equal(f.metrics.isEnabled(), false);
});

test('verification detects a no-op write even when ignored sensitive fields would sanitize to empty', () => {
  const f = fixture(state({ enabled: false, privateId: 'secret' }), { write() {}, remove() {} });
  assert.equal(f.metrics.setEnabled(false), false);
  assert.equal(f.metrics.getStatus().deletionPending, true);
});

test('missing adapters and invalid clocks never throw or collect', () => {
  const missing = core.create();
  for (const method of [() => missing.isEnabled(), () => missing.record('helper.loaded'), () => missing.snapshot(), () => missing.clear(), () => missing.setEnabled(true), () => missing.setEnabled(false), () => missing.getStatus()]) assert.doesNotThrow(method);
  assert.equal(missing.isEnabled(), false);
  for (const now of [() => NaN, () => Infinity, () => -1, () => '2026-10-13', () => 253402300800000, () => { throw new Error('clock'); }]) {
    const f = fixture(state(), { now });
    assert.equal(f.metrics.record('helper.loaded'), false);
    assert.equal(f.metrics.isEnabled(), false);
    assert.equal(f.metrics.getStatus().errorCode, 'invalid-clock');
    assert.equal(f.calls.write, 0);
  }
});

test('accidentally asynchronous adapters are rejected without leaking native rejected promises', async () => {
  const f = fixture(state(), { read: async () => { throw new Error('async read'); } });
  assert.equal(f.metrics.isEnabled(), false);
  const g = fixture(undefined, { write: async () => { throw new Error('async write'); }, remove: async () => { throw new Error('async remove'); } });
  assert.equal(g.metrics.setEnabled(true), false);
  assert.equal(g.metrics.setEnabled(false), false);
  await new Promise(resolve => setImmediate(resolve));
});

test('source has no transport, analytics SDK, or browser error listener', () => {
  const source = fs.readFileSync(path.join(__dirname, '../docs/metrics-core.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|GM_xmlhttpRequest|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(source, /addEventListener|Sentry|posthog|mixpanel|amplitude|https?:\/\//i);
});

// Test the build transform in a VM with an in-memory fs: never run the build or
// change the real userscript during this suite.
function build(source) {
  let written;
  const script = fs.readFileSync(path.join(__dirname, '../build-metrics.cjs'), 'utf8');
  const context = vm.createContext({
    __dirname: '/project', console: { log() {} },
    require(name) {
      if (name === 'node:path') return path;
      assert.equal(name, 'node:fs');
      return {
        readFileSync(file) {
          if (file.endsWith('metrics-core.js')) return 'const testMetricsCore = true;\n';
          if (file.endsWith('telemetry-core.js')) return 'const testTelemetryCore = true;\n';
          if (file.endsWith('telemetry-posthog-payload.js')) return 'const testPostHogPayload = true;\n';
          if (file.endsWith('telemetry-posthog-transport.js')) return 'const testPostHogTransport = true;\n';
          return source;
        },
        writeFileSync(file, content) { assert.equal(file, '/project/old-light-auto-upgrade.user.js'); written = content; },
      };
    },
  });
  vm.runInContext(script, context);
  return written;
}
const metadata = '// ==UserScript==\n// @version 1.12.0\n// ==/UserScript==';
const begin = '// BEGIN EMBEDDED METRICS CORE';
const end = '// END EMBEDDED METRICS CORE';

test('build inserts immediately after metadata before the existing sync core and is idempotent', () => {
  const source = metadata + '\n\n// BEGIN EMBEDDED SYNC CORE\nconst sync = true;\n// END EMBEDDED SYNC CORE\n';
  const result = build(source);
  assert.ok(result.indexOf(begin) > result.indexOf('// ==/UserScript=='));
  assert.ok(result.indexOf(end) < result.indexOf('// BEGIN EMBEDDED SYNC CORE'));
  assert.equal(build(result), result);
  assert.equal(result.includes('const sync = true;'), true);
});

test('build replaces one complete metrics block and preserves the application', () => {
  const source = metadata + '\n' + begin + '\nold();\n' + end + '\napp();\n';
  const result = build(source);
  assert.equal(result.includes('old();'), false);
  assert.equal(result.endsWith('\napp();\n'), true);
  assert.equal(build(result), result);
});

test('build refuses missing, duplicate, reversed and metadata-embedded markers without writing', () => {
  for (const source of [
    'app();', '// ==/UserScript==\napp();', metadata + '\n' + metadata,
    metadata + '\n' + begin, metadata + '\n' + end,
    metadata + '\n' + end + '\n' + begin,
    metadata + '\n' + begin + '\n' + begin + '\n' + end,
    metadata + '\n' + begin + '\n' + end + '\n' + end,
    '// ==UserScript==\n' + begin + '\n' + end + '\n// ==/UserScript==',
  ]) assert.throws(() => build(source));
});

test('build accepts CRLF metadata and markers while remaining idempotent', () => {
  const source = (metadata + '\n' + begin + '\nold();\n' + end + '\napp();\n').replaceAll('\n', '\r\n');
  const result = build(source);
  assert.equal(result.includes('old();'), false);
  assert.equal(build(result), result);
});

test('consent is isolated from counter storage; legacy enabled cannot authorize collection', () => {
  const f = fixture(state({ enabled: true }));
  f.replaceConsent(undefined);
  assert.equal(f.metrics.isEnabled(), false);
  assert.equal(f.metrics.record('helper.loaded'), false);
  assert.deepEqual(f.metrics.snapshot().days, []);
  assert.equal(f.calls.write, 0);
});

test('record never writes consent or rotates generation', () => {
  const f = fixture(state(), { writeConsent() { throw new Error('record must not call this'); } });
  assert.equal(f.metrics.record('helper.loaded'), true);
  assert.deepEqual(f.consent(), { enabled: true, generation: GENERATION });
  assert.equal(f.stored().generation, GENERATION);
});

test('opt-out during a stale counter write cannot re-enable either instance', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
  let interrupt = true;
  const other = core.create({ ...f.options, write(value) {
    if (interrupt) { interrupt = false; assert.equal(f.metrics.setEnabled(false), true); }
    f.options.write(value);
  } });
  assert.equal(other.record('helper.loaded'), false);
  assert.equal(f.consent().enabled, false);
  assert.equal(f.metrics.isEnabled(), false);
  assert.equal(other.isEnabled(), false);
  assert.deepEqual(other.snapshot().days, []);
  assert.equal(other.record('helper.loaded'), false);
});

test('off then on during a stale write cannot revive the previous generation or history', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
  let interrupt = true;
  const other = core.create({ ...f.options, write(value) {
    if (interrupt) {
      interrupt = false;
      assert.equal(f.metrics.setEnabled(false), true);
      assert.equal(f.metrics.setEnabled(true), true);
    }
    f.options.write(value);
  } });
  assert.equal(other.record('helper.loaded'), false);
  assert.equal(f.consent().enabled, true);
  assert.notEqual(f.consent().generation, GENERATION);
  assert.deepEqual(other.snapshot().days, []);
  assert.deepEqual(f.metrics.snapshot().days, []);
  assert.equal(other.record('settings.changed'), true);
  assert.deepEqual(other.snapshot().days, [row('2026-10-13', { 'settings.changed': 1 })]);
  assert.equal(f.stored().generation, f.consent().generation);
});

test('opt-out during reading counters prevents any stale record write', () => {
  const f = fixture(state());
  let interrupt = true;
  let counterWrites = 0;
  const other = core.create({ ...f.options,
    read() {
      const old = f.options.read();
      if (interrupt) { interrupt = false; assert.equal(f.metrics.setEnabled(false), true); }
      return old;
    },
    write(value) { counterWrites += 1; f.options.write(value); },
  });
  assert.equal(other.record('helper.loaded'), false);
  assert.equal(counterWrites, 0);
  assert.equal(other.isEnabled(), false);
});

test('clear keeps consent off so a stale write cannot restore removed history', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
  let interrupt = true;
  const other = core.create({ ...f.options, write(value) {
    if (interrupt) { interrupt = false; assert.equal(f.metrics.clear(), true); }
    f.options.write(value);
  } });
  assert.equal(other.record('helper.loaded'), false);
  assert.equal(f.consent().enabled, false);
  assert.deepEqual(other.snapshot().days, []);
  assert.deepEqual(f.metrics.snapshot().days, []);
});

test('snapshots and status contain no consent generation token', () => {
  const f = fixture(state());
  assert.equal(f.metrics.record('helper.loaded'), true);
  assert.equal(JSON.stringify(f.metrics.snapshot()).includes(GENERATION), false);
  assert.equal(JSON.stringify(f.metrics.getStatus()).includes(GENERATION), false);
  assert.equal(JSON.stringify(f.metrics.snapshot()).includes('generation'), false);
});

test('missing or malformed consent always defaults off even with valid counters', () => {
  for (const permission of [undefined, null, true, {}, { enabled: true }, { enabled: 'true', generation: GENERATION }, { enabled: true, generation: 'private-user-123' }, { enabled: true, generation: 1 }]) {
    const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
    f.replaceConsent(permission);
    assert.equal(f.metrics.isEnabled(), false);
    assert.equal(f.metrics.record('helper.loaded'), false);
    assert.deepEqual(f.metrics.snapshot().days, []);
    assert.equal(f.calls.write, 0);
  }
});

test('cannot claim disabled when consent writing failed, but stops this instance', () => {
  const f = fixture(state(), { writeConsent() { throw new Error('private diagnostic'); } });
  assert.equal(f.metrics.setEnabled(false), false);
  assert.equal(f.metrics.isEnabled(), false);
  assert.equal(f.consent().enabled, true);
  assert.equal(f.metrics.getStatus().errorCode, 'consent-write-failed');
  assert.equal(f.metrics.getStatus().storageError, true);
});

test('asynchronous consent adapters are rejected with no leaked rejection', async () => {
  const a = fixture(state(), { readConsent: async () => { throw new Error('private'); } });
  assert.equal(a.metrics.isEnabled(), false);
  const b = fixture(state(), { writeConsent: async () => { throw new Error('private'); } });
  assert.equal(b.metrics.setEnabled(false), false);
  await new Promise(resolve => setImmediate(resolve));
});

test('new consent requires a fresh valid cryptographic UUID', () => {
  for (const newGeneration of [() => GENERATION, () => 'private-user-123', () => null, () => { throw new Error('entropy'); }]) {
    const f = fixture(state(), { newGeneration });
    assert.equal(f.metrics.setEnabled(true), false);
    assert.equal(f.metrics.getStatus().errorCode, 'generation-unavailable');
    assert.equal(f.calls.write, 0);
  }
});

test('default generation uses crypto.randomUUID when available', () => {
  const f = fixture(undefined, { newGeneration: undefined });
  assert.equal(f.metrics.setEnabled(true), true);
  assert.match(f.consent().generation, /^[0-9a-f-]{36}$/);
  assert.notEqual(f.consent().generation, GENERATION);
  assert.equal(f.metrics.record('helper.loaded'), true);
  assert.equal(JSON.stringify(f.metrics.snapshot()).includes(f.consent().generation), false);
});

test('clear racing with opt-out never writes an enabled consent state', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
  let interrupt = true;
  const other = core.create({ ...f.options, writeConsent(permission) {
    assert.equal(permission.enabled, false);
    if (interrupt) { interrupt = false; assert.equal(f.metrics.setEnabled(false), true); }
    f.options.writeConsent(permission);
  } });
  assert.equal(other.clear(), true);
  assert.equal(f.metrics.isEnabled(), false);
  assert.equal(other.isEnabled(), false);
  assert.deepEqual(other.snapshot().days, []);
});

test('stale writer best-effort removes old counter bytes after observing opt-out', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
  let interrupt = true;
  const other = core.create({ ...f.options, write(value) {
    if (interrupt) { interrupt = false; assert.equal(f.metrics.setEnabled(false), true); }
    f.options.write(value);
  } });
  assert.equal(other.record('helper.loaded'), false);
  assert.deepEqual(f.stored().days, []);
  assert.equal(f.stored().generation, f.consent().generation);
});

test('failed best-effort removal reports residual bytes without restoring consent', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }));
  let writes = 0;
  const other = core.create({ ...f.options,
    write(value) {
      if (++writes === 1) { assert.equal(f.metrics.setEnabled(false), true); f.options.write(value); }
      else throw new Error('cannot clean stale counters');
    },
    remove() { throw new Error('cannot remove stale counters'); },
  });
  assert.equal(other.record('helper.loaded'), false);
  assert.equal(f.consent().enabled, false);
  assert.equal(other.getStatus().deletionPending, true);
  assert.equal(other.getStatus().storageError, true);
  assert.deepEqual(other.snapshot().days, []);
});

test('revocation persists off without invoking a failed randomness provider', () => {
  for (const method of ['clear', 'setEnabled']) {
    let generationCalls = 0;
    const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }), {
      newGeneration() { generationCalls += 1; throw new Error('crypto unavailable'); },
    });
    const other = core.create(f.options);
    assert.equal(f.metrics[method](false), true);
    assert.equal(generationCalls, 0);
    assert.deepEqual(f.consent(), { enabled: false, generation: GENERATION });
    assert.equal(other.isEnabled(), false);
    assert.equal(other.record('helper.loaded'), false);
    assert.deepEqual(f.stored().days, []);
    assert.equal(f.metrics.setEnabled(true), false);
    assert.equal(generationCalls, 1);
    assert.equal(f.consent().enabled, false);
  }
});

test('revocation repairs missing or malformed consent with a private fixed off marker and no crypto', () => {
  for (const permission of [undefined, null, { enabled: true, generation: 'private-secret' }, 'corrupt']) {
    const f = fixture(state(), { newGeneration() { throw new Error('crypto unavailable'); } });
    f.replaceConsent(permission);
    assert.equal(f.metrics.setEnabled(false), true);
    assert.equal(f.consent().enabled, false);
    assert.match(f.consent().generation, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.deepEqual(f.metrics.snapshot(), { schema: 1, version: '1.12.0', days: [] });
    assert.equal(JSON.stringify(f.metrics.snapshot()).includes(f.consent().generation), false);
  }
});

test('opt-in after randomness-independent revocation still needs a fresh different token', () => {
  const f = fixture(state(), { newGeneration: () => GENERATION });
  assert.equal(f.metrics.setEnabled(false), true);
  assert.equal(f.metrics.setEnabled(true), false);
  assert.equal(f.metrics.getStatus().errorCode, 'generation-unavailable');
  assert.equal(f.consent().enabled, false);
  f.options.newGeneration = freshGeneration;
  assert.equal(f.metrics.setEnabled(true), true);
  assert.notEqual(f.consent().generation, GENERATION);
  assert.deepEqual(f.metrics.snapshot().days, []);
});

for (const event of ['helper.loaded', 'settings.changed']) {
  test(`a concurrent ${event} increment before verification preserves both counts and stays enabled`, () => {
    const f = fixture(state());
    let interrupt = true;
    const other = core.create({ ...f.options, write(value) {
      f.options.write(value);
      if (interrupt) {
        interrupt = false;
        assert.equal(f.metrics.record(event), true);
      }
    } });
    assert.equal(other.record('helper.loaded'), true);
    assert.equal(other.isEnabled(), true);
    assert.equal(other.getStatus().storageError, false);
    assert.equal(other.getStatus().errorCode, null);
    assert.equal(other.getStatus().total, 2);
    assert.equal(other.record('backup.exported'), true);
    assert.equal(other.getStatus().total, 3);
  });
}

test('a valid concurrent writer that loses an increment is transient and does not disable collection', () => {
  const f = fixture(state());
  let interrupt = true;
  const other = core.create({ ...f.options, write(value) {
    f.options.write(value);
    if (interrupt) {
      interrupt = false;
      f.replace(state({ days: [row('2026-10-13', { 'settings.changed': 1 })] }));
    }
  } });
  assert.equal(other.record('helper.loaded'), false);
  assert.equal(other.isEnabled(), true);
  assert.equal(other.getStatus().storageError, false);
  assert.equal(other.getStatus().errorCode, null);
  assert.equal(other.record('helper.loaded'), true);
  assert.deepEqual(other.snapshot().days, [row('2026-10-13', { 'helper.loaded': 1, 'settings.changed': 1 })]);
});

test('a no-op counter write is still unverified and stops this instance', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 1 })] }), { write() {} });
  assert.equal(f.metrics.record('helper.loaded'), false);
  assert.equal(f.metrics.isEnabled(), false);
  assert.equal(f.metrics.getStatus().storageError, true);
  assert.equal(f.metrics.getStatus().errorCode, 'write-unverified');
  assert.equal(f.stored().days[0].counts['helper.loaded'], 1);
});

test('a concurrent valid document from another generation is ignored without a corruption error', () => {
  const f = fixture(state());
  let interrupt = true;
  const other = core.create({ ...f.options, write(value) {
    f.options.write(value);
    if (interrupt) {
      interrupt = false;
      f.replace(state({ generation: freshGeneration(), days: [row('2026-10-13', { 'helper.loaded': 7 })] }));
    }
  } });
  assert.equal(other.record('helper.loaded'), false);
  assert.equal(other.isEnabled(), true);
  assert.equal(other.getStatus().storageError, false);
  assert.equal(other.getStatus().errorCode, null);
  assert.deepEqual(other.snapshot().days, []);
  assert.equal(other.record('helper.loaded'), true);
  assert.equal(other.getStatus().total, 1);
});

test('a concurrent newer release suspends an older collector without relabeling counts or changing consent', () => {
  const f = fixture(state());
  let interrupt = true;
  const other = core.create({ ...f.options, write(value) {
    f.options.write(value);
    if (interrupt) {
      interrupt = false;
      f.replace(state({ version: '1.13.0', days: [row('2026-10-13', { 'helper.loaded': 7 })] }));
    }
  } });
  assert.equal(other.record('helper.loaded'), false);
  assert.equal(other.getStatus().storageError, false);
  assert.equal(other.isEnabled(), false);
  assert.equal(other.getStatus().errorCode, 'newer-version');
  assert.equal(f.consent().enabled, true);
  assert.deepEqual(other.snapshot().days, []);
});

for (const contaminate of [
  value => { value.privateId = 'secret'; },
  value => { value.days[0].stack = 'secret'; },
  value => { value.days[0].counts['secret.event'] = 1; },
  value => { value.days[0].counts['helper.loaded'] = 1.5; },
  value => { value.days.push(row('2026-10-14', { 'helper.loaded': 1 })); },
]) {
  test('record rejects noncanonical or private data during verification instead of accepting dominance', () => {
    const f = fixture(state());
    const other = core.create({ ...f.options, write(value) {
      value.days[0].counts['helper.loaded'] += 3;
      contaminate(value);
      f.options.write(value);
    } });
    assert.equal(other.record('helper.loaded'), false);
    assert.equal(other.isEnabled(), false);
    assert.equal(other.getStatus().storageError, true);
    assert.equal(other.getStatus().errorCode, 'write-unverified');
    assert.deepEqual(other.snapshot().days, []);
  });
}

test('clear requires exact emptiness and cannot use record dominance verification', () => {
  const f = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 4 })] }), {
    write() {}, remove() {},
  });
  assert.equal(f.metrics.clear(), false);
  assert.equal(f.consent().enabled, false);
  assert.equal(f.metrics.getStatus().deletionPending, true);
  assert.equal(f.metrics.getStatus().storageError, true);
  assert.equal(f.stored().days[0].counts['helper.loaded'], 4);
});

test('a counter adapter throwing after persistence still fails closed', () => {
  const f = fixture(state());
  const other = core.create({ ...f.options, write(value) {
    f.options.write(value);
    throw new Error('private storage failure');
  } });
  assert.equal(other.record('helper.loaded'), false);
  assert.equal(other.isEnabled(), false);
  assert.equal(other.getStatus().storageError, true);
  assert.equal(other.getStatus().errorCode, 'write-failed');
});

test('verification accepts a concurrent increment that crosses UTC midnight without stopping collection', () => {
  const f = fixture(state());
  f.time(Date.parse('2026-10-13T23:59:59.999Z'));
  let interrupt = true;
  const other = core.create({ ...f.options, write(value) {
    f.options.write(value);
    if (interrupt) {
      interrupt = false;
      f.time(Date.parse('2026-10-14T00:00:00.000Z'));
      assert.equal(f.metrics.record('settings.changed'), true);
    }
  } });
  assert.equal(other.record('helper.loaded'), true);
  assert.equal(other.isEnabled(), true);
  assert.equal(other.getStatus().storageError, false);
  assert.equal(other.getStatus().errorCode, null);
  assert.deepEqual(other.snapshot().days, [
    row('2026-10-13', { 'helper.loaded': 1 }),
    row('2026-10-14', { 'settings.changed': 1 }),
  ]);
});

test('an invalid clock during counter verification fails closed without accepting future data', () => {
  for (const clock of [NaN, Infinity, '2026-10-13']) {
    const f = fixture(state());
    const other = core.create({ ...f.options, write(value) {
      f.options.write(value);
      f.time(clock);
    } });
    assert.equal(other.record('helper.loaded'), false);
    f.time(TODAY);
    assert.equal(other.isEnabled(), false);
    assert.equal(other.getStatus().storageError, false);
    assert.equal(other.getStatus().errorCode, 'invalid-clock');
    assert.deepEqual(other.snapshot().days, []);
  }
});

test('verification accepts its own oldest retained day expiring during a midnight write', () => {
  const f = fixture(state({ days: [row('2026-09-14', { 'helper.loaded': 4 })] }));
  f.time(Date.parse('2026-10-13T23:59:59.999Z'));
  const other = core.create({ ...f.options, write(value) {
    f.options.write(value);
    f.time(Date.parse('2026-10-14T00:00:00.000Z'));
  } });
  assert.equal(other.record('helper.loaded'), true);
  assert.equal(other.isEnabled(), true);
  assert.equal(other.getStatus().storageError, false);
  assert.equal(other.getStatus().errorCode, null);
  assert.deepEqual(other.snapshot().days, [row('2026-10-13', { 'helper.loaded': 1 })]);
});

test('A combined metrics report and status share one sanitized counter read without local generation metadata', () => {
  const h = fixture(state({ days: [row('2026-10-13', { 'helper.loaded': 2, 'settings.changed': 3 })] }));
  const before = h.calls.read;
  const view = h.metrics.getReport();
  assert.equal(h.calls.read - before, 1);
  assert.deepEqual(Object.keys(view.report).sort(), ['days', 'schema', 'version']);
  assert.equal(view.status.enabled, true);
  assert.equal(view.status.total, 5);
  assert.equal(view.status.days, view.report.days.length);
  assert.equal(JSON.stringify(view).includes(GENERATION), false);
  assert.deepEqual(view.report, h.metrics.snapshot());
  assert.deepEqual(view.status, h.metrics.getStatus());
});
