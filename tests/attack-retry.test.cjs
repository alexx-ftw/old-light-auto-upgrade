'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = process.env.QA_ATTACK_RETRY_SOURCE || [path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'),
  path.join(__dirname, 'old-light-attack-retry.fragment.js')].find(file => fs.existsSync(file));
const source = fs.readFileSync(sourcePath, 'utf8');
const start = source.indexOf('// BEGIN ATTACK RETRY CONTROLLER');
const end = source.indexOf('// END ATTACK RETRY CONTROLLER', start);
assert.ok(start >= 0 && end > start, 'attack retry controller markers exist');
const sandbox = vm.createContext({ TextEncoder, Date, structuredClone });
vm.runInContext(source.slice(start, end) + '\nthis.factory = createAttackRetryController;', sandbox);
const factory = sandbox.factory;
const clone = value => structuredClone(value);
const originId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scope = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const amounts = (marauder = 7, extra = {}) => ({ probe: 0, marauder, sentinel: 0, vanguard: 0, ...extra });
function harness(options = {}) {
  let clock = 1000, stored = options.stored === undefined ? {} : clone(options.stored), queue = [], saves = 0;
  let failSave = false, failQueue = false, verify = null, fn;
  const events = [], calls = [], writes = [], pauses = [], resumes = [], cancels = [];
  let context = { scope, originId, originName: "xMix's System", selectionCount: 1, active: true, canAct: true };
  const deps = { now: () => clock, load: () => clone(stored), save: value => {
    if (failSave) throw new Error('storage unavailable');
    stored = clone(value); writes.push(clone(value)); saves++; return true;
  }, getContext: () => clone(context), getJobs: () => clone(queue),
  verifyOrigin: async campaign => verify ? verify(campaign) : ({ originId, name: "xMix's System", coordinate: { q: -95, r: 260 } }),
  queueOnce: (spec, { id }) => {
    calls.push({ spec: clone(spec), id, storedAtCall: clone(stored) });
    if (failQueue) throw new Error('queue unavailable');
    const collision = queue.find(job => job.id === id);
    if (collision) return clone(collision);
    if (queue.some(job => job.scope === spec.scope && job.originId === spec.originId && job.status !== 'sent')) throw new Error('occupied');
    const job = { id, ...clone(spec), status: 'waiting', createdAt: clock, updatedAt: clock,
      claimedAt: null, sentAt: null, message: '', needsReview: false };
    queue = [...queue.filter(item => item.originId !== spec.originId || item.scope !== spec.scope), job]; return clone(job);
  }, pauseJob: id => { pauses.push(id); const job = queue.find(item => item.id === id); if (job && !['sending', 'sent', 'uncertain'].includes(job.status)) job.status = 'paused'; },
  resumeJob: id => { resumes.push(id); const job = queue.find(item => item.id === id); if (job) job.status = 'waiting'; },
  cancelJob: id => { cancels.push(id); queue = queue.filter(item => item.id !== id); },
  send: event => events.push(clone(event)) };
  fn = factory(deps);
  return { get controller() { return fn; }, events, calls, writes, pauses, resumes, cancels,
    get stored() { return clone(stored); }, set stored(value) { stored = clone(value); },
    get queue() { return clone(queue); }, set queue(value) { queue = clone(value); },
    get saves() { return saves; }, set now(value) { clock = value; }, get now() { return clock; },
    set failSave(value) { failSave = value; }, set failQueue(value) { failQueue = value; },
    set verify(value) { verify = value; }, set context(value) { context = { ...context, ...value }; },
    reload() { fn.destroy(); fn = factory(deps); return fn; },
    enable() { fn.setConfig({ enabled: true }); clock = 2000; },
    report(n = 1, options = {}) {
      const quantity = options.quantities || amounts();
      const takenAt = options.takenAt || clock;
      const report = { scope, item: { id: uuid(n), takenAt, title: 'You attacked Mirairot', verdict: options.verdict || 'Defeat' },
        detail: { id: uuid(n), createdAt: takenAt,
          route: { from: { q: -95, r: 260, name: "xMix's System", ownerKind: 'owned', ownerName: 'xMix' },
            to: { q: -93, r: 266, name: 'Mirairot Sovereignty 001', ownerKind: 'human', ownerName: 'Mirairot' } },
          sections: { battle: { attackerShips: Object.entries(quantity).map(([type, quantity]) => ({ type, kind: 'exact', quantity })),
            attackerLost: Object.entries(quantity).map(([type, quantity]) => ({ type, kind: 'exact', quantity })) } } } };
      return report;
    },
    async plan(n = 1, options = {}) { const accepted = fn.observeReport(this.report(n, options)); await fn.tick(); return accepted; },
    sendJob(takenAt = clock + 1000) { clock = takenAt; const job = queue[0]; assert.ok(job, 'mission queued');
      job.status = 'sent'; job.sentAt = clock; job.claimedAt = clock; job.updatedAt = clock; },
  };
}
const campaign = h => h.controller.exportConfig().campaigns.at(-1);

test('disabled on first install; default limit 3, production on, no historical actions', async () => {
  const h = harness(); assert.equal(h.controller.isEnabled(), false); assert.equal(h.controller.exportConfig().maxRetries, 3);
  assert.equal(h.controller.exportConfig().produceMissing, true);
  assert.equal(h.controller.observeReport(h.report()), false); await h.controller.tick(); assert.equal(h.calls.length, 0);
  h.enable(); assert.equal(h.controller.observeReport(h.report(2, { takenAt: 999 })), false);
  assert.equal(h.controller.observeReport(h.report(3, { takenAt: 1000 })), false); assert.equal(h.calls.length, 0);
});
test('7 Marauder defeat creates 8 Marauder exact native amounts mission', async () => {
  const h = harness(); h.enable(); assert.equal(await h.plan(), true);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].id, 'retry:' + uuid(1));
  assert.deepEqual(h.calls[0].spec.quantities, amounts(8));
  assert.deepEqual(h.calls[0].spec.target, { mode: 'amounts', routeKey: '', presetKey: '', label: 'Mirairot Sovereignty 001',
    coordinate: { q: -93, r: 266 }, originCoordinate: { q: -95, r: 260 } });
  assert.equal(h.calls[0].spec.produce, true); assert.equal(h.calls[0].spec.autoSend, true);
});
test('durable queue claim is persisted before the queue sees any order', async () => {
  const h = harness(); h.enable(); await h.plan();
  const claim = h.calls[0].storedAtCall.campaigns[0]; assert.equal(claim.queueJobId, h.calls[0].id);
  assert.equal(claim.status, 'queued'); assert.equal(claim.queueConfirmed, false);
});
test('mixed fleet increases Marauder only and retains all other quantities', async () => {
  const h = harness(); h.enable(); await h.plan(1, { quantities: amounts(7, { probe: 2, sentinel: 3, vanguard: 1 }) });
  assert.deepEqual(h.queue[0].quantities, amounts(8, { probe: 2, sentinel: 3, vanguard: 1 }));
});
test('Sentinel-only battle adds one Marauder without altering Sentinel', async () => {
  const h = harness(); h.enable(); await h.plan(1, { quantities: amounts(0, { sentinel: 2 }) });
  assert.deepEqual(h.queue[0].quantities, amounts(1, { sentinel: 2 }));
});
test('exact omitted ship types normalize to zero', async () => {
  const h = harness(); h.enable(); const report = h.report(); report.detail.sections.battle.attackerShips = [{ type: 'marauder', kind: 'exact', quantity: 7 }];
  assert.equal(h.controller.observeReport(report), true); await h.controller.tick(); assert.deepEqual(h.queue[0].quantities, amounts(8));
});
for (const [name, edit] of [
  ['detail timestamp differs by one millisecond', r => { r.detail.createdAt += 1; }],
  ['detail timestamp differs by several seconds', r => { r.detail.createdAt -= 1500; }],
  ['exact numeric entries omit kind', r => { for (const entry of r.detail.sections.battle.attackerShips) delete entry.kind; }],
  ['independent timestamps and omitted kind together', r => {
    r.detail.createdAt = new Date(r.item.takenAt - 1000).toISOString();
    for (const entry of r.detail.sections.battle.attackerShips) delete entry.kind;
  }],
]) test('native report compatibility: ' + name + ' continues 8 -> 9 -> 10 and stops on Victory', async () => {
  const h = harness(); h.enable();
  let report = h.report(1, { quantities: amounts(8) }); edit(report);
  assert.equal(h.controller.observeReport(report), true); await h.controller.tick();
  assert.deepEqual(h.queue[0].quantities, amounts(9));
  assert.equal(h.events.filter(event => event.type === 'attack.retry' && event.id.endsWith(':planned')).length, 1);
  assert.equal(campaign(h).lastOutcomeAt, report.item.takenAt, 'The list timestamp controls outcome ordering');
  h.sendJob(3000); await h.controller.tick(); h.reload(); h.now = 4000;
  report = h.report(2, { quantities: amounts(9) }); edit(report);
  assert.equal(h.controller.observeReport(report), true); await h.controller.tick();
  assert.deepEqual(h.queue[0].quantities, amounts(10)); assert.equal(h.calls.length, 2);
  assert.equal(h.controller.observeReport(report), false, 'A duplicate report never creates another retry');
  h.sendJob(5000); await h.controller.tick(); h.now = 6000;
  report = h.report(3, { verdict: 'Victory', quantities: amounts(10) }); edit(report);
  assert.equal(h.controller.observeReport(report), true); await h.controller.tick();
  assert.equal(campaign(h).status, 'completed'); assert.equal(h.calls.length, 2);
});
for (const takenAt of [undefined, null, 'not a date']) test('detail timestamp is a fallback for invalid list timestamp: ' + String(takenAt), async () => {
  const h = harness(); h.enable(); const report = h.report(1, { quantities: amounts(8) });
  report.item.takenAt = takenAt; report.detail.createdAt = new Date(h.now).toISOString();
  assert.equal(h.controller.observeReport(report), true); await h.controller.tick();
  assert.deepEqual(h.queue[0].quantities, amounts(9)); assert.equal(campaign(h).lastOutcomeAt, h.now);
});
for (const createdAt of [undefined, null, 'not a date']) test('valid list timestamp is authoritative despite unusable detail timestamp: ' + String(createdAt), async () => {
  const h = harness(); h.enable(); const report = h.report(1, { quantities: amounts(8) }); report.detail.createdAt = createdAt;
  assert.equal(h.controller.observeReport(report), true); await h.controller.tick();
  assert.deepEqual(h.queue[0].quantities, amounts(9)); assert.equal(campaign(h).lastOutcomeAt, report.item.takenAt);
});
test('omitted exact kinds preserve every other ship type in the retry', async () => {
  const h = harness(); h.enable(); const report = h.report(1, { quantities: amounts(8, { probe: 2, sentinel: 3, vanguard: 1 }) });
  for (const entry of report.detail.sections.battle.attackerShips) delete entry.kind;
  assert.equal(h.controller.observeReport(report), true); await h.controller.tick();
  assert.deepEqual(h.queue[0].quantities, amounts(9, { probe: 2, sentinel: 3, vanguard: 1 }));
});
for (const [name, edit] of [
  ['incoming attack', r => { r.detail.route.from.ownerKind = 'human'; r.detail.route.to.ownerKind = 'owned'; }],
  ['incoming section', r => { r.detail.sections.incoming = {}; }],
  ['probe section', r => { r.detail.sections.probe = { tier: 0 }; }],
  ['Probed verdict', r => { r.item.verdict = 'Probed'; }],
  ['unknown verdict despite total losses', r => { r.item.verdict = ''; }],
  ['unknown report variant', r => { r.detail.variant = { kind: 'territory_raid' }; }],
  ['unknown attacker quantities', r => { r.detail.sections.battle.attackerShips[1].kind = 'unknown'; }],
  ['null attacker kind', r => { r.detail.sections.battle.attackerShips[1].kind = null; }],
  ['unrecognized attacker kind', r => { r.detail.sections.battle.attackerShips[1].kind = 'estimate'; }],
  ['approximate attacker quantities', r => { r.detail.sections.battle.attackerShips[1].kind = 'approximate'; }],
  ['approximate marker on exact entry', r => { r.detail.sections.battle.attackerShips[1].approximate = true; }],
  ['approximate marker on entry without kind', r => { delete r.detail.sections.battle.attackerShips[1].kind; r.detail.sections.battle.attackerShips[1].approximate = true; }],
  ['duplicate attacker type', r => { r.detail.sections.battle.attackerShips[0].type = 'marauder'; }],
  ['unknown attacker type', r => { r.detail.sections.battle.attackerShips[0].type = 'destroyer'; }],
  ['negative quantity', r => { r.detail.sections.battle.attackerShips[1].quantity = -1; }],
  ['fractional quantity without kind', r => { delete r.detail.sections.battle.attackerShips[1].kind; r.detail.sections.battle.attackerShips[1].quantity = 8.5; }],
  ['string quantity without kind', r => { delete r.detail.sections.battle.attackerShips[1].kind; r.detail.sections.battle.attackerShips[1].quantity = '8'; }],
  ['null quantity without kind', r => { delete r.detail.sections.battle.attackerShips[1].kind; r.detail.sections.battle.attackerShips[1].quantity = null; }],
  ['unsafe quantity', r => { r.detail.sections.battle.attackerShips[1].quantity = Number.MAX_SAFE_INTEGER; }],
  ['over 50000 ships', r => { r.detail.sections.battle.attackerShips[1].quantity = 50001; }],
  ['fractional coordinate', r => { r.detail.route.to.q = -93.5; }],
  ['missing origin coordinate', r => { delete r.detail.route.from.r; }],
  ['origin and target identical', r => { r.detail.route.to.q = -95; r.detail.route.to.r = 260; }],
  ['same origin name alone', r => { delete r.detail.route.from.ownerKind; }],
  ['mismatched report UUID', r => { r.detail.id = uuid(2); }],
  ['no valid timestamp', r => { r.item.takenAt = null; r.detail.createdAt = 'not a date'; }],
  ['list timestamp before activation despite newer detail timestamp', r => { r.item.takenAt = 999; }],
  ['fallback timestamp before activation', r => { r.item.takenAt = null; r.detail.createdAt = 999; }],
  ['fallback timestamp exactly at activation', r => { r.item.takenAt = null; r.detail.createdAt = 1000; }],
  ['future list timestamp despite past detail timestamp', r => { r.item.takenAt += 10000; }],
  ['future fallback timestamp', r => { r.item.takenAt = null; r.detail.createdAt += 10000; }],
  ['future report', r => { r.item.takenAt += 10000; r.detail.createdAt += 10000; }],
  ['Probe-only fleet', r => { r.detail.sections.battle.attackerShips = [{ type: 'probe', kind: 'exact', quantity: 7 }]; }],
  ['Vanguard-only fleet', r => { r.detail.sections.battle.attackerShips = [{ type: 'vanguard', kind: 'exact', quantity: 7 }]; }],
]) test('rejects ' + name, async () => {
  const h = harness(); h.enable(); const report = h.report(); edit(report);
  assert.equal(h.controller.observeReport(report), false); await h.controller.tick(); assert.equal(h.calls.length, 0);
});
test('zero plunder and unknown defending fleet do not affect an explicit Defeat', async () => {
  const h = harness(); h.enable(); const report = h.report();
  report.detail.sections.battle.defenderShips = [{ type: 'marauder', kind: 'unknown' }]; report.detail.sections.battle.plundered = { palladium: 0, iridium: 0, credits: 0 };
  assert.equal(h.controller.observeReport(report), true); await h.controller.tick(); assert.equal(h.calls.length, 1);
});
test('native nullable optional sections and variant count as absent', async () => {
  const h = harness(); h.enable(); const report = h.report();
  report.detail.sections.incoming = null; report.detail.sections.probe = null; report.detail.variant = null;
  assert.equal(h.controller.observeReport(report), true); await h.controller.tick(); assert.equal(h.calls.length, 1);
});
test('native maximum coordinate bound is enforced before enqueue', async () => {
  const h = harness(); h.enable(); const report = h.report(); report.detail.route.to.q = 10000001;
  assert.equal(h.controller.observeReport(report), false); await h.controller.tick(); assert.equal(h.calls.length, 0);
});
test('7 -> 8 -> 9 chain counts confirmed sends and stops on Victory', async () => {
  const h = harness(); h.enable(); await h.plan(); h.sendJob(3000); await h.controller.tick();
  assert.equal(campaign(h).retries, 1); assert.equal(campaign(h).status, 'awaiting_report');
  h.now = 4000; await h.plan(2, { quantities: amounts(8) }); assert.deepEqual(h.queue[0].quantities, amounts(9));
  h.sendJob(5000); await h.controller.tick(); h.now = 6000;
  assert.equal(h.controller.observeReport(h.report(3, { quantities: amounts(9), verdict: 'Victory' })), true);
  assert.equal(campaign(h).status, 'completed'); assert.equal(campaign(h).retries, 2); await h.controller.tick(); assert.equal(h.calls.length, 2);
});
test('default 3 retries enqueues 8, 9, 10 then stops after the third Defeat', async () => {
  const h = harness(); h.enable(); await h.plan();
  for (let n = 1; n <= 3; n++) { h.sendJob(h.now + 1000); await h.controller.tick(); h.now += 1000; await h.plan(n + 1, { quantities: amounts(7 + n) }); }
  assert.equal(h.calls.length, 3); assert.equal(campaign(h).status, 'limit'); assert.equal(campaign(h).retries, 3);
});
test('0 allows more than the default three retries', async () => {
  const h = harness(); h.enable(); h.controller.setConfig({ maxRetries: 0 }); await h.plan();
  for (let n = 1; n <= 5; n++) { h.sendJob(h.now + 1000); await h.controller.tick(); h.now += 1000; await h.plan(n + 1, { quantities: amounts(7 + n) }); }
  assert.equal(h.calls.length, 6); assert.equal(h.queue[0].quantities.marauder, 13);
});
test('maximum quantity does not overflow', async () => {
  const h = harness(); h.enable(); await h.plan(1, { quantities: amounts(50000) });
  assert.equal(h.calls.length, 0); assert.equal(campaign(h).status, 'limit'); assert.equal(campaign(h).quantities.marauder, 50000);
});
test('newer same-route victory cancels controller-owned unsent mission', async () => {
  const h = harness(); h.enable(); await h.plan(); h.now = 3000;
  assert.equal(h.controller.observeReport(h.report(2, { verdict: 'Victory', quantities: amounts(20) })), true);
  assert.equal(campaign(h).status, 'completed'); assert.equal(h.queue.length, 0); assert.equal(h.cancels.length, 1);
});
for (const kind of ['Captured', 'capture_success', 'loyalty']) test('capture stop via ' + kind, async () => {
  const h = harness(); h.enable(); await h.plan(); h.now = 3000;
  const report = h.report(2, { verdict: kind === 'Captured' ? 'Captured' : 'Victory' });
  if (kind === 'capture_success') report.detail.variant = { kind };
  if (kind === 'loyalty') report.detail.sections.battle.loyaltyChange = { captured: true };
  assert.equal(h.controller.observeReport(report), true); assert.equal(campaign(h).status, 'completed'); assert.equal(h.queue.length, 0);
});
test('Draw pauses and never escalates automatically', async () => {
  const h = harness(); h.enable(); await h.plan(); h.sendJob(3000); h.now = 4000;
  assert.equal(h.controller.observeReport(h.report(2, { verdict: 'Draw', quantities: amounts(8) })), true);
  assert.equal(campaign(h).status, 'paused'); assert.equal(campaign(h).resumeStatus, null);
  await h.controller.tick(); assert.equal(h.calls.length, 1); assert.throws(() => h.controller.resume(campaign(h).id), /revisión/);
});
test('duplicate report UUID and older/equal outcomes cannot restart route', async () => {
  const h = harness(); h.enable(); const report = h.report(); assert.equal(h.controller.observeReport(report), true);
  assert.equal(h.controller.observeReport(report), false); await h.controller.tick(); h.now = 4000;
  h.controller.observeReport(h.report(2, { verdict: 'Victory' }));
  assert.equal(h.controller.observeReport(h.report(3, { takenAt: 3500 })), false);
  assert.equal(h.controller.observeReport(h.report(4, { takenAt: 4000 })), false); assert.equal(h.calls.length, 1);
});
test('same-route mismatched retry fleet pauses as ambiguous', async () => {
  const h = harness(); h.enable(); await h.plan(); h.sendJob(3000); h.now = 4000;
  h.controller.observeReport(h.report(2, { quantities: amounts(7) }));
  assert.equal(campaign(h).status, 'uncertain'); await h.controller.tick(); assert.equal(h.calls.length, 1);
});
test('report preceding send confirmation cannot drive next retry', async () => {
  const h = harness(); h.enable(); await h.plan(); h.sendJob(4000); h.now = 5000;
  h.controller.observeReport(h.report(2, { quantities: amounts(8), takenAt: 3500 }));
  assert.equal(campaign(h).status, 'uncertain'); await h.controller.tick(); assert.equal(h.calls.length, 1);
});
test('fresh report of another exact route does not alter this campaign', async () => {
  const h = harness(); h.enable(); await h.plan(); h.now = 3000;
  const report = h.report(2, { verdict: 'Victory' }); report.detail.route.to.q += 1;
  h.controller.observeReport(report); assert.equal(campaign(h).status, 'queued'); assert.equal(h.queue.length, 1);
});
test('reload reconciles queued mission by deterministic id without recreation', async () => {
  const h = harness(); h.enable(); await h.plan(); h.reload(); await h.controller.tick(); await h.controller.tick();
  assert.equal(h.calls.length, 1); assert.equal(campaign(h).queueConfirmed, true);
});
test('vanished queue job becomes uncertain and never recreates after reload', async () => {
  const h = harness(); h.enable(); await h.plan(); h.queue = []; h.reload(); await h.controller.tick(); await h.controller.tick();
  assert.equal(campaign(h).status, 'uncertain'); assert.equal(h.calls.length, 1);
});
test('unconfirmed native send never escalates', async () => {
  const h = harness(); h.enable(); await h.plan(); const queue = h.queue; queue[0].status = 'uncertain'; queue[0].needsReview = true; h.queue = queue;
  await h.controller.tick(); assert.equal(campaign(h).status, 'uncertain'); h.now = 4000;
  h.controller.observeReport(h.report(2, { quantities: amounts(8) })); await h.controller.tick(); assert.equal(h.calls.length, 1);
});
for (const status of ['waiting', 'paused', 'sending', 'uncertain']) test('existing manual ' + status + ' mission is never overwritten', async () => {
  const h = harness(); h.enable(); h.queue = [{ id: 'manual', scope, originId, status }];
  await h.plan(); assert.equal(h.calls.length, 0); assert.equal(h.queue[0].id, 'manual'); assert.equal(campaign(h).status, 'waiting_slot');
});
test('verified coordinate is required; same name cannot bind another system', async () => {
  const h = harness(); h.enable(); h.verify = async () => ({ originId, name: "xMix's System", coordinate: { q: -94, r: 260 } });
  await h.plan(); assert.equal(h.calls.length, 0); assert.equal(campaign(h).originId, null);
});
for (const patch of [{ selectionCount: 2 }, { active: false }, { canAct: false }, { scope: 'other/player' }]) test('does not act with incompatible context ' + JSON.stringify(patch), async () => {
  const h = harness(); h.enable(); h.context = patch; await h.plan(); assert.equal(h.calls.length, 0);
});
test('context changing during origin verification prevents enqueue', async () => {
  const h = harness(); h.enable(); h.verify = async () => { h.context = { originId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    return { originId, name: "xMix's System", coordinate: { q: -95, r: 260 } }; };
  await h.plan(); assert.equal(h.calls.length, 0);
});
test('disable during asynchronous verification prevents enqueue', async () => {
  const h = harness(); h.enable(); let release;
  h.verify = () => new Promise(resolve => { release = resolve; }); h.controller.observeReport(h.report());
  const pending = h.controller.tick(); assert.equal(h.controller.isBusy(), true); h.controller.setConfig({ enabled: false });
  release({ originId, name: "xMix's System", coordinate: { q: -95, r: 260 } }); await pending;
  assert.equal(h.calls.length, 0); assert.equal(campaign(h).status, 'paused');
});
test('storage failure before claim prevents native queue invocation', async () => {
  const h = harness(); h.enable(); h.controller.observeReport(h.report()); h.failSave = true; await h.controller.tick(); assert.equal(h.calls.length, 0);
});
test('queue creation failure leaves durable uncertainty instead of retry loop', async () => {
  const h = harness(); h.enable(); h.failQueue = true; await h.plan(); h.failQueue = false; h.now += 5000;
  await h.controller.tick(); h.reload(); await h.controller.tick(); assert.equal(h.calls.length, 1); assert.equal(campaign(h).status, 'uncertain');
});
test('production disabled option is passed through without changing minimums', async () => {
  const h = harness(); h.enable(); h.controller.setConfig({ produceMissing: false }); await h.plan(); assert.equal(h.queue[0].produce, false);
  assert.equal(Object.hasOwn(h.stored, 'shipMinimums'), false);
});
test('disable pauses own unsent mission and campaigns; enabling does not silently resume', async () => {
  const h = harness(); h.enable(); await h.plan(); h.controller.setConfig({ enabled: false });
  assert.equal(h.queue[0].status, 'paused'); assert.equal(campaign(h).status, 'paused');
  h.now += 1000; h.controller.setConfig({ enabled: true }); await h.controller.tick(); assert.equal(h.queue[0].status, 'paused');
  h.controller.resume(campaign(h).id); assert.equal(h.queue[0].status, 'waiting'); assert.equal(campaign(h).status, 'queued');
});
test('settings toggles and pause are idempotent for a queue job already paused', async () => {
  const h = harness(); h.enable(); await h.plan(); h.controller.setConfig({ enabled: false });
  const pauses = h.pauses.length; await h.controller.tick(); await h.controller.tick();
  assert.equal(h.pauses.length, pauses);
});
test('changing mutable job settings or display names cannot prevent pausing an owned retry', async () => {
  const h = harness(); h.enable(); await h.plan(); const queue = h.queue;
  queue[0].produce = false; queue[0].autoSend = false; queue[0].originName = 'Renamed system'; queue[0].target.label = 'Renamed target'; h.queue = queue;
  h.controller.setConfig({ enabled: false }); assert.equal(h.queue[0].status, 'paused');
});
test('in-flight defeat does not restart a cancelled campaign', async () => {
  const h = harness(); h.enable(); await h.plan(); h.sendJob(3000); await h.controller.tick();
  h.controller.cancel(campaign(h).id); h.now = 4000; h.controller.observeReport(h.report(2, { quantities: amounts(8) }));
  await h.controller.tick(); assert.equal(h.calls.length, 1); assert.equal(h.controller.exportConfig().campaigns.length, 1);
  assert.equal(campaign(h).status, 'cancelled');
});
test('reducing retry limit pauses an already queued extra attempt immediately', async () => {
  const h = harness(); h.enable(); await h.plan(); h.sendJob(3000); await h.controller.tick(); h.now = 4000;
  await h.plan(2, { quantities: amounts(8) }); assert.equal(h.queue[0].quantities.marauder, 9);
  h.controller.setConfig({ maxRetries: 1 }); assert.equal(campaign(h).status, 'limit');
  assert.equal(h.queue[0].status, 'paused'); assert.equal(h.controller.canRunJob(h.queue[0]), false);
});
test('gate permits exact current waiting and sending retry jobs without writing state', async () => {
  const h = harness(); h.enable(); await h.plan(); const writes = h.saves;
  assert.equal(h.controller.canRunJob(h.queue[0]), true); assert.equal(h.saves, writes);
  const queue = h.queue; queue[0].status = 'sending'; queue[0].claimedAt = 3000; h.queue = queue;
  assert.equal(h.controller.canRunJob(h.queue[0]), true); assert.equal(h.saves, writes);
  assert.equal(h.controller.canRunJob({ id: 'manual-preset' }), true);
});
for (const [name, change] of [
  ['cancelled queue entry', h => { h.queue = []; }],
  ['paused queue entry', h => { const queue = h.queue; queue[0].status = 'paused'; h.queue = queue; }],
  ['newer claimedAt', h => { const queue = h.queue; queue[0].claimedAt++; h.queue = queue; }],
  ['changed fleet amounts', h => { const queue = h.queue; queue[0].quantities.marauder++; h.queue = queue; }],
  ['changed production authorization', h => { const queue = h.queue; queue[0].produce = false; h.queue = queue; }],
  ['disabled automatic sending', h => { const queue = h.queue; queue[0].autoSend = false; h.queue = queue; }],
  ['new uncertainty marker', h => { const queue = h.queue; queue[0].needsReview = true; h.queue = queue; }],
  ['disabled feature from another instance', h => { const saved = h.stored; saved.enabled = false; h.stored = saved; }],
  ['campaign paused from another instance', h => { const saved = h.stored; saved.campaigns[0].resumeStatus = 'queued'; saved.campaigns[0].status = 'paused'; h.stored = saved; }],
  ['corrupt config', h => { h.stored = { bad: true }; }],
]) test('guard sees ' + name + ' during preparation without waiting for tick', async () => {
  const h = harness(); h.enable(); await h.plan(); const queue = h.queue; queue[0].status = 'sending'; queue[0].claimedAt = 3000; h.queue = queue;
  const captured = h.queue[0]; assert.equal(h.controller.canRunJob(captured), true); change(h);
  assert.equal(h.controller.canRunJob(captured), false);
});
test('unknown orphan retry job is denied while manual jobs stay independent', () => {
  const h = harness(); h.enable(); assert.equal(h.controller.canRunJob({ id: 'retry:' + uuid(1), status: 'waiting' }), false);
  assert.equal(h.controller.canRunJob({ id: 'manual:' + uuid(1), status: 'waiting' }), true);
});
test('observer throws on storage write failure so the report reader can redeliver', async () => {
  const h = harness(); h.enable(); h.failSave = true; const report = h.report();
  assert.throws(() => h.controller.observeReport(report), /guardar/); assert.equal(h.calls.length, 0);
  h.failSave = false; assert.equal(h.controller.observeReport(report), true); await h.controller.tick(); assert.equal(h.calls.length, 1);
});
test('observer throws on corrupt storage so a failed read is not marked delivered', () => {
  const h = harness(); h.enable(); h.stored = { bad: true }; assert.throws(() => h.controller.observeReport(h.report()), /leer/);
});
test('pause, resume and cancel never affect manual missions', async () => {
  const h = harness(); h.enable(); h.queue = [{ id: 'manual', scope, originId, status: 'waiting' }]; await h.plan();
  h.controller.pause(campaign(h).id); h.controller.resume(campaign(h).id); h.controller.cancel(campaign(h).id);
  assert.equal(h.queue[0].id, 'manual'); assert.equal(h.pauses.length + h.resumes.length + h.cancels.length, 0);
});
test('import disables and pauses campaigns, preserving manual queue', async () => {
  const h = harness(); h.enable(); await h.plan(); const exported = h.controller.exportConfig();
  const target = harness(); target.queue = [{ id: 'manual', scope, originId, status: 'waiting' }]; target.controller.importConfig(exported);
  assert.equal(target.controller.isEnabled(), false); assert.equal(target.controller.getEnabledAt(), 0);
  assert.equal(campaign(target).status, 'paused'); await target.controller.tick(); assert.equal(target.queue[0].status, 'waiting');
});
test('rollback restores enabled config and exact prior campaign status', async () => {
  const h = harness(); h.enable(); await h.plan(); const original = h.stored; const token = h.controller.backupCheckpoint();
  h.controller.importConfig({}); h.controller.restoreCheckpoint(token); assert.deepEqual(h.stored, original);
  assert.equal(h.controller.isEnabled(), true); assert.equal(campaign(h).status, 'queued');
  assert.throws(() => h.controller.restoreCheckpoint(token), /recuperación/);
});
test('opaque rollback restores corrupt raw storage without enabling work', async () => {
  const h = harness({ stored: 'not valid JSON config' }); const token = h.controller.backupCheckpoint();
  h.controller.importConfig({}); h.controller.restoreCheckpoint(token); assert.equal(h.stored, 'not valid JSON config');
  assert.equal(h.controller.isEnabled(), false); await h.controller.tick(); assert.equal(h.calls.length, 0);
});
test('invalid settings and imports are rejected before mutation', () => {
  const h = harness(); const before = h.stored;
  for (const value of [{ maxRetries: -1 }, { maxRetries: 101 }, { enabled: true, enabledAt: 0 }, { schemaVersion: 2 }, { extra: true }]) {
    assert.throws(() => h.controller.importConfig(value)); assert.deepEqual(h.stored, before);
  }
  assert.throws(() => h.controller.setConfig({ enabledAt: 1 })); assert.deepEqual(h.stored, before);
});
test('invalid numeric draft autosaves without altering last valid limit', () => {
  const h = harness(); h.controller.setConfig({ maxRetriesDraft: '' }); assert.equal(h.stored.maxRetriesDraft, ''); assert.equal(h.stored.maxRetries, 3);
  h.controller.setConfig({ maxRetries: 12, maxRetriesDraft: '12' }); h.controller.setConfig({ maxRetriesDraft: '999' });
  assert.equal(h.stored.maxRetries, 12); assert.equal(h.stored.maxRetriesDraft, '999');
});
test('case variants of the same campaign UUID are rejected as duplicate identities', () => {
  const h = harness(); h.enable(); const report = h.report();
  report.item.id = report.detail.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; h.controller.observeReport(report);
  const value = h.controller.exportConfig(), duplicate = clone(value.campaigns[0]);
  duplicate.id = 'attack:' + duplicate.id.slice(7).toUpperCase(); duplicate.targetCoordinate.q++;
  value.campaigns.push(duplicate); assert.throws(() => h.controller.validateConfig(value), /válida/);
});
test('all operational notices use the independent retry notification type; settings stay quiet', async () => {
  const h = harness(); h.enable(); h.controller.setConfig({ maxRetries: 5, expanded: false }); assert.equal(h.events.length, 0);
  await h.plan(); h.sendJob(3000); await h.controller.tick();
  assert.ok(h.events.length >= 2); assert.ok(h.events.every(event => event.type === 'attack.retry'));
  assert.equal(new Set(h.events.map(event => event.id)).size, h.events.length);
});
test('history remains bounded and pruning watermark rejects forgotten older reports', async () => {
  const h = harness(); h.enable();
  for (let i = 1; i <= 515; i++) { h.now = 2000 + i; const report = h.report(i, { verdict: 'Victory' }); report.detail.route.to.q = i;
    assert.equal(h.controller.observeReport(report), true); }
  const state = h.controller.exportConfig(); assert.equal(state.processed.length, 512); assert.equal(state.outcomes.length, 512);
  assert.ok(state.floorAt >= 2003); const old = h.report(999, { takenAt: 2001 }); old.detail.route.to.q = 1;
  assert.equal(h.controller.observeReport(old), false); assert.equal(h.calls.length, 0);
});
test('campaign capacity is explicit and does not schedule delayed report when room appears', async () => {
  const h = harness(); h.enable();
  for (let i = 1; i <= 33; i++) { h.now++; const report = h.report(i); report.detail.route.to.q = i; h.controller.observeReport(report); }
  assert.equal(h.controller.exportConfig().campaigns.length, 32); assert.match(h.controller.getDiagnostics().notice, /32 campañas/);
  const first = h.controller.exportConfig().campaigns[0]; h.controller.cancel(first.id); h.controller.remove(first.id);
  const last = h.report(33, { takenAt: 2033 }); last.detail.route.to.q = 33; assert.equal(h.controller.observeReport(last), false);
});
