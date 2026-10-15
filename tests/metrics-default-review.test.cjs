'use strict';
// Independent review: run the real production adapter over adversarial shared
// storage. No browser, game, network, secrets, or account state is involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');
const localCore = fs.readFileSync(path.join(root, 'docs/metrics-core.js'), 'utf8');
const remoteCore = fs.readFileSync(path.join(root, 'docs/telemetry-core.js'), 'utf8');
const KEY = 'old-light-auto-upgrade:metrics:v1';
const CONSENT = 'old-light-auto-upgrade:metrics-consent:v1';
const UUID = '1d6b27b3-c1c2-4c3a-9abc-444444444444';
const copy = value => JSON.parse(JSON.stringify(value));
function slice(begin, end) {
  const start = source.indexOf(begin), stop = source.indexOf(end, start);
  assert.ok(start >= 0 && stop > start);
  return source.slice(start, stop);
}
function fixture(storage = new Map(), options = {}) {
  const writes = [], reads = [];
  let network = 0, tick = 0;
  const hooks = {};
  const context = vm.createContext({ SCRIPT_VERSION: '1.17.8', crypto: options.crypto === undefined ? crypto : options.crypto,
    performance: { now: () => tick++ },
    fetch() { network++; throw Error('Forbidden network'); },
    GM_xmlhttpRequest() { network++; throw Error('Forbidden network'); },
    GM_getValue() { throw Error('Unexpected private store'); },
    GM_setValue() { throw Error('Unexpected private store'); },
    setTimeout() { throw Error('Unexpected remote timer'); }, clearTimeout() {},
    localStorage: {
      getItem(key) { reads.push(key); hooks.beforeRead?.(key); return storage.get(key) ?? null; },
      setItem(key, value) { hooks.beforeWrite?.(key, value); writes.push([key, value]); storage.set(key, value); hooks.afterWrite?.(key, value); },
      removeItem(key) { storage.delete(key); },
    },
  });
  vm.runInContext(localCore + remoteCore
    + slice('  function createLocalMetrics(', '  function installMetricsPanel(')
    + slice('  function createTelemetry()', '  function installTelemetryPanel(')
    + '\nthis.remote = createTelemetry(); this.local = createLocalMetrics(remote);', context);
  return { storage, writes, reads, hooks, local: context.local, remote: context.remote, network: () => network };
}
function counts(local) { return Object.assign({}, ...copy(local.snapshot()).days.map(day => day.counts)); }
function off() { return JSON.stringify({ enabled: false, generation: UUID }); }

test('default review: unset local metrics enable without ever persisting consent and remote remains inert', async () => {
  const h = fixture();
  assert.equal(h.local.isEnabled(), true);
  assert.equal(h.storage.size, 0, 'reading the default creates no persistent consent');
  assert.equal(h.local.record('helper.loaded'), true);
  assert.deepEqual(counts(h.local), { 'helper.loaded': 1 });
  assert.equal(h.storage.has(CONSENT), false);
  assert.deepEqual(h.writes.map(([key]) => key), [KEY]);
  assert.equal(h.remote.getStatus().configured, false);
  assert.equal(h.remote.isEnabled(), false);
  assert.equal(h.remote.getStatus().queued, 0);
  assert.equal(await h.remote.flush(), false);
  assert.equal(h.network(), 0);
});

test('default review: stored opt-out survives fresh instances and repeated collection without modification', () => {
  const raw = off(), storage = new Map([[CONSENT, raw], ['old-light-auto-upgrade:v1', '{"secret":"synthetic"}']]);
  for (let i = 0; i < 3; i++) {
    const h = fixture(storage);
    assert.equal(h.local.isEnabled(), false);
    assert.equal(h.local.record('helper.loaded'), false);
    assert.equal(h.local.startTiming(), null);
    assert.deepEqual(counts(h.local), {});
    assert.equal(storage.get(CONSENT), raw);
    assert.equal(h.writes.length, 0);
    assert.equal(storage.get('old-light-auto-upgrade:v1'), '{"secret":"synthetic"}');
  }
});

test('default review: a present null or invalid record is never treated as absent consent', () => {
  const values = ['null', '', 'false', '{}', '{"enabled":false}', '{"enabled":true}',
    '{"enabled":false,"generation":"broken"}', '{"enabled":true,"generation":"broken"}', '{bad', ' '.repeat(1025)];
  for (const raw of values) {
    const h = fixture(new Map([[CONSENT, raw]]));
    assert.equal(h.local.isEnabled(), false, JSON.stringify(raw));
    assert.equal(h.local.record('helper.loaded'), false, JSON.stringify(raw));
    assert.equal(h.local.startTiming(), null, JSON.stringify(raw));
    assert.deepEqual(counts(h.local), {});
    assert.equal(h.storage.get(CONSENT), raw);
    assert.equal(h.writes.length, 0);
  }
});

test('default review: failed consent reads cannot become an implicit local opt-in', () => {
  const h = fixture(); h.hooks.beforeRead = key => { if (key === CONSENT) throw Error('Denied'); };
  assert.equal(h.local.isEnabled(), false);
  assert.equal(h.local.record('helper.loaded'), false);
  assert.equal(h.local.getStatus().storageError, true);
  assert.equal(h.writes.length, 0);
});

test('default review: default tabs share counters while explicit opt-out wins without a consent initialization race', () => {
  const storage = new Map(), a = fixture(storage), b = fixture(storage);
  assert.equal(a.local.record('helper.loaded'), true);
  assert.equal(b.local.record('ui.tab.data'), true);
  assert.deepEqual(counts(a.local), { 'helper.loaded': 1, 'ui.tab.data': 1 });
  assert.equal(a.local.setEnabled(false), true);
  const explicit = storage.get(CONSENT);
  assert.equal(JSON.parse(explicit).enabled, false);
  assert.equal(b.local.record('error.runtime'), false);
  assert.equal(b.local.isEnabled(), false);
  assert.deepEqual(counts(b.local), {});
  assert.equal(fixture(storage).local.isEnabled(), false);
  assert.equal(storage.get(CONSENT), explicit);
  assert.equal(b.writes.some(([key]) => key === CONSENT), false);
});

test('default review: stale counter writers do not override a concurrent explicit opt-out', () => {
  for (const phase of ['beforeWrite', 'afterWrite']) {
    const storage = new Map(), writer = fixture(storage), controller = fixture(storage);
    let revoked = false, saved;
    writer.hooks[phase] = key => {
      if (key !== KEY || revoked) return;
      revoked = true;
      assert.equal(controller.local.setEnabled(false), true);
      saved = storage.get(CONSENT);
    };
    assert.equal(writer.local.record('helper.loaded'), false, phase);
    assert.equal(revoked, true);
    assert.equal(storage.get(CONSENT), saved);
    assert.equal(JSON.parse(saved).enabled, false);
    assert.equal(writer.local.isEnabled(), false);
    assert.equal(fixture(storage).local.isEnabled(), false);
    assert.deepEqual(counts(writer.local), {});
    assert.equal(writer.writes.some(([key]) => key === CONSENT), false);
  }
});

test('default review: opt-out during state read prevents every counter write', () => {
  const storage = new Map(), a = fixture(storage), b = fixture(storage);
  let revoked = false;
  a.hooks.beforeRead = key => {
    if (key !== KEY || revoked) return;
    revoked = true; assert.equal(b.local.setEnabled(false), true);
  };
  assert.equal(a.local.record('helper.loaded'), false);
  assert.equal(revoked, true);
  assert.equal(a.writes.length, 0);
  assert.equal(a.local.isEnabled(), false);
});

test('default review: a timing sample begun under the default is discarded after opt-out or a new opt-in', () => {
  for (const reenable of [false, true]) {
    const storage = new Map(), a = fixture(storage), b = fixture(storage);
    const timing = a.local.startTiming(); assert.ok(timing);
    assert.equal(b.local.setEnabled(false), true);
    if (reenable) assert.equal(b.local.setEnabled(true), true);
    a.local.finishTiming(timing);
    assert.deepEqual(counts(a.local), {});
    assert.equal(a.writes.some(([key]) => key === CONSENT), false);
  }
});

test('default review: default collection needs no random identity and manual re-enable still rotates secure generation', () => {
  const h = fixture(new Map(), { crypto: {} });
  assert.equal(h.local.record('helper.loaded'), true);
  const defaultGeneration = JSON.parse(h.storage.get(KEY)).generation;
  assert.equal(h.local.setEnabled(false), true);
  assert.equal(h.local.setEnabled(true), false, 'manual opt-in without secure randomness still fails closed');
  assert.equal(h.local.isEnabled(), false);
  const fresh = fixture(h.storage);
  assert.equal(fresh.local.setEnabled(true), true);
  const enabled = JSON.parse(h.storage.get(CONSENT));
  assert.equal(enabled.enabled, true);
  assert.notEqual(enabled.generation, defaultGeneration);
  assert.equal(Object.hasOwn(copy(fresh.local.snapshot()), 'generation'), false);
});

test('default review: an existing explicit opt-in generation is respected and never rotated at startup', () => {
  const raw = JSON.stringify({ enabled: true, generation: UUID }), h = fixture(new Map([[CONSENT, raw]]));
  assert.equal(h.local.record('helper.loaded'), true);
  assert.equal(JSON.parse(h.storage.get(KEY)).generation, UUID);
  assert.equal(h.storage.get(CONSENT), raw);
  assert.equal(h.writes.some(([key]) => key === CONSENT), false);
});

test('default review: generic metrics core remains off when its adapter supplies no consent', () => {
  const core = require('../docs/metrics-core.js'); let writes = 0;
  const h = core.create({ version: '1.17.8', readConsent: () => null, writeConsent() { writes++; }, read: () => null, write() { writes++; } });
  assert.equal(h.isEnabled(), false);
  assert.equal(h.record('helper.loaded'), false);
  assert.equal(writes, 0);
});
