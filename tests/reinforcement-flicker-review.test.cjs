'use strict';
// Independent deterministic review of asynchronous transport and SVG stability.
// Executes the production injection body. No browser, game, network or orders.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const M = require('../docs/reinforcement-map.js');
const P = require('../docs/reinforcement-panel.js');
const NOW = 1792022400000, SCOPE = 'review/self';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const copy = value => JSON.parse(JSON.stringify(value));
function sample(revision = 1, observedAt = NOW) {
  return { version: 1, galaxy: 'review', revision, observedAt,
    camera: { x: 0, y: 0, zoom: 1, sinTilt: Math.sin(Math.PI / 3), cosTilt: Math.cos(Math.PI / 3), L: 1100, baseFocal: 1000 },
    viewport: { left: 15, top: 30, width: 1000, height: 700 } };
}
function bridge() {
  let time = NOW, page, channel, serial = 0;
  const messages = [], rect = sample().viewport;
  const canvas = { isConnected: true, style: {}, getClientRects: () => [rect], getBoundingClientRect: () => ({ ...rect }) };
  const app = { isConnected: true, contains: node => node === canvas };
  const document = { hidden: false, stages: [canvas],
    getElementById: id => id === 'app' ? app : null,
    querySelectorAll: selector => selector === 'canvas#stage' ? document.stages : [],
    documentElement: { appendChild(node) { node.isConnected = true; } },
    createElement: () => ({ isConnected: false, attributes: new Map(), handlers: new Set(),
      remove() { this.isConnected = false; },
      getAttribute(name) { return this.attributes.get(name) ?? null; },
      setAttribute(name, value) { this.attributes.set(name, String(value)); }, removeAttribute(name) { this.attributes.delete(name); },
      addEventListener(_, callback) { this.handlers.add(callback); }, removeEventListener(_, callback) { this.handlers.delete(callback); },
      dispatchEvent(event) { event.target = this; for (const callback of [...this.handlers]) callback(event); },
    }),
  };
  class Port {
    constructor() { this.handlers = new Set(); }
    start() {} close() { this.closed = true; }
    addEventListener(_, fn) { this.handlers.add(fn); } removeEventListener(_, fn) { this.handlers.delete(fn); }
    postMessage(data) { if (!this.closed) messages.push({ receiver: this.peer, data }); }
  }
  class MessageChannel {
    constructor() { this.port1 = new Port(); this.port2 = new Port(); this.port1.peer = this.port2; this.port2.peer = this.port1; channel = this; }
  }
  const realm = { document, location: { origin: 'https://oldlight.io', pathname: '/game/galaxy/review' },
    crypto: { randomUUID: () => 'independent-flicker-review' }, setTimeout: () => ++serial, clearTimeout() {} };
  page = vm.createContext({ document, MessageChannel, MessageEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } } });
  const map = M.create({ realm, now: () => time, getScope: () => SCOPE,
    observerSource: 'globalThis.reason="";globalThis.OldLightReinforcementMap={installPageObserver(options){globalThis.options=options;return{status(){return{reason:globalThis.reason};},stop(){}};}};',
    addElement(node, tag, attributes) { assert.equal(tag, 'script'); document.currentScript = { parentNode: node }; vm.runInContext(attributes.textContent, page); document.currentScript = null; },
  });
  return { map, realm, document, canvas, rect, messages,
    pending: value => page.options.onPending(value),
    emit: value => page.options.emit(value),
    raw: value => channel.port1.postMessage(value),
    flush() { for (const { receiver, data } of messages.splice(0)) if (!receiver.closed) for (const fn of [...receiver.handlers]) fn({ data }); },
    publish(value) { this.pending(value); this.emit(value); this.flush(); },
    advance(ms) { time += ms; },
    failure(reason) { page.reason = reason; this.pending(null); },
    project: (system = { q: 0, r: 0 }) => map.projectSystem(system, { scope: SCOPE }),
  };
}

test('flicker review: identical heartbeats preserve projection and hit tests across delayed deliveries', () => {
  const h = bridge(), own = { id: A, q: 0, r: 0 }; h.publish(sample());
  const point = h.project(own);
  for (let revision = 2; revision <= 61; revision++) {
    h.advance(500);
    const heartbeat = sample(revision, NOW + (revision - 1) * 500);
    h.pending(heartbeat);
    assert.deepEqual(h.project(own), point, 'queued heartbeat cannot blink the route before RAF');
    assert.equal(h.map.hitTestSystem(point, [own]), own);
    h.emit(heartbeat);
    assert.deepEqual(h.project(own), point, 'queued port delivery cannot blink the route');
    assert.equal(h.map.status().available, true);
    h.flush(); assert.deepEqual(h.project(own), point);
  }
  h.map.stop();
});

for (const [label, mutate] of [
  ['camera x', s => { s.camera.x += 1e-12; }],
  ['camera y', s => { s.camera.y += 1e-12; }],
  ['zoom', s => { s.camera.zoom += 1e-12; }],
  ['sine tilt', s => { s.camera.sinTilt += 1e-12; }],
  ['cosine tilt', s => { s.camera.cosTilt += 1e-12; }],
  ['perspective distance', s => { s.camera.L += 1e-9; }],
  ['base focal', s => { s.camera.baseFocal += 1e-9; }],
  ['viewport left', s => { s.viewport.left += 1e-9; }],
  ['viewport top', s => { s.viewport.top += 1e-9; }],
  ['viewport width', s => { s.viewport.width += 1e-9; }],
  ['viewport height', s => { s.viewport.height += 1e-9; }],
  ['logical width', s => { s.projection = { width: 1000.001, height: 700 }; }],
  ['logical height', s => { s.projection = { width: 1000, height: 700.001 }; }],
  ['galaxy', s => { s.galaxy = 'another'; }],
]) test(`flicker review: ${label} changes revoke both mapping directions synchronously`, () => {
  const h = bridge(), own = { id: A, q: 0, r: 0 }; h.publish(sample());
  const point = h.project(own), next = sample(2); mutate(next);
  assert.ok(M.validateSnapshot(next), 'test change is a structurally valid snapshot');
  h.pending(next);
  assert.equal(h.project(own), null); assert.equal(h.map.hitTestSystem(point, [own]), null); assert.equal(h.map.status().available, false);
  h.map.stop();
});

test('flicker review: late identical heartbeat cannot revive geometry superseded by a pan', () => {
  const h = bridge(); h.publish(sample()); h.advance(500);
  const heartbeat = sample(2, NOW + 500); h.pending(heartbeat); h.emit(heartbeat);
  const moved = sample(3, NOW + 500); moved.camera.x = 100; h.pending(moved);
  assert.equal(h.project(), null); h.flush(); assert.equal(h.project(), null);
  h.emit(moved); h.flush(); assert.ok(h.project().x < 515);
  h.raw(JSON.stringify(heartbeat)); h.flush();
  assert.equal(h.project(), null, 'out-of-order same-geometry traffic still revokes the cache');
  h.map.stop();
});

test('flicker review: unreceived heartbeats cannot extend accepted snapshot freshness', () => {
  const h = bridge(); h.publish(sample()); h.advance(500);
  h.pending(sample(2, NOW + 500)); h.emit(sample(2, NOW + 500)); h.advance(1001);
  assert.equal(h.project(), null); assert.equal(h.map.status().available, false);
  h.flush(); assert.ok(h.project(), 'a valid delivered newer snapshot can restore availability');
  h.advance(501); assert.equal(h.project(), null); h.map.stop();
});

test('flicker review: equal geometry never bypasses invalid payload, time or revision guards', () => {
  for (const bad of [sample(1), sample(0), sample(2, NOW + 1), sample(2, NOW - 1501), 'not-json']) {
    const h = bridge(); h.publish(sample()); h.raw(typeof bad === 'string' ? bad : JSON.stringify(bad)); h.flush();
    assert.equal(h.project(), null); h.map.stop();
  }
});

test('flicker review: hook failure, hidden viewport, replaced canvas and changed scope still fail closed', () => {
  for (const mutate of [h => h.failure('camera-hook-replaced'), h => { h.document.hidden = true; },
    h => { h.document.stages = [{ ...h.canvas }]; }, h => { h.realm.location.pathname = '/game/galaxy/other'; }]) {
    const h = bridge(); h.publish(sample()); mutate(h); assert.equal(h.project(), null); h.map.stop();
  }
  const h = bridge(); h.publish(sample()); assert.ok(h.project());
  assert.equal(h.map.projectSystem({ q: 0, r: 0 }, { scope: 'review/other-account' }), null);
  h.map.stop(); assert.equal(h.project(), null);
});

// Minimal independent DOM records node identity, without CSS/layout emulation.
class Node {
  constructor(tag, document) {
    Object.assign(this, { tagName: tag.toUpperCase(), ownerDocument: document, children: [], parentNode: null, attributes: new Map(), listeners: new Map(), style: {}, dataset: {}, hidden: false, className: '', value: '', text: '' });
    this.classList = { add: name => { this.className += ' ' + name; }, contains: name => this.className.split(/\s+/).includes(name) };
  }
  get isConnected() { let node = this; while (node.parentNode) node = node.parentNode; return node === this.ownerDocument; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  insertBefore(node, before) {
    if (before !== null && before?.parentNode !== this) throw new Error('NotFoundError');
    if (node === before) return node;
    node.remove(); node.parentNode = this; this.children.splice(before === null ? this.children.length : this.children.indexOf(before), 0, node);
    this.insertions = (this.insertions || 0) + 1; return node;
  }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return this.text + this.children.map(n => n.textContent).join(''); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); } getAttribute(key) { return this.attributes.get(key) ?? null; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this.text = ''; this.append(...nodes); }
  remove() { if (this.parentNode) { const nodes = this.parentNode.children; nodes.splice(nodes.indexOf(this), 1); this.parentNode = null; } }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    const match = node => selector.split(',').some(s => {
      s = s.trim();
      if (s === 'canvas#stage') return node.tagName === 'CANVAS' && node.id === 'stage';
      if (s.startsWith('.')) return node.classList.contains(s.slice(1));
      return s === node.tagName.toLowerCase();
    });
    return this.children.flatMap(node => [node, ...node.querySelectorAll('*')]).filter(node => selector === '*' || match(node));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { left: 15, top: 30, width: 1000, height: 700, right: 1015, bottom: 730 }; }
  getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; }
}
function panel() {
  const document = new Node('document', null); document.ownerDocument = document;
  document.createElement = tag => new Node(tag, document); document.createElementNS = (_, tag) => document.createElement(tag);
  const body = document.createElement('body'); document.body = body; document.append(body);
  const window = new Node('window', document); document.defaultView = window;
  const nativeRoot = document.createElement('div'); nativeRoot.id = 'app'; body.append(nativeRoot);
  const heading = document.createElement('h1'), hud = document.createElement('header'); hud.id = 'hud'; hud.style.position = 'absolute';
  let canvas = document.createElement('canvas'); canvas.id = 'stage'; nativeRoot.append(heading, canvas, hud);
  const container = document.createElement('main'); body.append(container);
  let at = NOW, route = { id: 'route-review', originId: A, destinationId: B, paused: false, intervalMinutes: 5, ships: {} }, available = true;
  const world = { scope: SCOPE, galaxy: 'review', selfId: 'self', connected: true, complete: true, observedAt: NOW,
    systems: [{ id: A, name: 'Origin', q: 0, r: 0 }, { id: B, name: 'Destination', q: 3, r: 1 }] };
  const app = P.create({ document, window, now: () => at, getScope: () => SCOPE, getWorld: () => world, getRoutes: () => [route],
    getMapElement: () => canvas, projectSystem: system => available ? { x: 400 + system.q * 40, y: 350 + system.r * 40, visible: true } : null });
  app.mount(container);
  return { app, world, document, nativeRoot, hud, container, window,
    get canvas() { return canvas; }, set canvas(value) { canvas = value; },
    get route() { return route; }, set route(value) { route = value; }, set available(value) { available = value; },
    refresh() { at += 500; app.render(); },
    get overlay() { return document.querySelector('.oldlight-route-overlay'); }, get mini() { return document.querySelector('.oldlight-route-map'); },
  };
}

test('flicker review: route metadata refresh leaves main and schematic SVG nodes intact', () => {
  const h = panel(), main = h.overlay.querySelector('line'), mini = h.mini.querySelector('line'); assert.ok(main); assert.ok(mini);
  for (let n = 0; n < 20; n++) {
    h.route = { ...copy(h.route), status: n % 2 ? 'waiting' : 'queued', message: `Waiting ${n}`, observedAt: NOW + n * 500,
      lastAttemptAt: NOW + n * 500, nextDueAt: NOW + 300000 + n, ships: { probe: { mode: 'fixed', amount: n } } };
    h.refresh();
    assert.ok(h.overlay.querySelector('line') === main, 'nonvisual metadata must not recreate visible lines');
    assert.ok(h.mini.querySelector('line') === mini, 'schematic remains independent of scheduler metadata');
    assert.notEqual(h.overlay.style.display, 'none');
  }
  h.app.destroy();
});

test('flicker review: genuine visual route changes repaint and unavailable geometry hides persisted routes', () => {
  const h = panel(), original = h.overlay.querySelector('line');
  h.route = { ...h.route, paused: true }; h.refresh();
  const paused = h.overlay.querySelector('line'); assert.notEqual(paused, original); assert.equal(paused.getAttribute('data-paused'), 'true'); assert.equal(paused.getAttribute('stroke-dasharray'), '5 4');
  h.route = { ...h.route, originId: B, destinationId: A }; h.refresh();
  const reversed = h.overlay.querySelector('line'); assert.notEqual(reversed, paused); assert.ok(Number(reversed.getAttribute('x1')) > Number(reversed.getAttribute('x2')));
  h.route = { ...h.route, id: 'changed-id' }; h.refresh(); assert.equal(h.overlay.querySelector('line').getAttribute('data-route-id'), 'changed-id');
  const mini = h.mini.querySelector('line'); h.available = false; h.refresh(); assert.equal(h.overlay.style.display, 'none'); assert.equal(h.mini.querySelector('line'), mini);
  h.available = true; h.refresh(); assert.notEqual(h.overlay.style.display, 'none'); assert.ok(h.overlay.querySelector('line')); h.app.destroy();
});


test('layer review: overlay is the immediate zero-layer canvas sibling before native HUD', () => {
  const h = panel(), overlay = h.overlay;
  assert.ok(overlay.parentNode === h.nativeRoot); assert.ok(h.canvas.nextSibling === overlay); assert.ok(overlay.nextSibling === h.hud);
  assert.equal(overlay.style.position, 'fixed'); assert.equal(overlay.style.zIndex, '0'); assert.equal(overlay.style.pointerEvents, 'none');
  assert.equal(overlay.getAttribute('pointer-events'), 'none'); assert.equal(overlay.style.overflow, 'hidden');
  assert.equal(overlay.style.left, '15px'); assert.equal(overlay.style.top, '30px'); assert.equal(overlay.getAttribute('viewBox'), '0 0 1000 700');
  assert.match(h.container.querySelector('style').textContent, /\.oldlight-route-overlay\{[^}]*z-index:0;/);
  for (const node of overlay.querySelectorAll('*')) assert.equal(node.style.pointerEvents, 'none');
  assert.deepEqual(h.canvas.style, {}, 'native canvas styles are untouched');
  assert.deepEqual(h.nativeRoot.style, {}, 'native parent styles are untouched');
  assert.deepEqual(h.hud.style, { position: 'absolute' }, 'native HUD styles are untouched');
  h.app.destroy();
});

test('layer review: stable renders and metadata refresh perform no layer reorder', () => {
  const h = panel(), overlay = h.overlay, line = overlay.querySelector('line'), insertions = h.nativeRoot.insertions;
  for (let n = 0; n < 50; n++) { h.route = { ...h.route, lastAttemptAt: NOW + n }; h.refresh(); }
  assert.equal(h.nativeRoot.insertions, insertions); assert.ok(h.canvas.nextSibling === overlay);
  assert.ok(overlay.querySelector('line') === line); h.app.destroy();
});

test('layer review: reordered or detached SVG is repaired before unchanged-geometry cache return', () => {
  const h = panel(), overlay = h.overlay, line = overlay.querySelector('line');
  h.document.body.append(overlay); h.refresh();
  assert.ok(h.canvas.nextSibling === overlay); assert.ok(overlay.nextSibling === h.hud); assert.ok(overlay.querySelector('line') === line);
  h.nativeRoot.insertBefore(h.hud, overlay); h.refresh();
  assert.ok(h.canvas.nextSibling === overlay); assert.ok(overlay.nextSibling === h.hud); assert.ok(overlay.querySelector('line') === line);
  overlay.remove(); h.refresh(); assert.ok(h.canvas.nextSibling === overlay); assert.ok(overlay.querySelector('line') === line);
  h.app.destroy();
});

test('layer review: identical-geometry native canvas remount reanchors the same SVG before the new HUD', () => {
  const h = panel(), overlay = h.overlay, line = overlay.querySelector('line');
  const root = h.document.createElement('div'), canvas = h.document.createElement('canvas'), hud = h.document.createElement('header');
  canvas.id = 'stage'; hud.id = 'hud'; root.append(canvas, hud);
  h.canvas.remove(); h.nativeRoot.remove(); h.document.body.append(root); h.canvas = canvas; h.refresh();
  assert.ok(overlay.parentNode === root); assert.ok(canvas.nextSibling === overlay); assert.ok(overlay.nextSibling === hud);
  assert.ok(overlay.querySelector('line') === line); assert.notEqual(overlay.style.display, 'none');
  h.app.destroy(); assert.equal(overlay.parentNode, null); assert.ok(canvas.nextSibling === hud);
});

test('layer review: missing, disconnected and uninsertable anchors hide arrows and recover safely', () => {
  for (const mode of ['missing-canvas', 'disconnected-ancestor', 'missing-insertBefore', 'throwing-insertBefore']) {
    const h = panel(), overlay = h.overlay, canvas = h.canvas, nativeRoot = h.nativeRoot, originalInsert = nativeRoot.insertBefore;
    if (mode === 'missing-canvas') { canvas.remove(); h.canvas = null; }
    if (mode === 'disconnected-ancestor') nativeRoot.remove();
    if (mode === 'missing-insertBefore') nativeRoot.insertBefore = undefined;
    if (mode === 'throwing-insertBefore') { h.document.body.append(overlay); nativeRoot.insertBefore = () => { throw new Error('denied'); }; }
    assert.doesNotThrow(() => h.refresh()); assert.equal(overlay.style.display, 'none', mode);
    nativeRoot.insertBefore = originalInsert;
    if (!nativeRoot.isConnected) h.document.body.append(nativeRoot);
    if (!canvas.isConnected) nativeRoot.insertBefore(canvas, h.hud);
    h.canvas = canvas; h.refresh();
    assert.ok(canvas.nextSibling === overlay); assert.notEqual(overlay.style.display, 'none', mode + ' recovery'); h.app.destroy();
  }
});

test('layer review: Helper panel mount location never becomes the arrow layering parent', () => {
  const h = panel(), overlay = h.overlay, elsewhere = h.document.createElement('aside');
  h.document.body.append(elsewhere); h.app.mount(elsewhere); h.refresh();
  assert.ok(h.canvas.nextSibling === overlay); assert.ok(overlay.parentNode === h.nativeRoot);
  assert.equal(elsewhere.contains(overlay), false); assert.equal(h.container.contains(overlay), false);
  assert.equal(overlay.style.pointerEvents, 'none'); h.app.destroy();
});
