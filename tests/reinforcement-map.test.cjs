'use strict';
// Offline fixtures only. No real game session, requests, sockets or orders.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const M = require('../docs/reinforcement-map.js');
const NOW = 1792022400000;
const SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scope = 'alpha/' + SELF;
const drain = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
function nativeModule(hook) {
  class Camera {
    constructor() { this.sinTilt = Math.sin(55 * Math.PI / 180); this.cosTilt = Math.cos(55 * Math.PI / 180); this.L = 1100; this.baseFocal = 1000; }
    focal(zoom) { return this.baseFocal * zoom; }
    project(x, y, camX, camY, zoom, width, height, out) {
      if (hook) return hook.call(this, arguments, calculate);
      return calculate.call(this, arguments);
    }
    unproject(x, y, camX, camY, zoom, width, height) { return { x, y }; }
  }
  function calculate(args) {
    const [x, y, camX, camY, zoom, width, height, out] = args;
    const dx = x - camX, dy = y - camY, depth = dy * this.cosTilt + this.L, focal = this.focal(zoom);
    const result = out ?? { x: 0, y: 0, scale: 0, depth: 0, visible: false };
    if (depth <= 1) Object.assign(result, { x: 0, y: 0, scale: 0, depth, visible: false });
    else Object.assign(result, { x: focal * dx / depth + width / 2, y: -focal * dy * this.sinTilt / depth + height / 2, scale: focal / depth, depth, visible: true });
    return result;
  }
  return { J: Camera, Y: new Camera(), et: function axial(q, r, size = 46) { return { x: size * 1.5 * q, y: size * Math.sqrt(3) * (r + q / 2) }; } };
}
function geometry() {
  let reads = 0;
  const rect = { left: 19, top: 35, width: 1000, height: 700 };
  const stage = { isConnected: true, hidden: false, width: 2000, height: 1400, getBoundingClientRect() { reads++; return { ...rect }; }, getClientRects: () => [rect] };
  const app = { isConnected: true, contains: node => node === stage || controls.includes(node) };
  const controls = [{ isConnected: true }, { isConnected: true }];
  const document = { readyState: 'complete', hidden: false, stages: [stage], controls,
    getElementById: id => id === 'app' ? app : id === 'stage' ? stage : null,
    querySelectorAll(selector) { return selector === 'canvas#stage' ? this.stages : selector === '.star-hover' ? this.controls.slice(0, 1) : selector === '.star-actions' ? this.controls.slice(1, 2) : []; },
  };
  return { document, stage, app, rect, get reads() { return reads; } };
}
function observerHarness(options = {}) {
  const geo = geometry(), frames = new Map(), timers = new Map(), emitted = [], marked = [], imports = [];
  let serial = 0, time = NOW, observer;
  const mod = options.module || nativeModule(options.nativeHook);
  const resources = [{ name: M.ASSET, initiatorType: 'script', responseEnd: 30 }];
  const realm = { document: geo.document, location: { origin: 'https://oldlight.io', pathname: '/game/galaxy/alpha' },
    performance: { getEntriesByType: type => type === 'resource' ? resources : [] },
    requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
  };
  function start() {
    observer = M.installPageObserver({ realm, now: () => time,
      importModule(url) { imports.push(url); if (options.importError) return Promise.reject(options.importError); return mod; },
      onPending(value) { marked.push(value); options.onPending?.(value); },
      emit(value) { emitted.push(value); options.emit?.(value); },
    });
    return observer;
  }
  return { ...geo, geo, realm, mod, resources, frames, timers, emitted, marked, imports, start,
    get observer() { return observer; }, get time() { return time; }, advance(ms) { time += ms; },
    frame() { const all = [...frames.values()]; frames.clear(); for (const fn of all) fn(time); },
    tick(ms = M.LIMITS.pollMs) { time += ms; const all = [...timers.values()]; timers.clear(); for (const item of all) item.fn(); },
    project(camX = 0, camY = 0, zoom = 1, out) { return mod.Y.project(0, 0, camX, camY, zoom, geo.rect.width, geo.rect.height, out); },
  };
}
async function installed(options) { const h = observerHarness(options); h.start(); await drain(); assert.equal(h.observer.status().installed, true); return h; }
function sample(revision = 1, extra = {}) {
  const camera = nativeModule().Y;
  return { version: 1, galaxy: 'alpha', revision, observedAt: NOW,
    camera: { x: 0, y: 0, zoom: 1, sinTilt: camera.sinTilt, cosTilt: camera.cosTilt, L: camera.L, baseFocal: camera.baseFocal },
    viewport: { left: 19, top: 35, width: 1000, height: 700 }, ...extra };
}

test('waits for exact native script evidence, evaluated controls and completed game page', async () => {
  for (const mutate of [
    h => { h.resources[0].initiatorType = 'link'; h.document.controls = []; },
    h => { h.resources[0].initiatorType = 'fetch'; },
    h => { h.resources[0].responseEnd = 0; },
    h => { h.resources[0].name += '?preload=1'; },
    h => { h.resources[0].name = 'https://oldlight.io/assets/transits-new.js'; },
    h => { h.document.readyState = 'interactive'; },
    h => { h.document.controls = []; },
    h => { h.realm.location.pathname = '/play'; },
    h => { h.realm.location.origin = 'https://elsewhere.test'; },
    h => { h.stage.isConnected = false; },
    h => { h.document.stages.push(h.stage); },
  ]) {
    const h = observerHarness(); mutate(h); h.start(); await drain();
    assert.equal(h.imports.length, 0); assert.equal(h.observer.status().installed, false); h.observer.stop();
  }
  const h = observerHarness(); h.resources.length = 0; h.start(); await drain();
  h.resources.push({ name: M.ASSET, initiatorType: 'script', responseEnd: 30 }); h.tick(); await drain();
  assert.deepEqual(h.imports, [M.ASSET]); assert.equal(h.observer.status().installed, true); h.observer.stop();
});

test('evaluated native controls permit the modulepreload resource used by the verified Vite page', async () => {
  const h = observerHarness(); h.resources[0].initiatorType = 'link'; h.start(); await drain();
  assert.deepEqual(h.imports, [M.ASSET]); assert.equal(h.observer.status().installed, true);
  h.project(); h.frame(); assert.equal(h.emitted.length, 1); h.observer.stop();
});

test('forwards native this, exact arguments, out identity, mutations and thrown object', async () => {
  const thrown = { native: 'error' }, calls = [];
  const h = await installed({ nativeHook(args, calculate) {
    calls.push({ receiver: this, args: [...args] });
    if (args[0] === 999) throw thrown;
    return calculate.call(this, args);
  } });
  const camera = h.mod.Y, original = h.mod.J.prototype.project, out = { unchanged: true }, extra = { untouched: true };
  const args = [69, 40, 12, -30, .8, 1000, 700, out, extra];
  assert.equal(camera.project(...args), out); assert.equal(out.unchanged, true);
  assert.equal(calls[0].receiver, camera); assert.deepEqual(calls[0].args, args);
  assert.equal(camera.project.length, original.length); assert.equal(h.mod.J.prototype.project, original);
  const before = h.marked.length;
  assert.throws(() => camera.project(999, 0, 0, 0, 1, 1000, 700), err => err === thrown);
  assert.equal(h.marked.length, before);
  const foreign = new h.mod.J(); camera.project.call(foreign, 69, 40, 5, 9, 1, 1000, 700);
  assert.equal(calls.at(-1).receiver, foreign); assert.equal(h.marked.length, before);
  h.observer.stop(); assert.equal(camera.project, original); assert.equal(Object.hasOwn(camera, 'project'), false);
});

test('reentrant native calls retain native behavior and never replace latest nested camera with older outer arguments', async () => {
  let nested = false;
  const h = await installed({ nativeHook(args, calculate) {
    if (!nested) { nested = true; this.project(0, 0, 70, -25, .9, 1000, 700); nested = false; }
    return calculate.call(this, args);
  } });
  const out = h.project(10, 20, 1); h.frame();
  assert.equal(out.visible, true); assert.equal(h.emitted.length, 1);
  assert.equal(h.emitted[0].camera.x, 70); assert.equal(h.emitted[0].camera.y, -25); h.observer.stop();
});

test('observation callback failures cannot change native return or exception semantics', async () => {
  const h = await installed({ onPending() { throw new Error('blocked marker'); }, emit() { throw new Error('blocked port'); } });
  const out = {}; assert.equal(h.project(0, 0, 1, out), out); assert.equal(out.visible, true);
  assert.doesNotThrow(() => h.frame()); assert.equal(h.observer.status().observed, false); h.observer.stop();
});

test('one changed-camera publication per frame; hot path has no per-call geometry reads', async () => {
  const h = await installed(); const before = h.geo.reads;
  for (let n = 0; n < 5000; n++) h.project();
  assert.equal(h.geo.reads, before); assert.equal(h.frames.size, 1); assert.equal(h.marked.filter(Boolean).length, 1); assert.equal(h.emitted.length, 0);
  h.project(20); h.project(40); assert.equal(h.frames.size, 1); h.frame();
  assert.equal(h.emitted.length, 1); assert.equal(h.emitted[0].camera.x, 40);
  assert.equal(h.geo.reads - before, 1); h.observer.stop();
});

test('perspective matches native axial projection for pan, zoom, CSS offset and DPR 2', async () => {
  const h = await installed();
  for (const [x, y, zoom] of [[0, 0, 1], [120, -75, .6], [-800, 150, 1.3], [0, 2000, .8]]) {
    h.project(x, y, zoom); h.frame(); const snapshot = h.emitted.at(-1);
    for (const system of [{ q: 0, r: 0 }, { q: 3, r: -2 }, { q: -9, r: 1 }]) {
      const world = h.mod.et(system.q, system.r), native = h.mod.Y.project(world.x, world.y, x, y, zoom, 1000, 700);
      const point = M.projectPoint(system, snapshot);
      if (!native.visible) assert.equal(point, null);
      else {
        assert.ok(Math.abs(point.x - native.x - h.rect.left) < 1e-10);
        assert.ok(Math.abs(point.y - native.y - h.rect.top) < 1e-10);
        assert.equal(point.depth, native.depth); assert.equal(point.scale, native.scale);
      }
    }
  }
  h.observer.stop();
});

test('does not infer CSS camera from DPR backing pixels or foreign singleton calls', async () => {
  const h = await installed();
  h.mod.Y.project(0, 0, 0, 0, 1, h.stage.width, h.stage.height);
  h.mod.Y.project.call(new h.mod.J(), 0, 0, 0, 0, 1, 1000, 700);
  h.frame(); assert.equal(h.emitted.length, 0); assert.equal(h.observer.status().observed, false);
  h.project(); h.frame(); assert.equal(h.emitted.length, 1); h.observer.stop();
});

test('quiet verified view sends bounded heartbeat; resize waits for new matching native projection', async () => {
  const h = await installed(); h.project(); h.frame();
  h.tick(500); assert.equal(h.emitted.length, 1); h.frame();
  assert.equal(h.emitted.length, 2); assert.equal(h.emitted[1].observedAt, NOW + 500);
  h.rect.width = 1200; h.tick(); assert.equal(h.observer.status().observed, false);
  h.project(); h.frame(); assert.equal(h.emitted.at(-1).viewport.width, 1200); h.observer.stop();
});

test('invalidates navigation, hidden or ambiguous viewport and never calls native project itself', async () => {
  for (const change of [h => { h.realm.location.pathname = '/play'; }, h => { h.document.hidden = true; }, h => { h.document.stages.push(h.stage); }]) {
    let calls = 0; const h = await installed({ nativeHook(args, calculate) { calls++; return calculate.call(this, args); } });
    h.project(); h.frame(); change(h); h.tick();
    assert.equal(h.observer.status().observed, false); assert.equal(h.marked.at(-1), null); assert.equal(calls, 1); h.observer.stop();
  }
});

test('fails closed on changed export shape, readonly prototype, accessor camera and import failure', async () => {
  for (const change of [
    mod => { delete mod.Y; }, mod => { mod.J = class Other {}; }, mod => { mod.et = () => ({}); },
    mod => { Object.defineProperty(mod.J.prototype, 'project', { writable: false }); },
    mod => { Object.freeze(mod.Y); },
    mod => { Object.defineProperty(mod.Y, 'sinTilt', { get() { return .5; } }); },
    mod => { mod.Y.project = function project(a, b, c, d, e, f, g, h) {}; },
    mod => { mod.Y.baseFocal = NaN; },
  ]) {
    const mod = nativeModule(); change(mod); const before = Object.getOwnPropertyDescriptor(mod.Y || {}, 'project');
    const h = observerHarness({ module: mod }); h.start(); await drain();
    assert.equal(h.observer.status().installed, false); assert.equal(h.observer.status().reason, 'native-camera-shape-changed');
    assert.deepEqual(Object.getOwnPropertyDescriptor(mod.Y || {}, 'project'), before); h.observer.stop();
  }
  const h = observerHarness({ importError: new Error('cannot import') }); h.start(); await drain();
  assert.equal(h.observer.status().reason, 'native-camera-import-failed'); assert.equal(h.imports.length, 1); assert.equal(h.timers.size, 0); h.observer.stop();
});

test('stop restores exact own descriptor but preserves a later third-party hook', async () => {
  const mod = nativeModule(); Object.defineProperty(mod.Y, 'project', { configurable: true, writable: true, enumerable: true, value: mod.J.prototype.project });
  const descriptor = Object.getOwnPropertyDescriptor(mod.Y, 'project'), h = await installed({ module: mod });
  h.observer.stop(); h.observer.stop(); assert.deepEqual(Object.getOwnPropertyDescriptor(mod.Y, 'project'), descriptor);
  const other = await installed(); const thirdParty = function thirdParty() {};
  other.mod.Y.project = thirdParty; other.tick(); assert.equal(other.observer.status().reason, 'camera-hook-replaced');
  other.observer.stop(); assert.equal(other.mod.Y.project, thirdParty); assert.equal(other.frames.size, 0); assert.equal(other.timers.size, 0);
});

test('late import after stop cannot install a hook', async () => {
  const h = observerHarness(); h.start(); h.observer.stop(); await drain();
  assert.equal(h.observer.status().installed, false); assert.equal(Object.hasOwn(h.mod.Y, 'project'), false);
});

function bridgeHarness({ injectionFailure = false, rootAvailable = true } = {}) {
  const geo = geometry(), timers = new Map(), channels = [], nodes = [], scripts = [], handoffs = [];
  let serial = 0, time = NOW, page, stopped = 0, watcher;
  class Port {
    constructor() { this.listeners = new Set(); this.closed = false; }
    addEventListener(type, fn) { this.listeners.add(fn); } removeEventListener(type, fn) { this.listeners.delete(fn); }
    start() {} close() { this.closed = true; }
    postMessage(data) { if (!this.closed && !this.peer.closed) for (const fn of [...this.peer.listeners]) fn({ data }); }
  }
  class MessageChannel {
    constructor() { this.port1 = new Port(); this.port2 = new Port(); this.port1.peer = this.port2; this.port2.peer = this.port1; channels.push(this); }
  }
  const parent = { appendChild(node) { node.isConnected = true; } }, document = geo.document;
  Object.assign(document, { documentElement: rootAvailable ? parent : null, head: null,
    createElement() {
      const node = { isConnected: false, attributes: new Map(), listeners: new Set(),
        remove() { this.isConnected = false; },
        getAttribute(name) { return this.attributes.get(name) ?? null; }, setAttribute(name, value) { this.attributes.set(name, String(value)); }, removeAttribute(name) { this.attributes.delete(name); },
        addEventListener(type, fn) { this.listeners.add(fn); }, removeEventListener(type, fn) { this.listeners.delete(fn); },
        dispatchEvent(event) { event.target = this; handoffs.push({ connected: this.isConnected, event }); for (const fn of [...this.listeners]) fn(event); },
      }; nodes.push(node); return node;
    },
  });
  const realm = { document, location: { origin: 'https://oldlight.io', pathname: '/game/galaxy/alpha' }, crypto: { randomUUID: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    setTimeout(fn) { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    MutationObserver: class { constructor(fn) { watcher = fn; } observe() {} disconnect() {} },
    postMessage() { throw new Error('No broadcast'); },
  };
  for (const key of ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'WebSocket', 'fetch', 'localStorage']) {
    Object.defineProperty(realm, key, { get() { throw new Error('Must not use ' + key); } });
  }
  page = vm.createContext({ document, MessageChannel, onStop: () => { stopped++; }, MessageEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } } });
  const observerSource = 'globalThis.OldLightReinforcementMap={installPageObserver(options){globalThis.observerOptions=options;return{stop(){onStop();}};}};';
  const map = M.create({ realm, document, now: () => time, observerSource,
    addElement(container, tag, attributes) {
      if (injectionFailure) throw new Error('CSP');
      assert.equal(tag, 'script'); scripts.push(attributes.textContent); document.currentScript = { parentNode: container };
      try { vm.runInContext(attributes.textContent, page); } finally { document.currentScript = null; }
    },
  });
  return { ...geo, realm, map, channels, nodes, scripts, handoffs, timers,
    pending(value) { page.observerOptions.onPending(value); },
    deliver(value) { channels[0].port1.postMessage(typeof value === 'string' ? value : JSON.stringify(value)); },
    send(value) { this.pending(value); this.deliver(value); }, advance(ms) { time += ms; },
    mount() { document.documentElement = parent; watcher(); }, get stopped() { return stopped; },
  };
}

test('detached one-shot MessageChannel bridge keeps private data and privileged APIs outside page code', () => {
  const h = bridgeHarness(); assert.equal(h.handoffs.length, 1); assert.equal(h.handoffs[0].connected, false);
  assert.equal(h.handoffs[0].event.bubbles, false); assert.equal(h.handoffs[0].event.composed, false);
  assert.equal(h.handoffs[0].event.ports[0], h.channels[0].port2); assert.equal(h.nodes[0].listeners.size, 0);
  assert.equal(/GM_|localStorage|sessionStorage|new WebSocket|window\.postMessage/.test(h.scripts[0]), false);
  assert.equal(h.map.projectSystem({ q: 0, r: 0 }, { scope }), null);
  const value = sample(); value.token = 'MUST_NOT_SURVIVE'; value.camera.name = 'MUST_NOT_SURVIVE';
  assert.equal(JSON.stringify(M.validateSnapshot(value)).includes('MUST_NOT_SURVIVE'), false);
  h.send(value); assert.equal(h.map.status().available, true);
  assert.equal(h.map.projectSystem({ q: 0, r: 0 }, { canvas: h.stage, rect: h.rect, scope }).x, 519);
  h.map.stop(); assert.equal(h.stopped, 1); assert.equal(h.channels[0].port1.closed, true); assert.equal(h.channels[0].port2.closed, true);
});

test('pending camera invalidates old geometry synchronously before delayed message delivery', () => {
  const h = bridgeHarness(); h.send(sample()); const system = { q: 0, r: 0 };
  assert.ok(h.map.projectSystem(system, { scope }));
  const next = sample(2); next.camera.x = 200; h.pending(next);
  assert.equal(h.map.projectSystem(system, { scope }), null); assert.equal(h.map.status().available, false);
  h.deliver(next); assert.ok(h.map.projectSystem(system, { scope }).x < 519);
  h.pending(null); assert.equal(h.map.projectSystem(system, { scope }), null); h.map.stop();
});

test('malformed, stale, future, out-of-order and wrong galaxy data revoke the cache', () => {
  for (const value of ['not json', 'x'.repeat(M.LIMITS.frame + 1), sample(1), sample(0), sample(2, { galaxy: 'beta' }), sample(2, { observedAt: NOW + 1 }), sample(2, { observedAt: NOW - 2000 }), { ...sample(2), camera: { ...sample().camera, zoom: 0 } }]) {
    const h = bridgeHarness(); h.send(sample()); h.deliver(value);
    assert.equal(h.map.projectSystem({ q: 0, r: 0 }, { scope }), null); h.map.stop();
  }
  const h = bridgeHarness(); h.send(sample()); h.channels[0].port1.postMessage({ ...sample(2) });
  assert.equal(h.map.status().available, false); h.map.stop();
});

test('content geometry fails closed on stale transport, resize, canvas replacement, navigation, and account scope change', () => {
  for (const mutate of [h => h.advance(1501), h => { h.rect.width += 1; }, h => { h.document.stages = [{ ...h.stage }]; }, h => { h.realm.location.pathname = '/play'; }, h => { h.document.hidden = true; }]) {
    const h = bridgeHarness(); h.send(sample()); mutate(h);
    assert.equal(h.map.projectSystem({ q: 0, r: 0 }, { scope }), null); h.map.stop();
  }
  const h = bridgeHarness(); h.send(sample()); assert.ok(h.map.projectSystem({ q: 0, r: 0 }, { scope }));
  assert.equal(h.map.projectSystem({ q: 0, r: 0 }, { scope: 'alpha/another-account' }), null);
  h.send(sample(2)); assert.ok(h.map.projectSystem({ q: 0, r: 0 }, { scope: 'alpha/another-account' })); h.map.stop();
});

test('hit test uses native client coordinates and rejects ambiguous, offstage or invalid points', () => {
  const h = bridgeHarness(), origin = { id: 'origin', q: 0, r: 0 }, target = { id: 'target', q: 3, r: 0 }; h.send(sample());
  assert.equal(h.map.hitTestSystem({ x: 519, y: 385 }, [origin, target]), origin);
  assert.equal(h.map.hitTestSystem({ x: 519, y: 385 }, [origin, { ...origin, id: 'duplicate' }]), null);
  assert.equal(h.map.hitTestSystem({ x: 0, y: 0 }, [origin]), null);
  assert.equal(h.map.hitTestSystem({ x: NaN, y: 385 }, [origin]), null);
  assert.equal(h.map.projectSystem({ q: Infinity, r: 0 }, { scope }), null);
  assert.equal(h.map.projectSystem(origin, { scope, canvas: {} }), null);
  assert.equal(h.map.projectSystem(origin, { scope, rect: { ...h.rect, width: 2000 } }), null); h.map.stop();
});

test('native unprojection never picks a nearby own system from an enemy or empty hex', () => {
  const h = bridgeHarness(), value = sample(), own = { id: 'own', q: 0, r: 0 }, enemy = { q: 0, r: 1 };
  value.camera.y = -1000; value.camera.zoom = .6; h.send(value);
  const ownPoint = M.projectPoint(own, value), enemyPoint = M.projectPoint(enemy, value);
  assert.ok(Math.hypot(ownPoint.x - enemyPoint.x, ownPoint.y - enemyPoint.y) < M.LIMITS.hitRadius);
  assert.deepEqual(M.unprojectHex(enemyPoint, value), enemy);
  assert.equal(h.map.hitTestSystem(enemyPoint, [own]), null);
  assert.equal(h.map.hitTestSystem(ownPoint, [own]), own);
  h.map.stop();
});

test('inverse axial geometry roundtrips pan and zoom and rejects perspective horizon', () => {
  for (const [x, y, zoom] of [[0, 0, 1], [300, -400, .6], [-700, -50, 1.3]]) {
    const value = sample(); Object.assign(value.camera, { x, y, zoom });
    for (const point of [{ q: 0, r: 0 }, { q: 4, r: -3 }, { q: -5, r: 7 }]) {
      assert.deepEqual(M.unprojectHex(M.projectPoint(point, value), value), point);
    }
  }
  const value = sample(), c = value.camera, v = value.viewport;
  const horizon = { x: v.left + v.width / 2, y: v.top + v.height / 2 - c.baseFocal * c.zoom * c.sinTilt / c.cosTilt };
  assert.equal(M.unprojectHex(horizon, value), null);
  assert.equal(M.unprojectHex({ ...horizon, y: horizon.y - 1 }, value), null);
});

test('missing DOM root waits once, CSP failure remains unavailable, and stop is idempotent', () => {
  const h = bridgeHarness({ rootAvailable: false }); assert.equal(h.handoffs.length, 0); h.mount(); h.mount(); assert.equal(h.handoffs.length, 1); h.map.stop(); h.map.stop();
  const blocked = bridgeHarness({ injectionFailure: true }); assert.equal(blocked.map.status().available, false); assert.equal(blocked.map.status().reason, 'camera-injection-unavailable'); blocked.map.stop();
});

test('production factory source is self-contained and refuses missing page capabilities without requests', () => {
  let script;
  const document = { documentElement: { appendChild(node) { node.isConnected = true; } }, createElement() { return { isConnected: false, remove() { this.isConnected = false; }, addEventListener() {}, removeEventListener() {}, removeAttribute() {} }; } };
  const realm = { document, crypto: { randomUUID: () => 'offline' }, setTimeout: () => 1, clearTimeout() {} };
  const map = M.create({ realm, document, addElement(container, tag, attributes) { script = attributes.textContent; } });
  assert.ok(script.includes(M.ASSET)); assert.doesNotThrow(() => new vm.Script(script));
  assert.equal(script.includes(SELF), false);
  const source = fs.readFileSync(require.resolve('../docs/reinforcement-map.js'), 'utf8');
  assert.equal(/fetch\s*\(|XMLHttpRequest|WebSocket|\.emit\s*\(|dispatchOrder|sessionStorage|localStorage/.test(source), false); map.stop();
});
