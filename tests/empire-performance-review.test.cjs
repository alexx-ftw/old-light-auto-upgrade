'use strict';
// Independent offline review. All identities, clocks, navigation and DOM are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const native = require('../docs/empire-adapter.js');
const core = require('../docs/empire-core.js');
const runtime = require('../docs/empire-runtime.js');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const T = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const S = 'alpha/' + P;
const copy = x => JSON.parse(JSON.stringify(x));
const counts = n => Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, n]));
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture({ legacy = false } = {}) {
  let clock = 1000000, reads = 0;
  const systems = [A, B].map((id, q) => ({ id, q, r: 0, name: q ? 'Beta' : 'Alpha',
    fleet: [{ type: 'probe', quantity: 10 }], buildings: [{ type: 'shipyard', level: 1 }],
    economy: { resources: { palladium: 100, iridium: 200, settledAt: new Date(clock).toISOString() },
      paCap: 1000, irCap: 2000, paRatePerMin: 0, irRatePerMin: 0, energyCap: 30, energyUsed: 10, queue: [] },
    shipyard: { queue: [] } }));
  const source = { version: 1, galaxy: 'alpha', selfId: P, scope: S, generation: 1, epoch: 1, revision: 0,
    observedAt: clock, connected: true, complete: true, systems, transits: [], transitShips: counts(0) };
  const context = { scope: S, systemId: A, selectionCount: 1, settled: true, owned: true };
  const hud = { scope: S, systemId: A,
    resources: { palladium: { amount: 100, cap: 1000, rate: 0 }, iridium: { amount: 200, cap: 2000, rate: 0 } },
    fleet: Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, { parked: ship === 'probe' ? 10 : 0, away: 0, building: 0 }])),
    queue: { buildings: 0, ships: 0 }, energy: 20 };
  const document = { hidden: false, activeElement: null, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [] };
  const reader = native.create({ getWorld: () => { reads++; return source; }, getContext: () => context,
    getHudSnapshot: () => hud, document, canNavigate: () => true, now: () => clock });
  const requested = [], adapter = { ...reader, selectSystem: async (...args) => { requested.push(args); return true; } };
  if (legacy) delete adapter.readBundle;
  let config = { enabled: true, fleetTargets: { probe: 100 }, systems: { [A]: { role: 'industry' } } };
  const app = runtime.create({ core, adapter, now: () => clock, read: () => config, write: (_, next) => { config = next; } });
  return { source, context, hud, document, adapter, reader, app, requested,
    get clock() { return clock; }, get reads() { return reads; },
    advance(ms) { clock += ms; }, tick: () => app.update({ scope: S }),
    setConfig(next) { config = next; },
  };
}

test('independent review: bundle and legacy runtime paths preserve state and authorization over a changing census', () => {
  const bundled = fixture(), legacy = fixture({ legacy: true });
  const changes = [
    () => {},
    h => { h.source.revision++; h.source.systems[1].fleet[0].quantity += 7; },
    h => { h.hud.energy--; },
    h => { h.hud.energy++; },
    h => { h.context.selectionCount = 2; },
    h => { h.context.selectionCount = 1; },
    h => { h.document.hidden = true; },
    h => { h.document.hidden = false; },
    h => { h.app.invalidate(A); },
    h => { h.advance(1); h.source.revision++; h.source.observedAt = h.clock; },
    h => { h.source.revision++; h.source.systems[1].shipyard.queue = null; },
    h => { h.source.revision++; h.source.systems[1].shipyard.queue = []; },
    h => { h.setConfig({ enabled: false }); },
  ];
  for (const change of changes) {
    change(bundled); change(legacy);
    assert.deepEqual(bundled.tick(), legacy.tick());
    assert.equal(bundled.app.canAct(bundled.context), legacy.app.canAct(legacy.context));
  }
  assert.ok(bundled.reads < legacy.reads, 'equivalent decisions require fewer source captures');
});

test('independent review: a valid deferred navigation preflight takes one additional fresh bundle', async () => {
  const h = fixture(); assert.equal(h.tick().ready, true); assert.equal(h.reads, 1);
  h.advance(5000); assert.equal(h.tick().moving, true); assert.equal(h.reads, 2);
  await settle(); assert.equal(h.reads, 3);
  assert.deepEqual(h.requested, [[B, { scope: S }]]);
  assert.equal(h.app.canAct(h.context), false);
});

test('independent review: deferred navigation cannot use the update bundle after identity or safety changes', async () => {
  for (const change of [
    h => { h.source.connected = false; },
    h => { h.source.systems[1].fleet[0].quantity++; },
    h => { h.context.scope = 'beta/' + P; },
    h => { h.context.selectionCount = 2; },
    h => { h.hud.energy--; },
    h => { h.document.hidden = true; },
    h => { h.app.suspend(); },
    h => { h.app.setConfig({ enabled: false }); },
    h => { h.source.revision++; h.source.systems.pop(); },
  ]) {
    const h = fixture(); assert.equal(h.tick().ready, true); h.advance(5000);
    assert.equal(h.tick().moving, true); change(h); await settle();
    assert.deepEqual(h.requested, []); assert.equal(h.app.canAct(h.context), false);
  }
});

test('independent review: throwing bundle reads fail closed without consulting legacy readers', async () => {
  const h = fixture(); assert.equal(h.tick().ready, true);
  let legacyReads = 0;
  for (const name of ['readRoster', 'readActive', 'readSnapshots', 'readTransitCensus']) {
    h.adapter[name] = () => { legacyReads++; throw new Error('must not use legacy'); };
  }
  h.adapter.readBundle = () => { throw new Error('synthetic reader failure'); };
  assert.equal(h.app.canAct(h.context), false); assert.equal(h.tick().ready, false);
  assert.equal(legacyReads, 0);
  const moving = fixture(); moving.tick(); moving.advance(5000); moving.tick();
  moving.adapter.readBundle = () => { throw new Error('synthetic reader failure'); };
  await settle(); assert.deepEqual(moving.requested, []);
  assert.equal(moving.app.state().manualHold, true);
});

test('independent review: transit deduplication keeps global and per-system counts coherent', () => {
  const h = fixture();
  const transit = { id: T, fromQ: 0, fromR: 0, toQ: 99, toR: 99,
    phase: 'outbound', recalledAt: null, ships: [{ type: 'probe', quantity: 6 }] };
  h.source.transits = [transit, copy(transit)]; h.source.transitShips.probe = 6; h.hud.fleet.probe.away = 6;
  let bundle = h.reader.readBundle();
  assert.equal(bundle.transitCensus.ships.probe, 6);
  assert.equal(bundle.snapshots[0].fleet.probe.away, 6);
  assert.equal(bundle.active.context.settled, true);
  h.source.revision++; h.source.transits[1].toQ = 98;
  assert.equal(h.reader.readBundle(), null, 'contradictory duplicate cannot supply a validated global count');
  h.source.revision++; h.source.transits = [transit]; transit.toQ = 1; transit.toR = 0; h.hud.fleet.probe.away = 0;
  bundle = h.reader.readBundle();
  assert.equal(bundle.transitCensus.ships.probe, 6);
  assert.equal(bundle.snapshots[0].fleet.probe.away, 0, 'own transfer is not native away fleet');
  assert.equal(bundle.active.context.settled, true);
});

test('independent review: capture refuses accessor fields without running page-supplied getters', () => {
  for (const [target, key] of [['source', 'transits'], ['system', 'fleet'], ['context', 'scope'], ['hud', 'fleet']]) {
    const h = fixture(); let invoked = 0;
    const object = target === 'system' ? h.source.systems[0] : h[target];
    Object.defineProperty(object, key, { configurable: true, enumerable: true, get() { invoked++; throw new Error('page getter'); } });
    assert.equal(h.tick().ready, false); assert.equal(h.app.canAct(h.context), false); assert.equal(invoked, 0);
  }
});

test('independent review: scoped policy copies are discarded on account change and cannot authorize', () => {
  const h = fixture(); h.tick();
  const policy = h.app.systemPolicy(A); assert.equal(policy.role, 'industry');
  policy.shipMinimums.probe = 999999;
  assert.notEqual(h.app.systemPolicy(A).shipMinimums.probe, 999999);
  h.setConfig(undefined); h.app.update({ scope: 'beta/' + P });
  assert.deepEqual(h.app.systemPolicy(A), { role: 'balanced', shipMinimums: counts(0) });
  assert.equal(h.app.canAct(h.context), false);
});
