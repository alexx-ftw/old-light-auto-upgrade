'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../docs/empire-core.js');

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const SCOPE = 'galaxy:1/player:42';
const NOW = 1000000;
const clone = value => JSON.parse(JSON.stringify(value));
const transit = (patch = {}) => ({ scope: SCOPE, censusId: 'verified-response:123', observedAt: NOW, ships: Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, 0])), ...patch });
const options = (patch = {}) => ({ scope: SCOPE, now: NOW, expectedIds: [A, B], transitCensus: transit(), ...patch });
const config = (patch = {}) => ({ enabled: true, fleetTargets: { probe: 10 }, systems: {}, ...patch });
function row(systemId, patch = {}) {
  return {
    scope: SCOPE, systemId, name: systemId.slice(0, 1), owned: true, observedAt: NOW, censusId: 'verified-response:123',
    resources: { palladium: { amount: 1000, cap: 2000, rate: 10 }, iridium: { amount: 500, cap: 1000, rate: 5 } },
    fleet: Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, { parked: 0, away: 0, building: 0 }])),
    queue: { buildings: 0, ships: 0 }, energy: 20, ...patch,
  };
}
function localOrders(plan, rows, ship = 'probe') {
  return Object.entries(plan.targetsBySystem).reduce((total, [id, target]) => {
    const fleet = rows.find(row => row.systemId === id).fleet[ship];
    return total + Math.max(0, target.shipMinimums[ship] - fleet.parked - fleet.away - fleet.building);
  }, 0);
}

test('UMD is standalone, frozen, and available through the browser global', () => {
  assert.equal(global.OldLightEmpireCore, core);
  assert.equal(Object.isFrozen(core), true);
  assert.equal(Object.isFrozen(core.DEFAULT_SHIPS), true);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/empire-core.js'), 'utf8'), context);
  assert.equal(typeof context.OldLightEmpireCore.plan, 'function');
});

test('configuration defaults off, bounds targets, validates roles and IDs', () => {
  assert.deepEqual(core.normalizeConfig(null), { schemaVersion: 1, enabled: false, fleetTargets: { probe: 0, marauder: 0, sentinel: 0, vanguard: 0 }, systems: {} });
  const result = core.normalizeConfig({ enabled: true, fleetTargets: { probe: 1.9, marauder: Infinity, sentinel: -5, vanguard: 5e6 }, systems: { [A.toUpperCase()]: { role: 'unknown' }, invalid: { enabled: true }, [B]: { role: 'industry', enabled: false } } });
  assert.equal(result.enabled, true);
  assert.deepEqual(result.fleetTargets, { probe: 1, marauder: 0, sentinel: 0, vanguard: 1000000 });
  assert.deepEqual(result.systems[A], { name: '', role: 'balanced', enabled: true });
  assert.deepEqual(result.systems[B], { name: '', role: 'industry', enabled: false });
  assert.equal(Object.keys(result.systems).length, 2);
  assert.equal(core.normalizeConfig({ schemaVersion: 2, enabled: true }).enabled, false);
});

test('normalizers do not coerce strings, execute getters, or mutate inputs', () => {
  let called = false;
  const input = config();
  Object.defineProperty(input, 'enabled', { get() { called = true; throw Error('getter'); } });
  assert.equal(core.normalizeConfig(input).enabled, false);
  assert.equal(called, false);
  assert.equal(core.normalizeConfig(config({ fleetTargets: { probe: '100' } })).fleetTargets.probe, 0);
  const source = row(A);
  source.fleet.probe.parked = '3';
  source.resources.iridium.amount = null;
  source.energy = NaN;
  const normalized = core.normalizeSnapshot(source);
  assert.equal(normalized.fleet.probe.parked, null);
  assert.equal(normalized.resources.iridium.amount, null);
  assert.equal(normalized.energy, null);
  assert.equal(source.fleet.probe.parked, '3');
});

test('snapshot identity, timestamp and explicit ownership are required', () => {
  for (const patch of [{ systemId: 'A' }, { scope: '' }, { owned: undefined }, { owned: 1 }, { observedAt: -1 }, { observedAt: 1.5 }, { observedAt: '100' }]) {
    assert.equal(core.normalizeSnapshot(row(A, patch)), null);
  }
  assert.equal(core.normalizeSnapshot(row(A, { owned: false })).owned, false);
  assert.equal(core.normalizeSnapshot(row(A.toUpperCase())).systemId, A);
});

test('global deficit is split once rather than duplicated at every star', () => {
  const rows = [row(A), row(B)];
  const result = core.plan(config(), rows, options());
  assert.equal(result.complete, true);
  assert.equal(result.reason, 'ready');
  assert.equal(result.targetsBySystem[A].shipMinimums.probe, 5);
  assert.equal(result.targetsBySystem[B].shipMinimums.probe, 5);
  assert.equal(localOrders(result, rows), 10);
  assert.deepEqual(result.summary.deficits, { probe: 10, marauder: 0, sentinel: 0, vanguard: 0 });
});

test('parked, transit and building each count once with correct local engine baseline', () => {
  const rows = [row(A), row(B)];
  rows[0].fleet.probe = { parked: 1, away: 2, building: 3 };
  rows[1].fleet.probe = { parked: 1, away: 0, building: 0 };
  const opts = options({ transitCensus: transit({ ships: { probe: 2, marauder: 0, sentinel: 0, vanguard: 0 } }) });
  const data = core.aggregate(rows, opts);
  assert.deepEqual(data.totals.fleet.probe, { parked: 2, away: 2, building: 3, transit: 2, total: 7 });
  const result = core.plan(config(), rows, opts);
  assert.equal(result.summary.deficits.probe, 3);
  assert.equal(localOrders(result, rows), 3);
  assert.equal(result.targetsBySystem[A].shipMinimums.probe, 8);
  assert.equal(result.targetsBySystem[B].shipMinimums.probe, 2);
});

test('construction-only baseline does not subtract construction twice', () => {
  const rows = [row(A)];
  rows[0].fleet.probe.building = 3;
  const result = core.plan(config(), rows, options({ expectedIds: [A] }));
  assert.equal(result.summary.deficits.probe, 7);
  assert.equal(result.targetsBySystem[A].shipMinimums.probe, 10);
  assert.equal(localOrders(result, rows), 7);
});

test('all four classes have independent global goals', () => {
  const rows = [row(A), row(B)];
  rows[0].fleet.sentinel.away = 2;
  const goals = { probe: 3, marauder: 7, sentinel: 11, vanguard: 1 };
  const result = core.plan(config({ fleetTargets: goals }), rows, options({ transitCensus: transit({ ships: { probe: 0, marauder: 0, sentinel: 2, vanguard: 0 } }) }));
  for (const ship of core.DEFAULT_SHIPS) assert.equal(localOrders(result, rows, ship), goals[ship] - (ship === 'sentinel' ? 2 : 0));
});

test('a lowered or already met goal never creates negative orders or dismantling', () => {
  const rows = [row(A), row(B)];
  rows[0].fleet.probe.parked = 20;
  const result = core.plan(config(), rows, options());
  assert.equal(result.reason, 'targets-met');
  assert.equal(localOrders(result, rows), 0);
  assert.equal(result.targetsBySystem[A].shipMinimums.probe, 20);
  assert.equal(core.plan(config({ fleetTargets: { probe: 25 } }), rows, options()).summary.deficits.probe, 5);
  assert.equal(core.plan(config({ fleetTargets: { probe: 0 } }), rows, options()).summary.deficits.probe, 0);
});

test('scope mixing cannot contribute resources, ships or authority', () => {
  const foreign = row(B, { scope: 'galaxy:2/player:42' });
  foreign.fleet.probe.parked = 10000;
  const result = core.plan(config(), [row(A), foreign], options());
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'missing-snapshots');
  assert.deepEqual(result.targetsBySystem, {});
  assert.equal(result.summary.totals.fleet.probe.total, 0);
  const data = core.aggregate([row(A), row(B), foreign], options());
  assert.equal(data.complete, true);
  assert.equal(data.totals.resources.palladium.amount, 2000);
});

test('missing, stale, future and malformed current-roster snapshots fail closed', () => {
  const cases = [
    { rows: [row(A)], reason: 'missing-snapshots' },
    { rows: [row(A), row(B, { observedAt: NOW - 120001 })], reason: 'stale-snapshots' },
    { rows: [row(A), row(B, { observedAt: NOW + 1 })], reason: 'stale-snapshots' },
    { rows: [row(A), row(B, { observedAt: '100' })], reason: 'invalid-snapshots' },
    { rows: [row(A), row(B, { owned: false })], reason: 'unverified-ownership' },
    { rows: [row(A), row(B), { scope: SCOPE, systemId: 'bad' }], reason: 'malformed-snapshots' },
  ];
  for (const { rows, reason } of cases) {
    const result = core.plan(config(), rows, options());
    assert.equal(result.complete, false, reason);
    assert.equal(result.reason, reason);
    assert.deepEqual(result.targetsBySystem, {});
  }
});

test('freshness boundary is inclusive and uses caller-supplied time', () => {
  const rows = [row(A), row(B, { observedAt: NOW - 120000 })];
  assert.equal(core.aggregate(rows, options()).complete, true);
  assert.equal(core.aggregate(rows, options({ now: NOW + 1 })).complete, false);
  assert.equal(core.aggregate(rows, options({ maxAgeMs: 120001, now: NOW + 1 })).complete, true);
  assert.equal(core.aggregate(rows, options({ now: undefined })).reason, 'invalid-context');
  assert.equal(core.aggregate(rows, options({ maxAgeMs: -1 })).reason, 'invalid-context');
});

test('duplicate UUIDs are rejected entirely, even with different ages or casing', () => {
  const rows = [row(A), row(A.toUpperCase(), { observedAt: 1 }), row(B)];
  rows[0].fleet.probe.parked = 20;
  const data = core.aggregate(rows, options());
  assert.equal(data.reason, 'duplicate-snapshots');
  assert.deepEqual(data.duplicateIds, [A]);
  assert.equal(data.totals.fleet.probe.total, 0);
  assert.deepEqual(core.plan(config(), rows, options()).targetsBySystem, {});
});

test('unknown numbers remain null and block all allocations', () => {
  const edits = [
    value => { value.fleet.probe.parked = null; },
    value => { value.fleet.vanguard.away = undefined; },
    value => { value.fleet.marauder.building = -1; },
    value => { value.fleet.sentinel.parked = 0.5; },
    value => { value.resources.iridium.amount = null; },
    value => { value.resources.palladium.cap = Infinity; },
    value => { value.resources.palladium.rate = undefined; },
    value => { value.queue.ships = null; },
    value => { value.queue.buildings = '0'; },
    value => { value.energy = null; },
  ];
  for (const edit of edits) {
    const rows = [row(A), row(B)];
    edit(rows[1]);
    const result = core.plan(config(), rows, options());
    assert.equal(result.reason, 'unknown-measurements');
    assert.equal(result.complete, false);
    assert.deepEqual(result.targetsBySystem, {});
  }
  const rows = [row(A), row(B)];
  rows[1].fleet.probe.away = null;
  assert.equal(core.aggregate(rows, options()).totals.fleet.probe.away, null);
  assert.equal(core.aggregate(rows, options()).totals.fleet.probe.total, 0);
  assert.equal(core.aggregate(rows, options()).fleetComplete, false);
  assert.equal(core.aggregate(rows, options()).totals.fleet.probe.parked, 0);
});

test('numeric overflow fails closed rather than rounding totals or assigning extra ships', () => {
  const rows = [row(A), row(B)];
  rows[0].fleet.probe.parked = Number.MAX_SAFE_INTEGER;
  rows[1].fleet.probe.parked = 1;
  assert.equal(core.aggregate(rows, options()).totals.fleet.probe.total, null);
  assert.equal(core.plan(config(), rows, options()).complete, false);
});

test('industry and defense count toward goals but receive no ship orders', () => {
  const rows = [row(A), row(B), row(C)];
  rows[1].fleet.probe.away = 2;
  const result = core.plan(config({ systems: { [A]: { role: 'shipyard' }, [B]: { role: 'industry' }, [C]: { role: 'defense' } } }), rows, options({ expectedIds: [A, B, C], transitCensus: transit({ ships: { probe: 2, marauder: 0, sentinel: 0, vanguard: 0 } }) }));
  assert.deepEqual(Object.keys(result.targetsBySystem), [A]);
  assert.equal(result.targetsBySystem[A].shipMinimums.probe, 8);
  assert.equal(localOrders(result, rows), 8);
});

test('no production roles means explicit unallocated deficit and no fallback orders', () => {
  const result = core.plan(config({ systems: { [A]: { role: 'industry' }, [B]: { role: 'defense' } } }), [row(A), row(B)], options());
  assert.equal(result.complete, true);
  assert.equal(result.reason, 'no-production-systems');
  assert.deepEqual(result.targetsBySystem, {});
  assert.equal(result.summary.unallocated.probe, 10);
});

test('disabled owned systems count toward global inventory without receiving orders', () => {
  const rows = [row(A), row(B)];
  rows[1].fleet.probe.parked = 3;
  const result = core.plan(config({ systems: { [B]: { enabled: false } } }), rows, options({ activeSystemId: B }));
  assert.deepEqual(Object.keys(result.targetsBySystem), [A]);
  assert.equal(result.targetsBySystem[A].shipMinimums.probe, 7);
  assert.equal(result.nextSystemId, A);
});

test('new roster-owned systems default to balanced, stale config-only IDs never participate', () => {
  const result = core.plan(config({ systems: { [C]: { role: 'shipyard' } } }), [row(A), row(B), row(C)], options());
  assert.deepEqual(Object.keys(result.targetsBySystem), [A, B]);
  assert.equal(core.aggregate([row(A), row(B), row(C)], options()).unknownIds[0], C);
  assert.equal(result.summary.totals.resources.palladium.amount, 2000);
});

test('an absent or empty verified registry never enables automatic allocations or cycling', () => {
  for (const expectedIds of [undefined, [], [A, A], ['bad'], [A, null]]) {
    const result = core.plan(config(), [row(A), row(B)], options({ expectedIds }));
    assert.equal(result.complete, false);
    assert.equal(result.reason, 'invalid-roster');
    assert.equal(result.nextSystemId, null);
    assert.deepEqual(result.targetsBySystem, {});
  }
  const empty = core.aggregate([], options({ expectedIds: [] }));
  assert.equal(empty.totals.fleet.probe.total, null);
  assert.equal(empty.totals.resources.palladium.amount, null);
});

test('default-off mode never schedules a visit or creates targets', () => {
  const result = core.plan({}, [row(A), row(B)], options());
  assert.equal(result.reason, 'disabled');
  assert.equal(result.nextSystemId, null);
  assert.deepEqual(result.targetsBySystem, {});
});

test('cycling chooses oldest verified roster system, independent of target completion', () => {
  const rows = [row(A), row(B, { observedAt: NOW - 1000 })];
  const result = core.plan(config({ fleetTargets: {} }), rows, options({ activeSystemId: A }));
  assert.equal(result.reason, 'targets-met');
  assert.equal(result.nextSystemId, B);
  const stale = core.plan(config(), [row(A), row(B, { observedAt: NOW - 120001 })], options());
  assert.equal(stale.complete, false);
  assert.equal(stale.nextSystemId, B);
});

test('cycling keeps active system on observation ties, otherwise uses UUID order', () => {
  const rows = [row(B), row(A)];
  assert.equal(core.plan(config(), rows, options({ activeSystemId: B })).nextSystemId, B);
  assert.equal(core.plan(config(), rows, options()).nextSystemId, A);
  assert.equal(core.plan(config(), [row(A)], options()).nextSystemId, B);
});

test('cycling excludes contradictory ownership, duplicates, invalid snapshots and future observations', () => {
  for (const badRows of [[row(B, { owned: false })], [row(B), row(B)], [row(B, { owned: null })], [row(B, { observedAt: NOW + 1 })]]) {
    assert.equal(core.plan(config(), [row(A), ...badRows], options({ activeSystemId: B })).nextSystemId, A);
  }
});

test('allocation is deterministic, prefers shorter ship queues, and preserves local resources', () => {
  const rows = [row(A), row(B)];
  rows[0].queue.ships = 3;
  rows[0].resources.palladium.amount = 0;
  const before = clone(rows);
  const result = core.plan(config({ fleetTargets: { probe: 3 } }), rows, options());
  assert.equal(result.summary.allocationsBySystem[B].probe, 2);
  assert.equal(result.summary.allocationsBySystem[A].probe, 1);
  assert.deepEqual(core.plan(config({ fleetTargets: { probe: 3 } }), [...rows].reverse(), options()), result);
  assert.deepEqual(rows, before);
  assert.equal('transfers' in result, false);
});

test('configuration duplicate case-variant IDs are disabled instead of silently enabled', () => {
  const value = core.normalizeConfig(config({ systems: { [A]: { enabled: false }, [A.toUpperCase()]: { enabled: true } } }));
  assert.equal(value.systems[A].enabled, false);
});

test('negative net resource rates and energy are known measurements, not missing data', () => {
  const rows = [row(A), row(B, { energy: -10 })];
  rows[0].resources.palladium.rate = -2;
  const result = core.aggregate(rows, options());
  assert.equal(result.complete, true);
  assert.equal(result.totals.energy, 10);
  assert.equal(result.totals.resources.palladium.rate, 8);
});


test('multiple systems require one verified whole-account fleet census before allocating', () => {
  for (const censusId of [undefined, null, '', 'different-response:456']) {
    const rows = [row(A), row(B, { censusId })];
    const data = core.aggregate(rows, options());
    assert.equal(data.complete, true);
    assert.equal(data.fleetComplete, false);
    assert.equal(data.totals.fleet.probe.total, 0);
    const result = core.plan(config(), rows, options());
    assert.equal(result.complete, false);
    assert.equal(result.fleetComplete, false);
    assert.equal(result.reason, 'unsynchronized-fleet');
    assert.deepEqual(result.targetsBySystem, {});
    assert.equal(result.nextSystemId, A);
  }
});

test('single-system planning does not require a cross-system census marker', () => {
  const rows = [row(A, { censusId: null })];
  const result = core.plan(config(), rows, options({ expectedIds: [A], transitCensus: undefined }));
  assert.equal(result.complete, true);
  assert.equal(result.fleetComplete, true);
  assert.equal(localOrders(result, rows), 10);
});

test('transfer-cache overcount and undercount cannot authorize orders without a common census', () => {
  const originBefore = row(A, { censusId: 'before-transfer' });
  const destinationAfter = row(B, { censusId: 'after-transfer' });
  originBefore.fleet.probe.away = 5;
  destinationAfter.fleet.probe.parked = 5;
  const overcount = core.plan(config({ fleetTargets: { probe: 20 } }), [originBefore, destinationAfter], options());
  assert.equal(overcount.summary.totals.fleet.probe.total, 10);
  assert.equal(overcount.reason, 'unsynchronized-fleet');
  assert.deepEqual(overcount.targetsBySystem, {});
  originBefore.fleet.probe.away = 0;
  destinationAfter.fleet.probe.parked = 0;
  const undercount = core.plan(config({ fleetTargets: { probe: 20 } }), [originBefore, destinationAfter], options());
  assert.equal(undercount.reason, 'unsynchronized-fleet');
  assert.deepEqual(undercount.targetsBySystem, {});
});

test('shared per-system census markers alone do not replace an all-self transit census', () => {
  for (const transitCensus of [undefined, null]) {
    const rows = [row(A), row(B)];
    const opts = options({ transitCensus });
    const data = core.aggregate(rows, opts);
    assert.equal(data.complete, true);
    assert.equal(data.fleetComplete, false);
    assert.equal(data.fleetReason, 'missing-transit-census');
    assert.equal(data.fleetTotalSource, 'hud-estimate');
    assert.equal(data.totals.fleet.probe.transit, null);
    const result = core.plan(config(), rows, opts);
    assert.equal(result.reason, 'missing-transit-census');
    assert.equal(result.complete, false);
    assert.deepEqual(result.targetsBySystem, {});
    assert.equal(result.nextSystemId, A);
  }
});

test('friendly transfers omitted from native HUD away still satisfy imperial targets', () => {
  const rows = [row(A), row(B)];
  const opts = options({ transitCensus: transit({ ships: { probe: 10, marauder: 0, sentinel: 0, vanguard: 0 } }) });
  const result = core.plan(config(), rows, opts);
  assert.equal(result.complete, true);
  assert.equal(result.reason, 'targets-met');
  assert.equal(result.summary.totals.fleet.probe.away, 0);
  assert.equal(result.summary.totals.fleet.probe.transit, 10);
  assert.equal(result.summary.totals.fleet.probe.total, 10);
  assert.equal(result.summary.fleetTotalSource, 'transit-census');
  assert.equal(localOrders(result, rows), 0);
});

test('external attack ships present in HUD away and transit census count exactly once', () => {
  const rows = [row(A), row(B)];
  rows[0].fleet.probe.away = 4;
  rows[1].fleet.probe.away = 2;
  const result = core.plan(config(), rows, options({ transitCensus: transit({ ships: { probe: 6, marauder: 0, sentinel: 0, vanguard: 0 } }) }));
  assert.equal(result.summary.totals.fleet.probe.away, 6);
  assert.equal(result.summary.totals.fleet.probe.transit, 6);
  assert.equal(result.summary.totals.fleet.probe.total, 6);
  assert.equal(result.summary.deficits.probe, 4);
  assert.equal(localOrders(result, rows), 4);
});

test('mixed parked, construction, friendly transfers and attacks use global transit exactly once', () => {
  const rows = [row(A), row(B)];
  rows[0].fleet.probe = { parked: 3, away: 2, building: 4 };
  const result = core.plan(config({ fleetTargets: { probe: 20 } }), rows, options({ transitCensus: transit({ ships: { probe: 7, marauder: 0, sentinel: 0, vanguard: 0 } }) }));
  assert.deepEqual(result.summary.totals.fleet.probe, { parked: 3, away: 2, building: 4, transit: 7, total: 14 });
  assert.equal(result.summary.deficits.probe, 6);
  assert.equal(localOrders(result, rows), 6);
  assert.equal(result.targetsBySystem[A].shipMinimums.probe, 12);
  assert.equal(result.targetsBySystem[B].shipMinimums.probe, 3);
});

test('self-owned transit ships remain counted when their origin is no longer in the owned roster', () => {
  const rows = [row(A), row(B), row(C, { owned: false })];
  // Transit census is account-wide, independent of origin or current roster IDs.
  const opts = options({ transitCensus: transit({ ships: { probe: 10, marauder: 1, sentinel: 2, vanguard: 3 } }) });
  const result = core.plan(config(), rows, opts);
  assert.equal(result.complete, true);
  assert.equal(result.reason, 'targets-met');
  assert.equal(result.summary.totals.fleet.probe.total, 10);
  assert.equal(result.summary.totals.fleet.vanguard.total, 3);
  assert.equal(localOrders(result, rows), 0);
  assert.equal(result.targetsBySystem[C], undefined);
});

test('foreign, mismatched, stale and future transit census data fail closed', () => {
  const cases = [
    [transit({ scope: 'galaxy:2/player:42' }), 'foreign-transit-census'],
    [transit({ scope: 'galaxy:1/player:99' }), 'foreign-transit-census'],
    [transit({ censusId: 'different-response' }), 'unsynchronized-transit-census'],
    [transit({ observedAt: NOW - 120001 }), 'stale-transit-census'],
    [transit({ observedAt: NOW + 1 }), 'stale-transit-census'],
  ];
  for (const [transitCensus, reason] of cases) {
    const opts = options({ transitCensus });
    const data = core.aggregate([row(A), row(B)], opts);
    assert.equal(data.complete, true);
    assert.equal(data.fleetComplete, false);
    assert.equal(data.fleetReason, reason);
    assert.equal(data.fleetTotalSource, 'hud-estimate');
    assert.equal(data.transitCensus, null);
    const result = core.plan(config(), [row(A), row(B)], opts);
    assert.equal(result.reason, reason);
    assert.equal(result.complete, false);
    assert.deepEqual(result.targetsBySystem, {});
  }
});

test('transit counts must be explicit exact safe integers for all four ship classes', () => {
  const cases = [
    {}, [], transit({ scope: '' }), transit({ censusId: '' }), transit({ observedAt: '100' }),
    transit({ ships: { probe: 0, marauder: 0, sentinel: 0 } }),
    ...[null, undefined, -1, 1.5, '3', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(probe => transit({ ships: { probe, marauder: 0, sentinel: 0, vanguard: 0 } })),
  ];
  for (const transitCensus of cases) {
    assert.equal(core.normalizeTransitCensus(transitCensus), null);
    const result = core.plan(config(), [row(A), row(B)], options({ transitCensus }));
    assert.equal(result.reason, 'invalid-transit-census');
    assert.equal(result.complete, false);
    assert.deepEqual(result.targetsBySystem, {});
  }
});

test('transit freshness boundary is inclusive and overflow does not authorize allocation', () => {
  assert.equal(core.plan(config(), [row(A), row(B)], options({ transitCensus: transit({ observedAt: NOW - 120000 }) })).complete, true);
  const rows = [row(A), row(B)];
  rows[0].fleet.probe.parked = 1;
  const result = core.plan(config(), rows, options({ transitCensus: transit({ ships: { probe: Number.MAX_SAFE_INTEGER, marauder: 0, sentinel: 0, vanguard: 0 } }) }));
  assert.equal(result.complete, false);
  assert.equal(result.summary.totals.fleet.probe.total, null);
  assert.deepEqual(result.targetsBySystem, {});
});

test('single-system HUD away fallback is allowed only when no transit census was supplied', () => {
  const rows = [row(A, { censusId: null })];
  rows[0].fleet.probe = { parked: 1, away: 3, building: 2 };
  const fallback = core.plan(config(), rows, options({ expectedIds: [A], transitCensus: undefined }));
  assert.equal(fallback.complete, true);
  assert.equal(fallback.summary.fleetTotalSource, 'single-system-away');
  assert.equal(fallback.summary.totals.fleet.probe.total, 6);
  assert.equal(localOrders(fallback, rows), 4);
  const suppliedInvalid = core.plan(config(), rows, options({ expectedIds: [A], transitCensus: transit({ ships: {} }) }));
  assert.equal(suppliedInvalid.complete, false);
  assert.equal(suppliedInvalid.reason, 'invalid-transit-census');
  const suppliedUnsynced = core.plan(config(), rows, options({ expectedIds: [A] }));
  assert.equal(suppliedUnsynced.complete, false);
  assert.equal(suppliedUnsynced.reason, 'unsynchronized-transit-census');
});

test('transit census normalization is non-mutating and does not evaluate accessors', () => {
  const source = transit({ ships: { probe: 1, marauder: 2, sentinel: 3, vanguard: 4 } });
  const before = clone(source);
  const normalized = core.normalizeTransitCensus(source);
  assert.deepEqual(normalized, before);
  normalized.ships.probe = 100;
  assert.deepEqual(source, before);
  Object.defineProperty(source.ships, 'probe', { get() { throw Error('getter executed'); } });
  assert.equal(core.normalizeTransitCensus(source), null);
});


test('a claimed all-self transit census cannot contain fewer ships than verified HUD away', () => {
  const rows = [row(A), row(B)];
  rows[0].fleet.probe.away = 4;
  rows[1].fleet.probe.away = 2;
  const result = core.plan(config(), rows, options({ transitCensus: transit({ ships: { probe: 5, marauder: 0, sentinel: 0, vanguard: 0 } }) }));
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'inconsistent-transit-census');
  assert.deepEqual(result.targetsBySystem, {});
});
