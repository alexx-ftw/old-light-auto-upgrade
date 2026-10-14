'use strict';
// Independent review: synthetic data, isolated VM realms, local storage only.
// Never connects to a game, invokes a browser, or changes real permissions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const crypto = require('node:crypto').webcrypto;
const root = path.join(__dirname, '..');
const observer = require('../docs/empire-observer.js');
const adapter = require('../docs/empire-adapter.js');
const clone = value => JSON.parse(JSON.stringify(value));
const SECRET = 'REVIEW_PRIVATE_PAYLOAD_NEVER_RETAIN';

function nativeFixtures() {
  // Reuse the existing synthetic transport, but run our own assertions against
  // actual current sources and the current builder rather than a stub observer.
  const file = path.join(__dirname, 'empire-late-start-review.test.cjs');
  const source = fs.readFileSync(file, 'utf8');
  const end = source.indexOf("for (const readyState of ['loading', 'interactive', 'complete'])");
  assert.ok(end > 0);
  const context = { require: createRequire(file), __dirname, URL, console };
  vm.runInNewContext(source.slice(0, end) + '\nthis.fixtures = { fixture, delta, initial, SOCKET, NOW };', context, { filename: file });
  return context.fixtures;
}

function nativeApp(h, now) {
  return adapter.create({ getWorld: () => h.bridge?.snapshot() || null,
    getObservationStatus: () => ({ ...h.bridge?.status(), bootstrap: h.content.OldLightEmpireBootstrapStatus?.() }),
    getContext: () => null, getHudSnapshot: () => null, now: () => now });
}

test('diagnostic review: valid pre-init delta is missing-init without retaining its body', () => {
  for (const body of [{}, { updated: { players: [{ id: SECRET, owned: [], token: SECRET }] } }]) {
    const parsed = observer.parseFrame('42' + JSON.stringify(['world.delta', body]));
    assert.deepEqual(parsed, { kind: 'missing-init' });
    assert.equal(JSON.stringify(parsed).includes(SECRET), false);
  }
  const acknowledged = observer.parseFrame('42123["world.delta",{}]');
  assert.deepEqual(acknowledged, { kind: 'missing-init' });
});

test('diagnostic review: malformed pre-init envelopes are still rejected before missing-init', () => {
  for (const frame of [
    '42["world.delta",{}', '42["world.delta"]', '42["world.delta",{},{}]',
    '42["world.delta",null]', '42["world.delta",[]]', '42["world.delta",false]',
    '42["world.delta",{"x":' + '['.repeat(40) + '0' + ']'.repeat(40) + '}]',
    '42["world.init",{}]', '45invalid', '46invalid', new Uint8Array([1]),
    '42["world.delta",{"private":"' + 'x'.repeat(observer.LIMITS.frame) + '"}]',
  ]) assert.deepEqual(observer.parseFrame(frame), { kind: 'invalid' });
  assert.deepEqual(observer.parseFrame('42["session.token",{"secret":"' + SECRET + '"}]'), { kind: 'ignore' });
});

test('diagnostic review: real transport distinguishes missing-init from malformed and stays unavailable', () => {
  const { fixture, delta, initial, SOCKET, NOW } = nativeFixtures();
  const h = fixture(), app = nativeApp(h, NOW);
  assert.match(app.getStatus(), /esperando la conexión nativa/);
  const socket = new h.page.WebSocket(SOCKET); socket.onmessage = () => {}; h.flush();
  assert.match(app.getStatus(), /Conexión nativa detectada; esperando el estado inicial/);
  h.fire(socket, delta());
  assert.equal(h.bridge.status().reason, 'missing-init');
  assert.match(app.getStatus(), /sin el estado inicial/);
  assert.equal(app.isAvailable(), false);
  assert.equal(app.readRoster(), null);
  assert.equal(app.readSnapshots(), null);
  assert.equal(app.readTransitCensus(), null);
  assert.equal(h.bridge.snapshot().selfId, '');
  assert.equal(h.bridge.snapshot().systems.length, 0);
  h.fire(socket, '42["world.delta",null]');
  assert.equal(h.bridge.status().reason, 'malformed');
  assert.match(app.getStatus(), /formato no válido/);
  assert.equal(app.isAvailable(), false);
  h.fire(socket, initial());
  assert.equal(app.isAvailable(), true);
  assert.equal(h.bridge.snapshot().complete, true);
  assert.equal(h.effects.length, 0);
});

test('diagnostic review: new generation cannot reuse prior identity for a pre-init delta', () => {
  const { fixture, delta, initial, SOCKET, NOW } = nativeFixtures();
  const h = fixture(), app = nativeApp(h, NOW);
  const first = new h.page.WebSocket(SOCKET); first.onmessage = () => {};
  h.fire(first, initial());
  assert.equal(app.isAvailable(), true);
  const next = new h.page.WebSocket(SOCKET); next.onmessage = () => {};
  h.fire(next, delta());
  assert.equal(h.bridge.status().reason, 'missing-init');
  assert.equal(h.bridge.snapshot().generation, 2);
  assert.equal(h.bridge.snapshot().selfId, '');
  assert.equal(h.bridge.snapshot().scope, '');
  assert.equal(h.bridge.snapshot().systems.length, 0);
  assert.equal(app.isAvailable(), false);
  h.fire(first, initial());
  assert.equal(app.isAvailable(), false);
  h.fire(next, initial());
  assert.equal(app.isAvailable(), true);
  assert.equal(h.effects.length, 0);
});

test('diagnostic review: bridge status remains a bounded category-and-booleans projection', () => {
  const { fixture, delta, initial, SOCKET } = nativeFixtures();
  const h = fixture();
  function check(expected) {
    const status = clone(h.bridge.status());
    assert.deepEqual(Object.keys(status).sort(), ['complete', 'connected', 'connectionObserved', 'installed', 'observed', 'reason']);
    for (const [key, value] of Object.entries(status)) assert.equal(typeof value, key === 'reason' ? 'string' : 'boolean');
    for (const [key, value] of Object.entries(expected)) assert.equal(status[key], value, key);
  }
  check({ connectionObserved: false, complete: false, installed: true });
  const socket = new h.page.WebSocket(SOCKET); socket.onmessage = () => {}; h.flush();
  check({ connectionObserved: true, complete: false });
  h.fire(socket, delta());
  check({ connectionObserved: true, complete: false, reason: 'missing-init' });
  h.fire(socket, initial());
  check({ connectionObserved: true, complete: true, reason: '' });
  assert.equal(h.effects.length, 0);
});

function metricsHarness(sharedStorage = new Map(), options = {}) {
  const userscript = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');
  const writes = [];
  let now = Date.UTC(2026, 9, 14, 12);
  const version = options.version || /const SCRIPT_VERSION = '([^']+)'/.exec(userscript)[1];
  const context = vm.createContext({ SCRIPT_VERSION: version, crypto,
    Date: class extends Date { static now() { return now; } },
    localStorage: { getItem: key => sharedStorage.get(key) ?? null,
      setItem: (key, value) => { writes.push(key); sharedStorage.set(key, value); },
      removeItem: key => sharedStorage.delete(key) } });
  vm.runInContext(fs.readFileSync(path.join(root, 'docs/metrics-core.js'), 'utf8'), context);
  const begin = userscript.indexOf('  function createLocalMetrics()');
  const end = userscript.indexOf('  function installMetricsPanel(', begin);
  assert.ok(begin > 0 && end > begin);
  const metrics = vm.runInContext(userscript.slice(begin, end) + '\ncreateLocalMetrics();', context);
  const readBegin = userscript.indexOf('  function observeEmpireStartup()');
  const readEnd = userscript.indexOf('  function updateEmpireState()', readBegin);
  assert.ok(readBegin > 0 && readEnd > readBegin);
  context.metrics = metrics;
  vm.runInContext(userscript.slice(readBegin, readEnd) + '\nthis.observeStartup = observeEmpireStartup;', context);
  return { metrics, storage: sharedStorage, writes, context,
    advance: days => { now += days * 86400000; },
    counts: () => Object.assign({}, ...clone(metrics.snapshot()).days.map(day => day.counts)),
    observe(state, bootstrap = { phase: 'attempted' }) {
      context.OldLightEmpireBridge = { status: () => state,
        snapshot: () => { throw new Error('Metrics must not read a world snapshot'); } };
      context.OldLightEmpireBootstrapStatus = () => bootstrap;
      context.observeStartup();
    },
  };
}

test('diagnostic review: imperial metrics default off and never replay pre-consent transitions', () => {
  const h = metricsHarness();
  for (const code of ['socket_unobserved', 'awaiting_init', 'missing_init']) h.metrics.observeEmpireStatus(code);
  assert.deepEqual(h.counts(), {});
  assert.equal(h.storage.size, 0);
  assert.equal(h.writes.length, 0);
  h.metrics.setEnabled(true);
  assert.deepEqual(h.counts(), {});
  h.metrics.observeEmpireStatus('missing_init');
  assert.deepEqual(h.counts(), {});
  h.metrics.observeEmpireStatus('census_received');
  assert.deepEqual(h.counts(), { 'empire.observer.census_received': 1 });
});

test('diagnostic review: imperial metrics count fixed transitions, not repeated frames or arbitrary data', () => {
  const h = metricsHarness(); h.metrics.setEnabled(true);
  const codes = ['installation_failed', 'socket_unobserved', 'awaiting_init', 'missing_init',
    'format_rejected', 'observation_rejected', 'census_received', 'connection_lost', 'incomplete'];
  const expected = {};
  for (const code of codes) {
    for (let repeat = 0; repeat < 10; repeat++) h.metrics.observeEmpireStatus(code);
    expected['empire.observer.' + code] = 1;
  }
  let accessed = 0;
  const hostile = { toString() { accessed++; throw new Error(SECRET); } };
  for (const code of [null, undefined, '', SECRET, {}, hostile, new String('census_received'),
    Symbol('census_received'), ['census_received'], 'census_received.' + SECRET]) {
    assert.doesNotThrow(() => h.metrics.observeEmpireStatus(code));
  }
  h.metrics.observeEmpireStatus('incomplete');
  assert.equal(accessed, 0);
  assert.deepEqual(h.counts(), expected);
  h.metrics.observeEmpireStatus('census_received');
  expected['empire.observer.census_received']++;
  assert.deepEqual(h.counts(), expected);
  assert.equal(h.metrics.record('ui.tab.empire', { payload: SECRET }), true);
  expected['ui.tab.empire'] = 1;
  assert.deepEqual(h.counts(), expected);
  assert.equal(JSON.stringify([...h.storage]).includes(SECRET), false);
  assert.equal(JSON.stringify(h.metrics.snapshot()).includes(SECRET), false);
  assert.deepEqual([...new Set(h.writes)].sort(), ['old-light-auto-upgrade:metrics-consent:v1', 'old-light-auto-upgrade:metrics:v1']);
});

test('diagnostic review: another tab opt-out erases imperial counts and prevents late writes', () => {
  const h = metricsHarness(); h.metrics.setEnabled(true);
  h.metrics.observeEmpireStatus('census_received');
  const other = metricsHarness(h.storage);
  // setEnabled reports verified success, not the requested enabled state.
  assert.equal(other.metrics.setEnabled(false), true);
  assert.equal(other.metrics.isEnabled(), false);
  assert.equal(JSON.parse(h.storage.get('old-light-auto-upgrade:metrics-consent:v1')).enabled, false);
  // Erasure normally persists a verified empty state; removing the key is only
  // the fallback when that empty write cannot be verified. Both erase counts.
  const erased = JSON.parse(h.storage.get('old-light-auto-upgrade:metrics:v1'));
  assert.deepEqual(erased.days, []);
  const storedBefore = [...h.storage];
  const writesBefore = h.writes.length;
  h.metrics.observeEmpireStatus('connection_lost');
  assert.equal(h.metrics.isEnabled(), false);
  assert.deepEqual(h.counts(), {});
  assert.equal(h.writes.length, writesBefore);
  assert.deepEqual([...h.storage], storedBefore);
  assert.equal(other.metrics.getStatus().total, 0);
  assert.equal(h.metrics.record('ui.tab.empire'), false);
  assert.deepEqual([...h.storage], storedBefore);
  assert.equal(h.metrics.setEnabled(true), true);
  assert.deepEqual(h.counts(), {});
  h.metrics.observeEmpireStatus('connection_lost');
  assert.deepEqual(h.counts(), {}, 'the transition observed while off is not replayed');
  h.metrics.observeEmpireStatus('census_received');
  assert.deepEqual(h.counts(), { 'empire.observer.census_received': 1 });
});

test('diagnostic review: current classifier maps actual bridge lifecycle without reading census data', () => {
  const { fixture, delta, initial, SOCKET, NOW } = nativeFixtures();
  const native = fixture(), app = nativeApp(native, NOW), h = metricsHarness();
  h.metrics.setEnabled(true);
  const observe = () => h.observe(native.bridge.status(), native.content.OldLightEmpireBootstrapStatus());
  observe(); observe();
  const socket = new native.page.WebSocket(SOCKET); socket.onmessage = () => {}; native.flush();
  observe();
  native.fire(socket, delta()); observe(); observe();
  assert.equal(app.isAvailable(), false);
  native.fire(socket, '42["world.delta",null]'); observe();
  assert.equal(app.isAvailable(), false);
  native.fire(socket, initial({ complete: false })); observe();
  assert.equal(app.isAvailable(), false);
  native.fire(socket, initial()); observe(); observe();
  assert.equal(app.isAvailable(), true);
  native.fire(socket, '41'); observe();
  assert.equal(app.isAvailable(), false);
  const failed = fixture({ delayed: true }); failed.flush(2001);
  h.observe(failed.bridge.status(), failed.content.OldLightEmpireBootstrapStatus());
  assert.deepEqual(h.counts(), {
    'empire.observer.socket_unobserved': 1, 'empire.observer.awaiting_init': 1,
    'empire.observer.missing_init': 1, 'empire.observer.format_rejected': 1,
    'empire.observer.incomplete': 1, 'empire.observer.census_received': 1,
    'empire.observer.connection_lost': 1, 'empire.observer.installation_failed': 1,
  });
  assert.equal(native.effects.length, 0);
  assert.equal(failed.effects.length, 0);
});

test('diagnostic review: classifier never evaluates private fields, accessors or error contents', () => {
  const h = metricsHarness(); h.metrics.setEnabled(true);
  let accessed = 0;
  const state = { installed: true, observed: true, connected: false, connectionObserved: true,
    complete: false, reason: 'missing-init' };
  for (const key of ['scope', 'selfId', 'systems', 'payload', 'token', 'url', 'error', 'stack', 'generation']) {
    Object.defineProperty(state, key, { get() { accessed++; throw new Error(SECRET); } });
  }
  h.observe(state);
  const accessors = {};
  for (const key of ['installed', 'observed', 'connected', 'connectionObserved', 'complete', 'reason']) {
    Object.defineProperty(accessors, key, { get() { accessed++; throw new Error(SECRET); } });
  }
  h.observe(accessors);
  h.observe({ reason: SECRET, payload: SECRET });
  h.context.OldLightEmpireBridge = { status() { throw new Error(SECRET); } };
  assert.doesNotThrow(() => h.context.observeStartup());
  assert.equal(accessed, 0);
  assert.deepEqual(h.counts(), { 'empire.observer.missing_init': 1 });
  assert.equal(JSON.stringify([...h.storage]).includes(SECRET), false);
});


test('diagnostic integration: all fixed counters over 30 days fit the existing storage bound', () => {
  const core = require('../docs/metrics-core.js');
  const h = metricsHarness(new Map(), { version: '999999.999999.999999' });
  assert.equal(h.metrics.setEnabled(true), true);
  const key = 'old-light-auto-upgrade:metrics:v1';
  const state = JSON.parse(h.storage.get(key));
  state.days = Array.from({ length: core.RETENTION_DAYS }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, 15 + i)).toISOString().slice(0, 10),
    counts: Object.fromEntries(core.EVENTS.map(name => [name, core.MAX_COUNT])),
  }));
  const raw = JSON.stringify(state);
  assert.equal(core.EVENTS.length, 36, 'frozen category set must be reviewed before expansion');
  assert.equal(core.RETENTION_DAYS, 30);
  assert.equal(raw.length, 33676);
  assert.ok(raw.length < 65536);
  h.storage.set(key, raw);
  assert.equal(h.metrics.isEnabled(), true);
  assert.equal(h.metrics.record('ui.tab.empire'), true);
  assert.equal(h.metrics.getStatus().total, core.EVENTS.length * core.RETENTION_DAYS * core.MAX_COUNT);
  const report = clone(h.metrics.snapshot());
  assert.deepEqual(Object.keys(report).sort(), ['days', 'schema', 'version']);
  assert.equal(report.days.length, 30);
  assert.equal(JSON.stringify(report).includes(state.generation), false);
  h.advance(1);
  // Reading hides expired days; the next known event purges them from storage.
  assert.equal(h.metrics.snapshot().days.length, 29);
  assert.equal(JSON.parse(h.storage.get(key)).days.length, 30);
  assert.equal(h.metrics.record('empire.observer.census_received'), true);
  const kept = JSON.parse(h.storage.get(key)).days;
  assert.equal(kept.length, 30);
  assert.equal(kept[0].date, '2026-09-16');
  assert.equal(kept.at(-1).date, '2026-10-15');
});

test('diagnostic integration: oversized active storage fails closed without recording diagnostics', () => {
  const h = metricsHarness();
  assert.equal(h.metrics.setEnabled(true), true);
  h.storage.set('old-light-auto-upgrade:metrics:v1', ' '.repeat(65537));
  const writesBefore = h.writes.length;
  assert.doesNotThrow(() => h.metrics.observeEmpireStatus('missing_init'));
  assert.equal(h.metrics.isEnabled(), false);
  assert.equal(h.metrics.getStatus().storageError, true);
  assert.deepEqual(h.counts(), {});
  assert.equal(h.writes.length, writesBefore);
});
