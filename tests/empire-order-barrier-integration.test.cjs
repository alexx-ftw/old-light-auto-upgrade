'use strict';
// Execute the shipped order-dispatch and pending-confirmation blocks, with the
// real native adapter/coordinator/core. Fixtures never access the game/network.
// OLD_LIGHT_ORDER_SOURCE allows the same regression suite against an old release.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../docs/empire-core.js');
const runtime = require('../docs/empire-runtime.js');
const native = require('../docs/empire-adapter.js');
const source = fs.readFileSync(process.env.OLD_LIGHT_ORDER_SOURCE || path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const register = source.indexOf('    // Registra la petición ANTES del clic:');
const captureStart = source.lastIndexOf('    const empireBoundary = empireController?.isEnabled()', register);
const dispatchStart = captureStart >= 0 ? captureStart : source.lastIndexOf('    if (empireController?.isEnabled() && !empireController.canAct(empireAdapter.readActive()?.context)) {', register);
// The function boundary is stable when additional planners are inserted below it.
const dispatchEnd = source.indexOf('\n  }\n\n', register);
const confirmBody = source.indexOf('      const requestSystemName = pending.systemName;');
const confirmStart = source.lastIndexOf('    if (pending) {', confirmBody);
const confirmEnd = source.indexOf('\n    if (!settings.enabled) {', confirmBody);
const shipStart = source.indexOf('  function shipConfirmed(request, counts) {');
const shipEnd = source.indexOf('\n  function readShipUnitCost(', shipStart);
assert.ok(register > 0 && dispatchStart > 0 && dispatchEnd > register && confirmStart > 0 && confirmEnd > confirmBody && shipStart > 0 && shipEnd > shipStart);
const executable = source.slice(shipStart, shipEnd) + '\nfunction dispatch(candidate) {\n' + source.slice(dispatchStart, dispatchEnd)
  + '\n}\nfunction confirmPending() {\n' + source.slice(confirmStart, confirmEnd) + '\n}';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', J = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SCOPE = 'alpha/' + P;
const waitingCensus = 'Esperando un censo nativo posterior al pedido confirmado; no se enviarán nuevos pedidos.';
const counts = value => Object.fromEntries(core.DEFAULT_SHIPS.map(type => [type, value]));

function harness({ empire = true, kind = 'ship' } = {}) {
  let clock = 1000000, active = A, contextScope = SCOPE, hudOverride = null, onClick = null;
  const ownSystem = (id, q) => ({ id, q, r: 0, name: id === A ? 'Sede' : 'Colonia',
    buildings: [{ type: 'shipyard', level: 1 }], fleet: [{ type: 'probe', quantity: 10 }], shipyard: { queue: [] },
    economy: { resources: { palladium: 100, iridium: 100, settledAt: new Date(clock).toISOString() },
      paCap: 1000, irCap: 1000, paRatePerMin: 0, irRatePerMin: 0, energyCap: 10, energyUsed: 0, queue: [] } });
  const world = { version: 1, galaxy: 'alpha', selfId: P, scope: SCOPE, generation: 1, epoch: 1, revision: 0,
    observedAt: clock, connected: true, complete: true, systems: [ownSystem(A, 0), ownSystem(B, 1)], transits: [], transitShips: counts(0) };
  const events = [], invalidations = [], shown = [], warnings = [], wakeups = [];
  let clicks = 0, saves = 0, released = 0, loading = false, failed = false, batchResult = null;
  const button = { classList: { contains: name => name === 'b-loading' ? loading : name === 'b-upgrade-error' ? failed : false },
    getAttribute: () => '', click() { clicks++; onClick?.(); } };
  const candidate = { id: kind === 'ship' ? 'probe' : 'reactor', kind, name: kind === 'ship' ? 'Probe' : 'Reactor',
    quantity: 3, system: A, fleetTotal: 10, building: 0, batches: [], feedbackLine: null, target: '×3', targetLevel: 1, button };
  const document = { hidden: false, activeElement: null, querySelector: selector => selector === '[data-field="nameplate-name"]' ? { textContent: 'Sede' } : null,
    querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  function rawHud() {
    const raw = world.systems.find(row => row.id === active);
    if (!raw) return null;
    const parked = counts(0), building = counts(0);
    for (const item of raw.fleet) parked[item.type] = item.quantity;
    for (const item of raw.shipyard.queue) if (item.kind !== 'scrap') building[item.type] += item.quantityRemaining;
    return { resources: native.projectResources(raw.economy, clock),
      fleet: Object.fromEntries(core.DEFAULT_SHIPS.map(type => [type, { parked: parked[type], away: 0, building: building[type] }])),
      queue: { buildings: raw.economy.queue.length, ships: raw.shipyard.queue.length }, energy: raw.economy.energyCap - raw.economy.energyUsed };
  }
  const hud = () => hudOverride || rawHud();
  const adapter = native.create({ getWorld: () => world,
    getContext: () => ({ scope: contextScope, systemId: active, selectionCount: 1, owned: true, settled: true }),
    getHudSnapshot: hud, document, canNavigate: () => true, now: () => clock });
  let saved = core.normalizeConfig({ enabled: empire, fleetTargets: { probe: 40 } });
  const controller = runtime.create({ core, adapter, now: () => clock, dwellMs: 1000000,
    read: () => saved, write: (_key, value) => { saved = value; } });
  const wrapped = { ...controller, invalidate(id, token) { invalidations.push({ id, token, clock, pending: ctx.pending, clicks }); controller.invalidate(id, token); } };
  const ctx = { empireController: wrapped, empireAdapter: adapter, document,
    settings: { enabled: true }, pending: null, now: clock, activeSystem: active, nextClickAt: 0, lastClick: '', error: '', unconfirmed: 0,
    eventSequence: 0, notificationSession: 'fixture', MIN_GAP_MS: 1000, RETRY_GAP_MS: 5000, MAX_UNCONFIRMED: 3, RESPONSE_TIMEOUT_MS: 30000,
    current: kind === 'ship' ? [] : [candidate], ships: kind === 'ship' ? [candidate] : [],
    systemId: () => active, text: node => node?.textContent || '', queueLength: () => hud()?.queue.buildings || 0,
    batchSummary: () => null, batchApplied: () => batchResult,
    fleetCounts: id => hud()?.fleet[id], fleetTotal: row => row.parked + row.away + row.building,
    shipBatches: () => world.systems.find(row => row.id === active)?.shipyard.queue.map(row => row.quantityRemaining) || [],
    shipAcceptedQuantity: request => request.quantity,
    show: message => shown.push(message), wakeAt: at => wakeups.push(at), emitEvent: (...args) => events.push(args),
    saveSettings: () => saves++, releaseLeadership: () => released++, console: { warn: (...args) => warnings.push(args) } };
  vm.createContext(ctx); vm.runInContext(executable, ctx);
  const tick = () => controller.update({ scope: contextScope, blocked: ctx.pending ? 'Esperando la petición registrada.' : '', enabled: ctx.settings.enabled });
  tick();
  return { world, candidate, controller, adapter, ctx, events, invalidations, shown, warnings, wakeups, rawHud, tick,
    get clicks() { return clicks; }, get saves() { return saves; }, get released() { return released; },
    set onClick(value) { onClick = value; }, set hud(value) { hudOverride = value; }, set failed(value) { failed = value; },
    set loading(value) { loading = value; }, set batchResult(value) { batchResult = value; },
    set active(value) { active = value; }, set contextScope(value) { contextScope = value; },
    advance(ms = 5) { clock += ms; ctx.now = clock; },
    dispatch() { ctx.now = clock; ctx.activeSystem = active; ctx.dispatch(candidate); },
    confirm() { ctx.now = clock; ctx.confirmPending(); },
    publish({ production = true, sameTime = false } = {}) {
      if (!sameTime) { clock += 5; ctx.now = clock; }
      world.observedAt = clock; world.revision++;
      if (production) {
        if (kind === 'ship') world.systems[0].shipyard.queue = [{ id: J, type: 'probe', kind: 'recruit', quantityRemaining: 3 }];
        else world.systems[0].economy.queue = [{ id: J }];
        world.systems[0].economy.resources.palladium -= 10;
      }
    },
  };
}

for (const kind of ['ship', 'building']) test(`${kind}: registers request and revokes authority before native click without discarding census`, () => {
  const h = harness({ kind }); assert.equal(h.controller.state().ready, true); h.advance();
  h.onClick = () => {
    assert.ok(h.ctx.pending, 'the request must exist before the native callback');
    assert.equal(h.invalidations.length, 0, 'dispatch captures a boundary without invalidating measurements');
    assert.ok(h.ctx.pending.empireBoundary, 'the opaque boundary must be carried by the registered request');
    assert.equal(Object.keys(h.ctx.pending.empireBoundary).length, 0);
    assert.equal(h.controller.state().snapshots.length, 2);
    assert.equal(h.controller.canAct(h.adapter.readActive()?.context), false);
  };
  h.dispatch(); assert.equal(h.clicks, 1); assert.equal(h.warnings.length, 0);
  assert.equal(h.tick().ready, false); assert.equal(h.controller.state().snapshots.length, 2);
});

for (const kind of ['ship', 'building']) test(`${kind}: accepted confirmation stays usable without a second native revision`, () => {
  const h = harness({ kind }); h.advance(); h.dispatch(); h.publish();
  const confirmation = h.tick(); assert.equal(confirmation.snapshots.length, 2); assert.equal(confirmation.ready, false, 'pending request still blocks execution');
  const revision = h.world.revision; h.advance(); h.confirm(); assert.equal(h.ctx.pending, null);
  const state = h.tick(); assert.equal(state.snapshots.length, 2); assert.equal(state.ready, true);
  assert.equal(h.controller.canAct(h.adapter.readActive()?.context), true);
  assert.equal(h.world.revision, revision); assert.equal(h.invalidations.length, 1); assert.ok(h.invalidations[0].token, 'confirmation uses the pre-click boundary, not its own census');
  h.advance(1000); assert.equal(h.tick().ready, true); assert.equal(h.world.revision, revision);
});

test('synchronous native confirmation inside click cannot reuse pre-dispatch authority', () => {
  const h = harness(); h.advance();
  h.onClick = () => {
    assert.equal(h.controller.canAct(h.adapter.readActive()?.context), false);
    h.publish(); h.tick(); h.confirm(); assert.equal(h.ctx.pending, null);
  };
  h.dispatch(); assert.equal(h.warnings.length, 0); assert.equal(h.tick().ready, true); assert.equal(h.invalidations.length, 1);
});

test('HUD-only confirmation cannot authorize another order without a new native census', () => {
  const h = harness(); h.advance(); h.dispatch();
  const hud = structuredClone(h.rawHud()); hud.fleet.probe.building = 3; hud.queue.ships = 1; h.hud = hud;
  h.advance(); h.confirm(); assert.equal(h.ctx.pending, null, 'legacy HUD confirmation alone can clear pending');
  const state = h.tick(); assert.equal(state.ready, false); assert.equal(state.snapshots.length, 0); assert.equal(state.status, waitingCensus);
  assert.equal(h.controller.canAct(h.adapter.readActive()?.context), false);
  h.dispatch(); assert.equal(h.clicks, 1, 'the real dispatch preflight rejects the next click');
});

test('re-enabled button and unchanged fleet cannot clear pending or authorize another order', () => {
  const h = harness(); h.advance(); h.dispatch(); h.advance(); h.confirm();
  assert.ok(h.ctx.pending); assert.equal(h.tick().ready, false); assert.equal(h.controller.canAct(h.adapter.readActive()?.context), false);
  h.dispatch(); assert.equal(h.clicks, 1); assert.equal(h.invalidations.length, 0);
});

test('a new native revision at the dispatch millisecond cannot cross the timestamp barrier', () => {
  const h = harness(); h.advance(); h.dispatch(); h.publish({ sameTime: true }); h.confirm();
  assert.equal(h.ctx.pending, null); assert.equal(h.tick().status, waitingCensus); assert.equal(h.controller.canAct(h.adapter.readActive()?.context), false);
  h.publish({ production: false }); assert.equal(h.tick().ready, true);
});

test('system or account identity changes before dispatch prevent any click or barrier', () => {
  for (const change of [h => { h.active = B; }, h => { h.contextScope = 'beta/' + P; }]) {
    const h = harness(); change(h); h.dispatch(); assert.equal(h.clicks, 0); assert.equal(h.invalidations.length, 0); assert.equal(h.ctx.pending, null);
  }
});

test('selection change during click cannot confirm the old origin from the new system', () => {
  const h = harness(); h.advance(); h.onClick = () => { h.active = B; };
  h.dispatch(); h.publish(); h.confirm(); assert.ok(h.ctx.pending); assert.equal(h.ctx.pending.system, A);
  assert.equal(h.tick().ready, false); assert.equal(h.controller.canAct(h.adapter.readActive()?.context), false);
});

test('click exception pauses automation; explicit resume retains the previous no-send retry behavior', () => {
  const h = harness(); h.advance(); h.onClick = () => { throw new Error('fixture click failure'); }; h.dispatch();
  assert.equal(h.clicks, 1); assert.equal(h.ctx.pending, null); assert.equal(h.ctx.settings.enabled, false);
  assert.equal(h.saves, 1); assert.equal(h.released, 1); assert.equal(h.warnings.length, 1); assert.equal(h.invalidations.length, 0);
  assert.equal(h.tick().ready, false, 'automation remains paused until the user resumes');
  h.ctx.settings.enabled = true; assert.equal(h.tick().ready, true);
  assert.equal(h.controller.canAct(h.adapter.readActive()?.context), true);
  h.onClick = null; h.dispatch(); assert.equal(h.clicks, 2); assert.equal(h.world.revision, 0);
});

for (const kind of ['ship', 'building']) test(`${kind}: rejection keeps the existing retry behavior without requiring an unrelated native delta`, () => {
  const h = harness({ kind }); h.advance(); h.dispatch(); h.advance();
  if (kind === 'ship') h.failed = true; else h.batchResult = 0;
  h.confirm(); assert.equal(h.ctx.pending, null); assert.equal(h.ctx.settings.enabled, true);
  h.advance(5001); assert.equal(h.tick().ready, true); assert.equal(h.controller.canAct(h.adapter.readActive()?.context), true);
  h.failed = false; h.dispatch(); assert.equal(h.clicks, 2); assert.equal(h.world.revision, 0); assert.equal(h.invalidations.length, 0);
  h.publish(); h.tick(); if (kind === 'building') h.batchResult = 1; h.confirm(); assert.equal(h.ctx.pending, null); assert.equal(h.tick().ready, true);
});

test('ordinary single-system mode neither creates a barrier nor invalidates on confirmation', () => {
  const h = harness({ empire: false }); h.advance(); h.dispatch(); assert.equal(h.clicks, 1); assert.equal(h.invalidations.length, 0);
  h.publish(); h.confirm(); assert.equal(h.ctx.pending, null); assert.equal(h.invalidations.length, 0);
  assert.ok(h.events.some(row => row[0] === 'ships.queued'));
});

// Contract adversaries intentionally use a deterministic adapter so renewed
// timestamps cannot hide an incorrect census-ID barrier behind native ordering.
function boundaryHarness() {
  let clock = 1000000, scope = SCOPE, reads = 0;
  let saved = core.normalizeConfig({ enabled: true, fleetTargets: { probe: 40 } });
  const context = { scope, systemId: A, owned: true, settled: true, selectionCount: 1 };
  let bundle;
  function publish(censusId, { at = clock, nextScope = scope } = {}) {
    scope = nextScope; context.scope = scope;
    const row = id => ({ scope, systemId: id, name: id, owned: true, observedAt: at, censusId,
      resources: { palladium: { amount: 100, cap: 1000, rate: 0 }, iridium: { amount: 100, cap: 1000, rate: 0 } },
      fleet: Object.fromEntries(core.DEFAULT_SHIPS.map(type => [type, { parked: type === 'probe' ? 10 : 0, away: 0, building: 0 }])),
      queue: { buildings: 0, ships: 0 }, energy: 10 });
    const snapshots = [row(A), row(B)];
    bundle = { roster: { scope, observedAt: at, complete: true, systems: [A, B].map(id => ({ id, owned: true })) }, snapshots,
      transitCensus: { scope, observedAt: at, censusId, ships: counts(0) }, active: { context: { ...context }, snapshot: snapshots[0] } };
  }
  publish('initial');
  const adapter = { readBundle: () => { reads++; return structuredClone(bundle); }, canNavigate: () => true };
  const app = runtime.create({ core, adapter, now: () => clock, dwellMs: 1000000,
    read: () => saved, write: (_key, value) => { saved = value; } });
  const tick = extra => app.update({ scope, ...extra }); tick();
  return { app, context, publish, tick, get reads() { return reads; }, get clock() { return clock; }, get bundle() { return bundle; },
    advance(ms = 5) { clock += ms; }, capture: () => app.captureOrderBoundary(context) };
}

test('opaque boundary uses exactly one fresh bundle and the newer preflight census, not cached snapshots', () => {
  const h = boundaryHarness(); h.advance(); h.publish('new-at-preflight');
  assert.equal(h.app.state().snapshots[0].censusId, 'initial');
  const before = h.reads, token = h.capture(); assert.ok(token); assert.equal(h.reads - before, 1);
  assert.equal(Object.getPrototypeOf(token), null); assert.equal(Object.isFrozen(token), true); assert.deepEqual(Object.keys(token), []);
  assert.equal(h.app.state().ready, false); assert.equal(h.app.state().snapshots.length, 2);
  assert.equal(h.capture(), null, 'capture immediately revokes authority until the next valid update');
  h.advance(); h.publish('new-at-preflight'); h.app.invalidate(A, token);
  assert.equal(h.tick().status, waitingCensus, 'a timestamp-renewed copy of the captured census remains blocked');
  h.advance(); h.publish('actual-confirmation'); assert.equal(h.tick().ready, true);
});

test('confirmed native census newer than the captured boundary survives confirmation-time invalidation', () => {
  const h = boundaryHarness(); const token = h.capture(); h.advance(); h.publish('confirmed'); h.tick(); h.advance();
  h.app.invalidate(A, token); assert.equal(h.tick().ready, true); assert.equal(h.app.state().snapshots.length, 2);
});

test('pending and manual suspension cannot mint fresh order authority', () => {
  const h = boundaryHarness(); h.tick({ blocked: 'Pending native order' }); assert.equal(h.capture(), null);
  h.tick(); h.app.suspend(); assert.equal(h.capture(), null); assert.equal(h.tick().ready, false);
  h.advance(15001); h.publish('after-manual-hold'); assert.equal(h.tick().ready, true); assert.ok(h.capture());
});

for (const [label, fake] of [['plain object', {}], ['caller data', { scope: SCOPE, systemId: A, at: 0, censusId: 'initial', epoch: 1 }], ['cloned token', null]]) {
  test(`forged boundary (${label}) cannot backdate an invalidation`, () => {
    const h = boundaryHarness(); const real = h.capture(); const token = label === 'cloned token' ? structuredClone(real) : fake;
    h.advance(); h.publish('confirmed'); h.tick(); h.advance(); h.app.invalidate(A, token);
    assert.equal(h.tick().status, waitingCensus); assert.equal(h.app.canAct(h.context), false);
    h.advance(); h.publish('after-conservative-barrier'); assert.equal(h.tick().ready, true);
  });
}

test('a reused valid token falls back to the current conservative invalidation', () => {
  const h = boundaryHarness(); const token = h.capture(); h.advance(); h.publish('confirmed'); h.app.invalidate(A, token);
  assert.equal(h.tick().ready, true); h.advance(); h.app.invalidate(A, token); assert.equal(h.tick().status, waitingCensus);
});

test('a boundary from another controller cannot authorize this controller', () => {
  const owner = boundaryHarness(), other = boundaryHarness(); const token = owner.capture();
  other.advance(); other.publish('confirmed'); other.tick(); other.advance(); other.app.invalidate(A, token);
  assert.equal(other.tick().status, waitingCensus);
});

test('a wrong-system invalidation consumes the token and never permits later reuse on its actual origin', () => {
  const h = boundaryHarness(); const token = h.capture(); h.advance(); h.publish('confirmed'); h.tick(); h.advance();
  h.app.invalidate(B, token); assert.equal(h.tick().status, waitingCensus);
  h.advance(); h.publish('after-wrong-system'); assert.equal(h.tick().ready, true);
  h.advance(); h.app.invalidate(A, token); assert.equal(h.tick().status, waitingCensus);
});

test('account change and return cannot revive an old token even with the same system UUID', () => {
  const h = boundaryHarness(); const token = h.capture(); h.advance(); h.publish('foreign', { nextScope: 'beta/' + P }); h.tick();
  h.advance(); h.publish('returned', { nextScope: SCOPE }); h.tick(); h.advance(); h.app.invalidate(A, token);
  assert.equal(h.tick().status, waitingCensus); assert.equal(h.app.canAct(h.context), false);
});

test('a policy epoch change makes a previously captured token conservative', () => {
  const h = boundaryHarness(); const token = h.capture(); h.app.setConfig(h.app.exportConfig());
  h.advance(); h.publish('confirmed'); h.tick(); h.advance(); h.app.invalidate(A, token); assert.equal(h.tick().status, waitingCensus);
});

test('a late older confirmation cannot replace either component of a newer installed barrier', () => {
  const h = boundaryHarness(); const old = h.capture(); h.advance(); h.publish('newer-order'); h.tick(); const newer = h.capture();
  h.app.invalidate(A, newer); h.advance(); h.app.invalidate(A, old);
  h.publish('newer-order'); assert.equal(h.tick().status, waitingCensus, 'renewing the newer census timestamp must remain blocked');
  h.advance(); h.publish('newest-confirmation'); assert.equal(h.tick().ready, true);
});

test('equal-time different-census boundaries conservatively reject both replay IDs', () => {
  const h = boundaryHarness(); const first = h.capture(); h.publish('other-same-millisecond'); h.tick(); const second = h.capture();
  h.app.invalidate(A, second); h.app.invalidate(A, first);
  h.advance(); h.publish('initial'); assert.equal(h.tick().status, waitingCensus);
  h.advance(); h.publish('other-same-millisecond'); assert.equal(h.tick().status, waitingCensus);
  h.advance(); h.publish('third-confirmation'); assert.equal(h.tick().ready, true);
});

test('stale and future native observations cannot mint a boundary', () => {
  const old = boundaryHarness(); old.advance(120001); assert.equal(old.capture(), null);
  const future = boundaryHarness(); future.publish('future', { at: future.clock + 1 }); assert.equal(future.capture(), null);
});

test('a late confirmation with expired source data cannot use the marker to bypass freshness', () => {
  const h = boundaryHarness(); const token = h.capture(); h.advance(); h.publish('confirmed'); h.advance(120001); h.app.invalidate(A, token);
  assert.equal(h.tick().ready, false); assert.equal(h.app.canAct(h.context), false);
  h.publish('fresh-after-expiry'); assert.equal(h.tick().ready, true);
});

test('ship timeout stays paused; a later observed result is read before explicit user resume', () => {
  const h = harness(); h.advance(); h.dispatch(); h.advance(30001); h.confirm();
  assert.equal(h.ctx.pending, null); assert.equal(h.ctx.settings.enabled, false); assert.equal(h.invalidations.length, 0);
  h.publish(); assert.equal(h.tick().ready, false); assert.equal(h.controller.state().snapshots[0].fleet.probe.building, 3);
  assert.equal(h.clicks, 1); h.ctx.settings.enabled = true; assert.equal(h.tick().ready, true);
  assert.equal(h.controller.state().plan.summary.totals.fleet.probe.total, 23, 'late production is included before a resumed allocation');
});

test('building timeout retains bounded retry behavior without inventing confirmation', () => {
  const h = harness({ kind: 'building' }); h.advance(); h.dispatch(); h.advance(30001); h.confirm();
  assert.equal(h.ctx.pending, null); assert.equal(h.ctx.unconfirmed, 1); assert.equal(h.ctx.settings.enabled, true);
  assert.equal(h.invalidations.length, 0); h.advance(5001); assert.equal(h.tick().ready, true);
  h.dispatch(); assert.equal(h.clicks, 2); assert.equal(h.world.revision, 0);
  assert.equal(h.events.filter(row => row[0] === 'building.queued').length, 0);
});

test('processing an already-cleared confirmation twice does not consume a second token or send another order', () => {
  const h = harness(); h.advance(); h.dispatch(); h.publish(); h.tick(); h.confirm(); h.tick();
  h.confirm(); assert.equal(h.ctx.pending, null); assert.equal(h.invalidations.length, 1); assert.equal(h.clicks, 1);
  assert.equal(h.events.filter(row => row[0] === 'ships.queued').length, 1); assert.equal(h.tick().ready, true);
});

test('pause while pending keeps orders blocked and makes the old token conservative on confirmation', () => {
  const h = harness(); h.advance(); h.dispatch(); h.controller.suspend(); h.publish(); h.tick(); h.confirm();
  assert.equal(h.ctx.pending, null); assert.equal(h.tick().ready, false); assert.equal(h.clicks, 1);
  h.advance(15001); h.publish({ production: false }); assert.equal(h.tick().ready, true);
});

test('native reconnect cannot restore old pre-order state or send a second order while pending', () => {
  const h = harness(); h.advance(); h.dispatch(); h.world.connected = false; assert.equal(h.tick().ready, false);
  h.advance(); h.world.connected = true; h.world.generation++; h.world.epoch++; h.world.revision = 0; h.world.observedAt += 10;
  assert.equal(h.tick().ready, false); h.dispatch(); assert.equal(h.clicks, 1);
  h.publish(); h.tick(); h.confirm(); assert.equal(h.ctx.pending, null); assert.equal(h.tick().ready, true);
});

test('a repeated conservative invalidation preserves every equal-time blocked census ID', () => {
  const h = boundaryHarness(); const first = h.capture(); h.publish('other-same-millisecond'); h.tick(); const second = h.capture();
  h.app.invalidate(A, second); h.app.invalidate(A, first); h.advance(); h.app.invalidate(A, {});
  h.advance(); h.publish('initial'); assert.equal(h.tick().status, waitingCensus);
  h.advance(); h.publish('other-same-millisecond'); assert.equal(h.tick().status, waitingCensus);
  h.advance(); h.publish('genuinely-new'); assert.equal(h.tick().ready, true);
});

test('invalid system arguments still consume otherwise genuine tokens', () => {
  const h = boundaryHarness(); const token = h.capture(); h.app.invalidate('not-a-system', token);
  h.advance(); h.publish('confirmed'); h.tick(); h.advance(); h.app.invalidate(A, token);
  assert.equal(h.tick().status, waitingCensus);
});

test('an order wait is not used to disguise duplicate, missing, unowned, stale or incomplete census data', () => {
  const cases = [
    h => { h.bundle.snapshots.push(structuredClone(h.bundle.snapshots[0])); },
    h => { h.bundle.snapshots.pop(); },
    h => { h.bundle.snapshots[1].owned = false; },
    h => { h.bundle.snapshots[1].observedAt = h.clock + 1; },
    h => { h.bundle.snapshots[1].resources.palladium.amount = null; },
    h => { h.bundle.transitCensus.censusId = 'incoherent-transit'; },
  ];
  for (const change of cases) {
    const h = boundaryHarness(); const token = h.capture(); h.app.invalidate(A, token); change(h);
    assert.equal(h.tick().status, 'El censo imperial no está disponible o es ambiguo.');
  }
});

test('actual mission and navigation entrypoints both reject pending even if an in-flight helper permission is permissive', () => {
  const navStart = source.indexOf('  function canNavigateEmpire() {'), navEnd = source.indexOf('\n  function ', navStart + 1);
  const missionStart = source.indexOf('  function canOperateMission() {'), missionEnd = source.indexOf('\n  function missionQueueContext()', missionStart);
  assert.ok(navStart > 0 && navEnd > navStart && missionStart > 0 && missionEnd > missionStart);
  const ctx = { leader: true, settings: { enabled: true }, importingBackup: false, pending: null,
    document: { hidden: false, querySelector: () => null }, hudBlocked: () => false, hudPanelAvailable: () => true,
    reports: { isRecovering: () => false }, missionAdapter: { isBusy: () => false }, attackRetry: { isBusy: () => false },
    host: null, PANEL: 'structures', FLEET_PANEL: 'shipyard', empireController: { isEnabled: () => true },
    empireMissionPermission: () => true, missionContext: () => ({ scope: SCOPE, originId: A, selectionCount: 1 }) };
  vm.createContext(ctx); vm.runInContext(source.slice(navStart, navEnd) + source.slice(missionStart, missionEnd), ctx);
  assert.equal(ctx.canNavigateEmpire(), true); assert.equal(ctx.canOperateMission(), true);
  ctx.pending = { system: A }; assert.equal(ctx.canNavigateEmpire(), false); assert.equal(ctx.canOperateMission(), false);
  ctx.missionAdapter.isBusy = () => true; assert.equal(ctx.canOperateMission(), false);
});
