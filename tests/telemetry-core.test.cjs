'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../docs/telemetry-core.js');
const metrics = require('../docs/metrics-core.js');
const G = '00000000-0000-4000-8000-000000000001';
const G2 = '00000000-0000-4000-8000-000000000002';
const consent = (patch = {}) => ({ schema: 1, policy: 1, destinationId: 'synthetic', enabled: true, generation: G, ...patch });
function fixture(overrides = {}) {
  let raw = consent(), now = 0, sequence = 10, timerId = 0;
  const timers = new Map(), calls = [], writes = [];
  const options = { version: '1.16.7', destination: { verified: true, id: 'synthetic' },
    readConsent: () => raw, writeConsent: value => { raw = value; writes.push(value); },
    randomUUID: () => '00000000-0000-4000-8000-' + (++sequence).toString(16).padStart(12, '0'),
    now: () => now, AbortController,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    transport(batch, context) { calls.push({ batch, context }); return { accepted: true }; }, ...overrides };
  const remote = core.create(options);
  return { remote, options, calls, timers, writes, raw: () => raw, replace: value => { raw = value; },
    time: value => { now = value; },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const first = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!first || first[1].at > until) break;
        now = first[1].at; timers.delete(first[0]); first[1].fn();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      }
      now = until; await Promise.resolve();
    },
  };
}

test('telemetry core exports frozen API and the exact closed local event vocabulary', () => {
  assert.equal(Object.isFrozen(core), true);
  assert.equal(Object.isFrozen(core.EVENTS), true);
  assert.equal(Object.isFrozen(core.BUCKETS), true);
  assert.deepEqual(core.EVENTS, metrics.EVENTS);
  assert.equal(core.EVENTS.length, 36);
  assert.equal(Object.isFrozen(core.create()), true);
  for (const value of [null, false, 'invalid']) assert.equal(core.create(value).getStatus().configured, false);
});

test('telemetry core has no network client, provider, credentials, DOM or persistence', () => {
  const source = fs.readFileSync(path.join(__dirname, '../docs/telemetry-core.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|GM_xmlhttpRequest|localStorage|sessionStorage|document)\b/);
  assert.doesNotMatch(source, /https?:\/\/|phc_|phx_|phk_|api_key|projectToken|identify\(/);
});

for (const destination of [undefined, null, {}, { verified: false, id: 'synthetic' }, { verified: true, id: 'https://private.invalid' }, { verified: true, id: 'user@example.test' }]) {
  test('telemetry requires verified application destination: ' + JSON.stringify(destination), async () => {
    const f = fixture({ destination });
    assert.equal(f.remote.record('helper.loaded'), false);
    assert.equal(f.remote.duration('helper.step', 12), false);
    assert.equal(f.remote.setEnabled(true), false);
    assert.equal(await f.remote.flush(), false);
    assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.writes.length, 0);
    assert.equal(f.remote.getStatus().configured, false);
  });
}

test('telemetry requires transport and separate consent adapters', async () => {
  for (const key of ['transport', 'readConsent', 'writeConsent']) {
    const f = fixture({ [key]: null });
    assert.equal(f.remote.isEnabled(), false);
    assert.equal(f.remote.record('helper.loaded'), false);
    assert.equal(await f.remote.flush(), false); assert.equal(f.calls.length, 0);
  }
});

for (const raw of [null, undefined, { enabled: true, generation: G }, consent({ enabled: false }), consent({ policy: 2 }), consent({ destinationId: 'different' }), consent({ generation: 'player-id' })]) {
  test('local, missing, revoked or mismatched consent cannot authorize remote collection: ' + JSON.stringify(raw), async () => {
    const f = fixture(); f.replace(raw);
    assert.equal(f.remote.record('helper.loaded'), false);
    assert.equal(await f.remote.flush(), false);
    assert.deepEqual(f.remote.snapshot().counts, {}); assert.equal(f.calls.length, 0);
  });
}

test('telemetry rejects accessors and promises in consent without evaluating them', async () => {
  let reads = 0;
  const hostile = consent(); Object.defineProperty(hostile, 'enabled', { get() { reads++; return true; } });
  for (const raw of [hostile, Promise.reject(new Error('private secret'))]) {
    const f = fixture(); f.replace(raw);
    assert.equal(f.remote.isEnabled(), false); assert.equal(f.remote.getStatus().state, 'storage_error');
  }
  await Promise.resolve(); assert.equal(reads, 0);
});

test('telemetry payload only carries fixed counts, buckets, schema and numeric helper version', async () => {
  const f = fixture({ version: '1.2.3-private' });
  const secrets = { account: 'PRIVATE_ACCOUNT', player: 'PRIVATE_PLAYER', url: 'https://PRIVATE_URL/?token=PRIVATE_TOKEN', stack: 'PRIVATE_STACK' };
  for (const name of core.EVENTS) assert.equal(f.remote.record(name, secrets), true);
  for (const name of ['__proto__', 'constructor', 'player.id', '', secrets, Symbol('private')]) assert.equal(f.remote.record(name), false);
  assert.equal(await f.remote.flush(), true);
  const payload = f.calls[0].batch;
  assert.deepEqual(Object.keys(payload).sort(), ['counts', 'duration_buckets', 'helper_version', 'schema']);
  assert.deepEqual(Object.keys(payload.counts), core.EVENTS);
  assert.equal(payload.helper_version, 'unknown');
  assert.deepEqual(payload.duration_buckets, { helper_step: {} });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /PRIVATE|generation|destinationId|timestamp|distinct_id/);
  assert.equal(serialized.includes(G), false); assert.ok(serialized.length <= core.MAX_BYTES);
});

test('telemetry performance uses fixed histogram boundaries and rejects arbitrary names/values', () => {
  const f = fixture();
  for (const value of [0, 0.999, 1, 3.999, 4, 15.999, 16, 49.999, 50, 199.999, 200, 999.999, 1000, 60000]) assert.equal(f.remote.duration('helper.step', value), true);
  for (const value of [-1, NaN, Infinity, 60001, '7', {}, null]) assert.equal(f.remote.duration('helper.step', value), false);
  assert.equal(f.remote.duration('PRIVATE_URL', 2), false);
  assert.deepEqual(f.remote.snapshot().duration_buckets.helper_step, Object.fromEntries(core.BUCKETS.map(key => [key, 2])));
});

test('telemetry counters and memory cardinality stay bounded', () => {
  const f = fixture();
  for (let i = 0; i <= core.MAX_COUNT; i++) f.remote.record('helper.loaded');
  assert.equal(f.remote.snapshot().counts['helper.loaded'], core.MAX_COUNT);
  for (let i = 0; i < 2000; i++) f.remote.record('unknown.' + i);
  assert.deepEqual(Object.keys(f.remote.snapshot().counts), ['helper.loaded']);
  assert.equal(f.timers.size, 1);
});

test('telemetry snapshots detach queued values and cannot inject additional dimensions', async () => {
  const f = fixture(); f.remote.record('helper.loaded');
  const snapshot = f.remote.snapshot(); snapshot.counts['private.data'] = 9; snapshot.counts['helper.loaded'] = -3;
  snapshot.duration_buckets.helper_step.private = 'secret';
  assert.equal(await f.remote.flush(), true);
  assert.deepEqual(f.calls[0].batch.counts, { 'helper.loaded': 1 });
  assert.deepEqual(f.calls[0].batch.duration_buckets, { helper_step: {} });
});

test('telemetry waits five minutes, batches observations and records transport acceptance only', async () => {
  const f = fixture(); f.remote.record('helper.loaded'); f.remote.record('helper.loaded');
  await f.advance(core.INTERVAL - 1); assert.equal(f.calls.length, 0);
  await f.advance(1); assert.equal(f.calls.length, 1);
  assert.equal(f.remote.getStatus().state, 'accepted'); assert.equal(f.remote.getStatus().accepted, 2);
  assert.equal(f.timers.size, 0); assert.equal(f.calls[0].context.destinationId, 'synthetic');
});

test('telemetry limits repeated flushes to twelve attempts per hour per instance', async () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) {
    f.time(i * core.INTERVAL); f.remote.record('helper.loaded'); assert.equal(await f.remote.flush(), true);
    f.remote.record('helper.loaded'); assert.equal(await f.remote.flush(), false);
  }
  assert.equal(f.calls.length, 12);
  f.time(3600000 - 1); assert.equal(await f.remote.flush(), false);
  f.time(3600000); assert.equal(await f.remote.flush(), true); assert.equal(f.calls.length, 13);
});

for (const transport of [() => ({ accepted: false }), () => ({ status: 200 }), () => { throw new Error('secret'); }, () => Promise.reject(new Error('secret')), () => new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('secret'); } })]) {
  test('telemetry drops failed or ambiguous deliveries without retries: ' + transport.toString(), async () => {
    const f = fixture({ transport }); f.remote.record('helper.loaded');
    assert.equal(await f.remote.flush(), false);
    assert.equal(f.remote.getStatus().state, 'send_failed'); assert.equal(f.remote.getStatus().dropped, 1);
    assert.deepEqual(f.remote.snapshot().counts, {}); assert.equal(f.timers.size, 0);
  });
}

test('telemetry timeout terminates a transport that ignores abort without blocking later observations', async () => {
  let signal;
  const f = fixture({ transport: (_, context) => { signal = context.signal; return new Promise(() => {}); } });
  f.remote.record('helper.loaded'); const flushed = f.remote.flush();
  await f.advance(core.TIMEOUT); assert.equal(await flushed, false); assert.equal(signal.aborted, true);
  assert.equal(f.remote.getStatus().state, 'send_failed'); assert.equal(f.timers.size, 0);
});

test('telemetry revocation clears queued data, timers and future sends without replay', async () => {
  const f = fixture(); f.remote.record('helper.loaded'); f.remote.duration('helper.step', 4);
  assert.equal(f.remote.setEnabled(false), true); assert.equal(f.raw().enabled, false);
  assert.equal(f.remote.getStatus().queued, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.remote.record('helper.loaded'), false); assert.equal(await f.remote.flush(), false);
  assert.equal(f.remote.setEnabled(true), true); assert.notEqual(f.raw().generation, G);
  assert.deepEqual(f.remote.snapshot().counts, {}); assert.equal(f.calls.length, 0);
});

test('telemetry other-tab revocation aborts pending transport even if it never settles', async () => {
  let signal;
  const f = fixture({ transport: (_, context) => { signal = context.signal; return new Promise(() => {}); } });
  f.remote.record('helper.loaded'); const flushed = f.remote.flush();
  f.replace(consent({ enabled: false })); await f.advance(core.WATCH);
  assert.equal(await flushed, false); assert.equal(signal.aborted, true);
  assert.equal(f.remote.getStatus().enabled, false); assert.equal(f.timers.size, 0);
});

test('telemetry old generation cannot survive off-on in another tab or count a late response', async () => {
  let reply;
  const f = fixture({ transport: () => new Promise(resolve => { reply = resolve; }) });
  f.remote.record('helper.loaded'); const flushed = f.remote.flush();
  f.replace(consent({ generation: G2 })); f.remote.record('drive.connected');
  reply({ accepted: true }); assert.equal(await flushed, false);
  assert.equal(f.remote.getStatus().accepted, 0);
  assert.deepEqual(f.remote.snapshot().counts, { 'drive.connected': 1 });
});

test('telemetry rechecks consent immediately before transport after setup', async () => {
  let controller;
  const f = fixture({ AbortController: class extends AbortController { constructor() { super(); controller = this; f.replace(consent({ enabled: false })); } } });
  f.remote.record('helper.loaded'); assert.equal(await f.remote.flush(), false);
  assert.equal(controller.signal.aborted, true); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
});

test('telemetry no-op, failed, async and revoked consent writes fail closed', async () => {
  for (const writeConsent of [() => false, () => undefined, () => Promise.reject(new Error('write denied')), () => { throw new Error('storage denied'); }]) {
    const f = fixture({ writeConsent }); f.remote.record('helper.loaded');
    assert.equal(f.remote.setEnabled(false), false); assert.equal(f.remote.getStatus().enabled, false);
    assert.equal(await f.remote.flush(), false); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  }
});

test('telemetry read failures purge data and stay off until explicit repaired consent', () => {
  const f = fixture(); f.remote.record('helper.loaded');
  f.options.readConsent = () => { throw new Error('PRIVATE'); };
  assert.equal(f.remote.record('helper.loaded'), false); assert.equal(f.remote.getStatus().state, 'storage_error');
  f.options.readConsent = () => f.raw(); assert.equal(f.remote.isEnabled(), false);
  assert.equal(f.remote.setEnabled(true), true); assert.equal(f.remote.isEnabled(), true);
  assert.deepEqual(f.remote.snapshot().counts, {});
});

test('telemetry refuses invalid opt-ins, reused generation, or missing randomness; opt-out needs none', () => {
  for (const randomUUID of [() => G, () => 'private-id', () => { throw new Error('missing crypto'); }]) {
    const f = fixture({ randomUUID });
    assert.equal(f.remote.setEnabled(true), false); assert.equal(f.remote.isEnabled(), false);
    assert.equal(f.remote.setEnabled(false), true); assert.equal(f.raw().enabled, false);
  }
  const f = fixture(); for (const value of [1, 'true', {}, null]) assert.equal(f.remote.setEnabled(value), false);
});

test('telemetry handles invalid or backwards clock without retrying old data', async () => {
  for (const stamp of [NaN, Infinity, -1, '0']) {
    const f = fixture({ now: () => stamp }); f.remote.record('helper.loaded');
    assert.equal(await f.remote.flush(), false); assert.equal(f.remote.getStatus().state, 'clock_error');
  }
  const f = fixture(); f.time(100); f.remote.record('helper.loaded'); await f.remote.flush();
  f.time(99); f.remote.record('helper.loaded'); assert.equal(await f.remote.flush(), false);
  assert.equal(f.remote.getStatus().enabled, false); assert.equal(f.calls.length, 1);
});

test('telemetry destroy permanently cancels a pending send and never reactivates', async () => {
  const f = fixture({ transport: () => new Promise(() => {}) }); f.remote.record('helper.loaded');
  const pending = f.remote.flush(); f.remote.destroy(); assert.equal(await pending, false);
  assert.equal(f.timers.size, 0); assert.equal(f.remote.setEnabled(true), false);
  assert.equal(f.remote.record('helper.loaded'), false); assert.equal(f.remote.getStatus().enabled, false);
});
