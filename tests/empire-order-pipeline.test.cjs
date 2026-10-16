'use strict';
// Offline cross-layer regression tests. Every account, world frame and HUD value
// below is synthetic. Production parser/reducer/validator, adapter, runtime,
// panel, and the shipped order/confirmation/navigation guards are executed.
// Only the shipped final dispatch, pending confirmation and action guards are
// extracted; candidate selection, the entire scheduler and WebSocket bootstrap
// are covered by their separate suites. The small DOM models behavior only: it does NOT establish real browser layout,
// accessibility, Socket.IO provenance, native latency, or account compatibility.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const observer = require('../docs/empire-observer.js');
const adapterModule = require('../docs/empire-adapter.js');
const core = require('../docs/empire-core.js');
const runtime = require(process.env.OLD_LIGHT_PIPELINE_RUNTIME || '../docs/empire-runtime.js');
const panelModule = require('../docs/empire-panel.js');
const source = fs.readFileSync(process.env.OLD_LIGHT_PIPELINE_SOURCE || path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SELF = uuid(1), OTHER = uuid(2), A = uuid(10), B = uuid(11), C = uuid(12), JOB = uuid(100), TRANSIT = uuid(200);
const SCOPE = `alpha/${SELF}`, START = 1791930000000;
const WAITING_FOR_POST_ORDER_CENSUS = 'Esperando un censo nativo posterior al pedido confirmado; no se enviarán nuevos pedidos.';
const clone = value => JSON.parse(JSON.stringify(value));
const frame = (name, payload) => '42' + JSON.stringify([name, payload]);
const zeroes = () => Object.fromEntries(core.DEFAULT_SHIPS.map(id => [id, 0]));

function section(begin, end, from = 0) {
  const a = source.indexOf(begin, from), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Cannot locate shipped section: ${begin}`);
  return source.slice(a, b);
}
const registration = source.indexOf('    // Registra la petición ANTES del clic:');
const boundaryStart = source.lastIndexOf('    const empireBoundary = ', registration);
assert.ok(registration > 0 && boundaryStart > 0, 'The pipeline must execute the candidate order-boundary integration.');
// Stop at the shipped step() boundary, regardless of the planner that follows.
const dispatchCode = section('    const empireBoundary = ', '\n  }\n\n', boundaryStart);
const confirmBody = source.indexOf('      const requestSystemName = pending.systemName;');
const confirmStart = source.lastIndexOf('    if (pending) {', confirmBody);
assert.ok(confirmStart > 0);
const confirmCode = section('    if (pending) {', '\n    if (!settings.enabled) {', confirmStart);
const integrationCode = section('  function empireMissionPermission(', '\n  function observeEmpireStartup(');
const code = section('  function projectShipCredits(', '  function prepareShip(') + '\n' + section('  function shipConfirmed(', '\n  function readShipUnitCost(')
  + '\n' + integrationCode
  + '\n' + section('  function canOperateMission(', '\n  function missionQueueContext(')
  + '\nfunction dispatchCandidate(candidate) {\n' + dispatchCode + '\n}\n'
  + '\nfunction confirmPending() {\n' + confirmCode + '\n}\n';

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.parentNode = null;
    this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.className = ''; this._text = '';
    this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.isConnected = true;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) names.add(name); else names.delete(name); this.className = [...names].join(' ');
      },
    };
  }
  set textContent(value) { for (const node of this.children) node.parentNode = null; this.children = []; this._text = String(value); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set innerHTML(_) { throw new Error('Fixture must never interpret native text as HTML.'); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  remove() { if (this.parentNode) { const rows = this.parentNode.children; rows.splice(rows.indexOf(this), 1); this.parentNode = null; } }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
  removeEventListener(type, callback) { const rows = this.listeners.get(type) || []; this.listeners.set(type, rows.filter(fn => fn !== callback)); }
  getRootNode() { let node = this; while (node.parentNode) node = node.parentNode; return node; }
  getClientRects() { return [{}]; }
  closest() { return null; }
}
class Document extends Element {
  constructor() {
    super('#document', null); this.ownerDocument = this; this.activeElement = null;
    this.defaultView = { getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) };
  }
  createElement(tag) { return new Element(tag, this); }
}
const descend = node => [node, ...node.children.flatMap(descend)];
const withClass = (root, cls) => descend(root).filter(node => node.classList.contains(cls));

function system(id = A, q = 0) {
  return { id, q, r: 0, name: id === A ? 'Sede sintética' : 'Colonia sintética',
    buildings: [{ type: 'shipyard', level: 1 }], fleet: [{ type: 'probe', quantity: 10 }],
    economy: { resources: { palladium: 100, iridium: 100, settledAt: new Date(START).toISOString() },
      paCap: 1000, irCap: 1000, paRatePerMin: 0, irRatePerMin: 0, energyCap: 10, energyUsed: 0,
      deficitMultiplier: 1, queueSlots: 3, queue: [] },
    shipyard: { queueSlots: 3, types: [], queue: [] } };
}
function transit() {
  return { id: TRANSIT, fromQ: 0, fromR: 0, toQ: 90, toR: 0, ships: [{ type: 'probe', quantity: 2 }],
    arrivesAt: new Date(START + 60000).toISOString(), recalledAt: null, phase: 'outbound', kind: 'combat' };
}
function harness(t, { kind = 'ship', initialize = true, dwellMs = 1000000, maxAgeMs = 120000 } = {}) {
  let clock = START, active = A, contextScope = SCOPE, selectedCount = 1, selectedOwned = true;
  let rows = [system(A, 0), system(B, 1)], transits = [transit()], account = SELF;
  let delivered = null, hudRows = clone(rows), hudTransits = clone(transits), hudOverride = null;
  let clickCallback = null, clicks = 0, navigationClicks = 0, busyMission = false, busyRetry = false;
  let failed = false, loading = false, timerId = 0, apiContext;
  const timers = new Map(), events = [], warnings = [], invalidations = [], displays = [];
  const reducer = observer.createReducer({ galaxy: 'alpha', now: () => clock });
  let generation = reducer.beginConnection();
  const document = new Document(), container = document.createElement('main'), next = document.createElement('button');
  document.append(container);
  next.click = () => { navigationClicks++; active = rows.find(row => row.id !== active)?.id || active; };
  document.querySelector = selector => selector === '[data-field="nameplate-name"]'
    ? { textContent: rows.find(row => row.id === active)?.name || '' } : null;
  document.querySelectorAll = selector => selector === '[data-field="nameplate-next"]' ? [next] : [];
  const emit = () => {
    const dto = observer.validateSnapshot(JSON.stringify(reducer.snapshot()));
    assert.ok(dto, 'Every observer emission must survive the actual content-side validator');
    delivered = dto; return dto;
  };
  const receive = (data, token = generation) => {
    const parsed = observer.parseFrame(data, reducer.snapshot().selfId);
    const accepted = reducer.ingest(data, token); emit(); return { parsed, accepted };
  };
  const initPayload = (serverNow = clock) => ({ selfId: account, serverNow, world: { players: [{ id: account, owned: clone(rows), transits: clone(transits), credits: null }] } });
  const syncHud = () => { hudRows = clone(rows); hudTransits = clone(transits); hudOverride = null; };
  function hud() {
    if (hudOverride) return clone(hudOverride);
    const row = hudRows.find(item => item.id === active); if (!row) return null;
    const parked = zeroes(), building = zeroes(), away = zeroes();
    for (const ship of row.fleet || []) parked[ship.type] = ship.quantity;
    for (const job of row.shipyard?.queue || []) if (job.kind === 'recruit') building[job.type] += job.quantityRemaining;
    // An independent minimal native-HUD fixture for the known outbound route.
    // Inventory is never read back from adapter/runtime snapshots.
    for (const trip of hudTransits) if (trip.fromQ === row.q && trip.fromR === row.r
      && !hudRows.some(owned => owned.q === trip.toQ && owned.r === trip.toR)) {
      for (const ship of trip.ships) away[ship.type] += ship.quantity;
    }
    const resources = {};
    for (const [id, prefix] of [['palladium', 'pa'], ['iridium', 'ir']]) {
      const economy = row.economy;
      resources[id] = { amount: Math.floor(Math.min(economy?.[prefix + 'Cap'], economy?.resources[id]
        + economy?.[prefix + 'RatePerMin'] * Math.max(0, clock - Date.parse(economy?.resources.settledAt)) / 60000)),
      cap: economy?.[prefix + 'Cap'], rate: economy?.[prefix + 'RatePerMin'] };
    }
    return { resources, fleet: Object.fromEntries(core.DEFAULT_SHIPS.map(id => [id, { parked: parked[id], away: away[id], building: building[id] }])),
      queue: { buildings: row.economy?.queue.length ?? null, ships: row.shipyard?.queue.length ?? null },
      energy: row.economy ? row.economy.energyCap - row.economy.energyUsed : null };
  }
  const adapter = adapterModule.create({ getWorld: () => delivered,
    getContext: () => ({ scope: contextScope, systemId: active, selectionCount: selectedCount, owned: selectedOwned, settled: !loading }),
    getHudSnapshot: hud, document, now: () => clock, maxAgeMs, settleMs: 20, pollMs: 10,
    getObservationStatus: () => ({ installed: true, observed: true, connected: delivered?.connected, reason: delivered?.reason }),
    canNavigate: () => apiContext?.canNavigateEmpire() === true,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: clock + delay }); return id; },
    clearTimeout: id => timers.delete(id) });
  let saved = core.normalizeConfig({ enabled: true, fleetTargets: { probe: 40 } });
  const controller = runtime.create({ core, adapter, now: () => clock, dwellMs, maxAgeMs,
    read: () => clone(saved), write: (_key, value) => { saved = clone(value); } });
  const instrumented = { ...controller, invalidate(id, token) { invalidations.push({ id, at: clock, token }); return controller.invalidate(id, token); } };
  const button = document.createElement('button');
  button.classList.contains = cls => cls === 'b-loading' ? loading : cls === 'b-upgrade-error' ? failed : false;
  button.click = () => { clicks++; clickCallback?.(); };
  apiContext = { empireController: instrumented, empireAdapter: adapter, document,
    OldLightEmpireBridge: { snapshot: () => delivered },
    Date: { now: () => clock }, settings: { enabled: true, creditProtection: { probe: false, marauder: false, sentinel: false, vanguard: false } }, pending: null, now: clock, activeSystem: active,
    nextClickAt: 0, lastClick: '', error: '', unconfirmed: 0, eventSequence: 0, notificationSession: 'synthetic-pipeline',
    MIN_GAP_MS: 1000, RETRY_GAP_MS: 5000, MAX_UNCONFIRMED: 3, RESPONSE_TIMEOUT_MS: 30000,
    current: [], ships: [], systemId: () => active, text: node => node?.textContent || '',
    queueLength: () => hud()?.queue.buildings ?? 0, batchSummary: () => null, batchApplied: () => null,
    fleetCounts: id => hud()?.fleet[id], fleetTotal: value => value.parked + value.away + value.building,
    shipBatches: id => hudRows.find(row => row.id === active)?.shipyard?.queue.filter(job => job.kind === 'recruit' && job.type === id).map(job => job.quantityRemaining) || [],
    shipAcceptedQuantity: request => request.quantity,
    show: value => displays.push(value), wakeAt() {}, emitEvent: (...args) => events.push(args), saveSettings() {}, releaseLeadership() {},
    console: { warn: (...args) => warnings.push(args) },
    missionContext: () => ({ scope: contextScope, originId: active, selectionCount: selectedCount }), hudPanelAvailable: () => true,
    leader: true, importingBackup: false, reports: { isRecovering: () => false }, hudBlocked: () => false,
    missionAdapter: { isBusy: () => busyMission }, attackRetry: { isBusy: () => busyRetry },
    host: null, PANEL: '#structures', FLEET_PANEL: '#shipyard' };
  vm.createContext(apiContext); vm.runInContext(code, apiContext);
  const panel = panelModule.create({ document, core, now: () => clock,
    getState: () => controller.state(), setConfig: value => controller.setConfig(value), canEnable: () => adapter.isAvailable() });
  const tick = () => {
    const state = controller.update({ scope: contextScope, enabled: apiContext.settings.enabled,
      blocked: apiContext.canNavigateEmpire() ? '' : 'Esperando a que termine la operación o edición actual.' });
    panel.render(); return state;
  };
  emit();
  if (initialize) { receive(frame('world.init', initPayload())); syncHud(); }
  tick(); panel.mount(container);
  t.after(() => { panel.destroy(); adapter.dispose(); });
  return {
    reducer, adapter, controller, panel, container, document, ctx: apiContext, events, warnings, invalidations, displays, receive, initPayload, syncHud, hud, tick,
    get rows() { return rows; }, set rows(value) { rows = value; }, get transits() { return transits; }, set transits(value) { transits = value; },
    get clock() { return clock; }, get generation() { return generation; }, get delivered() { return clone(delivered); }, set delivered(value) { delivered = value; },
    get clicks() { return clicks; }, get navigationClicks() { return navigationClicks; },
    get active() { return active; }, set active(value) { active = value; },
    get scope() { return contextScope; }, set scope(value) { contextScope = value; }, set account(value) { account = value; },
    set selectionCount(value) { selectedCount = value; }, set selectedOwned(value) { selectedOwned = value; },
    set hudOverride(value) { hudOverride = value; }, set onClick(value) { clickCallback = value; },
    set busyMission(value) { busyMission = value; }, set busyRetry(value) { busyRetry = value; },
    set loading(value) { loading = value; }, set failed(value) { failed = value; },
    get paragraphs() { return descend(container).filter(node => node.tagName === 'P').map(node => node.textContent); },
    get cards() { return withClass(container, 'empire-card'); },
    get statusNode() { return withClass(container, 'empire-status')[0]; },
    advance(ms = 5) { clock += ms; apiContext.now = clock; },
    async flushNavigation() {
      for (let i = 0; i < 20 && controller.isBusy(); i++) {
        clock += 10; apiContext.now = clock;
        for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
        await Promise.resolve(); await Promise.resolve();
      }
    },
    beginConnection() { generation = reducer.beginConnection(); emit(); return generation; },
    loseConnection(token = generation) { const result = reducer.loseConnection(token); emit(); return result; },
    publishInit({ synchronizeHud = true, serverNow = clock } = {}) { const result = receive(frame('world.init', initPayload(serverNow))); if (synchronizeHud) syncHud(); return result; },
    publishDelta({ synchronizeHud = true, payload } = {}) {
      const result = receive(frame('world.delta', payload || { updated: { players: [{ id: account, owned: clone(rows), transits: clone(transits) }] } }));
      if (synchronizeHud) syncHud(); return result;
    },
    queueOrder() {
      const row = rows.find(item => item.id === A), stamp = new Date(clock).toISOString();
      if (kind === 'ship') row.shipyard.queue = [{ id: JOB, type: 'probe', kind: 'recruit', quantityTotal: 3, quantityRemaining: 3,
        startedAt: stamp, nextCompletesAt: new Date(clock + 30000).toISOString() }];
      else row.economy.queue = [{ id: JOB, type: 'reactor', targetLevel: 2, startedAt: stamp, completesAt: new Date(clock + 30000).toISOString() }];
      row.economy.resources.palladium = 90;
    },
    dispatch() {
      apiContext.now = clock; apiContext.activeSystem = active;
      const counts = hud()?.fleet.probe;
      const candidate = { id: kind === 'ship' ? 'probe' : 'reactor', name: kind === 'ship' ? 'Probe' : 'Reactor', kind,
        quantity: 3, system: active, fleetTotal: counts ? counts.parked + counts.away + counts.building : null,
        building: counts?.building ?? null, batches: apiContext.shipBatches('probe'), target: kind === 'ship' ? '×3' : 'Nivel 2', targetLevel: 2, button };
      apiContext.current = kind === 'ship' ? [] : [candidate]; apiContext.ships = kind === 'ship' ? [candidate] : [];
      apiContext.dispatchCandidate(candidate);
    },
    confirm() { apiContext.now = clock; apiContext.confirmPending(); },
  };
}

// These assertions run in the existing temporal cases; they do not create
// extra test counts. Verified stock is independent of permission to dispatch.
function assertFleetFeedback(h, state) {
  const cfg = core.normalizeConfig(state.config);
  const data = core.aggregate(state.snapshots, { scope: state.scope, now: h.clock, maxAgeMs: state.maxAgeMs,
    expectedIds: (state.roster?.systems || []).map(row => row.id), transitCensus: state.transitCensus });
  const statuses = withClass(h.container, 'empire-goal-status');
  assert.equal(statuses.length, 4, 'Every ship must have current goal feedback');
  const format = value => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);
  for (const [index, id] of core.DEFAULT_SHIPS.entries()) {
    const expected = data.complete && data.fleetComplete
      ? `${format(data.totals.fleet[id].total)} en el imperio · objetivo ${format(cfg.fleetTargets[id])} · faltan ${format(Math.max(0, cfg.fleetTargets[id] - data.totals.fleet[id].total))}`
      : 'Total y faltantes sin verificar: falta un censo actual y completo.';
    assert.equal(statuses[index].textContent, expected, id);
  }
  assert.equal(h.statusNode.textContent, state.status, 'Stock feedback must preserve the runtime status');
  if (cfg.enabled && !(data.complete && data.fleetComplete)) {
    assert.ok(h.paragraphs.includes('Producción imperial sin calcular: falta un censo actual y completo.'));
    assert.ok(withClass(h.container, 'empire-progress').every(node => !node.textContent.includes('Reparto propuesto')));
  }
}

function assertBlocked(h, { censusIncomplete = false } = {}) {
  const state = h.tick();
  assertFleetFeedback(h, state);
  assert.equal(state.ready, false);
  assert.equal(h.controller.canAct(h.adapter.readActive()?.context), false);
  assert.ok(h.statusNode.classList.contains('empire-warning'), 'Panel must expose the runtime refusal');
  assert.doesNotMatch(h.statusNode.textContent, /^Imperio activo:/);
  if (censusIncomplete) assert.ok(h.paragraphs.some(text => text.includes('información incompleta')));
  return state;
}
function assertReady(h, expectedCount = 2) {
  const state = h.tick();
  assertFleetFeedback(h, state);
  assert.equal(state.ready, true, state.status);
  assert.equal(state.snapshots.length, expectedCount);
  assert.equal(h.controller.canAct(h.adapter.readActive()?.context), true);
  assert.equal(h.statusNode.classList.contains('empire-warning'), false);
  assert.ok(h.paragraphs.includes(`${expectedCount} de ${expectedCount} sistemas con datos recientes`));
  return state;
}

// The cases below supplement focused token/dispatch unit tests with real
// cross-layer source ordering, timestamp, ownership and panel invariants.
test('pipeline: complete init and delta count own transit once and render exact production', t => {
  const h = harness(t);
  const initial = assertReady(h); assert.equal(initial.plan.summary.totals.fleet.probe.total, 22);
  assert.equal(initial.transitCensus.ships.probe, 2);
  assert.equal(h.delivered.epoch, 1); assert.equal(h.delivered.revision, 0);
  h.advance(); h.queueOrder(); const result = h.publishDelta();
  assert.equal(result.parsed.kind, 'delta'); assert.equal(result.accepted, true);
  const state = assertReady(h);
  assert.equal(state.plan.summary.totals.fleet.probe.total, 25);
  assert.equal(state.snapshots.find(row => row.systemId === A).fleet.probe.building, 3);
  assert.ok(h.paragraphs.includes('Palladium 190 / 2000 · Iridium 200 / 2000'));
  assert.match(h.cards.find(node => node.dataset.systemId === A).textContent, /Probe: 10 en base · 2 en misión · 3 en cola/);
  assert.equal(h.clicks, 0); assert.equal(h.navigationClicks, 0);
});

for (const kind of ['ship', 'building']) {
  for (const ordering of ['census-before-HUD', 'HUD-before-census', 'synchronous-click']) {
    test(`pipeline ${kind}: ${ordering} preserves the first post-order census`, t => {
      const h = harness(t, { kind }); assertReady(h); h.advance();
      if (ordering === 'synchronous-click') h.onClick = () => {
        assert.ok(h.ctx.pending); assert.equal(h.controller.canAct(h.adapter.readActive()?.context), false);
        h.advance(); h.queueOrder(); h.publishDelta(); assertBlocked(h); h.confirm();
      };
      h.dispatch(); assert.equal(h.clicks, 1); assert.equal(h.warnings.length, 0);
      if (ordering === 'census-before-HUD') {
        h.advance(); h.queueOrder(); h.publishDelta({ synchronizeHud: false });
        assertBlocked(h); h.confirm(); assert.ok(h.ctx.pending, 'Native data alone cannot substitute for HUD acceptance');
        h.syncHud(); const pendingState = assertBlocked(h);
        assert.equal(pendingState.snapshots.length, 2); assert.ok(h.paragraphs.includes('2 de 2 sistemas con datos recientes'));
        h.advance(); h.confirm();
      } else if (ordering === 'HUD-before-census') {
        h.advance(); h.queueOrder(); h.syncHud(); h.confirm();
        assert.equal(h.ctx.pending, null);
        assert.equal(assertBlocked(h, { censusIncomplete: true }).status, WAITING_FOR_POST_ORDER_CENSUS);
        assert.equal(h.statusNode.textContent, WAITING_FOR_POST_ORDER_CENSUS);
        h.dispatch(); assert.equal(h.clicks, 1, 'HUD-only acknowledgement cannot dispatch another order');
        h.advance(); h.publishDelta();
      }
      assert.equal(h.ctx.pending, null);
      const acceptedRevision = h.delivered.revision, acceptedAt = h.delivered.observedAt;
      assertReady(h); assert.equal(h.invalidations.length, 1);
      for (let i = 0; i < 4; i++) { h.advance(1000); assertReady(h); }
      assert.equal(h.delivered.revision, acceptedRevision, 'Recovery must not require a second native revision');
      assert.equal(h.delivered.observedAt, acceptedAt, 'Rendering and checking must not manufacture native freshness');
      assert.equal(h.events.filter(row => row[0] === 'request.sent').length, 1);
      assert.equal(h.events.filter(row => row[0] === (kind === 'ship' ? 'ships.queued' : 'building.queued')).length, 1);
      assert.equal(h.clicks, 1);
    });
  }
}

test('pipeline: several native revisions during pending keep mission/navigation closed and resume the native route afterward', async t => {
  const h = harness(t, { dwellMs: 2000 }); h.advance(); h.dispatch();
  h.advance(100); h.publishDelta(); assertBlocked(h);
  h.advance(2100); h.queueOrder(); h.publishDelta(); assertBlocked(h);
  for (const mode of ['idle', 'mission', 'retry']) {
    h.busyMission = mode === 'mission'; h.busyRetry = mode === 'retry';
    assert.equal(h.ctx.canOperateMission(), false, `Pending production must dominate ${mode} mission permission`);
    assert.equal(h.adapter.canNavigate(), false);
    assert.equal(await h.adapter.selectSystem(B, { scope: SCOPE }), false);
  }
  h.busyMission = false; h.busyRetry = false;
  assert.equal(h.clicks, 1); assert.equal(h.navigationClicks, 0); assert.ok(h.ctx.pending);
  h.confirm(); assert.equal(h.ctx.pending, null); h.tick(); await h.flushNavigation();
  assert.equal(h.active, B); assert.equal(h.navigationClicks, 1); assertReady(h);
  assert.equal(h.ctx.canOperateMission(), true); assert.equal(h.clicks, 1);
});

test('pipeline: same-millisecond delta and unrelated frames cannot cross the captured time boundary', t => {
  const h = harness(t); h.advance(); h.dispatch(); h.queueOrder(); h.publishDelta(); h.confirm();
  assert.equal(h.ctx.pending, null); const native = h.delivered;
  assert.equal(assertBlocked(h, { censusIncomplete: true }).status, WAITING_FOR_POST_ORDER_CENSUS);
  h.advance(1000);
  for (const ignored of ['2', '3', '42["chat",{"message":"synthetic"}]', '42["session.token",{"token":"SYNTHETIC_NOT_A_CREDENTIAL"}]']) {
    const result = h.receive(ignored); assert.equal(result.parsed.kind, 'ignore'); assert.equal(result.accepted, false);
  }
  assert.deepEqual(h.delivered, native); assertBlocked(h, { censusIncomplete: true });
  h.publishDelta(); assertReady(h); assert.equal(h.clicks, 1);
});

for (const missing of ['fleet', 'economy', 'shipyard', 'transits']) test(`pipeline: missing ${missing} cannot authorize or show ready, and a complete census recovers`, t => {
  const h = harness(t, { initialize: false });
  const payload = h.initPayload();
  if (missing === 'transits') delete payload.world.players[0].transits;
  else delete payload.world.players[0].owned[0][missing];
  const result = h.receive(frame('world.init', payload));
  assert.equal(result.parsed.kind, 'init'); assert.equal(h.delivered.complete, false);
  assertBlocked(h); h.dispatch(); assert.equal(h.clicks, 0);
  assert.equal(h.cards.length, 0, 'Incomplete initial ownership cannot populate ready inventory cards');
  h.advance(); h.publishInit(); assertReady(h); assert.equal(h.clicks, 0);
});

test('pipeline: malformed recognized frame revokes a ready panel and requires valid init, not a delta', t => {
  const h = harness(t); assertReady(h); h.advance();
  const result = h.receive('42["world.delta",{"updated":');
  assert.equal(result.parsed.kind, 'invalid'); assert.equal(h.delivered.reason, 'malformed');
  assert.notEqual(assertBlocked(h).status, WAITING_FOR_POST_ORDER_CENSUS);
  h.dispatch(); assert.equal(h.clicks, 0);
  h.advance(); h.publishDelta(); assert.equal(h.delivered.reason, 'missing-init'); assertBlocked(h);
  h.advance(); h.publishInit(); assertReady(h);
});

test('pipeline: reconnect ignores late old-generation frames and HUD ACK waits for the new complete init', t => {
  const h = harness(t); h.advance(); h.dispatch(); const oldGeneration = h.generation;
  h.advance(); h.loseConnection(); assertBlocked(h);
  h.queueOrder(); h.syncHud(); h.confirm(); assert.equal(h.ctx.pending, null); assertBlocked(h);
  const newGeneration = h.beginConnection(); assert.notEqual(newGeneration, oldGeneration);
  const old = h.receive(frame('world.init', h.initPayload()), oldGeneration); assert.equal(old.accepted, false); assertBlocked(h);
  h.advance(); h.publishDelta(); assert.equal(h.delivered.reason, 'missing-init'); assertBlocked(h);
  h.advance(); h.publishInit(); assertReady(h);
  const latest = h.delivered; assert.equal(h.loseConnection(oldGeneration), false); assert.deepEqual(h.delivered, latest);
  assert.equal(h.receive(frame('world.delta', { removed: { playerIds: [SELF] } }), oldGeneration).accepted, false);
  assertReady(h); assert.equal(h.clicks, 1);
});

test('pipeline: account/scope change cannot reuse pending ownership, and returning requires current account evidence', t => {
  const h = harness(t); h.advance(); h.dispatch(); h.advance();
  h.beginConnection(); h.account = OTHER; h.scope = `alpha/${OTHER}`; h.rows = [system(C, 2)]; h.transits = []; h.active = C;
  h.publishInit(); const state = assertBlocked(h); assert.equal(state.scope, `alpha/${OTHER}`);
  assert.deepEqual(state.snapshots.map(row => row.systemId), [C]);
  assert.deepEqual(h.cards.map(card => card.dataset.systemId), [C]);
  h.confirm(); assert.ok(h.ctx.pending); assert.equal(h.ctx.pending.system, A);
  assert.equal(h.ctx.canOperateMission(), false); h.dispatch(); assert.equal(h.clicks, 1);
  h.beginConnection(); h.account = SELF; h.scope = SCOPE; h.rows = [system(A, 0), system(B, 1)]; h.transits = [transit()]; h.active = A;
  h.advance(); h.queueOrder(); h.publishInit(); assertBlocked(h); h.confirm(); assert.equal(h.ctx.pending, null);
  assertBlocked(h, { censusIncomplete: true });
  h.advance(); h.publishDelta(); assertReady(h); assert.equal(h.clicks, 1);
});

test('pipeline: a native ownership capture removes the old card and cannot confirm pending from another origin', t => {
  const h = harness(t); h.advance(); h.dispatch(); h.advance();
  h.rows = h.rows.filter(row => row.id !== A);
  h.publishDelta({ payload: { updated: { players: [{ id: OTHER, owned: [{ q: 0, r: 0 }] }] } } });
  const state = assertBlocked(h);
  assert.deepEqual(state.roster.systems.map(row => row.id), [B]); assert.deepEqual(h.cards.map(card => card.dataset.systemId), [B]);
  assert.equal(h.adapter.readActive().context.owned, false);
  h.active = B; h.confirm(); assert.ok(h.ctx.pending); assert.equal(h.ctx.pending.system, A);
  h.advance(30001); h.confirm(); assert.equal(h.ctx.pending, null); assert.equal(h.ctx.settings.enabled, false);
  assertBlocked(h); assert.equal(h.clicks, 1); assert.equal(h.events.filter(row => row[0] === 'ships.queued').length, 0);
  h.ctx.settings.enabled = true; h.advance(); h.publishDelta(); assertReady(h, 1); assert.equal(h.clicks, 1);
});

test('pipeline: duplicate native deltas replace inventory instead of double counting, while duplicate DTO delivery never refreshes age', t => {
  const h = harness(t, { maxAgeMs: 15000 }); h.advance(); h.dispatch(); h.advance(); h.queueOrder();
  const data = frame('world.delta', { updated: { players: [{ id: SELF, owned: clone(h.rows), transits: [transit(), transit()] }] } });
  h.receive(data); h.syncHud(); h.confirm(); let state = assertReady(h);
  assert.equal(state.plan.summary.totals.fleet.probe.total, 25); assert.equal(state.transitCensus.ships.probe, 2);
  h.advance(); h.receive(data); state = assertReady(h);
  assert.equal(state.plan.summary.totals.fleet.probe.total, 25); assert.equal(state.snapshots.find(row => row.systemId === A).queue.ships, 1);
  const snapshot = h.delivered; const censusId = state.transitCensus.censusId;
  h.advance(15000); h.delivered = observer.validateSnapshot(JSON.stringify(snapshot)); assertReady(h);
  h.advance(1); h.delivered = observer.validateSnapshot(JSON.stringify(snapshot)); assertBlocked(h);
  assert.equal(h.delivered.observedAt, snapshot.observedAt); assert.equal(snapshot.revision, h.delivered.revision);
  h.advance(); h.publishDelta(); state = assertReady(h); assert.notEqual(state.transitCensus.censusId, censusId);
  assert.equal(h.clicks, 1); assert.equal(h.events.filter(row => row[0] === 'ships.queued').length, 1);
});

test('pipeline: a late validated DTO and older native init both fail closed until a newer valid observation', t => {
  const h = harness(t); const old = h.delivered;
  h.advance(); h.queueOrder(); h.publishDelta(); assertReady(h);
  h.delivered = observer.validateSnapshot(JSON.stringify(old)); const outOfOrder = assertBlocked(h);
  assert.match(outOfOrder.status, /anterior al último observado/); h.dispatch(); assert.equal(h.clicks, 0);
  h.advance(); h.publishDelta(); assertReady(h);
  h.advance(); h.publishInit({ serverNow: START - 1 }); assert.equal(h.delivered.reason, 'malformed'); assertBlocked(h);
  h.advance(); h.publishInit(); assertReady(h); assert.equal(h.clicks, 0);
});

test('pipeline: missing/ambiguous live HUD ownership never becomes ready despite a complete native census', t => {
  const h = harness(t);
  for (const kind of ['multi', 'foreign', 'HUD-mismatch']) {
    h.selectionCount = kind === 'multi' ? 2 : 1; h.selectedOwned = kind !== 'foreign';
    if (kind === 'HUD-mismatch') { const hud = h.hud(); hud.fleet.probe.parked++; h.hudOverride = hud; }
    assert.equal(h.delivered.complete, true); assertBlocked(h); h.dispatch(); assert.equal(h.clicks, 0);
    h.hudOverride = null;
  }
  h.selectedOwned = true; h.selectionCount = 1; assertReady(h); assert.equal(h.invalidations.length, 0);
});

for (const kind of ['ship', 'building']) test(`pipeline ${kind}: loading HUD delays acknowledgement without discarding the complete native confirmation`, t => {
  const h = harness(t, { kind }); h.advance(); h.dispatch(); h.loading = true;
  h.advance(); h.queueOrder(); h.publishDelta(); assertBlocked(h); h.confirm();
  assert.ok(h.ctx.pending); assert.equal(h.invalidations.length, 0);
  const acceptedAt = h.delivered.observedAt, acceptedRevision = h.delivered.revision;
  h.advance(250); h.loading = false; assertBlocked(h); h.confirm();
  assert.equal(h.ctx.pending, null); assertReady(h);
  for (let i = 0; i < 3; i++) h.confirm();
  assert.equal(h.invalidations.length, 1); assert.equal(h.clicks, 1);
  assert.equal(h.delivered.observedAt, acceptedAt); assert.equal(h.delivered.revision, acceptedRevision);
  assert.equal(h.events.filter(row => row[0] === (kind === 'ship' ? 'ships.queued' : 'building.queued')).length, 1);
});

test('pipeline: HUD acceptance plus incomplete post-order colony data cannot restore partial authority', t => {
  const h = harness(t); h.advance(); h.dispatch(); h.advance(); h.queueOrder(); h.syncHud(); h.confirm();
  assert.equal(h.ctx.pending, null); assertBlocked(h, { censusIncomplete: true });
  const completeRows = clone(h.rows); h.rows[1].fleet = null;
  h.advance(); h.publishDelta({ synchronizeHud: false }); assert.equal(h.delivered.complete, false);
  assert.notEqual(assertBlocked(h).status, WAITING_FOR_POST_ORDER_CENSUS, 'Incomplete sources must not be disguised as a mere post-order wait');
  h.dispatch(); assert.equal(h.clicks, 1);
  h.rows = completeRows; h.advance(); h.publishDelta(); assertReady(h);
  assert.equal(h.clicks, 1); assert.equal(h.events.filter(row => row[0] === 'ships.queued').length, 1);
});

test('pipeline: resource projection and repeated panel reads preserve observation time and exact freshness cutoff', t => {
  const h = harness(t, { initialize: false, maxAgeMs: 15000 });
  h.rows[0].economy.paRatePerMin = 60; h.publishInit(); assertReady(h);
  const stamp = h.delivered.observedAt, censusId = h.controller.state().transitCensus.censusId;
  for (const elapsed of [1000, 4000, 10000]) {
    h.advance(elapsed); const state = assertReady(h);
    assert.equal(h.hud().resources.palladium.amount, 100 + (h.clock - stamp) / 1000);
    assert.equal(state.snapshots[0].observedAt, stamp); assert.equal(state.transitCensus.censusId, censusId);
    assert.equal(state.snapshots[0].resources.palladium.amount, 100, 'A live HUD projection is not a new native stock anchor');
  }
  h.advance(1); assertBlocked(h); h.dispatch(); assert.equal(h.clicks, 0);
  h.publishDelta(); const refreshed = assertReady(h);
  assert.equal(refreshed.snapshots[0].observedAt, h.clock);
  assert.equal(refreshed.snapshots[0].resources.palladium.amount, 115.001);
});

test('pipeline: immediate config edits hide retained allocations until runtime recalculates goals, roles and Atender', t => {
  for (const scenario of ['goals', 'roles', 'Atender']) {
    const h = harness(t); const initial = assertReady(h);
    assert.deepEqual(initial.plan.summary.allocationsBySystem[A].probe, 9);
    assert.deepEqual(initial.plan.summary.allocationsBySystem[B].probe, 9);
    const next = clone(initial.config);
    if (scenario === 'goals') next.fleetTargets.probe = 0;
    else if (scenario === 'roles') next.systems = { [A]: { role: 'industry' }, [B]: { role: 'defense' } };
    else next.systems = { [B]: { enabled: false, role: 'balanced' } };
    h.controller.setConfig(next);
    const edited = h.controller.state();
    assert.equal(edited.ready, false); assert.deepEqual(edited.plan, initial.plan, 'The runtime deliberately retains the old plan until update');
    assert.equal(h.controller.canAct(h.adapter.readActive()?.context), false);
    h.panel.render(); assertFleetFeedback(h, edited);
    assert.ok(withClass(h.container, 'empire-progress').every(node => !node.textContent.includes('Reparto propuesto')),
      `A retained plan must not appear alongside the new ${scenario} before update`);
    assert.equal(withClass(h.container, 'empire-goal-status')[0].textContent,
      `22 en el imperio · objetivo ${scenario === 'goals' ? 0 : 40} · faltan ${scenario === 'goals' ? 0 : 18}`);
    const refreshed = assertReady(h);
    if (scenario === 'Atender') {
      assert.equal(refreshed.plan.summary.allocationsBySystem[A].probe, 18);
      assert.equal(refreshed.plan.summary.allocationsBySystem[B], undefined);
      assert.equal(withClass(h.cards.find(node => node.dataset.systemId === A), 'empire-progress')[0].textContent, 'Reparto propuesto: Probe ×18');
    } else assert.ok(withClass(h.container, 'empire-progress').every(node => !node.textContent.includes('Reparto propuesto')));
    assert.equal(h.clicks, 0); assert.equal(h.navigationClicks, 0);
  }
});

// Real native reducer/validator -> bridge -> shipped final credit guard -> native click.
test('pipeline: protected credit production blocks unknown and negative projection then permits verified zero balance', t => {
  const h = harness(t); assertReady(h); h.ctx.settings.creditProtection.probe = true;
  h.dispatch(); assert.equal(h.clicks, 0); assert.equal(h.ctx.pending, null);
  assert.ok(h.displays.some(message => message.includes('créditos')));
  for (const row of h.rows) row.shipyard.types = [{ type: 'probe', unlocked: true, shipyardLevelRequired: 1, stats: { upkeepPerDay: 12 } }];
  function publish(incomePerDay) {
    h.advance(); h.publishDelta({ payload: { updated: { players: [{ id: SELF, owned: clone(h.rows), credits: {
      amount: 19500, settledAt: new Date(h.clock).toISOString(), incomePerDay, upkeepPerDay: 0, inDeficit: false,
    } }] } } }); assertReady(h);
  }
  publish(35); h.dispatch(); assert.equal(h.clicks, 0); assert.equal(h.ctx.pending, null);
  publish(36); h.dispatch(); assert.equal(h.clicks, 1); assert.equal(h.ctx.pending.quantity, 3);
});
