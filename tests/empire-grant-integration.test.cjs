'use strict';
// End-to-end simulated realms: builder -> isolated bootstrap -> privileged
// insertion -> real page observer -> cached native constructor -> validated DTO.
// This is not a real-browser/CSP or Violentmonkey compatibility claim.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const NOW = 1791930000000;
const SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SOCKET = 'wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket';
const SECRET = 'SYNTHETIC_DRIVE_CREDENTIAL_MUST_NOT_CROSS';

function builtSource() {
  let output;
  const context = { __dirname: root, console: { log() {} }, require(name) {
    if (name === 'node:path') return path;
    assert.equal(name, 'node:fs');
    return { readFileSync: fs.readFileSync.bind(fs), writeFileSync(file, value) {
      assert.equal(file, path.join(root, 'old-light-auto-upgrade.user.js'));
      output = value;
    } };
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'build-empire.cjs'), 'utf8'), context);
  assert.equal(typeof output, 'string');
  return output;
}

function initFrame() {
  const system = (id, q) => ({ id, q, r: 2, name: 'Fixture ' + q, token: SECRET,
    buildings: [{ type: 'shipyard', level: 0 }], fleet: [{ type: 'probe', quantity: q }],
    economy: { resources: { palladium: 10, iridium: 20, settledAt: new Date(NOW).toISOString() },
      paCap: 100, irCap: 100, paRatePerMin: 0, irRatePerMin: 0,
      energyCap: 10, energyUsed: 1, deficitMultiplier: 1, queueSlots: 1, queue: [] } });
  return '42' + JSON.stringify(['world.init', { selfId: SELF, serverNow: NOW, token: SECRET,
    world: { token: SECRET, players: [
      { id: SELF, transits: [], token: SECRET, owned: [system(A, 1), system(B, 2)] },
      { id: OTHER, token: SECRET, owned: [] },
    ] } }]);
}

function harness({ grant = 'available', rootAvailable = true, readyState = 'loading',
  suppressPrivilegedExecution = false, embeddedOnly = false } = {}) {
  const tasks = new Map(), ports = [], deliveries = [], handoffs = [], scripts = [], gmCalls = [];
  const elements = [], domEvents = [], watchers = [], sockets = [], records = new WeakMap();
  const violations = [], directInlineAttempts = [], gameActions = [];
  let page, nextTask = 0, executingPrivileged = false;
  const schedule = fn => { tasks.set(++nextTask, fn); return nextTask; };
  const flush = () => {
    let count = 0;
    while (tasks.size) {
      assert.ok(++count < 100, 'bounded fixture queue');
      const [id, fn] = tasks.entries().next().value; tasks.delete(id); fn();
    }
  };
  const forbidden = name => { violations.push(name); throw new Error('Forbidden fixture capability: ' + name); };
  class Port {
    constructor() { this.listeners = new Set(); this.closed = false; }
    addEventListener(type, fn) { assert.equal(type, 'message'); this.listeners.add(fn); }
    removeEventListener(type, fn) { this.listeners.delete(fn); }
    start() {}
    close() { this.closed = true; }
    postMessage(data) {
      deliveries.push(data);
      schedule(() => {
        if (this.closed || this.peer.closed) return;
        for (const fn of [...this.peer.listeners]) fn({ data });
      });
    }
  }
  class MessageChannel {
    constructor() {
      this.port1 = new Port(); this.port2 = new Port();
      this.port1.peer = this.port2; this.port2.peer = this.port1; ports.push(this);
    }
  }
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.parentNode = null; this.children = [];
      this.textContent = ''; this.hidden = false; this.style = {}; this.attributes = new Map();
      this.listeners = new Map(); elements.push(this);
    }
    get isConnected() { return this === document.documentElement || Boolean(this.parentNode?.isConnected); }
    get parentElement() { return this.parentNode; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'hidden') this.hidden = true; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);
      this.parentNode = null;
    }
    appendChild(child) {
      child.remove(); child.parentNode = this; this.children.push(child);
      if (child.tagName === 'SCRIPT') {
        scripts.push(child);
        if (!executingPrivileged) {
          directInlineAttempts.push(child); throw new Error('Simulated CSP rejects direct inline scripts');
        }
        if (!suppressPrivilegedExecution) {
          document.currentScript = child;
          try { vm.runInContext(child.textContent, page); } finally { document.currentScript = null; }
        }
      }
      return child;
    }
    dispatchEvent(event) {
      event.target = this;
      handoffs.push({ event, connected: this.isConnected, target: this,
        remainingScripts: this.children.filter(node => node.tagName === 'SCRIPT').length,
        connectedScripts: scripts.filter(node => node.isConnected).length });
      for (const fn of [...this.listeners.get(event.type) || []]) fn(event);
      return true;
    }
    click() { gameActions.push('click'); throw new Error('No game action is permitted'); }
  }
  const document = { readyState, documentElement: null, head: null, currentScript: null,
    createElement: tag => new Element(tag),
    addEventListener(type, fn, options) { domEvents.push({ type, fn, options }); },
    removeEventListener() {},
    querySelector() { return forbidden('early DOM query'); },
    querySelectorAll() { return forbidden('early DOM query'); },
  };
  const documentRoot = new Element('html');
  if (rootAvailable) document.documentElement = documentRoot;
  const record = socket => { const value = records.get(socket); assert.ok(value, 'native socket receiver'); return value; };
  class NativeWebSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) { records.set(this, { url, readyState: 0, handler: null, listeners: new Map() }); sockets.push(this); }
    addEventListener(type, fn) {
      const r = record(this); if (!r.listeners.has(type)) r.listeners.set(type, new Set());
      r.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) { record(this).listeners.get(type)?.delete(fn); }
    send() { gameActions.push('send'); throw new Error('Observer must not send'); }
    close() { gameActions.push('close'); throw new Error('Observer must not close game sockets'); }
  }
  const nativeDispatch = function(event) { return Reflect.apply(record(this).handler, this, [event]); };
  Object.defineProperties(NativeWebSocket.prototype, {
    url: { configurable: true, get() { return record(this).url; } },
    readyState: { configurable: true, get() { return record(this).readyState; } },
    onmessage: { configurable: true, enumerable: true,
      get() { return record(this).handler; },
      set(value) {
        const r = record(this); r.handler = typeof value === 'function' ? value : null;
        if (r.handler) this.addEventListener('message', nativeDispatch);
        else this.removeEventListener('message', nativeDispatch);
      },
    },
  });
  const originalSend = NativeWebSocket.prototype.send;
  const originalOnmessage = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, 'onmessage');
  class Clock extends Date { static now() { return NOW; } }
  const location = { origin: 'https://oldlight.io', pathname: '/game/galaxy/alpha' };
  page = vm.createContext({ document, location, URL, Date: Clock, WebSocket: NativeWebSocket, MessageChannel,
    MessageEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    setTimeout: schedule, clearTimeout: id => tasks.delete(id), postMessage: () => forbidden('window broadcast'),
  });
  page.window = page; page.top = page; page.self = page;
  // The game caches the original constructor before any observer code executes.
  vm.runInContext('globalThis.cachedGameWebSocket = WebSocket;', page);
  const content = vm.createContext({ document, location, Date: Clock,
    setTimeout: schedule, clearTimeout: id => tasks.delete(id),
    crypto: { randomUUID: () => 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; this.active = false; watchers.push(this); }
      observe() { this.active = true; }
      disconnect() { this.active = false; }
    },
  });
  content.window = content; content.top = content; content.self = content;
  for (const [label, context] of [['page', page], ['content', content]]) {
    for (const name of ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'GM', 'localStorage',
      'sessionStorage', 'fetch', 'XMLHttpRequest']) {
      Object.defineProperty(context, name, { get() { return forbidden(label + ':' + name); } });
    }
  }
  const grantFailure = Object.create(null);
  for (const name of ['message', 'stack', 'name', 'cause']) {
    Object.defineProperty(grantFailure, name, { get() { return forbidden('exception:' + name); } });
  }
  if (grant !== 'missing') content.GM_addElement = (parent, tag, attributes) => {
    gmCalls.push({ parent, tag, attributes });
    assert.equal(parent.tagName, 'DIV'); assert.equal(parent.isConnected, true);
    assert.ok(parent.hidden || parent.style.display === 'none');
    assert.ok(parent.listeners.get('oldlight-empire-bootstrap')?.size, 'handoff is pre-listened');
    assert.equal(tag, 'script'); assert.deepEqual(Object.keys(attributes), ['textContent']);
    if (grant === 'throw') throw grantFailure;
    const script = document.createElement(tag); script.textContent = attributes.textContent;
    executingPrivileged = true;
    try { parent.appendChild(script); } finally { executingPrivileged = false; }
    return script;
  };
  const source = builtSource();
  const embedded = source.slice(source.indexOf('// BEGIN EMBEDDED EMPIRE MODULES'), source.indexOf('// END EMBEDDED EMPIRE MODULES'));
  vm.runInContext(embeddedOnly ? embedded : source, content);
  const fire = (socket, data, trusted = true) => {
    const event = { type: 'message', data, isTrusted: trusted };
    for (const fn of [...record(socket).listeners.get('message') || []]) Reflect.apply(fn, socket, [event]);
    flush(); return event;
  };
  return { content, page, document, documentRoot, domEvents, watchers, gmCalls, handoffs, scripts, ports,
    sockets, elements, records, deliveries, violations, directInlineAttempts, gameActions, originalSend,
    originalOnmessage, NativeWebSocket, flush, fire,
    get app() { return content.OldLightEmpireBridge; },
    diagnostic() { return content.OldLightEmpireBootstrapStatus(); },
    executeInsertedScript() {
      assert.equal(scripts.length, 1); document.currentScript = scripts[0];
      try { vm.runInContext(scripts[0].textContent, page); } finally { document.currentScript = null; }
    },
    mountRoot(state = document.readyState) {
      document.readyState = state; document.documentElement = documentRoot;
      for (const watcher of watchers) if (watcher.active) watcher.fn([]);
      flush();
    },
  };
}

test('real builder bootstraps through the isolated GM grant under simulated inline CSP', () => {
  const h = harness(); h.flush();
  assert.equal(h.gmCalls.length, 1); assert.equal(h.directInlineAttempts.length, 0);
  assert.equal(h.app.status().installed, true); assert.equal(h.app.status().connected, false);
  assert.equal(h.sockets.length, 0, 'bootstrap never creates a game socket');
  assert.equal(h.handoffs.length, 1);
  assert.equal(h.handoffs[0].connected, false);
  assert.equal(h.handoffs[0].target.tagName, 'DIV'); assert.equal(h.handoffs[0].connectedScripts, 0);
  assert.equal(h.handoffs[0].event.bubbles, false); assert.equal(h.handoffs[0].event.composed, false);
  assert.equal(h.handoffs[0].event.ports[0], h.ports[0].port2);
  assert.equal(h.handoffs[0].target.listeners.get('oldlight-empire-bootstrap').size, 0);
  assert.equal(vm.runInContext('typeof GM_addElement', h.page), 'undefined');
  assert.equal(h.page.OldLightEmpireBridge, undefined); assert.equal(h.page.OldLightEmpireBridgeFactory, undefined);
  assert.equal(h.documentRoot.children.length, 0, 'bootstrap nodes are removed');
  assert.equal(h.domEvents.length, 1); assert.equal(h.domEvents[0].type, 'DOMContentLoaded');
  assert.equal(h.domEvents[0].options.once, true);
  assert.deepEqual(h.violations, []); assert.deepEqual(h.gameActions, []);
});

test('constructor cached before generated bootstrap is observed at the native onmessage setter', () => {
  const h = harness(); h.flush();
  assert.equal(h.page.cachedGameWebSocket, h.NativeWebSocket);
  assert.notEqual(h.page.WebSocket, h.NativeWebSocket);
  assert.notEqual(Object.getOwnPropertyDescriptor(h.NativeWebSocket.prototype, 'onmessage').set, h.originalOnmessage.set);
  const socket = new h.page.cachedGameWebSocket(SOCKET);
  let callbacks = 0;
  const gameHandler = function(event) { callbacks++; assert.equal(this, socket); assert.equal(event.data, initFrame()); };
  socket.onmessage = gameHandler; h.flush();
  assert.equal(socket.onmessage, gameHandler); assert.equal(h.app.snapshot().generation, 1);
  assert.equal(h.app.snapshot().complete, false);
  h.fire(socket, initFrame());
  const snapshot = h.app.snapshot();
  assert.equal(callbacks, 1); assert.equal(snapshot.complete, true); assert.equal(snapshot.connected, true);
  assert.equal(snapshot.scope, 'alpha/' + SELF); assert.equal(snapshot.systems.length, 2);
  assert.deepEqual(Array.from(snapshot.systems, system => system.id), [A, B]);
  assert.equal(snapshot.transitShips.probe, 0);
  assert.equal(JSON.stringify(snapshot).includes(SECRET), false);
  assert.equal(h.deliveries.some(value => typeof value !== 'string' || value.includes(SECRET) || value.includes(OTHER)), false);
  snapshot.systems[0].name = 'changed'; assert.notEqual(h.app.snapshot().systems[0].name, 'changed');
  assert.equal(h.sockets.length, 1); assert.equal(h.NativeWebSocket.prototype.send, h.originalSend);
  assert.deepEqual(h.violations, []); assert.deepEqual(h.gameActions, []);
});

test('the fixture rejects direct inline injection while the privileged route succeeds', () => {
  const h = harness();
  const script = h.document.createElement('script'); script.textContent = 'globalThis.inlineExecuted = true;';
  assert.throws(() => h.documentRoot.appendChild(script), /Simulated CSP/);
  script.remove(); h.flush();
  assert.equal(h.page.inlineExecuted, undefined); assert.equal(h.app.status().installed, true);
  assert.equal(h.gmCalls.length, 1); assert.equal(h.directInlineAttempts.length, 1);
});

test('missing grant, throwing grant and absent page execution fail closed without inline fallback', () => {
  for (const options of [{ grant: 'missing' }, { grant: 'throw' }, { suppressPrivilegedExecution: true }]) {
    const h = harness(options); h.flush();
    assert.equal(h.app?.status().installed ?? false, false);
    assert.equal(h.app?.snapshot() ?? null, null);
    const diagnostic = h.diagnostic(), status = h.app?.status();
    assert.equal(status.reason, options.grant === 'missing' ? 'observer-permission-unavailable' : 'observer-injection-unavailable');
    assert.equal(JSON.stringify({ diagnostic, status }).includes(SECRET), false);
    assert.equal(h.directInlineAttempts.length, 0); assert.equal(h.handoffs.length, 0);
    assert.equal(h.sockets.length, 0); assert.deepEqual(h.violations, []); assert.deepEqual(h.gameActions, []);
    assert.equal(h.documentRoot.children.length, 0);
  }
});

test('a delayed document root installs once while still loading and updates live diagnostics', () => {
  const h = harness({ rootAvailable: false });
  assert.equal(h.gmCalls.length, 0); assert.equal(h.app.status().installed, false);
  assert.equal(h.app.snapshot(), null); assert.equal(h.diagnostic().readyState, 'loading');
  h.mountRoot(); h.mountRoot();
  assert.equal(h.gmCalls.length, 1); assert.equal(h.app.status().installed, true);
  assert.equal(h.watchers.some(watcher => watcher.active), false);
  assert.deepEqual(h.violations, []); assert.deepEqual(h.gameActions, []);
});

test('a root first observed after loading cannot install a late passive hook', () => {
  const h = harness({ rootAvailable: false });
  h.mountRoot('interactive'); h.mountRoot('complete');
  assert.equal(h.gmCalls.length, 0); assert.equal(h.app.status().installed, false);
  assert.equal(h.app.snapshot(), null); assert.equal(h.sockets.length, 0);
  assert.equal(h.app.status().reason, 'observer-started-late');
  assert.deepEqual(h.violations, []); assert.deepEqual(h.gameActions, []);
});

test('a privileged insertion executing after ACK timeout cannot revive observation', () => {
  const h = harness({ suppressPrivilegedExecution: true });
  h.flush(); assert.equal(h.app.status().reason, 'observer-injection-unavailable');
  h.executeInsertedScript(); h.flush();
  assert.equal(h.app.status().installed, false); assert.equal(h.app.snapshot(), null);
  assert.equal(h.page.WebSocket, h.NativeWebSocket); assert.equal(h.handoffs.length, 0);
  assert.equal(h.sockets.length, 0); assert.deepEqual(h.violations, []); assert.deepEqual(h.gameActions, []);
});

test('delayed privileged script execution after document loading never installs page hooks', () => {
  const h = harness({ suppressPrivilegedExecution: true });
  h.document.readyState = 'interactive'; h.executeInsertedScript(); h.flush();
  assert.equal(h.app.status().installed, false); assert.equal(h.app.snapshot(), null);
  assert.equal(h.page.WebSocket, h.NativeWebSocket); assert.equal(h.handoffs.length, 0);
  assert.equal(h.sockets.length, 0); assert.deepEqual(h.violations, []); assert.deepEqual(h.gameActions, []);
});

test('late initial bootstrap skips the grant and leaves its diagnostic immutable', () => {
  for (const readyState of ['interactive', 'complete']) {
    const h = harness({ readyState, embeddedOnly: true });
    assert.equal(h.app, undefined); assert.equal(h.gmCalls.length, 0);
    assert.equal(h.diagnostic().phase, 'late-start'); assert.equal(Object.isFrozen(h.diagnostic()), true);
    assert.equal(h.sockets.length, 0); assert.deepEqual(h.violations, []);
  }
});

test('a complete observed census does not enable the coordinator or issue game actions', () => {
  const h = harness(); h.flush();
  const socket = new h.page.cachedGameWebSocket(SOCKET); socket.onmessage = () => {};
  h.fire(socket, initFrame()); assert.equal(h.app.snapshot().complete, true);
  let writes = 0;
  const adapter = h.content.OldLightEmpireAdapter.create({ getWorld: () => h.app.snapshot(),
    getContext: () => null, getHudSnapshot: () => null, canNavigate: () => false,
    getObservationStatus: () => h.app.status(), now: () => NOW });
  const controller = h.content.OldLightEmpireRuntime.create({ core: h.content.OldLightEmpireCore, adapter,
    read: () => undefined, write() { writes++; }, now: () => NOW });
  assert.equal(adapter.isAvailable(), true);
  controller.update({ scope: 'alpha/' + SELF });
  assert.equal(controller.isEnabled(), false); assert.equal(controller.state().ready, false);
  assert.equal(controller.canAct({ scope: 'alpha/' + SELF, systemId: A, owned: true, settled: true, selectionCount: 1 }), false);
  assert.equal(writes, 0); assert.deepEqual(h.gameActions, []); assert.deepEqual(h.violations, []);
  adapter.dispose();
});
