'use strict';
// Synthetic DOM/resources model based on the visible 2026-10-14 screenshot.
// Exact title values, checked buildings, empty queue, role and valid census are
// explicit test assumptions: the screenshot does not establish those settings.
// Executes shipped parsing, selection, both planners and the complete step;
// Empire permissions use the real coordinator/core with an injected read adapter.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../docs/empire-core.js');
const runtime = require('../docs/empire-runtime.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = 'alpha/reactor-fixture', NOW = 1792000000000;
const BUILDINGS = [['command_center', 'Command Center'], ['reactor', 'Reactor'],
  ['palladium_extractor', 'Palladium Extractor'], ['iridium_extractor', 'Iridium Extractor'],
  ['warehouse', 'Resource Depot'], ['shipyard', 'Shipyard'], ['trade_hub', 'Trade Hub']];
const order = BUILDINGS.map(([id]) => id);
const zeroes = () => Object.fromEntries(core.DEFAULT_SHIPS.map(id => [id, 0]));
function extract(name) {
  const start = source.indexOf(`  function ${name}(`), end = source.indexOf('\n  }\n', start);
  assert.ok(start >= 0 && end > start, `Missing shipped ${name}`);
  return source.slice(start, end + 5);
}
const code = ['exactInteger', 'displayedInteger', 'signedInteger', 'isAvailable', 'rows', 'queueLength',
  'queuedBuilding', 'upgradeEnergy', 'storageFill', 'selectBuilding', 'readResourceSnapshot',
  'readUpgradeEtaSnapshot', 'empireOperationalSettings', 'createUpgradeEtaEstimator',
  'createFleetPriorityPlanner', 'createInfrastructurePriorityPlanner', 'fleetProductionWaitMessage', 'step'].map(extract).join('\n');

function node(value = '', attrs = {}) {
  const classes = new Set();
  return { textContent: String(value), hidden: false, disabled: false, visible: true,
    classList: { contains: name => classes.has(name), add: name => classes.add(name), delete: name => classes.delete(name) },
    getAttribute: name => attrs[name] ?? null, setAttribute: (name, value) => { attrs[name] = String(value); },
    matches(selector) { return selector === ':disabled' && this.disabled; }, children: [] };
}
function harness({ empire = true, role = 'balanced', energy = -1 } = {}) {
  let clock = NOW, scope = SCOPE, active = A, observedAt = NOW, census = 'initial', selected = 1, owned = true;
  let beforeBoundary = null, beforeRead = null, blocked = false, recovering = false, busy = false;
  const clicks = [], notices = [], events = [], queue = [], buttons = [], buildingNodes = new Map();
  const panel = node(), fleetPanel = node();
  const settings = { enabled: true, order: [...order], excluded: [], depotFillPercent: 90, shipOrder: core.DEFAULT_SHIPS,
    shipMinimums: zeroes(), countAway: false };
  const values = [
    [16, 57200, 57200, -4], [13, 23000, 23000, 57], [16, 50100, 78700, -12],
    [16, 78700, 50100, -12], [16, 57200, 57200, -4], [15, 46200, 46200, -3], [18, 59500, 59500, -8],
  ];
  for (const [index, [id, name]] of BUILDINGS.entries()) {
    const [level, pa, ir, delta] = values[index], button = node(`Lvl ${level}`, { title: id === 'reactor' ? '' : 'Not enough resources.' });
    button.dataset = { tutorial: 'upgrade-' + id }; button.disabled = id !== 'reactor';
    const fields = { '.b-name': node(name), '.b-cost': node(), '.b-cost-pa': node(`${pa / 1000}K`, { title: String(pa) }),
      '.b-cost-ir': node(`${ir / 1000}K`, { title: String(ir) }), '.b-cost-en': node(delta > 0 ? '+' + delta : delta) };
    const wrap = node(); wrap.querySelector = selector => fields[selector] || null; fields['.b-cost-en-wrap'] = wrap;
    const row = node(); row.querySelector = selector => fields[selector] || null;
    button.closest = () => row;
    button.click = () => { assert.equal(button.disabled, false, 'Native disabled state must never be removed'); clicks.push(id); };
    buildingNodes.set(id, { button, row, fields }); buttons.push(button);
  }
  const resources = { palladium: { amount: 33800, cap: 131600, rate: 263.8 }, iridium: { amount: 29800, cap: 131600, rate: 263.8 } };
  const hud = new Map();
  function syncHud() {
    for (const [id, resource] of Object.entries(resources)) {
      hud.set(`[data-field="res-${id}"]`, node(`${resource.amount / 1000}K`, { title: String(resource.amount) }));
      hud.set(`[data-field="res-${id}-cap"]`, node(`/ ${resource.cap / 1000}K`, { title: '/ ' + resource.cap }));
      hud.set(`[data-field="res-${id}-rate"]`, node('+' + resource.rate + '/min'));
    }
    hud.set('[data-field="res-energy"]', node(energy === null ? '?' : energy));
  }
  syncHud();
  const document = { body: {}, hidden: false, querySelector(selector) {
    if (selector === '#structures') return panel;
    if (selector === '#shipyard') return fleetPanel;
    if (selector === '#structures [data-field="queue-list"]') return { children: queue };
    if (selector === '[data-field="nameplate-name"]') return node('Synthetic Xethurn');
    if (selector.includes('.b-loading')) return buttons.some(button => button.classList.contains('b-loading')) ? node() : null;
    return hud.get(selector) || null;
  }, querySelectorAll(selector) {
    if (selector.includes('[data-field="buildings-list"]')) return buttons;
    if (selector.includes('.queue-row-text')) return queue.map(item => item.label);
    if (selector.includes('.queue-row')) return queue;
    return [];
  } };
  let config = core.normalizeConfig({ enabled: empire, fleetTargets: zeroes(), systems: { [A]: { enabled: true, role } } });
  const fleet = Object.fromEntries(core.DEFAULT_SHIPS.map(id => [id, { parked: 0, away: 0, building: 0 }]));
  const snapshot = id => ({ scope, systemId: id, name: 'Synthetic Xethurn', owned: true, observedAt, censusId: census,
    resources: structuredClone(resources), energy, queue: { buildings: queue.length, ships: 0 }, fleet });
  const context = () => ({ scope, systemId: active, selectionCount: selected, owned, settled: !blocked });
  const bundle = () => {
    beforeRead?.();
    const snapshots = [A, B].map(snapshot);
    return { roster: { scope, observedAt, complete: true, systems: [A, B].map(id => ({ id, owned: true })) }, snapshots,
      active: { context: context(), snapshot: snapshots.find(item => item.systemId === active) },
      transitCensus: { scope, observedAt, censusId: census, ships: zeroes() } };
  };
  const adapter = { readBundle: bundle, readActive: () => bundle().active, canNavigate: () => !blocked };
  const controller = runtime.create({ core, adapter, now: () => clock, dwellMs: 1000000,
    read: () => config, write: (_key, next) => { config = next; } });
  const wrapped = { ...controller, captureOrderBoundary(ctx) { beforeBoundary?.(); return controller.captureOrderBoundary(ctx); } };
  const ctx = { document, settings, BUILDINGS, PANEL: '#structures', FLEET_PANEL: '#shipyard',
    BUTTONS: '#structures [data-field="buildings-list"] > .building-row button.b-upgrade[data-tutorial^="upgrade-"]',
    text: el => el?.textContent || '', controlVisible: el => !!el && el.visible !== false && !el.hidden && !blocked,
    systemId: () => active, missionContext: context, empireController: wrapped, empireAdapter: adapter,
    Date: { now: () => clock }, nextClickAt: 0, depotPrioritySystem: null, pending: null,
    error: '', unconfirmed: 0, eventSequence: 0, notificationSession: 'reactor-deficit-fixture',
    MIN_GAP_MS: 500, RESPONSE_TIMEOUT_MS: 12000, RETRY_GAP_MS: 5000, MAX_UNCONFIRMED: 3,
    host: { hidden: false }, ui: {}, mount() {}, setText() {}, readUnread() {}, observingNotifications: false,
    notifier: { isEnabled: () => false, isEventEnabled: () => false }, observeGameEvents() {},
    reports: { tick: () => ({ status: '' }), isRecovering: () => recovering },
    attackRetry: { isObservingReports: () => false, flushMinimums() {}, tick: async () => {}, isBusy: () => busy },
    missionAdapter: { isBusy: () => busy }, fleetWait: { tick: async () => {} }, currentMissionJob: () => null,
    leader: true, lockError: false, importingBackup: false, acquireLeadership() {}, releaseLeadership() {},
    hudPanelAvailable: () => !blocked, show: value => notices.push(value), wakeAt() {}, saveSettings() {},
    emitEvent: (...args) => events.push(args), console,
    shipRows: () => [], fleetEnabled: () => false,
    readFleetPrioritySnapshot: (_ships, input = resources) => ({ active: true, contextReady: true, ships: [], resources: input }),
    batchSummary: () => null, batchApplied: () => null,
    updateEmpireState: () => controller.update({ scope, enabled: settings.enabled, blocked: ctx.pending ? 'Pending request' : blocked ? 'HUD unavailable' : '' }),
  };
  vm.createContext(ctx); vm.runInContext(code + '\nvar upgradeEta = createUpgradeEtaEstimator();\n'
    + 'var fleetPriority = createFleetPriorityPlanner(upgradeEta.formatDuration);\n'
    + 'var infrastructurePriority = createInfrastructurePriorityPlanner(upgradeEta);', ctx);
  ctx.updateEmpireState();
  return { ctx, controller, document, settings, resources, buildingNodes, clicks, notices, events, queue,
    select: () => ctx.selectBuilding(ctx.rows()), estimate: () => ctx.upgradeEta.estimate(ctx.readUpgradeEtaSnapshot(ctx.rows())),
    step: () => ctx.step(), get energy() { return energy; }, set energy(value) { energy = value; syncHud(); },
    get role() { return config.systems[A].role; }, set role(value) { config.systems[A].role = value; ctx.updateEmpireState(); },
    set attended(value) { config.systems[A].enabled = value; ctx.updateEmpireState(); },
    set stale(value) { observedAt = value ? clock - 120001 : clock; },
    set selected(value) { selected = value; }, set owned(value) { owned = value; },
    set blocked(value) { blocked = value; }, set recovering(value) { recovering = value; }, set busy(value) { busy = value; },
    set beforeBoundary(value) { beforeBoundary = value; }, set beforeRead(value) { beforeRead = value; },
    advance(ms) { clock += ms; }, syncHud,
    enqueue(id = 'reactor') {
      const name = BUILDINGS.find(([key]) => key === id)[1], entry = node(); entry.label = node(`${name} → Lvl 13 · 45m 37s`);
      entry.querySelector = () => entry.label; queue.push(entry); census = 'queued'; observedAt = clock;
    },
  };
}

test('negative-energy screenshot fixture selects and forecasts its affordable Reactor without another affordable upgrade', () => {
  const h = harness();
  const snapshot = h.ctx.readUpgradeEtaSnapshot(h.ctx.rows());
  assert.equal(snapshot.energy, -1); assert.equal(snapshot.buildings.filter(row => row.blocker === 'ready').length, 1);
  assert.equal(h.ctx.infrastructurePriority.select(snapshot, h.ctx.readFleetPrioritySnapshot()).reserve, false);
  assert.equal(h.select()?.id, 'reactor');
  const forecast = h.estimate(); assert.equal(forecast.buildingId, 'reactor'); assert.equal(forecast.state, 'ready');
  assert.equal(forecast.waitMs, 0); assert.match(forecast.detail, /déficit actual/i);
});

test('negative-energy screenshot fixture reaches the native click through the complete imperial step exactly once', () => {
  const h = harness(); assert.equal(h.controller.state().ready, true);
  h.step(); assert.deepEqual(h.clicks, ['reactor']); assert.ok(h.ctx.pending?.empireBoundary);
  h.step(); assert.deepEqual(h.clicks, ['reactor'], 'Pending request blocks a repeated step');
  h.advance(5); h.enqueue(); h.step(); assert.equal(h.ctx.pending, null);
  h.advance(1000); h.step(); assert.deepEqual(h.clicks, ['reactor'], 'Queued reactor blocks another order');
});

test('negative-energy screenshot forecast independently reports the Reactor ready instead of waiting for Shipyard funds', () => {
  const h = harness(), forecast = h.estimate();
  assert.equal(forecast.buildingId, 'reactor'); assert.equal(forecast.state, 'ready');
  assert.equal(forecast.waitMs, 0); assert.match(forecast.detail, /déficit actual/i);
});

test('real deficit recovery applies in ordinary mode and every imperial role without altering saved settings', () => {
  for (const options of [{ empire: false }, ...['balanced', 'industry', 'shipyard', 'defense'].map(role => ({ role }))]) {
    const h = harness(options), before = structuredClone(h.settings); h.step();
    assert.deepEqual(h.clicks, ['reactor'], JSON.stringify(options)); assert.deepEqual(h.settings, before);
  }
});

test('zero positive or unknown energy does not justify a speculative Reactor without an affordable consumer', () => {
  for (const energy of [0, 1, 57, null]) {
    const h = harness({ energy }); h.step(); assert.deepEqual(h.clicks, [], String(energy));
    assert.equal(h.select(), undefined);
    assert.notEqual(h.estimate().state, 'ready');
  }
});

test('negative energy never overrides an excluded Reactor or a native blocker', () => {
  const variants = [h => h.settings.excluded.push('reactor'), h => { h.settings.order = order.filter(id => id !== 'reactor'); },
    h => { h.buildingNodes.get('reactor').button.disabled = true; },
    h => { h.buildingNodes.get('reactor').button.setAttribute('aria-disabled', 'true'); },
    h => { h.buildingNodes.get('reactor').button.visible = false; },
    h => h.buildingNodes.get('reactor').button.classList.add('b-loading'),
    h => h.buildingNodes.get('reactor').button.classList.add('b-upgrade-error'), h => h.enqueue()];
  for (const change of variants) { const h = harness(); change(h); h.step(); assert.deepEqual(h.clicks, []); assert.equal(h.select(), undefined); }
});

test('deficit recovery requires a known positive Reactor gain and does not invent a zero-energy upgrade', () => {
  for (const delta of ['0', '-1', '?']) {
    const h = harness(); h.buildingNodes.get('reactor').fields['.b-cost-en'].textContent = delta;
    h.step(); assert.deepEqual(h.clicks, []); assert.notEqual(h.estimate().state, 'ready');
  }
});

test('deficit recovery preserves pauses leadership cooldown pending work and imperial authority', () => {
  const variants = [h => { h.settings.enabled = false; }, h => { h.document.hidden = true; },
    h => { h.ctx.leader = false; }, h => { h.ctx.nextClickAt = NOW + 1000; }, h => { h.blocked = true; },
    h => { h.recovering = true; }, h => { h.busy = true; }, h => h.controller.suspend(1000),
    h => h.controller.suspendInteraction(1000), h => { h.attended = false; }, h => { h.stale = true; },
    h => { h.selected = 2; }, h => { h.owned = false; }];
  for (const change of variants) { const h = harness(); change(h); h.step(); assert.deepEqual(h.clicks, []); }
});

test('loss of imperial authority immediately before the Reactor boundary prevents the click', () => {
  const h = harness(); h.beforeBoundary = () => { h.controller.suspendInteraction(1000); };
  h.step(); assert.deepEqual(h.clicks, []); assert.equal(h.ctx.pending, null);
});

test('an outstanding fleet resource reservation still precedes deficit recovery', () => {
  const h = harness();
  h.ctx.readFleetPrioritySnapshot = () => ({ active: true, contextReady: true, resources: h.resources,
    ships: [{ id: 'probe', name: 'Probe', deficit: 1, blocker: 'resources', unitCost: { palladium: 50000, iridium: 50000 } }] });
  h.step(); assert.deepEqual(h.clicks, []); assert.match(h.notices.at(-1), /Flota prioritaria/);
});

test('retained Depot reservations remain in charge rather than being spent on another building', () => {
  const h = harness(); h.ctx.depotPrioritySystem = A;
  h.enqueue(); h.step(); assert.deepEqual(h.clicks, []); assert.match(h.notices.at(-1), /Resource Depot/);
});

test('a recovered deficit releases its Reactor demand without requiring settings changes', () => {
  const h = harness(); assert.equal(h.select()?.id, 'reactor');
  h.energy = 56; assert.equal(h.select(), undefined); h.step(); assert.deepEqual(h.clicks, []);
});

test('a Reactor alone repairs debt but still waits for its own resources and native queue', () => {
  const h = harness(); h.settings.excluded = order.filter(id => id !== 'reactor');
  assert.equal(h.select()?.id, 'reactor'); assert.equal(h.estimate().state, 'ready');
  h.resources.iridium.amount = 22000; h.syncHud();
  const button = h.buildingNodes.get('reactor').button;
  button.disabled = true; button.setAttribute('title', 'Not enough resources.');
  h.step(); assert.deepEqual(h.clicks, []);
  let forecast = h.estimate(); assert.equal(forecast.buildingId, 'reactor'); assert.equal(forecast.state, 'waiting');
  assert.ok(Math.abs(forecast.waitMs - 1000 / 263.8 * 60000) < 0.01);
  button.setAttribute('title', 'Build queue full.'); h.enqueue('command_center');
  forecast = h.estimate(); assert.equal(forecast.state, 'waiting'); assert.equal(forecast.waitMs, (45 * 60 + 37) * 1000);
  h.step(); assert.deepEqual(h.clicks, []);
});

test('a queued lone Reactor reports its real wait and insufficient production never invents a countdown', () => {
  const h = harness(); h.settings.excluded = order.filter(id => id !== 'reactor'); h.enqueue();
  let forecast = h.estimate(); assert.equal(forecast.state, 'blocked'); assert.match(forecast.detail, /Reactor en cola/);
  h.queue.length = 0; h.resources.iridium.amount = 22000; h.resources.iridium.rate = 0; h.syncHud();
  const button = h.buildingNodes.get('reactor').button; button.disabled = true; button.setAttribute('title', 'Not enough resources.');
  forecast = h.estimate(); assert.equal(forecast.state, 'blocked'); assert.equal(forecast.reason, 'production');
  assert.equal(forecast.waitMs, null); h.step(); assert.deepEqual(h.clicks, []);
});

test('current energy debt does not reorder an independently eligible zero-energy building', () => {
  const h = harness(); h.settings.order = ['shipyard', ...order.filter(id => id !== 'shipyard')];
  const shipyard = h.buildingNodes.get('shipyard'); shipyard.button.disabled = false; shipyard.button.setAttribute('title', '');
  for (const field of ['.b-cost-pa', '.b-cost-ir']) shipyard.fields[field].setAttribute('title', '1000');
  shipyard.fields['.b-cost-en'].textContent = '0';
  assert.equal(h.select()?.id, 'shipyard'); assert.equal(h.estimate().buildingId, 'shipyard');
  h.step(); assert.deepEqual(h.clicks, ['shipyard']);
});
