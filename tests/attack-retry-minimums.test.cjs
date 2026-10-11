'use strict';
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
const sandbox = vm.createContext({ TextEncoder, Date, structuredClone });
vm.runInContext(source.slice(start, end) + '\nthis.factory = createAttackRetryController;', sandbox);
const factory = sandbox.factory;
const clone = value => structuredClone(value);
const scope = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherScope = 'andromeda/cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const originId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const amounts = (marauder = 8, extra = {}) => ({ probe: 0, marauder, sentinel: 0, vanguard: 0, ...extra });
const state = h => clone(h.controller.exportConfig());
const pending = h => state(h).minimumUpdates;

function harness(options = {}) {
  let clock = 1000, stored = clone(options.stored ?? {}), queue = [], failSave = false, failQueueRead = false;
  let context = { scope, originId, originName: 'Technocratic Imperium', selectionCount: 1, active: true, canAct: true };
  let minimumResult = { status: 'deferred', changed: {}, reason: 'Waiting for an eligible account context.' };
  let minimumHandler = null, externalMinimums = amounts(0), fn;
  const writes = [], events = [], queueCalls = [], minimumCalls = [];
  const deps = {
    now: () => clock,
    load: () => clone(stored),
    save: value => {
      if (failSave) throw new Error('storage unavailable');
      stored = clone(value); writes.push(clone(value)); return true;
    },
    getContext: () => clone(context),
    getJobs: () => { if (failQueueRead) throw new Error('mission queue unavailable'); return clone(queue); },
    verifyOrigin: async () => ({ originId: context.originId, name: context.originName, coordinate: { q: -95, r: 260 } }),
    queueOnce: (spec, { id }) => {
      queueCalls.push({ id, spec: clone(spec) });
      const existing = queue.find(item => item.id === id);
      if (existing) return clone(existing);
      const job = { id, ...clone(spec), status: 'waiting', createdAt: clock, updatedAt: clock,
        claimedAt: null, sentAt: null, message: '', needsReview: false };
      queue.push(job); return clone(job);
    },
    pauseJob: id => { const job = queue.find(item => item.id === id); if (job && job.status === 'waiting') job.status = 'paused'; },
    resumeJob: id => { const job = queue.find(item => item.id === id); if (job && job.status === 'paused') job.status = 'waiting'; },
    cancelJob: id => { queue = queue.filter(item => item.id !== id); },
    send: event => events.push(clone(event)),
    raiseMinimums: request => {
      minimumCalls.push({ request: clone(request), storedAtCall: clone(stored) });
      if (minimumHandler) return minimumHandler(clone(request));
      if (minimumResult instanceof Error) throw minimumResult;
      return clone(minimumResult);
    },
  };
  fn = factory(deps);
  return {
    get controller() { return fn; },
    get stored() { return clone(stored); }, set stored(value) { stored = clone(value); },
    get queue() { return clone(queue); }, get now() { return clock; }, set now(value) { clock = value; },
    set context(value) { context = { ...context, ...value }; },
    set failSave(value) { failSave = value; },
    set failQueueRead(value) { failQueueRead = value; },
    set minimumResult(value) { minimumResult = value; },
    set minimumHandler(value) { minimumHandler = value; },
    get externalMinimums() { return clone(externalMinimums); }, set externalMinimums(value) { externalMinimums = clone(value); },
    writes, events, queueCalls, minimumCalls,
    applyMinimums() {
      minimumHandler = request => {
        if (request.scope !== context.scope) return { status: 'deferred', changed: {}, reason: 'Account not selected.' };
        const next = Object.fromEntries(Object.entries(request.quantities).map(([id, value]) => [id, Math.max(externalMinimums[id], value)]));
        const changed = Object.fromEntries(Object.entries(next).filter(([id, value]) => value > externalMinimums[id])
          .map(([id, after]) => [id, { before: externalMinimums[id], after }]));
        externalMinimums = next;
        return { status: Object.keys(changed).length ? 'applied' : 'noop', changed };
      };
    },
    reload() { fn.destroy(); fn = factory(deps); return fn; },
    enableMinimums() { fn.setConfig({ autoMinimums: true }); clock = 2000; },
    report(n = 1, options = {}) {
      const quantities = options.quantities || amounts();
      const takenAt = options.takenAt ?? clock, reportScope = options.scope || scope;
      return { scope: reportScope, item: { id: uuid(n), takenAt, title: 'You attacked Mirairot', verdict: options.verdict || 'Defeat' },
        detail: { id: uuid(n), createdAt: takenAt,
          route: { from: { q: -95, r: 260, name: 'Technocratic Imperium', ownerKind: 'owned', ownerName: 'xMix' },
            to: { q: options.targetQ ?? -93, r: 266, name: 'Mirairot Sovereignty 001', ownerKind: 'human', ownerName: 'Mirairot' } },
          sections: { battle: { attackerShips: Object.entries(quantities).map(([type, quantity]) => ({ type, kind: 'exact', quantity })),
            attackerLost: Object.entries(quantities).map(([type, quantity]) => ({ type, kind: 'exact', quantity })) } } } };
    },
  };
}

test('first install and legacy settings keep automatic minimum increases off', () => {
  const h = harness();
  const config = state(h);
  assert.equal(config.autoMinimums, false);
  assert.equal(config.minimumsEnabledAt, 0);
  assert.deepEqual(config.minimumUpdates, []);
  assert.deepEqual(config.minimumOutcomes, []);
  assert.equal(h.controller.isObservingReports(), false);
  assert.equal(h.controller.getObservationSince(), null);
  const legacy = { schemaVersion: 1, enabled: true, enabledAt: 400, produceMissing: false, maxRetries: 7,
    maxRetriesDraft: '7', expanded: false, campaigns: [], processed: [], outcomes: [], floorAt: 0 };
  const migrated = state(harness({ stored: legacy }));
  assert.equal(migrated.autoMinimums, false);
  assert.equal(migrated.minimumsEnabledAt, 0);
  assert.deepEqual(migrated.minimumUpdates, []);
  assert.deepEqual(migrated.minimumOutcomes, []);
  assert.equal(migrated.maxRetries, 7);
  assert.equal(migrated.enabledAt, 400);
  assert.equal(migrated.produceMissing, false);
});

test('enabling minimum increases observes reports without authorizing attacks and saves immediately', () => {
  const h = harness(); h.enableMinimums();
  assert.equal(h.controller.isEnabled(), false);
  assert.equal(h.controller.isObservingReports(), true);
  assert.equal(h.controller.getObservationSince(), 1000);
  assert.equal(h.stored.autoMinimums, true);
  assert.equal(h.stored.minimumsEnabledAt, 1000);
  assert.equal(h.stored.enabledAt, 0);
  h.controller.setConfig({ autoMinimums: true });
  assert.equal(h.stored.minimumsEnabledAt, 1000, 'an unchanged toggle does not discard the observation window');
  h.reload();
  assert.equal(h.controller.isEnabled(), false);
  assert.equal(h.controller.isObservingReports(), true);
  assert.equal(h.controller.getObservationSince(), 1000);
  assert.equal(h.events.length, 0, 'settings changes do not become operational notifications');
});

test('each report feature has its own activation date and observation uses the earliest active date', () => {
  const h = harness(); h.controller.setConfig({ enabled: true });
  assert.equal(h.controller.getObservationSince(), 1000);
  h.now = 3000; h.controller.setConfig({ autoMinimums: true });
  assert.equal(h.stored.enabledAt, 1000);
  assert.equal(h.stored.minimumsEnabledAt, 3000);
  assert.equal(h.controller.getObservationSince(), 1000);
  h.controller.setConfig({ enabled: false });
  assert.equal(h.controller.isEnabled(), false);
  assert.equal(h.controller.isObservingReports(), true);
  assert.equal(h.controller.getObservationSince(), 3000);
  h.controller.setConfig({ autoMinimums: false });
  assert.equal(h.controller.isObservingReports(), false);
  assert.equal(h.controller.getObservationSince(), null);
});

test('a lost 8 Marauder attack requests minimum 9 while automatic attacks remain off', async () => {
  const h = harness(); h.enableMinimums();
  h.controller.observeReport(h.report());
  assert.deepEqual(pending(h), [{ scope, reportId: uuid(1), takenAt: 2000, quantities: amounts(9) }]);
  assert.equal(state(h).campaigns.length, 0);
  await h.controller.tick();
  assert.equal(h.queueCalls.length, 0);
  assert.equal(h.controller.isEnabled(), false);
  h.applyMinimums(); h.controller.flushMinimums();
  assert.deepEqual(h.externalMinimums, amounts(9));
  assert.deepEqual(pending(h), []);
  assert.equal(h.events.some(event => event.type === 'attack.retry'), false, 'increasing a minimum does not announce a scheduled attack');
});

test('mixed fleets retain all amounts and increase Marauder by exactly one', () => {
  const h = harness(); h.enableMinimums();
  h.controller.observeReport(h.report(1, { quantities: amounts(8, { probe: 2, sentinel: 3, vanguard: 1 }) }));
  assert.deepEqual(pending(h)[0].quantities, amounts(9, { probe: 2, sentinel: 3, vanguard: 1 }));
  const other = harness(); other.enableMinimums();
  other.controller.observeReport(other.report(1, { quantities: amounts(0, { sentinel: 2 }) }));
  assert.deepEqual(pending(other)[0].quantities, amounts(1, { sentinel: 2 }));
});

test('both options create one 9 Marauder campaign and one minimum update for the same defeat', async () => {
  const h = harness(); h.controller.setConfig({ enabled: true, autoMinimums: true }); h.now = 2000;
  const report = h.report(); h.controller.observeReport(report);
  assert.deepEqual(pending(h)[0].quantities, amounts(9));
  assert.equal(state(h).campaigns.length, 1);
  assert.deepEqual(state(h).campaigns[0].quantities, amounts(9));
  h.applyMinimums(); h.controller.flushMinimums(); await h.controller.tick();
  assert.equal(h.queueCalls.length, 1);
  assert.deepEqual(h.queue[0].quantities, amounts(9));
  h.controller.observeReport(report); h.controller.flushMinimums(); await h.controller.tick();
  assert.equal(h.queueCalls.length, 1);
  assert.deepEqual(pending(h), []);
  assert.equal(h.minimumCalls.filter(call => call.request.reportId === uuid(1)).length, 1);
});

test('retry-only mode leaves permanent minimums untouched', async () => {
  const h = harness(); h.controller.setConfig({ enabled: true }); h.now = 2000;
  h.controller.observeReport(h.report()); await h.controller.tick(); h.controller.flushMinimums();
  assert.equal(h.queueCalls.length, 1);
  assert.deepEqual(pending(h), []);
  assert.equal(h.minimumCalls.length, 0);
});

test('reports at or before minimum activation cannot increase minimums', () => {
  const h = harness(); h.enableMinimums();
  for (const [index, takenAt] of [999, 1000].entries()) h.controller.observeReport(h.report(index + 1, { takenAt }));
  h.controller.flushMinimums();
  assert.deepEqual(pending(h), []);
  assert.equal(h.minimumCalls.length, 0);
  h.controller.observeReport(h.report(3, { takenAt: 1001 }));
  assert.equal(pending(h).length, 1);
});

test('incoming, scouting, uncertain fleets and non-defeats never increase minimums', () => {
  const cases = [
    ['incoming owner', r => { r.detail.route.from.ownerKind = 'human'; r.detail.route.to.ownerKind = 'owned'; }],
    ['incoming section', r => { r.detail.sections.incoming = {}; }],
    ['probe section', r => { r.detail.sections.probe = { tier: 1 }; }],
    ['probe-only fleet', r => { r.detail.sections.battle.attackerShips = [{ type: 'probe', kind: 'exact', quantity: 8 }]; }],
    ['unknown quantities', r => { r.detail.sections.battle.attackerShips[1].kind = 'unknown'; }],
    ['approximate quantities', r => { r.detail.sections.battle.attackerShips[1].approximate = true; }],
    ['unknown report variant', r => { r.detail.variant = { kind: 'unrecognized' }; }],
    ['mismatched identity', r => { r.detail.id = uuid(2); }],
    ['future date', r => { r.item.takenAt = 3000; }],
    ['Victory', r => { r.item.verdict = 'Victory'; }],
    ['Captured', r => { r.item.verdict = 'Captured'; }],
    ['Draw', r => { r.item.verdict = 'Draw'; }],
  ];
  for (const [label, edit] of cases) {
    const h = harness(); h.enableMinimums(); const report = h.report(); edit(report);
    h.controller.observeReport(report); h.controller.flushMinimums();
    assert.deepEqual(pending(h), [], label);
    assert.equal(h.minimumCalls.length, 0, label);
    assert.equal(state(h).campaigns.length, 0, label);
  }
  const existing = harness(); existing.enableMinimums(); existing.controller.observeReport(existing.report(1));
  existing.now = 3000;
  const scouting = existing.report(2);
  scouting.detail.sections.battle.attackerShips = [{ type: 'probe', kind: 'exact', quantity: 8 }];
  existing.controller.observeReport(scouting);
  assert.deepEqual(pending(existing), [{ scope, reportId: uuid(1), takenAt: 2000, quantities: amounts(9) }],
    'a known Probe-only fleet cannot erase the last real combat minimum');
  assert.deepEqual(state(existing).minimumOutcomes, [{ scope, reportId: uuid(1), takenAt: 2000 }]);
});

test('native exact quantities without kind and independent report timestamps also update minimums', () => {
  const h = harness(); h.enableMinimums(); const report = h.report();
  for (const entry of report.detail.sections.battle.attackerShips) delete entry.kind;
  report.detail.createdAt = 1999;
  h.controller.observeReport(report);
  assert.deepEqual(pending(h)[0], { scope, reportId: uuid(1), takenAt: 2000, quantities: amounts(9) });
});

test('newest pending defeat replaces an older request across targets of the same account', () => {
  const h = harness(); h.enableMinimums(); h.controller.observeReport(h.report(1));
  h.now = 4000;
  h.controller.observeReport(h.report(2, { takenAt: 3000, quantities: amounts(10), targetQ: -92 }));
  assert.deepEqual(pending(h), [{ scope, reportId: uuid(2), takenAt: 3000, quantities: amounts(11) }]);
  h.controller.observeReport(h.report(3, { takenAt: 2500, quantities: amounts(30), targetQ: -91 }));
  assert.equal(pending(h).length, 1);
  assert.equal(pending(h)[0].reportId, uuid(2), 'a late older defeat cannot overwrite the latest failed attack');
});

test('minimum requests stay isolated by account and are applied only when that account is selected', () => {
  const h = harness(); h.enableMinimums(); h.controller.observeReport(h.report(1));
  h.now = 3000; h.controller.observeReport(h.report(2, { scope: otherScope, quantities: amounts(12) }));
  assert.equal(pending(h).length, 2);
  h.applyMinimums(); h.controller.flushMinimums();
  assert.deepEqual(h.externalMinimums, amounts(9));
  assert.deepEqual(pending(h).map(item => item.scope), [otherScope]);
  h.context = { scope: otherScope }; h.controller.flushMinimums();
  assert.deepEqual(h.externalMinimums, amounts(13));
  assert.deepEqual(pending(h), []);
});

test('duplicate reports do not resurrect an acknowledged minimum update after reload', () => {
  const h = harness(); h.enableMinimums(); const report = h.report();
  h.controller.observeReport(report); h.applyMinimums(); h.controller.flushMinimums();
  const calls = h.minimumCalls.length;
  h.reload(); h.controller.observeReport(report); h.controller.flushMinimums();
  assert.deepEqual(pending(h), []);
  assert.equal(h.minimumCalls.length, calls);
  assert.deepEqual(h.externalMinimums, amounts(9));
});

test('a minimum request is saved before external settings can be changed', () => {
  const h = harness(); h.enableMinimums(); h.failSave = true;
  assert.throws(() => h.controller.observeReport(h.report()), /guard/);
  assert.equal(h.minimumCalls.length, 0);
  h.failSave = false; h.controller.observeReport(h.report()); h.applyMinimums(); h.controller.flushMinimums();
  assert.equal(h.minimumCalls.length, 1);
  const call = h.minimumCalls[0];
  assert.deepEqual(call.storedAtCall.minimumUpdates, [call.request], 'intent is durable before the callback');
  assert.ok(call.storedAtCall.processed.some(item => item.id === uuid(1)), 'the report identity is durable too');
});

test('a failure saving the acknowledgement safely replays the idempotent minimum update', () => {
  const h = harness(); h.enableMinimums(); h.controller.observeReport(h.report());
  let changes = 0, crashOnce = true;
  h.minimumHandler = request => {
    const old = h.externalMinimums;
    const next = Object.fromEntries(Object.entries(request.quantities).map(([id, amount]) => [id, Math.max(old[id], amount)]));
    const changed = Object.fromEntries(Object.entries(next).filter(([id, amount]) => amount > old[id])
      .map(([id, after]) => [id, { before: old[id], after }]));
    if (Object.keys(changed).length) changes += 1;
    h.externalMinimums = next;
    if (crashOnce) { crashOnce = false; h.failSave = true; }
    return { status: Object.keys(changed).length ? 'applied' : 'noop', changed };
  };
  try { h.controller.flushMinimums(); } catch (_) { /* A durable request must survive either reported error form. */ }
  assert.equal(changes, 1);
  assert.deepEqual(h.externalMinimums, amounts(9));
  h.failSave = false; h.reload();
  assert.equal(pending(h).length, 1);
  h.controller.flushMinimums();
  assert.equal(changes, 1, 'replaying after a partial save does not add another ship');
  assert.deepEqual(pending(h), []);
});

test('deferred requests survive reload and can later be applied', () => {
  const h = harness(); h.enableMinimums(); h.controller.observeReport(h.report()); h.controller.flushMinimums();
  assert.equal(pending(h).length, 1);
  h.reload(); h.applyMinimums(); h.controller.flushMinimums();
  assert.deepEqual(pending(h), []);
  assert.deepEqual(h.externalMinimums, amounts(9));
});

test('callback failures leave pending work available for a subsequent retry', () => {
  const h = harness(); h.enableMinimums(); h.controller.observeReport(h.report());
  h.minimumResult = new Error('fleet settings storage unavailable');
  try { h.controller.flushMinimums(); } catch (_) { /* Failure can be surfaced to the caller or in diagnostics. */ }
  assert.equal(pending(h).length, 1);
  h.applyMinimums(); h.controller.flushMinimums();
  assert.deepEqual(pending(h), []);
});

test('only synchronous acknowledged callback results remove pending work', () => {
  for (const result of [undefined, { status: 'unexpected', changed: {} }, { status: 'applied', changed: 'yes' },
    { status: 'applied', changed: { marauder: { before: 8, after: '9' } } }]) {
    const h = harness(); h.enableMinimums(); h.controller.observeReport(h.report());
    h.minimumHandler = () => result;
    try { h.controller.flushMinimums(); } catch (_) { /* An invalid acknowledgement must not lose work. */ }
    assert.equal(pending(h).length, 1);
  }
  const h = harness(); h.enableMinimums(); h.controller.observeReport(h.report());
  h.minimumHandler = () => Promise.resolve({ status: 'applied', changed: { marauder: { before: 8, after: 9 } } });
  try { h.controller.flushMinimums(); } catch (_) { /* Async callbacks cannot confirm synchronous persistence. */ }
  assert.equal(pending(h).length, 1);
});

test('minimum updates survive queue failures independently of whether automatic retries are also enabled', async () => {
  const h = harness(); h.enableMinimums(); h.failQueueRead = true;
  h.controller.observeReport(h.report()); h.applyMinimums(); h.controller.flushMinimums();
  assert.deepEqual(h.externalMinimums, amounts(9));
  assert.equal(h.queueCalls.length, 0);
  assert.equal(state(h).campaigns.length, 0);

  const both = harness(); both.controller.setConfig({ enabled: true, autoMinimums: true }); both.now = 2000;
  both.failQueueRead = true;
  const report = both.report();
  assert.throws(() => both.controller.observeReport(report), /cola/);
  assert.deepEqual(pending(both), [{ scope, reportId: uuid(1), takenAt: 2000, quantities: amounts(9) }]);
  assert.equal(state(both).processed.some(item => item.id === uuid(1)), false,
    'the failed retry callback must remain deliverable after the mission queue becomes available');
  both.applyMinimums(); both.controller.flushMinimums();
  assert.deepEqual(both.externalMinimums, amounts(9));
  assert.equal(state(both).campaigns.length, 0);
  both.failQueueRead = false;
  both.controller.observeReport(report); await both.controller.tick(); both.controller.flushMinimums();
  assert.equal(both.queueCalls.length, 1);
  assert.deepEqual(both.queue[0].quantities, amounts(9));
  assert.equal(both.minimumCalls.length, 1, 'retry recovery does not apply the same minimum twice');
});

test('enabling retries later never reuses reports observed only for minimums', async () => {
  const h = harness(); h.enableMinimums(); h.controller.observeReport(h.report(1));
  h.now = 4000; h.controller.setConfig({ enabled: true });
  assert.equal(h.controller.getObservationSince(), 1000);
  assert.equal(h.stored.enabledAt, 4000);
  h.controller.observeReport(h.report(2, { takenAt: 3000, targetQ: -92, quantities: amounts(10) }));
  await h.controller.tick();
  assert.equal(state(h).campaigns.length, 0);
  assert.equal(h.queueCalls.length, 0);
  assert.equal(pending(h)[0].reportId, uuid(2), 'the older minimum window still admits a later failed attack');
  h.now = 5000; h.controller.observeReport(h.report(3, { targetQ: -91 })); await h.controller.tick();
  assert.equal(h.queueCalls.length, 1);
});

test('enabling minimums later never applies defeats admitted only by the earlier retry window', () => {
  const h = harness(); h.controller.setConfig({ enabled: true });
  h.now = 4000; h.controller.setConfig({ autoMinimums: true });
  h.controller.observeReport(h.report(1, { takenAt: 3000 }));
  assert.equal(state(h).campaigns.length, 1);
  assert.deepEqual(pending(h), []);
  h.now = 5000; h.controller.observeReport(h.report(2, { targetQ: -92 }));
  assert.equal(pending(h).length, 1);
  assert.equal(pending(h)[0].reportId, uuid(2));
});

test('report recovery works in minimum-only mode and keeps the latest failed fleet', async () => {
  const h = harness(); h.enableMinimums(); h.now = 4000;
  const earlier = h.report(1, { takenAt: 2000, quantities: amounts(8) });
  const later = h.report(2, { takenAt: 3000, quantities: amounts(9) });
  h.controller.recoverReports({ scope, reports: [earlier, later] });
  assert.deepEqual(pending(h), [{ scope, reportId: uuid(2), takenAt: 3000, quantities: amounts(10) }]);
  await h.controller.tick();
  assert.equal(state(h).campaigns.length, 0);
  assert.equal(h.queueCalls.length, 0);
});

test('turning minimum increases off clears pending work and does not undo applied minimums', () => {
  const h = harness(); h.enableMinimums(); h.controller.observeReport(h.report(1)); h.applyMinimums(); h.controller.flushMinimums();
  h.minimumHandler = () => ({ status: 'deferred', changed: {} });
  h.now = 3000; h.controller.observeReport(h.report(2, { quantities: amounts(10), targetQ: -92 }));
  assert.equal(pending(h).length, 1);
  h.controller.setConfig({ autoMinimums: false });
  assert.deepEqual(pending(h), []);
  const calls = h.minimumCalls.length; h.controller.flushMinimums();
  assert.equal(h.minimumCalls.length, calls);
  assert.deepEqual(h.externalMinimums, amounts(9));
  h.now = 4000; h.controller.setConfig({ autoMinimums: true });
  assert.equal(h.stored.minimumsEnabledAt, 4000);
  h.controller.observeReport(h.report(2, { takenAt: 3000, quantities: amounts(10), targetQ: -92 }));
  assert.deepEqual(pending(h), []);
});

test('a noop acknowledgement retains higher existing minimums and clears the request', () => {
  const h = harness(); h.enableMinimums(); h.externalMinimums = amounts(20, { probe: 4, sentinel: 5, vanguard: 6 });
  h.controller.observeReport(h.report()); h.applyMinimums(); h.controller.flushMinimums();
  assert.deepEqual(h.externalMinimums, amounts(20, { probe: 4, sentinel: 5, vanguard: 6 }));
  assert.deepEqual(pending(h), []);
});

test('imports disable both automations, clear pending minimum updates and support exact rollback', () => {
  const h = harness(); h.controller.setConfig({ enabled: true, autoMinimums: true }); h.now = 2000;
  h.controller.observeReport(h.report());
  const before = h.stored, checkpoint = h.controller.backupCheckpoint();
  h.controller.importConfig(state(h));
  assert.equal(h.stored.enabled, false);
  assert.equal(h.stored.enabledAt, 0);
  assert.equal(h.stored.autoMinimums, false);
  assert.equal(h.stored.minimumsEnabledAt, 0);
  assert.deepEqual(h.stored.minimumUpdates, []);
  assert.equal(h.controller.isObservingReports(), false);
  assert.equal(h.stored.campaigns[0].status, 'paused');
  assert.equal(h.minimumCalls.length, 0);
  h.controller.restoreCheckpoint(checkpoint);
  assert.deepEqual(h.stored, before, 'rollback restores the exact pre-import persisted state');
});

test('minimum settings and pending request schema reject invalid data before mutation', () => {
  const h = harness(); h.enableMinimums(); h.controller.observeReport(h.report());
  const valid = state(h), before = h.stored;
  const edits = [
    value => { value.autoMinimums = 'true'; },
    value => { value.minimumsEnabledAt = 0; },
    value => { value.minimumsEnabledAt = -1; },
    value => { value.minimumUpdates = {}; },
    value => { value.minimumUpdates = [null]; },
    value => { value.minimumUpdates[0] = []; },
    value => { value.minimumUpdates[0].extra = true; },
    value => { value.minimumUpdates[0].scope = ''; },
    value => { value.minimumUpdates[0].reportId = 'not-a-report-id'; },
    value => { value.minimumUpdates[0].takenAt = '2000'; },
    value => { value.minimumUpdates[0].quantities = []; },
    value => { value.minimumUpdates[0].quantities.destroyer = 1; },
    value => { value.minimumUpdates[0].quantities.marauder = 9.5; },
    value => { value.minimumUpdates[0].quantities.marauder = 50001; },
    value => { value.minimumUpdates.push(clone(value.minimumUpdates[0])); },
    value => { value.minimumOutcomes = {}; },
    value => { value.minimumOutcomes[0] = []; },
    value => { value.minimumOutcomes[0].extra = true; },
    value => { value.minimumOutcomes[0].reportId = 'not-a-report-id'; },
    value => { value.minimumOutcomes[0].takenAt = '2000'; },
    value => { value.minimumOutcomes.push(clone(value.minimumOutcomes[0])); },
  ];
  for (const [index, edit] of edits.entries()) {
    const invalid = clone(valid); edit(invalid);
    assert.throws(() => h.controller.validateConfig(invalid), undefined, 'invalid schema case ' + index);
    assert.deepEqual(h.stored, before);
  }
  for (const patch of [{ minimumsEnabledAt: 1 }, { minimumUpdates: [] }, { minimumOutcomes: [] }, { autoMinimums: 'true' }]) {
    assert.throws(() => h.controller.setConfig(patch));
    assert.deepEqual(h.stored, before);
  }
});

test('maximum ship quantity cannot overflow through automatic minimum increases', () => {
  const h = harness(); h.enableMinimums();
  h.controller.observeReport(h.report(1, { quantities: amounts(50000) }));
  h.controller.flushMinimums();
  assert.equal(h.minimumCalls.length, 0);
  assert.deepEqual(pending(h), []);
});

test('recovery bases minimums on the latest defeat even when that route later won', () => {
  const h = harness(); h.enableMinimums(); h.now = 5000;
  const routeBDefeat = h.report(1, { takenAt: 2000, quantities: amounts(20), targetQ: -92 });
  const routeADefeat = h.report(2, { takenAt: 3000, quantities: amounts(8), targetQ: -93 });
  const routeAVictory = h.report(3, { takenAt: 4000, quantities: amounts(8), targetQ: -93, verdict: 'Victory' });
  h.controller.recoverReports({ scope, reports: [routeBDefeat, routeADefeat, routeAVictory] });
  assert.deepEqual(pending(h), [{ scope, reportId: uuid(2), takenAt: 3000, quantities: amounts(9) }],
    'the newer victory can end an attack campaign without changing which defeat determines fleet minimums');
  h.applyMinimums(); h.controller.flushMinimums();
  assert.deepEqual(h.externalMinimums, amounts(9));
  assert.equal(state(h).campaigns.length, 0);
});

test('a newer unknown-fleet defeat clears old pending minimums and keeps a durable per-account boundary', () => {
  const h = harness(); h.enableMinimums(); h.controller.observeReport(h.report(1, { quantities: amounts(20), targetQ: -92 }));
  assert.equal(pending(h)[0].quantities.marauder, 21);
  h.now = 5000;
  const newerUnknown = h.report(2, { takenAt: 3000, targetQ: -93 });
  newerUnknown.detail.sections.battle.attackerShips[1].kind = 'unknown';
  delete newerUnknown.detail.sections.battle.attackerShips[1].quantity;
  h.controller.recoverReports({ scope, reports: [newerUnknown] });
  assert.deepEqual(pending(h), [], 'unknown latest amounts cannot fall back to an older failed fleet');
  assert.deepEqual(state(h).minimumOutcomes, [{ scope, reportId: uuid(2), takenAt: 3000 }]);
  h.controller.observeReport(h.report(3, { takenAt: 4000, targetQ: -93, verdict: 'Victory' }));
  h.reload();
  h.controller.observeReport(h.report(4, { takenAt: 2500, targetQ: -91, quantities: amounts(30) }));
  assert.deepEqual(pending(h), [], 'neither a later victory nor reload can revive an older defeat from another route');
  h.applyMinimums(); h.controller.flushMinimums();
  assert.equal(h.minimumCalls.length, 0);
});

test('ordinary report delivery also drops an older pending request when the new failed fleet is unknown', () => {
  const h = harness(); h.enableMinimums();
  h.controller.observeReport(h.report(1, { quantities: amounts(20), targetQ: -92 }));
  h.now = 3000;
  const report = h.report(2, { quantities: amounts(8), targetQ: -93 });
  report.detail.sections.battle.attackerShips[1] = { type: 'marauder', kind: 'unknown' };
  h.controller.observeReport(report);
  assert.deepEqual(pending(h), []);
  assert.deepEqual(state(h).minimumOutcomes, [{ scope, reportId: uuid(2), takenAt: 3000 }]);
  h.applyMinimums(); h.controller.flushMinimums();
  assert.equal(h.minimumCalls.length, 0);
});
