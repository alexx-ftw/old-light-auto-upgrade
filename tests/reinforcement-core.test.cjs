'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../docs/reinforcement-core.js');

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const PLAYER = 'dddddddd-0000-4000-8000-000000000004';
const SCOPE = `galaxy/${PLAYER}`;
const clone = value => JSON.parse(JSON.stringify(value));
const fleet = (probe = 100, marauder = 20) => core.SHIPS.map(type => ({ type, quantity: type === 'probe' ? probe : type === 'marauder' ? marauder : 0 }));
const route = (patch = {}) => ({ id: 'north', originId: A, destinationId: B, intervalMinutes: 5,
  ships: { probe: { mode: 'excess', reserve: 20 } }, paused: false, ...patch });
function harness() {
  const h = { at: 1000000, storage: new Map(), queueJobs: [], calls: [], changes: 0, failWrite: false, ignoreWrite: false,
    context: { scope: SCOPE, originId: A, canAct: true, coordinated: true },
    world: { scope: SCOPE, galaxy: 'galaxy', selfId: PLAYER, connected: true, complete: true, observedAt: 1000000,
      systems: [{ id: A, q: 0, r: 0, name: 'Origin', fleet: fleet() }, { id: B, q: 5, r: -2, name: 'Destination', fleet: fleet(0) },
        { id: C, q: 8, r: 9, name: 'Other', fleet: fleet(70) }], transits: [] } };
  h.dependencies = {
    read: scope => h.storage.has(scope) ? clone(h.storage.get(scope)) : null,
    write: (scope, state) => { if (h.failWrite) throw Error('disk full'); if (!h.ignoreWrite) h.storage.set(scope, clone(state)); },
    getContext: () => h.context, getWorld: () => h.world, getJobs: () => clone(h.queueJobs), now: () => h.at,
    queue: (spec, options) => {
      h.calls.push({ spec: clone(spec), options: clone(options), saved: clone(h.storage.get(spec.scope)) });
      if (h.queueThrowBefore) throw Error('unknown queue outcome');
      const existing = h.queueJobs.find(job => job.id === options.id);
      if (existing) return clone(existing);
      h.queueJobs = h.queueJobs.filter(job => !(job.scope === spec.scope && job.originId === spec.originId && job.status === 'sent'));
      const job = { id: options.id, ...clone(spec), status: 'waiting', needsReview: false,
        createdAt: h.at, updatedAt: h.at, claimedAt: null, sentAt: null };
      h.queueJobs.push(job);
      if (h.queueThrowAfter) throw Error('unknown queue outcome');
      return clone(job);
    },
    cancel: id => { h.cancelGuard = h.engine.canRunJob(h.queueJobs.find(job => job.id === id));
      if (h.cancelError) throw Error('cannot cancel'); h.queueJobs = h.queueJobs.filter(job => job.id !== id); },
    onChange: () => { h.changes += 1; h.onChange?.(); },
  };
  h.engine = core.create(h.dependencies);
  h.reload = () => { h.engine = core.create(h.dependencies); return h.engine; };
  h.advance = (ms, fresh = true) => { h.at += ms; if (fresh) h.world.observedAt = h.at; };
  h.sent = () => { Object.assign(h.queueJobs[0], { status: 'sent', sentAt: h.at }); };
  h.claim = () => { Object.assign(h.queueJobs[0], { status: 'sending', claimedAt: h.at }); return clone(h.queueJobs[0]); };
  return h;
}

test('UMD is standalone and exports immutable constants and factory', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../docs/reinforcement-core.js'), 'utf8'), context);
  assert.equal(typeof context.OldLightReinforcementCore.create, 'function');
  assert.equal(Object.isFrozen(core), true);
  assert.equal(Object.isFrozen(core.SHIPS), true);
  assert.throws(() => core.create(), /adaptadores/);
});

test('new routes default paused, explicit save activates, and intervals are bounded', () => {
  const h = harness();
  const saved = h.engine.save(route({ paused: undefined }));
  assert.equal(saved.paused, true);
  assert.equal(saved.status, 'paused');
  assert.equal(h.engine.tick().queued.length, 0);
  h.engine.save(route({ intervalMinutes: 1 }));
  assert.equal(h.engine.list()[0].paused, false);
  assert.equal(h.engine.tick().queued.length, 1);
  for (const intervalMinutes of [0, 1441, 1.5, '5', Infinity]) assert.throws(() => harness().engine.save(route({ intervalMinutes })));
  assert.equal(harness().engine.save(route({ intervalMinutes: 1440 })).intervalMinutes, 1440);
});

test('rejects self routes, invalid IDs, bad ship amounts and accessor data without executing it', () => {
  const h = harness();
  for (const patch of [{ destinationId: A }, { originId: 'unknown' }, { ships: { outsider: { mode: 'fixed', amount: 1 } } },
    { ships: { probe: { mode: 'fixed', amount: 50001 } } }, { ships: { probe: { mode: 'excess', reserve: -1 } } }, { paused: 'false' }]) {
    assert.throws(() => h.engine.save(route(patch)));
  }
  let called = false;
  const value = route();
  Object.defineProperty(value, 'originId', { get() { called = true; throw Error('getter'); } });
  assert.throws(() => h.engine.save(value));
  assert.equal(called, false);
  assert.equal(h.engine.list().length, 0);
});

test('builds only parked excess, saves ticket before queue, and uses an explicit native send target', () => {
  const h = harness();
  h.world.systems[0].away = { probe: 9000 };
  h.engine.save(route());
  const outcome = h.engine.tick(), call = h.calls[0], ticket = call.saved.routes[0].ticket;
  assert.deepEqual(outcome.queued, ['route:north:1']);
  assert.equal(ticket.state, 'prepared');
  assert.equal(call.saved.sequence, 1);
  assert.equal(call.options.id, ticket.id);
  assert.deepEqual(call.spec.quantities, { probe: 80, marauder: 0, sentinel: 0, vanguard: 0 });
  assert.deepEqual(call.spec.target, { mode: 'custom', missionAction: 'send', coordinate: { q: 5, r: -2 },
    routeKey: '', presetKey: 'refuerzo', label: 'Destination' });
  assert.equal(call.spec.produce, false);
  assert.equal(call.spec.autoSend, true);
  assert.equal(h.engine.list()[0].ticket.state, 'queued');
  assert.equal(h.engine.canRunJob(h.queueJobs[0]), true);
  assert.equal(h.engine.canRunJob({ id: 'manual' }), true);
});

test('fixed counts require the complete amount plus reserve, excess caps at native 50000', () => {
  const h = harness();
  h.engine.save(route({ ships: { probe: { mode: 'fixed', amount: 81, reserve: 20 } } }));
  assert.deepEqual(h.engine.dueOrigins(), []);
  h.engine.tick(); assert.equal(h.calls.length, 0);
  h.engine.save(route({ ships: { probe: { mode: 'fixed', amount: 80, reserve: 20 } } }));
  h.engine.tick(); assert.equal(h.calls[0].spec.quantities.probe, 80);
  const huge = harness(); huge.world.systems[0].fleet = fleet(80000);
  huge.engine.save(route()); huge.engine.tick();
  assert.equal(huge.calls[0].spec.quantities.probe, 50000);
});

test('empty origins and all-zero configuration never queue or request navigation', () => {
  for (const ships of [{}, { probe: { mode: 'excess', reserve: 100 } }]) {
    const h = harness(); h.engine.save(route({ ships }));
    assert.deepEqual(h.engine.dueOrigins(), []);
    h.engine.tick(); assert.equal(h.calls.length, 0);
  }
});

test('no concurrent missions share one origin, and selected origin is required', () => {
  const h = harness();
  h.engine.save(route());
  h.engine.save(route({ id: 'south', destinationId: C }));
  h.context.originId = C;
  assert.deepEqual(h.engine.dueOrigins(), [A]);
  h.engine.tick(); assert.equal(h.calls.length, 0);
  h.context.originId = A;
  h.engine.tick(); h.engine.tick();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.engine.dueOrigins(), [A]);
});

test('a manual mission, even paused or uncertain, blocks the origin', () => {
  for (const status of ['waiting', 'paused', 'sending', 'uncertain', 'unknown']) {
    const h = harness(); h.engine.save(route());
    h.queueJobs.push({ id: 'manual', scope: SCOPE, originId: A, status });
    h.engine.tick();
    assert.equal(h.calls.length, 0, status);
    assert.deepEqual(h.engine.dueOrigins(), [], status);
  }
});

test('canAct and cross-tab coordination are hard gates before queueing and every click', () => {
  for (const key of ['canAct', 'coordinated']) {
    const h = harness(); h.engine.save(route()); h.context[key] = false;
    h.engine.tick(); assert.equal(h.calls.length, 0);
    h.context[key] = true; h.engine.tick(); assert.equal(h.calls.length, 1);
    h.context[key] = false; assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
    assert.equal(h.engine.canRunJob({ id: 'route:orphan:1' }), false);
  }
});

test('stale, future, disconnected, incomplete, cross-account and malformed world data block actions', () => {
  const patches = [{ observedAt: 1000000 - core.MAX_AGE_MS - 1 }, { observedAt: 1000001 }, { connected: false },
    { complete: false }, { scope: 'other/player' }, { selfId: 'other' }, { transits: null }, { systems: [] }];
  for (const patch of patches) {
    const h = harness(); h.engine.save(route()); Object.assign(h.world, patch);
    h.engine.tick(); assert.equal(h.calls.length, 0, JSON.stringify(patch));
    assert.deepEqual(h.engine.dueOrigins(), []);
  }
  const h = harness(); h.engine.save(route()); h.engine.tick();
  h.world.connected = false; assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
});

test('ownership changes, parked depletion, duplicate fleet entries, and destination moves revoke guards', () => {
  const cases = [h => { h.world.systems = h.world.systems.filter(row => row.id !== B); },
    h => { h.world.systems[0].fleet = fleet(99); },
    h => { h.world.systems[0].fleet.push({ type: 'probe', quantity: 100 }); },
    h => { h.world.systems[1].q += 1; },
    h => { h.world.systems.push(clone(h.world.systems[0])); },
    h => { h.world.systems[0].owned = false; }];
  for (const mutate of cases) {
    const h = harness(); h.engine.save(route()); h.engine.tick();
    assert.equal(h.engine.canRunJob(h.queueJobs[0]), true);
    mutate(h); assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
  }
});

test('the same in-flight route or a hidden origin touching either endpoint blocks regardless of ETA', () => {
  for (const [fromQ, fromR, toQ, toR] of [[0, 0, 5, -2], [null, null, 0, 0], [null, null, 5, -2]]) {
    const h = harness(); h.engine.save(route());
    h.world.transits.push({ fromQ, fromR, toQ, toR, ships: [], arrivesAt: '1970-01-01T00:00:01Z' });
    h.engine.tick(); assert.equal(h.calls.length, 0);
    assert.deepEqual(h.engine.dueOrigins(), []);
  }
  const h = harness(); h.engine.save(route()); h.engine.tick();
  h.world.transits.push({ fromQ: 0, fromR: 0, toQ: 5, toR: -2 });
  assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
});

test('unrelated transits do not block owned reinforcement endpoints', () => {
  const h = harness(); h.engine.save(route());
  h.world.transits.push({ fromQ: 80, fromR: 80, toQ: 90, toR: 90 });
  assert.equal(h.engine.tick().queued.length, 1);
});

test('independent sources can reinforce the same destination without counting future arrivals', () => {
  const h = harness(); h.engine.save(route());
  h.world.transits.push({ fromQ: 8, fromR: 9, toQ: 5, toR: -2, ships: [{ type: 'probe', quantity: 9999 }] });
  assert.equal(h.engine.tick().queued.length, 1);
  assert.equal(h.calls[0].spec.quantities.probe, 80);
  const empty = harness(); empty.world.systems[0].fleet = fleet(0); empty.engine.save(route());
  empty.world.transits.push({ fromQ: 8, fromR: 9, toQ: 0, toR: 0, ships: [{ type: 'probe', quantity: 9999 }] });
  assert.deepEqual(empty.engine.dueOrigins(), []);
  empty.engine.tick(); assert.equal(empty.calls.length, 0);
});

test('scope switches isolate stores and revoke old-ticket click authority', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); const original = clone(h.queueJobs[0]);
  h.context.scope = `another/${PLAYER}`;
  assert.deepEqual(h.engine.list(), []);
  assert.equal(h.engine.canRunJob(original), false);
  h.engine.save(route({ id: 'other-scope' }));
  assert.equal(h.storage.size, 2);
  assert.equal(h.storage.get(SCOPE).routes[0].id, 'north');
  h.context.scope = SCOPE;
  assert.equal(h.engine.list()[0].id, 'north');
});

test('failed or silently lost preclaim writes create zero queue calls', () => {
  for (const field of ['failWrite', 'ignoreWrite']) {
    const h = harness(); h.engine.save(route()); h[field] = true;
    assert.ok(h.engine.tick().error);
    assert.equal(h.calls.length, 0);
    assert.equal(h.storage.get(SCOPE).routes[0].ticket, null);
  }
});

test('storage failures never notify into a self-scheduling microtask retry loop', async () => {
  const h = harness(); h.engine.save(route()); const changes = h.changes;
  let scheduled = 0;
  h.onChange = () => { if (++scheduled < 10) queueMicrotask(() => h.engine.tick()); };
  h.failWrite = true;
  assert.ok(h.engine.tick().error);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduled, 0);
  assert.equal(h.changes, changes);
  assert.equal(h.calls.length, 0);
});

test('a reentrant pause, scope change, or coordination loss after preclaim prevents queueing', () => {
  for (const action of ['pause', 'scope', 'coordinated']) {
    const h = harness(); h.engine.save(route());
    h.onChange = () => {
      h.onChange = null;
      if (action === 'pause') h.engine.pause('north');
      else if (action === 'scope') h.context.scope = 'other/player';
      else h.context.coordinated = false;
    };
    h.engine.tick(); assert.equal(h.calls.length, 0, action);
  }
});

test('missing preclaimed ticket pauses for review instead of replaying a possibly sent mission', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.queueJobs = [];
  h.reload().tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.engine.list()[0].paused, true);
  assert.equal(h.engine.list()[0].needsReview, true);
  assert.throws(() => h.engine.resume('north'), /revisión/);
});

test('both uncertain queue outcomes pause; recovered waiting adopts exactly once', () => {
  for (const field of ['queueThrowBefore', 'queueThrowAfter']) {
    const h = harness(); h.engine.save(route()); h[field] = true; h.engine.tick();
    assert.equal(h.engine.list()[0].needsReview, true, field);
    h[field] = false; h.reload().tick(); h.engine.tick();
    assert.equal(h.calls.length, 1, field);
    if (h.queueJobs[0]) assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
  }
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.reload().tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.engine.canRunJob(h.queueJobs[0]), true);
});

test('live sending stays authorized but recovered sending, paused or uncertain requires review', () => {
  const live = harness(); live.engine.save(route()); live.engine.tick(); const claim = live.claim();
  assert.equal(live.engine.canRunJob(claim), true);
  live.engine.tick();
  assert.equal(live.engine.list()[0].paused, false);
  assert.equal(live.engine.canRunJob(claim), true);
  assert.deepEqual(live.engine.dueOrigins(), []);
  for (const status of ['sending', 'paused', 'uncertain']) {
    const h = harness(); h.engine.save(route()); h.engine.tick(); h.queueJobs[0].status = status;
    h.reload();
    assert.equal(h.engine.canRunJob(h.queueJobs[0]), false, status);
    h.engine.tick();
    assert.equal(h.engine.list()[0].needsReview, true, status);
    assert.equal(h.calls.length, 1);
  }
});

test('ticket identity, target semantics, quantities and active claim are revalidated at every click', () => {
  const cases = [job => { job.quantities.probe += 1; }, job => { job.target.missionAction = 'attack'; },
    job => { job.target.mode = 'amounts'; }, job => { job.produce = true; }, job => { job.autoSend = false; },
    job => { job.needsReview = true; }, job => { job.fleetEdit = {}; }, job => { job.campaignId = 'other'; },
    job => { job.target.coordinate.q += 1; }, job => { job.target.presetKey = 'other'; }];
  for (const mutate of cases) {
    const h = harness(); h.engine.save(route()); h.engine.tick(); mutate(h.queueJobs[0]);
    assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
  }
  const h = harness(); h.engine.save(route()); h.engine.tick(); const claim = h.claim();
  h.queueJobs[0].claimedAt += 1;
  assert.equal(h.engine.canRunJob(claim), false);
});

test('scope changes, an invalid scope, or a lost lock permanently revoke a live sending witness', () => {
  for (const change of ['scope', 'invalid-scope', 'lock']) {
    const h = harness(); h.engine.save(route()); h.engine.tick(); const claim = h.claim();
    assert.equal(h.engine.canRunJob(claim), true);
    if (change === 'scope') h.context.scope = 'other/player';
    else if (change === 'invalid-scope') h.context.scope = '';
    else h.context.coordinated = false;
    assert.equal(h.engine.canRunJob(claim), false);
    h.context.scope = SCOPE; h.context.coordinated = true;
    assert.equal(h.engine.canRunJob(claim), false);
    h.engine.tick(); assert.equal(h.engine.list()[0].needsReview, true);
  }
});

test('observer reconnection revokes a live claim while ordinary revisions leave it intact', () => {
  const h = harness(); Object.assign(h.world, { epoch: 1, generation: 1, revision: 1 });
  h.engine.save(route()); h.engine.tick(); const claim = h.claim();
  h.world.revision += 1;
  assert.equal(h.engine.canRunJob(claim), true);
  h.world.generation += 1;
  assert.equal(h.engine.canRunJob(claim), false);
  h.engine.tick(); assert.equal(h.engine.list()[0].needsReview, true);
});

test('invalid native claim timestamps and a moved waiting destination never authorize work', () => {
  for (const patch of [{ claimedAt: null }, { claimedAt: -1 }, { claimedAt: 1000001 }, { createdAt: 999999 }, { sentAt: 1 }]) {
    const h = harness(); h.engine.save(route()); h.engine.tick(); h.claim();
    Object.assign(h.queueJobs[0], patch);
    assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
  }
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.world.systems[1].q += 1;
  assert.deepEqual(h.engine.dueOrigins(), []);
});

test('pause revokes authority before cancellation, resume starts fresh, edits cannot reuse IDs', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick();
  const first = clone(h.queueJobs[0]); h.engine.pause('north');
  assert.equal(h.cancelGuard, false);
  assert.equal(h.queueJobs.length, 0);
  assert.equal(h.engine.list()[0].ticket, null);
  assert.equal(h.engine.canRunJob(first), false);
  h.engine.pause('north', false); h.engine.tick();
  assert.equal(h.calls[1].options.id, 'route:north:2');
  h.engine.save(route({ destinationId: C })); h.engine.tick();
  assert.equal(h.calls[2].options.id, 'route:north:3');
  assert.deepEqual(h.calls[2].spec.target.coordinate, { q: 8, r: 9 });
});

test('failed cancellation retains paused intent and blocks resume or replacement', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.cancelError = true;
  h.engine.pause('north');
  assert.equal(h.engine.list()[0].paused, true);
  assert.ok(h.engine.list()[0].ticket);
  assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
  assert.throws(() => h.engine.resume('north'), /resuelta/);
  assert.throws(() => h.engine.save(route()), /resolver/);
  h.cancelError = false; h.engine.resume('north'); h.engine.tick();
  assert.equal(h.calls.length, 2);
});

test('pause during sending requires review and removal never cancels an active send', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); const claim = h.claim();
  h.engine.pause('north');
  assert.equal(h.engine.list()[0].needsReview, true);
  assert.equal(h.engine.canRunJob(claim), false);
  assert.throws(() => h.engine.resume('north'), /revisión/);
  assert.throws(() => h.engine.remove('north'), /He revisado el envío/);
  assert.equal(h.queueJobs[0].status, 'sending');
  assert.equal(h.engine.list()[0].needsReview, true);
  assert.equal(h.engine.canRunJob(claim), false);
  h.engine.save(route({ id: 'replacement' })); h.engine.tick();
  assert.equal(h.calls.length, 1);
});

test('delete and recreate retain durable ticket sequence and cannot authorize an old claim', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); const old = clone(h.queueJobs[0]);
  h.engine.remove('north'); assert.equal(h.queueJobs.length, 0);
  h.reload(); h.engine.save(route()); h.engine.tick();
  assert.equal(h.calls[1].options.id, 'route:north:2');
  assert.equal(h.engine.canRunJob(old), false);
});

test('the next interval starts at confirmed sent time and a forward clock jump never creates catch-up bursts', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick();
  h.advance(20000); h.sent(); const sentAt = h.at; h.engine.tick();
  assert.equal(h.engine.list()[0].lastSentAt, sentAt);
  assert.equal(h.engine.list()[0].nextRunAt, sentAt + 5 * 60000);
  h.advance(5 * 60000 - 1); h.engine.tick(); assert.equal(h.calls.length, 1);
  h.advance(7 * 86400000); h.engine.tick();
  assert.equal(h.calls.length, 2);
  for (let i = 0; i < 20; i++) h.engine.tick();
  assert.equal(h.calls.length, 2);
  h.sent(); h.engine.tick();
  assert.equal(h.engine.list()[0].nextRunAt, h.at + 5 * 60000);
  assert.equal(h.calls.length, 2);
});

test('post-send planning requires a snapshot observed after the send confirmation', () => {
  const h = harness(); h.engine.save(route({ intervalMinutes: 1 })); h.engine.tick();
  h.advance(1000, false); h.sent(); h.engine.tick();
  const sentAt = h.at;
  h.advance(60000, false); h.engine.tick();
  assert.equal(h.calls.length, 1);
  h.world.observedAt = sentAt; h.engine.tick();
  assert.equal(h.calls.length, 1, 'same millisecond as acceptance is not a post-send census');
  h.world.observedAt = h.at; h.engine.tick();
  assert.equal(h.calls.length, 2);
});

test('invalid stored configuration fails closed and cannot silently reset a durable ledger', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); const job = clone(h.queueJobs[0]);
  h.storage.get(SCOPE).schemaVersion = 99;
  assert.ok(h.engine.state().error);
  assert.deepEqual(h.engine.list(), []);
  assert.equal(h.engine.canRunJob(job), false);
  assert.throws(() => h.engine.save(route()));
  assert.equal(h.engine.tick().queued.length, 0);
  assert.equal(h.storage.get(SCOPE).schemaVersion, 99);
});

test('list, state and stable ticks emit no change notifications and callers cannot mutate state', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick();
  h.engine.tick(); const changes = h.changes;
  h.engine.state(); const rows = h.engine.list(); rows[0].paused = true;
  for (let i = 0; i < 5; i++) h.engine.tick();
  assert.equal(h.engine.list()[0].paused, false);
  assert.equal(h.changes, changes);
});

test('reentrant ticks during notifications cannot reserve or queue a duplicate mission', () => {
  const h = harness(); h.engine.save(route());
  h.onChange = () => h.engine.tick();
  h.engine.tick();
  assert.equal(h.calls.length, 1);
});

test('receipt regression: sent then pause/resume preserves acceptance and cooldown before reconciliation', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.sent();
  const sentAt = h.at;
  h.engine.pause('north'); h.engine.resume('north'); h.engine.tick();
  assert.equal(h.calls.length, 1, 'the same accepted fleet cannot be queued again');
  assert.equal(h.engine.list()[0].lastSentAt, sentAt);
  assert.equal(h.engine.list()[0].nextRunAt, sentAt + 5 * 60000);
  h.advance(1); h.engine.tick();
  assert.equal(h.calls.length, 1, 'a newer census does not waive the interval');
});

test('receipt regression: saving a sent route cannot reset its timestamp or shorten the old interval', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.sent();
  const sentAt = h.at;
  h.engine.save(route({ intervalMinutes: 1 })); h.advance(1); h.engine.tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.engine.list()[0].lastSentAt, sentAt);
  assert.equal(h.engine.list()[0].nextRunAt, sentAt + 5 * 60000);
});

test('receipt regression: removing and recreating under a new id after reload preserves the origin cooldown', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.sent();
  h.engine.remove('north'); h.reload();
  h.engine.save(route({ id: 'replacement', destinationId: C, intervalMinutes: 1 }));
  h.advance(1); h.engine.tick();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.engine.dueOrigins(), []);
});

test('receipt regression: invalid sent timestamps pause for review instead of cancelling evidence', () => {
  for (const sentAt of [null, -1, 999999, 1000001, '1000000']) {
    const h = harness(); h.engine.save(route()); h.engine.tick(); h.sent(); h.queueJobs[0].sentAt = sentAt;
    const paused = h.engine.pause('north');
    assert.equal(paused.needsReview, true, String(sentAt));
    assert.equal(h.queueJobs.length, 1, 'retain evidence of an invalid confirmation');
    assert.throws(() => h.engine.resume('north'));
  }
});

test('receipt deadlines survive repeated controls; a longer interval expands but a shorter one never reduces it', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.sent(); h.engine.tick();
  const sentAt = h.at;
  h.engine.pause('north'); h.engine.resume('north');
  assert.equal(h.engine.list()[0].nextRunAt, sentAt + 300000);
  h.engine.save(route({ intervalMinutes: 10 }));
  h.engine.save(route({ intervalMinutes: 1 }));
  assert.equal(h.engine.list()[0].nextRunAt, sentAt + 600000);
  assert.deepEqual(h.engine.state().receipts, [{ originId: A, lastSentAt: sentAt, nextRunAt: sentAt + 600000 }]);
  h.engine.remove('north'); h.reload(); h.engine.save(route({ id: 'new', intervalMinutes: 1 }));
  h.advance(599999); h.engine.tick(); assert.equal(h.calls.length, 1);
  h.advance(1); h.engine.tick(); assert.equal(h.calls.length, 2);
});

test('one origin receipt blocks every route from that origin but never an independent source', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.sent(); h.engine.tick();
  h.engine.save(route({ id: 'same-origin', destinationId: C }));
  h.engine.save(route({ id: 'independent', originId: C }));
  h.advance(1);
  assert.deepEqual(h.engine.dueOrigins(), [C]);
  h.context.originId = C; h.engine.tick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].spec.originId, C);
});

test('changing a route to a different origin preserves the old origin receipt without inheriting its cooldown', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.sent();
  h.engine.save(route({ originId: C }));
  assert.equal(h.engine.list()[0].lastSentAt, null);
  assert.equal(h.engine.state().receipts[0].originId, A);
  h.context.originId = C; h.engine.tick();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].spec.originId, C);
});

test('a receipt written after queueing revokes the click guard and navigation for that origin', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick();
  h.storage.get(SCOPE).receipts = [{ originId: A, lastSentAt: h.at, nextRunAt: h.at + 300000 }];
  assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
  assert.deepEqual(h.engine.dueOrigins(), []);
  h.engine.tick(); assert.equal(h.calls.length, 1);
});

test('old schema 1 stores migrate known send history before removal without losing cooldowns', () => {
  const h = harness(); h.engine.save(route());
  const stored = h.storage.get(SCOPE);
  delete stored.receipts;
  stored.routes[0].lastSentAt = h.at;
  stored.routes[0].nextRunAt = h.at + 300000;
  h.reload();
  assert.deepEqual(h.engine.state().receipts, [{ originId: A, lastSentAt: h.at, nextRunAt: h.at + 300000 }]);
  h.engine.remove('north');
  assert.equal(h.storage.get(SCOPE).schemaVersion, 1);
  assert.equal(h.storage.get(SCOPE).receipts.length, 1);
  h.engine.save(route({ id: 'new', intervalMinutes: 1 })); h.advance(1); h.engine.tick();
  assert.equal(h.calls.length, 0);
});

test('receipt schema rejects malformed, duplicate and oversized origin histories', () => {
  const valid = { originId: A, lastSentAt: 10, nextRunAt: 20 };
  for (const receipts of [null, {}, [valid, valid], [{ ...valid, lastSentAt: -1 }], [{ ...valid, nextRunAt: 9 }],
    [{ ...valid, originId: 'bad' }], Array.from({ length: core.MAX_RECEIPTS + 1 }, () => valid)]) {
    const h = harness(); h.engine.save(route()); h.storage.get(SCOPE).receipts = receipts;
    assert.ok(h.engine.state().error);
    h.engine.tick(); assert.equal(h.calls.length, 0);
  }
});

test('a full receipt registry blocks new origins before queueing and active tickets reserve capacity', () => {
  const make = (h, length) => Array.from({ length }, (_, i) => ({ originId: `feed0000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`,
    lastSentAt: h.at, nextRunAt: h.at + 300000 }));
  const full = harness(); full.engine.save(route()); full.storage.get(SCOPE).receipts = make(full, core.MAX_RECEIPTS);
  assert.deepEqual(full.engine.dueOrigins(), []);
  full.engine.tick(); assert.equal(full.calls.length, 0);
  const h = harness(); h.engine.save(route()); h.engine.save(route({ id: 'other', originId: C }));
  h.storage.get(SCOPE).receipts = make(h, core.MAX_RECEIPTS - 1);
  h.engine.tick(); assert.equal(h.calls.length, 1);
  h.context.originId = C; h.engine.tick();
  assert.equal(h.calls.length, 1, 'the last slot is already reserved by the first outstanding ticket');
  h.sent(); h.engine.tick();
  assert.equal(h.engine.state().receipts.length, core.MAX_RECEIPTS);
  assert.equal(h.engine.state().receipts.find(item => item.originId === A).lastSentAt, h.at);
});

test('receipt cleanup needs an expired deadline, a later owned-origin census and no outstanding ticket', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.sent(); h.engine.tick();
  h.engine.pause('north'); const sentAt = h.at, deadline = h.at + 300000;
  h.advance(300000); h.engine.tick(); assert.equal(h.engine.state().receipts.length, 1, 'keep exact deadline');
  h.advance(1); h.world.systems = h.world.systems.filter(row => row.id !== A);
  h.engine.tick(); assert.equal(h.engine.state().receipts.length, 1, 'missing ownership is not cleanup proof');
  h.world.systems.push({ id: A, q: 0, r: 0, name: 'Origin', fleet: fleet() });
  h.world.observedAt = sentAt;
  h.engine.tick(); assert.equal(h.engine.state().receipts.length, 1, 'old census is not cleanup proof');
  h.world.observedAt = h.at; h.engine.tick();
  assert.equal(h.engine.state().receipts.length, 0);
  const active = harness(); active.engine.save(route()); active.engine.tick();
  active.storage.get(SCOPE).receipts = [{ originId: A, lastSentAt: active.at - 10, nextRunAt: active.at - 1 }];
  active.engine.tick(); assert.equal(active.engine.state().receipts.length, 1, 'ticket still needs its retained record');
  assert.ok(deadline < h.at);
});

test('failed receipt persistence keeps sent evidence and cannot authorize replay or cancellation', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.sent();
  h.failWrite = true;
  assert.throws(() => h.engine.pause('north'));
  assert.equal(h.queueJobs[0].status, 'sent');
  assert.ok(h.engine.list()[0].ticket);
  assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
  h.engine.tick(); assert.equal(h.calls.length, 1);
  h.failWrite = false; h.engine.pause('north');
  assert.equal(h.engine.state().receipts.length, 1);
});

test('uncertain or missing missions remain visible on delete and block other routes from that origin', () => {
  for (const missing of [false, true]) {
    const h = harness(); h.engine.save(route()); h.engine.tick();
    if (missing) h.queueJobs = []; else h.queueJobs[0].status = 'uncertain';
    assert.throws(() => h.engine.remove('north'), /He revisado el envío/);
    assert.equal(h.engine.list()[0].needsReview, true);
    assert.equal(h.engine.list()[0].paused, true);
    h.engine.save(route({ id: 'other', destinationId: C }));
    h.engine.tick(); assert.equal(h.calls.length, 1);
    assert.deepEqual(h.engine.dueOrigins(), []);
  }
});

test('a removed sending attempt stays visible until its definitive sent result can preserve a receipt', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.claim();
  assert.throws(() => h.engine.remove('north'));
  assert.throws(() => h.engine.acknowledgeRoute('north'), /sigue en curso/);
  h.sent(); assert.equal(h.engine.remove('north'), true);
  assert.equal(h.engine.state().receipts.length, 1);
  h.reload(); h.engine.save(route({ id: 'new' })); h.advance(1); h.engine.tick();
  assert.equal(h.calls.length, 1);
});

test('explicit review of an absent or uncertain job records conservative acceptance and leaves the route paused', () => {
  for (const missing of [false, true]) {
    const h = harness(); h.engine.save(route()); h.engine.tick();
    if (missing) h.queueJobs = []; else h.queueJobs[0].status = 'uncertain';
    h.engine.tick(); h.advance(1000);
    const reviewedAt = h.at, result = h.engine.acknowledgeRoute('north');
    assert.equal(result.paused, true);
    assert.equal(result.needsReview, false);
    assert.equal(result.ticket, null);
    assert.equal(result.lastSentAt, reviewedAt);
    assert.equal(result.nextRunAt, reviewedAt + 300000);
    assert.equal(h.queueJobs.length, 0);
    h.engine.resume('north'); h.engine.tick(); assert.equal(h.calls.length, 1);
    h.advance(300000); h.world.observedAt = reviewedAt; h.engine.tick(); assert.equal(h.calls.length, 1);
    h.world.observedAt = h.at; h.engine.tick(); assert.equal(h.calls.length, 2);
  }
});

test('explicit review preserves altered jobs and keeps review evidence after a failed cancellation', () => {
  const altered = harness(); altered.engine.save(route()); altered.engine.tick();
  altered.queueJobs[0].target.label = 'Altered'; altered.engine.tick();
  assert.throws(() => altered.engine.acknowledgeRoute('north'), /no se retirará/);
  assert.equal(altered.queueJobs.length, 1);
  assert.equal(altered.engine.list()[0].needsReview, true);
  const h = harness(); h.engine.save(route()); h.engine.tick(); h.queueJobs[0].status = 'uncertain'; h.engine.tick();
  h.cancelError = true;
  assert.throws(() => h.engine.acknowledgeRoute('north'), /No se pudo retirar/);
  assert.equal(h.engine.list()[0].needsReview, true);
  assert.ok(h.engine.list()[0].ticket);
  assert.equal(h.engine.state().receipts.length, 1);
  assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
  h.cancelError = false; assert.equal(h.engine.acknowledgeRoute('north').needsReview, false);
});

test('explicit review cannot skip its durable barrier or act after a scope switch', () => {
  for (const mode of ['write', 'scope']) {
    const h = harness(); h.engine.save(route()); h.engine.tick(); h.queueJobs[0].status = 'uncertain'; h.engine.tick();
    if (mode === 'write') h.failWrite = true;
    else h.onChange = () => { h.onChange = null; h.context.scope = 'other/player'; };
    assert.throws(() => h.engine.acknowledgeRoute('north'));
    assert.equal(h.queueJobs.length, 1);
    assert.equal(h.storage.get(SCOPE).routes[0].needsReview, true);
  }
});

test('route diagnostics explain empty queue without changing intent or creating a send', () => {
  const h = harness(); h.engine.save(route());
  const before = clone([...h.storage]); const changes = h.changes;
  const inspect = block => h.engine.diagnostics(block).routes[0];
  assert.equal(inspect().code, 'ready');
  assert.equal(inspect().checkedAt, h.at);
  assert.equal(inspect().lastSentAt, null);
  h.world.systems[0].fleet = fleet(20, 0);
  assert.equal(inspect().code, 'no-ships');
  assert.match(inspect().message, /reserva/);
  h.world.systems[0].fleet = fleet();
  h.world.observedAt = h.at - 120001;
  assert.equal(inspect().code, 'stale-census');
  h.world.observedAt = h.at;
  h.world.transits = [{fromQ:0, fromR:0, toQ:5, toR:-2}];
  assert.equal(inspect().code, 'transit');
  h.world.transits = [];
  assert.equal(inspect({code:'hud',message:'Abre Structures o Shipyard para continuar.'}).code, 'hud');
  h.context.coordinated = false;
  assert.equal(inspect().code, 'coordination');
  assert.deepEqual([...h.storage], before);
  assert.equal(h.changes, changes); assert.equal(h.calls.length, 0); assert.equal(h.queueJobs.length, 0);
});

test('route diagnostics distinguish interval, missing own endpoints and insufficient fixed fleet', () => {
  const h = harness(); h.engine.save(route({ships:{probe:{mode:'fixed',amount:200,reserve:10}}}));
  assert.equal(h.engine.diagnostics().routes[0].code, 'insufficient-ships');
  h.world.systems = h.world.systems.filter(s => s.id !== B);
  assert.equal(h.engine.diagnostics().routes[0].code, 'endpoints');
  h.world.systems.push({id:B,q:5,r:-2,name:'Destination',fleet:fleet(0)});
  const s = h.storage.get(SCOPE); s.routes[0].nextRunAt = h.at + 15000;
  const d = h.engine.diagnostics().routes[0];
  assert.equal(d.code, 'interval'); assert.equal(d.nextRunAt, h.at + 15000);
  assert.equal(d.lastSentAt, null); assert.match(d.message, /15 s/);
  h.advance(15000); assert.equal(h.engine.diagnostics().routes[0].code, 'insufficient-ships');
});

test('route diagnostics do not authorize a recovered sending claim or reconcile a ticket', () => {
  const h = harness(); h.engine.save(route()); h.engine.tick();
  h.queueJobs[0].status = 'sending'; h.queueJobs[0].claimedAt = h.at;
  h.reload(); const before = clone([...h.storage]);
  assert.equal(h.engine.diagnostics().routes[0].code, 'sending');
  assert.equal(h.engine.canRunJob(h.queueJobs[0]), false);
  assert.deepEqual([...h.storage], before);
  assert.equal(h.calls.length, 1);
});

test('send now bypasses only cooldown and queues capped available types with reserves', () => {
  const h = harness();
  h.engine.save(route({ships:{probe:{mode:'fixed',amount:150,reserve:20},marauder:{mode:'excess',reserve:5}}}));
  h.storage.get(SCOPE).routes[0].nextRunAt = h.at + 900000;
  assert.equal(h.engine.tick().queued.length,0);
  const result=h.engine.sendNow('north');assert.equal(result.queued.length,1);
  assert.deepEqual(h.queueJobs[0].quantities,{probe:80,marauder:15,sentinel:0,vanguard:0});
  assert.equal(h.engine.list()[0].ticket.manual,true);
  assert.equal(h.engine.canRunJob(h.queueJobs[0]),true);
  assert.throws(()=>h.engine.sendNow('north'),/pendiente/);
  assert.equal(h.calls.length,1);
  h.world.systems[0].fleet=fleet(99,20);
  assert.equal(h.engine.canRunJob(h.queueJobs[0]),false,'live fleet must still cover frozen quantities plus reserve');
  h.world.systems[0].fleet=fleet();
  assert.equal(h.engine.canRunJob(h.claim()),true);
  h.sent();h.engine.tick();assert.equal(h.engine.list()[0].ticket,null);
  assert.equal(h.engine.list()[0].lastSentAt,h.at);
  assert.throws(()=>h.engine.sendNow('north'),/censo/,'confirmation requires a newer census even for manual requests');
  assert.equal(h.calls.length,1);
});
for (const [name,change] of [
 ['paused',h=>h.engine.pause('north')],['review',h=>Object.assign(h.storage.get(SCOPE).routes[0],{paused:true,needsReview:true,status:'review'})],
 ['coordination',h=>h.context.coordinated=false],['inactive',h=>h.context.canAct=false],['origin',h=>h.context.originId=C],
 ['stale',h=>h.world.observedAt=h.at-120001],['owner',h=>h.world.systems=h.world.systems.filter(s=>s.id!==B)],
 ['empty',h=>h.world.systems[0].fleet=fleet(0,0)],['transit',h=>h.world.transits=[{fromQ:0,fromR:0,toQ:5,toR:-2}]],
 ['unknown transit',h=>h.world.transits=[{fromQ:null,fromR:null,toQ:5,toR:-2}]],
 ['pending origin',h=>h.queueJobs.push({id:'manual',scope:SCOPE,originId:A,status:'waiting'})],
])test('send now preserves '+name+' barrier with zero queue effects',()=>{
 const h=harness();h.engine.save(route());change(h);const before=clone([...h.storage]);
 assert.equal(typeof h.engine.sendNow,'function');
 assert.throws(()=>h.engine.sendNow('north'));assert.equal(h.calls.length,0);assert.deepEqual([...h.storage],before);
});
test('send now rechecks policy, leadership and scope after durable ticket under reentrancy',()=>{
 for(const change of [h=>h.context.coordinated=false,h=>h.context.scope='other/self',h=>h.engine.pause('north')]){
  const h=harness();h.engine.save(route());h.onChange=()=>{h.onChange=null;change(h);};
  assert.throws(()=>h.engine.sendNow('north'));assert.equal(h.calls.length,0);
 }
});
test('send now shares one durable ticket across same-origin routes, reload and concurrent clients',()=>{
 const h=harness();h.engine.save(route());h.engine.save(route({id:'other',destinationId:C}));
 const second=core.create(h.dependencies);
 assert.equal(h.engine.sendNow('north').queued.length,1);
 assert.throws(()=>second.sendNow('north'),/pendiente/);
 assert.throws(()=>second.sendNow('other'),/envío|misión/);
 h.reload();assert.equal(h.engine.canRunJob(h.claim()),false,'recovered sending cannot acquire live witness');
 assert.equal(h.calls.length,1);
});
test('countdown deadline tracks receipts and interval edits while pause never clears cooldown',()=>{
 const h=harness();h.engine.save(route());h.engine.tick();h.sent();h.engine.tick();
 const original=h.at+300000;assert.equal(h.engine.diagnostics().routes[0].nextRunAt,original);
 h.engine.save(route({intervalMinutes:1}));assert.equal(h.engine.diagnostics().routes[0].nextRunAt,original);
 h.engine.save(route({intervalMinutes:15}));assert.equal(h.engine.diagnostics().routes[0].nextRunAt,h.at+900000);
 h.engine.pause('north');h.advance(1000);h.engine.resume('north');assert.equal(h.engine.diagnostics().routes[0].nextRunAt,1000000+900000);
 h.advance(899000);assert.equal(h.engine.diagnostics().routes[0].code,'ready');
 assert.equal(h.calls.length,1,'expiry observation alone cannot queue');
});
