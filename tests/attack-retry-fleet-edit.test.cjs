'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const start = source.indexOf('// BEGIN ATTACK RETRY CONTROLLER');
const end = source.indexOf('// END ATTACK RETRY CONTROLLER', start);
assert.ok(start >= 0 && end > start);
const sandbox = vm.createContext({ TextEncoder, Date, structuredClone, JSON });
vm.runInContext(source.slice(start, end) + '\nthis.factory = createAttackRetryController;', sandbox);
const factory = sandbox.factory;
const queueStart = source.indexOf('// BEGIN FLEET WAIT QUEUE');
const queueEnd = source.indexOf('// END FLEET WAIT QUEUE', queueStart);
assert.ok(queueStart >= 0 && queueEnd > queueStart);
vm.runInContext(source.slice(queueStart, queueEnd) + '\nthis.queueFactory = createFleetWaitQueue;', sandbox);
const queueFactory = sandbox.queueFactory;
const clone = value => structuredClone(value);
const scope = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const originId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const amounts = (marauder = 9, extra = {}) => ({ probe: 0, marauder, sentinel: 0, vanguard: 1, ...extra });
const origin = { q: -95, r: 260 };
const destination = { q: -93, r: 266 };

function harness() {
  let clock = 1000, stored = {}, queue = [], controller;
  let failSave = false, failNextFinal = false, failQueue = false, beforeQueueWrite = null;
  const events = [], queueWrites = [], enqueues = [];
  const deps = {
    now: () => clock, load: () => clone(stored), save: value => {
      if (failSave || (failNextFinal && stored.campaigns?.some(item => item.fleetEdit?.pendingQuantities)
          && value.campaigns?.some(item => !item.fleetEdit))) {
        failNextFinal = false; throw new Error('storage unavailable');
      }
      stored = clone(value); return true;
    },
    getContext: () => ({ scope, originId, originName: 'Technocratic Imperium', active: true, canAct: true, selectionCount: 1 }),
    getJobs: () => clone(queue),
    verifyOrigin: async () => ({ originId, name: 'Technocratic Imperium', coordinate: origin }),
    queueOnce: (spec, { id }) => {
      enqueues.push(clone(spec));
      const job = { id, ...clone(spec), status: 'waiting', createdAt: clock, updatedAt: clock,
        claimedAt: null, sentAt: null, needsReview: false, message: '' };
      queue = [...queue.filter(item => item.originId !== spec.originId || item.scope !== spec.scope), job];
      return clone(job);
    },
    setJobFleetQuantities: (id, quantities, { expected }) => {
      if (beforeQueueWrite) { const callback = beforeQueueWrite; beforeQueueWrite = null; callback(); }
      if (failQueue) throw new Error('queue storage unavailable');
      const job = queue.find(item => item.id === id);
      assert.deepEqual(job, expected, 'queue mutation uses the full fresh expected job');
      assert.ok(['waiting', 'paused'].includes(job.status)); assert.equal(job.needsReview, false);
      const update = { ...job, quantities: clone(quantities), updatedAt: Math.max(clock, job.updatedAt) };
      queue = queue.map(item => item.id === id ? update : item);
      queueWrites.push({ job: clone(update), campaign: clone(stored.campaigns[0]) });
      return clone(update);
    },
    pauseJob: id => { const job = queue.find(item => item.id === id); if (job && ['waiting', 'paused'].includes(job.status)) job.status = 'paused'; },
    resumeJob: id => { const job = queue.find(item => item.id === id); if (job) job.status = 'waiting'; },
    cancelJob: id => { queue = queue.filter(item => item.id !== id); },
    send: event => events.push(clone(event)),
  };
  controller = factory(deps);
  return {
    get controller() { return controller; }, get stored() { return clone(stored); }, set stored(value) { stored = clone(value); },
    get queue() { return clone(queue); }, set queue(value) { queue = clone(value); },
    set now(value) { clock = value; }, set failSave(value) { failSave = value; }, set failNextFinal(value) { failNextFinal = value; },
    set failQueue(value) { failQueue = value; }, set beforeQueueWrite(value) { beforeQueueWrite = value; },
    queueWrites, events, enqueues,
    reload() { controller.destroy(); controller = factory(deps); return controller; },
    report(n = 1, quantities = amounts(8), verdict = 'Defeat') {
      return { scope, item: { id: uuid(n), takenAt: clock, title: 'You attacked Mirairot', verdict },
        detail: { id: uuid(n), createdAt: clock, route: {
          from: { ...origin, name: 'Technocratic Imperium', ownerKind: 'owned' },
          to: { ...destination, name: 'Mirairot Sovereignty 001', ownerKind: 'human' },
        }, sections: { battle: {
          attackerShips: Object.entries(quantities).map(([type, quantity]) => ({ type, quantity, kind: 'exact' })),
        } } } };
    },
    async plan(queued = true) {
      controller.setConfig({ enabled: true }); clock = 2000;
      assert.equal(controller.observeReport(this.report()), true);
      if (queued) await controller.tick();
      return clone(controller.exportConfig().campaigns[0]);
    },
    async sent() {
      clock += 1000;
      queue[0] = { ...queue[0], status: 'sent', claimedAt: clock, sentAt: clock, updatedAt: clock };
      await controller.tick();
    },
  };
}

const campaign = h => h.controller.exportConfig().campaigns[0];
function draft(h, expected, ship, value) {
  return h.controller.setFleetDraft(expected.id, ship, value, { expected });
}

test('legacy campaigns remain valid with an absent optional fleet editor', async () => {
  const h = harness(); await h.plan(); const legacy = h.stored;
  delete legacy.campaigns[0].fleetEdit;
  assert.equal(h.controller.validateConfig(legacy).campaigns[0].fleetEdit, null);
});

test('begin edits the authoritative campaign and holds the linked mission without changing its fleet', async () => {
  const h = harness(); const original = await h.plan(), job = h.queue[0];
  const edit = h.controller.beginFleetEdit(original.id);
  assert.deepEqual(edit.fleetEdit.drafts, { probe: '0', marauder: '9', sentinel: '0', vanguard: '1' });
  assert.equal(edit.status, 'queued'); assert.equal(h.controller.canRunJob(job), false);
  assert.deepEqual(h.queue[0], job); assert.deepEqual(edit.quantities, original.quantities);
  await h.controller.tick(); assert.deepEqual(campaign(h), edit); assert.equal(h.enqueues.length, 1);
});

test('every input persists as a draft and reload cannot release the held mission', async () => {
  const h = harness(); const initial = await h.plan(); let edit = h.controller.beginFleetEdit(initial.id);
  edit = draft(h, edit, 'vanguard', ''); edit = draft(h, edit, 'marauder', '12');
  assert.equal(h.stored.campaigns[0].fleetEdit.drafts.vanguard, '');
  assert.equal(h.stored.campaigns[0].fleetEdit.drafts.marauder, '12');
  h.reload(); assert.deepEqual(h.controller.getFleetEdit(edit.id), edit);
  assert.equal(h.controller.canRunJob(h.queue[0]), false);
  assert.throws(() => h.controller.applyFleetEdit(edit.id, { expected: edit }), /entero|número|cantidad/i);
  assert.deepEqual(h.queue[0].quantities, initial.quantities);
});

test('applying mixed composition updates both cards and preserves mission identity and options', async () => {
  const h = harness(); const initial = await h.plan(), beforeJob = h.queue[0];
  let edit = h.controller.beginFleetEdit(initial.id);
  for (const [ship, value] of Object.entries({ probe: '2', marauder: '12', sentinel: '4', vanguard: '0' })) edit = draft(h, edit, ship, value);
  const expected = amounts(12, { probe: 2, sentinel: 4, vanguard: 0 });
  const saved = h.controller.applyFleetEdit(edit.id, { expected: edit });
  assert.deepEqual(saved.quantities, expected); assert.equal(saved.fleetEdit, null);
  assert.deepEqual(h.queue[0].quantities, expected); assert.equal(h.controller.canRunJob(h.queue[0]), true);
  assert.deepEqual({ ...h.queue[0], quantities: beforeJob.quantities }, beforeJob);
  assert.equal(saved.triggerReportId, initial.triggerReportId); assert.equal(saved.retries, 0);
  assert.equal(h.queueWrites.length, 1);
  assert.ok(h.queueWrites[0].campaign.fleetEdit.pendingQuantities, 'the hold is durable before changing the queue');
});

test('Sentinel-only combat fleet is editable without forcing a Marauder into this attempt', async () => {
  const h = harness(); const initial = await h.plan(); let edit = h.controller.beginFleetEdit(initial.id);
  edit = draft(h, edit, 'sentinel', '3'); edit = draft(h, edit, 'marauder', '0'); edit = draft(h, edit, 'vanguard', '0');
  const saved = h.controller.applyFleetEdit(edit.id, { expected: edit });
  assert.deepEqual(saved.quantities, amounts(0, { sentinel: 3, vanguard: 0 }));
});

for (const [ship, value] of [['marauder', '-1'], ['marauder', '1.5'], ['marauder', '1e2'], ['marauder', '50001'], ['marauder', ''], ['marauder', '0']]) {
  test('invalid draft does not modify the committed fleet: ' + value, async () => {
    const h = harness(); const initial = await h.plan(); let edit = h.controller.beginFleetEdit(initial.id);
    edit = draft(h, edit, ship, value);
    assert.throws(() => h.controller.applyFleetEdit(edit.id, { expected: edit }));
    assert.deepEqual(campaign(h).quantities, initial.quantities); assert.deepEqual(h.queue[0].quantities, initial.quantities);
    assert.equal(h.controller.canRunJob(h.queue[0]), false);
  });
}

test('an edited paused campaign and queue remain paused after apply and cancel', async () => {
  const h = harness(); const initial = await h.plan(); h.controller.pause(initial.id);
  let edit = h.controller.beginFleetEdit(initial.id); edit = draft(h, edit, 'marauder', '10');
  const saved = h.controller.applyFleetEdit(edit.id, { expected: edit });
  assert.equal(saved.status, 'paused'); assert.equal(saved.resumeStatus, 'queued'); assert.equal(h.queue[0].status, 'paused');
  edit = h.controller.beginFleetEdit(initial.id); edit = draft(h, edit, 'marauder', '11');
  const discarded = h.controller.cancelFleetEdit(edit.id, { expected: edit });
  assert.equal(discarded.status, 'paused'); assert.equal(h.queue[0].status, 'paused'); assert.equal(discarded.quantities.marauder, 10);
});

test('waiting-origin editing holds verification and queues the chosen fleet only after apply', async () => {
  const h = harness(); const initial = await h.plan(false); let edit = h.controller.beginFleetEdit(initial.id);
  edit = draft(h, edit, 'marauder', '15'); await h.controller.tick(); assert.equal(h.enqueues.length, 0);
  h.controller.applyFleetEdit(edit.id, { expected: edit }); await h.controller.tick();
  assert.equal(h.enqueues.length, 1); assert.equal(h.queue[0].quantities.marauder, 15);
});

for (const status of ['sending', 'sent', 'uncertain']) test('locks the campaign if its unreconciled job is ' + status, async () => {
  const h = harness(); const initial = await h.plan(), queue = h.queue;
  queue[0].status = status; queue[0].claimedAt = 2000;
  if (status === 'sent') queue[0].sentAt = 2000;
  if (status === 'uncertain') queue[0].needsReview = true;
  h.queue = queue; const stored = h.stored;
  assert.throws(() => h.controller.beginFleetEdit(initial.id), /envi|confirm|revisi/i);
  assert.deepEqual(h.stored, stored);
});

test('confirmed sent fleet remains immutable while its campaign awaits the report', async () => {
  const h = harness(); const initial = await h.plan(); await h.sent();
  assert.equal(campaign(h).status, 'awaiting_report');
  assert.throws(() => h.controller.beginFleetEdit(initial.id), /envi|resultado|revisi/i);
  assert.deepEqual(campaign(h).lastSentQuantities, initial.quantities);
});

test('storage failure on begin never changes mission intent', async () => {
  const h = harness(); const initial = await h.plan(); h.failSave = true;
  assert.throws(() => h.controller.beginFleetEdit(initial.id), /guardar/);
  h.failSave = false; assert.equal(campaign(h).fleetEdit, null); assert.equal(h.queueWrites.length, 0);
});

test('queue write failure leaves a persisted recoverable edit and never authorizes either composition', async () => {
  const h = harness(); const initial = await h.plan(); let edit = h.controller.beginFleetEdit(initial.id);
  edit = draft(h, edit, 'marauder', '12'); h.failQueue = true;
  assert.throws(() => h.controller.applyFleetEdit(edit.id, { expected: edit }));
  h.failQueue = false; edit = h.controller.getFleetEdit(edit.id);
  assert.equal(edit.fleetEdit.pendingQuantities.marauder, 12); assert.equal(h.controller.canRunJob(h.queue[0]), false);
  assert.equal(h.queue[0].quantities.marauder, 9); h.reload(); await h.controller.tick();
  edit = h.controller.getFleetEdit(edit.id); h.controller.applyFleetEdit(edit.id, { expected: edit });
  assert.equal(h.queue[0].quantities.marauder, 12); assert.equal(campaign(h).fleetEdit, null);
});

test('final campaign save failure holds the new queue composition until a successful explicit retry', async () => {
  const h = harness(); const initial = await h.plan(); let edit = h.controller.beginFleetEdit(initial.id);
  edit = draft(h, edit, 'marauder', '12'); h.failNextFinal = true;
  assert.throws(() => h.controller.applyFleetEdit(edit.id, { expected: edit }), /guardar/);
  assert.equal(h.queue[0].quantities.marauder, 12); assert.equal(campaign(h).quantities.marauder, 9);
  assert.equal(h.controller.canRunJob(h.queue[0]), false); h.reload(); await h.controller.tick();
  edit = h.controller.getFleetEdit(edit.id); assert.equal(edit.status, 'queued');
  h.controller.applyFleetEdit(edit.id, { expected: edit });
  assert.equal(campaign(h).quantities.marauder, 12); assert.equal(h.queueWrites.length, 1);
});

test('Cancel recovers a partly applied queue edit by restoring only the known original fleet', async () => {
  const h = harness(); const initial = await h.plan(); let edit = h.controller.beginFleetEdit(initial.id);
  edit = draft(h, edit, 'vanguard', '3'); h.failNextFinal = true;
  assert.throws(() => h.controller.applyFleetEdit(edit.id, { expected: edit }));
  edit = h.controller.getFleetEdit(edit.id);
  assert.throws(() => draft(h, edit, 'vanguard', '4'), /pendiente|confirma|descarta/i);
  const saved = h.controller.cancelFleetEdit(edit.id, { expected: edit });
  assert.equal(saved.fleetEdit, null); assert.deepEqual(saved.quantities, initial.quantities);
  assert.deepEqual(h.queue[0].quantities, initial.quantities); assert.equal(h.controller.canRunJob(h.queue[0]), true);
});

test('a stale editor cannot overwrite another tab draft or discard its work', async () => {
  const h = harness(); const initial = await h.plan(); const original = h.controller.beginFleetEdit(initial.id);
  const newer = draft(h, original, 'marauder', '11');
  for (const mutate of [() => draft(h, original, 'marauder', '12'),
    () => h.controller.applyFleetEdit(initial.id, { expected: original }),
    () => h.controller.cancelFleetEdit(initial.id, { expected: original })]) assert.throws(mutate, /cambi|actual|otra/i);
  assert.deepEqual(campaign(h), newer);
});

test('unexpected queue changes during a staged edit stay blocked and cannot be silently rolled back', async () => {
  const h = harness(); const initial = await h.plan(); let edit = h.controller.beginFleetEdit(initial.id);
  edit = draft(h, edit, 'marauder', '12'); h.failQueue = true;
  assert.throws(() => h.controller.applyFleetEdit(edit.id, { expected: edit })); h.failQueue = false;
  const queue = h.queue; queue[0].quantities.marauder = 18; h.queue = queue;
  edit = h.controller.getFleetEdit(edit.id);
  assert.throws(() => h.controller.applyFleetEdit(edit.id, { expected: edit }));
  assert.throws(() => h.controller.cancelFleetEdit(edit.id, { expected: edit }));
  assert.equal(h.queue[0].quantities.marauder, 18); assert.equal(h.controller.canRunJob(h.queue[0]), false);
  await h.controller.tick(); assert.equal(campaign(h).status, 'uncertain');
});

test('campaign editing never mutates a queue entry belonging to another scope, origin, destination or authorization', async () => {
  for (const change of [job => { job.scope = 'other/player'; },
    job => { job.originId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; },
    job => { job.target.coordinate.q++; }, job => { job.autoSend = false; }]) {
    const h = harness(); const initial = await h.plan(); let edit = h.controller.beginFleetEdit(initial.id);
    edit = draft(h, edit, 'marauder', '12'); const queue = h.queue; change(queue[0]); h.queue = queue;
    assert.throws(() => h.controller.applyFleetEdit(edit.id, { expected: edit }));
    assert.throws(() => h.controller.cancelFleetEdit(edit.id, { expected: edit }));
    assert.deepEqual(h.queue, queue); assert.equal(h.queueWrites.length, 0); assert.equal(h.controller.canRunJob(queue[0]), false);
  }
});

test('global disable while editing preserves its pause through a later apply', async () => {
  const h = harness(); const initial = await h.plan(); let edit = h.controller.beginFleetEdit(initial.id);
  edit = draft(h, edit, 'marauder', '12'); h.controller.setConfig({ enabled: false });
  edit = h.controller.getFleetEdit(edit.id); h.controller.applyFleetEdit(edit.id, { expected: edit });
  assert.equal(campaign(h).status, 'paused'); assert.equal(h.queue[0].status, 'paused');
  assert.equal(h.controller.canRunJob(h.queue[0]), false);
});

test('retry attribution and the next +1 use the actually sent edited fleet', async () => {
  const h = harness(); const initial = await h.plan(); let edit = h.controller.beginFleetEdit(initial.id);
  edit = draft(h, edit, 'marauder', '15'); edit = draft(h, edit, 'sentinel', '2'); edit = draft(h, edit, 'vanguard', '0');
  h.controller.applyFleetEdit(edit.id, { expected: edit }); await h.sent();
  const sent = amounts(15, { sentinel: 2, vanguard: 0 });
  assert.deepEqual(campaign(h).lastSentQuantities, sent);
  h.now = 4000; assert.equal(h.controller.observeReport(h.report(2, sent)), true); await h.controller.tick();
  assert.deepEqual(h.queue[0].quantities, { ...sent, marauder: 16 }); assert.equal(campaign(h).retries, 1);
});

test('a report for the old composition cannot be attributed to the edited attack', async () => {
  const h = harness(); const initial = await h.plan(); let edit = h.controller.beginFleetEdit(initial.id);
  edit = draft(h, edit, 'marauder', '15'); h.controller.applyFleetEdit(edit.id, { expected: edit }); await h.sent();
  h.now = 4000; h.controller.observeReport(h.report(2, initial.quantities)); await h.controller.tick();
  assert.equal(campaign(h).status, 'uncertain'); assert.equal(h.enqueues.length, 1);
});

test('editing is quiet and exported drafts import in a paused campaign', async () => {
  const h = harness(); const initial = await h.plan(); const eventCount = h.events.length;
  let edit = h.controller.beginFleetEdit(initial.id); edit = draft(h, edit, 'marauder', '12');
  assert.equal(h.events.length, eventCount);
  const exported = h.controller.exportConfig(); h.controller.importConfig(exported);
  edit = h.controller.getFleetEdit(initial.id);
  assert.equal(edit.status, 'paused'); assert.equal(edit.fleetEdit.drafts.marauder, '12');
  assert.equal(h.controller.canRunJob(h.queue[0]), false);
});

test('invalid editor backup records are rejected before mutation', async () => {
  const h = harness(); const initial = await h.plan(); h.controller.beginFleetEdit(initial.id);
  for (const alter of [value => { value.drafts.marauder = 12; }, value => { value.drafts.extra = '1'; },
    value => { value.drafts.probe = '\u0000'; }, value => { value.baseQuantities.marauder++; },
    value => { value.pendingQuantities = amounts(12); }]) {
    const exported = h.controller.exportConfig(); alter(exported.campaigns[0].fleetEdit);
    assert.throws(() => h.controller.validateConfig(exported));
  }
});

async function integratedHarness() {
  const seed = harness(); await seed.plan(false);
  let retryStored = seed.stored, queueStored = {}, clock = 2000, retry, failFinal = false;
  const dispatches = [];
  const fleet = Object.fromEntries(['probe', 'marauder', 'sentinel', 'vanguard'].map(ship =>
    [ship, { parked: 100, away: 0, building: 0 }]));
  const baseContext = { scope, originId, originName: 'Technocratic Imperium', active: true, canAct: true, selectionCount: 1 };
  const queue = queueFactory({ now: () => clock, load: () => clone(queueStored), save: value => { queueStored = clone(value); },
    getContext: () => ({ ...baseContext, canAct: retry?.canRunJob(queue.list()[0]) === true }),
    getFleet: () => clone(fleet), dispatch: async job => { dispatches.push(clone(job)); return { status: 'sent', message: 'Confirmed' }; },
  });
  retry = factory({ now: () => clock, load: () => clone(retryStored), save: value => {
    if (failFinal && retryStored.campaigns[0].fleetEdit?.pendingQuantities && !value.campaigns[0].fleetEdit) {
      failFinal = false; throw new Error('campaign storage unavailable');
    }
    retryStored = clone(value);
  }, getContext: () => baseContext, getJobs: () => queue.list(),
    verifyOrigin: async () => ({ originId, name: baseContext.originName, coordinate: origin }),
    queueOnce: (spec, options) => queue.queue(spec, options),
    setJobFleetQuantities: (id, amounts, options) => queue.setFleetQuantities(id, amounts, options),
    pauseJob: id => queue.pause(id), resumeJob: id => queue.resume(id), cancelJob: id => queue.cancel(id),
  });
  await retry.tick();
  return { retry, queue, dispatches, fleet, baseContext, set now(value) { clock = value; }, set failFinal(value) { failFinal = value; } };
}

test('real queue and campaign integration keeps the edited fleet held, then sends and attributes it once', async () => {
  const h = await integratedHarness(); let edit = h.retry.beginFleetEdit(h.retry.exportConfig().campaigns[0].id);
  edit = h.retry.setFleetDraft(edit.id, 'marauder', '12', { expected: edit });
  edit = h.retry.setFleetDraft(edit.id, 'sentinel', '3', { expected: edit });
  edit = h.retry.setFleetDraft(edit.id, 'vanguard', '0', { expected: edit });
  await h.queue.tick(); assert.equal(h.dispatches.length, 0);
  assert.equal(h.queue.productionDemand({ ...h.baseContext, canAct: h.retry.canRunJob(h.queue.list()[0]) }, h.fleet), null);
  const saved = h.retry.applyFleetEdit(edit.id, { expected: edit });
  assert.deepEqual(h.queue.list()[0].quantities, saved.quantities);
  h.now = 3000; await h.queue.tick(); await h.retry.tick();
  assert.equal(h.dispatches.length, 1); assert.deepEqual(h.dispatches[0].quantities, amounts(12, { sentinel: 3, vanguard: 0 }));
  assert.equal(h.retry.exportConfig().campaigns[0].status, 'awaiting_report');
  assert.deepEqual(h.retry.exportConfig().campaigns[0].lastSentQuantities, h.dispatches[0].quantities);
  await h.queue.tick(); assert.equal(h.dispatches.length, 1);
});

test('real queue CAS remains held after partial campaign save and Cancel restores the original fleet', async () => {
  const h = await integratedHarness(); const initial = h.retry.exportConfig().campaigns[0];
  let edit = h.retry.beginFleetEdit(initial.id); edit = h.retry.setFleetDraft(edit.id, 'vanguard', '4', { expected: edit });
  h.failFinal = true; assert.throws(() => h.retry.applyFleetEdit(edit.id, { expected: edit }));
  await h.queue.tick(); await h.retry.tick();
  assert.equal(h.dispatches.length, 0); assert.equal(h.queue.list()[0].quantities.vanguard, 4);
  edit = h.retry.getFleetEdit(initial.id); const saved = h.retry.cancelFleetEdit(initial.id, { expected: edit });
  assert.deepEqual(h.queue.list()[0].quantities, initial.quantities); assert.equal(saved.fleetEdit, null);
  assert.equal(h.retry.canRunJob(h.queue.list()[0]), true);
});

test('importing both stores during a partial edit preserves the staged fleet and keeps Apply paused', async () => {
  const h = await integratedHarness(); const initial = h.retry.exportConfig().campaigns[0];
  let edit = h.retry.beginFleetEdit(initial.id); edit = h.retry.setFleetDraft(edit.id, 'marauder', '14', { expected: edit });
  h.failFinal = true; assert.throws(() => h.retry.applyFleetEdit(edit.id, { expected: edit }));
  const backupQueue = h.queue.exportConfig(), backupRetry = h.retry.exportConfig();
  h.queue.importConfig(backupQueue); h.retry.importConfig(backupRetry);
  edit = h.retry.getFleetEdit(initial.id);
  assert.equal(edit.status, 'paused'); assert.equal(edit.fleetEdit.pendingQuantities.marauder, 14);
  const saved = h.retry.applyFleetEdit(edit.id, { expected: edit });
  assert.equal(saved.quantities.marauder, 14); assert.equal(saved.status, 'paused'); assert.equal(h.queue.list()[0].status, 'paused');
  await h.queue.tick(); assert.equal(h.dispatches.length, 0); assert.equal(h.retry.canRunJob(h.queue.list()[0]), false);
});
