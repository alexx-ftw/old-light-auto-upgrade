'use strict';
// Source-extracted, deterministic regressions. No browser, game, order, or network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  }\n', start);
  assert.ok(end > start, name);
  return source.slice(start, end + 5);
}

function scheduler({ imperial = true, execute = () => {}, extras = {}, actualStep = false } = {}) {
  let clock = 1000, offset = 0, nextId = 0, timers = [], microtasks = [];
  const steps = [], errors = [], state = { imperial };
  const globals = {
    Date: { now: () => clock + offset }, Math,
    queueMicrotask: fn => microtasks.push(fn),
    setTimeout: (fn, delay = 0) => {
      const id = ++nextId; timers.push({ id, at: clock + Math.max(0, delay), fn }); return id;
    },
    clearTimeout: id => { timers = timers.filter(timer => timer.id !== id); },
    empireController: { isEnabled: () => state.imperial },
    metrics: { record: name => errors.push(name) },
    step: () => { steps.push(clock); execute(globals); },
    ...extras,
  };
  vm.createContext(globals);
  vm.runInContext(`let scheduled=false,lastEmpireStepAt=-Infinity,wakeTimer=null,wakeDue=0;\n${extract('schedule')}\n${extract('wakeAt')}\n${actualStep ? extract('step') : ''}\nglobalThis.api={schedule,wakeAt};`, globals);
  const drain = () => {
    let count = 0;
    while (microtasks.length) {
      assert.ok(++count < 10000, 'microtasks must not spin'); microtasks.shift()();
    }
  };
  const until = deadline => {
    drain();
    for (;;) {
      timers.sort((a,b) => a.at - b.at || a.id - b.id);
      if (!timers.length || timers[0].at > deadline) break;
      const next = timers.shift(); clock = next.at; next.fn(); drain();
    }
    clock = deadline;
  };
  return { globals, state, steps, errors, until, drain, api: globals.api,
    at(at, fn) { globals.setTimeout(fn, at - clock); },
    set offset(value) { offset = value; },
    get pendingTimers() { return timers.length; },
  };
}

test('imperial scheduling yields a task and coalesces repeated same-turn requests', () => {
  const h = scheduler();
  for (let i = 0; i < 100; i++) h.api.schedule();
  h.drain(); assert.equal(h.steps.length, 0); assert.equal(h.pendingTimers, 1);
  h.until(1000); assert.deepEqual(h.steps, [1000]);
});

test('cross-task imperial bursts have a fixed bound rather than postponing forever', () => {
  const h = scheduler();
  for (let i = 0; i < 100; i++) h.at(1000 + i, h.api.schedule);
  h.until(1200);
  assert.deepEqual(h.steps, [1000, 1050, 1100]);
  const stream = scheduler();
  for (let i = 0; i < 100; i++) stream.at(1000 + i * 10, stream.api.schedule);
  stream.until(2100);
  assert.equal(stream.steps.length, 21);
  assert.equal(stream.steps.at(-1), 2000);
  assert.ok(stream.steps.slice(1).every((at,i) => at - stream.steps[i] === 50));
});

test('ordinary mode retains immediate microtasks without rate limiting', () => {
  const h = scheduler({ imperial: false });
  h.api.schedule(); h.drain(); assert.deepEqual(h.steps, [1000]); assert.equal(h.pendingTimers, 0);
  for (let i = 1; i <= 100; i++) h.at(1000 + i, h.api.schedule);
  h.until(1100); assert.equal(h.steps.length, 101);
});

test('disabling the empire during a pending timer neither loses nor duplicates work', () => {
  const modes = [], h = scheduler({ execute: () => modes.push(h.state.imperial) });
  h.api.schedule(); h.until(1000);
  h.at(1001, h.api.schedule);
  h.at(1002, () => { h.state.imperial = false; h.api.schedule(); });
  h.until(1100);
  assert.deepEqual(h.steps, [1000, 1050]); assert.deepEqual(modes, [true, false]);
  h.api.schedule(); h.drain(); assert.equal(h.steps.length, 3); assert.equal(h.pendingTimers, 0);
});

test('wakeAt retains the earliest requested response deadline', () => {
  const h = scheduler(); h.api.schedule(); h.until(1000);
  h.api.wakeAt(1090); h.api.wakeAt(1070); h.api.wakeAt(1080);
  h.until(1200); assert.deepEqual(h.steps, [1000, 1070]);
});

test('response deadlines receive at most 50 ms additional scheduling delay', () => {
  for (const delta of [1, 10, 49, 50, 51, 1000]) {
    const h = scheduler(); h.api.schedule(); h.until(1000);
    const deadline = 1000 + delta; h.api.wakeAt(deadline); h.until(deadline + 100);
    assert.equal(h.steps.length, 2);
    assert.ok(h.steps[1] >= deadline && h.steps[1] - deadline <= 50);
  }
});

test('clock rollback clamps the wait; follow-up requests from step are not dropped', () => {
  const h = scheduler(); h.api.schedule(); h.until(1000); h.offset = -100000;
  h.at(1001, h.api.schedule); h.until(1100); assert.deepEqual(h.steps, [1000, 1051]);
  let count = 0;
  const reentrant = scheduler({ execute: () => { if (++count < 3) reentrant.api.schedule(); } });
  reentrant.api.schedule(); reentrant.until(1200); assert.deepEqual(reentrant.steps, [1000, 1050, 1100]);
});

test('exceptions remain visible and allow later scheduling', () => {
  const h = scheduler({ execute: () => { throw new Error('synthetic failure'); } });
  h.api.schedule(); assert.throws(() => h.until(1000), /synthetic failure/);
  assert.deepEqual(h.errors, ['error.runtime']);
  h.api.schedule(); assert.equal(h.pendingTimers, 1);
});

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SCOPE = 'alpha/player';
const SHIPS = ['probe', 'marauder', 'sentinel', 'vanguard'].map(id => [id, id]);
function missionHarness() {
  const data = { job: null, allowed: true, identity: SCOPE, activeScope: SCOPE, missionBusy: false, retryBusy: false,
    loading: false, dialog: false, canActCalls: 0, activeReads: 0, lastContext: null };
  const counts = { parked: 2, away: 1, building: 0 };
  const settings = { enabled: true, shipOrder: SHIPS.map(([id]) => id),
    shipMinimums: Object.fromEntries(SHIPS.map(([id]) => [id, 5])), countAway: true };
  const panel = {};
  const globals = {
    Date, Math, Map, Boolean, settings, SHIPS, PANEL: '#structures', FLEET_PANEL: '#fleet', nextClickAt: 0,
    leader: true, importingBackup: false, pending: null,
    systemId: () => A,
    missionContext: () => ({ scope: data.identity, originId: A, selectionCount: 1 }),
    currentMissionJob: () => data.job,
    isRetryMissionAllowed: () => true,
    empireOperationalSettings: () => settings,
    fleetEnabled: () => true,
    controlVisible: () => true, isAvailable: () => true, exactInteger: value => Number(value),
    readShipUnitCost: () => ({ palladium: 1, iridium: 1 }),
    fleetCounts: () => counts,
    fleetDeficit: id => Math.max(0, settings.shipMinimums[id] - counts.parked - counts.away - counts.building),
    missionAdapter: { isBusy: () => data.missionBusy }, attackRetry: { isBusy: () => data.retryBusy },
    reports: { isRecovering: () => false },
    fleetWait: { productionPlan: () => ({ production: { probe: 10 } }) },
    hudPanelAvailable: node => node === panel,
    document: { hidden: false, activeElement: null,
      querySelector(selector) {
        if (selector === '#structures' || selector === '#fleet') return panel;
        if (selector === 'dialog[open]') return data.dialog ? {} : null;
        if (selector.includes('.b-loading')) return data.loading ? {} : null;
        return null;
      }, querySelectorAll: () => [] },
    empireController: { isEnabled: () => true,
      canAct(context) { data.canActCalls++; data.lastContext = context; return data.allowed && context?.scope === data.identity; },
      state: () => ({ scope: data.identity, maxAgeMs: 120000, config: { systems: { [A]: { enabled: true } } } }),
    },
    empireAdapter: { readActive() {
      data.activeReads++;
      return { context: { scope: data.activeScope, systemId: A, owned: true, settled: true, selectionCount: 1 },
        snapshot: { scope: data.activeScope, systemId: A, owned: true, observedAt: Date.now() } };
    } },
  };
  vm.createContext(globals);
  vm.runInContext(['canOperateMission', 'missionQueueContext', 'empireMissionPermission', 'readFleetPrioritySnapshot'].map(extract).join('\n')
    + '\nglobalThis.api={canOperateMission,missionQueueContext,readFleetPrioritySnapshot};', globals);
  return { data, globals, api: globals.api,
    read: () => globals.api.readFleetPrioritySnapshot(SHIPS.map(([id]) => ({ id, row: { classList: { contains: () => false } }, input: { max: '100', matches: () => false }, button: { getAttribute: () => '', classList: { contains: () => false } } })), { palladium: { amount: 10, cap: 100, rate: 1 }, iridium: { amount: 10, cap: 100, rate: 1 } }) };
}

test('priority reads without a waiting mission perform zero imperial authorization reads', () => {
  const h = missionHarness();
  for (const job of [null, { status: 'paused' }, { status: 'sent' }]) {
    h.data.job = job; const value = h.read();
    assert.equal(h.data.canActCalls, 0); assert.equal(h.data.activeReads, 0);
    assert.equal(value.ships[0].deficit, 2);
  }
});

test('waiting mission priority checks permission once and rechecks on each new read', () => {
  const h = missionHarness(); h.data.job = { id: 'synthetic', status: 'waiting', produce: true };
  let value = h.read(); assert.equal(h.data.canActCalls, 1); assert.equal(h.data.activeReads, 1);
  assert.equal(value.ships[0].maxBatch, 10);
  h.data.allowed = false; value = h.read();
  assert.equal(h.data.canActCalls, 2); assert.equal(h.data.activeReads, 2);
  // Ordinary fleet minimum is retained; denied mission demand cannot increase quantity.
  assert.equal(value.ships[0].maxBatch, 2);
});

test('mission context checks live readiness once without caching across calls', () => {
  const h = missionHarness();
  assert.equal(h.api.missionQueueContext().canAct, true); assert.equal(h.data.canActCalls, 1);
  h.data.allowed = false;
  assert.equal(h.api.missionQueueContext().canAct, false); assert.equal(h.data.canActCalls, 2);
  h.data.allowed = true; h.data.identity = 'beta/other';
  assert.equal(h.api.missionQueueContext().canAct, false); assert.equal(h.data.canActCalls, 3);
  assert.equal(h.data.lastContext.scope, SCOPE);
});

test('queued work observes a changed identity and pause before consulting live permission', () => {
  const permission = missionHarness(), results = [];
  const h = scheduler({ execute: () => results.push(permission.api.canOperateMission()) });
  h.api.schedule(); h.until(1000); assert.deepEqual(results, [true]);
  h.at(1001, h.api.schedule);
  h.at(1002, () => { permission.data.identity = 'beta/other'; });
  h.until(1050); assert.deepEqual(results, [true, false]);
  h.at(1051, h.api.schedule);
  h.at(1052, () => { permission.globals.settings.enabled = false; permission.data.activeScope = 'beta/other'; });
  h.until(1100); assert.deepEqual(results, [true, false, false]);
  assert.equal(permission.data.canActCalls, 2);
});

test('actual no-panel step pauses an expired pending ship safely despite coalesced wake', () => {
  const settings = { enabled: true }, events = [], ticks = [];
  const h = scheduler({ actualStep: true, extras: {
    PANEL: '#structures', FLEET_PANEL: '#fleet', document: { querySelector: () => null, body: null },
    pending: { kind: 'ship', name: 'Probe', started: -999, operation: 'synthetic', systemName: 'Synthetic' },
    RESPONSE_TIMEOUT_MS: 2000, observingNotifications: false, host: { hidden: false },
    notifier: { isEventEnabled: () => false }, reports: { tick: value => ticks.push(value) },
    attackRetry: { isObservingReports: () => false }, observeGameEvents() {}, releaseLeadership() {},
    settings, saveSettings() {}, emitEvent: (...args) => events.push(args), error: '',
  } });
  h.api.schedule(); h.until(1000); assert.notEqual(h.globals.pending, null);
  h.api.wakeAt(1001); h.until(1050);
  assert.equal(h.globals.pending, null); assert.equal(settings.enabled, false);
  assert.equal(events.length, 1); assert.equal(events[0][0], 'automation.paused');
  assert.equal(ticks.length, 2); assert.equal(h.globals.host.hidden, true);
});
