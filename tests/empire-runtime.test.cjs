'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../docs/empire-core.js');
const runtime = require('../docs/empire-runtime.js');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S = 'alpha/player';
const fleet = () => Object.fromEntries(core.DEFAULT_SHIPS.map(id => [id, { parked: 0, away: 0, building: 0 }]));
const sample = (id, observedAt, scope = S) => ({ scope, systemId: id, name: id === A ? 'Alpha' : 'Beta', owned: true, observedAt,
  resources: { palladium: { amount: 100, cap: 1000, rate: 1 }, iridium: { amount: 100, cap: 1000, rate: 1 } },
  fleet: fleet(), queue: { buildings: 0, ships: 0 }, energy: 10, censusId: 'census-1' });
function harness({ ids = [A], initial, select } = {}) {
  let clock = 10000, context = { scope: S, systemId: A, selectionCount: 1, owned: true, settled: true };
  let roster = { scope: S, complete: true, observedAt: clock, systems: ids.map(id => ({ id, name: id, owned: true })) };
  let readingFails = false, writingFails = false, changes = 0, activeMissing = false, requested = [];
  const values = new Map();
  if (initial) values.set('old-light-empire:v1:' + S, initial);
  const adapter = {
    readRoster: () => roster,
    readActive: () => activeMissing ? null : ({ context, snapshot: sample(context.systemId, clock, context.scope) }),
    selectSystem: async (id, opts) => { requested.push({ id, opts }); if (select) return select(id, opts); context = { ...context, systemId: id }; return true; },
  };
  const app = runtime.create({ core, adapter, now: () => clock,
    read: key => { if (readingFails) throw new Error('read'); return values.get(key); },
    write: (key, value) => { if (writingFails) throw new Error('write'); values.set(key, structuredClone(value)); },
    onChange: () => changes++ });
  const tick = (extra = {}) => app.update({ scope: context.scope, ...extra });
  return { app, tick, adapter, values, requested,
    get context() { return context; }, set context(value) { context = value; },
    get roster() { return roster; }, set roster(value) { roster = value; },
    advance: ms => { clock += ms; }, refreshRoster: () => { roster.observedAt = clock; },
    setReadFailure: v => { readingFails = v; }, setWriteFailure: v => { writingFails = v; },
    missing: v => { activeMissing = v; }, get changes() { return changes; } };
}
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
function enable(h) { h.tick(); return h.app.setConfig({ ...h.app.exportConfig(), enabled: true }); }

test('off by default and no selection side effects', async () => {
  const h = harness({ ids: [A, B] }); const state = h.tick(); await settle();
  assert.equal(state.config.enabled, false); assert.equal(state.ready, false); assert.deepEqual(h.requested, []);
});
test('single verified current owned system can act only when enabled', () => {
  const h = harness(); enable(h); const state = h.tick();
  assert.equal(state.ready, true); assert.equal(h.app.canAct(h.context), true);
});
test('missing scope cannot save or execute imperial settings', () => {
  const h = harness(); h.context = { ...h.context, scope: '' }; h.tick();
  assert.throws(() => h.app.setConfig({ enabled: true }), /cuenta/); assert.equal(h.app.canAct(h.context), false);
});
test('helper pause prevents navigation and orders', async () => {
  const h = harness({ ids: [A, B] }); enable(h); const state = h.tick({ enabled: false }); await settle();
  assert.equal(state.ready, false); assert.deepEqual(h.requested, []);
});
test('pending or busy guard prevents navigation and orders', async () => {
  const h = harness({ ids: [A, B] }); enable(h); h.tick({ blocked: 'Esperando respuesta anterior' }); await settle();
  assert.deepEqual(h.requested, []); assert.match(h.app.state().status, /respuesta/);
});
test('roster must be exhaustive and current before any navigation', async () => {
  for (const patch of [{ complete: false }, { scope: 'other/player' }, { observedAt: -1 }, { observedAt: 10001 }, { systems: [] }]) {
    const h = harness({ ids: [A, B] }); enable(h); h.roster = { ...h.roster, ...patch }; h.tick(); await settle();
    assert.deepEqual(h.requested, []); assert.equal(h.app.state().ready, false);
  }
});
test('malformed foreign and duplicate system identities reject complete roster', () => {
  for (const systems of [[{ id: A, owned: false }], [{ id: 'bogus', owned: true }], [{ id: A, owned: true }, { id: A.toUpperCase(), owned: true }]]) {
    const h = harness(); enable(h); h.roster = { ...h.roster, systems }; assert.equal(h.tick().ready, false);
  }
});
test('stale roster cannot keep a previously ready system executable', () => {
  const h = harness(); enable(h); assert.equal(h.tick().ready, true); h.advance(120001);
  assert.equal(h.app.canAct(h.context), false); assert.equal(h.tick().ready, false);
});
test('selected context requires one owned settled system and exact account', () => {
  for (const patch of [{ selectionCount: 2 }, { owned: false }, { settled: false }, { systemId: B }]) {
    const h = harness(); enable(h); h.context = { ...h.context, ...patch }; assert.equal(h.tick().ready, false); assert.equal(h.app.canAct(h.context), false);
  }
});
test('scope changes clear old snapshots and never inherit enabled policy', () => {
  const h = harness(); enable(h); h.tick(); h.context = { ...h.context, scope: 'alpha/another' };
  const result = h.tick(); assert.equal(result.config.enabled, false); assert.deepEqual(result.snapshots, []); assert.equal(result.ready, false);
});
test('read failure is fail-closed and never overwrites persisted data', () => {
  const h = harness(); enable(h); const before = structuredClone([...h.values]); h.setReadFailure(true);
  const state = h.tick(); assert.equal(state.ready, false); assert.equal(state.storageError, true); assert.deepEqual([...h.values], before);
});
test('write failure preserves prior policy', () => {
  const h = harness(); h.tick(); h.setWriteFailure(true); assert.throws(() => h.app.setConfig({ enabled: true }));
  assert.equal(h.app.exportConfig().enabled, false);
});
test('other-tab disable is respected before next decision', () => {
  const h = harness(); enable(h); h.tick(); h.values.set('old-light-empire:v1:' + S, { enabled: false });
  assert.equal(h.tick().ready, false); assert.equal(h.app.isEnabled(), false);
});
test('importing a configuration never automatically starts the empire', () => {
  const h = harness(); h.tick(); h.app.importConfig({ enabled: true, fleetTargets: { marauder: 40 } });
  assert.equal(h.app.isEnabled(), false); assert.equal(h.app.exportConfig().fleetTargets.marauder, 40);
});
test('manual interaction temporarily blocks execution', () => {
  const h = harness(); enable(h); h.tick(); h.app.suspend(); assert.equal(h.app.canAct(h.context), false);
  assert.equal(h.tick().ready, false); h.advance(15001); assert.equal(h.tick().ready, true);
});
test('invalidating a dispatched origin removes its outdated resource and fleet snapshot', () => {
  const h = harness(); enable(h); h.tick(); h.app.invalidate(A);
  assert.deepEqual(h.app.state().snapshots, []); assert.equal(h.app.canAct(h.context), false);
});
test('removed ownership disappears from cache immediately', () => {
  const h = harness(); enable(h); h.tick(); h.roster = { ...h.roster, systems: [{ id: B, owned: true }] };
  const state = h.tick(); assert.deepEqual(state.snapshots, []); assert.equal(state.ready, false);
});
test('returned state cannot mutate live configuration', () => {
  const h = harness(); enable(h); h.tick(); const state = h.app.state(); state.config.enabled = false; state.snapshots[0].name = 'mutated';
  assert.equal(h.app.isEnabled(), true); assert.notEqual(h.app.state().snapshots[0].name, 'mutated');
});
test('missing verified native selector fails closed', async () => {
  const h = harness({ ids: [A, B] }); enable(h); delete h.adapter.selectSystem;
  const state = h.tick(); await settle(); assert.equal(state.ready, false); assert.deepEqual(h.requested, []); assert.match(state.status, /selector/);
});
test('navigation only visits an ID in the fresh exhaustive owned roster', async () => {
  const h = harness({ ids: [A, B] }); enable(h); h.tick(); await settle();
  assert.deepEqual(h.requested, [{ id: B, opts: { scope: S } }]); assert.equal(h.context.systemId, B);
});
test('disable before selection microtask prevents the action', async () => {
  const h = harness({ ids: [A, B] }); enable(h); h.tick(); h.app.setConfig({ enabled: false }); await settle();
  assert.deepEqual(h.requested, []);
});
test('unconfirmed navigation requires explicit review rather than automatic retries', async () => {
  const h = harness({ ids: [A, B], select: async () => false }); enable(h); h.tick(); await settle();
  assert.equal(h.app.state().manualHold, true); h.tick(); await settle(); assert.equal(h.requested.length, 1); assert.equal(h.app.canAct(h.context), false);
});
test('navigation exception requires review', async () => {
  const h = harness({ ids: [A, B], select: async () => { throw new Error('navigation'); } }); enable(h); h.tick(); await settle();
  assert.equal(h.app.state().manualHold, true); assert.equal(h.app.state().ready, false);
});
test('never-resolving navigation has a bounded fail-closed timeout', async () => {
  const h = harness({ ids: [A, B], select: () => new Promise(() => {}) }); enable(h); h.tick(); await settle();
  h.advance(15001); const state = h.tick(); assert.equal(state.moving, true); assert.equal(state.manualHold, true); assert.equal(state.ready, false);
});
test('late result from old account cannot resume new account', async () => {
  let finish; const h = harness({ ids: [A, B], select: () => new Promise(resolve => { finish = resolve; }) }); enable(h); h.tick(); await settle();
  h.context = { ...h.context, scope: 'alpha/another' }; h.tick(); finish(true); await settle();
  assert.equal(h.app.state().scope, 'alpha/another'); assert.equal(h.app.isEnabled(), false); assert.equal(h.app.state().ready, false);
});

test('a newer helper pause or pending operation revokes a queued selection', async () => {
  for (const patch of [{enabled:false},{blocked:'pending'}]) {
    const h=harness({ids:[A,B]});enable(h);h.tick();h.tick(patch);await settle();assert.equal(h.requested.length,0);
  }
});
test('roster invalidation revokes a selection before its microtask',async()=>{
  const h=harness({ids:[A,B]});enable(h);h.tick();h.roster.complete=false;h.tick();await settle();assert.equal(h.requested.length,0);
});
test('rejected current snapshots never reuse a cached authorization',()=>{
  for(const transform of [()=>null,s=>({...s,owned:false}),s=>({...s,scope:'other/player'}),s=>({...s,observedAt:999999})]){
    const h=harness();enable(h);assert.equal(h.tick().ready,true);h.adapter.readActive=()=>({context:h.context,snapshot:transform(sample(A,10000))});
    assert.equal(h.tick().ready,false);assert.equal(h.app.canAct(h.context),false);
  }
});
test('invalidating an origin rejects replay of its pre-action census',()=>{
  const h=harness();enable(h);h.tick();h.app.invalidate(A);assert.equal(h.tick().ready,false);
  h.advance(1);assert.equal(h.tick().ready,false); // Same source version remains stale even with a new fetch timestamp.
  h.adapter.readActive=()=>({context:h.context,snapshot:{...sample(A,10001),censusId:'census-2'}});assert.equal(h.tick().ready,true);
});
test('editing policy cannot launch a second physical selector while the first is unresolved',async()=>{
  let done;const h=harness({ids:[A,B],select:()=>new Promise(resolve=>{done=resolve;})});enable(h);h.tick();await settle();
  h.app.setConfig({...h.app.exportConfig(),fleetTargets:{marauder:5}});h.tick();await settle();assert.equal(h.requested.length,1);assert.equal(h.app.isBusy(),true);
  done(true);await settle();assert.equal(h.app.isBusy(),false);
});
test('ordinary edits do not clear the uncertain-navigation latch',async()=>{
  const h=harness({ids:[A,B],select:async()=>false});enable(h);h.tick();await settle();
  h.app.setConfig({...h.app.exportConfig(),fleetTargets:{marauder:5}});h.tick();await settle();assert.equal(h.app.state().manualHold,true);assert.equal(h.requested.length,1);
  h.app.setConfig({...h.app.exportConfig(),enabled:false});h.app.setConfig({...h.app.exportConfig(),enabled:true});assert.equal(h.app.state().manualHold,false);
});
test('dispatch rechecks current roster ownership even without a new update',async()=>{
  const h=harness({ids:[A,B]});enable(h);h.tick();h.roster.systems=[{id:A,owned:true}];await settle();assert.equal(h.requested.length,0);
});
test('single-census timestamps cannot starve another system after dwell',async()=>{
  const h=harness({ids:[A,B]});enable(h);h.tick();await settle();h.tick();h.advance(5001);h.refreshRoster();h.tick();await settle();assert.equal(h.requested.at(-1).id,A);
});
