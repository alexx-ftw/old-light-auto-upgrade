'use strict';
// Independent regression review: actual builder, isolated bridge, and page
// observer. All DOM/socket events are simulated; no live account is involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const NOW = 1791930000000;
const SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SYSTEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOCKET = 'wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket';

function initial({ complete = true } = {}) {
  const system = { id: SYSTEM, q: 1, r: 2, name: 'Late-start fixture',
    buildings: [{ type: 'shipyard', level: 0 }], fleet: [],
    economy: { resources: { palladium: 10, iridium: 20, settledAt: new Date(NOW).toISOString() },
      paCap: 100, irCap: 100, paRatePerMin: 0, irRatePerMin: 0, energyCap: 10,
      energyUsed: 1, deficitMultiplier: 1, queueSlots: 1, queue: [] } };
  return '42' + JSON.stringify(['world.init', { selfId: SELF, serverNow: NOW,
    world: { players: [{ id: SELF, owned: [system], ...(complete ? { transits: [] } : {}) }] } }]);
}
const delta = () => '42' + JSON.stringify(['world.delta', {
  updated: { players: [{ id: SELF, owned: [], transits: [] }] },
}]);

function buildInMemory() {
  let result;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'build-empire.cjs'), 'utf8'), {
    __dirname: root, console: { log() {} }, require(name) {
      if (name === 'node:path') return path;
      assert.equal(name, 'node:fs');
      return { readFileSync: fs.readFileSync.bind(fs), writeFileSync(file, content) {
        assert.equal(file, path.join(root, 'old-light-auto-upgrade.user.js'));
        result = content;
      } };
    },
  });
  assert.equal(typeof result, 'string');
  return result.slice(result.indexOf('// BEGIN EMBEDDED EMPIRE MODULES'),
    result.indexOf('// END EMBEDDED EMPIRE MODULES'));
}

function fixture(options = {}) {
  const { existingOpen = false, delayed = false, rootAvailable = true } = options;
  const readyState = Object.hasOwn(options, 'readyState') ? options.readyState : 'complete';
  let now = NOW, nextTimer = 0, page;
  const timers = new Map(), records = new WeakMap(), sockets = [], scripts = [], watchers = [];
  const effects = [], grants = [], deliveries = [];
  const forbidden = name => { effects.push(name); throw new Error('Forbidden: ' + name); };
  const later = (fn, ms = 0) => { timers.set(++nextTimer, { fn, at: now + ms }); return nextTimer; };
  const clear = id => timers.delete(id);
  function flush(ms = 0) {
    now += ms;
    let count = 0;
    while ([...timers.values()].some(timer => timer.at <= now)) {
      assert.ok(++count < 100, 'timer queue must settle');
      const [id, timer] = [...timers].find(([, value]) => value.at <= now);
      timers.delete(id); timer.fn();
    }
  }
  class Port {
    constructor() { this.listeners = new Set(); this.closed = false; }
    start() {}
    close() { this.closed = true; }
    addEventListener(type, fn) { assert.equal(type, 'message'); this.listeners.add(fn); }
    removeEventListener(type, fn) { this.listeners.delete(fn); }
    postMessage(data) {
      deliveries.push(data);
      later(() => { if (!this.closed && !this.peer.closed) for (const fn of this.peer.listeners) fn({ data }); });
    }
  }
  class MessageChannel {
    constructor() {
      this.port1 = new Port(); this.port2 = new Port();
      this.port1.peer = this.port2; this.port2.peer = this.port1;
    }
  }
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.listeners = new Map(); }
    get isConnected() { return this === document.documentElement || Boolean(this.parentNode?.isConnected); }
    appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    dispatchEvent(event) { event.target = this; for (const fn of [...this.listeners.get(event.type) || []]) fn(event); return true; }
    click() { forbidden('click'); }
  }
  const document = { readyState, currentScript: null, documentElement: null, head: null,
    createElement: tag => new Element(tag), querySelector: () => forbidden('DOM query'),
    querySelectorAll: () => forbidden('DOM query') };
  const html = new Element('html');
  if (rootAvailable) document.documentElement = html;
  const record = socket => { const result = records.get(socket); assert.ok(result, 'native receiver'); return result; };
  class NativeWebSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) { records.set(this, { url, readyState: 0, handler: null, listeners: new Map() }); sockets.push(this); }
    addEventListener(type, fn) { const r = record(this); if (!r.listeners.has(type)) r.listeners.set(type, new Set()); r.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { record(this).listeners.get(type)?.delete(fn); }
    send() { forbidden('send'); }
    close() { forbidden('close'); }
  }
  const gameListener = function(event) { return Reflect.apply(record(this).handler, this, [event]); };
  Object.defineProperties(NativeWebSocket.prototype, {
    url: { configurable: true, get() { return record(this).url; } },
    readyState: { configurable: true, get() { return record(this).readyState; } },
    onmessage: { configurable: true, enumerable: true,
      get() { return record(this).handler; },
      set(value) { const r = record(this); r.handler = typeof value === 'function' ? value : null;
        if (r.handler) this.addEventListener('message', gameListener); else this.removeEventListener('message', gameListener); },
    },
  });
  function fire(socket, data, trusted = true) {
    const event = { type: 'message', data, isTrusted: trusted, target: socket, currentTarget: socket };
    for (const fn of [...record(socket).listeners.get('message') || []]) Reflect.apply(fn, socket, [event]);
    flush();
  }
  let prior = null;
  if (existingOpen) {
    prior = new NativeWebSocket(SOCKET); prior.onmessage = () => {};
    record(prior).readyState = 1; fire(prior, initial());
  }
  const location = { origin: 'https://oldlight.io', pathname: '/game/galaxy/alpha', reload: () => forbidden('reload') };
  class Clock extends Date { static now() { return now; } }
  page = vm.createContext({ document, location, URL, Date: Clock, WebSocket: NativeWebSocket,
    MessageChannel, MessageEvent: class { constructor(type, value) { this.type = type; Object.assign(this, value); } },
    setTimeout: later, clearTimeout: clear, postMessage: () => forbidden('broadcast') });
  page.window = page; page.top = page; page.self = page;
  const content = vm.createContext({ document, location, Date: Clock,
    setTimeout: later, clearTimeout: clear,
    crypto: { randomUUID: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; this.active = false; watchers.push(this); }
      observe() { this.active = true; }
      disconnect() { this.active = false; }
    },
  });
  content.window = content; content.top = content; content.self = content;
  for (const realm of [page, content]) {
    for (const name of ['fetch', 'XMLHttpRequest', 'localStorage', 'sessionStorage',
      'GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'GM']) {
      Object.defineProperty(realm, name, { get() { return forbidden(name); } });
    }
  }
  function execute(script = scripts.at(-1)) {
    assert.ok(script); document.currentScript = script;
    try { vm.runInContext(script.textContent, page); } finally { document.currentScript = null; }
    flush();
  }
  content.GM_addElement = (parent, tag, attributes) => {
    grants.push(tag); assert.equal(tag, 'script'); assert.deepEqual(Object.keys(attributes), ['textContent']);
    assert.equal(parent.isConnected, true); assert.ok(parent.listeners.get('oldlight-empire-bootstrap')?.size);
    const script = document.createElement(tag); script.textContent = attributes.textContent;
    scripts.push(script); parent.appendChild(script); if (!delayed) execute(script); return script;
  };
  vm.runInContext(buildInMemory(), content); flush();
  return { page, content, document, records, sockets, prior, NativeWebSocket, effects,
    scripts, grants, deliveries, fire, flush, execute, watchers,
    get bridge() { return content.OldLightEmpireBridge; },
    mount(state) {
      document.readyState = state; document.documentElement = html;
      for (const watcher of watchers) if (watcher.active) watcher.fn([]);
      flush();
    },
  };
}

for (const readyState of ['loading', 'interactive', 'complete']) {
  test(`late-start review: ${readyState} installs passively before a future native socket`, () => {
    const h = fixture({ readyState });
    assert.equal(h.content.OldLightEmpireBootstrapStatus().phase, 'attempted');
    assert.equal(h.content.OldLightEmpireBootstrapStatus().readyState, readyState);
    assert.equal(h.bridge.status().installed, true); assert.equal(h.bridge.snapshot().complete, false);
    assert.equal(h.bridge.snapshot().generation, 0); assert.equal(h.sockets.length, 0);
    const socket = new h.NativeWebSocket(SOCKET); socket.onmessage = () => {};
    h.fire(socket, initial());
    assert.equal(h.bridge.snapshot().complete, true); assert.equal(h.bridge.snapshot().generation, 1);
    assert.equal(h.bridge.snapshot().scope, 'alpha/' + SELF); assert.equal(h.sockets.length, 1);
    assert.deepEqual(h.effects, []);
  });
}

test('late-start review: an existing OPEN socket and its lost init stay unavailable until a new native connection', () => {
  const h = fixture({ readyState: 'complete', existingOpen: true });
  assert.equal(h.sockets.length, 1); assert.equal(h.bridge.snapshot().generation, 0);
  assert.equal(h.bridge.snapshot().complete, false);
  // Reassigning the old game handler must not discover/recover an OPEN socket.
  h.prior.onmessage = () => {}; h.fire(h.prior, delta()); h.fire(h.prior, initial());
  assert.equal(h.bridge.snapshot().generation, 0); assert.equal(h.bridge.snapshot().complete, false);
  assert.equal(h.sockets.length, 1); assert.deepEqual(h.effects, []);
  const next = new h.NativeWebSocket(SOCKET); next.onmessage = () => {};
  h.fire(next, delta());
  assert.equal(h.bridge.snapshot().complete, false); assert.equal(h.bridge.snapshot().systems.length, 0);
  h.fire(next, initial());
  assert.equal(h.bridge.snapshot().complete, true); assert.equal(h.bridge.snapshot().generation, 1);
  assert.equal(h.sockets.length, 2); assert.deepEqual(h.effects, []);
});

test('late-start review: observed deltas never synthesize init, and only complete trusted init makes a census', () => {
  const h = fixture(), socket = new h.page.WebSocket(SOCKET);
  socket.onmessage = () => {};
  h.fire(socket, delta()); h.fire(socket, delta());
  assert.equal(h.bridge.snapshot().complete, false); assert.equal(h.bridge.snapshot().systems.length, 0);
  h.fire(socket, initial(), false);
  assert.equal(h.bridge.snapshot().complete, false); assert.equal(h.bridge.snapshot().epoch, 0);
  h.fire(socket, initial({ complete: false }));
  assert.equal(h.bridge.snapshot().complete, false); assert.equal(h.bridge.snapshot().reason, 'incomplete-data');
  h.fire(socket, initial());
  assert.equal(h.bridge.snapshot().complete, true); assert.equal(h.bridge.snapshot().epoch, 2);
  const next = new h.page.WebSocket(SOCKET); next.onmessage = () => {}; h.flush();
  assert.equal(h.bridge.snapshot().complete, false); assert.equal(h.bridge.snapshot().generation, 2);
  h.fire(socket, initial()); h.fire(next, delta());
  assert.equal(h.bridge.snapshot().complete, false);
  h.fire(next, initial()); assert.equal(h.bridge.snapshot().complete, true);
  assert.deepEqual(h.effects, []);
});

test('late-start review: a deferred root can install during interactive exactly once', () => {
  const h = fixture({ readyState: 'loading', rootAvailable: false });
  assert.equal(h.grants.length, 0); assert.equal(h.bridge.status().installed, false);
  h.mount('interactive'); h.mount('complete');
  assert.equal(h.grants.length, 1); assert.equal(h.bridge.status().installed, true);
  assert.equal(h.watchers.some(watcher => watcher.active), false);
  assert.equal(h.bridge.snapshot().complete, false); assert.equal(h.sockets.length, 0);
  assert.deepEqual(h.effects, []);
});

test('late-start review: injected script may execute after parsing but before its ACK timeout', () => {
  const h = fixture({ readyState: 'loading', delayed: true });
  h.document.readyState = 'complete'; h.execute();
  assert.equal(h.bridge.status().installed, true); assert.equal(h.bridge.snapshot().complete, false);
  const socket = new h.NativeWebSocket(SOCKET); socket.onmessage = () => {}; h.fire(socket, initial());
  assert.equal(h.bridge.snapshot().complete, true); assert.deepEqual(h.effects, []);
});

test('late-start review: changing document phase cannot revive an expired insertion', () => {
  const h = fixture({ readyState: 'loading', delayed: true });
  h.flush(2001); h.document.readyState = 'complete'; h.execute();
  assert.equal(h.bridge.status().installed, false); assert.equal(h.bridge.snapshot(), null);
  assert.equal(h.page.WebSocket, h.NativeWebSocket); assert.equal(h.sockets.length, 0);
  assert.equal(h.bridge.status().reason, 'observer-injection-unavailable'); assert.deepEqual(h.effects, []);
});

test('late-start review: unknown readiness never attempts privileged injection', () => {
  for (const readyState of [undefined, null, '', 'unexpected']) {
    const h = fixture({ readyState });
    assert.equal(h.bridge, undefined); assert.equal(h.grants.length, 0); assert.equal(h.sockets.length, 0);
    assert.equal(h.content.OldLightEmpireBootstrapStatus().phase, 'unavailable');
    assert.deepEqual(h.effects, []);
  }
});

test('late-start review: a root appearing with unknown readiness still fails closed', () => {
  const h = fixture({ readyState: 'loading', rootAvailable: false });
  h.mount('unexpected');
  assert.equal(h.grants.length, 0); assert.equal(h.bridge.status().installed, false);
  assert.equal(h.bridge.snapshot(), null); assert.equal(h.sockets.length, 0);
  assert.equal(h.watchers.some(watcher => watcher.active), false);
  assert.deepEqual(h.effects, []);
});

test('late-start review: delayed execution with unknown readiness cannot install page hooks', () => {
  const h = fixture({ readyState: 'loading', delayed: true });
  h.document.readyState = 'unexpected'; h.execute(); h.flush(2001);
  assert.equal(h.bridge.status().installed, false); assert.equal(h.bridge.snapshot(), null);
  assert.equal(h.page.WebSocket, h.NativeWebSocket); assert.equal(h.sockets.length, 0);
  assert.deepEqual(h.effects, []);
});
