'use strict';
// Synthetic offline fixtures only. No real DOM, game, network or navigation.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../docs/empire-core.js');
const adapterModule = require('../docs/empire-adapter.js');
const runtimeModule = require('../docs/empire-runtime.js');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const S = 'alpha/' + P;
const copy = x => JSON.parse(JSON.stringify(x));
const counts = n => Object.fromEntries(core.DEFAULT_SHIPS.map(x => [x, n]));
function harness({ copySource = true } = {}) {
  let clock = 1000000, reads = 0;
  const systems = [A, B].map((id, q) => ({ id, q, r: 0, name: id,
    fleet: [{ type: 'probe', quantity: 10 }], buildings: [{ type: 'shipyard', level: 1 }],
    economy: { resources: { palladium: 100, iridium: 200, settledAt: new Date(clock).toISOString() },
      paCap: 1000, irCap: 2000, paRatePerMin: 0, irRatePerMin: 0, energyCap: 30, energyUsed: 10, queue: [] },
    shipyard: { queue: [] } }));
  let world = { version: 1, galaxy: 'alpha', selfId: P, scope: S, generation: 1, epoch: 1, revision: 0,
    observedAt: clock, connected: true, complete: true, systems, transits: [], transitShips: counts(0) };
  const context = { scope: S, systemId: A, selectionCount: 1, settled: true, owned: true };
  const hud = { scope: S, systemId: A,
    resources: { palladium: { amount: 100, cap: 1000, rate: 0 }, iridium: { amount: 200, cap: 2000, rate: 0 } },
    fleet: Object.fromEntries(core.DEFAULT_SHIPS.map(x => [x, { parked: x === 'probe' ? 10 : 0, away: 0, building: 0 }])),
    queue: { buildings: 0, ships: 0 }, energy: 20 };
  const document = { hidden: false, activeElement: null, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [] };
  const adapter = adapterModule.create({ getWorld: () => { reads++; return copySource ? copy(world) : world; }, getContext: () => context,
    getHudSnapshot: () => hud, document, canNavigate: () => true, now: () => clock });
  let config = { enabled: true, fleetTargets: { probe: 100 } };
  const runtime = runtimeModule.create({ core, adapter, now: () => clock, read: () => config, write: (_, x) => { config = x; } });
  return { adapter, runtime, context, hud, document,
    get source() { return world; }, set source(x) { world = x; }, get reads() { return reads; },
    get clock() { return clock; }, advance(ms) { clock += ms; },
    update: () => runtime.update({ scope: S }), setConfig: x => { config = x; },
  };
}

test('readBundle captures one fresh source and returns mutually consistent defensive copies', () => {
  const h = harness(), view = h.adapter.readBundle();
  assert.equal(h.reads, 1); assert.equal(view.active.context.settled, true);
  assert.deepEqual(view.active.snapshot, view.snapshots[0]);
  assert.equal(view.transitCensus.censusId, view.snapshots[1].censusId);
  view.roster.systems.pop(); view.snapshots[0].fleet.probe.parked = 999; view.active.snapshot.energy = 999;
  const fresh = h.adapter.readBundle(); assert.equal(h.reads, 2);
  assert.equal(fresh.roster.systems.length, 2); assert.equal(fresh.snapshots[0].fleet.probe.parked, 10);
  assert.equal(fresh.active.snapshot.energy, 20);
});

test('update and each dispatch gate independently read one new whole-account bundle', () => {
  const h = harness(); assert.equal(h.update().ready, true); assert.equal(h.reads, 1);
  assert.equal(h.runtime.canAct(h.context), true); assert.equal(h.reads, 2);
  assert.equal(h.runtime.canAct(h.context), true); assert.equal(h.reads, 3);
  assert.equal(h.update().ready, true); assert.equal(h.reads, 4);
});

test('legacy individual readers remain fresh and do not acquire a cache', () => {
  const h = harness(); h.adapter.readRoster(); h.adapter.readSnapshots(); h.adapter.readActive(); h.adapter.readTransitCensus();
  assert.equal(h.reads, 4);
  h.source.systems[1].fleet[0].quantity++;
  assert.equal(h.adapter.readRoster(), null);
  assert.match(h.adapter.getStatus(), /contradictorios/);
});

test('same-revision mutation after update poisons that revision before dispatch', () => {
  for (const copySource of [true, false]) {
  const h = harness({ copySource }); assert.equal(h.update().ready, true);
  h.source.systems[1].fleet[0].quantity++;
  assert.equal(h.runtime.canAct(h.context), false);
  h.source.systems[1].fleet[0].quantity--;
  assert.equal(h.runtime.canAct(h.context), false, 'restoring a poisoned revision cannot authorize');
  h.source.revision++;
  assert.equal(h.update().ready, true); assert.equal(h.runtime.canAct(h.context), true);
  }
});

test('bundle is rechecked after data advances and target allocations change', () => {
  const h = harness(); assert.equal(h.update().ready, true);
  h.source.revision++; h.source.systems[1].fleet[0].quantity += 20;
  assert.equal(h.runtime.canAct(h.context), false);
  assert.equal(h.update().ready, true); assert.equal(h.runtime.canAct(h.context), true);
});

test('freshness expires even without a new revision or a new DTO identity', () => {
  for (const copySource of [true, false]) {
    const h = harness({ copySource }); assert.equal(h.update().ready, true);
    h.advance(120001); assert.equal(h.runtime.canAct(h.context), false);
    assert.equal(h.adapter.readBundle(), null); assert.equal(h.update().ready, false);
  }
});

test('each bundle freshly checks HUD and selection independently of census revision', () => {
  for (const mutate of [h => { h.hud.fleet.probe.parked++; }, h => { h.context.selectionCount = 2; },
    h => { h.context.owned = false; }, h => { h.context.scope = 'other/' + P; }, h => { h.context.settled = false; }]) {
    const h = harness(); assert.equal(h.update().ready, true); mutate(h);
    assert.equal(h.runtime.canAct(h.context), false);
  }
});

test('dispatch still revalidates config and navigation gates', () => {
  for (const mutate of [h => h.setConfig({ enabled: false }), h => { h.document.hidden = true; },
    h => { h.document.activeElement = { matches: () => true }; }]) {
    const h = harness(); assert.equal(h.update().ready, true); mutate(h); assert.equal(h.runtime.canAct(h.context), false);
  }
});

test('new captures reject source disconnects, foreign scope and regressing revisions', () => {
  for (const mutate of [h => { h.source.connected = false; }, h => { h.source.scope = 'other/' + P; },
    h => { h.source.revision--; }, h => { h.source.epoch--; }, h => { h.source.generation--; }]) {
    const h = harness(); h.source.revision = 2; h.source.epoch = 2; h.source.generation = 2;
    assert.equal(h.update().ready, true); mutate(h); assert.equal(h.runtime.canAct(h.context), false);
  }
});

test('fresh bundles preserve post-action timestamp and census-identity barriers', () => {
  const h = harness(); assert.equal(h.update().ready, true); h.runtime.invalidate(A);
  assert.equal(h.update().ready, false);
  h.source.revision++; assert.equal(h.update().ready, false, 'new revision alone is insufficient');
  h.advance(1); h.source.observedAt = h.clock; h.source.revision++;
  assert.equal(h.update().ready, true); assert.equal(h.runtime.canAct(h.context), true);
});

test('declared bundle support never falls back to unrelated legacy reads after a failure', () => {
  for (const broken of [null, undefined, {}, { roster: null }]) {
    const h = harness(); let legacyReads = 0;
    const adapter = { ...h.adapter, readBundle: () => broken,
      readRoster: () => { legacyReads++; return h.adapter.readRoster(); }, getStatus: () => 'No census' };
    const app = runtimeModule.create({ core, adapter, now: () => h.clock, read: () => ({ enabled: true }), write() {} });
    assert.equal(app.update({ scope: S }).ready, false); assert.equal(app.canAct(h.context), false); assert.equal(legacyReads, 0);
  }
});

test('bundles require complete nonduplicate snapshots and a synchronized transit census', () => {
  for (const mutate of [b => { b.snapshots.pop(); }, b => { b.snapshots.push(copy(b.snapshots[0])); },
    b => { b.transitCensus = null; }, b => { b.transitCensus.censusId = 'other'; },
    b => { b.active.snapshot.fleet.probe.parked++; }]) {
    const h = harness(); const adapter = { ...h.adapter, readBundle() { const b = h.adapter.readBundle(); mutate(b); return b; } };
    const app = runtimeModule.create({ core, adapter, now: () => h.clock, read: () => ({ enabled: true }), write() {} });
    assert.equal(app.update({ scope: S }).ready, false); assert.equal(app.canAct(h.context), false);
  }
});

test('systemPolicy is a detached bounded local policy and does not authorize or refresh', () => {
  const h = harness(); assert.deepEqual(h.runtime.systemPolicy(A), { role: 'balanced', shipMinimums: counts(0) });
  assert.equal(h.reads, 0); assert.equal(h.update().ready, true);
  h.runtime.setConfig({ enabled: true, fleetTargets: { probe: 100 }, systems: { [A]: { role: 'shipyard' } } });
  assert.equal(h.update().ready, true); const before = h.runtime.state(), reads = h.reads;
  const policy = h.runtime.systemPolicy(A.toUpperCase());
  assert.deepEqual(policy, { role: 'shipyard', shipMinimums: before.plan.targetsBySystem[A].shipMinimums });
  assert.deepEqual(Object.keys(policy).sort(), ['role', 'shipMinimums']);
  policy.role = 'defense'; policy.shipMinimums.probe = 999999;
  assert.deepEqual(h.runtime.state(), before); assert.equal(h.reads, reads);
  h.runtime.invalidate(A); h.runtime.systemPolicy(A);
  assert.equal(h.runtime.canAct(h.context), false); assert.equal(h.reads, reads);
  assert.deepEqual(h.runtime.systemPolicy('unknown'), { role: 'balanced', shipMinimums: counts(0) });
  assert.deepEqual(h.runtime.systemPolicy({ toString() { throw new Error('must not coerce'); } }),
    { role: 'balanced', shipMinimums: counts(0) });
});
