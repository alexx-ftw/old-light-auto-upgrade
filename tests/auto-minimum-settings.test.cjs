'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourceFile = process.env.QA_AUTO_MINIMUM_SOURCE
  ? path.resolve(process.env.QA_AUTO_MINIMUM_SOURCE)
  : path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const source = fs.readFileSync(sourceFile, 'utf8');
const constants = source.slice(source.indexOf('  const KEY ='), source.indexOf('  const upgradeEta ='));
const helpers = source.slice(source.indexOf('  function normalizeOrder('), source.indexOf('  function text(node)'));
const backupValidation = source.slice(source.indexOf('  function backupError('), source.indexOf('  function applyBackup('));
assert.ok(constants && helpers && backupValidation, 'Published root settings helpers are available');
const SCOPE = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_SCOPE = 'andromeda/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHIPS = ['probe', 'marauder', 'sentinel', 'vanguard'];
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const quantities = (marauder = 9, extra = {}) => ({ probe: 0, marauder, sentinel: 0, vanguard: 0, ...extra });
const request = (extra = {}) => ({ scope: SCOPE, reportId: uuid(1), takenAt: 2000, quantities: quantities(), ...extra });

function harness(initial = {}) {
  let raw = null, failRead = false, failWrite = false, currentScope = SCOPE, clock = 10000;
  let timerId = 0, scheduled = 0;
  const writes = [], notifications = [], timers = new Map(), backupSnapshots = [];
  const inputs = new Map();
  const root = { activeElement: null };
  const context = vm.createContext({
    Date: { now: () => clock },
    localStorage: {
      getItem: () => { if (failRead) throw new Error('Fixture read unavailable'); return raw; },
      setItem: (_key, value) => {
        if (failWrite) throw new Error('Fixture write unavailable');
        raw = value; writes.push(JSON.parse(value));
      },
    },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    missionContext: () => ({ scope: currentScope }),
    setText: (node, value) => { node.textContent = value; },
    emitEvent: (...args) => notifications.push(clone(args)),
    schedule: () => { scheduled++; },
    fixtureChanged: () => { backupSnapshots.push(JSON.parse(raw)); },
  });
  vm.runInContext(constants + `
    let settings, importingBackup = false;
    let driveBackup = { notifyChanged: fixtureChanged, validateConfig: value => value };
    const numericInputs = new Map(), numericDraftTimers = new Map(), numericErrors = new Map();
    const numericSaved = new Set(), numericUnsavedEditors = new Set();
    let numericRevision = 0;
    const notifier = { validateConfig: value => value };
    const levelTargets = { validateConfig: value => value };
    const fleetWait = { validateConfig: value => value };
    const attackRetry = { validateConfig: value => value };
    ${helpers}
    ${backupValidation}
    this.api = {
      raise: typeof raiseShipMinimums === 'function' ? raiseShipMinimums : null,
      initialize: value => { settings = normalizeSettings(value); },
      snapshot: () => settings,
      normalize: normalizeSettings,
      backup: value => validateBackup(value),
      importing: value => { importingBackup = value; },
      register: (id, input, status) => installNumericInput(id, input, status),
      unsaved: id => numericUnsavedEditors.add(id),
      error: id => numericErrors.get(id),
    };
  `, context, { filename: path.basename(sourceFile) });
  const api = context.api;
  api.initialize(clone(initial));
  raw = JSON.stringify(api.snapshot());
  for (const id of [...SHIPS, 'depot']) {
    const handlers = new Map();
    const input = {
      value: '', attributes: {},
      getRootNode: () => root,
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { handlers.set(name, callback); },
    };
    const status = { textContent: '' };
    inputs.set(id, { input, status, handlers });
    api.register(id, input, status);
  }
  return {
    raise(value = request()) {
      assert.equal(typeof api.raise, 'function', 'Automatic minimum update API exists');
      return clone(api.raise(clone(value)));
    },
    get stored() { return JSON.parse(raw); },
    set stored(value) { raw = JSON.stringify(value); },
    get raw() { return raw; },
    set raw(value) { raw = value; },
    get memory() { return clone(api.snapshot()); },
    get scheduled() { return scheduled; },
    set failRead(value) { failRead = value; },
    set failWrite(value) { failWrite = value; },
    set scope(value) { currentScope = value; },
    set importing(value) { api.importing(value); },
    focus(id) { root.activeElement = id === null ? null : inputs.get(id).input; },
    edit(id, value) { inputs.get(id).input.value = value; inputs.get(id).handlers.get('input')(); },
    blur(id) { root.activeElement = null; inputs.get(id).handlers.get('blur')(); },
    advance(ms) {
      clock += ms;
      for (const [id, task] of [...timers]) if (task.at <= clock) { timers.delete(id); task.callback(); }
    },
    unsaved(id) { api.unsaved(id); },
    input(id) { return inputs.get(id).input.value; },
    get timerCount() { return timers.size; },
    normalize: value => clone(api.normalize(clone(value))),
    validateSettings(value) {
      return clone(api.backup({ format: 'old-light-auto-upgrade-backup', schemaVersion: 1,
        settings: clone(value), notifications: {} }));
    },
    writes, notifications, backupSnapshots,
  };
}

test('Automatic minimum 8 to 9 is saved together with its report receipt', () => {
  const h = harness({ shipMinimums: quantities(8) });
  const result = h.raise();
  assert.deepEqual(result, { status: 'applied', changed: { marauder: { before: 8, after: 9 } } });
  assert.equal(h.stored.shipMinimums.marauder, 9);
  assert.deepEqual(h.stored.automaticMinimumReceipts, [{ scope: SCOPE, reportId: uuid(1), takenAt: 2000 }]);
  assert.equal(h.input('marauder'), '9');
  assert.equal(h.writes.length, 1);
  assert.equal(h.backupSnapshots.length, 1);
  assert.equal(h.backupSnapshots[0].shipMinimums.marauder, 9);
  assert.equal(h.scheduled, 1);
  assert.deepEqual(h.notifications, []);
});

test('Mixed fleet raises only smaller minimums and does not add another Marauder', () => {
  const h = harness({ shipMinimums: quantities(12, { probe: 5, sentinel: 1 }) });
  const result = h.raise(request({ quantities: quantities(9, { probe: 2, sentinel: 3, vanguard: 1 }) }));
  assert.deepEqual(result.changed, { sentinel: { before: 1, after: 3 }, vanguard: { before: 0, after: 1 } });
  assert.deepEqual(h.stored.shipMinimums, quantities(12, { probe: 5, sentinel: 3, vanguard: 1 }));
});

test('A duplicate report cannot undo a later manual reduction, including after reload', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.raise();
  const reduced = h.stored;
  reduced.shipMinimums.marauder = 4;
  h.stored = reduced;
  assert.deepEqual(h.raise(), { status: 'noop', changed: {} });
  assert.equal(h.stored.shipMinimums.marauder, 4);
  const reloaded = harness(h.stored);
  assert.deepEqual(reloaded.raise(), { status: 'noop', changed: {} });
  assert.equal(reloaded.stored.shipMinimums.marauder, 4);
  assert.equal(reloaded.writes.length, 0);
});

test('Already sufficient minimums still record the report before any later manual reduction', () => {
  const h = harness({ shipMinimums: quantities(12) });
  assert.deepEqual(h.raise(), { status: 'noop', changed: {} });
  assert.equal(h.writes.length, 1);
  assert.equal(h.stored.automaticMinimumReceipts.length, 1);
  const reduced = h.stored;
  reduced.shipMinimums.marauder = 4;
  h.stored = reduced;
  h.raise();
  assert.equal(h.stored.shipMinimums.marauder, 4);
});

test('An older defeat from another route cannot raise minimums above the latest defeat in the same account', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.raise(request({ reportId: uuid(2), takenAt: 3000 }));
  const before = h.stored;
  assert.deepEqual(h.raise(request({ reportId: uuid(1), takenAt: 2000, quantities: quantities(20) })),
    { status: 'noop', changed: {} });
  assert.deepEqual(h.stored, before);
  assert.equal(h.writes.length, 1);
});

test('The latest stored settings win when the in-memory settings are stale', () => {
  const h = harness({ shipMinimums: quantities(8) });
  const latest = h.stored;
  latest.shipMinimums.marauder = 10;
  latest.shipMinimums.vanguard = 7;
  latest.shipOrder = ['vanguard', 'sentinel', 'marauder', 'probe'];
  latest.enabled = false;
  latest.countAway = true;
  latest.activeTab = 'data';
  latest.panelPosition = { x: 321, y: 456 };
  latest.numericDrafts.depot = 'invalid';
  h.stored = latest;
  assert.deepEqual(h.raise(request({ quantities: quantities(11) })).changed, { marauder: { before: 10, after: 11 } });
  const expected = clone(latest);
  expected.shipMinimums.marauder = 11;
  expected.automaticMinimumReceipts = [{ scope: SCOPE, reportId: uuid(1), takenAt: 2000 }];
  assert.deepEqual(h.stored, expected);
  assert.deepEqual(h.memory, expected);
});

test('Focused minimum waits until blur so the old visible value cannot undo the automatic increase', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.focus('marauder');
  assert.deepEqual(h.raise(), { status: 'deferred', changed: {}, reason: 'editing' });
  assert.equal(h.input('marauder'), '8');
  assert.equal(h.writes.length, 0);
  h.blur('marauder');
  assert.equal(h.raise().status, 'applied');
  h.blur('marauder');
  assert.equal(h.stored.shipMinimums.marauder, 9);
});

test('A pending valid numeric draft is applied before the automatic proposal is reconsidered', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.edit('marauder', '7');
  const before = h.stored;
  assert.equal(h.raise().status, 'deferred');
  assert.deepEqual(h.stored, before);
  assert.equal(h.timerCount, 1);
  h.advance(400);
  assert.equal(h.stored.shipMinimums.marauder, 7);
  assert.equal(h.raise().status, 'applied');
  assert.equal(h.stored.shipMinimums.marauder, 9);
  assert.equal(h.stored.numericDrafts.ships.marauder, null);
});

test('A higher numeric draft remains the user minimum when the pending proposal resumes', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.edit('marauder', '15');
  assert.equal(h.raise().status, 'deferred');
  h.advance(400);
  assert.deepEqual(h.raise(), { status: 'noop', changed: {} });
  assert.equal(h.stored.shipMinimums.marauder, 15);
});

test('Invalid saved drafts survive deferral without applying a replacement value', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.edit('marauder', 'broken');
  const before = h.stored;
  assert.equal(h.raise().reason, 'editing');
  h.advance(1000);
  assert.deepEqual(h.stored, before);
  assert.equal(h.input('marauder'), 'broken');
  assert.equal(h.stored.shipMinimums.marauder, 8);
});

test('An unsaved editor prevents an automatic write even when it has no saved draft', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.edit('marauder', '1'.repeat(33));
  assert.equal(h.stored.numericDrafts.ships.marauder, null);
  assert.equal(h.raise().reason, 'editing');
  assert.equal(h.input('marauder'), '1'.repeat(33));
  assert.equal(h.writes.length, 0);
});

test('An edit to an unaffected ship does not block or get erased by the update', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.focus('vanguard');
  h.edit('vanguard', 'broken');
  assert.equal(h.raise().status, 'applied');
  assert.equal(h.stored.numericDrafts.ships.vanguard, 'broken');
  assert.equal(h.input('vanguard'), 'broken');
  assert.equal(h.stored.shipMinimums.marauder, 9);
});

test('A newer draft saved by another tab is respected before its storage event is received', () => {
  const h = harness({ shipMinimums: quantities(8) });
  const latest = h.stored;
  latest.numericDrafts.ships.marauder = '15';
  h.stored = latest;
  assert.equal(h.raise().reason, 'editing');
  assert.deepEqual(h.stored, latest);
});

test('Another account defers the change without consuming its receipt', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.scope = OTHER_SCOPE;
  assert.deepEqual(h.raise(), { status: 'deferred', changed: {}, reason: 'account' });
  assert.equal(h.writes.length, 0);
  h.scope = SCOPE;
  assert.equal(h.raise().status, 'applied');
});

test('An import in progress defers the change without consuming its receipt', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.importing = true;
  assert.deepEqual(h.raise(), { status: 'deferred', changed: {}, reason: 'importing' });
  assert.equal(h.writes.length, 0);
  h.importing = false;
  assert.equal(h.raise().status, 'applied');
});

test('A failed storage read does not replace existing settings with defaults', () => {
  const h = harness({ shipMinimums: quantities(8), panelPosition: { x: 17, y: 18 } });
  const before = h.memory;
  h.failRead = true;
  assert.throws(() => h.raise(), /read|leer|guardado|almacenamiento/i);
  assert.deepEqual(h.memory, before);
  assert.equal(h.writes.length, 0);
  assert.equal(h.backupSnapshots.length, 0);
});

test('Malformed saved JSON stops the update without overwriting the raw value', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.raw = '{broken';
  assert.throws(() => h.raise(), error => error.name === 'SyntaxError');
  assert.equal(h.raw, '{broken');
  assert.equal(h.memory.shipMinimums.marauder, 8);
  assert.equal(h.writes.length, 0);
});

test('A failed atomic write rolls back memory and leaves the report retryable', () => {
  const h = harness({ shipMinimums: quantities(8) });
  const before = h.stored;
  h.failWrite = true;
  assert.throws(() => h.raise(), /write|guardar|almacenamiento/i);
  assert.deepEqual(h.memory, before);
  assert.deepEqual(h.stored, before);
  assert.equal(h.input('marauder'), '8');
  assert.equal(h.backupSnapshots.length, 0);
  assert.equal(h.scheduled, 0);
  h.failWrite = false;
  assert.equal(h.raise().status, 'applied');
});

test('Report receipts are isolated by account', () => {
  const h = harness({ shipMinimums: quantities(8) });
  h.raise();
  const next = h.stored;
  next.shipMinimums.marauder = 8;
  h.stored = next;
  h.scope = OTHER_SCOPE;
  assert.equal(h.raise(request({ scope: OTHER_SCOPE })).status, 'applied');
  assert.equal(h.stored.automaticMinimumReceipts.length, 2);
});

test('Report UUID casing does not create a second receipt', () => {
  const h = harness({ shipMinimums: quantities(8) });
  const id = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
  h.raise(request({ reportId: id.toUpperCase() }));
  assert.equal(h.raise(request({ reportId: id })).status, 'noop');
  assert.equal(h.stored.automaticMinimumReceipts.length, 1);
  assert.equal(h.stored.automaticMinimumReceipts[0].reportId, id);
});

test('Receipt history stays bounded while retaining the newest applied report', () => {
  const h = harness({ shipMinimums: quantities(1) });
  for (let n = 1; n <= 130; n++) h.raise(request({ reportId: uuid(n), takenAt: 2000 + n, quantities: quantities(n) }));
  const receipts = h.stored.automaticMinimumReceipts;
  assert.equal(receipts.length, 128);
  assert.equal(receipts[0].reportId, uuid(3));
  assert.equal(receipts.at(-1).reportId, uuid(130));
  assert.equal(h.stored.shipMinimums.marauder, 130);
});

test('Legacy settings migrate to an empty receipt list', () => {
  const h = harness();
  assert.deepEqual(h.normalize({ shipMinimums: quantities(8) }).automaticMinimumReceipts, []);
  const legacy = h.stored;
  delete legacy.automaticMinimumReceipts;
  assert.deepEqual(h.validateSettings(legacy).settings.automaticMinimumReceipts, []);
});

test('A valid receipt list survives normalization and backup validation', () => {
  const h = harness();
  const value = h.stored;
  value.automaticMinimumReceipts = [{ scope: SCOPE, reportId: uuid(1), takenAt: 2000 }];
  assert.deepEqual(h.normalize(value).automaticMinimumReceipts, value.automaticMinimumReceipts);
  assert.deepEqual(h.validateSettings(value).settings.automaticMinimumReceipts, value.automaticMinimumReceipts);
});

test('Malformed receipt metadata is rejected when importing a backup', async t => {
  const receipt = { scope: SCOPE, reportId: uuid(1), takenAt: 2000 };
  for (const [name, value] of [
    ['non-array', {}], ['null', null], ['bad scope', [{ ...receipt, scope: '' }]],
    ['bad UUID', [{ ...receipt, reportId: 'bad' }]], ['negative time', [{ ...receipt, takenAt: -1 }]],
    ['fractional time', [{ ...receipt, takenAt: 1.5 }]], ['extra field', [{ ...receipt, dangerous: true }]],
    ['duplicate', [receipt, { ...receipt }]],
    ['more than 128', Array.from({ length: 129 }, (_, n) => ({ ...receipt, reportId: uuid(n + 1) }))],
  ]) await t.test(name, () => {
    const h = harness();
    assert.throws(() => h.validateSettings({ ...h.stored, automaticMinimumReceipts: value }), /inválid/i);
  });
});

test('Malformed local receipt metadata stops updates instead of forgetting deduplication', () => {
  const h = harness({ shipMinimums: quantities(8) });
  const damaged = { ...h.stored, automaticMinimumReceipts: [{ scope: SCOPE, reportId: 'broken', takenAt: 2000 }] };
  h.stored = damaged;
  assert.throws(() => h.raise(), error => error.name === 'TypeError');
  assert.deepEqual(h.stored, damaged);
  assert.equal(h.writes.length, 0);
});

test('The updater rejects invalid requests before any settings write', async t => {
  for (const [name, value] of [
    ['missing request', null], ['bad scope', request({ scope: '' })], ['bad UUID', request({ reportId: 'bad' })],
    ['negative time', request({ takenAt: -1 })], ['future time', request({ takenAt: 10001 })],
    ['fractional time', request({ takenAt: 2.5 })], ['quantity string', request({ quantities: quantities('9') })],
    ['negative quantity', request({ quantities: quantities(-1) })], ['fractional quantity', request({ quantities: quantities(1.5) })],
    ['overflow quantity', request({ quantities: quantities(1000001) })],
    ['unknown ship', request({ quantities: { ...quantities(), cruiser: 1 } })],
  ]) await t.test(name, () => {
    const h = harness({ shipMinimums: quantities(8) });
    assert.throws(() => h.raise(value), error => error.name === 'TypeError');
    assert.equal(h.writes.length, 0);
    assert.equal(h.stored.shipMinimums.marauder, 8);
  });
});
