'use strict';
// Offline production-chain fixture: native parser/reducer + boundary validator,
// adapter/runtime, actual integration installation/event filter, and scheduler.
// DOM, clocks and native selector callbacks are synthetic. The scheduled step
// invokes the real empire updater, not the unrelated whole Helper order engine.
// No browser/game IO. Module/JSON readers share the fixture realm, as in content.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = process.env.OLD_LIGHT_INTERACTION_ROOT || path.join(__dirname, '..');
const core = require(path.join(root, 'docs/empire-core.js'));
const observer = require(path.join(root, 'docs/empire-observer.js'));
const native = require(path.join(root, 'docs/empire-adapter.js'));
const runtime = require(path.join(root, 'docs/empire-runtime.js'));
const source = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SELF = uuid(1), A = uuid(10), B = uuid(11), SCOPE = `alpha/${SELF}`, START = 1791930000000;
const TYPES = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
const copy = value => JSON.parse(JSON.stringify(value));
function section(begin, end, from = 0) {
  const a = source.indexOf(begin, from), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing production section: ${begin}`);
  return source.slice(a, b);
}
// Installation now closes over the production work-aware planner. Execute its
// real dependencies too so a swallowed installation exception cannot silently
// turn this interaction fixture into a partial integration.
const plannerCode = ['UPGRADE ETA ESTIMATOR', 'FLEET PRIORITY PLANNER',
  'INFRASTRUCTURE PRIORITY PLANNER', 'EMPIRE NAVIGATION PLANNER']
  .map(marker => section('// BEGIN ' + marker, '// END ' + marker)).join('\n')
  + section('  const upgradeEta = createUpgradeEtaEstimator();', '\n  if (window.top !== window.self');
const integrationStart = source.indexOf('// BEGIN EMPIRE INTEGRATION');
const installCode = section('  try {\n    const core = globalThis.OldLightEmpireCore;', '  observeEmpireStartup();', integrationStart);
const policyCode = section('  function empireMissionPermission()', '\n  function observeEmpireStartup(')
  + section('  function updateEmpireState()', '\n  function installEmpirePanel(');
const schedulerCode = section('  function schedule()', '\n  function wakeAt(');
const fallbackCode = section('  setInterval(() => {\n    schedule();', '\n  schedule();', integrationStart);
function system(id, q) {
  return { id, q, r: 0, name: 'Synthetic ' + q, buildings: [{ type: 'shipyard', level: 0 }], fleet: [{ type: 'probe', quantity: 2 }],
    economy: { resources: { palladium: 100, iridium: 100, settledAt: new Date(START).toISOString() },
      paCap: 1000, irCap: 1000, paRatePerMin: 0, irRatePerMin: 0, energyCap: 10, energyUsed: 0,
      deficitMultiplier: 1, queueSlots: 2, queue: [] } };
}
function harness(t, { ids = [A], dwellMs = 5000, adapterOptions = {} } = {}) {
  let clock = START, active = A, scope = SCOPE, loading = false, modal = false, blockedHud = false, mismatch = false;
  let selectionCount = 1, selectorWorks = true, clicks = 0, renders = 0, beforeResolution = null, timerId = 0, steps = 0;
  const rows = ids.map(system), listeners = new Map(), timers = new Map(), storage = new Map();
  storage.set('old-light-empire:v1:' + SCOPE, JSON.stringify(core.normalizeConfig({ enabled: true })));
  const reducer = observer.createReducer({ galaxy: 'alpha', now: () => clock });
  let generation = reducer.beginConnection(), delivered;
  const receive = (name, payload) => {
    const frame = '42' + JSON.stringify([name, payload]);
    assert.notEqual(observer.parseFrame(frame, reducer.snapshot().selfId).kind, 'invalid');
    assert.equal(reducer.ingest(frame, generation), true);
    delivered = observer.validateSnapshot(JSON.stringify(reducer.snapshot()));
    assert.ok(delivered); return copy(delivered);
  };
  receive('world.init', { selfId: SELF, serverNow: clock, world: { players: [{ id: SELF, owned: copy(rows), transits: [], credits: null }] } });
  const next = { disabled: false, hidden: false, isConnected: true, getAttribute: () => null, getClientRects: () => [{}],
    classList: { contains: () => false }, closest: () => null,
    click() { clicks++; if (selectorWorks) active = rows[(rows.findIndex(row => row.id === active) + 1) % rows.length].id; } };
  const document = { hidden: false, activeElement: null,
    defaultView: { getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) },
    querySelector(selector) {
      if (selector.includes('queue-list')) return { children: [] };
      if (selector.includes('dialog') && modal) return {};
      if (selector.includes('.b-loading') && loading) return {};
      return null;
    },
    querySelectorAll: selector => selector === '[data-field="nameplate-next"]' ? [next] : [],
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(value => value !== fn)); } };
  const host = { shadowRoot: { activeElement: null, querySelector: () => null } }, game = {};
  const later = (fn, ms, interval = 0) => { const id = ++timerId; timers.set(id, { fn, at: clock + ms, interval }); return id; };
  const ctx = { document, host, settings: { enabled: true,
    order: ['command_center', 'reactor', 'palladium_extractor', 'iridium_extractor', 'warehouse', 'shipyard', 'trade_hub'],
    excluded: [], shipOrder: core.DEFAULT_SHIPS, depotFillPercent: 90 }, leader: true, pending: null, importingBackup: false,
    reports: { isRecovering: () => false }, missionAdapter: { isBusy: () => false },
    fleetWait: { list: () => [] }, attackRetry: { isBusy: () => false, exportConfig: () => ({ enabled: false, campaigns: [] }) },
    PANEL: '#structures', FLEET_PANEL: '#shipyard', SHIPS: core.DEFAULT_SHIPS.map(id => [id, id]),
    JSON, Date: { now: () => clock }, setTimeout: (fn, ms) => later(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => later(fn, ms, ms), queueMicrotask,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    missionContext: () => ({ scope, originId: active, selectionCount }), systemId: () => active, hudBlocked: () => blockedHud,
    readResourceSnapshot: () => ({ palladium: { amount: mismatch ? 99 : 100, cap: 1000, rate: 0 }, iridium: { amount: 100, cap: 1000, rate: 0 } }),
    fleetCounts: id => ({ parked: id === 'probe' ? 2 : 0, away: 0, building: 0 }), signedInteger: () => 10,
    empireController: null, empireAdapter: null, empirePanel: { render: () => renders++ },
    scheduled: false, lastEmpireStepAt: -Infinity, preferenceSync: null, driveBackup: null,
    metrics: { record() {} }, observeEmpireStartup() {},
    OldLightEmpireCore: core,
    OldLightEmpireBridge: { snapshot: () => delivered, subscribe() {}, status: () => ({ installed: true, observed: true }) },
    OldLightEmpireAdapter: { create(options) {
      const real = native.create({ ...options, now: () => clock, setTimeout: (fn, ms) => later(fn, ms), clearTimeout: id => timers.delete(id), ...adapterOptions });
      return { ...real, async selectSystem(...args) { const result = await real.selectSystem(...args); beforeResolution?.(result); return result; } };
    } },
    OldLightEmpireRuntime: { create: options => runtime.create({ ...options, now: () => clock, dwellMs }) },
  };
  ctx.step = () => { if (++steps > 10000) throw new Error('Scheduler did not yield'); ctx.updateEmpireState(); };
  vm.createContext(ctx); vm.runInContext(plannerCode + policyCode + schedulerCode + installCode + fallbackCode, ctx);
  assert.ok(ctx.empireAdapter && ctx.empireController, 'The actual integration must install both coordinators');
  const adapter = ctx.empireAdapter, controller = ctx.empireController;
  const tick = () => { ctx.updateEmpireState(); return controller.state(); };
  assert.equal(tick().ready, true, controller.state().status);
  assert.equal(controller.canAct(adapter.readActive()?.context), true, 'Every fixture starts with actual action authority');
  t.after(() => adapter.dispose());
  const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { ctx, document, host, game, adapter, controller, listeners, timers, storage, tick, microtasks,
    get clock() { return clock; }, get clicks() { return clicks; }, get renders() { return renders; },
    get delivered() { return copy(delivered); }, get active() { return active; },
    set selectorWorks(value) { selectorWorks = value; }, set mismatch(value) { mismatch = value; },
    set loading(value) { loading = value; }, set modal(value) { modal = value; }, set blockedHud(value) { blockedHud = value; },
    set selectionCount(value) { selectionCount = value; }, set scope(value) { scope = value; },
    set beforeResolution(value) { beforeResolution = value; },
    jump(ms) { clock += ms; },
    event(type, place = 'game', trusted = true, extra = {}) {
      const event = { type, isTrusted: trusted, composedPath: () => place === 'helper' ? [{}, host, document] : [game, document], ...extra };
      for (const fn of listeners.get(type) || []) fn(event);
    },
    async advance(ms) {
      const target = clock + ms; await microtasks();
      for (let count = 0; ; count++) {
        assert.ok(count < 10000, 'Bounded fake-clock timer draining');
        const job = [...timers].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!job) break;
        const [id, timer] = job; clock = Math.max(clock, timer.at);
        if (timer.interval) timer.at = clock + timer.interval; else timers.delete(id);
        timer.fn(); await microtasks();
      }
      clock = target; await microtasks();
    },
    publishDelta() { return receive('world.delta', { updated: { players: [{ id: SELF, owned: copy(rows), transits: [] }] } }); },
    disconnect() { reducer.loseConnection(generation); delivered = observer.validateSnapshot(JSON.stringify(reducer.snapshot())); },
  };
}
const canAct = h => h.controller.canAct(h.adapter.readActive()?.context);
for (const type of TYPES) for (const place of ['game', 'helper']) for (const trusted of [true, false]) {
  test(`interaction matrix: ${type}, ${place}, trusted=${trusted}`, async t => {
    const h = harness(t), original = h.delivered; assert.equal(canAct(h), true);
    assert.equal(h.listeners.get(type).length, 1, 'One production listener owns classification');
    h.event(type, place, trusted); const state = h.tick();
    const pauses = trusted && place === 'game';
    assert.equal(state.ready, !pauses); assert.equal(canAct(h), !pauses); assert.equal(h.adapter.canNavigate(), !pauses);
    assert.equal(state.pausedUntil, pauses ? START + 15000 : 0);
    if (pauses) {
      assert.match(state.status, /15 s restantes/);
      await h.advance(14999); assert.equal(canAct(h), false); assert.match(h.tick().status, /1 s restantes/);
      await h.advance(1); assert.equal(h.tick().ready, true); assert.equal(canAct(h), true);
    }
    assert.deepEqual(h.delivered, original, 'Waiting does not invent a newer native census'); assert.equal(h.clicks, 0);
  });
}
test('hover, movement, scroll, focus, click and keyup do not renew interaction deadlines', async t => {
  const h = harness(t); h.event('pointerdown'); await h.advance(7000);
  for (const type of ['pointermove', 'mousemove', 'mouseover', 'mouseenter', 'pointerover', 'scroll', 'focus', 'focusin', 'click', 'keyup']) h.event(type);
  assert.equal(h.controller.state().pausedUntil, START + 15000);
  await h.advance(8050); assert.equal(h.controller.state().ready, true, 'The production one-second fallback plus <=50 ms coalescer clears an idle pause');
});
test('repeated trusted input renews all 15 seconds without refreshing source timestamps', async t => {
  const h = harness(t); h.event('pointerdown'); await h.advance(7000); h.event('keydown', 'game', true, { repeat: true });
  assert.equal(h.controller.state().pausedUntil, START + 22000);
  await h.advance(8000); assert.match(h.tick().status, /7 s restantes/);
  await h.advance(7050); assert.equal(h.controller.state().ready, true); assert.equal(h.delivered.observedAt, START);
});
for (const type of TYPES) {
  test(`${type} before queued hop revokes it without any selector click`, async t => {
    const h = harness(t, { ids: [A, B] }); h.jump(5000); h.tick(); h.event(type); await h.microtasks();
    assert.equal(h.clicks, 0); assert.equal(h.controller.state().manualHold, false); assert.equal(canAct(h), false);
    await h.advance(15200); assert.equal(h.controller.state().manualHold, false); assert.ok(h.clicks <= 1);
  });
  test(`${type} during native hop cancels both coordinators and automatically recovers`, async t => {
    const h = harness(t, { ids: [A, B] }); await h.advance(5001); assert.equal(h.clicks, 1);
    assert.equal(h.controller.state().moving, true);
    h.event(type); assert.equal(canAct(h), false); await h.advance(200);
    assert.equal(h.controller.state().moving, false); assert.equal(h.controller.state().manualHold, false);
    assert.match(h.tick().status, /Pausa por interacción/);
    await h.advance(15200); assert.equal(h.controller.state().manualHold, false); assert.equal(h.controller.state().error, '');
  });
  test(`${type} inside Helper during hop does not cancel selection or create a hidden pause`, async t => {
    const h = harness(t, { ids: [A, B] }); await h.advance(5001); assert.equal(h.controller.state().moving, true); h.event(type, 'helper');
    await h.advance(250); assert.equal(h.controller.state().manualHold, false); assert.equal(h.controller.state().pausedUntil, 0);
    assert.equal(h.tick().ready, true); assert.equal(canAct(h), true); assert.equal(h.clicks, 1);
  });
}
test('input between native resolution and coordinator continuation revokes stale success', async t => {
  const h = harness(t, { ids: [A, B] });
  h.beforeResolution = result => { assert.equal(result, true); h.beforeResolution = null; h.event('wheel'); };
  await h.advance(5250);
  assert.equal(h.controller.state().manualHold, false); assert.equal(h.controller.state().moving, false);
  assert.match(h.tick().status, /Pausa por interacción/); assert.equal(canAct(h), false);
});
test('input after completed hop starts an ordinary temporary pause', async t => {
  const h = harness(t, { ids: [A, B] }); await h.advance(5250); assert.equal(h.tick().ready, true);
  h.event('touchstart'); assert.equal(canAct(h), false); assert.equal(h.controller.state().manualHold, false);
  await h.advance(15200); assert.equal(h.controller.state().manualHold, false);
});
for (const defect of ['selector', 'hud']) {
  test(`real ${defect} failure still requires explicit review`, async t => {
    const h = harness(t, { ids: [A, B] }); if (defect === 'selector') h.selectorWorks = false;
    await h.advance(5001); assert.equal(h.clicks, 1); if (defect === 'hud') h.mismatch = true;
    await h.advance(2200); assert.equal(h.controller.state().manualHold, true); assert.equal(canAct(h), false);
    h.mismatch = false; await h.advance(16000); assert.equal(h.controller.state().manualHold, true); assert.equal(h.clicks, 1);
  });
}
test('Helper policy edits do not shorten the interaction deadline', async t => {
  const h = harness(t); h.event('pointerdown'); await h.advance(3000);
  h.controller.setConfig({ ...h.controller.exportConfig(), fleetTargets: { probe: 10 } });
  assert.equal(h.controller.state().pausedUntil, START + 15000); assert.equal(h.tick().ready, false); assert.equal(canAct(h), false);
});
test('an earlier generic deadline cannot bypass a later interaction deadline', async t => {
  const h = harness(t); h.controller.suspend(5000); h.event('wheel');
  await h.advance(5001); assert.equal(h.tick().ready, false); assert.equal(canAct(h), false);
  assert.equal(h.controller.state().pausedUntil, START + 15000); assert.match(h.controller.state().status, /10 s restantes/);
  await h.advance(10000); assert.equal(h.tick().ready, true); assert.equal(canAct(h), true);
});
test('interaction cannot shorten or mislabel the emergency suspension', async t => {
  const h = harness(t); h.controller.suspend(2147483647); const deadline = h.controller.state().pausedUntil;
  h.event('pointerdown'); await h.advance(16000); h.event('wheel');
  assert.equal(h.controller.state().pausedUntil, deadline); assert.equal(h.tick().ready, false); assert.equal(canAct(h), false);
  assert.match(h.controller.state().status, /Imperio suspendido/); assert.doesNotMatch(h.controller.state().status, /interacción|actividad|termines/);
});
for (const [name, block] of [
  ['pending order', h => { h.ctx.pending = {}; }], ['leadership', h => { h.ctx.leader = false; }],
  ['Helper editor', h => { h.host.shadowRoot.activeElement = { matches: () => true }; }],
  ['game editor', h => { h.document.activeElement = { matches: () => true }; }],
  ['modal', h => { h.modal = true; }], ['loading', h => { h.loading = true; }],
  ['hidden page', h => { h.document.hidden = true; }], ['HUD mismatch', h => { h.mismatch = true; }],
  ['ambiguous selection', h => { h.selectionCount = 2; }], ['foreign scope', h => { h.scope = 'alpha/other'; }],
  ['disconnected census', h => { h.disconnect(); }],
]) {
  test(`expiry does not bypass ${name}`, async t => {
    const h = harness(t); h.event('keydown'); block(h); await h.advance(15100); h.tick();
    assert.equal(canAct(h), false); assert.equal(h.clicks, 0);
    assert.equal(h.controller.state().ready, false);
  });
}
test('expired native census is not refreshed by events, countdown or scheduler', async t => {
  const h = harness(t); h.event('wheel'); await h.advance(120001); h.tick();
  assert.equal(h.delivered.observedAt, START); assert.equal(h.controller.state().ready, false); assert.equal(canAct(h), false);
});
test('interaction changes epoch and keeps order confirmation on the conservative barrier', async t => {
  const h = harness(t); const token = h.controller.captureOrderBoundary(h.adapter.readActive().context); assert.ok(token);
  h.jump(1); h.event('pointerdown'); h.controller.invalidate(A, token);
  await h.advance(15001); assert.equal(h.tick().ready, false); assert.equal(canAct(h), false);
  assert.equal(h.delivered.observedAt, START);
  h.jump(1); h.publishDelta(); assert.equal(h.tick().ready, true); assert.equal(canAct(h), true);
});
test('missing Helper host cannot establish an input exemption', t => {
  const h = harness(t); h.ctx.host = null; h.event('pointerdown', 'helper');
  assert.equal(h.tick().ready, false); assert.equal(h.controller.state().pausedUntil, START + 15000);
});
test('throwing path classifier fails closed rather than exempting unknown input', t => {
  const h = harness(t); let calls = 0;
  h.event('wheel', 'helper', true, { composedPath() { calls++; throw new Error('Synthetic path failure'); } });
  assert.equal(calls, 1); assert.equal(h.controller.state().pausedUntil, START + 15000); assert.equal(canAct(h), false);
});
test('throwing cancellation callback leaves adapter closed and never authorizes a hop retry', async t => {
  const h = harness(t, { ids: [A, B], adapterOptions: { onManualInteraction() { throw new Error('Synthetic callback failure'); } } });
  await h.advance(5001); assert.equal(h.clicks, 1); h.event('pointerdown');
  assert.equal(h.adapter.canNavigate(), false); await h.advance(250);
  assert.equal(h.controller.state().manualHold, true); await h.advance(16000); assert.equal(h.clicks, 1); assert.equal(canAct(h), false);
});

test('known Helper editor focus interrupts an in-flight hop without adding a cooldown or permanent latch', async t => {
  const h = harness(t, { ids: [A, B] }); await h.advance(5001); assert.equal(h.controller.state().moving, true);
  const at = h.clock; h.host.shadowRoot.activeElement = { matches: () => true }; h.event('focusin', 'helper');
  assert.equal(h.controller.state().pausedUntil, at); assert.equal(canAct(h), false); await h.advance(250);
  assert.equal(h.controller.state().manualHold, false); assert.equal(h.controller.state().moving, false); assert.equal(h.clicks, 1);
  assert.match(h.tick().status, /operación o edición actual/);
  await h.advance(2000); assert.equal(h.clicks, 1); assert.equal(canAct(h), false);
  h.host.shadowRoot.activeElement = null; h.event('focusout', 'helper');
  assert.equal(h.tick().ready, true); assert.equal(canAct(h), true); assert.equal(h.controller.state().error, '');
  assert.equal(h.delivered.observedAt, START);
});
test('known editor focus before the queued hop prevents its first native click', async t => {
  const h = harness(t, { ids: [A, B] }); h.jump(5000); h.tick();
  h.host.shadowRoot.activeElement = { matches: () => true }; h.event('focusin', 'helper'); await h.microtasks();
  assert.equal(h.clicks, 0); assert.equal(h.controller.state().manualHold, false); assert.equal(canAct(h), false);
});
test('known editor focus at the native-resolution boundary revokes a stale completion', async t => {
  const h = harness(t, { ids: [A, B] });
  h.beforeResolution = result => {
    assert.equal(result, true); h.beforeResolution = null;
    h.host.shadowRoot.activeElement = { matches: () => true }; h.event('focusin', 'helper');
  };
  await h.advance(5250); assert.equal(h.controller.state().manualHold, false); assert.equal(h.controller.state().moving, false);
  assert.equal(canAct(h), false); assert.equal(h.clicks, 1);
  h.host.shadowRoot.activeElement = null; assert.equal(h.tick().ready, true); assert.equal(canAct(h), true);
});
test('trusted programmatic editor focus revokes editing authority without renewing an existing cooldown', async t => {
  const h = harness(t); h.event('wheel'); await h.advance(7000);
  // Native focus() may create this trusted focusin; no human-input claim is made.
  h.host.shadowRoot.activeElement = { matches: () => true }; h.event('focusin', 'helper');
  assert.equal(h.controller.state().pausedUntil, START + 15000);
  await h.advance(8050); assert.equal(canAct(h), false); assert.match(h.tick().status, /edición actual/);
  h.host.shadowRoot.activeElement = null; assert.equal(h.tick().ready, true); assert.equal(canAct(h), true);
});
for (const [place, trusted, editor] of [['helper', true, false], ['helper', false, true], ['game', true, true]]) {
  test(`editor revocation requires both trusted Helper focus and a known editor: ${place}/${trusted}/${editor}`, t => {
    const h = harness(t); h.host.shadowRoot.activeElement = { matches: () => editor };
    h.event('focusin', place, trusted); assert.equal(h.controller.state().pausedUntil, 0);
    assert.equal(h.controller.state().ready, true, 'No callback fabricated a manual or editor interruption');
    if (editor) assert.equal(canAct(h), false, 'The existing editing guard remains independent');
  });
}
test('editor blur does not bypass modal or pending-order guards', async t => {
  const h = harness(t, { ids: [A, B] }); await h.advance(5001);
  h.host.shadowRoot.activeElement = { matches: () => true }; h.event('focusin', 'helper'); await h.advance(250);
  h.host.shadowRoot.activeElement = null; h.modal = true; assert.equal(h.tick().ready, false); assert.equal(canAct(h), false);
  h.modal = false; h.ctx.pending = { operation: 'synthetic-pending-order' }; assert.equal(h.tick().ready, false); assert.equal(canAct(h), false);
  assert.equal(h.clicks, 1); assert.equal(h.controller.state().manualHold, false);
});
test('known editor focus revokes order-boundary epoch while retaining the conservative confirmation barrier', t => {
  const h = harness(t); const token = h.controller.captureOrderBoundary(h.adapter.readActive().context); assert.ok(token);
  h.jump(1); h.host.shadowRoot.activeElement = { matches: () => true }; h.event('focusin', 'helper'); h.controller.invalidate(A, token);
  h.host.shadowRoot.activeElement = null; assert.equal(h.tick().ready, false); assert.equal(canAct(h), false); assert.equal(h.delivered.observedAt, START);
  h.jump(1); h.publishDelta(); assert.equal(h.tick().ready, true); assert.equal(canAct(h), true);
});
test('editor focus and blur never clear a real selector-failure latch', async t => {
  const h = harness(t, { ids: [A, B] }); h.selectorWorks = false; await h.advance(7200);
  assert.equal(h.controller.state().manualHold, true);
  h.host.shadowRoot.activeElement = { matches: () => true }; h.event('focusin', 'helper'); await h.advance(100);
  h.host.shadowRoot.activeElement = null; h.selectorWorks = true; await h.advance(16000);
  assert.equal(h.controller.state().manualHold, true); assert.equal(canAct(h), false); assert.equal(h.clicks, 1);
});
test('editor interruption preserves an emergency deadline even after blur', t => {
  const h = harness(t); h.controller.suspend(2147483647); const deadline = h.controller.state().pausedUntil;
  h.jump(1); h.host.shadowRoot.activeElement = { matches: () => true }; h.event('focusin', 'helper');
  assert.equal(h.controller.state().pausedUntil, deadline);
  h.host.shadowRoot.activeElement = null; assert.equal(h.tick().ready, false); assert.equal(canAct(h), false);
});
test('throwing editor classifier cannot open existing editing gates', async t => {
  const h = harness(t, { ids: [A, B], adapterOptions: { isHelperEditorFocused() { throw new Error('Synthetic classifier failure'); } } });
  await h.advance(5001); h.host.shadowRoot.activeElement = { matches: () => true }; h.event('focusin', 'helper');
  assert.equal(canAct(h), false); await h.advance(250); assert.equal(h.clicks, 1); assert.equal(canAct(h), false);
});

test('game editor stays visibly paused after cooldown and resumes only after blur', async t => {
  const h = harness(t); h.event('pointerdown');
  h.document.activeElement = { isContentEditable: true };
  await h.advance(15001);
  assert.equal(h.tick().ready, false); assert.equal(canAct(h), false);
  assert.match(h.controller.state().status, /operación o edición/);
  assert.equal(h.controller.state().manualHold, false);
  h.document.activeElement = null;
  assert.equal(h.tick().ready, true); assert.equal(canAct(h), true);
  assert.equal(h.delivered.observedAt, START); assert.equal(h.clicks, 0);
});

test('busy mission and campaign permissions respect touch-only cooldown but recover after expiry', async t => {
  for (const actor of ['missionAdapter', 'attackRetry']) {
    const h = harness(t); h.ctx[actor].isBusy = () => true;
    h.modal = true; // The adapter owns its dialog; its existing exemption stays valid.
    h.tick(); assert.equal(h.ctx.empireMissionPermission(), true);
    h.event('touchstart');
    assert.equal(h.ctx.empireMissionPermission(), false);
    await h.advance(14999); assert.equal(h.ctx.empireMissionPermission(), false);
    await h.advance(1); assert.equal(h.ctx.empireMissionPermission(), true);
    assert.equal(canAct(h), false, 'Dialog still blocks general production/navigation');
    assert.equal(h.clicks, 0); assert.equal(h.delivered.observedAt, START);
  }
});
test('busy dialog exemption retains synthetic/Helper filtering and cannot bypass emergency suspension', t => {
  const h = harness(t); h.ctx.missionAdapter.isBusy = () => true; h.modal = true;
  for (const [place, trusted] of [['game', false], ['helper', true]]) {
    h.event('touchstart', place, trusted); assert.equal(h.ctx.empireMissionPermission(), true);
  }
  h.controller.suspend(2147483647); assert.equal(h.ctx.empireMissionPermission(), false);
  h.event('touchstart'); h.jump(15001); assert.equal(h.ctx.empireMissionPermission(), false);
});

for (const change of ['disable', 'disable-enable', 'exclude', 'role', 'targets', 'remote-disable', 'storage-error', 'suspend']) {
  test(`integrated mid-hop ${change} revokes remaining native clicks without undoing the first`, async t => {
    const middle = uuid(12), h = harness(t, { ids: [A, middle, B] });
    await h.advance(5001); assert.equal(h.clicks, 1); assert.equal(h.active, middle);
    assert.equal(h.controller.state().moving, true); assert.equal(canAct(h), false);
    const config = h.controller.exportConfig();
    if (change === 'disable' || change === 'disable-enable') {
      h.controller.setConfig({ ...config, enabled: false });
      if (change === 'disable-enable') h.controller.setConfig(config);
    } else if (change === 'exclude') h.controller.setConfig({ ...config, systems: { [B]: { enabled: false } } });
    else if (change === 'role') h.controller.setConfig({ ...config, systems: { [B]: { role: 'industry' } } });
    else if (change === 'targets') h.controller.setConfig({ ...config, fleetTargets: { probe: 50 } });
    else if (change === 'remote-disable') {
      h.storage.set('old-light-empire:v1:' + h.controller.state().scope, JSON.stringify({ ...config, enabled: false }));
    } else if (change === 'storage-error') h.ctx.localStorage.getItem = () => { throw new Error('Synthetic denied storage'); };
    else h.controller.suspend(15000);
    if (!['remote-disable', 'storage-error'].includes(change)) assert.equal(canAct(h), false, 'Local edits revoke authority synchronously');
    await h.advance(500);
    assert.equal(h.clicks, 1); assert.equal(h.active, middle, 'The first completed hop is not undone');
    assert.equal(h.controller.state().moving, false); assert.equal(h.controller.state().manualHold, false);
    if (['disable', 'remote-disable', 'storage-error', 'suspend'].includes(change)) assert.equal(canAct(h), false);
    // Enabled policy edits may gain NEW authority after a fresh scheduled update
    // at the settled intermediate system; the old traversal still cannot continue.
    if (change === 'storage-error') assert.equal(h.controller.state().storageError, true);
    if (change === 'disable') {
      await h.advance(1000); assert.equal(h.clicks, 1); assert.equal(h.controller.isEnabled(), false);
    }
  });
}
