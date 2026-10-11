'use strict';

// Offline recovery contract: no browser, game requests, or notification transport.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = process.env.QA_ATTACK_RETRY_SOURCE || path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('// BEGIN ATTACK RETRY CONTROLLER');
const end = source.indexOf('// END ATTACK RETRY CONTROLLER', start);
assert.ok(start >= 0 && end > start, 'attack retry controller markers exist');
const factory = vm.runInNewContext(source.slice(start, end) + '\ncreateAttackRetryController;', { TextEncoder, Date });
const clone = value => structuredClone(value);
const SCOPE = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_SCOPE = 'andromeda/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORIGIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const uuid = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const amounts = (marauder, extra = {}) => ({ probe: 0, marauder, sentinel: 0, vanguard: 0, ...extra });

function report(number, { when = 3000, marauder = 8, verdict = 'Defeat',
  from = {}, to = {}, omittedKinds = false, detailWhen = when } = {}) {
  const quantities = amounts(marauder);
  return { item: { id: uuid(number), takenAt: when, title: 'You attacked Mirairot', verdict },
    detail: { id: uuid(number), createdAt: detailWhen,
      route: { from: { q: -95, r: 260, name: 'Technocratic Imperium', ownerKind: 'owned', ownerName: 'xMix', ...from },
        to: { q: -93, r: 266, name: 'Mirairot Sovereignty 001', ownerKind: 'human', ownerName: 'Mirairot', ...to } },
      sections: { battle: { targetOwnerKind: 'human',
        attackerShips: Object.entries(quantities).map(([type, quantity]) => ({ type, ...(omittedKinds ? {} : { kind: 'exact' }), quantity })),
        attackerLost: Object.entries(quantities).map(([type, quantity]) => ({ type, kind: 'exact', quantity })),
        defenderShips: Object.keys(quantities).map(type => ({ type, kind: 'unknown' })),
        defenderLost: Object.keys(quantities).map(type => ({ type, kind: 'unknown' })),
        plundered: { pa: 0, ir: 0, credits: 0 } } } } };
}

function harness() {
  let stored = {}, clock = 1000, failSave = false, queue = [], controller;
  let context = { scope: SCOPE, originId: ORIGIN_ID, originName: 'Technocratic Imperium', selectionCount: 1, active: true, canAct: true };
  const calls = [], events = [], pauses = [], cancels = [];
  const deps = { now: () => clock, load: () => clone(stored), save: value => {
    if (failSave) throw new Error('storage unavailable'); stored = clone(value); return true;
  }, getContext: () => clone(context), getJobs: () => clone(queue),
  verifyOrigin: async campaign => ({ originId: context.originId, name: context.originName, coordinate: clone(campaign.originCoordinate) }),
  queueOnce: (spec, { id }) => {
    const previous = queue.find(job => job.id === id);
    if (previous) return clone(previous);
    if (queue.some(job => job.scope === spec.scope && job.originId === spec.originId && job.status !== 'sent')) throw new Error('origin occupied');
    calls.push({ id, spec: clone(spec) });
    const job = { id, ...clone(spec), status: 'waiting', createdAt: clock, updatedAt: clock,
      claimedAt: null, sentAt: null, message: '', needsReview: false };
    queue = [...queue.filter(item => item.scope !== spec.scope || item.originId !== spec.originId), job]; return clone(job);
  }, pauseJob: id => {
    pauses.push(id); const job = queue.find(item => item.id === id);
    if (job && !['sent', 'sending', 'uncertain'].includes(job.status)) job.status = 'paused';
  }, resumeJob: id => { const job = queue.find(item => item.id === id); if (job) job.status = 'waiting'; },
  cancelJob: id => { cancels.push(id); queue = queue.filter(item => item.id !== id); }, send: event => events.push(clone(event)) };
  controller = factory(deps);
  return { calls, events, pauses, cancels,
    get controller() { return controller; }, get queue() { return clone(queue); },
    get stored() { return clone(stored); }, set stored(value) { stored = clone(value); },
    get now() { return clock; }, set now(value) { clock = value; },
    set failSave(value) { failSave = value; }, set context(value) { context = { ...context, ...value }; },
    enable() { controller.setConfig({ enabled: true }); clock = 10000; },
    reload() { controller.destroy(); controller = factory(deps); },
    recover(reports, scope = SCOPE) { return controller.recoverReports({ scope, reports: clone(reports) }); },
    sendJob(at) { clock = at; const job = queue[0]; assert.ok(job, 'a mission was queued');
      job.status = 'sent'; job.sentAt = at; job.claimedAt = at; job.updatedAt = at; },
  };
}

function campaigns(h) { return clone(h.controller.exportConfig().campaigns); }
function assertExplained(h) {
  const diagnostic = h.controller.getDiagnostics();
  const message = diagnostic.lastReportDecision?.message;
  assert.ok(typeof message === 'string' && message.trim(), 'recovery must explain why the latest report cannot authorize a retry');
}
function assertNumeric(result) { assert.ok(Number.isSafeInteger(result) && result >= 0, 'recoverReports returns a synchronous accepted-report count'); }

test('recovery creates exactly 9 Marauder after the lost 8 and is synchronous', async () => {
  const h = harness(); h.enable();
  const value = report(1, { omittedKinds: true, detailWhen: 2999 });
  assert.equal(h.recover([value]), 1);
  assert.equal(campaigns(h).length, 1); assert.deepEqual(campaigns(h)[0].quantities, amounts(9));
  assert.equal(h.calls.length, 0, 'the synchronous report decision does not enqueue an order itself');
  await h.controller.tick(); assert.equal(h.calls.length, 1); assert.deepEqual(h.queue[0].quantities, amounts(9));
  assert.equal(h.queue[0].id, 'retry:' + value.item.id);
});

for (const reverse of [false, true]) test('only the latest result per route is recovered, reverse input=' + reverse, async () => {
  const h = harness(); h.enable();
  const values = [report(1, { when: 2000, marauder: 7 }), report(2, { when: 3000, marauder: 8 })];
  assert.equal(h.recover(reverse ? values.reverse() : values), 1);
  assert.equal(campaigns(h).length, 1); assert.equal(campaigns(h)[0].triggerReportId, uuid(2));
  assert.deepEqual(campaigns(h)[0].quantities, amounts(9));
  await h.controller.tick(); assert.equal(h.calls.length, 1); assert.deepEqual(h.queue[0].quantities, amounts(9));
});

test('system renames do not split one coordinate route into two campaigns', async () => {
  const h = harness(); h.enable();
  const old = report(1, { when: 2000, marauder: 7, from: { name: "xMix's System" }, to: { name: 'Old target name' } });
  const fresh = report(2, { when: 3000, marauder: 8 });
  assert.equal(h.recover([old, fresh]), 1); assert.equal(campaigns(h).length, 1);
  assert.equal(campaigns(h)[0].originName, 'Technocratic Imperium');
  assert.equal(campaigns(h)[0].targetName, 'Mirairot Sovereignty 001');
  assert.deepEqual(campaigns(h)[0].quantities, amounts(9)); await h.controller.tick(); assert.equal(h.calls.length, 1);
});

test('identical display names at distinct destination coordinates remain separate routes', () => {
  const h = harness(); h.enable();
  assert.equal(h.recover([report(1), report(2, { to: { q: -90 }, marauder: 3 })]), 2);
  assert.equal(campaigns(h).length, 2);
  assert.deepEqual(campaigns(h).map(value => value.targetCoordinate.q).sort((a, b) => a - b), [-93, -90]);
});

test('distinct origin coordinates remain separate routes even with the same destination', () => {
  const h = harness(); h.enable();
  assert.equal(h.recover([report(1), report(2, { from: { q: -96 }, marauder: 4 })]), 2);
  assert.equal(campaigns(h).length, 2);
  assert.deepEqual(campaigns(h).map(value => value.originCoordinate.q).sort((a, b) => a - b), [-96, -95]);
});

test('outcomes and report UUID dedupe are isolated between accounts', async () => {
  const h = harness(); h.enable();
  assert.equal(h.recover([report(1, { when: 4000, verdict: 'Victory' })], SCOPE), 1);
  assert.equal(h.recover([report(1, { when: 3000, marauder: 8 })], OTHER_SCOPE), 1);
  assert.equal(campaigns(h).length, 1); assert.equal(campaigns(h)[0].scope, OTHER_SCOPE);
  await h.controller.tick(); assert.equal(h.calls.length, 0, 'a recovered report for another account cannot run in this account');
  h.context = { scope: OTHER_SCOPE }; await h.controller.tick(); assert.equal(h.calls.length, 1);
});

for (const verdict of ['Victory', 'Captured', 'Draw']) for (const reverse of [false, true]) {
  test('newer ' + verdict + ' prevents an older defeat being revived, reverse input=' + reverse, async () => {
    const h = harness(); h.enable();
    const values = [report(1, { when: 2000 }), report(2, { when: 3000, verdict })];
    assert.equal(h.recover(reverse ? values.reverse() : values), 1);
    assert.equal(campaigns(h).length, 0); await h.controller.tick(); assert.equal(h.calls.length, 0);
    h.reload(); assert.equal(h.recover([report(1, { when: 2000 })]), 0);
    await h.controller.tick(); assert.equal(h.calls.length, 0);
  });
}

for (const [label, edit] of [
  ['unknown attacker quantity', value => { value.detail.sections.battle.attackerShips[1] = { type: 'marauder', kind: 'unknown' }; }],
  ['fractional attacker quantity', value => { value.detail.sections.battle.attackerShips[1].quantity = 8.5; }],
  ['duplicate attacker type', value => { value.detail.sections.battle.attackerShips[0].type = 'marauder'; }],
  ['future result timestamp', value => { value.item.takenAt = 20000; value.detail.createdAt = 20000; }],
]) for (const reverse of [false, true]) {
  test('latest invalid result blocks an older defeat: ' + label + ', reverse input=' + reverse, async () => {
    const h = harness(); h.enable();
    const old = report(1, { when: 2000, marauder: 7 }), latest = report(2, { when: 3000, marauder: 8 }); edit(latest);
    assertNumeric(h.recover(reverse ? [latest, old] : [old, latest]));
    assert.equal(campaigns(h).length, 0); assertExplained(h);
    assert.equal(h.controller.observeReport({ scope: SCOPE, ...clone(old) }), false, 'the regular watcher cannot revive the older defeat after backfill');
    await h.controller.tick(); assert.equal(h.calls.length, 0);
    h.reload(); assert.equal(h.controller.observeReport({ scope: SCOPE, ...clone(old) }), false, 'the recovery frontier survives reload');
    await h.controller.tick(); assert.equal(h.calls.length, 0); assert.equal(campaigns(h).length, 0);
  });
}

for (const verdict of ['Defeat', 'Victory', 'Draw']) test('different report UUIDs with identical timestamps cannot authorize an attack: ' + verdict, async () => {
  const h = harness(); h.enable();
  assertNumeric(h.recover([report(1, { when: 3000, marauder: 8 }), report(2, { when: 3000, marauder: 9, verdict })]));
  assert.equal(campaigns(h).length, 0); assertExplained(h); await h.controller.tick(); assert.equal(h.calls.length, 0);
  h.reload(); assert.equal(h.controller.observeReport({ scope: SCOPE, ...report(3, { when: 2000 }) }), false);
  await h.controller.tick(); assert.equal(h.calls.length, 0);
});

test('an identical report UUID repeated within a batch is one report rather than an ambiguous tie', async () => {
  const h = harness(); h.enable(); const value = report(1);
  assert.equal(h.recover([value, clone(value)]), 1); await h.controller.tick(); assert.equal(h.calls.length, 1);
});

test('disabled recovery does not change stored state or enqueue anything', async () => {
  const h = harness(), previous = h.stored; h.now = 10000;
  assert.equal(h.recover([report(1)]), 0); assert.deepEqual(h.stored, previous);
  await h.controller.tick(); assert.equal(h.calls.length, 0); assert.equal(campaigns(h).length, 0);
});

test('recovery ignores reports before or exactly at activation', async () => {
  const h = harness(); h.enable();
  assert.equal(h.recover([report(1, { when: 999 }), report(2, { when: 1000 })]), 0);
  await h.controller.tick(); assert.equal(campaigns(h).length, 0); assert.equal(h.calls.length, 0);
});

test('the retained history floor still prevents recovery of discarded old history', async () => {
  const h = harness(); h.enable(); h.stored = { ...h.stored, floorAt: 3500 }; h.reload();
  assert.equal(h.recover([report(1, { when: 3000 }), report(2, { when: 3500 })]), 0);
  assert.equal(h.recover([report(3, { when: 4000 })]), 1); await h.controller.tick();
  assert.equal(h.calls.length, 1); assert.equal(campaigns(h)[0].triggerReportId, uuid(3));
});

test('reloading and redelivering a recovered defeat never enqueues the same retry twice', async () => {
  const h = harness(); h.enable(); const value = report(1);
  assert.equal(h.recover([value]), 1); h.reload();
  assert.equal(h.recover([value]), 0); await h.controller.tick(); assert.equal(h.calls.length, 1);
  h.reload(); assert.equal(h.recover([value]), 0); await h.controller.tick();
  assert.equal(h.calls.length, 1); assert.equal(h.queue.length, 1); assert.deepEqual(h.queue[0].quantities, amounts(9));
});

test('failed persistent storage is rethrown and redelivery remains safe', async () => {
  const h = harness(); h.enable(); const value = report(1), previous = h.stored;
  h.failSave = true; assert.throws(() => h.recover([value]), /guardar|persist|storage/i);
  assert.deepEqual(h.stored, previous); assert.equal(h.calls.length, 0); assert.equal(h.events.length, 0);
  h.failSave = false; h.reload(); assert.equal(h.recover([value]), 1);
  await h.controller.tick(); assert.equal(h.calls.length, 1);
  h.reload(); assert.equal(h.recover([value]), 0); await h.controller.tick(); assert.equal(h.calls.length, 1);
});

test('a failed save of an invalid latest-result boundary is retried before an older defeat can run', async () => {
  const h = harness(); h.enable(); const previous = h.stored;
  const old = report(1, { when: 2000 }), latest = report(2, { when: 3000 });
  latest.detail.sections.battle.attackerShips[1].kind = 'unknown';
  h.failSave = true; assert.throws(() => h.recover([old, latest]), /guardar|persist|storage/i);
  assert.deepEqual(h.stored, previous); assert.equal(h.calls.length, 0);
  h.failSave = false; h.reload(); assertNumeric(h.recover([old, latest]));
  assert.equal(h.controller.observeReport({ scope: SCOPE, ...clone(old) }), false);
  await h.controller.tick(); assert.equal(campaigns(h).length, 0); assert.equal(h.calls.length, 0);
});

for (const [label, latest] of [
  ['unknown quantities', () => { const value = report(2, { when: 12000 }); value.detail.sections.battle.attackerShips[1].kind = 'unknown'; return [value]; }],
  ['future timestamp', () => [report(2, { when: 20000 })]],
  ['timestamp tie', () => [report(2, { when: 12000 }), report(3, { when: 12000, marauder: 9 })]],
]) test('recovery pauses an already queued campaign for review after ' + label, async () => {
  const h = harness(); h.enable(); assert.equal(h.recover([report(1, { when: 2000 })]), 1);
  await h.controller.tick(); const id = campaigns(h)[0].id; h.now = 13000;
  assertNumeric(h.recover(latest())); assertExplained(h);
  assert.equal(campaigns(h).length, 1); assert.equal(campaigns(h)[0].id, id);
  assert.equal(campaigns(h)[0].status, 'uncertain'); assert.equal(h.queue[0].status, 'paused');
  h.reload(); await h.controller.tick(); assert.equal(campaigns(h)[0].status, 'uncertain'); assert.equal(h.calls.length, 1);
});

test('recovery never resumes a campaign paused while its ships were being prepared', async () => {
  const h = harness(); h.enable(); assert.equal(h.recover([report(1, { when: 2000, marauder: 7 })]), 1);
  await h.controller.tick(); const id = campaigns(h)[0].id; h.controller.pause(id);
  assertNumeric(h.recover([report(2, { when: 3000, marauder: 8 })])); await h.controller.tick();
  assert.equal(campaigns(h).length, 1); assert.equal(campaigns(h)[0].id, id);
  assert.ok(['paused', 'uncertain'].includes(campaigns(h)[0].status));
  assert.equal(h.calls.length, 1); assert.equal(h.queue[0].status, 'paused');
});

test('recovery never recreates a cancelled route even if the recovered fleet size differs', async () => {
  const h = harness(); h.enable(); assert.equal(h.recover([report(1, { when: 2000, marauder: 7 })]), 1);
  await h.controller.tick(); const id = campaigns(h)[0].id; h.controller.cancel(id);
  assertNumeric(h.recover([report(2, { when: 3000, marauder: 12 })])); await h.controller.tick();
  assert.equal(campaigns(h).length, 1); assert.equal(campaigns(h)[0].id, id); assert.equal(campaigns(h)[0].status, 'cancelled');
  assert.equal(h.calls.length, 1); assert.equal(h.queue.length, 0);
});

test('a paused campaign awaiting a result stays inactive when its defeat is recovered', async () => {
  const h = harness(); h.enable(); assert.equal(h.recover([report(1, { when: 2000, marauder: 7 })]), 1);
  await h.controller.tick(); h.sendJob(11000); await h.controller.tick();
  const id = campaigns(h)[0].id; h.controller.pause(id); h.now = 13000;
  assertNumeric(h.recover([report(2, { when: 12000, marauder: 8 })])); await h.controller.tick();
  assert.equal(campaigns(h).length, 1); assert.ok(['paused', 'uncertain'].includes(campaigns(h)[0].status));
  assert.equal(h.calls.length, 1, 'recovered results cannot override the explicit pause');
});
