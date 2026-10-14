'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../docs/empire-observer.js'), 'utf8');
const SOCKET = 'wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket';
const SELF = '00000000-0000-4000-8000-000000000001';
const SYSTEM = '00000000-0000-4000-8000-000000000010';
const NOW = 1791930000000;
const initial = () => '42' + JSON.stringify(['world.init', {
  selfId: SELF, serverNow: NOW, world: { players: [{ id: SELF, transits: [], owned: [{
    id: SYSTEM, q: 1, r: 2, name: 'Synthetic system', buildings: [{ type: 'shipyard', level: 0 }], fleet: [],
    economy: { resources: { palladium: 0, iridium: 0, settledAt: new Date(NOW).toISOString() },
      paCap: 100, irCap: 100, paRatePerMin: 0, irRatePerMin: 0, energyCap: 0, energyUsed: 0,
      deficitMultiplier: 1, queueSlots: 1, queue: [] },
  }] }] },
}]);

function harness({ beforeInstall, changePrototype } = {}) {
  const records = new WeakMap(), sockets = [], emissions = [], sent = [], timers = new Map();
  let timerId = 0, control;
  const brandError = new TypeError('Illegal invocation');
  const setterError = new Error('Native setter rejection');
  const rejectValue = {};
  const record = socket => {
    const value = records.get(socket);
    if (!value) throw brandError;
    return value;
  };
  class NativeWebSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      records.set(this, { url, readyState: 0, handler: null, listeners: new Map(), sets: 0, closed: 0 });
      sockets.push(this);
    }
    addEventListener(type, fn) {
      const r = record(this);
      if (!r.listeners.has(type)) r.listeners.set(type, new Set());
      r.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) { record(this).listeners.get(type)?.delete(fn); }
    send(value) { sent.push(value); }
    close() { record(this).closed++; }
  }
  const nativeHandler = function (event) {
    const handler = record(this).handler;
    if (typeof handler === 'function') return Reflect.apply(handler, this, [event]);
  };
  Object.defineProperties(NativeWebSocket.prototype, {
    onmessage: { configurable: true, enumerable: true,
      get() { return record(this).handler; },
      set(value) {
        const r = record(this);
        if (value === rejectValue) throw setterError;
        r.sets++;
        r.handler = typeof value === 'function' ? value : null;
        if (r.handler) this.addEventListener('message', nativeHandler);
        else this.removeEventListener('message', nativeHandler);
      },
    },
    url: { configurable: true, enumerable: true, get() { return record(this).url; } },
    readyState: { configurable: true, enumerable: true, get() { return record(this).readyState; } },
  });
  changePrototype?.(NativeWebSocket.prototype);
  const originalHandler = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, 'onmessage');
  const originalSend = NativeWebSocket.prototype.send;
  const realm = { URL, Proxy, Reflect, Date, WebSocket: NativeWebSocket,
    location: { origin: 'https://oldlight.io', pathname: '/game/galaxy/alpha' },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(realm);
  vm.runInContext(source, realm);
  beforeInstall?.({ NativeWebSocket, records, sockets });
  control = realm.OldLightEmpireObserver.installPageObserver({ channel: 'cached_constructor_test',
    emit(value) { emissions.push(JSON.parse(JSON.stringify(value.snapshot))); } });
  const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  const dispatch = (socket, type, data, trusted = true) => {
    const event = { type, data, isTrusted: trusted };
    for (const fn of [...record(socket).listeners.get(type) || []]) Reflect.apply(fn, socket, [event]);
    flush();
    return event;
  };
  const observerListeners = socket => [...record(socket).listeners.get('message') || []].filter(fn => fn !== nativeHandler).length;
  return { realm, NativeWebSocket, records, sockets, emissions, sent, control, dispatch, observerListeners,
    originalHandler, originalSend, brandError, setterError, rejectValue };
}

test('cached constructor is discovered when Engine.IO assigns onmessage while CONNECTING', () => {
  const h = harness(), cachedConstructor = h.NativeWebSocket;
  assert.equal(h.sockets.length, 0);
  const socket = new cachedConstructor(SOCKET);
  assert.equal(h.control.status().generation, 0);
  socket.onmessage = () => {};
  assert.equal(h.control.status().generation, 1);
  h.dispatch(socket, 'message', initial());
  assert.equal(h.control.status().complete, true);
  assert.equal(h.control.status().systems.length, 1);
  assert.equal(h.sent.length, 0);
  assert.equal(h.NativeWebSocket.prototype.send, h.originalSend);
});

test('constructor and setter discovery share one generation and one listener', () => {
  const h = harness(), socket = new h.realm.WebSocket(SOCKET);
  socket.onmessage = () => {};
  socket.onmessage = () => {};
  assert.equal(h.control.status().generation, 1);
  assert.equal(h.observerListeners(socket), 1);
  h.dispatch(socket, 'message', initial());
  const before = h.control.status();
  socket.onmessage = null;
  socket.onmessage = () => {};
  assert.equal(h.control.status().generation, before.generation);
  assert.equal(h.control.status().epoch, before.epoch);
  assert.equal(h.control.status().complete, true);
});

test('native setter runs first and getter returns the exact callback with its original this', () => {
  const h = harness(), socket = new h.NativeWebSocket(SOCKET);
  let calls = 0, received;
  const callback = function (event) {
    calls++;
    assert.equal(this, socket);
    assert.equal(h.emissions.at(-1).complete, false);
    received = event;
  };
  socket.onmessage = callback;
  assert.equal(socket.onmessage, callback);
  assert.equal(h.records.get(socket).sets, 1);
  const event = h.dispatch(socket, 'message', initial());
  assert.equal(calls, 1);
  assert.equal(received, event);
  assert.equal(h.emissions.at(-1).complete, true);
});

test('native setter receiver and value errors are propagated unchanged without observing', () => {
  const h = harness(), setter = Object.getOwnPropertyDescriptor(h.NativeWebSocket.prototype, 'onmessage').set;
  assert.throws(() => Reflect.apply(setter, {}, [() => {}]), error => error === h.brandError);
  const socket = new h.NativeWebSocket(SOCKET);
  assert.throws(() => { socket.onmessage = h.rejectValue; }, error => error === h.setterError);
  assert.equal(h.control.status().generation, 0);
  assert.equal(h.observerListeners(socket), 0);
});

test('callback identity, return value and thrown error are not wrapped or swallowed', () => {
  const h = harness(), socket = new h.NativeWebSocket(SOCKET), error = new Error('Game callback');
  const callback = function () { assert.equal(this, socket); throw error; };
  socket.onmessage = callback;
  assert.equal(socket.onmessage, callback);
  assert.throws(() => Reflect.apply(socket.onmessage, socket, [{}]), value => value === error);
  const returns = () => 42;
  socket.onmessage = returns;
  assert.equal(socket.onmessage, returns);
  assert.equal(socket.onmessage(), 42);
});

test('reassigning an already observed old socket never displaces its replacement', () => {
  const h = harness(), old = new h.NativeWebSocket(SOCKET);
  old.onmessage = () => {};
  h.dispatch(old, 'message', initial());
  const current = new h.NativeWebSocket(SOCKET);
  current.onmessage = () => {};
  h.dispatch(current, 'message', initial());
  const before = h.control.status();
  old.onmessage = () => {};
  h.dispatch(old, 'message', '41');
  assert.equal(h.control.status().generation, before.generation);
  assert.equal(h.control.status().epoch, before.epoch);
  assert.equal(h.control.status().complete, true);
  assert.equal(h.observerListeners(old), 0);
  assert.equal(h.observerListeners(current), 1);
});

test('previously unobserved OPEN, CLOSING and CLOSED sockets cannot displace current state', () => {
  const h = harness(), current = new h.realm.WebSocket(SOCKET);
  h.dispatch(current, 'message', initial());
  const generation = h.control.status().generation;
  for (const state of [1, 2, 3]) {
    const old = new h.NativeWebSocket(SOCKET);
    h.records.get(old).readyState = state;
    Object.defineProperty(old, 'readyState', { get() { return 0; } });
    old.onmessage = () => {};
    assert.equal(h.observerListeners(old), 0);
  }
  assert.equal(h.control.status().generation, generation);
  assert.equal(h.control.status().complete, true);
});

test('a socket with handlers already registered before installation is not recovered', () => {
  const h = harness({ beforeInstall({ NativeWebSocket }) {
    const prior = new NativeWebSocket(SOCKET);
    prior.onmessage = () => {};
  } });
  h.dispatch(h.sockets[0], 'message', initial());
  assert.equal(h.control.status().generation, 0);
  assert.equal(h.control.status().complete, false);
  assert.equal(h.observerListeners(h.sockets[0]), 0);
});

test('cached-constructor route enforces strict native URL and ignores shadow properties', () => {
  const h = harness();
  for (const url of ['wss://example.com/socket.io/?EIO=4&transport=websocket',
    'ws://api.oldlight.io/socket.io/?EIO=4&transport=websocket', SOCKET + '&EIO=3',
    'wss://api.oldlight.io/socket.io/?EIO=4&transport=polling',
    'wss://api.oldlight.io:8443/socket.io/?EIO=4&transport=websocket']) {
    const socket = new h.NativeWebSocket(url);
    Object.defineProperty(socket, 'url', { get() { return SOCKET; } });
    socket.onmessage = () => {};
    assert.equal(h.observerListeners(socket), 0);
  }
  assert.equal(h.control.status().generation, 0);
  const game = new h.NativeWebSocket(SOCKET);
  Object.defineProperties(game, {
    url: { get() { throw Error('shadow URL read'); } },
    readyState: { get() { throw Error('shadow readyState read'); } },
  });
  assert.doesNotThrow(() => { game.onmessage = () => {}; });
  assert.equal(h.control.status().generation, 1);
});

test('trusted events are still required and unknown traffic does not expose content', () => {
  const h = harness(), socket = new h.NativeWebSocket(SOCKET);
  socket.onmessage = () => {};
  h.dispatch(socket, 'message', initial(), false);
  assert.equal(h.control.status().complete, false);
  h.dispatch(socket, 'message', '42["session.token",{"token":"SECRET"}]');
  assert.equal(JSON.stringify(h.emissions).includes('SECRET'), false);
  h.dispatch(socket, 'message', initial());
  assert.equal(h.control.status().complete, true);
});

test('socket closure is permanent for discovery and no send or close is performed', () => {
  const h = harness(), socket = new h.NativeWebSocket(SOCKET);
  socket.onmessage = () => {};
  h.dispatch(socket, 'message', initial());
  h.dispatch(socket, 'close');
  const generation = h.control.status().generation;
  socket.onmessage = () => {};
  assert.equal(h.control.status().generation, generation);
  assert.equal(h.control.status().complete, false);
  assert.equal(h.observerListeners(socket), 0);
  assert.equal(h.records.get(socket).closed, 0);
  assert.equal(h.sent.length, 0);
});

test('stop restores exact original accessor and preserves game callback', () => {
  const h = harness(), socket = new h.NativeWebSocket(SOCKET), callback = () => {};
  const activeDescriptor = Object.getOwnPropertyDescriptor(h.NativeWebSocket.prototype, 'onmessage');
  assert.equal(activeDescriptor.get, h.originalHandler.get);
  assert.equal(activeDescriptor.enumerable, h.originalHandler.enumerable);
  assert.equal(activeDescriptor.configurable, h.originalHandler.configurable);
  socket.onmessage = callback;
  h.control.stop();
  assert.deepEqual(Object.getOwnPropertyDescriptor(h.NativeWebSocket.prototype, 'onmessage'), h.originalHandler);
  assert.equal(socket.onmessage, callback);
  assert.equal(h.realm.WebSocket, h.NativeWebSocket);
  assert.equal(h.observerListeners(socket), 0);
  const after = new h.NativeWebSocket(SOCKET);
  after.onmessage = callback;
  assert.equal(h.observerListeners(after), 0);
});

test('stop never overwrites a later descriptor or constructor', () => {
  for (const replace of [d => ({ ...d, set(value) { return Reflect.apply(d.set, this, [value]); } }),
    d => ({ ...d, get() { return Reflect.apply(d.get, this, []); } }),
    d => ({ ...d, enumerable: !d.enumerable })]) {
    const h = harness(), prototype = h.NativeWebSocket.prototype;
    const later = replace(Object.getOwnPropertyDescriptor(prototype, 'onmessage'));
    Object.defineProperty(prototype, 'onmessage', later);
    class Later extends h.realm.WebSocket {}
    h.realm.WebSocket = Later;
    h.control.stop();
    assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, 'onmessage'), later);
    assert.equal(h.realm.WebSocket, Later);
    const socket = new Later(SOCKET);
    socket.onmessage = () => {};
    assert.equal(h.observerListeners(socket), 0);
  }
});

test('unavailable or nonconfigurable native accessors retain constructor-only fallback', () => {
  for (const changePrototype of [
    prototype => { delete prototype.onmessage; },
    prototype => Object.defineProperty(prototype, 'onmessage', { configurable: false }),
    prototype => Object.defineProperty(prototype, 'onmessage', { get: undefined }),
    prototype => Object.defineProperty(prototype, 'onmessage', { set: undefined }),
    prototype => { delete prototype.url; },
    prototype => { delete prototype.readyState; },
  ]) {
    const h = harness({ changePrototype });
    assert.deepEqual(Object.getOwnPropertyDescriptor(h.NativeWebSocket.prototype, 'onmessage'), h.originalHandler);
    const socket = new h.realm.WebSocket(SOCKET);
    h.dispatch(socket, 'message', initial());
    assert.equal(h.control.status().complete, true);
    h.control.stop();
  }
});
