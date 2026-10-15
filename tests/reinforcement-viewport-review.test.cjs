'use strict';
// Independent offline review of the logical-pixel/layout-pixel boundary.
// The native camera oracle is the separately recorded official asset fixture.
// No browser, game account, network, socket, Drive, or order is exercised here.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const M = require('../docs/reinforcement-map.js');
const fixture = require('./fixtures/native-camera.json');
const Camera = vm.runInNewContext('(' + fixture.classExpression + ')', {
  C: { tiltDegrees: 55, distance: 1100, baseFocal: 1000 }, ie: Math.PI / 180, E: 3200,
});
const NOW = 1792022400000;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function nativeModule() {
  return { J: Camera, Y: new Camera(), et: function axial(q, r) { return { x: 69 * q, y: 46 * Math.sqrt(3) * (r + q / 2) }; } };
}
function geometry(width = 1000.8, height = 700.8) {
  const size = { width, height }, rect = { left: -17.25, top: 83.5, width: Math.round(width * 64) / 64, height: Math.round(height * 64) / 64 };
  let reads = 0;
  const canvas = { isConnected: true, width: 2502, height: 1752, style: { width: `${width}px`, height: `${height}px` },
    getClientRects: () => [rect], getBoundingClientRect() { reads++; return { ...rect }; } };
  const controls = [{ isConnected: true }, { isConnected: true }];
  const app = { isConnected: true, contains: item => item === canvas || controls.includes(item) };
  const document = { readyState: 'complete', hidden: false,
    getElementById: id => id === 'app' ? app : id === 'stage' ? canvas : null,
    querySelectorAll: selector => selector === 'canvas#stage' ? [canvas] : selector === '.star-hover' ? [controls[0]] : selector === '.star-actions' ? [controls[1]] : [],
  };
  return { size, rect, canvas, document, get reads() { return reads; } };
}
function snapshot(geo, revision = 1) {
  const camera = new Camera();
  return { version: 1, galaxy: 'review', revision, observedAt: NOW,
    camera: { x: 310, y: -160, zoom: .85, sinTilt: camera.sinTilt, cosTilt: camera.cosTilt, L: camera.L, baseFocal: camera.baseFocal },
    viewport: { ...geo.rect }, projection: { ...geo.size } };
}
async function observer(geo = geometry()) {
  const frames = new Map(), timers = new Map(), emitted = [], marked = [], mod = nativeModule();
  let serial = 0, time = NOW;
  const realm = { document: geo.document, location: { origin: 'https://oldlight.io', pathname: '/game/galaxy/review' },
    performance: { getEntriesByType: () => [{ name: M.ASSET, initiatorType: 'link', responseEnd: 1 }] },
    requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn) { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
  };
  const api = M.installPageObserver({ realm, now: () => time, importModule: () => mod, onPending: value => marked.push(value), emit: value => emitted.push(value) });
  assert.equal(await api.ready, true);
  return { geo, mod, api, emitted, marked, frames,
    observe(width = geo.size.width, height = geo.size.height) { return mod.Y.unproject(40, 50, 310, -160, .85, width, height); },
    frame() { const all = [...frames.values()]; frames.clear(); for (const fn of all) fn(time); },
    tick(ms = 250) { time += ms; const all = [...timers.values()]; timers.clear(); for (const fn of all) fn(); },
  };
}
function bridge(geo = geometry()) {
  let contentPort, page, serial = 0;
  class Port {
    constructor() { this.listeners = new Set(); }
    addEventListener(_, fn) { this.listeners.add(fn); } removeEventListener(_, fn) { this.listeners.delete(fn); }
    start() {} close() { this.closed = true; }
    postMessage(data) { if (!this.closed && !this.peer.closed) for (const fn of [...this.peer.listeners]) fn({ data }); }
  }
  class MessageChannel {
    constructor() { this.port1 = new Port(); this.port2 = new Port(); this.port1.peer = this.port2; this.port2.peer = this.port1; contentPort = this.port1; }
  }
  const document = geo.document;
  document.documentElement = { appendChild(node) { node.isConnected = true; } };
  document.createElement = () => ({ attributes: new Map(), listeners: new Set(), isConnected: false,
    remove() { this.isConnected = false; }, getAttribute(name) { return this.attributes.get(name) ?? null; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); }, removeAttribute(name) { this.attributes.delete(name); },
    addEventListener(_, fn) { this.listeners.add(fn); }, removeEventListener(_, fn) { this.listeners.delete(fn); },
    dispatchEvent(event) { event.target = this; for (const fn of [...this.listeners]) fn(event); },
  });
  const realm = { document, location: { origin: 'https://oldlight.io', pathname: '/game/galaxy/review' }, crypto: { randomUUID: () => 'independent-review' },
    setTimeout: () => ++serial, clearTimeout() {},
  };
  page = vm.createContext({ document, MessageChannel, MessageEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } } });
  const api = M.create({ realm, document, now: () => NOW,
    observerSource: 'globalThis.OldLightReinforcementMap={installPageObserver(options){globalThis.options=options;return{status(){return{reason:""};},stop(){}};}};',
    addElement(container, tag, attrs) { document.currentScript = { parentNode: container }; vm.runInContext(attrs.textContent, page); document.currentScript = null; },
  });
  return { geo, api,
    pending(value) { page.options.onPending(value); },
    deliver(value) { contentPort.postMessage(typeof value === 'string' ? value : JSON.stringify(value)); },
    send(value) { this.pending(value); this.deliver(value); },
  };
}

test('review: exactly 1/32 layout pixel in either direction is accepted only with matching inline sizes', async () => {
  for (const [dw, dh] of [[1 / 32, -1 / 32], [-1 / 32, 1 / 32], [0, 1 / 32], [-1 / 32, 0]]) {
    const geo = geometry(1000, 700); geo.rect.width += dw; geo.rect.height += dh;
    const h = await observer(geo); h.observe(); h.frame();
    assert.equal(h.emitted.length, 1); assert.deepEqual(h.emitted[0].projection, geo.size);
    assert.ok(M.validateSnapshot(JSON.stringify(h.emitted[0]))); h.api.stop();
  }
});

test('review: oversized deltas and malformed or uncorroborated inline declarations fail closed', async () => {
  const cases = [
    g => { g.rect.width = g.size.width + 1 / 32 + 1e-8; },
    g => { g.rect.height = g.size.height - 1 / 32 - 1e-8; },
    g => { delete g.canvas.style; },
    g => { delete g.canvas.style.height; },
    g => { g.canvas.style.width = g.size.width; },
    g => { g.canvas.style.width = `${g.size.width}px!important`; },
    g => { g.canvas.style.width = '100%'; },
    g => { g.canvas.style.width = '1.0008e3px'; },
    g => { g.canvas.style.height = '700.800002px'; },
    g => { g.rect.width = g.size.width * 2; },
  ];
  for (const mutate of cases) {
    const geo = geometry(); mutate(geo); const h = await observer(geo); h.observe(); h.frame();
    assert.equal(h.emitted.length, 0); assert.equal(h.api.status().reason, 'native-viewport-size-mismatch'); h.api.stop();
  }
});

test('review: client projection and inverse agree with official native camera across signs, pan, zoom and axes', () => {
  const mod = nativeModule(); let checked = 0;
  for (const [width, height] of [[1000.8, 700.8], [1000 + 1 / 32, 700 - 1 / 32], [811.3333333333334, 633.3333333333334]]) {
    const geo = geometry(width, height), value = snapshot(geo);
    for (const [x, y, zoom] of [[0, 0, .3], [-750, 120, .85], [200, -900, 1.7], [0, 2100, 1]]) {
      Object.assign(value.camera, { x, y, zoom });
      for (let q = -12; q <= 12; q += 3) for (let r = -9; r <= 9; r += 3) {
        const world = mod.et(q, r), native = mod.Y.project(world.x, world.y, x, y, zoom, width, height);
        const point = M.projectPoint({ q, r }, value);
        if (!native.visible) { assert.equal(point, null); continue; }
        near(point.x, geo.rect.left + native.x * geo.rect.width / width);
        near(point.y, geo.rect.top + native.y * geo.rect.height / height);
        assert.deepEqual(M.unprojectHex(point, value), { q: q || 0, r: r || 0 }); checked++;
      }
    }
  }
  assert.ok(checked > 500);
});

test('review: fractional hot path stays frame-bounded and dimension changes invalidate before publication', async () => {
  const h = await observer(); let styleReads = 0;
  h.geo.canvas.style = { get width() { styleReads++; return `${h.geo.size.width}px`; }, get height() { styleReads++; return `${h.geo.size.height}px`; } };
  h.observe(); const geometryReads = h.geo.reads, initialStyleReads = styleReads;
  for (let i = 0; i < 10000; i++) h.observe();
  assert.equal(h.geo.reads, geometryReads); assert.equal(styleReads, initialStyleReads);
  assert.equal(h.frames.size, 1); assert.equal(h.marked.filter(Boolean).length, 1); h.frame();
  assert.equal(h.emitted.length, 1);
  // A different logical size may quantize to the same layout width.
  h.geo.size.width += .002; h.observe();
  assert.equal(h.marked.at(-1).revision, 2); assert.equal(h.emitted.length, 1); h.frame();
  assert.equal(h.emitted.length, 2); assert.equal(h.emitted[1].projection.width, h.geo.size.width); h.api.stop();
});

test('review: inline size mutation before flush or heartbeat invalidates and correct native calls recover', async () => {
  const h = await observer(); h.observe(); h.geo.canvas.style.height = '701px'; h.frame();
  assert.equal(h.emitted.length, 0); assert.equal(h.api.status().observed, false);
  h.geo.canvas.style.height = `${h.geo.size.height}px`; h.observe(); h.frame();
  assert.equal(h.emitted.length, 1);
  h.geo.canvas.style.width = '1001px'; h.tick(500); h.frame();
  assert.equal(h.emitted.length, 1); assert.equal(h.api.status().observed, false);
  h.geo.canvas.style.width = `${h.geo.size.width}px`; h.observe(); h.frame();
  assert.equal(h.emitted.length, 2); assert.ok(h.emitted[1].revision > h.emitted[0].revision); h.api.stop();
});

test('review: corrupt projection transport revokes an existing snapshot and valid newer snapshots recover', () => {
  const malformed = [null, [], {}, { width: 1000.8 }, { width: '1000.8', height: 700.8 },
    { width: -1, height: 700.8 }, { width: Infinity, height: 700.8 }, { width: 1000.8, height: 0 },
    { width: 1000.9, height: 700.8 }, { width: 2502, height: 1752 }];
  for (const projection of malformed) {
    const h = bridge(), valid = snapshot(h.geo); h.send(valid); assert.equal(h.api.status().available, true);
    const bad = { ...valid, revision: 2, projection }; assert.equal(M.validateSnapshot(bad), null);
    h.deliver(bad); assert.equal(h.api.status().available, false);
    h.send({ ...valid, revision: 3 }); assert.equal(h.api.status().available, true); h.api.stop();
  }
});

test('review: transport accepts only current inline geometry and suppresses both projection and hit tests on change', () => {
  const h = bridge(), value = snapshot(h.geo), own = { id: 'own', q: 4, r: -2 };
  h.send(value); const point = h.api.projectSystem(own); assert.ok(point);
  assert.equal(h.api.hitTestSystem(point, [own]), own);
  for (const key of ['width', 'height']) {
    const previous = h.geo.canvas.style[key]; h.geo.canvas.style[key] = '999px';
    assert.equal(h.api.projectSystem(own), null); assert.equal(h.api.hitTestSystem(point, [own]), null);
    assert.equal(h.api.status().available, false); h.geo.canvas.style[key] = previous;
    assert.ok(h.api.projectSystem(own));
  }
  h.pending({ ...value, revision: 2 }); assert.equal(h.api.projectSystem(own), null);
  h.geo.canvas.style.height = '999px'; h.deliver({ ...value, revision: 2 });
  assert.equal(h.api.status().available, false);
  h.geo.canvas.style.height = `${h.geo.size.height}px`; h.send({ ...value, revision: 3 });
  assert.ok(h.api.projectSystem(own));
  const unknown = { ...value, projection: { ...value.projection, token: 'private' } };
  assert.deepEqual(M.validateSnapshot(unknown).projection, value.projection); h.api.stop();
});

test('review: fractional viewport changes preserve horizon rejection and never reinterpret backing dimensions', async () => {
  const h = await observer(); h.observe(); h.frame(); const value = h.emitted[0], c = value.camera, v = value.viewport, s = value.projection;
  const horizon = { x: v.left + v.width / 2, y: v.top + (s.height / 2 - c.baseFocal * c.zoom * c.sinTilt / c.cosTilt) * v.height / s.height };
  assert.equal(M.unprojectHex(horizon, value), null);
  assert.equal(M.unprojectHex({ ...horizon, y: horizon.y - 1 }, value), null);
  h.observe(h.geo.canvas.width, h.geo.canvas.height); h.frame();
  assert.equal(h.emitted.length, 1); assert.equal(h.api.status().observed, false);
  // Switching back to exact layout dimensions needs no correction metadata.
  h.observe(h.geo.rect.width, h.geo.rect.height); h.frame();
  assert.equal(h.emitted.length, 2); assert.equal(h.emitted[1].projection, undefined); h.api.stop();
});

test('review: CSSOM canonicalization remains bounded and caches only one detached style per document', async () => {
  const geo = geometry(1091.6363636363635, 701.8181818181818); let created = 0;
  const normalize = value => `${Number.parseFloat(value).toFixed(3)}px`;
  geo.canvas.style = { width: normalize(geo.size.width), height: normalize(geo.size.height) };
  geo.canvas.ownerDocument = { createElement(tag) {
    assert.equal(tag, 'span'); created++;
    return { style: new Proxy({}, { set(target, key, value) { target[key] = normalize(value); return true; } }) };
  } };
  const h = await observer(geo); h.observe(); h.frame(); assert.equal(h.emitted.length, 1); assert.equal(created, 1);
  h.mod.Y.unproject(20, 30, -200, 100, 1.2, geo.size.width, geo.size.height); h.frame();
  assert.equal(h.emitted.length, 2); assert.equal(created, 1);
  geo.canvas.style.height = normalize(geo.size.height + .01); h.tick();
  assert.equal(h.api.status().observed, false);
  h.observe(); h.frame(); assert.equal(h.emitted.length, 2); assert.equal(created, 1);
  geo.canvas.style.height = normalize(geo.size.height); geo.rect.height -= .25; h.tick(); h.observe(); h.frame();
  assert.equal(h.emitted.length, 2); assert.equal(h.api.status().reason, 'native-viewport-size-mismatch'); h.api.stop();
});

test('review: size diagnostics strip all extra data, reject invalid numbers and never enable projection', () => {
  const h = bridge(), measured = { nativeWidth: 2000, nativeHeight: 1400, cssWidth: 1000.796875, cssHeight: 700.796875 };
  const diagnostic = { version: 1, type: 'status', reason: 'native-viewport-size-mismatch', geometry: measured };
  h.send(snapshot(h.geo));
  h.deliver({ ...diagnostic, geometry: { ...measured, account: 'private', camera: { x: 1, y: 2 } } });
  assert.deepEqual(h.api.status().geometry, measured); assert.equal(h.api.status().available, false);
  assert.equal(h.api.projectSystem({ q: 0, r: 0 }), null);
  for (const bad of ['1000', -1, 0, Infinity, null, 100001, {}, []]) {
    h.deliver({ ...diagnostic, geometry: { ...measured, cssWidth: bad } });
    assert.equal(h.api.status().geometry, null); assert.equal(h.api.status().available, false);
  }
  h.deliver({ ...diagnostic, reason: 'viewport-unavailable' }); assert.equal(h.api.status().geometry, null);
  h.deliver(diagnostic); assert.deepEqual(h.api.status().geometry, measured);
  h.send(snapshot(h.geo, 2)); assert.equal(h.api.status().geometry, null); assert.equal(h.api.status().available, true); h.api.stop();
});
