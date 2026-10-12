'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = process.env.QA_MISSION_PAUSE_SOURCE
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
const origin = { q: -95, r: 260 };
const destination = { q: -93, r: 266 };
const reportId = '00000000-0000-4000-8000-000000000001';
const expectedFleet = { probe: 0, marauder: 9, sentinel: 0, vanguard: 1 };

async function harness(initialResult = { status: 'sent', message: 'Envío confirmado.' }) {
  let queueStored = {}, retryStored = {}, clock = 1000, queue, retry, nativeSends = 0;
  let dispatch = async () => copy(initialResult);
  const attempts = [];
  const context = { scope, originId, originName: 'Technocratic Imperium', active: true, canAct: true, selectionCount: 1 };
  const fleet = Object.fromEntries(['probe', 'marauder', 'sentinel', 'vanguard'].map(ship =>
    [ship, { parked: 100, away: 0, building: 0 }]));
  function start() {
    queue = sandbox.createFleetWaitQueue({
      now: () => clock, load: () => copy(queueStored), save: value => { queueStored = copy(value); },
      getContext: () => ({ ...context, canAct: context.canAct && retry?.canRunJob(queue.list()[0]) === true }),
      getFleet: () => copy(fleet),
      dispatch: async job => {
        attempts.push(copy(job));
        const result = await dispatch(copy(job));
        if (result.status === 'sent') nativeSends++;
        return result;
      },
    });
    retry = sandbox.createAttackRetryController({
      now: () => clock, load: () => copy(retryStored), save: value => { retryStored = copy(value); },
      getContext: () => copy(context), getJobs: () => queue.list(),
      verifyOrigin: async () => ({ originId, name: context.originName, coordinate: origin }),
      queueOnce: (spec, options) => queue.queue(spec, options),
      pauseJob: id => queue.pause(id), resumeJob: id => queue.resume(id), cancelJob: id => queue.cancel(id),
      setJobFleetQuantities: (id, quantities, options) => queue.setFleetQuantities(id, quantities, options),
    });
  }
  start();
  retry.setConfig({ enabled: true });
  clock = 2000;
  const lostFleet = { ...expectedFleet, marauder: expectedFleet.marauder - 1 };
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
  return {
    get queue() { return queue; }, get retry() { return retry; },
    get campaign() { return copy(retry.exportConfig().campaigns[0]); },
    get job() { return copy(queue.list()[0]); },
    get nativeSends() { return nativeSends; },
    set retrySnapshot(value) { retryStored = copy(value); },
    set result(value) { dispatch = async () => copy(value); },
    set dispatch(value) { dispatch = value; },
    attempts, context, fleet,
    advance(value = 2000) { clock += value; },
    async tick() { await queue.tick(); await retry.tick(); },
    reload() { queue.destroy(); retry.destroy(); start(); },
  };
}

test('a known no-send wait preserves campaign intent and exposes the actual waiting reason', async () => {
  const reason = 'Has interactuado con el juego. La misión esperará antes de continuar.';
  const h = await harness({ status: 'waiting', message: reason });
  await h.tick();
  assert.equal(h.job.status, 'waiting');
  assert.equal(h.campaign.status, 'queued');
  assert.equal(h.campaign.resumeStatus, null);
  assert.equal(h.campaign.message, reason);
  assert.equal(h.job.needsReview, false);
  assert.equal(h.nativeSends, 0);
  assert.deepEqual(h.campaign.quantities, expectedFleet);
  assert.equal(h.retry.canRunJob(h.job), true);
});

test('waiting retries when context and fleet recover, then confirms the exact campaign fleet once', async () => {
  const h = await harness({ status: 'waiting', message: 'Esperando el sistema de origen.' });
  await h.tick();
  const originalJobId = h.job.id;
  h.context.canAct = false;
  h.advance(); await h.tick();
  assert.equal(h.attempts.length, 1);
  assert.equal(h.campaign.status, 'queued');
  h.context.canAct = true;
  h.fleet.marauder.parked = 0;
  h.advance(); await h.tick();
  assert.equal(h.attempts.length, 1);
  assert.equal(h.campaign.status, 'queued');
  h.fleet.marauder.parked = expectedFleet.marauder;
  h.result = { status: 'sent', message: 'Envío confirmado.' };
  h.advance(); await h.tick(); h.advance(); await h.tick();
  assert.equal(h.attempts.length, 2);
  assert.equal(h.nativeSends, 1);
  assert.ok(h.attempts.every(job => job.id === originalJobId));
  assert.deepEqual(h.attempts[1].quantities, expectedFleet);
  assert.deepEqual(h.campaign.lastSentQuantities, expectedFleet);
  assert.equal(h.campaign.status, 'awaiting_report');
  assert.equal(h.campaign.retries, 1);
});

test('reloading a waiting campaign retains its reason and does not turn it into a pause', async () => {
  const reason = 'Cierra el menú del mapa para continuar esta misión.';
  const h = await harness({ status: 'waiting', message: reason });
  await h.tick(); h.reload(); await h.retry.tick();
  assert.equal(h.job.status, 'waiting');
  assert.equal(h.campaign.status, 'queued');
  assert.equal(h.campaign.message, reason);
  h.result = { status: 'sent', message: 'Envío confirmado.' };
  h.advance(); await h.tick();
  assert.equal(h.nativeSends, 1);
  assert.equal(h.campaign.status, 'awaiting_report');
});

test('a real pre-send route blocker stays paused and passes its specific reason to the campaign', async () => {
  const reason = 'Las coordenadas del destino no coinciden con la misión.';
  const h = await harness({ status: 'paused', message: reason });
  await h.tick();
  assert.equal(h.job.status, 'paused');
  assert.equal(h.campaign.status, 'paused');
  assert.equal(h.campaign.message, reason);
  h.result = { status: 'sent', message: 'Envío confirmado.' };
  h.advance(); await h.tick(); h.reload(); await h.tick();
  assert.equal(h.attempts.length, 1);
  assert.equal(h.nativeSends, 0);
  assert.equal(h.campaign.status, 'paused');
  assert.equal(h.campaign.message, reason);
});

test('a manual campaign pause during preparation wins over a later safe waiting result', async () => {
  const h = await harness();
  let release;
  h.dispatch = () => new Promise(resolve => { release = resolve; });
  const pending = h.queue.tick();
  assert.equal(h.job.status, 'sending');
  h.retry.pause(h.campaign.id);
  const message = h.campaign.message;
  release({ status: 'waiting', message: 'El origen ha cambiado; se esperará al sistema correcto.' });
  await pending; await h.retry.tick();
  h.advance(); await h.tick();
  assert.equal(h.campaign.status, 'paused');
  assert.equal(h.campaign.message, message);
  assert.equal(h.job.status, 'paused');
  assert.equal(h.attempts.length, 1);
  assert.equal(h.nativeSends, 0);
});

test('a legacy generic pause restores only its explanation without resuming the campaign or mission', async () => {
  const reason = 'Has interactuado con el juego durante la preparación.';
  const h = await harness({ status: 'paused', message: reason });
  await h.tick();
  const legacy = h.retry.exportConfig();
  legacy.campaigns[0].message = 'La misión pendiente está en pausa.';
  h.retrySnapshot = legacy;
  h.reload();
  const previousCampaign = h.campaign, previousJob = h.job;
  h.advance(); await h.tick();
  assert.deepEqual(h.campaign, { ...previousCampaign, message: reason });
  assert.deepEqual(h.job, previousJob);
  h.result = { status: 'sent', message: 'Envío confirmado.' };
  h.reload(); h.advance(); await h.tick();
  assert.equal(h.campaign.status, 'paused');
  assert.equal(h.campaign.resumeStatus, 'queued');
  assert.equal(h.job.status, 'paused');
  assert.equal(h.attempts.length, 1);
  assert.equal(h.nativeSends, 0);
});

test('pausing a linked mission preserves the user supplied reason in its campaign', async () => {
  const h = await harness();
  const reason = 'Pausada para reservar las naves en base.';
  h.queue.pause(h.job.id, reason);
  await h.retry.tick(); h.advance(); await h.tick();
  assert.equal(h.campaign.status, 'paused');
  assert.equal(h.campaign.message, reason);
  assert.equal(h.attempts.length, 0);
});

test('disabling and re-enabling campaigns does not silently resume a pending attack', async () => {
  const h = await harness({ status: 'waiting', message: 'Esperando un menú del juego.' });
  await h.tick();
  h.retry.setConfig({ enabled: false });
  const message = h.campaign.message;
  h.advance(); h.retry.setConfig({ enabled: true }); await h.tick();
  assert.equal(h.campaign.status, 'paused');
  assert.equal(h.campaign.message, message);
  assert.equal(h.job.status, 'paused');
  assert.equal(h.attempts.length, 1);
  assert.equal(h.nativeSends, 0);
});

test('a waiting backup imports in pause and keeps the import explanation', async () => {
  const h = await harness({ status: 'waiting', message: 'La vista del juego ha cambiado.' });
  await h.tick();
  const backupQueue = h.queue.exportConfig(), backupRetry = h.retry.exportConfig();
  h.queue.importConfig(backupQueue); h.retry.importConfig(backupRetry);
  const message = h.campaign.message;
  h.advance(); h.retry.setConfig({ enabled: true }); await h.tick(); h.reload(); await h.tick();
  assert.equal(h.campaign.status, 'paused');
  assert.match(message, /Importada en pausa/);
  assert.equal(h.campaign.message, message);
  assert.equal(h.job.status, 'paused');
  assert.equal(h.attempts.length, 1);
  assert.equal(h.nativeSends, 0);
});

test('a pending fleet draft holds a waiting campaign until explicit Apply', async () => {
  const h = await harness({ status: 'waiting', message: 'Esperando disponibilidad del mapa.' });
  await h.tick();
  let edit = h.retry.beginFleetEdit(h.campaign.id);
  edit = h.retry.setFleetDraft(edit.id, 'sentinel', '3', { expected: edit });
  h.result = { status: 'sent', message: 'Envío confirmado.' };
  h.advance(); await h.tick(); h.reload(); await h.tick();
  assert.equal(h.attempts.length, 1);
  assert.equal(h.retry.canRunJob(h.job), false);
  assert.equal(h.campaign.fleetEdit.drafts.sentinel, '3');
  const saved = h.retry.applyFleetEdit(edit.id, { expected: h.retry.getFleetEdit(edit.id) });
  h.advance(); await h.tick(); await h.tick();
  assert.equal(h.nativeSends, 1);
  assert.deepEqual(h.attempts[1].quantities, saved.quantities);
  assert.equal(h.attempts[1].quantities.sentinel, 3);
  assert.equal(h.campaign.status, 'awaiting_report');
});

test('applying a fleet draft to a manually paused campaign keeps its pause', async () => {
  const h = await harness();
  h.retry.pause(h.campaign.id);
  const message = h.campaign.message;
  let edit = h.retry.beginFleetEdit(h.campaign.id);
  edit = h.retry.setFleetDraft(edit.id, 'sentinel', '2', { expected: edit });
  h.retry.applyFleetEdit(edit.id, { expected: edit });
  await h.tick(); h.advance(); await h.tick();
  assert.equal(h.campaign.status, 'paused');
  assert.equal(h.campaign.message, message);
  assert.equal(h.job.status, 'paused');
  assert.equal(h.attempts.length, 0);
});

test('an unconfirmed send never turns into an automatic wait or a resumable imported pause', async () => {
  const h = await harness({ status: 'uncertain', message: 'El juego requiere una confirmación especial.' });
  await h.tick();
  const message = h.campaign.message;
  assert.equal(h.campaign.status, 'uncertain');
  assert.equal(h.campaign.resumeStatus, null);
  h.result = { status: 'sent', message: 'Envío confirmado.' };
  h.advance(); await h.tick(); h.reload(); await h.tick();
  assert.equal(h.campaign.status, 'uncertain');
  assert.equal(h.campaign.message, message);
  assert.throws(() => h.retry.resume(h.campaign.id), /revisión/);
  const backupQueue = h.queue.exportConfig(), backupRetry = h.retry.exportConfig();
  h.queue.importConfig(backupQueue); h.retry.importConfig(backupRetry);
  h.advance(); h.retry.setConfig({ enabled: true }); await h.tick();
  assert.equal(h.campaign.status, 'paused');
  assert.equal(h.campaign.resumeStatus, null);
  assert.throws(() => h.retry.resume(h.campaign.id), /revisión/);
  assert.equal(h.attempts.length, 1);
  assert.equal(h.nativeSends, 0);
});
