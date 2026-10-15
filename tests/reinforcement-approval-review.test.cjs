'use strict';
// Independent, offline review of transient ally census failures. These are
// deterministic DOM doubles, never a live browser, network, or game session.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../docs/reinforcement-core.js');
const source = fs.readFileSync(process.env.QA_REINFORCEMENT_ADAPTER_SOURCE || path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
const block = name => {
  const start = source.indexOf('// BEGIN ' + name), end = source.indexOf('// END ' + name, start);
  assert.ok(start >= 0 && end > start, 'production source block ' + name);
  return source.slice(start, end);
};
const SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALLY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RIVAL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORIGIN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DESTINATION = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SCOPE = 'alpha/' + SELF;
const clone = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const globalListeners = new Map();
  const window = {
    addEventListener(type, fn) { if (!globalListeners.has(type)) globalListeners.set(type, []); globalListeners.get(type).push(fn); },
    removeEventListener(type, fn) { globalListeners.set(type, (globalListeners.get(type) || []).filter(item => item !== fn)); },
  };
  class Event {
    constructor(type, options = {}) { Object.assign(this, options); this.type = type; this.isTrusted = false; }
    preventDefault() { this.prevented = true; }
    stopImmediatePropagation() { this.stopped = true; }
  }
  class Element {
    constructor() { this.attributes = new Map(); this.listeners = new Map(); this.dataset = {}; this.hidden = false; this.isConnected = true; this.textContent = ''; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn)); }
    dispatchEvent(event) { event.target = this; for (const fn of this.listeners.get(event.type) || []) { fn(event); if (event.stopped) break; } return !event.prevented; }
    remove() { this.isConnected = false; }
    closest() { return null; }
    matches() { return false; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    focus() {}
  }
  class Button extends Element {
    constructor(text, action = () => {}) { super(); this.textContent = text; this.disabled = false; this.action = action; }
    click() {
      const event = new Event('click'); event.target = this;
      for (const fn of [...globalListeners.get('click') || []]) { fn(event); if (event.stopped) break; }
      if (!event.stopped) this.action();
    }
  }
  class Dialog extends Element {
    get open() { return this.attributes.has('open'); }
    close() { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); }
  }
  class Input extends Element {
    constructor(type) { super(); this.type = 'number'; this.min = '0'; this.max = '100'; this.value = '0'; this.disabled = false; this.setAttribute('aria-label', 'Number of ' + type + ' to send'); }
    matches(selector) { return selector === ':disabled' && this.disabled; }
  }
  const h = { at: 1000000, scope: SCOPE, prepares: 0, resolves: 0, sends: 0, guardCalls: [], store: new Map(), storageFailure: false, canAct: () => true };
  h.world = { version: 1, scope: SCOPE, selfId: SELF, connected: true, observedAt: h.at, epoch: 1, generation: 1, revision: 0,
    ownership: { version: 1, complete: false, players: [
      { id: SELF, name: 'Self', owned: [{ q: 0, r: 0 }, { q: 2, r: 3 }] },
      { id: ALLY, name: 'Protected', owned: [{ q: 7, r: 8 }] },
      { id: RIVAL, name: 'Rival', owned: [] },
    ] } };
  h.context = () => ({ scope: h.scope, originId: ORIGIN, originName: 'Origin', selectionCount: 1, canAct: true, coordinated: true, active: true });
  const inspector = new Dialog(), dialog = new Dialog(), error = new Element();
  const body = { firstChild: {} }; error.hidden = true;
  dialog.dataset = { mode: 'dispatch', direction: 'forward' };
  let isOrigin = false, route;
  const inspect = origin => { isOrigin = origin; body.firstChild = {}; inspector.dataset.contentType = 'inspect'; };
  const sourceButton = new Button('Origin', () => inspect(true));
  const targetButton = new Button('Destination', () => inspect(false));
  const columns = [sourceButton, targetButton].map((button, index) => ({ innerHTML: 'route-' + index,
    querySelector: selector => selector.includes('route-header-hex-clickable') ? button
      : selector === '.route-header-tile-name' ? { textContent: index ? 'Destination' : 'Origin' } : null }));
  const newRoute = () => ({ isConnected: true, querySelectorAll: selector => selector === ':scope > .route-header-tile-col' ? columns : [] });
  route = newRoute();
  const action = new Button('Send fleet', () => { h.prepares++; dialog.setAttribute('open', ''); route = newRoute(); options.prepare?.(h); });
  const coord = new Element(); coord.getAttribute = () => isOrigin ? 'Copy coordinates 0, 0' : 'Copy coordinates 2, 3';
  inspector.matches = selector => selector === '.info-modal[data-content-type="inspect"]';
  inspector.querySelector = selector => selector === '.inspect-copy-coord' ? coord
    : selector === '.info-modal-body' ? body
    : selector === '.info-modal-trailing .info-modal-header-btn' ? (isOrigin ? null : new Button('Jump to'))
    : selector === '.inspect-actions > button.inspect-action-btn' ? action
    : selector === '.inspect-system-name-text' ? { textContent: isOrigin ? 'Origin' : 'Destination' } : null;
  const inputs = core.SHIPS.map(type => new Input(type));
  for (const input of inputs) input.addEventListener('input', () => options.input?.(h));
  const confirm = new Button('Send', () => { h.sends++; if (options.accept) options.accept(h, dialog, error); else dialog.close(); });
  window.addEventListener('click', event => { if (event.target === confirm) options.click?.(h); });
  dialog.querySelector = selector => selector === '[data-field="dispatch-route-slot"] .route-header' ? route
    : selector === '[data-field="dispatch-confirm"]' ? confirm : selector === '[data-field="dispatch-error"]' ? error : null;
  dialog.querySelectorAll = selector => selector === '[data-field="dispatch-quantities"] input.dispatch-step-input' ? inputs : [];
  const document = { head: { append() {} }, activeElement: null, createElement: () => new Element(),
    querySelectorAll: selector => selector === '#dispatch-dialog' ? [dialog] : selector === 'dialog.info-modal' ? [inspector]
      : selector === 'dialog[open]' ? [dialog, inspector].filter(item => item.open) : [],
    querySelector: selector => selector === 'dialog[open]' ? [dialog, inspector].find(item => item.open) || null : null };
  const storage = { getItem: key => { if (h.storageFailure) throw new Error('storage unavailable'); return h.store.get(key) ?? null; },
    setItem: (key, value) => h.store.set(key, value) };
  h.realm = vm.createContext({ window, document, HTMLElement: Element, HTMLDialogElement: Dialog, HTMLButtonElement: Button,
    HTMLInputElement: Input, Event, AbortController, performance, Date, TextEncoder, structuredClone, setTimeout, clearTimeout, localStorage: storage });
  vm.runInContext(block('ALLY PROTECTION') + '\n' + block('NATIVE MISSION ADAPTER') + '\n' + block('FLEET WAIT QUEUE')
    + '\nthis.guardFactory=createAllyProtection;this.adapterFactory=createNativeMissionAdapter;this.queueFactory=createFleetWaitQueue;', h.realm);
  h.guard = h.realm.guardFactory({ getContext: h.context, getWorld: () => h.world, storage, now: () => h.at });
  h.guard.add({ id: ALLY, name: 'Protected' });
  h.adapter = h.realm.adapterFactory({ getContext: h.context, getFleet: () => ({ parked: 100, away: 0, building: 0 }),
    canAct: job => h.canAct(job), resolveTarget: async () => { h.resolves++; options.resolve?.(h); return { inspector, cleanup() {} }; },
    checkTarget: (job, previous) => { h.guardCalls.push(previous && clone(previous)); return options.check ? options.check(h, job, previous) : h.guard.check(job, previous); } });
  h.job = { id: 'route:north:1', scope: SCOPE, originId: ORIGIN, originName: 'Origin',
    target: { coordinate: { q: 2, r: 3 }, label: 'Destination', routeKey: '', presetKey: 'refuerzo', mode: 'custom', missionAction: 'send' },
    quantities: { probe: 3, marauder: 0, sentinel: 0, vanguard: 0 }, claimedAt: h.at };
  h.changeOwner = id => { for (const player of h.world.ownership.players) player.owned = player.owned.filter(point => point.q !== 2 || point.r !== 3);
    h.world.ownership.players.find(player => player.id === id)?.owned.push({ q: 2, r: 3 }); h.world.revision++; };
  h.destroy = () => h.adapter.destroy();
  return h;
}

const unavailable = {
  missing: h => { h.world = null; },
  stale: h => { h.world.observedAt = h.at - 120001; },
  disconnected: h => { h.world.connected = false; },
  unknown: h => h.changeOwner('unlisted'),
};

for (const [name, mutate] of Object.entries(unavailable)) test('independent route review: initial ' + name + ' census waits without native preparation', async () => {
  const h = harness();
  try {
    mutate(h);
    const outcome = await h.adapter.dispatch(h.job);
    assert.equal(outcome.status, 'waiting', JSON.stringify(outcome));
    assert.match(outcome.message, /esper|propiedad|propietario/i);
    assert.equal(h.resolves, 0); assert.equal(h.prepares, 0); assert.equal(h.sends, 0);
    assert.deepEqual(h.guardCalls, [null]);
  } finally { h.destroy(); }
});

for (const id of ['ordinary', 'retry:campaign:1', 'not-route:north:1', 'Route:north:1']) test('independent route review: temporary census failure still pauses non-route ID ' + id, async () => {
  const h = harness();
  try { h.world = null; h.job.id = id; assert.equal((await h.adapter.dispatch(h.job)).status, 'paused'); assert.equal(h.resolves, 0); }
  finally { h.destroy(); }
});

for (const [name, mutate] of [
  ['protected', h => h.changeOwner(ALLY)],
  ['storage', h => { h.storageFailure = true; }],
  ['wrong scope', h => { h.job.scope = 'beta/' + SELF; }],
  ['unresolved alias', h => { h.guard.add({ name: 'Unresolved friend' }); }],
]) test('independent route review: material ' + name + ' failure still pauses', async () => {
  const h = harness();
  try { mutate(h); assert.equal((await h.adapter.dispatch(h.job)).status, 'paused'); assert.equal(h.resolves, 0); assert.equal(h.sends, 0); }
  finally { h.destroy(); }
});

test('independent route review: thrown guard error cannot impersonate a retryable returned denial', async () => {
  const h = harness({ check() { throw Object.assign(new Error('guard exploded'), { code: 'ownership' }); } });
  try { assert.equal((await h.adapter.dispatch(h.job)).status, 'paused'); assert.equal(h.resolves, 0); }
  finally { h.destroy(); }
});

for (const phase of ['resolve', 'prepare', 'input', 'click']) test('independent route review: census loss after initial approval at ' + phase + ' still pauses', async () => {
  const h = harness({ [phase]: fixture => { fixture.world = null; } });
  try {
    assert.equal((await h.adapter.dispatch(h.job)).status, 'paused'); assert.equal(h.sends, 0);
    assert.ok(h.guardCalls.length >= 2);
    assert.equal(h.guardCalls[0], null);
    assert.ok(h.guardCalls.slice(1).every(token => token?.ownerId === SELF && token.epoch === 1 && token.generation === 1), 'original approval token is carried to every later check');
  } finally { h.destroy(); }
});

for (const change of ['owner', 'epoch', 'generation']) test('independent route review: changed ' + change + ' after approval cannot silently acquire a new token', async () => {
  const h = harness({ resolve(fixture) { if (change === 'owner') fixture.changeOwner(RIVAL); else fixture.world[change]++; } });
  try {
    const outcome = await h.adapter.dispatch(h.job);
    assert.equal(outcome.status, 'paused'); assert.match(outcome.message, /propiedad|sesión/i); assert.equal(h.sends, 0);
    assert.equal(h.guardCalls[1].ownerId, SELF); assert.equal(h.guardCalls[1].epoch, 1); assert.equal(h.guardCalls[1].generation, 1);
  } finally { h.destroy(); }
});

for (const uncertain of [false, true]) test('independent route review: an already-clicked ' + (uncertain ? 'unconfirmed' : 'accepted') + ' claim stays uncertain even with missing ownership', async () => {
  const h = harness(uncertain ? { accept(fixture, dialog, error) { error.hidden = false; error.textContent = 'Confirmation unavailable'; } } : {});
  try {
    assert.equal((await h.adapter.dispatch(h.job)).status, uncertain ? 'uncertain' : 'sent'); assert.equal(h.sends, 1);
    h.world = null;
    assert.equal((await h.adapter.dispatch(h.job)).status, 'uncertain', 'the replay guard takes priority over retryable census failure');
    assert.equal(h.sends, 1); assert.equal(h.prepares, 1);
  } finally { h.destroy(); }
});

test('independent route review: real route, queue, and adapter keep one waiting ticket until census returns', async () => {
  const h = harness(); let queueStore = {}, routeStore;
  const routeWorld = { scope: SCOPE, galaxy: 'alpha', selfId: SELF, connected: true, complete: true, observedAt: h.at,
    systems: [{ id: ORIGIN, q: 0, r: 0, name: 'Origin', fleet: [{ type: 'probe', quantity: 100 }] },
      { id: DESTINATION, q: 2, r: 3, name: 'Destination', fleet: [] }], transits: [] };
  const queue = h.realm.queueFactory({ load: () => clone(queueStore), save: value => { queueStore = clone(value); }, now: () => h.at,
    getContext: h.context, getRouteState: job => engine.jobState(job),
    getFleet: () => new Map(core.SHIPS.map(type => [type, { parked: type === 'probe' ? 100 : 0, away: 0, building: 0 }])),
    dispatch: job => h.adapter.dispatch(job) });
  const engine = core.create({ read: () => routeStore, write: (_, value) => { routeStore = clone(value); }, now: () => h.at,
    getContext: h.context, getWorld: () => routeWorld, getJobs: () => queue.list(), queue: (spec, options) => queue.queue(spec, options), cancel: id => queue.cancel(id) });
  h.canAct = job => engine.canRunJob(job);
  try {
    engine.save({ id: 'north', originId: ORIGIN, destinationId: DESTINATION, intervalMinutes: 1,
      ships: { probe: { mode: 'fixed', amount: 3 } }, paused: false });
    assert.equal(engine.tick().queued.length, 1);
    const ticket = clone(engine.list()[0].ticket), world = h.world; h.world = null;
    await queue.tick(); engine.tick();
    assert.equal(queue.list()[0].status, 'waiting'); assert.equal(queue.list()[0].needsReview, false);
    assert.equal(engine.list()[0].needsReview, false); assert.equal(engine.list()[0].paused, false);
    assert.deepEqual(clone(engine.list()[0].ticket), ticket); assert.equal(engine.list()[0].sequence, 1);
    const firstClaim = queue.list()[0].claimedAt;
    await queue.tick(); assert.equal(queue.list()[0].claimedAt, firstClaim, 'ordinary retry throttle survives');
    h.at += 1000; routeWorld.observedAt = h.at; await queue.tick(); engine.tick();
    assert.equal(queue.list().length, 1); assert.equal(engine.list()[0].ticket.id, ticket.id); assert.equal(h.prepares, 0);
    h.world = world; h.world.observedAt = h.at; h.at += 1000; routeWorld.observedAt = h.at;
    await queue.tick(); assert.equal(queue.list()[0].status, 'sent'); assert.equal(h.sends, 1);
    engine.tick(); assert.equal(engine.list()[0].needsReview, false); assert.equal(engine.list()[0].ticket, null);
    assert.equal(engine.list()[0].nextRunAt, h.at + 60000);
    await queue.tick(); engine.tick(); assert.equal(h.sends, 1, 'no immediate replay after recovery');
  } finally { h.destroy(); queue.destroy(); }
});
