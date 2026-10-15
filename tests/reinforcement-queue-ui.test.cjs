'use strict';
// Mounted production queue UI with the real reinforcement owner, entirely
// offline. No game APIs, browser session, Drive, or network are simulated.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../docs/reinforcement-core.js');
const source = fs.readFileSync(process.env.QA_REINFORCEMENT_QUEUE_SOURCE || path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
const start = source.indexOf('// BEGIN FLEET WAIT QUEUE'), end = source.indexOf('// END FLEET WAIT QUEUE', start);
assert.ok(start >= 0 && end > start);
const realm = vm.createContext({ TextEncoder, Date, structuredClone, JSON });
vm.runInContext(source.slice(start, end) + '\nthis.factory=createFleetWaitQueue;', realm);
const copy = value => JSON.parse(JSON.stringify(value));
const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002';
const P = 'dddddddd-0000-4000-8000-000000000004', scope = 'galaxy/' + P;
const all = node => [node, ...node.children.flatMap(all)];
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.parentNode = null; this.dataset = {}; this.attributes = {}; this.listeners = new Map();
    this.className = ''; this._text = ''; this.hidden = false; this.disabled = false;
  }
  set textContent(text) { this.replaceChildren(); this._text = String(text); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(' '); }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this._text = ''; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getRootNode() { return this.ownerDocument; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  click() { assert.equal(this.disabled, false); for (const fn of this.listeners.get('click') || []) fn({ target: this }); }
}
function harness() {
  let now = 1000000, stored = {}, routeStore, queue, engine, selected = A, dispatches = 0, canAct = true;
  const document = { activeElement: null, createElement(tag) { return new Element(tag, this); } };
  const container = document.createElement('main');
  const context = () => ({ scope, originId: selected, canAct, coordinated: true, active: canAct });
  const world = { scope, galaxy: 'galaxy', selfId: P, connected: true, complete: true, observedAt: now,
    systems: [{ id: A, q: 0, r: 0, name: 'Home', fleet: core.SHIPS.map(type => ({ type, quantity: type === 'probe' ? 100 : 0 })) },
      { id: B, q: 5, r: 0, name: 'Destination', fleet: [] }], transits: [] };
  queue = realm.factory({ load: () => copy(stored), save: value => { stored = copy(value); }, now: () => now,
    getContext: context, getRouteState: job => engine?.jobState(job),
    getFleet: () => new Map(core.SHIPS.map(type => [type, { parked: type === 'probe' ? 100 : 0, away: 0, building: 0 }])),
    openFleetEditor: id => queue.beginFleetEdit(id),
    dispatch: async job => { if (!engine.canRunJob(job)) return { status: 'waiting' }; dispatches++; return { status: 'sent' }; } });
  engine = core.create({ read: () => routeStore, write: (_scope, value) => { routeStore = copy(value); },
    getContext: context, getWorld: () => world, getJobs: () => queue.list(), queue: (s, o) => queue.queue(s, o),
    cancel: id => queue.cancel(id), now: () => now, onChange: () => queue.refreshView?.() });
  engine.save({ id: 'r', originId: A, destinationId: B, intervalMinutes: 1, ships: { probe: { mode: 'excess', reserve: 20 } }, paused: false });
  queue.mount(container); engine.tick();
  return { queue, engine, container, world, setActive(value) { canAct = value; },
    get stored() { return copy(stored); }, set stored(value) { stored = copy(value); },
    get card() { return all(container).find(node => node.dataset.fleetWaitJob); },
    get dispatches() { return dispatches; },
    render() { queue.mount(container); },
    select(id) { selected = id; queue.mount(container); },
    advance(ms) { now += ms; world.observedAt = now; },
  };
}
const byClass = (root, name) => all(root).find(node => node.className.split(/\s+/).includes(name));
const controls = card => all(card).filter(node => node.dataset.fleetWaitOption || node.dataset.fleetWaitAction);
const button = (card, action) => controls(card).find(node => node.dataset.fleetWaitAction === action);
function assertRouteControls(card) {
  assert.deepEqual(controls(card).filter(node => node.dataset.fleetWaitOption).map(node => node.dataset.fleetWaitOption), [], 'route production and automatic-send settings are not separately editable');
  for (const action of ['resume', 'acknowledge', 'edit-fleet']) assert.equal(button(card, action), undefined, action + ' belongs to the route owner');
  assert.ok(button(card, 'cancel'), 'safe cancellation stays reachable');
}
function assertReview(card) {
  assert.equal(card.dataset.operationAttention, 'true', 'the review-only filter includes the owning route review');
  assert.equal(byClass(card, 'fw-badge').dataset.tone, 'warning');
  assert.match(byClass(card, 'fw-badge').textContent, /revis/i);
  assert.match(byClass(card, 'fw-state').textContent, /ruta|refuerzo/i);
  assert.doesNotMatch(byClass(card, 'fw-state').textContent, /lista para enviar/i);
  assertRouteControls(card);
}

test('real queue pause and owner reconciliation immediately refresh the mounted card into review', () => {
  const h = harness();
  assert.equal(h.card.dataset.operationAttention, 'false');
  button(h.card, 'pause').click();
  assert.equal(h.queue.list()[0].status, 'paused');
  const before = h.stored;
  h.engine.tick();
  assert.equal(h.engine.list()[0].needsReview, true);
  assert.deepEqual(h.stored, before, 'owner review changes no queue fields');
  assertReview(h.card); // No remount or queue tick to rescue a stale view.
  button(h.card, 'cancel').click();
  assert.equal(h.queue.list().length, 0);
  assert.equal(h.engine.list()[0].needsReview, true);
  h.engine.acknowledgeRoute('r');
  assert.equal(h.engine.list()[0].paused, true);
});

test('legacy waiting queue state shows its route review instead of a ready badge', async () => {
  const h = harness(), id = h.queue.list()[0].id;
  h.queue.pause(id); h.engine.tick();
  const legacy = h.stored; legacy.jobs[0].status = 'waiting'; legacy.jobs[0].message = ''; h.stored = legacy;
  h.queue.refreshConfig(); h.render();
  assert.equal(h.queue.list()[0].needsReview, false);
  assert.equal(h.engine.list()[0].needsReview, true);
  assertReview(h.card);
  await h.queue.tick(); assert.equal(h.dispatches, 0);
});

test('legacy production edit cannot appear as an enabled route production checkbox', async () => {
  const h = harness(), legacy = h.stored; legacy.jobs[0].produce = true; h.stored = legacy;
  h.queue.refreshConfig(); h.render();
  assert.equal(h.engine.list()[0].needsReview, false, 'owner has not reconciled this mismatch');
  assertReview(h.card);
  await h.queue.tick(); assert.equal(h.dispatches, 0);
  h.engine.tick(); assertReview(h.card);
});

test('selecting another origin does not create a false route review', () => {
  const h = harness(); h.select(B);
  assert.equal(h.card.dataset.operationAttention, 'false');
  assert.doesNotMatch(byClass(h.card, 'fw-badge').textContent, /revis/i);
  assert.equal(h.engine.list()[0].needsReview, false);
});

test('accepted sent history stays sent after route reconciliation retires its ticket', async () => {
  const h = harness(); await h.queue.tick(); assert.equal(h.dispatches, 1);
  h.engine.tick(); h.render();
  assert.equal(h.engine.list()[0].ticket, null);
  assert.equal(h.queue.list()[0].status, 'sent');
  assert.equal(h.card.dataset.operationAttention, 'false');
  assert.equal(byClass(h.card, 'fw-badge').dataset.tone, 'ready');
  assert.match(byClass(h.card, 'fw-badge').textContent, /enviad/i);
  assert.doesNotMatch(h.card.textContent, /sin ruta|bloqueado|revisar ruta/i);
});

test('ordinary queue cards retain production, automatic send and fleet edit controls', () => {
  const h = harness(), original = h.queue.list()[0]; h.engine.pause('r'); h.engine.remove('r');
  const { scope: jobScope, originId, originName, target, quantities } = original;
  h.queue.queue({ scope: jobScope, originId, originName, target, quantities, produce: true, autoSend: true }, { id: 'ordinary-ui' });
  assert.deepEqual(controls(h.card).filter(node => node.dataset.fleetWaitOption).map(node => node.dataset.fleetWaitOption), ['produce', 'autoSend']);
  assert.ok(button(h.card, 'edit-fleet'));
  button(h.card, 'pause').click(); assert.ok(button(h.card, 'resume'));
  button(h.card, 'resume').click(); assert.equal(h.queue.list()[0].status, 'waiting');
});
test('independent: legacy fleet editor still gives reachable owner recovery instead of hidden editor instructions', () => {
  const h = harness(), old = h.stored, job = old.jobs[0];
  job.status = 'paused'; job.message = 'Editando la flota. La misión esperará hasta terminar la edición.';
  job.fleetEdit = {drafts: Object.fromEntries(core.SHIPS.map(type => [type, String(job.quantities[type])])), resumeStatus: 'waiting', message: ''};
  h.stored = old; h.queue.refreshConfig(); h.engine.tick(); h.render();
  assert.equal(h.engine.list()[0].needsReview, true);
  assertRouteControls(h.card);
  assert.match(byClass(h.card, 'fw-state').textContent, /ruta|refuerzo|cancela/i, 'the visible recovery must point to an accessible action');
});

test('independent: mismatch cancellation and explicit review preserve interval and fresh-census barrier', async () => {
  const h = harness(), old = h.stored; old.jobs[0].produce = true; h.stored = old;
  h.queue.refreshConfig(); h.engine.tick();
  assert.throws(() => h.engine.acknowledgeRoute('r'), /cambiado|cola/);
  button(h.card, 'cancel').click();
  h.engine.acknowledgeRoute('r');
  const reviewed = h.engine.list()[0];
  assert.equal(reviewed.paused, true); assert.equal(reviewed.needsReview, false); assert.equal(reviewed.ticket, null);
  h.engine.resume('r');
  h.engine.tick(); await h.queue.tick(); assert.equal(h.dispatches, 0);
  h.advance(60000); h.world.observedAt = reviewed.lastSentAt;
  h.engine.tick(); await h.queue.tick(); assert.equal(h.dispatches, 0, 'elapsed interval without post-review census must not send');
  h.world.observedAt = reviewed.lastSentAt + 60000;
  h.engine.tick(); await h.queue.tick(); assert.equal(h.dispatches, 1, 'explicit resume can later send under fresh proof');
});

test('independent: sent receipt survives pause, edit and shorter replacement interval', async () => {
  const h = harness();
  h.engine.pause('r');
  h.engine.save({...h.engine.list()[0], intervalMinutes:15, paused:false});
  h.engine.tick(); await h.queue.tick(); assert.equal(h.dispatches, 1);
  h.engine.pause('r');
  const after = h.engine.list()[0];
  assert.equal(after.ticket, null); assert.equal(after.lastSentAt, 1000000); assert.equal(after.nextRunAt, 1900000);
  h.engine.save({...after, intervalMinutes:1, paused:false});
  h.advance(60000); h.engine.tick(); await h.queue.tick(); assert.equal(h.dispatches, 1);
  h.advance(840000); h.engine.tick(); await h.queue.tick(); assert.equal(h.dispatches, 2);
});

test('independent: paused queue while helper disabled never points to a missing review action', () => {
  const h = harness(); h.setActive(false);
  button(h.card, 'pause').click(); h.engine.tick();
  assert.equal(h.engine.list()[0].needsReview, false, 'reconciliation is intentionally gated off');
  assert.doesNotMatch(byClass(h.card, 'fw-state').textContent, /pulsa «He revisado el envío»/, 'the owner does not yet expose this action');
});
