'use strict';
// Independent contract and integration review. No game, browser, or Google access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const core = require('../docs/sync-core.js');
const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'old-light-auto-upgrade.user.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(ROOT, 'docs/sync-core.js'), 'utf8');
const empireSource = fs.readFileSync(path.join(ROOT, 'docs/empire-core.js'), 'utf8');
const oldFixture = fs.readFileSync(path.join(__dirname, 'drive-sync-core.test.cjs'), 'utf8');
const fixture = oldFixture.slice(oldFixture.indexOf('const BUILDINGS ='), oldFixture.indexOf('const maybe =')).replace(/\bSHIPS\b/g, 'SHIP_IDS');
const SCOPE = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACCOUNT = 'id:review-account';
const clone = value => JSON.parse(JSON.stringify(value));
const fleetKey = ship => 'empire.fleetTargets.' + ship;
const systemKey = (id, prop) => `empire.systems.${id}.${prop}`;
const empireOnly = flat => Object.fromEntries(Object.entries(flat).filter(([key]) => key.startsWith('empire.')));
const engine = (actor = 'review', state = null, now = () => 1000) => core.create({ scope: SCOPE, actor, state, now });
function imperial(overrides = {}) {
  return { profile: SCOPE, empire: { scope: SCOPE, config: {
    schemaVersion: 1, enabled: true, fleetTargets: { probe: 9, marauder: 0, sentinel: 7, vanguard: 0 },
    systems: { [A]: { name: 'Private local name', role: 'industry', enabled: true } },
    ...overrides,
  } } };
}
function namedFunction(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, 'Missing integration function: ' + name);
  const end = source.indexOf('\n  function ', start + 1);
  assert.ok(end > start);
  return source.slice(start, end);
}

// Contract tests use tiny valid backup envelopes; unrelated settings are deliberately omitted.
test('empire sync review: project exports only goals and per-system preferences', () => {
  const backup = imperial();
  Object.assign(backup.empire.config, { snapshots: [{ resources: { iridium: 99 } }], token: 'private-token' });
  const result = empireOnly(core.project(backup));
  assert.deepEqual(result, {
    [fleetKey('probe')]: 9, [fleetKey('marauder')]: 0, [fleetKey('sentinel')]: 7, [fleetKey('vanguard')]: 0,
    [systemKey(A, 'role')]: 'industry', [systemKey(A, 'enabled')]: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /Private local name|private-token|snapshots|resources/);
});

test('empire sync review: a missing or different imperial scope does not project imperial resets', () => {
  assert.deepEqual(empireOnly(core.project({ profile: SCOPE })), {});
  for (const backup of [{ ...imperial(), profile: 'other/player' },
    { empire: imperial().empire }, { ...imperial(), empire: { ...imperial().empire, scope: '' } }]) {
    assert.throws(() => core.project(backup), /scope|profile/i);
  }
});

test('empire sync review: transient absence survives capture, accept, reload, and return', () => {
  const e = engine();
  const values = empireOnly(core.project(imperial()));
  e.capture(values); e.promoteSeeds();
  const original = e.state();
  e.capture({}); e.accept({});
  assert.deepEqual(e.state(), original);
  const reloaded = engine('reload', e.state());
  reloaded.capture(values);
  assert.deepEqual(reloaded.document(), original.document);
});

test('empire sync review: deletions with an available namespace create per-field tombstones', () => {
  const e = engine(); e.capture(empireOnly(core.project(imperial()))); e.promoteSeeds();
  e.capture(empireOnly(core.project(imperial({ systems: {} }))));
  assert.equal(e.values()[systemKey(A, 'role')], null);
  assert.equal(e.values()[systemKey(A, 'enabled')], null);
  const result = core.overlay(imperial(), e.values());
  assert.equal(result.empire.config.systems[A].role, 'balanced');
  assert.equal(result.empire.config.systems[A].enabled, false);
  assert.equal(result.empire.config.systems[A].name, 'Private local name');
});

test('empire sync review: remote roles on an unconfigured browser stay globally and locally disabled', () => {
  const result = core.overlay({ profile: SCOPE }, { [systemKey(B, 'role')]: 'shipyard' });
  assert.equal(result.empire.scope, SCOPE);
  assert.equal(result.empire.config.enabled, false);
  assert.equal(result.empire.config.systems[B].enabled, false);
  assert.equal(result.empire.config.systems[B].role, 'shipyard');
  const explicit = core.overlay({ profile: SCOPE }, { [systemKey(B, 'enabled')]: true });
  assert.equal(explicit.empire.config.enabled, false);
  assert.equal(explicit.empire.config.systems[B].enabled, true);
});

test('empire sync review: overlay preserves local consent, names, runtime and untouched values', () => {
  const original = imperial(); original.empire.localRuntime = { pending: 'local' };
  const result = core.overlay(original, { [fleetKey('probe')]: null, [systemKey(A, 'role')]: 'defense' });
  assert.equal(result.empire.config.enabled, true);
  assert.equal(result.empire.config.fleetTargets.probe, 0);
  assert.equal(result.empire.config.fleetTargets.sentinel, 7);
  assert.equal(result.empire.config.systems[A].name, 'Private local name');
  assert.equal(result.empire.config.systems[A].enabled, true);
  assert.deepEqual(result.empire.localRuntime, original.empire.localRuntime);
  assert.equal(original.empire.config.fleetTargets.probe, 9);
});

test('empire sync review: forbidden remote imperial fields reject the complete document', () => {
  for (const key of ['empire.enabled', 'empire.config.enabled', systemKey(A, 'name'),
    'empire.resources.iridium', 'empire.runtime', 'empire.credentials', systemKey('__proto__', 'role')]) {
    const e = engine(); e.capture({ 'settings.enabled': false });
    const before = e.state();
    const doc = { format: 'old-light-settings-sync', schemaVersion: 1, scope: SCOPE,
      fields: { 'settings.enabled': { value: true, stamp: [100, 0, 'remote'] },
        [key]: { value: true, stamp: [100, 1, 'remote'] } } };
    assert.throws(() => e.merge(doc), undefined, key);
    assert.deepEqual(e.state(), before, 'No partial preference application: ' + key);
  }
});

test('empire sync review: concurrent changes to two fields of one system both survive', () => {
  const initial = engine('seed'); initial.capture(empireOnly(core.project(imperial()))); initial.promoteSeeds();
  const first = engine('first', initial.state()), second = engine('second', initial.state());
  first.capture({ ...first.values(), [systemKey(A, 'role')]: 'shipyard' });
  second.capture({ ...second.values(), [systemKey(A, 'enabled')]: false });
  first.merge(second.document()); second.merge(first.document());
  assert.deepEqual(first.document(), second.document());
  assert.equal(first.values()[systemKey(A, 'role')], 'shipyard');
  assert.equal(first.values()[systemKey(A, 'enabled')], false);
});

test('empire sync review: union beyond 1024 systems rejects atomically', () => {
  const id = n => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
  const first = engine('first'), second = engine('second');
  first.capture(Object.fromEntries(Array.from({ length: 1024 }, (_, n) => [systemKey(id(n), 'enabled'), false])));
  second.capture({ [systemKey(id(1024), 'role')]: 'balanced' });
  const before = first.state();
  assert.throws(() => first.merge(second.document()));
  assert.deepEqual(first.state(), before);
});

function helper(initial, saved = new Map()) {
  const integration = source.slice(source.indexOf('  function createPreferenceSync('), source.indexOf('  // END SHARED PREFERENCES INTEGRATION'));
  const context = vm.createContext({ crypto: crypto.webcrypto,
    __read: key => saved.has(key) ? JSON.stringify(saved.get(key)) : null,
    __write: (key, value) => saved.set(key, JSON.parse(value)),
  });
  vm.runInContext(coreSource + '\n' + empireSource + '\nconst core = OldLightSyncCore;\n' + fixture + '\n' + namedFunction('validateBackup') + '\n' + integration + `
    let current = backup(); let scope = SCOPE; let blocked = false; let applied = 0;
    const DEFAULT_ORDER = BUILDINGS, DEFAULT_SHIP_ORDER = SHIP_IDS, SHIPS = SHIP_IDS.map(id => [id, id]), MAX_SHIP_MINIMUM = 1000000;
    const PANEL_WIDTH = { min: 1, max: 9999 };
    const normalizeSettings = value => value;
    const validNumericDrafts = value => true, validAutomaticMinimumReceipts = value => true;
    const validPresetCatalog = value => true, normalizePanelPosition = value => value, validUISections = value => true;
    const notifier = { validateConfig: value => value }, driveBackup = notifier, levelTargets = notifier, fleetWait = notifier, attackRetry = notifier;
    function missionContext() { return { scope }; }
    function backupError(message) { return new Error(message); }
    const sync = createPreferenceSync({ getBackup: () => current, getScope: () => scope, getClientId: () => 'review-client',
      gmGetValue: (key, fallback) => { const value = __read(key); return value === null ? fallback : JSON.parse(value); },
      gmSetValue: (key, value) => __write(key, JSON.stringify(value)),
      applyPreferences: value => { if (blocked) throw Object.assign(new Error('Busy'), { code: 'busy' }); current = value; applied++; },
    });
    this.invoke = (method, text) => {
      const value = JSON.parse(text);
      if (method === 'initial') { current = value; sync.observe(); return true; }
      if (method === 'view') return { current, applied };
      if (method === 'merge') return sync.merge(value);
      if (method === 'get') return sync.get(value);
      if (method === 'observe') return sync.observe();
      if (method === 'scope') { scope = value; return true; }
      if (method === 'blocked') { blocked = value; return true; }
      if (method === 'edit') { current = core.overlay(current, value); sync.observe(); return true; }
      if (method === 'replace') { current = value; sync.observe(); return true; }
    }; this.fixture = () => backup();
  `, context);
  const run = (method, value = null) => clone(context.invoke(method, JSON.stringify(value)));
  run('initial', { ...clone(context.fixture()), ...initial });
  return { run, saved, snapshot: () => run('view').current };
}
const receive = (h, documents, extras = {}) => h.run('merge', { account: ACCOUNT, scope: SCOPE, documents, ...extras });

test('empire sync review: legacy backup migration retains profile for imperial projection', () => {
  const h = helper({ profile: SCOPE });
  const legacy = { ...h.snapshot(), ...imperial() };
  receive(h, [], { legacy: { backup: legacy, createdAt: new Date(1000).toISOString() } });
  assert.equal(h.snapshot().empire.config.fleetTargets.probe, 9);
  assert.equal(h.snapshot().empire.config.systems[A].role, 'industry');
  assert.equal(h.snapshot().empire.config.enabled, false);
});

test('empire sync review: busy application and offline reload preserve remote imperial intent', () => {
  const a = helper(imperial()), b = helper({ profile: SCOPE });
  const seed = receive(a, []).document; receive(b, [seed]);
  a.run('edit', { [fleetKey('probe')]: 42 });
  const remote = receive(a, [seed]).document;
  b.run('blocked', true);
  assert.throws(() => receive(b, [remote]), error => error.code === 'busy');
  assert.equal(b.snapshot().empire.config.fleetTargets.probe, 9);
  const reload = helper(b.snapshot(), b.saved);
  const result = receive(reload, [remote]);
  assert.equal(reload.snapshot().empire.config.fleetTargets.probe, 42);
  assert.deepEqual(result.document.fields[fleetKey('probe')], remote.fields[fleetKey('probe')]);
  assert.equal(reload.snapshot().empire.config.enabled, false);
});

test('empire sync review: legacy documents without empire do not reset local imperial preferences', () => {
  const oldClient = helper({ profile: SCOPE }), modern = helper(imperial());
  const legacyDocument = receive(oldClient, []).document;
  const result = receive(modern, [legacyDocument]);
  assert.equal(modern.snapshot().empire.config.fleetTargets.probe, 9);
  assert.equal(modern.snapshot().empire.config.enabled, true);
  assert.equal(result.document.fields[fleetKey('probe')].value, 9);
});

test('empire sync review: account scope mismatch is rejected before imperial application', () => {
  const a = helper(imperial()), b = helper({ profile: 'other/player' });
  const remote = receive(a, []).document;
  b.run('scope', 'other/player');
  assert.throws(() => receive(b, [remote]), error => error.code === 'invalid_sync');
  assert.equal(b.run('view').applied, 0);
  assert.equal(b.snapshot().empire, undefined);
});

function applyHarness(enabled = true) {
  const context = vm.createContext({});
  vm.runInContext(empireSource + `
    let settings = { enabled: true }, error = '', unconfirmed = 0, importingBackup = false, pending = null;
    const KEY = 'review-settings'; let raw = JSON.stringify(settings); let busy = false, failSave = false, failUI = false, failRollback = false, suspended = 0;
    let config = OldLightEmpireCore.normalizeConfig(${JSON.stringify(imperial({ enabled }).empire.config)});
    let writes = [], scheduleCount = 0, renderCount = 0;
    const missionAdapter = { isBusy: () => false }, host = null; let lastPreferenceEditAt = 0;
    const localStorage = { getItem: () => raw, setItem: (key, value) => { raw = value; }, removeItem: () => { raw = null; } };
    const notifier = { exportConfig: () => ({}), importConfig() {} };
    const levelTargets = { exportConfig: () => ({}), importConfig() {} };
    const attackRetry = { isBusy: () => false, backupCheckpoint: () => ({}), importPreferences() {}, restoreCheckpoint() {} };
    const fleetWait = { backupCheckpoint: () => ({}), restoreCheckpoint() {} };
    const empireController = { isBusy: () => busy, exportConfig: () => JSON.parse(JSON.stringify(config)),
      state: () => ({ scope: ${JSON.stringify(SCOPE)}, config }),
      setConfig: value => { if (failSave) throw new Error('Imperial write failed'); config = OldLightEmpireCore.normalizeConfig(value); writes.push(JSON.parse(JSON.stringify(config))); return config; },
      importConfig: value => { throw new Error('Sync must preserve local consent rather than use backup import'); },
      suspend: ms => { suspended = ms; },
    };
    const empirePanel = { render: () => renderCount++ };
    function validateBackup(value) { return value; }
    function missionContext() { return { scope: ${JSON.stringify(SCOPE)} }; }
    function cancelNumericDraftTimers() {} function restoreNumericInputs() {}
    function syncSettingsTabs() { if (failUI) { failUI = false; if (failRollback) failSave = true; throw new Error('UI failed after save'); } }
    function schedule() { scheduleCount++; }
  ` + namedFunction('applySyncedEmpirePolicy') + '\n' + namedFunction('applySyncedPreferences') + `
    this.run = (method, data) => {
      const value = JSON.parse(data);
      if (method === 'apply') return applySyncedPreferences(value) || null;
      if (method === 'view') return { config, settings, raw, suspended, importingBackup, writes, scheduleCount, renderCount };
      if (method === 'busy') { busy = value; return null; }
      if (method === 'failSave') { failSave = value; return null; }
      if (method === 'failUI') { failUI = value; return null; }
      if (method === 'failRestore') { failUI = true; failRollback = true; return null; }
      if (method === 'pending') { pending = value; return null; }
      if (method === 'importing') { importingBackup = value; return null; }
    };
  `, context);
  return (method, value = null) => clone(context.run(method, JSON.stringify(value)));
}
function appliedBackup() {
  return { settings: { enabled: true }, notifications: {}, levelTargets: {}, attackRetries: {}, ...imperial({
    enabled: true, fleetTargets: { probe: 33, marauder: 0, sentinel: 7, vanguard: 0 },
  }) };
}

test('empire sync review: main application waits for imperial navigation to settle', () => {
  const run = applyHarness(); run('busy', true);
  assert.throws(() => run('apply', appliedBackup()), error => error.code === 'busy');
  assert.equal(run('view').writes.length, 0);
});

test('empire sync review: main application saves goals while preserving local enabled state', () => {
  const run = applyHarness(); run('apply', appliedBackup());
  const state = run('view');
  assert.equal(state.config.fleetTargets.probe, 33);
  assert.equal(state.config.enabled, true);
  assert.equal(state.importingBackup, false);
});

test('empire sync review: failure after imperial save rolls back imperial and ordinary preferences', () => {
  const run = applyHarness(), before = run('view'); run('failUI', true);
  assert.throws(() => run('apply', appliedBackup()), error => error.code === 'storage_error');
  const after = run('view');
  assert.deepEqual(after.config, before.config);
  assert.deepEqual(after.settings, before.settings);
  assert.equal(after.importingBackup, false);
});

test('empire sync review: backup export excludes a stale controller from another account', () => {
  const context = vm.createContext({});
  vm.runInContext(`
    const SCRIPT_VERSION = 'test', settings = {}; let controllerScope = 'other/player';
    function missionContext() { return { scope: ${JSON.stringify(SCOPE)} }; }
    function normalizeSettings(value) { return value; }
    const notifier = { exportConfig: () => ({}) }, levelTargets = notifier, fleetWait = notifier, attackRetry = notifier, driveBackup = null;
    const empireController = { state: () => ({ scope: controllerScope }), exportConfig: () => ({ enabled: true }) };
  ` + namedFunction('exportEmpirePolicyForBackup') + '\n' + namedFunction('createBackup') + `
    this.get = () => createBackup(); this.match = () => { controllerScope = ${JSON.stringify(SCOPE)}; };
  `, context);
  assert.equal(context.get().empire, undefined);
  context.match(); assert.equal(context.get().empire.scope, SCOPE);
});


test('empire sync review: incoming enabled and names cannot activate or rename local empire', () => {
  const run = applyHarness(false), incoming = appliedBackup();
  incoming.empire.config.enabled = true;
  incoming.empire.config.systems[A].name = 'Remote name';
  run('apply', incoming);
  assert.equal(run('view').config.enabled, false);
  assert.equal(run('view').config.systems[A].name, 'Private local name');
  const before = run('view').writes.length;
  run('apply', incoming);
  assert.equal(run('view').writes.length, before, 'An identical sync must not invalidate the current plan again');
});

test('empire sync review: cached companion transport converges imperial and ordinary independent edits', async () => {
  const integrationTests = fs.readFileSync(path.join(__dirname, 'drive-sync-integration.test.cjs'), 'utf8');
  const transport = integrationTests.slice(integrationTests.indexOf('function fakeNode()'),
    integrationTests.indexOf("test('two complete companion transports"));
  const context = vm.createContext({ assert, vm, clone, console, crypto, coreSource,
    companionSource: fs.readFileSync(path.join(ROOT, 'docs/drive.js'), 'utf8'),
    TextEncoder, TextDecoder, URL, Blob, Response, AbortController, Intl, Buffer,
    setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(transport + '\nthis.createTransport = companion; this.createCloud = drive;', context);
  const cloud = context.createCloud(), a = helper(imperial()), b = helper({ profile: SCOPE });
  const ca = context.createTransport(a, cloud.fetch), cb = context.createTransport(b, cloud.fetch);
  await ca.sync(); await cb.sync();
  assert.equal(b.snapshot().empire.config.fleetTargets.probe, 9);
  assert.equal(b.snapshot().empire.config.enabled, false);
  a.run('edit', { [systemKey(A, 'role')]: 'defense' });
  b.run('edit', { [fleetKey('sentinel')]: 65, 'settings.depotFillPercent': 62 });
  await cb.sync(); await ca.sync(); await cb.sync();
  for (const h of [a, b]) {
    assert.equal(h.snapshot().empire.config.systems[A].role, 'defense');
    assert.equal(h.snapshot().empire.config.fleetTargets.sentinel, 65);
    assert.equal(h.snapshot().settings.depotFillPercent, 62);
  }
  assert.equal(a.snapshot().empire.config.enabled, true);
  assert.equal(b.snapshot().empire.config.enabled, false);
  assert.deepEqual(empireOnly(a.run('get', 'id:test-account').document.fields),
    empireOnly(b.run('get', 'id:test-account').document.fields));
  const writes = cloud.counts().writes;
  await ca.sync(); await cb.sync();
  assert.equal(cloud.counts().writes, writes, 'A stable cache does not republish the same policy');
});


test('empire sync review: an unrecoverable imperial write suspends automation in the active session', () => {
  const run = applyHarness(); run('failRestore', true);
  assert.throws(() => run('apply', appliedBackup()), error => error.code === 'storage_error');
  const state = run('view');
  assert.equal(state.settings.enabled, false);
  assert.ok(state.suspended > 0);
  assert.equal(state.importingBackup, false);
});

test('empire sync review: pending orders and backup import both defer applying cloud policy', () => {
  for (const [method, value] of [['pending', { system: A }], ['importing', true]]) {
    const run = applyHarness(); run(method, value);
    assert.throws(() => run('apply', appliedBackup()), error => error.code === 'busy');
    assert.equal(run('view').writes.length, 0);
  }
});
