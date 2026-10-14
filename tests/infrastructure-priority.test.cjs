'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
function extract(marker) {
  const start = source.indexOf('// BEGIN ' + marker);
  const end = source.indexOf('// END ' + marker, start);
  assert.ok(start >= 0 && end > start, 'Missing ' + marker);
  return source.slice(start, end);
}
const planner = vm.runInNewContext(extract('UPGRADE ETA ESTIMATOR') + '\n' + extract('INFRASTRUCTURE PRIORITY PLANNER')
  + '\ncreateInfrastructurePriorityPlanner(createUpgradeEtaEstimator());');
const minute = 60000;
function row(id, extra = {}) {
  return { id, name: id === 'warehouse' ? 'Resource Depot' : id === 'reactor' ? 'Reactor' : id,
    targetLevel: 14, visible: true, blocker: 'ready', energy: id === 'reactor' ? 57 : -3,
    cost: { palladium: id === 'reactor' ? 23000 : 23800, iridium: id === 'reactor' ? 23000 : 23800 }, ...extra };
}
function snapshot(extra = {}) {
  const buildings = extra.buildings || [row('command_center'), row('warehouse'), row('reactor')];
  return { buildings, order: buildings.map(item => item.id), excluded: [], energy: 10, depotFillPercent: 90,
    resources: { palladium: { amount: 61400, cap: 62600, rate: 277.2 }, iridium: { amount: 60700, cap: 62600, rate: 277.2 } },
    queue: { full: false, waitMs: null, buildings: {} }, ...extra };
}
function fleet(extra = {}) {
  return { active: true, contextReady: true,
    ships: [{ id: 'sentinel', name: 'Sentinel', deficit: 12, blocker: 'queue', unitCost: { palladium: 100, iridium: 100 } }],
    queue: { full: true, waitMs: 448 * minute }, ...extra };
}
function low(extra = {}) {
  return snapshot({ resources: { palladium: { amount: 30000, cap: 62600, rate: 277.2 },
    iridium: { amount: 30000, cap: 62600, rate: 277.2 } }, ...extra });
}
function expectTarget(input, id, ms = 0, ships = fleet(), retained = false) {
  const plan = planner.select(input, ships, retained);
  assert.equal(plan.reserve, true, plan.notice);
  assert.equal(plan.needed, true);
  assert.equal(plan.forecast.buildingId, id, plan.forecast.detail);
  assert.equal(plan.forecast.state, ms > 0 ? 'waiting' : 'ready', plan.forecast.detail);
  assert.ok(Math.abs(plan.forecast.waitMs - ms) < 0.01, plan.forecast.detail);
  return plan;
}
test('screenshot: Reactor precedes Sentinel x12 with 2 energy and Depot consuming 3', () => {
  const plan = expectTarget(snapshot({ energy: 2 }), 'reactor');
  assert.match(plan.forecast.detail, /Resource Depot/);
  assert.match(plan.forecast.detail, /98/);
});
test('an urgent Depot precedes affordable ships as well as a full seven-hour ship queue', () => {
  expectTarget(snapshot(), 'warehouse');
  expectTarget(snapshot(), 'warehouse', 0, fleet({ ships: [{ ...fleet().ships[0], blocker: 'ready' }], queue: { full: false } }));
});
test('the urgent Depot ignores its low position in building priorities', () => {
  expectTarget(snapshot({ order: ['command_center', 'reactor', 'warehouse'] }), 'warehouse');
});
test('existing energy debt cannot divert a zero-energy urgent Depot reservation to Reactor', () => {
  for (const cost of [23800, 80000]) {
    const input = snapshot({ energy: -1, buildings: [row('warehouse', { energy: 0,
      cost: { palladium: cost, iridium: cost } }), row('reactor')] });
    input.resources.palladium.cap = input.resources.iridium.cap = 100000;
    input.resources.palladium.amount = 95000;
    const expectedWait = Math.max(0, cost - input.resources.iridium.amount) / 277.2 * minute;
    expectTarget(input, 'warehouse', expectedWait);
  }
});
test('normal fleet priority is preserved below the threshold with no capacity blocker', () => {
  const plan = planner.select(low(), fleet());
  assert.equal(plan.reserve, false);
  assert.equal(plan.needed, false);
});
test('an oversized enabled building triggers Depot even below the fill threshold', () => {
  expectTarget(low({ buildings: [row('warehouse'), row('reactor'), row('command_center', {
    blocker: 'capacity', cost: { palladium: 78700, iridium: 50000 } })] }), 'warehouse');
});
test('an excluded or locked building cannot justify a capacity-driven Depot upgrade', () => {
  const input = low({ buildings: [row('warehouse'), row('reactor'), row('command_center', {
    blocker: 'capacity', cost: { palladium: 78700, iridium: 50000 } })] });
  input.excluded = ['command_center'];
  assert.equal(planner.select(input, fleet()).reserve, false);
  input.excluded = [];
  input.buildings[2].blocker = 'locked';
  assert.equal(planner.select(input, fleet()).reserve, false);
});
test('an oversized Reactor alone is not demand for storage', () => {
  const input = low({ buildings: [row('warehouse'), row('reactor', { cost: { palladium: 100000, iridium: 100000 } })] });
  assert.equal(planner.select(input, fleet()).reserve, false);
});
test('a demanded single ship exceeding capacity triggers Depot, not the whole deficit cost', () => {
  const ships = fleet();
  ships.ships[0].unitCost.palladium = 70000;
  expectTarget(low(), 'warehouse', 0, ships);
  ships.ships[0].unitCost.palladium = 100;
  ships.ships[0].deficit = 100000;
  assert.equal(planner.select(low(), ships).reserve, false);
});
for (const change of [{ active: false }, { contextReady: false }, { ships: [{ ...fleet().ships[0], deficit: 0, unitCost: { palladium: 70000, iridium: 1 } }] }]) {
  test('inactive, unknown-context, or covered fleet demand does not trigger storage: ' + JSON.stringify(change), () => {
    const ships = fleet(change);
    if (change.ships === undefined) ships.ships[0].unitCost.palladium = 70000;
    assert.equal(planner.select(low(), ships).reserve, false);
  });
}
test('the energy prerequisite remains reserved after Reactor spending lowers storage fill', () => {
  const input = low({ energy: 2, queue: { full: false, buildings: { reactor: true } } });
  const plan = planner.select(input, fleet(), true);
  assert.equal(plan.reserve, true);
  assert.equal(plan.forecast.state, 'blocked');
  assert.equal(plan.forecast.reason, 'energy');
  assert.match(plan.forecast.detail, /Reactor en cola/);
  input.energy = 59;
  input.queue.buildings = {};
  expectTarget(input, 'warehouse', 0, fleet(), true);
});
test('an already queued Depot releases reservation and clears the infrastructure intent', () => {
  const plan = planner.select(snapshot({ queue: { full: false, buildings: { warehouse: true } } }), fleet(), true);
  assert.equal(plan.reserve, false);
  assert.equal(plan.needed, false);
});
test('excluded Depot is never automatically re-enabled or built', () => {
  const input = snapshot({ excluded: ['warehouse'] });
  const plan = planner.select(input, fleet(), true);
  assert.equal(plan.reserve, false);
  assert.equal(plan.needed, false);
  assert.deepEqual(input.excluded, ['warehouse']);
});
test('excluded necessary Reactor is explained rather than silently freezing all activity', () => {
  const plan = planner.select(snapshot({ energy: 2, excluded: ['reactor'] }), fleet());
  assert.equal(plan.reserve, false);
  assert.match(plan.notice, /Reactor.*desmarcado/);
});
test('a queued necessary Reactor remains usable as a dependency even if its checkbox is now off', () => {
  const plan = planner.select(snapshot({ energy: 2, excluded: ['reactor'], queue: { buildings: { reactor: true } } }), fleet());
  assert.equal(plan.reserve, true);
  assert.equal(plan.forecast.reason, 'energy');
});
for (const blocker of ['locked', 'maxed', 'error', 'unknown']) {
  test('a hard-blocked Depot does not hold fleet resources indefinitely: ' + blocker, () => {
    const plan = planner.select(snapshot({ buildings: [row('warehouse', { blocker }), row('reactor')] }), fleet());
    assert.equal(plan.reserve, false);
    assert.ok(plan.notice);
  });
}
test('an unaffordable critical Depot saves resources before producing more ships', () => {
  const input = snapshot();
  input.resources.iridium.amount = 10000;
  expectTarget(input, 'warehouse', (23800 - 10000) / 277.2 * minute);
});
test('a cheaper necessary Reactor may start before the Depot itself is affordable', () => {
  const input = snapshot({ energy: 2 });
  input.resources.iridium.amount = 23200;
  expectTarget(input, 'reactor');
});
test('infrastructure waits for its own building queue, never the ship queue', () => {
  expectTarget(snapshot({ queue: { full: true, waitMs: 2 * minute, buildings: {} } }), 'warehouse', 2 * minute);
});
test('an unknown building queue ETA does not claim an action is ready', () => {
  const plan = planner.select(snapshot({ queue: { full: true, waitMs: null, buildings: {} } }), fleet());
  assert.equal(plan.reserve, true);
  assert.equal(plan.forecast.state, 'blocked');
  assert.equal(plan.forecast.waitMs, null);
});
test('Depot cost above its own capacity is an explained hard blocker', () => {
  const plan = planner.select(snapshot({ buildings: [row('warehouse', { cost: { palladium: 90000, iridium: 23800 } }), row('reactor')] }), fleet());
  assert.equal(plan.reserve, false);
  assert.match(plan.notice, /capacidad/);
});
test('unknown energy does not produce a ready infrastructure action', () => {
  const plan = planner.select(snapshot({ energy: null }), fleet());
  assert.equal(plan.reserve, true);
  assert.equal(plan.forecast.state, 'blocked');
  assert.equal(plan.forecast.waitMs, null);
});
test('custom fill threshold and either resource are respected', () => {
  const input = low({ depotFillPercent: 95 });
  input.resources.iridium.amount = 59000;
  assert.equal(planner.select(input, fleet()).reserve, false);
  input.resources.iridium.amount = 60000;
  expectTarget(input, 'warehouse');
});
test('forecast is read-only and preserves user priority, exclusions and resource data', () => {
  const input = snapshot({ energy: 2 });
  const ships = fleet();
  const before = JSON.stringify({ input, ships });
  const freeze = value => { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); };
  freeze(input); freeze(ships);
  expectTarget(input, 'reactor', 0, ships);
  expectTarget(input, 'reactor', 0, ships);
  assert.equal(JSON.stringify({ input, ships }), before);
});
