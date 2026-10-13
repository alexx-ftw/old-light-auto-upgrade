'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
let core = null;
try { core = require('../docs/sync-core.js'); } catch (_) { /* The first test reports a missing implementation as an assertion. */ }

test('exports the standalone sync core API', () => {
  assert.ok(core, 'docs/sync-core.js should export the sync core');
  for (const name of ['project', 'overlay', 'create', 'canonical']) assert.equal(typeof core[name], 'function');
});

const BUILDINGS = ['command_center', 'reactor', 'palladium_extractor', 'iridium_extractor', 'warehouse', 'shipyard', 'trade_hub'];
const SHIPS = ['probe', 'marauder', 'sentinel', 'vanguard'];
const EVENTS = [
  'request.sent', 'building.queued', 'ships.queued', 'building.completed', 'fleet.changed', 'game.toast', 'game.reports',
  'game.messages', 'game.level_target', 'attack.retry', 'request.failed', 'request.rejected', 'request.unconfirmed',
  'automation.paused', 'settings.buildings', 'settings.minimum', 'settings.fleet_mode', 'settings.priority', 'settings.depot',
  'settings.automation',
];
const SCOPE = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clone = value => JSON.parse(JSON.stringify(value));
const flat = patch => ({
  'settings.enabled': true,
  'settings.order': [...BUILDINGS],
  'settings.excluded': [],
  'settings.shipOrder': [...SHIPS],
  ...Object.fromEntries(SHIPS.map(id => [`settings.shipMinimums.${id}`, 0])),
  'settings.countAway': false,
  'settings.shiftPresetShortcut': true,
  'settings.depotFillPercent': 90,
  'settings.presetCatalog': { scope: '', records: [] },
  'notifications.browserEnabled': false,
  'notifications.telegramEnabled': false,
  'notifications.paused': false,
  'notifications.browserPaused': false,
  'notifications.telegramPaused': false,
  'notifications.credentials': { botToken: '', chatId: '' },
  ...Object.fromEntries(EVENTS.map(type => [`notifications.events.${type}`, true])),
  ...Object.fromEntries(BUILDINGS.map(id => [`levelTargets.targets.${id}`, 0])),
  'attackRetries.enabled': { enabled: false, enabledAt: 0 },
  'attackRetries.autoMinimums': { autoMinimums: false, minimumsEnabledAt: 0 },
  'attackRetries.produceMissing': true,
  'attackRetries.maxRetries': 3,
  ...patch,
});
const mk = (actor, now = () => 1000, state = null, scope = SCOPE) => core.create({ state, actor, scope, now });

function backup(overrides = {}) {
  const events = Object.fromEntries(EVENTS.map(type => [type, true]));
  return {
    format: 'old-light-auto-upgrade-backup', schemaVersion: 1, scriptVersion: 'test', exportedAt: 'today',
    settings: {
      enabled: true, order: [...BUILDINGS], excluded: [], shipOrder: [...SHIPS],
      shipMinimums: Object.fromEntries(SHIPS.map(id => [id, 0])), countAway: false, shiftPresetShortcut: true,
      depotFillPercent: 90, presetCatalog: { scope: '', records: [] },
      numericDrafts: { ships: Object.fromEntries(SHIPS.map(id => [id, null])), depot: null },
      activeTab: 'fleet', panelPosition: { x: 25, y: 35 },
    },
    notifications: {
      browserEnabled: false, telegramEnabled: false, paused: false, browserPaused: false, telegramPaused: false,
      browserPauseEpoch: 8, telegramPauseEpoch: 10, botToken: '', chatId: '', drafts: { botToken: '', chatId: '' },
      events, eventsExpanded: true,
    },
    levelTargets: { schemaVersion: 1, targets: Object.fromEntries(BUILDINGS.map(id => [id, 0])),
      drafts: Object.fromEntries(BUILDINGS.map(id => [id, null])), expanded: true, acknowledged: [] },
    attackRetries: { schemaVersion: 1, enabled: false, enabledAt: 0, autoMinimums: false, minimumsEnabledAt: 0,
      minimumUpdates: [], minimumOutcomes: [], produceMissing: true, maxRetries: 3, maxRetriesDraft: '3',
      expanded: true, campaigns: [{ id: 'campaign-local', status: 'queued' }], processed: ['runtime-event'],
      outcomes: [{ id: 'runtime-outcome' }], floorAt: 900 },
    fleetMissions: { jobs: [{ id: 'local-job' }], counter: 4 },
    drive: { clientId: 'oauth-client', accessToken: 'secret', autoBackup: true },
    ...overrides,
  };
}

const maybe = (name, fn) => test(name, { skip: !core }, fn);

maybe('projects only the fixed shared preference whitelist', () => {
  const source = backup();
  const values = core.project(source);
  assert.equal(values['settings.enabled'], true);
  assert.deepEqual(values['settings.order'], BUILDINGS);
  assert.equal(values['settings.shipMinimums.marauder'], 0);
  assert.deepEqual(values['notifications.credentials'], { botToken: '', chatId: '' });
  assert.equal(values['notifications.events.settings.minimum'], true);
  assert.equal(values['levelTargets.targets.warehouse'], 0);
  assert.deepEqual(values['attackRetries.enabled'], { enabled: false, enabledAt: 0 });
  assert.deepEqual(values['attackRetries.autoMinimums'], { autoMinimums: false, minimumsEnabledAt: 0 });
  for (const forbidden of ['settings.activeTab', 'settings.numericDrafts.ships.probe', 'notifications.drafts.botToken',
    'notifications.browserPauseEpoch', 'drive.clientId', 'attackRetries.campaigns', 'attackRetries.processed',
    'fleetMissions.jobs', 'levelTargets.acknowledged']) assert.equal(Object.hasOwn(values, forbidden), false, forbidden);
  assert.equal(Object.keys(values).length, 1 + 3 + SHIPS.length + 4 + 5 + 1 + EVENTS.length + BUILDINGS.length + 4);
});

maybe('overlay changes only projected preferences and preserves unrelated backup data', () => {
  const source = backup();
  const values = core.project(source);
  values['settings.enabled'] = false;
  values['settings.shipMinimums.marauder'] = 12;
  values['notifications.events.game.toast'] = false;
  const result = core.overlay(source, values);
  assert.notEqual(result, source);
  assert.notEqual(result.settings, source.settings);
  assert.equal(source.settings.enabled, true);
  assert.equal(result.settings.enabled, false);
  assert.equal(result.settings.shipMinimums.marauder, 12);
  assert.equal(result.notifications.events['game.toast'], false);
  assert.deepEqual(result.fleetMissions, source.fleetMissions);
  assert.deepEqual(result.attackRetries.campaigns, source.attackRetries.campaigns);
  assert.deepEqual(result.notifications.browserPauseEpoch, source.notifications.browserPauseEpoch);
  assert.deepEqual(result.drive, source.drive);
});

maybe('overlay rejects any register key outside the fixed whitelist', () => {
  assert.throws(() => core.overlay(backup(), { 'settings.__proto__.polluted': true }), /unknown|allowed|register|key/i);
  assert.throws(() => core.overlay(backup(), { 'settings.shipMinimums.unknown': 4 }), /unknown|allowed|register|key/i);
});

maybe('orders are atomic registers and independent fields merge separately', () => {
  const a = mk('actor-a'); a.capture(flat()); a.promoteSeeds();
  const b = mk('actor-b'); b.capture(flat()); b.merge([a.document()]); b.accept(a.values());
  const aValues = { ...a.values(), 'settings.order': [...BUILDINGS].reverse() };
  const bValues = { ...b.values(), 'settings.shipMinimums.marauder': 17 };
  a.capture(aValues); b.capture(bValues);
  a.merge([b.document()]); b.merge([a.document()]);
  assert.deepEqual(a.values()['settings.order'], [...BUILDINGS].reverse());
  assert.deepEqual(b.values()['settings.order'], [...BUILDINGS].reverse());
  assert.equal(a.values()['settings.shipMinimums.marauder'], 17);
  assert.equal(b.values()['settings.shipMinimums.marauder'], 17);
  assert.equal(a.document().fields['settings.order'].stamp.length, 3);
});

maybe('new stale clients seed at zero and cannot overwrite an existing remote value', () => {
  const current = flat({ 'settings.enabled': false, 'settings.shipMinimums.marauder': 8 });
  const remote = mk('remote', () => 500); remote.capture(current); remote.promoteSeeds();
  const staleValues = flat({ 'settings.enabled': true, 'settings.shipMinimums.marauder': 0 });
  const stale = mk('stale', () => 900); stale.capture(staleValues);
  assert.ok(Object.values(stale.document().fields).every(entry => entry.stamp[0] === 0));
  stale.merge([remote.document()]);
  stale.capture(staleValues);
  assert.equal(stale.values()['settings.enabled'], false);
  assert.equal(stale.values()['settings.shipMinimums.marauder'], 8);
  assert.deepEqual(stale.document(), remote.document());
});

maybe('loaded remote registers without observations stay ahead of stale local defaults', () => {
  const remote = mk('remote', () => 500); remote.capture(flat({ 'settings.enabled': false })); remote.promoteSeeds();
  const client = mk('client', () => 900, { document: remote.document(), observed: {} });
  client.capture(flat({ 'settings.enabled': true }));
  assert.equal(client.values()['settings.enabled'], false);
  assert.deepEqual(client.document(), remote.document());
});

maybe('same-field concurrent writes converge by timestamp and actor', () => {
  const seed = mk('seed', () => 100); seed.capture(flat()); seed.promoteSeeds();
  const a = mk('actor-a', () => 200, seed.state());
  const b = mk('actor-b', () => 200, seed.state());
  const base = seed.values();
  a.capture({ ...base, 'settings.depotFillPercent': 70 });
  b.capture({ ...base, 'settings.depotFillPercent': 80 });
  const first = mk('first', () => 300); first.merge([a.document(), b.document()]);
  const second = mk('second', () => 300); second.merge([b.document(), a.document()]);
  assert.deepEqual(first.document(), second.document());
  assert.equal(first.values()['settings.depotFillPercent'], 80);
  assert.equal(first.document().fields['settings.depotFillPercent'].stamp[2], 'actor-b');
});

maybe('merge is idempotent and field-wise merge is associative and commutative', () => {
  const makeDoc = (actor, patch) => { const e = mk(actor, () => 100); e.capture(flat(patch)); e.promoteSeeds(); return e.document(); };
  const a = makeDoc('a', { 'settings.enabled': true });
  const b = makeDoc('b', { 'settings.enabled': false, 'settings.countAway': true });
  const c = makeDoc('c', { 'settings.enabled': true, 'settings.countAway': false });
  const left = mk('left'); left.merge([a, b]); left.merge([c]);
  const right = mk('right'); right.merge([c, b, a]); right.merge([c]);
  assert.deepEqual(left.document(), right.document());
});

maybe('capture treats zero, false, empty arrays, null and missing fields as edits', () => {
  const e = mk('local', () => 10); e.capture(flat({ 'settings.enabled': true, 'settings.excluded': ['reactor'],
    'settings.shipMinimums.probe': 5, 'settings.countAway': true }));
  e.capture({ ...flat({ 'settings.enabled': false, 'settings.excluded': [], 'settings.shipMinimums.probe': 0,
    'settings.countAway': false }), 'settings.depotFillPercent': null });
  assert.equal(e.values()['settings.enabled'], false);
  assert.deepEqual(e.values()['settings.excluded'], []);
  assert.equal(e.values()['settings.shipMinimums.probe'], 0);
  assert.equal(e.values()['settings.countAway'], false);
  assert.equal(e.values()['settings.depotFillPercent'], null);
  const noDepot = { ...flat(), 'settings.depotFillPercent': 90 };
  e.capture(noDepot);
  delete noDepot['settings.depotFillPercent'];
  e.capture(noDepot);
  assert.equal(e.values()['settings.depotFillPercent'], null);
  assert.ok(e.document().fields['settings.enabled'].stamp[0] > 0);
});

maybe('pause flags, channel settings and each event filter are projected independently', () => {
  const prefs = core.project(backup({ notifications: { ...backup().notifications, browserEnabled: true,
    telegramEnabled: true, paused: true, browserPaused: false, telegramPaused: true,
    events: { ...Object.fromEntries(EVENTS.map(type => [type, true])), 'game.toast': false } } }));
  assert.equal(prefs['notifications.paused'], true);
  assert.equal(prefs['notifications.browserPaused'], false);
  assert.equal(prefs['notifications.telegramPaused'], true);
  assert.equal(prefs['notifications.events.game.toast'], false);
  assert.equal(prefs['notifications.events.game.reports'], true);
});

maybe('credentials are one atomic register and overlay both values together', () => {
  const original = backup();
  const projected = core.project(original);
  projected['notifications.credentials'] = { botToken: '123456:abcdefghijklmnopqrstuvwxyz123456789', chatId: '-123456' };
  const next = core.overlay(original, projected);
  assert.equal(next.notifications.botToken, projected['notifications.credentials'].botToken);
  assert.equal(next.notifications.chatId, '-123456');
  const engine = mk('credentials'); engine.capture(flat());
  engine.capture({ ...flat(), 'notifications.credentials': projected['notifications.credentials'] });
  assert.deepEqual(engine.document().fields['notifications.credentials'].value, projected['notifications.credentials']);
});

maybe('overlay keeps retry campaigns, job history, and pause epochs while applying preferences', () => {
  const source = backup();
  const values = core.project(source);
  values['attackRetries.enabled'] = { enabled: true, enabledAt: 1234 };
  values['attackRetries.autoMinimums'] = { autoMinimums: true, minimumsEnabledAt: 2345 };
  values['attackRetries.produceMissing'] = false;
  values['attackRetries.maxRetries'] = 0;
  const result = core.overlay(source, values);
  assert.deepEqual([result.attackRetries.enabled, result.attackRetries.enabledAt], [true, 1234]);
  assert.deepEqual([result.attackRetries.autoMinimums, result.attackRetries.minimumsEnabledAt], [true, 2345]);
  assert.equal(result.attackRetries.produceMissing, false);
  assert.equal(result.attackRetries.maxRetries, 0);
  for (const key of ['campaigns', 'processed', 'outcomes', 'minimumUpdates', 'minimumOutcomes', 'floorAt']) {
    assert.deepEqual(result.attackRetries[key], source.attackRetries[key]);
  }
  assert.equal(result.notifications.browserPauseEpoch, 8);
  assert.equal(result.notifications.telegramPauseEpoch, 10);
  assert.deepEqual(result.fleetMissions, source.fleetMissions);
});

maybe('overlay refreshes only drafts paired with changed committed values', () => {
  const source = backup();
  source.settings.shipMinimums.marauder = 4;
  source.settings.numericDrafts.ships.marauder = 'unfinished';
  source.settings.shipMinimums.probe = 2;
  source.settings.numericDrafts.ships.probe = 'invalid';
  source.settings.numericDrafts.ships.vanguard = 'local vanguard draft';
  source.settings.depotFillPercent = 80;
  source.settings.numericDrafts.depot = 'pending depot';
  source.levelTargets.targets.reactor = 3;
  source.levelTargets.drafts.reactor = 'pending target';
  source.attackRetries.maxRetries = 6;
  source.attackRetries.maxRetriesDraft = 'in progress';
  source.notifications.botToken = 'old-token'; source.notifications.chatId = 'old-chat';
  source.notifications.drafts = { botToken: 'unfinished token', chatId: 'unfinished chat' };
  const values = core.project(source);
  values['settings.shipMinimums.marauder'] = 10;
  values['settings.shipMinimums.probe'] = 2;
  values['settings.depotFillPercent'] = 81;
  values['levelTargets.targets.reactor'] = 5;
  values['attackRetries.maxRetries'] = 9;
  values['notifications.credentials'] = { botToken: 'new-token', chatId: '-654321' };
  const result = core.overlay(source, values);
  assert.equal(result.settings.numericDrafts.ships.marauder, '10');
  assert.equal(result.settings.numericDrafts.ships.probe, 'invalid');
  assert.equal(result.settings.numericDrafts.ships.vanguard, 'local vanguard draft');
  assert.equal(result.settings.numericDrafts.depot, '81');
  assert.equal(result.levelTargets.drafts.reactor, '5');
  assert.equal(result.attackRetries.maxRetriesDraft, '9');
  assert.deepEqual(result.notifications.drafts, { botToken: '', chatId: '' });
});

maybe('unchanged committed values leave stale input drafts untouched', () => {
  const source = backup(); source.settings.numericDrafts.ships.probe = 'unfinished';
  source.notifications.drafts = { botToken: 'draft-token', chatId: 'draft-chat' };
  const result = core.overlay(source, core.project(source));
  assert.equal(result.settings.numericDrafts.ships.probe, 'unfinished');
  assert.deepEqual(result.notifications.drafts, source.notifications.drafts);
});

maybe('merge does not advance observed values and accepted remote state is not echoed', () => {
  const sender = mk('sender', () => 700); sender.capture(flat({ 'settings.countAway': true })); sender.promoteSeeds();
  const receiver = mk('receiver', () => 900); receiver.capture(flat());
  const beforeObserved = receiver.state().observed;
  receiver.merge([sender.document()]);
  assert.deepEqual(receiver.state().observed, beforeObserved);
  const remoteValues = receiver.values();
  receiver.capture(remoteValues);
  assert.deepEqual(receiver.document(), sender.document());
  receiver.accept(remoteValues);
  receiver.capture(remoteValues);
  assert.deepEqual(receiver.document(), sender.document());
});

maybe('offline changes survive state serialization and reload without a second write', () => {
  const first = mk('offline', () => 123); first.capture(flat());
  first.capture(flat({ 'settings.shipMinimums.sentinel': 14 }));
  const saved = first.state();
  const reloaded = mk('offline', () => 1, saved);
  reloaded.capture(flat({ 'settings.shipMinimums.sentinel': 14 }));
  assert.deepEqual(reloaded.document(), first.document());
  assert.equal(reloaded.values()['settings.shipMinimums.sentinel'], 14);
});

maybe('hybrid clocks stay monotonic through backwards wall time and future remote clocks', () => {
  let time = 1000;
  const local = mk('clock', () => time); local.capture(flat());
  local.capture(flat({ 'settings.countAway': true }));
  const first = local.document().fields['settings.countAway'].stamp;
  time = 10;
  local.capture(flat({ 'settings.countAway': false }));
  const backwards = local.document().fields['settings.countAway'].stamp;
  assert.ok(backwards[0] > first[0] || (backwards[0] === first[0] && backwards[1] > first[1]));
  const future = mk('future', () => 900000); future.capture(flat()); future.promoteSeeds();
  const receiver = mk('clock', () => time, local.state()); receiver.merge([future.document()]);
  receiver.capture({ ...receiver.values(), 'settings.countAway': true });
  const afterFuture = receiver.document().fields['settings.countAway'].stamp;
  assert.ok(afterFuture[0] > 900000 || (afterFuture[0] === 900000 && afterFuture[1] > 0));
});

maybe('promoteSeeds turns only zero-stamp values into real timestamped writes', () => {
  const e = mk('seed', () => 50); e.capture(flat());
  assert.ok(Object.values(e.document().fields).every(({ stamp }) => stamp[0] === 0 && stamp[1] === 0));
  e.promoteSeeds();
  assert.ok(Object.values(e.document().fields).every(({ stamp }) => stamp[0] === 50));
  const doc = e.document(); e.promoteSeeds(); assert.deepEqual(e.document(), doc);
});

maybe('real writes at epoch zero use a non-seed hybrid timestamp', () => {
  const e = mk('zero-clock', () => 0); e.capture(flat());
  e.capture(flat({ 'settings.countAway': true }));
  assert.deepEqual(e.document().fields['settings.countAway'].stamp, [0, 1, 'zero-clock']);
});

maybe('rejects corrupt documents, incompatible schemas, wrong scopes and invalid stamps', () => {
  const good = mk('source'); good.capture(flat()); good.promoteSeeds();
  const receiver = mk('target');
  for (const doc of [
    { ...good.document(), schemaVersion: 2 },
    { ...good.document(), scope: 'pegasus/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { ...good.document(), fields: { ...good.document().fields, 'settings.enabled': { ...good.document().fields['settings.enabled'], stamp: [-1, 0, 'source'] } } },
    { ...good.document(), fields: { rogue: { stamp: [1, 0, 'source'], value: true } } },
    { ...good.document(), fields: { ...good.document().fields, 'settings.enabled': { stamp: [1, 0, 'bad actor!'], value: true } } },
  ]) assert.throws(() => receiver.merge([doc]));
  assert.deepEqual(receiver.document().fields, {});
});

maybe('rejects conflicting payloads with the same field stamp', () => {
  const first = mk('same', () => 10); first.capture(flat()); first.capture(flat({ 'settings.countAway': true }));
  const conflict = clone(first.document()); conflict.fields['settings.countAway'].value = false;
  const receiver = mk('receiver');
  assert.throws(() => receiver.merge([first.document(), conflict]), /conflict|stamp|same/i);
  assert.deepEqual(receiver.document().fields, {});
});

maybe('rejects prototype injection and oversized encoded documents', () => {
  const e = mk('safe');
  const polluted = JSON.parse('{"settings.enabled":true,"__proto__":{"polluted":true}}');
  assert.throws(() => e.capture(polluted));
  assert.equal({}.polluted, undefined);
  const doc = { format: 'old-light-settings-sync', schemaVersion: 1, scope: SCOPE,
    fields: { 'settings.presetCatalog': { stamp: [1, 0, 'sender'], value: { scope: '', records: [], extra: 'x'.repeat(1024 * 1024) } } } };
  assert.throws(() => e.merge([doc]), /size|large|limit|byte/i);
  assert.equal({}.polluted, undefined);
});

maybe('canonical JSON sorts nested object keys without reordering arrays', () => {
  assert.equal(core.canonical({ z: 1, a: { y: 2, b: 3 }, list: [2, 1] }), '{"a":{"b":3,"y":2},"list":[2,1],"z":1}');
  assert.equal(core.canonical({ a: 1, z: 1 }), core.canonical({ z: 1, a: 1 }));
});

test('standalone UMD source exposes the same API on globalThis', { skip: !core }, () => {
  const fs = require('node:fs'); const vm = require('node:vm'); const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../docs/sync-core.js'), 'utf8');
  const context = vm.createContext({}); vm.runInContext(source, context);
  assert.equal(typeof context.OldLightSyncCore.project, 'function');
  assert.equal(typeof context.OldLightSyncCore.create, 'function');
});
