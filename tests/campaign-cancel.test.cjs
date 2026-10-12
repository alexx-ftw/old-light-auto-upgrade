'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = process.env.QA_CAMPAIGN_CANCEL_SOURCE
  || path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const sandbox = vm.createContext({ TextEncoder, Date, structuredClone, JSON });
for (const [marker, name] of [
  ['ATTACK RETRY CONTROLLER', 'createAttackRetryController'],
  ['FLEET WAIT QUEUE', 'createFleetWaitQueue'],
]) {
  const start = source.indexOf('// BEGIN ' + marker);
  const end = source.indexOf('// END ' + marker, start);
  assert.ok(start >= 0 && end > start, marker + ' exists in the published userscript');
  vm.runInContext(source.slice(start, end) + '\nthis.' + name + ' = ' + name + ';', sandbox);
}

const copy = value => structuredClone(value);
const scope = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const originId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherOriginId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherScope = 'andromeda/dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const origin = { q: -95, r: 260 };
const destination = { q: -93, r: 266 };
const reportId = '00000000-0000-4000-8000-000000000001';
const fleet = { probe: 0, marauder: 9, sentinel: 0, vanguard: 1 };

async function harness(initialResult = { status: 'sent', message: 'Envío confirmado.' }, { cleanupOnChange = false } = {}) {
  let queueStored = {}, retryStored = {}, clock = 1000, queue, retry, nativeSends = 0;
  let dispatch = async () => copy(initialResult);
  let failQueueSaves = 0, failRetrySaves = 0;
  const attempts = [], cancellations = [];
  const context = { scope, originId, originName: 'Technocratic Imperium', active: true, canAct: true, selectionCount: 1 };
  const availableFleet = Object.fromEntries(['probe', 'marauder', 'sentinel', 'vanguard'].map(ship =>
    [ship, { parked: 100, away: 0, building: 0 }]));
  function start() {
    queue = sandbox.createFleetWaitQueue({
      now: () => clock, load: () => copy(queueStored),
      save: value => {
        if (failQueueSaves > 0) { failQueueSaves--; throw new Error('Simulated queue persistence failure.'); }
        queueStored = copy(value);
      },
      getContext: () => ({ ...context, canAct: context.canAct && retry?.canRunJob(queue.getJobFor(context)) === true }),
      getFleet: () => copy(availableFleet),
      onSettingsChange: () => { if (cleanupOnChange) retry?.cleanupCancelledJobs(); },
      dispatch: async job => {
        attempts.push(copy(job));
        const result = await dispatch(copy(job));
        if (result.status === 'sent') nativeSends++;
        return result;
      },
    });
    retry = sandbox.createAttackRetryController({
      now: () => clock, load: () => copy(retryStored),
      save: value => {
        if (failRetrySaves > 0) { failRetrySaves--; throw new Error('Simulated campaign persistence failure.'); }
        retryStored = copy(value);
      },
      getContext: () => copy(context), getJobs: () => queue.list(),
      verifyOrigin: async () => ({ originId, name: context.originName, coordinate: origin }),
      queueOnce: (spec, options) => queue.queue(spec, options),
      pauseJob: id => queue.pause(id), resumeJob: id => queue.resume(id),
      cancelJob: (id, ...args) => { cancellations.push(id); return queue.cancel(id, ...args); },
      setJobFleetQuantities: (id, quantities, options) => queue.setFleetQuantities(id, quantities, options),
      setJobCampaignOwner: (id, campaignId, options) => queue.setCampaignOwner(id, campaignId, options),
    });
  }
  start();
  retry.setConfig({ enabled: true });
  clock = 2000;
  const lostFleet = { ...fleet, marauder: fleet.marauder - 1 };
  assert.equal(retry.observeReport({
    scope, item: { id: reportId, takenAt: clock, verdict: 'Defeat' },
    detail: {
      id: reportId, createdAt: clock,
      route: { from: { ...origin, name: context.originName, ownerKind: 'owned' },
        to: { ...destination, name: 'Mirairot Sovereignty 001', ownerKind: 'human' } },
      sections: { battle: { attackerShips: Object.entries(lostFleet).map(([type, quantity]) =>
        ({ type, quantity, kind: 'exact' })) } },
    },
  }), true);
  await retry.tick();
  clock = 3000;
  assert.equal(retry.exportConfig().campaigns[0].status, 'queued');
  const campaignId = retry.exportConfig().campaigns[0].id;
  const childId = retry.exportConfig().campaigns[0].queueJobId;
  return {
    get queue() { return queue; }, get retry() { return retry; },
    get campaign() { return copy(retry.exportConfig().campaigns.find(item => item.id === campaignId)); },
    get job() { return copy(queue.list().find(item => item.id === childId)); },
    get nativeSends() { return nativeSends; },
    get time() { return clock; },
    get storedQueue() { return copy(queueStored); },
    get storedRetry() { return copy(retryStored); },
    set queueSnapshot(value) { queueStored = copy(value); },
    set retrySnapshot(value) { retryStored = copy(value); },
    set result(value) { dispatch = async () => copy(value); },
    set dispatch(value) { dispatch = value; },
    attempts, cancellations, context, availableFleet, campaignId, childId,
    failQueueSave(count = 1) { failQueueSaves = count; },
    failRetrySave(count = 1) { failRetrySaves = count; },
    advance(value = 2000) { clock += value; },
    cancel() { return retry.cancel(campaignId); },
    async tick() { await queue.tick(); await retry.tick(); },
    reload() { queue.destroy(); retry.destroy(); start(); },
  };
}

async function assertNoResend(h, expectedSends = 0) {
  h.reload(); h.advance(); await h.tick(); h.advance(); await h.tick();
  assert.equal(h.job, undefined, 'The cancelled campaign must leave no linked mission in the helper.');
  assert.equal(h.campaign.status, 'cancelled');
  assert.equal(h.nativeSends, expectedSends, 'Cleaning helper entries must not launch or repeat a native mission.');
}

function jobSpec(job, patch = {}) {
  return { scope: job.scope, originId: job.originId, originName: job.originName,
    target: copy(job.target), quantities: copy(job.quantities), produce: job.produce, autoSend: job.autoSend, ...patch };
}

function defeatReport(h, id, amounts = fleet, coordinate = destination) {
  return {
    scope, item: { id, takenAt: h.time, verdict: 'Defeat' },
    detail: {
      id, createdAt: h.time,
      route: { from: { ...origin, name: h.context.originName, ownerKind: 'owned' },
        to: { ...coordinate, name: 'Mirairot Sovereignty 001', ownerKind: 'human' } },
      sections: { battle: { attackerShips: Object.entries(amounts).map(([type, quantity]) =>
        ({ type, quantity, kind: 'exact' })) } },
    },
  };
}

function defeat(h, id, amounts = fleet, coordinate = destination) {
  h.advance();
  return h.retry.observeReport(defeatReport(h, id, amounts, coordinate));
}

test('cancelling a waiting campaign removes its mission and production demand durably', async () => {
  const h = await harness();
  for (const counts of Object.values(h.availableFleet)) counts.parked = 0;
  assert.deepEqual(copy(h.queue.productionDemand(h.context, h.availableFleet)), fleet);
  h.cancel();
  assert.equal(h.job, undefined);
  assert.equal(h.queue.productionDemand(h.context, h.availableFleet), null);
  await assertNoResend(h);
  assert.equal(h.attempts.length, 0);
});

test('cancelling a paused campaign removes its paused mission', async () => {
  const h = await harness();
  h.retry.pause(h.campaignId);
  assert.equal(h.job.status, 'paused');
  h.cancel();
  assert.equal(h.job, undefined);
  await assertNoResend(h);
});

test('cancelling an awaiting-report campaign removes its sent helper entry without another native action', async () => {
  const h = await harness();
  await h.tick();
  assert.equal(h.campaign.status, 'awaiting_report');
  assert.equal(h.job.status, 'sent');
  h.cancel();
  assert.equal(h.job, undefined);
  await assertNoResend(h, 1);
  assert.equal(h.attempts.length, 1);
});

test('cancelling between a defeat report and the next queue tick removes the previous sent mission', async () => {
  const h = await harness();
  await h.tick();
  assert.equal(h.job.status, 'sent');
  assert.equal(defeat(h, '00000000-0000-4000-8000-000000000002'), true);
  assert.equal(h.campaign.status, 'waiting_origin');
  assert.equal(h.campaign.queueJobId, null);
  // No tick is allowed between the new report and the user's cancellation.
  h.cancel();
  assert.equal(h.job, undefined);
  await assertNoResend(h, 1);
  assert.equal(h.attempts.length, 1);
});

test('cancelling an older campaign preserves a different campaign queued from the same origin', async () => {
  const h = await harness();
  await h.tick();
  assert.equal(defeat(h, '00000000-0000-4000-8000-000000000003', fleet, { q: 12, r: 34 }), true);
  await h.retry.tick();
  const other = copy(h.queue.list()[0]);
  assert.notEqual(other.id, h.childId);
  assert.equal(other.originId, originId);
  h.cancel();
  assert.deepEqual(copy(h.queue.list()), [other]);
  assert.deepEqual(h.cancellations, []);
  h.reload(); await h.retry.tick();
  assert.deepEqual(copy(h.queue.list()), [other]);
});

test('cancelling an uncertain campaign removes its review entry without acknowledging or retrying the send', async () => {
  const h = await harness({ status: 'uncertain', message: 'No se pudo confirmar el envío.' });
  await h.tick();
  assert.equal(h.campaign.status, 'uncertain');
  assert.equal(h.job.needsReview, true);
  const original = h.job;
  h.cancel();
  assert.equal(h.job, undefined);
  assert.equal(h.retry.canRunJob(original), false);
  await assertNoResend(h);
  assert.equal(h.attempts.length, 1);
});

test('cancelling an imported review campaign clears its paused mission even with retries disabled', async () => {
  const h = await harness({ status: 'uncertain', message: 'Resultado no confirmado.' });
  await h.tick();
  const queueBackup = h.queue.exportConfig(), retryBackup = h.retry.exportConfig();
  h.queue.importConfig(queueBackup); h.retry.importConfig(retryBackup);
  assert.equal(h.retry.exportConfig().enabled, false);
  assert.equal(h.job.status, 'paused');
  assert.equal(h.job.needsReview, true);
  h.cancel();
  assert.equal(h.job, undefined);
  await assertNoResend(h);
});

test('cancellation owns a mission across explicitly edited fleet quantities', async () => {
  const h = await harness();
  let edit = h.retry.beginFleetEdit(h.campaignId);
  edit = h.retry.setFleetDraft(edit.id, 'sentinel', '3', { expected: edit });
  h.retry.applyFleetEdit(edit.id, { expected: edit });
  assert.equal(h.job.quantities.sentinel, 3);
  h.cancel();
  assert.equal(h.job, undefined);
  await assertNoResend(h);
});

test('cancellation clears the linked mission even when a fleet edit stopped between its two saves', async () => {
  const h = await harness();
  let edit = h.retry.beginFleetEdit(h.campaignId);
  edit = h.retry.setFleetDraft(edit.id, 'sentinel', '4', { expected: edit });
  // Reproduce a durable staged fleet and queue write, before the final campaign save.
  const state = h.retry.exportConfig();
  state.campaigns[0].fleetEdit.pendingQuantities = { ...fleet, sentinel: 4 };
  h.retrySnapshot = state;
  h.queue.setFleetQuantities(h.childId, { ...fleet, sentinel: 4 }, { expected: h.job });
  h.reload();
  assert.equal(h.campaign.quantities.sentinel, 0);
  assert.equal(h.job.quantities.sentinel, 4);
  h.cancel();
  assert.equal(h.job, undefined);
  await assertNoResend(h);
});

for (const result of ['waiting', 'sent', 'uncertain']) {
  test('cancelling during preparation cleans the mission after the adapter returns ' + result, async () => {
    const h = await harness();
    let release;
    h.dispatch = () => new Promise(resolve => { release = resolve; });
    const pending = h.queue.tick();
    assert.equal(h.job.status, 'sending');
    const claim = h.job;
    h.cancel();
    assert.equal(h.job.status, 'sending', 'Retain the active claim until its adapter settles.');
    assert.equal(h.retry.canRunJob(claim), false, 'Cancellation must close dispatch authorization immediately.');
    release({ status: result, message: 'Simulated completion after cancellation.' });
    await pending; await h.retry.tick();
    assert.equal(h.job, undefined);
    await assertNoResend(h, result === 'sent' ? 1 : 0);
    assert.equal(h.attempts.length, 1);
  });
}

test('cleanup survives reload after cancelling an in-progress preparation with retries disabled', async () => {
  const h = await harness();
  let release;
  h.dispatch = () => new Promise(resolve => { release = resolve; });
  const pending = h.queue.tick();
  const claim = h.job;
  h.cancel(); h.retry.setConfig({ enabled: false });
  assert.equal(h.retry.canRunJob(claim), false);
  h.reload();
  release({ status: 'waiting', message: 'Preparation was interrupted before sending.' });
  await pending;
  await h.retry.tick();
  assert.equal(h.job, undefined);
  assert.equal(h.retry.exportConfig().enabled, false);
  await assertNoResend(h);
});

test('removing a cancelled campaign cannot orphan its mission while preparation is finishing', async () => {
  const h = await harness();
  let release;
  h.dispatch = () => new Promise(resolve => { release = resolve; });
  const pending = h.queue.tick();
  h.cancel();
  // Removal may complete now or wait for cleanup, but ownership must not be lost.
  try { h.retry.remove(h.campaignId); }
  catch (error) { assert.match(error.message, /misión|envío|prepar|limpi/i); }
  release({ status: 'waiting', message: 'Preparation finished without a send.' });
  await pending; await h.retry.tick();
  assert.equal(h.job, undefined);
  if (h.campaign) h.retry.remove(h.campaignId);
  h.reload(); h.advance(); await h.tick();
  assert.equal(h.campaign, undefined);
  assert.equal(h.job, undefined);
  assert.equal(h.nativeSends, 0);
  assert.equal(h.attempts.length, 1);
});

test('failed queue cleanup remains recoverable after reload while retry automation is disabled', async () => {
  const h = await harness();
  h.retry.setConfig({ enabled: false });
  h.failQueueSave();
  h.cancel();
  assert.equal(h.campaign.status, 'cancelled');
  assert.ok(h.job, 'The simulated failed deletion should leave a recoverable persisted child.');
  await assertNoResend(h);
  assert.equal(h.retry.exportConfig().enabled, false);
});

test('a failed campaign cancellation save does not delete an authorized mission', async () => {
  const h = await harness();
  const before = h.job;
  h.failRetrySave();
  assert.throws(() => h.cancel(), /guardar|guardado/i);
  assert.equal(h.campaign.status, 'queued');
  assert.deepEqual(h.job, before);
  assert.deepEqual(h.cancellations, []);
});

test('cancelling one campaign leaves missions belonging to other origins and scopes intact', async () => {
  const h = await harness();
  const child = h.job;
  const others = [
    h.queue.queue(jobSpec(child, { originId: otherOriginId }), { id: 'manual-other-origin' }),
    h.queue.queue(jobSpec(child, { scope: otherScope }), { id: 'manual-other-scope' }),
  ];
  h.cancel();
  assert.equal(h.job, undefined);
  assert.deepEqual(copy(h.queue.list()), copy(others));
  assert.deepEqual(h.cancellations, [h.childId]);
  h.reload(); await h.retry.tick();
  assert.deepEqual(copy(h.queue.list()), copy(others));
});

test('cancellation never removes a manual replacement sharing the same origin and route', async () => {
  const h = await harness();
  const previous = h.job;
  h.queue.cancel(h.childId);
  const manual = h.queue.queue(jobSpec(previous), { id: 'manual-same-origin-and-route' });
  h.cancel();
  assert.deepEqual(copy(h.queue.list()), copy([manual]));
  assert.deepEqual(h.cancellations, []);
  h.reload(); await h.retry.tick();
  assert.deepEqual(copy(h.queue.list()), copy([manual]));
});

for (const [name, change] of [
  ['scope', job => { job.scope = otherScope; }],
  ['origin id', job => { job.originId = otherOriginId; }],
  ['target coordinates', job => { job.target.coordinate.q++; }],
  ['origin coordinates', job => { job.target.originCoordinate.r++; }],
]) {
  test('the same queue id with foreign ' + name + ' is not enough to delete an unrelated mission', async () => {
    const h = await harness();
    const snapshot = h.queue.exportConfig();
    change(snapshot.jobs[0]);
    h.queueSnapshot = snapshot;
    const foreign = h.job;
    h.cancel();
    assert.deepEqual(h.job, foreign);
    assert.deepEqual(h.cancellations, []);
    h.reload(); await h.retry.tick();
    assert.deepEqual(h.job, foreign);
  });
}


test('a foreign campaign owner takes precedence over a matching queue id during authorization and cancellation', async () => {
  const h = await harness();
  const snapshot = h.queue.exportConfig();
  snapshot.jobs[0].campaignId = 'attack:00000000-0000-4000-8000-000000000099';
  h.queueSnapshot = snapshot;
  const foreign = h.job;
  assert.equal(h.retry.canRunJob(foreign), false);
  h.cancel();
  assert.deepEqual(h.job, foreign);
  assert.deepEqual(h.cancellations, []);
  h.reload(); await h.retry.tick();
  assert.deepEqual(h.job, foreign);
});

test('campaign ownership rejects manual mission ids and malformed campaign or retry ids before any write', async () => {
  const h = await harness();
  const before = h.queue.exportConfig();
  for (const options of [
    { id: 'manual-with-owner', campaignId: h.campaignId },
    { id: 'retry:not-a-report-id', campaignId: h.campaignId },
    { id: h.childId, campaignId: 'not-a-campaign' },
    { id: h.childId, campaignId: 'attack:not-a-report-id' },
    { id: h.childId, campaignId: null },
  ]) assert.throws(() => h.queue.queue(jobSpec(h.job), options), /vínculo|campaña/i);
  const invalid = copy(before);
  invalid.jobs[0].campaignId = 'attack:invalid';
  assert.throws(() => h.queue.importConfig(invalid), /vínculo|campaña/i);
  assert.deepEqual(h.queue.exportConfig(), before);
  const manual = h.queue.queue(jobSpec(h.job, { originId: otherOriginId }), { id: 'manual-mission' });
  assert.throws(() => h.queue.setCampaignOwner(manual.id, h.campaignId, { expected: manual }), /vínculo|campaña/i);
  assert.deepEqual(copy(h.queue.list().find(item => item.id === manual.id)), copy(manual));
});

test('neither idempotent enqueue nor owner binding can reassign a mission to another campaign', async () => {
  const h = await harness();
  const original = h.job;
  const foreignOwner = 'attack:00000000-0000-4000-8000-000000000099';
  assert.equal(original.campaignId, h.campaignId);
  assert.throws(() => h.queue.queue(jobSpec(original), { id: original.id, campaignId: foreignOwner }), /otra misión|otra campaña/i);
  assert.throws(() => h.queue.queue(jobSpec(original), { id: original.id }), /otra misión|otra campaña/i);
  assert.throws(() => h.queue.setCampaignOwner(original.id, foreignOwner, { expected: original }), /otra campaña/i);
  assert.deepEqual(h.job, original);
  assert.deepEqual(copy(h.queue.queue(jobSpec(original), { id: original.id, campaignId: h.campaignId })), original);
});

test('binding a legacy mission to its campaign requires the current queue snapshot', async () => {
  const h = await harness();
  const snapshot = h.queue.exportConfig();
  delete snapshot.jobs[0].campaignId;
  h.queueSnapshot = snapshot;
  const stale = h.job;
  h.queue.pause(h.childId, 'Cambio guardado desde otra pestaña.');
  const current = h.job;
  assert.throws(() => h.queue.setCampaignOwner(h.childId, h.campaignId, { expected: stale }), /cambiado/i);
  assert.deepEqual(h.job, current);
  const bound = h.queue.setCampaignOwner(h.childId, h.campaignId, { expected: current });
  assert.equal(bound.campaignId, h.campaignId);
  assert.equal(bound.status, 'paused');
  assert.equal(bound.message, current.message);
  h.cancel();
  await assertNoResend(h);
});

test('a legacy sent mission gets durable campaign ownership before a new defeat replaces its queue id', async () => {
  const h = await harness();
  await h.tick();
  const legacy = h.queue.exportConfig();
  delete legacy.jobs[0].campaignId;
  h.queueSnapshot = legacy; h.reload();
  assert.equal(h.job.campaignId, undefined);
  assert.equal(defeat(h, '00000000-0000-4000-8000-000000000004'), true);
  assert.equal(h.campaign.queueJobId, null);
  assert.equal(h.job.campaignId, h.campaignId);
  h.reload();
  h.cancel();
  assert.equal(h.job, undefined);
  await assertNoResend(h, 1);
});

for (const storage of ['queue', 'campaign']) {
  test('a failed ' + storage + ' save during legacy migration keeps the report unprocessed and its mission recoverable', async () => {
    const h = await harness();
    await h.tick();
    const legacy = h.queue.exportConfig();
    delete legacy.jobs[0].campaignId;
    h.queueSnapshot = legacy; h.reload();
    const previousCampaign = h.campaign;
    h.advance();
    const report = defeatReport(h, '00000000-0000-4000-8000-000000000005');
    if (storage === 'queue') h.failQueueSave();
    else h.failRetrySave();
    assert.throws(() => h.retry.observeReport(report), /guardar|guardado/i);
    assert.deepEqual(h.campaign, previousCampaign);
    assert.equal(h.retry.exportConfig().processed.some(item => item.id === report.item.id), false);
    assert.equal(h.job.id, previousCampaign.queueJobId);
    assert.equal(h.job.campaignId, storage === 'queue' ? undefined : h.campaignId);
    h.reload();
    assert.equal(h.retry.observeReport(report), true, 'The same report must remain eligible after the failed write.');
    assert.equal(h.campaign.queueJobId, null);
    assert.equal(h.job.campaignId, h.campaignId);
    h.cancel();
    await assertNoResend(h, 1);
    assert.equal(h.attempts.length, 1);
  });
}

test('queue completion callbacks clean a cancelled mission without a tick while automation and context are inactive', async () => {
  const h = await harness(undefined, { cleanupOnChange: true });
  let release;
  h.dispatch = () => new Promise(resolve => { release = resolve; });
  const pending = h.queue.tick();
  assert.equal(h.job.status, 'sending');
  h.cancel();
  h.retry.setConfig({ enabled: false });
  h.context.active = false; h.context.canAct = false;
  assert.equal(h.job.status, 'sending');
  release({ status: 'uncertain', message: 'El adaptador terminó sin una confirmación concluyente.' });
  await pending;
  // Deliberately do not call retry.tick(), cleanupCancelledJobs(), or reload here.
  assert.equal(h.job, undefined);
  assert.equal(h.campaign.status, 'cancelled');
  assert.equal(h.retry.exportConfig().enabled, false);
  assert.equal(h.context.active, false);
  assert.equal(h.nativeSends, 0);
  assert.equal(h.attempts.length, 1);
  assert.deepEqual(h.cancellations, [h.childId]);
  await assertNoResend(h);
});
