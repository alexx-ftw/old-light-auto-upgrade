'use strict';
// Offline composition regressions for the 1.14.3 performance base plus policy sync.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness, core } = require('../benchmarks/empire-runtime.cjs');
const source = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const extract = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
};
const policyCode = extract('  function applySyncedEmpirePolicy(', '  function applySyncedPreferences(');
function policyHarness() {
  const h = harness(2);
  const scope = h.f.context.scope;
  // Keep normalized records in the same realm as the real core's strict plain-object checks.
  const apply = Function('empireController', 'missionContext', 'globalThis', policyCode + '\nreturn applySyncedEmpirePolicy;')(
    h.runtime, () => ({ scope }), { OldLightEmpireCore: core });
  return { ...h, scope, apply, incoming: () => ({ scope, config: h.runtime.exportConfig() }) };
}

test('sync/performance: panel saves notify sync and retain all hidden-render guards', () => {
  const calls = [];
  let options;
  const settings = { activeTab: 'empire', minimized: false }, document = { hidden: false }, host = { hidden: false };
  const ctx = vm.createContext({ settings, document, host, empirePanel: null, OldLightEmpireCore: {},
    empireController: { state: () => { calls.push('read'); return {}; }, setConfig: value => { calls.push('save'); return value; } },
    empireAdapter: { isAvailable: () => true }, settingsChanged: () => calls.push('notify'), schedule: () => calls.push('schedule'),
    OldLightEmpirePanel: { create: value => { options = value; return { mount() {} }; } },
  });
  vm.runInContext(extract('  function installEmpirePanel(', '\n  try {\n    const core = globalThis.OldLightEmpireCore;')
    + '\ninstallEmpirePanel({querySelector: () => ({})});', ctx);
  assert.equal(options.isVisible(), true);
  for (const [target, key, blocked, restored] of [[settings, 'activeTab', 'data', 'empire'],
    [settings, 'minimized', true, false], [document, 'hidden', true, false], [host, 'hidden', true, false]]) {
    target[key] = blocked; assert.equal(options.isVisible(), false); target[key] = restored;
  }
  assert.deepEqual(calls, [], 'visibility checks never request a full state clone');
  const config = { enabled: true };
  assert.equal(options.setConfig(config), config);
  assert.deepEqual(calls, ['save', 'notify', 'schedule']);
});

test('sync/performance: remote edits revoke the old plan and preserve fresh single-bundle gates', () => {
  const h = policyHarness(), id = h.f.context.systemId, value = h.incoming();
  value.config.enabled = false;
  value.config.fleetTargets.probe = 400;
  value.config.systems[id].role = 'shipyard';
  assert.equal(h.apply(value), true);
  assert.equal(h.runtime.isEnabled(), true, 'remote switch cannot disable local activation');
  assert.equal(h.runtime.state().ready, false);
  assert.equal(h.runtime.canAct(h.f.context), false, 'old plan cannot authorize an order');
  assert.equal(h.stats.worldReads, 0, 'policy application and revoked gate do not read native state');
  assert.equal(h.runtime.systemPolicy(id).role, 'shipyard');
  assert.equal(h.stats.worldReads, 0, 'bounded policy getter remains read-free');
  assert.equal(h.update().ready, true); assert.equal(h.stats.worldReads, 1);
  assert.equal(h.runtime.canAct(h.f.context), true); assert.equal(h.stats.worldReads, 2);
  const before = copy(h.runtime.state());
  assert.equal(h.apply(h.incoming()), false);
  assert.deepEqual(h.runtime.state(), before, 'identical sync must preserve ready state');
  assert.equal(h.stats.worldReads, 2);
  h.f.world.connected = false;
  assert.equal(h.runtime.canAct(h.f.context), false, 'fresh disconnection check overrides previous permit');
  assert.equal(h.stats.worldReads, 3);
});

test('sync/performance: received policy cannot activate a stopped client or cross account scope', () => {
  const h = policyHarness(), id = h.f.context.systemId;
  h.runtime.setConfig({ ...h.runtime.exportConfig(), enabled: false });
  const value = h.incoming(); value.config.enabled = true; value.config.fleetTargets.probe = 500;
  value.config.systems[id].enabled = false;
  assert.equal(h.apply(value), true);
  assert.equal(h.runtime.isEnabled(), false); assert.equal(h.runtime.exportConfig().systems[id].enabled, false);
  assert.equal(h.runtime.canAct(h.f.context), false); assert.equal(h.stats.worldReads, 0);
  const before = copy(h.runtime.state());
  assert.throws(() => h.apply({ ...value, scope: 'other/player' }), error => error.code === 'busy');
  assert.deepEqual(h.runtime.state(), before); assert.equal(h.stats.worldReads, 0);
  assert.equal(h.update().ready, false); assert.equal(h.stats.worldReads, 1);
  assert.equal(h.runtime.canAct(h.f.context), false); assert.equal(h.stats.worldReads, 1);
});
