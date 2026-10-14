'use strict';
// Independent cross-realm regression review. All sockets, DOM and ports below
// are fixtures; these tests never connect to the game or access private data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const observer = require('../docs/empire-observer.js');
const bridgeModule = require('../docs/empire-bridge.js');
const adapterModule = require('../docs/empire-adapter.js');
const observerSource = fs.readFileSync(require.resolve('../docs/empire-observer.js'), 'utf8');
const SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SYSTEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = 1791930000000;
const SOCKET = 'wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket';
const SECRET = 'PRIVATE_SYNTHETIC_FIXTURE_VALUE';
const init = () => '42' + JSON.stringify(['world.init', {
  selfId: SELF, serverNow: NOW, token: SECRET, world: { players: [{ id: SELF,
    transits: [], token: SECRET, owned: [{ id: SYSTEM, q: 1, r: 2, name: 'Fixture',
      buildings: [{ type: 'shipyard', level: 0 }], fleet: [], token: SECRET,
      economy: { resources: { palladium: 1, iridium: 2, settledAt: new Date(NOW).toISOString() },
        paCap: 100, irCap: 100, paRatePerMin: 0, irRatePerMin: 0,
        energyCap: 0, energyUsed: 0, deficitMultiplier: 1, queueSlots: 1, queue: [] } }] }] },
}]);

function harness() {
  const tasks = new Map(), channels = [], handoffs = [], scripts = [], received = [], errors = [];
  let nextTask = 0, privateReads = 0, page;
  const schedule = fn => { tasks.set(++nextTask, fn); return nextTask; };
  const flush = () => {
    let limit = 100;
    while (tasks.size) {
      assert.ok(--limit > 0, 'fixture task queue is bounded');
      const [key, fn] = tasks.entries().next().value; tasks.delete(key); fn();
    }
  };
  class Port {
    constructor() { this.listeners = new Set(); this.closed = false; }
    addEventListener(type, fn) { assert.equal(type, 'message'); this.listeners.add(fn); }
    removeEventListener(type, fn) { this.listeners.delete(fn); }
    start() {}
    close() { this.closed = true; }
    postMessage(data) {
      schedule(() => {
        if (this.closed || this.peer.closed) return;
        for (const fn of [...this.peer.listeners]) fn({ data });
      });
    }
  }
  class MessageChannel {
    constructor() {
      this.port1 = new Port(); this.port2 = new Port();
      this.port1.peer = this.port2; this.port2.peer = this.port1; channels.push(this);
    }
  }
  const parent = { appendChild(container) { container.isConnected = true; } };
  function addElement(container, tag, attrs) {
    assert.equal(tag, 'script');
    const script = { textContent: attrs.textContent, parentNode: container };
    scripts.push(script.textContent); document.currentScript = script;
    try { vm.runInContext(script.textContent, page); } finally { document.currentScript = null; }
    return script;
  }
  const document = { readyState: 'loading', documentElement: parent, head: null, currentScript: null,
    createElement(tag) {
      assert.equal(tag, 'div');
      return { textContent: '', isConnected: false, handlers: new Set(), attributes: new Map(),
        setAttribute(name, value) { this.attributes.set(name, String(value)); },
        getAttribute(name) { return this.attributes.get(name) ?? null; },
        removeAttribute(name) { this.attributes.delete(name); },
        remove() { this.isConnected = false; },
        addEventListener(type, fn) { this.handlers.add(fn); },
        removeEventListener(type, fn) { this.handlers.delete(fn); },
        dispatchEvent(event) {
          event.target = this;
          handoffs.push({ event, connected: this.isConnected });
          for (const fn of [...this.handlers]) fn(event);
        } };
    },
  };
  const pageGlobals = { document, URL, MessageChannel,
    MessageEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    location: { origin: 'https://oldlight.io', pathname: '/game/galaxy/alpha' },
    setTimeout: schedule, clearTimeout: key => tasks.delete(key),
    Date: class extends Date { static now() { return NOW; } },
    captureError: error => errors.push(error),
    postMessage() { throw new Error('Page-wide port broadcasting is forbidden'); },
  };
  const realm = { document, setTimeout: schedule, clearTimeout: key => tasks.delete(key), location: pageGlobals.location,
    crypto: { randomUUID: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } };
  for (const name of ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'localStorage', 'sessionStorage']) {
    for (const globals of [realm, pageGlobals]) Object.defineProperty(globals, name, {
      get() { privateReads++; throw new Error('Unexpected private API read: ' + name); },
    });
  }
  page = vm.createContext(pageGlobals);
  vm.runInContext(`
    const records = new WeakMap();
    class NativeSocket {
      constructor(url) { records.set(this, { url, state: 0, handler: null, listeners: new Map() }); }
      get url() { return records.get(this).url; }
      get readyState() { return records.get(this).state; }
      get onmessage() { return records.get(this).handler; }
      set onmessage(value) {
        const record = records.get(this);
        record.handler = typeof value === 'function' ? value : null;
        if (record.handler && !record.registered) {
          record.registered = true;
          this.addEventListener('message', event => {
            if (record.handler) Reflect.apply(record.handler, this, [event]);
          });
        }
      }
      addEventListener(type, fn) {
        const listeners = records.get(this).listeners;
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      }
      removeEventListener(type, fn) { records.get(this).listeners.get(type)?.delete(fn); }
      send() { throw new Error('Observation must never send'); }
      close() { throw new Error('Observation must never close'); }
    }
    this.WebSocket = NativeSocket;
    this.CachedSocket = NativeSocket;
    this.emitNative = (socket, data, isTrusted = true) => {
      const event = Object.freeze({ data, isTrusted, type: 'message' });
      for (const listener of [...records.get(socket).listeners.get('message') || []]) {
        try { Reflect.apply(listener, socket, [event]); } catch (error) { captureError(error); }
      }
    };
  `, page);
  const bridge = bridgeModule.create({ realm, document, observer, observerSource, addElement, now: () => NOW,
    onChange: () => received.push(bridge.snapshot()) });
  const adapter = adapterModule.create({ getWorld: () => bridge.snapshot(),
    getObservationStatus: () => bridge.status(), getContext: () => null,
    getHudSnapshot: () => null, canNavigate: () => false, now: () => NOW });
  const socket = () => new page.CachedSocket(SOCKET);
  return { page, bridge, adapter, socket, flush, received, handoffs, scripts, channels, errors,
    emit: (s, data = init(), trusted = true) => page.emitNative(s, data, trusted),
    get privateReads() { return privateReads; } };
}

test('review: cached native constructor reaches isolated adapter only after the game callback and asynchronous publication', () => {
  const h = harness(); h.flush();
  const s = h.socket(); let callbackDone = false;
  s.onmessage = function () {
    assert.equal(this, s); assert.equal(h.adapter.isAvailable(), false); callbackDone = true;
  };
  h.emit(s);
  assert.equal(callbackDone, true); assert.equal(h.adapter.isAvailable(), false);
  h.flush();
  assert.equal(h.adapter.isAvailable(), true); assert.equal(h.adapter.readRoster().systems.length, 1);
  assert.equal(h.errors.length, 0); assert.equal(h.privateReads, 0);
});

test('review: observed delta revokes all empire adapter authority before the pending port delivery', () => {
  const h = harness(), s = h.socket(); s.onmessage = () => {};
  h.emit(s); h.flush();
  assert.equal(h.adapter.isAvailable(), true);
  const revision = h.bridge.snapshot().revision;
  h.emit(s, '42' + JSON.stringify(['world.delta', { updated: { players: [{ id: SELF, owned: [], transits: [] }] } }]));
  assert.equal(h.bridge.snapshot(), null, 'the previous census is unusable immediately after the native event');
  assert.equal(h.bridge.status().connected, false);
  assert.equal(h.adapter.isAvailable(), false);
  assert.equal(h.adapter.readRoster(), null);
  assert.equal(h.adapter.readSnapshots(), null);
  assert.equal(h.adapter.readTransitCensus(), null);
  h.flush();
  assert.equal(h.bridge.snapshot().revision, revision + 1);
  assert.equal(h.adapter.isAvailable(), true);
  assert.equal(h.errors.length, 0); assert.equal(h.privateReads, 0);
});

test('review: page handoff is detached, non-bubbling and carries only projected game data', () => {
  const h = harness(), s = h.socket(); s.onmessage = () => {};
  h.emit(s); h.flush();
  assert.equal(h.handoffs.length, 1); assert.equal(h.handoffs[0].connected, false);
  assert.equal(h.handoffs[0].event.bubbles, false); assert.equal(h.handoffs[0].event.composed, false);
  assert.equal(h.handoffs[0].event.ports.length, 1); assert.equal(h.channels.length, 1);
  assert.equal(h.privateReads, 0); assert.equal(JSON.stringify(h.received).includes(SECRET), false);
  assert.doesNotMatch(h.scripts[0], /GM_getValue|GM_setValue|GM_xmlhttpRequest|localStorage|sessionStorage|unsafeWindow|window\.postMessage/);
});

test('review: reassigning onmessage inside the game callback does not reset the observed connection', () => {
  const h = harness(), s = h.socket(); let calls = 0;
  const replacement = () => { calls++; };
  s.onmessage = () => { calls++; s.onmessage = replacement; };
  h.emit(s); h.flush();
  assert.equal(s.onmessage, replacement); assert.equal(calls, 1);
  assert.equal(h.bridge.snapshot().generation, 1); assert.equal(h.adapter.isAvailable(), true);
  h.emit(s, '42["ignored.event",{}]'); h.flush();
  assert.equal(calls, 2); assert.equal(h.bridge.snapshot().generation, 1);
});

test('review: replacing a socket before its deferred census publishes clears authority until fresh init', () => {
  const h = harness(), old = h.socket(); old.onmessage = () => {};
  h.emit(old);
  const current = h.socket(); current.onmessage = () => {};
  old.onmessage = () => {};
  h.flush();
  assert.equal(h.bridge.snapshot().generation, 2); assert.equal(h.adapter.isAvailable(), false);
  assert.equal(h.received.some(snapshot => snapshot?.complete), false);
  h.emit(old); h.flush(); assert.equal(h.adapter.isAvailable(), false);
  h.emit(current); h.flush(); assert.equal(h.adapter.isAvailable(), true);
});

test('review: untrusted events and blocked port delivery cannot manufacture a ready census', () => {
  const h = harness(), s = h.socket(); s.onmessage = () => {};
  h.emit(s, init(), false); h.flush(); assert.equal(h.adapter.isAvailable(), false);
  h.bridge.stop(); h.emit(s); h.flush();
  assert.equal(h.bridge.snapshot(), null); assert.equal(h.adapter.isAvailable(), false);
  assert.equal(h.channels[0].port2.closed, true); assert.equal(h.privateReads, 0);
});
