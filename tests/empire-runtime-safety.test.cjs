'use strict';
// Independent regression probes for source authority and post-action barriers.
// All adapters are in-memory; no browser or game/network calls occur.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../docs/empire-core.js');
const runtime = require('../docs/empire-runtime.js');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = 'alpha/player';

function harness(ids = [A, B]) {
  let clock = 10000, config = { enabled: true, fleetTargets: { probe: 10 } };
  const context = { scope: SCOPE, systemId: A, owned: true, settled: true, selectionCount: 1 };
  const sample = id => ({ scope: SCOPE, systemId: id, owned: true, observedAt: clock, censusId: 'source-1',
    resources: { palladium: { amount: 100, cap: 1000, rate: 1 }, iridium: { amount: 100, cap: 1000, rate: 1 } },
    fleet: Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, { parked: 0, away: 0, building: 0 }])),
    energy: 10, queue: { buildings: 0, ships: 0 } });
  const roster = { scope: SCOPE, observedAt: clock, complete: true, systems: ids.map(id => ({ id, owned: true })) };
  const batch = ids.map(sample);
  const adapter = {
    readRoster: () => roster,
    readSnapshots: () => batch,
    readActive: () => ({ context, snapshot: sample(A) }),
    readTransitCensus: () => ({ scope: SCOPE, observedAt: clock, censusId: 'source-1', ships: Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, 0])) }),
  };
  const app = runtime.create({ core, adapter, now: () => clock, read: () => config,
    write: (_key, value) => { config = structuredClone(value); } });
  return { app, adapter, context, roster, batch, sample,
    advance: ms => { clock += ms; },
    tick: () => app.update({ scope: SCOPE }),
  };
}

test('ambiguous whole-account batch cannot be repaired by overwriting its active row', () => {
  const h = harness(), conflicting = h.sample(A); conflicting.fleet.probe.parked = 100;
  h.batch.push(conflicting);
  assert.equal(h.tick().ready, false);
  assert.equal(h.app.canAct(h.context), false);
});

test('a declared whole-account batch must include the active system itself', () => {
  const h = harness(); h.adapter.readSnapshots = () => [h.sample(B)];
  assert.equal(h.tick().ready, false);
  assert.equal(h.app.canAct(h.context), false);
});

test('dispatch rejects a whole-account source that became unavailable after update', () => {
  const h = harness(); assert.equal(h.tick().ready, true);
  h.adapter.readSnapshots = () => null;
  assert.equal(h.app.canAct(h.context), false);
});

test('dispatch rejects new duplicate rows in the whole-account source', () => {
  const h = harness(); assert.equal(h.tick().ready, true);
  h.batch.push(h.sample(A));
  assert.equal(h.app.canAct(h.context), false);
});

test('configured transit source may not silently downgrade to a single-system HUD estimate', () => {
  for (const unavailable of [undefined, null]) {
    const h = harness([A]); assert.equal(h.tick().ready, true);
    h.adapter.readTransitCensus = () => unavailable;
    assert.equal(h.tick().ready, false);
    assert.equal(h.app.canAct(h.context), false);
  }
});

test('invalid transit response is reflected in readiness as well as the dispatch gate', () => {
  const h = harness([A]); h.adapter.readTransitCensus = () => ({});
  assert.equal(h.tick().ready, false);
  assert.equal(h.app.canAct(h.context), false);
});

test('post-action census barrier may not lose source identity on a later snapshot', () => {
  const h = harness([A]); delete h.adapter.readSnapshots; delete h.adapter.readTransitCensus;
  assert.equal(h.tick().ready, true); h.app.invalidate(A); h.advance(1);
  h.adapter.readActive = () => ({ context: h.context, snapshot: { ...h.sample(A), censusId: null } });
  assert.equal(h.tick().ready, false);
  assert.equal(h.app.canAct(h.context), false);
});

test('repeated invalidation preserves the prior census barrier after cache removal', () => {
  const h = harness([A]); delete h.adapter.readSnapshots; delete h.adapter.readTransitCensus;
  assert.equal(h.tick().ready, true); h.app.invalidate(A); h.app.invalidate(A); h.advance(1);
  assert.equal(h.tick().ready, false);
  assert.equal(h.app.canAct(h.context), false);
});

test('dispatch rechecks age of inactive systems as well as the active snapshot', () => {
  const h = harness(); assert.equal(h.tick().ready, true);
  h.advance(120001); h.roster.observedAt += 120001;
  assert.equal(h.app.canAct(h.context), false);
});
