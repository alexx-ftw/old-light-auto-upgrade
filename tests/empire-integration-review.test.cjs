'use strict';
// Independent main-script contracts. This fixture never boots the Helper or game.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const adapterModule = require('../docs/empire-adapter.js');
const source = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCOPE = 'alpha/player';
const SHIPS = ['probe', 'marauder', 'sentinel', 'vanguard'].map(id => [id, id]);

function functionSource(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  let end = source.indexOf('{', start), depth = 1;
  while (depth && ++end < source.length) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
  }
  assert.equal(depth, 0);
  return source.slice(start, end + 1);
}

function harness() {
  let missionBusy = false, retryBusy = false, recovering = false;
  let dialog = false, loading = false, focus = false, sorting = false, blockedHud = false;
  let canAct = true, enabled = true, renders = 0;
  const updates = [];
  const state = { scope: SCOPE, maxAgeMs: 120000,
    config: { systems: { [A]: { role: 'industry', enabled: true } } },
    plan: { targetsBySystem: { [A]: { shipMinimums: { probe: 2, marauder: 3, sentinel: 0, vanguard: 0 } } } } };
  const active = {
    context: { scope: SCOPE, systemId: A, owned: true, settled: true, selectionCount: 1 },
    snapshot: { scope: SCOPE, systemId: A, owned: true, observedAt: Date.now() },
  };
  const settings = { enabled: true,
    shipMinimums: { probe: 50, marauder: 50, sentinel: 50, vanguard: 50 },
    order: ['reactor'], excluded: ['trade_hub'], shipOrder: SHIPS.map(([id]) => id), countAway: false };
  const document = { hidden: false, querySelector(selector) {
    if (selector === 'dialog[open]') return dialog ? {} : null;
    return loading && selector.includes('.b-loading') ? {} : null;
  } };
  const globals = {
    settings, SHIPS, document, leader: true, pending: null, importingBackup: false,
    PANEL: '#structures', FLEET_PANEL: '#shipyard',
    reports: { isRecovering: () => recovering },
    missionAdapter: { isBusy: () => missionBusy }, attackRetry: { isBusy: () => retryBusy },
    host: { shadowRoot: {
      querySelector: () => sorting ? {} : null,
      get activeElement() { return focus ? { matches: () => true } : null; },
    } },
    empireController: {
      isEnabled: () => enabled, state: () => state, canAct: () => canAct,
      update: args => updates.push(args), setConfig: value => value,
    },
    empireAdapter: { readActive: () => active, isAvailable: () => false },
    empirePanel: { render: () => renders++ },
    systemId: () => A, missionContext: () => ({ scope: SCOPE }), hudBlocked: () => blockedHud, schedule() {},
  };
  const context = vm.createContext(globals);
  const names = ['empireOperationalSettings', 'empireMissionPermission', 'canNavigateEmpire', 'updateEmpireState', 'installEmpirePanel'];
  vm.runInContext(names.map(functionSource).join('\n'), context);
  return {
    context, globals, settings, state, active, updates, document,
    set enabled(value) { enabled = value; }, set canAct(value) { canAct = value; },
    set missionBusy(value) { missionBusy = value; }, set retryBusy(value) { retryBusy = value; },
    set recovering(value) { recovering = value; }, set dialog(value) { dialog = value; },
    set loading(value) { loading = value; }, set focus(value) { focus = value; },
    set sorting(value) { sorting = value; }, set blockedHud(value) { blockedHud = value; }, get renders() { return renders; },
  };
}

test('review: privileged Helper remains content-isolated with DOM-ready initialization', () => {
  const metadata = source.slice(0, source.indexOf('// ==/UserScript=='));
  assert.match(metadata, /@run-at\s+document-start/);
  assert.match(metadata, /@inject-into\s+content/);
  assert.match(metadata, /@grant\s+GM_getValue/);
  assert.match(source, /document\.addEventListener\('DOMContentLoaded', startOldLightHelper, \{ once: true \}\)/);
});

test('review: imperial role and fleet overrides never mutate ordinary Helper settings', () => {
  const h = harness(), before = structuredClone(h.settings);
  const result = h.context.empireOperationalSettings();
  assert.equal(result.countAway, true);
  assert.equal(result.shipMinimums.marauder, 3);
  assert.equal(result.order[0], 'palladium_extractor');
  assert.deepEqual(h.settings, before);
  h.enabled = false;
  assert.equal(h.context.empireOperationalSettings(), h.settings);
});

test('review: absent imperial allocation does not reuse old local fleet minima', () => {
  const h = harness(); h.state.plan.targetsBySystem = {};
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.empireOperationalSettings().shipMinimums)),
    { probe: 0, marauder: 0, sentinel: 0, vanguard: 0 });
});

test('review: navigation waits for pending, hidden, mission, retry, dialog and editing states', () => {
  const cases = [
    h => { h.globals.pending = {}; }, h => { h.document.hidden = true; },
    h => { h.missionBusy = true; }, h => { h.retryBusy = true; }, h => { h.dialog = true; },
    h => { h.loading = true; }, h => { h.focus = true; }, h => { h.sorting = true; },
    h => { h.recovering = true; }, h => { h.globals.importingBackup = true; },
    h => { h.globals.leader = false; }, h => { h.blockedHud = true; },
  ];
  for (const block of cases) {
    const h = harness(); assert.equal(h.context.canNavigateEmpire(), true);
    block(h); assert.equal(h.context.canNavigateEmpire(), false);
  }
});

test('review: busy mission permission does not depend on its own navigation guard', () => {
  const h = harness(); h.canAct = false;
  assert.equal(h.context.empireMissionPermission(), false);
  h.missionBusy = true; h.dialog = true;
  assert.equal(h.context.canNavigateEmpire(), false);
  assert.equal(h.context.empireMissionPermission(), true);
  h.active.context.owned = false;
  assert.equal(h.context.empireMissionPermission(), false);
  h.active.context.owned = true;
  h.active.snapshot.systemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  assert.equal(h.context.empireMissionPermission(), false);
  h.active.snapshot.systemId = A;
  h.active.snapshot.observedAt = Date.now() + 1000;
  assert.equal(h.context.empireMissionPermission(), false);
  h.active.snapshot.observedAt = Date.now() - 120001;
  assert.equal(h.context.empireMissionPermission(), false);
});

test('review: updates carry account scope and wait for exclusive tab control', () => {
  const h = harness(); h.globals.leader = false; h.context.updateEmpireState();
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].scope, SCOPE);
  assert.match(h.updates[0].blocked, /control exclusivo/);
  assert.equal(h.renders, 1);
});

test('review: panel capability callback uses the real adapter API and requires a source', () => {
  const h = harness();
  const document = { addEventListener() {}, removeEventListener() {} };
  const native = adapterModule.create({ getWorld: () => null, getContext: () => null,
    getHudSnapshot: () => null, document, canNavigate: () => false });
  try {
    h.globals.empireAdapter = native;
    let configured, mounted;
    h.context.OldLightEmpireCore = {};
    h.context.OldLightEmpirePanel = { create: options => {
      configured = options; return { mount: node => { mounted = node; } };
    } };
    const target = {};
    h.context.installEmpirePanel({ querySelector: () => target });
    assert.equal(configured.canEnable(), false);
    assert.equal(mounted, target);
  } finally { native.dispose(); }
});
