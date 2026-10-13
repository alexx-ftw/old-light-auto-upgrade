'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const start = source.indexOf('  function normalizeHelperWorkspace(');
const end = source.indexOf('  // END HELPER WORKSPACE PURE HELPERS');
assert.ok(start > 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end) + '\nthis.api = { normalizeHelperWorkspace, helperOperationSummary, helperDriveIndicator };', context);
const clone = value => JSON.parse(JSON.stringify(value));
const normalize = value => clone(context.api.normalizeHelperWorkspace(value));
const summary = (value, filter) => clone(context.api.helperOperationSummary(value, filter));
const drive = value => clone(context.api.helperDriveIndicator(value));

test('Workspace defaults work with missing, malformed and old preferences', () => {
  for (const input of [null, undefined, false, 7, [], {}, { fleetView: 'invalid', density: 'large', campaignFilter: null }]) {
    assert.deepEqual(normalize(input), { fleetView: 'minimums', campaignFilter: 'pending', missionFilter: 'pending', density: 'comfortable' });
  }
});
test('Workspace normalizer preserves only presentation keys, never automation controls', () => {
  const input = { fleetView: 'campaigns', campaignFilter: 'attention', missionFilter: 'all', density: 'compact', enabled: false, credentials: 'secret', campaigns: [{}] };
  assert.deepEqual(normalize(input), { fleetView: 'campaigns', campaignFilter: 'attention', missionFilter: 'all', density: 'compact' });
  assert.equal(input.enabled, false);
});
test('All supported local presentation preferences round trip', () => {
  for (const fleetView of ['minimums', 'campaigns', 'missions']) for (const density of ['compact', 'comfortable']) {
    assert.equal(normalize({ fleetView, density }).fleetView, fleetView);
    assert.equal(normalize({ fleetView, density }).density, density);
  }
});
test('Operation summaries separate history from pending work without mutating records', () => {
  const records = [{ status: 'queued' }, { status: 'completed' }, { status: 'cancelled' }, { status: 'sent' }, { status: 'paused' }, { status: 'uncertain' }, { status: 'limit' }];
  const original = JSON.stringify(records);
  assert.deepEqual(summary(records), { total: 7, pending: 4, attention: 3, visible: [true, false, false, false, true, true, true] });
  assert.equal(JSON.stringify(records), original);
});
test('Review filter includes pending fleet edits and uncertain sends', () => {
  assert.deepEqual(summary([{ status: 'waiting', attention: true }, { status: 'queued' }, { status: 'uncertain' }, { status: 'paused' }], 'attention').visible, [true, false, true, true]);
});
test('All filter retains completed and cancelled operation history', () => {
  assert.deepEqual(summary([{ status: 'completed' }, { status: 'cancelled' }, { status: 'sent' }], 'all').visible, [true, true, true]);
});
test('Empty operation collections have a stable useful empty state', () => {
  assert.deepEqual(summary([], 'attention'), { total: 0, pending: 0, attention: 0, visible: [] });
});
test('Unknown future operation statuses stay visible rather than silently disappear', () => {
  assert.deepEqual(summary([{ status: 'new_state' }]).visible, [true]);
});
test('Only an actual sync acknowledgement claims synchronization', () => {
  assert.deepEqual(drive({ code: 'synced', autoSync: true }), { text: 'Drive sincronizado', tone: 'ready' });
  for (const code of ['connected', 'saved', 'unchanged', 'restored', 'saving', 'busy']) {
    assert.equal(drive({ code }).text, 'Drive conectado');
    assert.notEqual(drive({ code }).tone, 'ready');
  }
});
test('Disconnected Drive is not confused with locally saved settings', () => {
  for (const code of ['disconnected', 'missing_client', 'sync_waiting']) assert.equal(drive({ code }).text, 'Conectar Drive');
  assert.equal(drive(null).text, 'Drive no disponible');
});
test('Drive error and authorization states are actionable, never green', () => {
  for (const code of ['expired', 'renew_soon', 'sync_retry', 'bridge_lost', 'invalid_sync', 'popup_blocked', 'new_error']) assert.equal(drive({ code }).tone, 'warning');
  assert.equal(drive({ code: 'expired' }).text, 'Renovar Drive');
  assert.equal(drive({ code: 'bridge_ready' }).text, 'Autorizar Drive');
});
test('Disabled synchronization remains explicit after a previous successful sync', () => {
  assert.deepEqual(drive({ code: 'synced', autoSync: false }), { text: 'Sync desactivada', tone: 'muted' });
});
test('Pending changes and in-progress synchronization are distinct from success', () => {
  assert.deepEqual(drive({ code: 'sync_pending' }), { text: 'Cambios pendientes', tone: 'working' });
  assert.deepEqual(drive({ code: 'syncing' }), { text: 'Sincronizando…', tone: 'working' });
});
test('Release metadata agrees with the visible version', () => {
  const meta = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.meta.js'), 'utf8');
  const version = source.match(/const SCRIPT_VERSION = '([^']+)'/)[1];
  assert.equal(source.match(/@version\s+([^\s]+)/)[1], version);
  assert.equal(meta.match(/@version\s+([^\s]+)/)[1], version);
});
