'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const start = source.indexOf('// BEGIN FLEET WAIT QUEUE');
const end = source.indexOf('// END FLEET WAIT QUEUE', start);
assert.ok(start >= 0 && end > start, 'fleet wait queue markers exist');
// Public queue snapshots cross the VM boundary as serialized data; use the host
// JSON implementation so assertions compare values, not realm-specific prototypes.
const sandbox = vm.createContext({ TextEncoder, Date, structuredClone, JSON });
vm.runInContext(source.slice(start, end) + '\nthis.factory = createFleetWaitQueue;', sandbox);
const copy = value => structuredClone(value);
const ships = ['probe', 'marauder', 'sentinel', 'vanguard'];
const counts = (extra = {}) => ({ probe: 0, marauder: 9, sentinel: 0, vanguard: 1, ...extra });
const scope = 'andromeda/player';
const originId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const route = { routeKey: '<native-route>original</native-route>', label: 'Destination',
  coordinate: { q: -93, r: 266 }, presetKey: 'Use 9 Marauder 1 Vanguard' };

function harness(options = {}) {
  let stored = copy(options.stored || {}), clock = 1000, failSave = false, queue;
  let fleet = Object.fromEntries(ships.map(id => [id, { parked: 50000, away: 0, building: 0 }]));
  const writes = [], dispatched = [];
  const context = { scope, originId, active: true, canAct: true };
  const deps = {
    now: () => clock,
    load: () => copy(stored),
    save: value => { if (failSave) throw new Error('storage unavailable'); stored = copy(value); writes.push(copy(value)); },
    getContext: () => copy(context), getFleet: () => copy(fleet),
    dispatch: options.dispatch || (async job => { dispatched.push(copy(job)); return { status: 'sent' }; }),
  };
  queue = sandbox.factory(deps);
  return {
    get queue() { return queue; }, writes, dispatched, context,
    get stored() { return copy(stored); }, set stored(value) { stored = copy(value); },
    set failSave(value) { failSave = value; }, set now(value) { clock = value; },
    set fleet(value) { fleet = copy(value); },
    reload() { queue.destroy(); queue = sandbox.factory(deps); return queue; },
    add(extra = {}, id = 'mission:one') {
      return queue.queue({ scope, originId, originName: 'Home', target: copy(route),
        quantities: counts(), produce: true, autoSend: true, ...extra }, { id });
    },
  };
}

test('opening a fleet editor durably holds a ready mission and its production until applied', async () => {
  const h = harness(), original = h.add();
  let edited = h.queue.beginFleetEdit(original.id);
  assert.equal(edited.status, 'paused');
  assert.equal(edited.fleetEdit.resumeStatus, 'waiting');
  assert.deepEqual(edited.fleetEdit.drafts, { probe: '0', marauder: '9', sentinel: '0', vanguard: '1' });
  assert.equal(h.stored.jobs[0].status, 'paused');
  assert.equal(h.queue.productionDemand(h.context, {}), null);
  await h.queue.tick(); assert.equal(h.dispatched.length, 0);

  edited = h.queue.setFleetDraft(original.id, 'marauder', '0', { expected: edited });
  edited = h.queue.setFleetDraft(original.id, 'probe', '3', { expected: edited });
  assert.deepEqual(edited.quantities, original.quantities, 'drafts do not change the runnable fleet');
  assert.equal(h.stored.jobs[0].fleetEdit.drafts.probe, '3');
  edited = h.queue.applyFleetEdit(original.id, { expected: edited });
  assert.equal(edited.fleetEdit, undefined);
  assert.equal(edited.status, 'waiting');
  assert.deepEqual(edited.quantities, counts({ marauder: 0, probe: 3 }));
  assert.deepEqual(edited.target, { ...route, mode: 'custom' });
  await h.queue.tick();
  assert.equal(h.dispatched.length, 1);
  assert.deepEqual(h.dispatched[0].quantities, edited.quantities);
});

test('drafts including invalid and all-zero input survive reload while the mission remains held', async () => {
  const h = harness(), original = h.add();
  let edited = h.queue.beginFleetEdit(original.id);
  edited = h.queue.setFleetDraft(original.id, 'marauder', '', { expected: edited });
  h.reload();
  edited = h.queue.getFleetEdit(original.id);
  assert.equal(edited.fleetEdit.drafts.marauder, '');
  assert.throws(() => h.queue.applyFleetEdit(original.id, { expected: edited }), /cantidad|número|entero/i);
  await h.queue.tick(); assert.equal(h.dispatched.length, 0);
  for (const id of ships) edited = h.queue.setFleetDraft(original.id, id, '0', { expected: edited });
  assert.throws(() => h.queue.applyFleetEdit(original.id, { expected: edited }), /vac|una nave|flota/i);
  assert.equal(h.queue.getFleetEdit(original.id).status, 'paused');
  assert.equal(h.queue.productionDemand(h.context, {}), null);
});

test('each saved draft returns a new snapshot and a stale editor cannot overwrite a newer change', () => {
  const h = harness(), job = h.add();
  const first = h.queue.beginFleetEdit(job.id);
  const latest = h.queue.setFleetDraft(job.id, 'probe', '4', { expected: first });
  assert.throws(() => h.queue.setFleetDraft(job.id, 'vanguard', '2', { expected: first }), /cambi|actual|edici/i);
  assert.throws(() => h.queue.applyFleetEdit(job.id, { expected: first }), /cambi|actual|edici/i);
  assert.throws(() => h.queue.cancelFleetEdit(job.id, { expected: first }), /cambi|actual|edici/i);
  assert.deepEqual(h.queue.getFleetEdit(job.id), latest);
});

test('expected snapshot compares the full saved intent, including changes from another tab', () => {
  const h = harness(), job = h.add();
  let edited = h.queue.beginFleetEdit(job.id);
  const external = h.stored; external.jobs[0].autoSend = false; h.stored = external;
  assert.throws(() => h.queue.setFleetDraft(job.id, 'probe', '2', { expected: edited }), /cambi|actual|edici/i);
  edited = h.queue.getFleetEdit(job.id);
  assert.equal(edited.autoSend, false);
  assert.equal(edited.fleetEdit.drafts.probe, '0');
});

test('cancel restores the original intent without changing its preset or counts', () => {
  const h = harness(), job = h.add();
  let edited = h.queue.beginFleetEdit(job.id);
  edited = h.queue.setFleetDraft(job.id, 'marauder', '123', { expected: edited });
  const restored = h.queue.cancelFleetEdit(job.id, { expected: edited });
  assert.equal(restored.status, 'waiting');
  assert.equal(restored.fleetEdit, undefined);
  assert.deepEqual(restored.target, job.target);
  assert.deepEqual(restored.quantities, job.quantities);
  h.queue.pause(job.id, 'Paused before editing');
  edited = h.queue.beginFleetEdit(job.id);
  const unchanged = h.queue.applyFleetEdit(job.id, { expected: edited });
  assert.equal(unchanged.status, 'paused', 'applying never resumes a previously paused mission');
});

test('draft hold cannot be bypassed by resume and applying imported drafts stays paused', async () => {
  const h = harness(), job = h.add();
  h.queue.beginFleetEdit(job.id);
  assert.throws(() => h.queue.resume(job.id), /edici|flota/i);
  const exported = h.queue.exportConfig();
  h.queue.importConfig(exported);
  const restored = h.queue.getFleetEdit(job.id);
  assert.equal(restored.fleetEdit.resumeStatus, 'paused');
  const applied = h.queue.applyFleetEdit(job.id, { expected: restored });
  assert.equal(applied.status, 'paused');
  await h.queue.tick(); assert.equal(h.dispatched.length, 0);
});

test('valid custom fleets preserve captured Attack/Send intent and all route identifiers', () => {
  for (const missionAction of ['attack', 'send']) {
    const h = harness(), job = h.add({ target: { ...route, missionAction } });
    let edited = h.queue.beginFleetEdit(job.id);
    edited = h.queue.setFleetDraft(job.id, 'sentinel', '7', { expected: edited });
    const applied = h.queue.applyFleetEdit(job.id, { expected: edited });
    assert.deepEqual(applied.target, { ...route, mode: 'custom', missionAction });
    assert.equal(applied.quantities.sentinel, 7);
  }
});

test('invalid field values remain drafts and cannot become executable quantities', () => {
  for (const value of ['-1', '1.5', '1e2', '50001', 'Infinity', 'NaN']) {
    const h = harness(), job = h.add();
    let edited = h.queue.beginFleetEdit(job.id);
    edited = h.queue.setFleetDraft(job.id, 'probe', value, { expected: edited });
    assert.equal(h.stored.jobs[0].fleetEdit.drafts.probe, value);
    assert.throws(() => h.queue.applyFleetEdit(job.id, { expected: edited }), /cantidad|número|entero/i);
    assert.equal(h.stored.jobs[0].status, 'paused');
  }
});

test('draft API rejects unknown ships, non-text and unbounded values', () => {
  const h = harness(), job = h.add(), edited = h.queue.beginFleetEdit(job.id);
  for (const [ship, value] of [['destroyer', '1'], ['probe', 2], ['probe', '9'.repeat(100)], ['probe', '\n']]) {
    assert.throws(() => h.queue.setFleetDraft(job.id, ship, value, { expected: edited }));
  }
  assert.throws(() => h.queue.applyFleetEdit(job.id, {}));
  assert.deepEqual(h.queue.getFleetEdit(job.id), edited);
});

for (const status of ['sending', 'sent', 'uncertain', 'review']) {
  test(`composition editing rejects a ${status} mission without changing stored state`, () => {
    const h = harness(), job = h.add();
    const value = h.stored, item = value.jobs[0];
    item.status = status === 'review' ? 'paused' : status;
    item.claimedAt = 1000; item.sentAt = status === 'sent' ? 1000 : null;
    item.needsReview = ['uncertain', 'review'].includes(status);
    h.stored = value;
    assert.throws(() => h.queue.beginFleetEdit(job.id));
    assert.throws(() => h.queue.setFleetQuantities(job.id, counts({ probe: 2 }), { expected: item }));
    assert.deepEqual(h.stored, value);
  });
}

test('a dispatch already awaiting confirmation cannot be changed', async () => {
  let finish, captured;
  const h = harness({ dispatch: job => { captured = copy(job); return new Promise(resolve => { finish = resolve; }); } });
  const job = h.add();
  const pending = h.queue.tick();
  assert.equal(captured.status, 'sending');
  assert.throws(() => h.queue.beginFleetEdit(job.id));
  assert.throws(() => h.queue.setFleetQuantities(job.id, counts({ probe: 1 }), { expected: captured }));
  finish({ status: 'sent' }); await pending;
  assert.equal(h.queue.list()[0].status, 'sent');
  assert.deepEqual(h.queue.list()[0].quantities, job.quantities);
});

test('campaign low-level fleet update preserves its attack route and flags while ordinary edit APIs reject it', () => {
  const h = harness(), target = { mode: 'amounts', routeKey: '', presetKey: '', label: 'Enemy',
    coordinate: { q: -93, r: 266 }, originCoordinate: { q: -95, r: 260 } };
  let job = h.add({ target }, 'retry:report-1');
  for (const api of ['beginFleetEdit', 'getFleetEdit']) assert.throws(() => h.queue[api](job.id), /campa|reintento/i);
  const prior = copy(job);
  job = h.queue.setFleetQuantities(job.id, counts({ marauder: 12, vanguard: 0, sentinel: 2 }), { expected: job });
  assert.deepEqual(job.target, target);
  assert.equal(job.status, prior.status);
  assert.equal(job.produce, prior.produce); assert.equal(job.autoSend, prior.autoSend);
  assert.equal(job.id, prior.id); assert.equal(job.claimedAt, prior.claimedAt);
  assert.deepEqual(job.quantities, counts({ marauder: 12, vanguard: 0, sentinel: 2 }));
  assert.throws(() => h.queue.setFleetQuantities(job.id, counts(), { expected: prior }), /cambi|actual|edici/i);
});

test('low-level fleet update rejects empty, out-of-limit or redirected fleets', () => {
  const h = harness(), job = h.add();
  for (const values of [counts({ marauder: 0, vanguard: 0 }), counts({ probe: 50001 }), counts({ sentinel: -1 }),
    counts({ vanguard: 1.2 }), { ...counts(), destroyer: 1 }]) {
    assert.throws(() => h.queue.setFleetQuantities(job.id, values, { expected: job }));
  }
  assert.throws(() => h.queue.setFleetQuantities(job.id, counts({ probe: 1 }),
    { expected: job, target: { ...route, mode: 'custom', coordinate: { q: 1, r: 2 } } }));
  assert.deepEqual(h.queue.list()[0], job);
});

test('failed edit persistence keeps the prior durable hold and never sends', async () => {
  const h = harness(), job = h.add();
  let edited = h.queue.beginFleetEdit(job.id);
  edited = h.queue.setFleetDraft(job.id, 'probe', '2', { expected: edited });
  h.failSave = true;
  assert.throws(() => h.queue.applyFleetEdit(job.id, { expected: edited }), /guardar/i);
  assert.equal(h.stored.jobs[0].status, 'paused');
  assert.equal(h.stored.jobs[0].fleetEdit.drafts.probe, '2');
  await h.queue.tick(); assert.equal(h.dispatched.length, 0);
  h.failSave = false;
  const applied = h.queue.applyFleetEdit(job.id, { expected: h.queue.getFleetEdit(job.id) });
  assert.equal(applied.status, 'waiting');
});

test('malformed imported draft and contradictory custom mode data are rejected', () => {
  const h = harness(), job = h.add();
  h.queue.beginFleetEdit(job.id);
  const valid = h.queue.exportConfig();
  const mutations = [
    value => { value.jobs[0].fleetEdit.drafts.probe = 2; },
    value => { delete value.jobs[0].fleetEdit.drafts.sentinel; },
    value => { value.jobs[0].fleetEdit.drafts.destroyer = '1'; },
    value => { value.jobs[0].fleetEdit.resumeStatus = 'sent'; },
    value => { value.jobs[0].status = 'waiting'; },
    value => { value.jobs[0].target = { ...route, mode: 'custom', missionAction: 'trade' }; },
    value => { value.jobs[0].target = { ...route, mode: 'custom', originCoordinate: { q: -95, r: 260 } }; },
  ];
  for (const mutate of mutations) {
    const value = copy(valid); mutate(value);
    assert.throws(() => h.queue.validateConfig(value));
  }
  assert.deepEqual(h.queue.exportConfig(), valid);
});
