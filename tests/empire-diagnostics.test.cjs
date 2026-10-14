'use strict';
// Pure diagnostic fixtures: no userscript installation, game, socket or API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const adapter = require('../docs/empire-adapter.js');
const root = path.join(__dirname, '..');
const NOW = 1000000;
const SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SYSTEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECRET = 'NEVER_RENDER_token_https://private.invalid/?credential=hidden';

function bootstrapSource() {
  // Run the builder against an in-memory output so this test never rewrites
  // the checked-in userscript or depends on a fresh embedding.
  const sandbox = { __dirname: root, console: { log() {} }, require(name) {
    if (name === 'node:path') return path;
    assert.equal(name, 'node:fs');
    return { readFileSync: fs.readFileSync.bind(fs), writeFileSync() {} };
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'build-empire.cjs'), 'utf8') + '\nthis.result = bootstrap;', sandbox);
  return sandbox.result;
}

function boot(readyState, create = () => Object.freeze({}), pathname = '/game/galaxy/alpha') {
  let calls = 0;
  const win = {}; win.top = win; win.self = win;
  const sandbox = { window: win, location: { pathname }, document: { readyState },
    OldLightEmpireBridgeFactory: { create(...args) { calls++; return create(...args); } } };
  vm.runInNewContext(bootstrapSource(), sandbox);
  return { sandbox, calls, diagnostic: sandbox.OldLightEmpireBootstrapStatus?.() };
}

function fixture(value, source = null) {
  let diagnostic = value, world = source;
  const app = adapter.create({ getWorld: () => world,
    getObservationStatus: () => typeof diagnostic === 'function' ? diagnostic() : diagnostic,
    getContext: () => ({ scope: 'alpha/' + SELF, systemId: SYSTEM, selectionCount: 1, settled: true }),
    getHudSnapshot: () => null, canNavigate: () => false, now: () => NOW });
  return { app, set diagnostic(value) { diagnostic = value; }, set world(value) { world = value; } };
}

const status = (reason, extra = {}) => ({ installed: true, observed: true, connected: false, reason, ...extra });
const bootstrap = (phase, readyState = 'loading', error = '') => ({ phase, readyState, error });
function validWorld() {
  return { version: 1, galaxy: 'alpha', selfId: SELF, scope: 'alpha/' + SELF, connected: true, complete: true,
    generation: 1, epoch: 1, revision: 1, observedAt: NOW,
    systems: [{ id: SYSTEM, name: 'Sede', q: 0, r: 0, fleet: [], buildings: [{ type: 'shipyard', level: 0 }],
      shipyard: null, economy: { resources: { palladium: 0, iridium: 0, settledAt: new Date(NOW).toISOString() },
        paCap: 10, irCap: 10, paRatePerMin: 0, irRatePerMin: 0, energyCap: 0, energyUsed: 0, queue: [] } }],
    transits: [] };
}

test('builder records an immutable content-realm diagnostic without claiming a connection', () => {
  const h = boot('loading');
  assert.equal(h.calls, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.diagnostic)), { readyState: 'loading', phase: 'attempted', error: '' });
  assert.equal(Object.isFrozen(h.diagnostic), true);
  assert.equal(Object.getOwnPropertyDescriptor(h.sandbox, 'OldLightEmpireBootstrapStatus').enumerable, false);
  assert.equal(Object.getOwnPropertyDescriptor(h.sandbox, 'OldLightEmpireBootstrapStatus').writable, false);
  assert.equal(h.diagnostic.connected, undefined);
  assert.equal(h.diagnostic.observed, undefined);
  assert.equal(h.diagnostic.installed, undefined);
});

test('interactive and complete startup attempt passive observation without claiming a socket', () => {
  for (const readyState of ['interactive', 'complete']) {
    const h = boot(readyState);
    assert.equal(h.calls, 1); assert.ok(h.sandbox.OldLightEmpireBridge);
    assert.deepEqual(JSON.parse(JSON.stringify(h.diagnostic)), { readyState, phase: 'attempted', error: '' });
    assert.equal(h.diagnostic.connected, undefined);
  }
});

test('unknown document state remains unavailable and cannot enable a late hook', () => {
  const h = boot(SECRET);
  assert.equal(h.calls, 0); assert.equal(h.sandbox.OldLightEmpireBridge, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(h.diagnostic)), { readyState: 'unknown', phase: 'unavailable', error: 'ready-state-unavailable' });
});

test('bootstrap failures store only a fixed category and never inspect exception content', () => {
  let accessed = 0;
  const failure = Object.create(null);
  for (const field of ['name', 'message', 'stack', 'cause']) Object.defineProperty(failure, field, { get() { accessed++; throw new Error(SECRET); } });
  const h = boot('loading', () => { throw failure; });
  assert.equal(h.calls, 1); assert.equal(h.sandbox.OldLightEmpireBridge, undefined); assert.equal(accessed, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(h.diagnostic)), { readyState: 'loading', phase: 'unavailable', error: 'bridge-create-failed' });
  assert.equal(JSON.stringify(h.diagnostic).includes(SECRET), false);
});

test('bootstrap keeps the existing game-route guard', () => {
  const h = boot('loading', () => ({}), '/account');
  assert.equal(h.calls, 0); assert.equal(h.diagnostic, undefined); assert.equal(h.sandbox.OldLightEmpireBridge, undefined);
});

test('adapter distinguishes unavailable injection from an unconfirmed post-parse installation', () => {
  for (const value of [
    { bootstrap: bootstrap('unavailable', 'loading', 'bridge-create-failed') },
    status('observer-injection-unavailable', { installed: false, observed: false }),
  ]) assert.match(fixture(value).app.getStatus(), /No se pudo instalar/);
  assert.match(fixture({ installed: false, bootstrap: bootstrap('attempted', 'complete') }).app.getStatus(), /no se ha confirmado su instalación/);
  assert.match(fixture({ installed: false, bootstrap: bootstrap('attempted') }).app.getStatus(), /no se ha confirmado su instalación/);
});

test('adapter distinguishes waiting for a native connection from waiting for initial state', () => {
  assert.match(fixture(status('awaiting-native-init', { observed: false })).app.getStatus(), /Canal del observador instalado; esperando los primeros datos/);
  assert.match(fixture(status('awaiting-init'), { generation: 0 }).app.getStatus(), /esperando la conexión nativa/);
  assert.match(fixture(status('awaiting-init'), { generation: 1 }).app.getStatus(), /Conexión nativa detectada; esperando el estado inicial/);
  assert.match(fixture(status('awaiting-init')).app.getStatus(), /esperando el estado inicial/);
});

test('adapter maps each failure category to a fixed, concrete Spanish explanation', () => {
  for (const [reason, expected] of [
    ['connection-lost', /Se perdió la conexión/], ['session-lost', /sesión nativa/], ['stopped', /detenido/],
    ['malformed', /formato no válido/], ['missing-init', /sin el estado inicial/],
    ['invalid-observation', /validación de seguridad/], ['out-of-order-observation', /anterior al último/],
    ['incomplete-data', /está incompleto/], ['eliminated', /cuenta está eliminada/],
  ]) assert.match(fixture(status(reason)).app.getStatus(), expected, reason);
});

test('unknown, missing, mistyped and throwing diagnostics cannot leak raw causes', () => {
  for (const value of [undefined, null, {}, SECRET, { reason: SECRET }, { reason: {} },
    { installed: 'true', reason: '' }, { observed: 1 }, { connected: [] },
    { bootstrap: bootstrap(SECRET) }, { bootstrap: bootstrap('attempted', SECRET) },
    { bootstrap: bootstrap('attempted', 'loading', SECRET) },
    () => { throw new Error(SECRET); },
  ]) {
    const h = fixture(value);
    assert.match(h.app.getStatus(), /Estado del observador nativo desconocido/);
    assert.equal(h.app.getStatus().includes(SECRET), false);
    assert.equal(h.app.isAvailable(), false);
  }
});

test('diagnostic reading ignores accessors and unrelated private fields', () => {
  let accessed = 0;
  const raw = {};
  for (const field of ['installed', 'observed', 'connected', 'reason', 'bootstrap', 'token', 'cause']) {
    Object.defineProperty(raw, field, { get() { accessed++; throw new Error(SECRET); } });
  }
  assert.match(fixture(raw).app.getStatus(), /desconocido/);
  const nested = { phase: 'attempted', readyState: 'loading', error: '' };
  Object.defineProperty(nested, 'stack', { get() { accessed++; throw new Error(SECRET); } });
  assert.match(fixture({ installed: false, bootstrap: nested }).app.getStatus(), /no se ha confirmado/);
  assert.equal(accessed, 0);
});

test('diagnostic flags never manufacture roster, snapshots, active ownership or action readiness', async () => {
  for (const value of [status('', { connected: true }), status('awaiting-init'),
    { installed: true, observed: true, connected: true, bootstrap: bootstrap('attempted') }]) {
    const h = fixture(value);
    h.app.getStatus();
    assert.equal(h.app.readRoster(), null); assert.equal(h.app.readSnapshots(), null);
    assert.equal(h.app.readTransitCensus(), null); assert.equal(h.app.isAvailable(), false);
    assert.equal(h.app.readActive().context.owned, false); assert.equal(h.app.readActive().context.settled, false);
    assert.equal(await h.app.selectSystem(SYSTEM, { scope: 'alpha/' + SELF }), false);
  }
});

test('adapter reports its own rejected, regressing and contradictory snapshots accurately', () => {
  const diagnostic = status('', { connected: true }), h = fixture(diagnostic, {});
  assert.match(h.app.getStatus(), /validación de seguridad/);
  const current = validWorld(); h.world = current;
  assert.equal(h.app.isAvailable(), true);
  h.world = { ...current, revision: 0 };
  assert.match(h.app.getStatus(), /anterior al último/); assert.equal(h.app.isAvailable(), false);
  h.world = { ...current, systems: [{ ...current.systems[0], name: 'Cambio' }] };
  assert.match(h.app.getStatus(), /datos contradictorios/); assert.equal(h.app.isAvailable(), false);
  h.world = { ...current, revision: 2 };
  assert.equal(h.app.isAvailable(), true); assert.doesNotMatch(h.app.getStatus(), /contradictorios|anterior al último/);
});

test('diagnostics cannot override a verified census or survive disposal as a ready state', () => {
  const h = fixture({ bootstrap: bootstrap('attempted', 'complete') }, validWorld());
  assert.equal(h.app.isAvailable(), true); assert.doesNotMatch(h.app.getStatus(), /arrancó después/);
  h.app.dispose(); assert.equal(h.app.isAvailable(), false); assert.match(h.app.getStatus(), /detenido/);
});


test('unobserved socket has a short status and an explicit read-only recovery diagnostic', () => {
  const h = fixture(status('awaiting-init', { connectionObserved: false, complete: false,
    bootstrap: bootstrap('attempted', 'complete') }), { generation: 0 });
  assert.ok(h.app.getStatus().length < 90);
  assert.deepEqual(h.app.getRecovery(), { reason: 'connection-unobserved', readyState: 'complete' });
  assert.equal(h.app.isAvailable(), false); assert.equal(h.app.readRoster(), null);
});

test('recovery distinguishes missing init and observed connection without granting readiness', () => {
  for (const [reason, connectionObserved, expected] of [
    ['awaiting-init', true, 'initial-state-wait'], ['missing-init', true, 'missing-init'],
    ['connection-lost', true, 'connection-lost'],
  ]) {
    const h = fixture(status(reason, { connectionObserved, complete: false }));
    assert.deepEqual(h.app.getRecovery(), { reason: expected, readyState: 'unknown' });
    assert.equal(h.app.isAvailable(), false); assert.equal(h.app.readRoster(), null);
  }
  const h = fixture(status('awaiting-init', { connectionObserved: false }));
  h.diagnostic = status('', { connected: true, connectionObserved: true, complete: true });
  h.world = validWorld(); assert.equal(h.app.getRecovery(), null); assert.equal(h.app.isAvailable(), true);
  h.app.dispose(); assert.equal(h.app.getRecovery(), null);
});

test('recovery ignores absent malformed and accessor-based diagnostic flags', () => {
  for (const value of [{}, status('awaiting-init'), status('awaiting-init', { connectionObserved: 'false' }),
    status('awaiting-init', { connectionObserved: false, complete: 'false' }),
    status('malformed', { connectionObserved: true }),
    status('awaiting-init', { installed: false, connectionObserved: false })]) {
    assert.equal(fixture(value).app.getRecovery(), null);
  }
  let accesses = 0; const value = status('awaiting-init');
  Object.defineProperty(value, 'connectionObserved', { get() { accesses++; return false; } });
  assert.equal(fixture(value).app.getRecovery(), null); assert.equal(accesses, 0);
});
