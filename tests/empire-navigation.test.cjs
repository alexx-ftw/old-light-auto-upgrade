'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../docs/empire-core.js');
const runtime = require('../docs/empire-runtime.js');
const adapterModule = require('../docs/empire-adapter.js');
const text = fs.readFileSync(require.resolve('../old-light-auto-upgrade.user.js'), 'utf8');
const blocks = ['UPGRADE ETA ESTIMATOR', 'FLEET PRIORITY PLANNER', 'INFRASTRUCTURE PRIORITY PLANNER', 'EMPIRE NAVIGATION PLANNER'];
const code = blocks.map(name => { const start = text.indexOf('// BEGIN ' + name), end = text.indexOf('// END ' + name, start); assert.ok(start > 0 && end > start); return text.slice(start, end); }).join('\n');
const planners = vm.runInNewContext(code + `\nconst upgradeEta=createUpgradeEtaEstimator(), fleetPriority=createFleetPriorityPlanner(upgradeEta.formatDuration), infrastructurePriority=createInfrastructurePriorityPlanner(upgradeEta); ({upgradeEta, fleetPriority, infrastructurePriority, navigation:createEmpireNavigationPlanner({upgradeEta,fleetPriority,infrastructurePriority})});`);
const { navigation, upgradeEta, fleetPriority, infrastructurePriority } = planners;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const P = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', S = 'alpha/' + P, TIME = 1000000;
const ships = core.DEFAULT_SHIPS, counts = n => Object.fromEntries(ships.map(id => [id, n]));
const iso = n => new Date(n).toISOString();
const policy = () => ({ order: ['command_center'], excluded: [], shipOrder: [...ships], depotFillPercent: 90, missionSystemIds: [], retainedDepotId: null });
function fixture() {
  return { work: { scope: S, censusId: 'native:1:1:0', observedAt: TIME, treasuryBlocked: false, systems: [{ systemId: A,
    buildings: [{ id: 'command_center', level: 1, requirementMet: true, upgrade: { palladium: 50, iridium: 50, energy: -1 } }], buildingSlots: 2, buildingQueue: [], shipSlots: 2, shipQueue: [],
    shipTypes: ships.map(id => ({ id, unlocked: true, palladium: 200, iridium: 200 })) }] },
    snapshots: [{ scope: S, censusId: 'native:1:1:0', observedAt: TIME, systemId: A, energy: 100,
      resources: { palladium: { amount: 100, cap: 1000, rate: 10 }, iridium: { amount: 100, cap: 1000, rate: 10 } } }],
    config: { systems: {} }, plan: { complete: true, summary: { allocationsBySystem: { [A]: { probe: 1 } } } }, now: TIME, policy: policy() };
}
const eligible = input => [...navigation(input).eligibleSystemIds];
function realSnapshots(input) {
  const source = input.snapshots[0], raw = input.work.systems[0];
  const structure = { resources: source.resources, energy: source.energy, order: input.policy.order, excluded: input.policy.excluded, depotFillPercent: input.policy.depotFillPercent, cooldownMs: 0,
    queue: { full: false, buildings: {} }, buildings: raw.buildings.map(row => ({ id: row.id, name: row.id, visible: true, targetLevel: row.level + 1, blocker: 'ready', cost: { palladium: row.upgrade.palladium, iridium: row.upgrade.iridium }, energy: row.upgrade.energy })) };
  const fleet = { active: true, contextReady: true, resources: source.resources, docksFull: false, treasuryBlocked: false, queue: { full: false, paused: false },
    ships: [{ id: 'probe', name: 'probe', deficit: 1, maxBatch: 1, blocker: 'resources', unitCost: { palladium: 200, iridium: 200 } }] };
  return { structure, fleet };
}
test('full/unknown docks preserve a feasible building without changing strict real fleet reservation', () => {
  const input = fixture(), { structure, fleet } = realSnapshots(input);
  const strict = fleetPriority.select(fleet);
  assert.equal(strict.reserve, true); assert.equal(fleetPriority.estimate(fleet, strict).state, 'waiting');
  assert.equal(fleetPriority.select({ ...fleet, docksFull: true }).reserve, false);
  assert.equal(upgradeEta.estimate(structure).state, 'ready');
  assert.deepEqual(eligible(input), [A]);
});
test('a retained Depot continuation remains visitable after another system clears the single local hint', () => {
  const input = fixture(); input.policy.order = ['reactor', 'warehouse']; input.snapshots[0].energy = 30;
  for (const resource of Object.values(input.snapshots[0].resources)) { resource.amount = 750; resource.rate = 0; }
  input.work.systems[0].buildings = [{ id: 'reactor', level: 2, requirementMet: true, upgrade: { palladium: 200, iridium: 200, energy: 30 } }, { id: 'warehouse', level: 1, requirementMet: true, upgrade: { palladium: 500, iridium: 500, energy: -20 } }];
  input.plan.summary.allocationsBySystem[A].probe = 0;
  const { structure, fleet } = realSnapshots(input); fleet.active = false;
  assert.equal(infrastructurePriority.select(structure, fleet, true).forecast.state, 'ready');
  assert.equal(infrastructurePriority.select(structure, fleet, true).forecast.buildingId, 'warehouse');
  assert.notEqual(upgradeEta.estimate(structure).state, 'ready');
  for (const hint of [A, B, null]) { input.policy.retainedDepotId = hint; assert.deepEqual(eligible(input), [A]); }
});
test('insufficient resources become eligible at the real threshold without a new source census', () => {
  const input = fixture(); input.plan.summary.allocationsBySystem[A].probe = 0;
  for (const r of Object.values(input.snapshots[0].resources)) r.amount = 0;
  input.work.systems[0].buildings[0].upgrade.palladium = input.work.systems[0].buildings[0].upgrade.iridium = 10;
  assert.deepEqual(eligible(input), []); input.now += 60001; assert.deepEqual(eligible(input), [A]);
});
test('known impossible capacity, locked/maxed buildings and no configured work can sleep', () => {
  for (const change of [v => { v.work.systems[0].buildings[0].upgrade.palladium = 1001; }, v => { v.work.systems[0].buildings[0].requirementMet = false; }, v => { v.work.systems[0].buildings[0].upgrade = null; }, v => { v.policy.excluded = ['command_center']; }]) {
    const input = fixture(); input.plan.summary.allocationsBySystem[A].probe = 0; change(input); assert.deepEqual(eligible(input), []);
  }
});
test('missions and retry origins retain visits even when ordinary work is idle', () => {
  const input = fixture(); input.policy.excluded = ['command_center']; input.plan.summary.allocationsBySystem[A].probe = 0;
  assert.deepEqual(eligible(input), []); input.policy.missionSystemIds = [A]; assert.deepEqual(eligible(input), [A]);
});
test('incomplete, foreign, duplicate and future census inputs never authorize exclusions', () => {
  for (const change of [v => { v.work.censusId = 'foreign'; }, v => { v.snapshots[0].scope = 'beta/player'; }, v => { v.snapshots[0].observedAt--; }, v => { v.work.systems.push(structuredClone(v.work.systems[0])); v.snapshots.push(structuredClone(v.snapshots[0])); }, v => { v.now--; }, v => { v.plan.complete = false; }]) {
    const input = fixture(); change(input); assert.equal(navigation(input), null);
  }
});
test('unknown costs, slots, queue deadlines and energy preserve a visit', () => {
  for (const change of [v => { v.work.systems[0].buildingSlots = null; }, v => { v.work.systems[0].buildings[0].upgrade = undefined; }, v => { v.work.systems[0].buildingQueue = [{ type: 'command_center', targetLevel: 2, completesAt: null }]; }, v => { v.snapshots[0].energy = null; }, v => { v.work.systems[0].shipQueue = [{ nextCompletesAt: TIME + 1000, paused: null }]; }]) {
    const input = fixture(); change(input); assert.deepEqual(eligible(input), [A]);
  }
});
test('unknown energy cannot suppress an urgent Depot/Reactor chain', () => {
  const input = fixture(); input.policy.order = ['warehouse']; input.snapshots[0].energy = null;
  input.work.systems[0].buildings[0].id = 'warehouse';
  for (const r of Object.values(input.snapshots[0].resources)) r.amount = 950;
  assert.deepEqual(eligible(input), [A]);
});
test('building queue holds until nominal completion, then revisits for changed levels and energy', () => {
  const input = fixture(); input.plan.summary.allocationsBySystem[A].probe = 0;
  input.work.systems[0].buildingSlots = 1; input.work.systems[0].buildingQueue = [{ type: 'command_center', targetLevel: 2, completesAt: TIME + 10000 }];
  assert.deepEqual(eligible(input), []); input.now += 10000; assert.deepEqual(eligible(input), [A]);
});
test('ship queue holds, paused queue releases buildings, and nominal completion preserves a visit', () => {
  const input = fixture(); input.policy.excluded = ['command_center'];
  for (const r of Object.values(input.snapshots[0].resources)) r.amount = 250;
  input.work.systems[0].shipSlots = 1; input.work.systems[0].shipQueue = [{ nextCompletesAt: TIME + 10000, paused: false }];
  assert.deepEqual(eligible(input), []); input.now += 10000; assert.deepEqual(eligible(input), [A]);
  input.now = TIME; input.work.systems[0].shipQueue[0].paused = true; input.policy.excluded = [];
  assert.deepEqual(eligible(input), [A]);
});
function harness(ids = [A, B]) {
  let clock = TIME, current = ids[0], config = core.normalizeConfig({ enabled: true }), readError = false, allowed = true;
  let source = { version: 1, galaxy: 'alpha', selfId: P, scope: S, generation: 1, epoch: 1, revision: 0, observedAt: TIME, connected: true, complete: true, credits: { inDeficit: false }, transits: [], transitShips: counts(0),
    systems: ids.map((id, i) => ({ id, q: i, r: 0, name: id, playerId: P, fleet: ships.map(type => ({ type, quantity: 0 })),
      buildings: [{ type: 'command_center', level: 1, nextUpgrade: { paCost: 500, irCost: 500, energyDelta: -1 } }],
      economy: { resources: { palladium: 100, iridium: 100, settledAt: iso(TIME) }, paCap: 1000, irCap: 1000, paRatePerMin: 10, irRatePerMin: 10, energyCap: 100, energyUsed: 0, queueSlots: 2, queue: [] },
      shipyard: { queueSlots: 2, queue: [], types: ships.map(type => ({ type, unlocked: true, stats: { paCost: 200, irCost: 200 } })) } })) };
  const context = () => ({ scope: S, systemId: current, selectionCount: 1, owned: true, settled: true });
  const native = adapterModule.create({ now: () => clock, getWorld: () => source, getContext: context, getHudSnapshot() {
    const raw = source.systems.find(row => row.id === current); if (!raw) return null;
    const resources = adapterModule.projectResources(raw.economy, clock);
    for (const r of Object.values(resources)) r.amount = Math.floor(r.amount);
    return { resources, fleet: Object.fromEntries(ships.map(id => [id, { parked: 0, away: 0, building: 0 }])), queue: { buildings: raw.economy.queue.length, ships: raw.shipyard.queue.length }, energy: raw.economy.energyCap - raw.economy.energyUsed };
  }, document: { hidden: false, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} }, canNavigate: () => allowed });
  const calls = [], intermediate = [];
  const adapter = { ...native, canNavigate: () => allowed, async selectSystem(id) { calls.push(id); current = id; return true; } };
  let planner = input => navigation({ ...input, policy: policy() });
  const app = runtime.create({ core, adapter, now: () => clock, read() { if (readError) throw new Error('storage'); return config; }, write: (_, v) => { config = v; }, planNavigation: input => planner(input) });
  const tick = () => app.update({ scope: S });
  return { app, adapter, calls, intermediate, context, tick, get source() { return source; }, set source(value) { source = value; }, get current() { return current; }, set current(value) { current = value; },
    get config() { return config; }, set config(value) { config = value; }, set allowed(value) { allowed = value; }, set readError(value) { readError = value; }, set planner(value) { planner = value; },
    advance(ms) { clock += ms; }, revision() { source.revision++; source.observedAt = clock; }, get clock() { return clock; },
    ready(ids = source.systems.map(x => x.id)) { for (const raw of source.systems) if (ids.includes(raw.id)) raw.buildings[0].nextUpgrade.paCost = raw.buildings[0].nextUpgrade.irCost = 50; source.revision++; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('installed adapter/runtime filter rests when all idle and wakes on a fresh useful census', async () => {
  const h = harness(); assert.equal(h.tick().ready, true); h.advance(5001); h.tick(); await settle(); assert.deepEqual(h.calls, []); assert.match(h.app.state().status, /al día/);
  h.ready([B]); h.tick(); await settle(); assert.deepEqual(h.calls, [B]); assert.equal(h.current, B); assert.equal(h.tick().ready, true);
});
test('adapter work facts are exact and changed facts in an unchanged revision poison the census', () => {
  const h = harness(); const first = h.adapter.readBundle(); assert.equal(first.work.systems[0].buildings[0].upgrade.palladium, 500); assert.equal(first.work.systems[0].buildingSlots, 2);
  h.source.systems[0].buildings[0].nextUpgrade.paCost = 50; assert.equal(h.adapter.readBundle(), null);
  h.revision(); assert.equal(h.adapter.readBundle().work.systems[0].buildings[0].upgrade.palladium, 50);
});
test('stale, disconnected and incomplete censuses stop filtering/navigation and reconnect cleanly', async () => {
  for (const invalidate of [h => h.advance(120001), h => { h.source.connected = false; }, h => { h.source.complete = false; }]) {
    const h = harness(); h.ready([B]); h.tick(); invalidate(h); assert.equal(h.tick().ready, false); await settle(); assert.deepEqual(h.calls, []);
    h.source.connected = true; h.source.complete = true; h.source.epoch++; h.revision(); h.tick(); await settle(); assert.deepEqual(h.calls, [B]);
  }
});
test('unknown or inconsistent advisory results fall back to fair rotation rather than suppressing work', async () => {
  for (const result of [null, { scope: S, censusId: 'wrong', observedAt: TIME, eligibleSystemIds: [] }, { scope: S, censusId: 'native:1:1:0', observedAt: TIME, eligibleSystemIds: [C] }]) {
    const h = harness(); h.planner = () => result; h.tick(); h.advance(5001); h.tick(); await settle(); assert.deepEqual(h.calls, [B]);
  }
});

test('fresh advisory census can revoke a formerly useful target before navigation starts', async () => {
  const h = harness(); h.ready([B]); h.tick();
  h.source.systems[1].buildings[0].nextUpgrade.paCost = h.source.systems[1].buildings[0].nextUpgrade.irCost = 500;
  h.revision(); await settle(); assert.deepEqual(h.calls, []); assert.equal(h.app.state().manualHold, false);
});
test('explicit system exclusions beat advisory usefulness and never restore action authority', async () => {
  const h = harness(); h.ready([B]); h.config = core.normalizeConfig({ enabled: true, systems: { [B]: { enabled: false } } });
  h.tick(); h.advance(5001); h.tick(); await settle(); assert.deepEqual(h.calls, []);
  h.current = B; h.tick(); assert.equal(h.app.canAct(h.context()), false);
});
test('storage policy changes before selection microtask revoke disable/exclusion/role/target edits', async () => {
  for (const change of [c => ({ ...c, enabled: false }), c => ({ ...c, systems: { [B]: { enabled: false } } }), c => ({ ...c, systems: { [B]: { role: 'industry' } } }), c => ({ ...c, fleetTargets: { probe: 10 } })]) {
    const h = harness(); h.ready([B]); h.tick(); h.config = change(h.config); await settle(); assert.deepEqual(h.calls, []); assert.equal(h.app.state().manualHold, false);
  }
});
test('storage read failure and manual pause before selection retain zero navigation effects', async () => {
  for (const stop of [h => { h.readError = true; }, h => { h.allowed = false; }, h => h.app.suspendInteraction()]) {
    const h = harness(); h.ready([B]); h.tick(); stop(h); await settle(); assert.deepEqual(h.calls, []); assert.equal(h.app.canAct(h.context()), false);
  }
});
test('next traversal intermediates do not consume useful fair turns or gain action authority', async () => {
  const h = harness([A, B, C]); h.ready(); const nativeCycle = [A, C, B];
  h.adapter.selectSystem = async id => { h.calls.push(id); while (h.current !== id) { h.current = nativeCycle[(nativeCycle.indexOf(h.current) + 1) % nativeCycle.length]; h.advance(100); h.intermediate.push(h.current); h.tick(); assert.equal(h.app.canAct(h.context()), false); } return true; };
  h.tick(); h.advance(5001); h.tick(); await settle(); h.tick(); assert.deepEqual(h.calls, [B]); assert.deepEqual(h.intermediate, [C, B]);
  h.advance(5001); h.tick(); await settle(); h.tick(); assert.deepEqual(h.calls, [B, C]);
  h.advance(5001); h.tick(); await settle(); h.tick(); assert.deepEqual(h.calls, [B, C, A]);
});

function installedCallback({ jobs = [], retries = { enabled: false, campaigns: [] }, settings = policy() } = {}) {
  const start = text.indexOf('        planNavigation: input => {');
  const end = text.indexOf('\n        read: key =>', start);
  assert.ok(start > 0 && end > start);
  const callback = text.slice(start + '        planNavigation: '.length, end).trim().replace(/,$/, '');
  return vm.runInNewContext('(' + callback + ')', { navigationPlanner: navigation, fleetWait: { list: () => jobs }, attackRetry: { exportConfig: () => retries }, settings, depotPrioritySystem: null });
}
test('actual installed callback retains rotation for coordinate-only retry origins', () => {
  const input = fixture(); input.plan.summary.allocationsBySystem[A].probe = 0;
  const settings = { ...policy(), excluded: ['command_center'] };
  for (const status of ['waiting_origin', 'waiting_slot', 'queued']) {
    const callback = installedCallback({ settings, retries: { enabled: true, campaigns: [{ scope: S, originId: null, originCoordinate: { q: 1, r: 0 }, status }] } });
    assert.equal(callback(input), null);
  }
});
test('actual installed callback keeps known origins but ignores foreign or inactive campaigns', () => {
  const input = fixture(); input.plan.summary.allocationsBySystem[A].probe = 0;
  const settings = { ...policy(), excluded: ['command_center'] };
  assert.deepEqual([...installedCallback({ settings, jobs: [{ scope: S, originId: A, status: 'waiting' }] })(input).eligibleSystemIds], [A]);
  assert.deepEqual([...installedCallback({ settings, retries: { enabled: true, campaigns: [{ scope: S, originId: A, status: 'waiting_origin' }] } })(input).eligibleSystemIds], [A]);
  for (const campaign of [{ scope: 'other/player', originId: null, status: 'waiting_origin' }, { scope: S, originId: null, status: 'paused' }]) {
    assert.deepEqual([...installedCallback({ settings, retries: { enabled: true, campaigns: [campaign] } })(input).eligibleSystemIds], []);
  }
});

// Integration boundary: the advisory visit filter must use the same deficit
// decision as the final selector/ETA without granting an order or reservation.
function deficitFixture() {
  const input = fixture(); input.policy.order = ['reactor', 'command_center'];
  input.plan.summary.allocationsBySystem[A].probe = 0; input.snapshots[0].energy = -1;
  input.work.systems[0].buildings = [
    { id: 'reactor', level: 12, requirementMet: true, upgrade: { palladium: 50, iridium: 50, energy: 57 } },
    { id: 'command_center', level: 15, requirementMet: true, upgrade: { palladium: 500, iridium: 500, energy: -4 } },
  ];
  return input;
}
test('integrated filter retains affordable deficit Reactor without another affordable consumer', () => {
  const input = deficitFixture(), before = JSON.stringify(input);
  const { structure } = realSnapshots(input);
  assert.equal(upgradeEta.estimate(structure).buildingId, 'reactor');
  assert.equal(upgradeEta.estimate(structure).state, 'ready');
  assert.deepEqual(eligible(input), [A]); assert.equal(JSON.stringify(input), before);
});
test('integrated deficit filter respects nonnegative energy exclusions queued Reactor and unknown data', () => {
  for (const change of [i => { i.snapshots[0].energy = 0; }, i => { i.snapshots[0].energy = 1; },
    i => { i.policy.excluded = ['reactor']; }, i => { i.policy.order = ['command_center']; },
    i => { i.work.systems[0].buildings[0].requirementMet = false; },
    i => { i.work.systems[0].buildings[0].upgrade = null; },
    i => { i.work.systems[0].buildingQueue = [{ type: 'reactor', targetLevel: 13, completesAt: TIME + 1000 }]; }]) {
    const input = deficitFixture(); change(input); assert.deepEqual(eligible(input), [], String(change));
  }
  for (const change of [i => { i.snapshots[0].energy = null; }, i => { i.work.systems[0].buildings[0].upgrade.energy = 0; }]) {
    const unknown = deficitFixture(); change(unknown);
    assert.deepEqual(eligible(unknown), [A], 'Unknown native facts preserve a visit, never an order');
  }
});
test('integrated deficit filter wakes at resource threshold and rechecks nominal queue completion', () => {
  const input = deficitFixture(); for (const r of Object.values(input.snapshots[0].resources)) r.amount = 40;
  assert.deepEqual(eligible(input), []); input.now += 59999; assert.deepEqual(eligible(input), []);
  input.now++; assert.deepEqual(eligible(input), [A]);
  const queued = deficitFixture(); queued.work.systems[0].buildingQueue = [{ type: 'reactor', targetLevel: 13, completesAt: TIME + 1000 }];
  assert.deepEqual(eligible(queued), []); queued.now += 1000; assert.deepEqual(eligible(queued), [A]);
});
test('integrated deficit filter preserves every role and marked building policy', () => {
  for (const role of ['balanced', 'industry', 'shipyard', 'defense']) {
    const input = deficitFixture(); input.config.systems[A] = { role, enabled: true };
    for (const id of ['palladium_extractor', 'iridium_extractor', 'warehouse', 'shipyard', 'trade_hub']) {
      input.work.systems[0].buildings.push({ id, level: 1, requirementMet: true, upgrade: null });
    }
    assert.deepEqual(eligible(input), [A], role);
    input.policy.excluded = ['reactor']; assert.deepEqual(eligible(input), [], role);
    input.policy.excluded = []; input.config.systems[A].enabled = false; assert.deepEqual(eligible(input), [], role);
  }
});
test('integrated deficit filter cannot divert a retained energy-neutral Depot reservation', () => {
  const input = deficitFixture(); input.policy.order = ['reactor', 'warehouse']; input.policy.retainedDepotId = A;
  input.work.systems[0].buildings[1] = { id: 'warehouse', level: 1, requirementMet: true,
    upgrade: { palladium: 200, iridium: 200, energy: 0 } };
  const { structure, fleet } = realSnapshots(input); fleet.active = false;
  const reserved = infrastructurePriority.select(structure, fleet, true);
  assert.equal(reserved.reserve, true); assert.equal(reserved.forecast.state, 'waiting');
  assert.equal(reserved.forecast.buildingId, 'warehouse'); assert.deepEqual(eligible(input), []);
});
test('integrated deficit advisory eligibility never relaxes strict fleet reservation', () => {
  const input = deficitFixture(); input.plan.summary.allocationsBySystem[A].probe = 1;
  const { structure, fleet } = realSnapshots(input), before = JSON.stringify({ input, structure, fleet });
  assert.equal(upgradeEta.estimate(structure).state, 'ready'); assert.deepEqual(eligible(input), [A]);
  const plan = fleetPriority.select(fleet); assert.equal(plan.reserve, true);
  assert.equal(fleetPriority.estimate(fleet, plan).state, 'waiting');
  assert.equal(fleetPriority.select({ ...fleet, docksFull: true }).reserve, false);
  assert.equal(JSON.stringify({ input, structure, fleet }), before);
});
test('integrated fresh energy revision cancels a pending deficit visit then restores it when needed', async () => {
  const h = harness();
  for (const raw of h.source.systems) {
    raw.buildings = [{ type: 'reactor', level: 12, nextUpgrade: { paCost: 50, irCost: 50, energyDelta: 57 } }];
    raw.economy.energyUsed = raw.id === B ? 101 : 100;
  }
  h.planner = input => navigation({ ...input, policy: { ...policy(), order: ['reactor'] } });
  h.tick(); h.source.systems[1].economy.energyUsed = 100; h.revision();
  await settle(); assert.deepEqual(h.calls, []); assert.equal(h.app.state().manualHold, false);
  h.tick(); assert.deepEqual(h.calls, []);
  h.source.systems[1].economy.energyUsed = 101; h.revision(); h.tick(); await settle();
  assert.deepEqual(h.calls, [B]); assert.equal(h.tick().ready, true);
});
test('integrated terminal Reactor blockers stay known and do not cause perpetual deficit visits', () => {
  for (const blocker of ['maxed', 'locked']) {
    const input = deficitFixture(); input.policy.order = ['reactor'];
    const row = input.work.systems[0].buildings[0];
    if (blocker === 'maxed') row.upgrade = null;
    else row.requirementMet = false;
    const structure = { energy: -1, resources: input.snapshots[0].resources, order: ['reactor'], excluded: [],
      buildings: [{ id: 'reactor', name: 'Reactor', visible: true, targetLevel: 13, blocker,
        cost: { palladium: 0, iridium: 0 }, energy: 0 }], queue: { full: false, buildings: {} } };
    const forecast = upgradeEta.estimate(structure);
    assert.equal(forecast.state, 'blocked'); assert.equal(forecast.reason, blocker);
    assert.deepEqual(eligible(input), []);
  }
});
