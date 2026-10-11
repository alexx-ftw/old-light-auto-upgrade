'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = process.env.QA_ATTACK_RETRY_SOURCE
  || path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('// BEGIN ATTACK RETRY CONTROLLER');
const end = source.indexOf('// END ATTACK RETRY CONTROLLER', start);
assert.ok(start >= 0 && end > start, 'The published userscript contains its attack retry controller');
const sandbox = vm.createContext({ TextEncoder, Date, structuredClone });
vm.runInContext(source.slice(start, end) + '\nthis.create = createAttackRetryController;', sandbox);

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORIGIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = 'andromeda/' + ACCOUNT;
const uuid = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const copy = value => structuredClone(value);

function harness() {
  let clock = 1000;
  let stored = {};
  let queue = [];
  let controller;
  const calls = { queued: 0, resumed: 0, events: [] };
  const deps = {
    now: () => clock,
    load: () => copy(stored),
    save: value => { stored = copy(value); },
    getContext: () => ({ scope: SCOPE, originId: ORIGIN, originName: 'Technocratic Imperium',
      selectionCount: 1, active: true, canAct: true }),
    verifyOrigin: async () => ({ originId: ORIGIN, name: 'Technocratic Imperium', coordinate: { q: -95, r: 260 } }),
    getJobs: () => copy(queue),
    queueOnce: (spec, { id }) => {
      calls.queued++;
      const job = { id, ...copy(spec), status: 'waiting', createdAt: clock, updatedAt: clock,
        claimedAt: null, sentAt: null, message: '', needsReview: false };
      queue = [job];
      return copy(job);
    },
    pauseJob: id => {
      const job = queue.find(value => value.id === id);
      if (job && ['waiting', 'paused'].includes(job.status)) job.status = 'paused';
    },
    resumeJob: id => {
      calls.resumed++;
      const job = queue.find(value => value.id === id);
      if (job) job.status = 'waiting';
    },
    cancelJob: id => { queue = queue.filter(value => value.id !== id); },
    send: event => { calls.events.push(copy(event)); },
  };
  controller = sandbox.create(deps);
  function report(number, marauder) {
    return { scope: SCOPE, item: { id: uuid(number), takenAt: clock, verdict: 'Defeat' },
      detail: { id: uuid(number), createdAt: clock,
        route: {
          from: { name: 'Technocratic Imperium', q: -95, r: 260, ownerKind: 'owned', ownerName: 'xMix' },
          to: { name: 'Mirairot Sovereignty 001', q: -93, r: 266, ownerKind: 'human', ownerName: 'Mirairot' },
        },
        sections: { battle: {
          attackerShips: [{ type: 'marauder', kind: 'exact', quantity: marauder }],
          attackerLost: [{ type: 'marauder', kind: 'exact', quantity: marauder }],
          defenderShips: [{ type: 'marauder', kind: 'unknown' }],
          plundered: { pa: 0, ir: 0, credits: 0 },
        } },
      },
    };
  }
  return {
    calls,
    get controller() { return controller; },
    get campaign() { return copy(controller.exportConfig().campaigns[0]); },
    get queue() { return copy(queue); },
    set queue(value) { queue = copy(value); },
    advance: value => { clock += value; },
    reload: () => { controller.destroy(); controller = sandbox.create(deps); },
    async ambiguous() {
      controller.setConfig({ enabled: true });
      clock += 1000;
      assert.equal(controller.observeReport(report(1, 7)), true);
      await controller.tick();
      assert.equal(queue[0].quantities.marauder, 8);
      clock += 1000;
      // Another attack finished while the automatic retry is still recorded as unsent.
      assert.equal(controller.observeReport(report(2, 8)), true);
      assert.equal(this.campaign.status, 'uncertain');
      assert.equal(queue[0].status, 'paused');
      assert.match(this.campaign.message, /no coincide/);
      return this.campaign;
    },
  };
}

test('Ambiguous report keeps its review state and explanation after the owned job is paused', async () => {
  const h = harness();
  const original = await h.ambiguous();
  await h.controller.tick();
  await h.controller.tick();
  assert.equal(h.campaign.status, 'uncertain');
  assert.equal(h.campaign.resumeStatus, null);
  assert.equal(h.campaign.message, original.message);
  assert.equal(h.controller.canRunJob(h.queue[0]), false);
  assert.throws(() => h.controller.resume(original.id), /revisi[oó]n/);
  assert.equal(h.calls.queued, 1);
  assert.equal(h.calls.resumed, 0);
  assert.equal(h.calls.events.filter(event => event.id.endsWith(':ambiguous')).length, 1);
});

test('Reloading an ambiguous campaign cannot turn it into an ordinary resumable pause', async () => {
  const h = harness();
  const original = await h.ambiguous();
  h.reload();
  await h.controller.tick();
  assert.equal(h.campaign.status, 'uncertain');
  assert.equal(h.campaign.resumeStatus, null);
  assert.equal(h.campaign.message, original.message);
  assert.throws(() => h.controller.resume(original.id), /revisi[oó]n/);
  assert.equal(h.calls.resumed, 0);
});

for (const jobStatus of ['paused', 'waiting', 'sent']) {
  test('An imported review-only pause stays non-resumable when its job is ' + jobStatus, async () => {
    const source = harness();
    await source.ambiguous();
    const target = harness();
    target.advance(5000);
    const job = source.queue[0];
    job.status = jobStatus;
    if (jobStatus === 'sent') {
      job.sentAt = 5000;
      job.updatedAt = 5000;
      job.claimedAt = 4000;
    }
    target.queue = [job];
    target.controller.importConfig(source.controller.exportConfig());
    const original = target.campaign;
    assert.equal(original.status, 'paused');
    assert.equal(original.resumeStatus, null);
    target.controller.setConfig({ enabled: true });
    await target.controller.tick();
    target.reload();
    await target.controller.tick();
    assert.equal(target.campaign.status, 'paused');
    assert.equal(target.campaign.resumeStatus, null);
    assert.equal(target.campaign.message, original.message);
    assert.equal(target.controller.canRunJob(target.queue[0]), false);
    assert.throws(() => target.controller.resume(original.id), /revisi[oó]n/);
    assert.equal(target.calls.queued, 0);
    assert.equal(target.calls.resumed, 0);
  });
}
