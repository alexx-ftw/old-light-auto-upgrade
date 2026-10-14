'use strict';
// Independent permission-bridge review. DOM, clocks, grants and realms here
// are local fixtures only: no browser, network, installation or game actions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const observer = require('../docs/empire-observer.js');
const bridgeModule = require('../docs/empire-bridge.js');
const root = path.join(__dirname, '..');
const NOW = 1791930000000;
const FIXED_SOURCE = `globalThis.OldLightEmpireObserver = Object.freeze({
  installPageObserver() { globalThis.installCount = (globalThis.installCount || 0) + 1; }
});`;

function fixture({ mode = 'sync', permission = true, source = FIXED_SOURCE, rootAvailable = true, setupPage = null } = {}) {
  let time = NOW, nextTimer = 0, watcher = null, changes = 0, privateReads = 0, page;
  const timers = new Map(), delayed = [], grantCalls = [], handoffs = [], elements = [], ports = [];
  const setTimeout = (fn, ms = 0) => { const id = ++nextTimer; timers.set(id, { fn, at: time + ms }); return id; };
  const clearTimeout = id => timers.delete(id);
  function advance(ms) {
    time += ms;
    let remaining = 100;
    while (true) {
      const pending = [...timers].find(([, item]) => item.at <= time);
      if (!pending) return;
      assert.ok(--remaining > 0, 'bounded fixture timers');
      const [id, item] = pending; timers.delete(id); item.fn();
    }
  }
  class Port {
    constructor() { this.listeners = new Map(); this.closed = false; this.started = false; ports.push(this); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    start() { this.started = true; }
    close() { this.closed = true; }
    postMessage(data) {
      setTimeout(() => {
        if (this.closed || this.peer.closed) return;
        for (const fn of [...this.peer.listeners.get('message') || []]) fn({ data });
      });
    }
  }
  class MessageChannel {
    constructor() { this.port1 = new Port(); this.port2 = new Port(); this.port1.peer = this.port2; this.port2.peer = this.port1; }
  }
  class Element {
    constructor(tag, isRoot = false) {
      this.tagName = tag.toUpperCase(); this.parentNode = null; this.children = [];
      this.handlers = new Map(); this.attributes = new Map(); this.textContent = ''; this.hidden = false; this.isRoot = isRoot;
      elements.push(this);
    }
    get parentElement() { return this.parentNode; }
    get isConnected() { return this.isRoot || this.parentNode?.isConnected === true; }
    appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
    removeChild(child) { assert.equal(child.parentNode, this); child.remove(); return child; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(fn); }
    removeEventListener(type, fn) { this.handlers.get(type)?.delete(fn); }
    dispatchEvent(event) {
      event.target = this; event.currentTarget = this;
      handoffs.push({ event, connected: this.isConnected, node: this });
      for (const fn of [...this.handlers.get(event.type) || []]) fn(event);
      return true;
    }
  }
  const docRoot = new Element('html', true);
  const document = { readyState: 'loading', documentElement: rootAvailable ? docRoot : null, head: null, currentScript: null,
    createElement: tag => new Element(tag),
    addEventListener() { throw new Error('Bootstrap must not expose its handoff on document'); },
  };
  const location = { pathname: '/game/galaxy/alpha', origin: 'https://oldlight.io' };
  const realm = { document, location, crypto: { randomUUID: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    setTimeout, clearTimeout,
    MutationObserver: class { constructor(fn) { watcher = fn; } observe() {} disconnect() { watcher = null; } },
    postMessage() { throw new Error('Bootstrap must not broadcast ports'); },
    addEventListener() { throw new Error('Bootstrap must not install a global handoff listener'); },
  };
  const pageGlobals = { document, location, MessageChannel, URL, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return time; } },
    MessageEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    postMessage() { throw new Error('Page must not broadcast ports'); },
    addEventListener() { throw new Error('Page must not install a global handoff listener'); },
  };
  for (const name of ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'localStorage', 'sessionStorage', 'unsafeWindow']) {
    for (const object of [realm, pageGlobals]) Object.defineProperty(object, name, { get() { privateReads++; throw new Error('Private access ' + name); } });
  }
  Object.defineProperty(realm, 'WebSocket', { get() { privateReads++; throw new Error('WebSocket must be read in page realm only'); } });
  page = vm.createContext(pageGlobals);
  if (setupPage) vm.runInContext(setupPage, page);
  function addElement(parent, tag, attrs) {
    assert.equal(tag, 'script');
    assert.equal(parent.tagName, 'DIV'); assert.equal(parent.hidden, true); assert.equal(parent.isConnected, true);
    assert.ok(parent.handlers.get('oldlight-empire-bootstrap')?.size, 'direct listener must predate granted insertion');
    assert.deepEqual(Object.keys(attrs).sort(), ['textContent'], 'grant accepts no external URL or event code attribute');
    const script = new Element(tag); script.textContent = attrs.textContent;
    grantCalls.push({ parent, tag, attrs, script });
    if (mode === 'throw') throw new Error('Synthetic granted insertion failure');
    const execute = () => {
      parent.appendChild(script); document.currentScript = script;
      try { vm.runInContext(script.textContent, page); } finally { document.currentScript = null; }
    };
    if (mode === 'sync' || mode === 'execute-then-throw') execute();
    if (mode === 'execute-then-throw') throw new Error('Synthetic failure after page execution');
    else if (mode === 'deferred') delayed.push(execute);
    return script;
  }
  const app = bridgeModule.create({ realm, document, observer, observerSource: source,
    addElement: permission ? addElement : undefined, now: () => time, onChange: () => changes++ });
  return { app, realm, document, page, grantCalls, handoffs, elements, ports, timers, advance,
    executeDelayed() { for (const fn of delayed.splice(0)) fn(); },
    mountRoot() { document.documentElement = docRoot; watcher?.(); },
    get changes() { return changes; }, get privateReads() { return privateReads; },
  };
}

test('grant review: missing permission fails closed without inline fallback or DOM exposure', () => {
  const h = fixture({ permission: false });
  assert.equal(h.app.status().installed, false); assert.equal(h.app.snapshot(), null);
  assert.equal(h.app.status().reason, 'observer-permission-unavailable');
  assert.equal(h.grantCalls.length, 0); assert.equal(h.handoffs.length, 0);
  assert.equal(h.elements.filter(node => node.tagName === 'SCRIPT').length, 0);
  assert.equal(h.privateReads, 0);
});

test('grant review: synchronous execution cannot race the preinstalled private listener', () => {
  const h = fixture();
  assert.equal(h.grantCalls.length, 1); assert.equal(h.handoffs.length, 1);
  assert.equal(h.app.status().installed, true); assert.equal(h.page.installCount, 1);
  const handoff = h.handoffs[0];
  assert.equal(handoff.node, h.grantCalls[0].parent); assert.equal(handoff.connected, false);
  assert.equal(handoff.event.bubbles, false); assert.equal(handoff.event.composed, false);
  assert.equal(handoff.event.ports.length, 1); assert.equal(handoff.node.handlers.get(handoff.event.type)?.size || 0, 0);
  assert.equal(h.privateReads, 0); assert.equal(h.app.snapshot(), null);
});

test('grant review: a delayed acknowledgment remains pending, then installs exactly once', () => {
  const h = fixture({ mode: 'deferred' });
  assert.equal(h.app.status().installed, false); assert.equal(h.app.snapshot(), null);
  assert.notEqual(h.app.status().reason, 'observer-injection-unavailable');
  h.advance(1000); h.executeDelayed();
  assert.equal(h.app.status().installed, true); assert.equal(h.handoffs.length, 1); assert.equal(h.page.installCount, 1);
  h.advance(10000); assert.equal(h.app.status().installed, true);
  assert.equal(h.grantCalls.length, 1);
});

test('grant review: throwing and silent insertions revoke authority and clean the private host', () => {
  for (const mode of ['throw', 'silent']) {
    const h = fixture({ mode }); h.advance(2001);
    assert.equal(h.app.status().installed, false); assert.equal(h.app.snapshot(), null);
    assert.equal(h.app.status().reason, 'observer-injection-unavailable');
    assert.equal(h.grantCalls[0].parent.isConnected, false);
    assert.equal(h.grantCalls[0].parent.handlers.get('oldlight-empire-bootstrap')?.size || 0, 0);
    assert.equal(h.timers.size, 0); assert.equal(h.privateReads, 0);
  }
});

test('grant review: an acknowledgment after timeout cannot resurrect the bridge', () => {
  const h = fixture({ mode: 'deferred' }); h.advance(2001);
  assert.equal(h.app.status().reason, 'observer-injection-unavailable');
  h.executeDelayed(); h.advance(0);
  assert.equal(h.app.status().installed, false); assert.equal(h.app.snapshot(), null);
  assert.equal(h.app.status().reason, 'observer-injection-unavailable');
  assert.equal(h.grantCalls[0].parent.isConnected, false);
  assert.equal(h.page.installCount, undefined);
});

test('grant review: stop before acknowledgment cleans listeners and cannot reopen a pipe', () => {
  const h = fixture({ mode: 'deferred' }); h.app.stop(); const priorChanges = h.changes;
  h.executeDelayed(); h.advance(10000);
  assert.equal(h.app.status().installed, false); assert.equal(h.app.snapshot(), null);
  assert.equal(h.changes, priorChanges); assert.equal(h.timers.size, 0);
  assert.equal(h.page.installCount, undefined);
  assert.equal(h.grantCalls[0].parent.isConnected, false);
  assert.equal(h.grantCalls[0].parent.handlers.get('oldlight-empire-bootstrap')?.size || 0, 0);
});

test('grant review: delayed root discovery grants exactly one insertion', () => {
  const h = fixture({ rootAvailable: false }); assert.equal(h.grantCalls.length, 0);
  h.mountRoot(); h.mountRoot();
  assert.equal(h.grantCalls.length, 1); assert.equal(h.app.status().installed, true);
});

test('grant review: injected source has no privileged capability or external script URL', () => {
  const h = fixture(); const text = h.grantCalls[0].attrs.textContent;
  assert.ok(text.includes(FIXED_SOURCE));
  assert.doesNotMatch(text, /GM_|unsafeWindow|localStorage|sessionStorage|XMLHttpRequest|fetch\s*\(|new WebSocket|window\.postMessage/);
  assert.equal(h.grantCalls[0].parent.attributes.size, 0);
});

function builtBootstrap() {
  const context = { __dirname: root, console: { log() {} }, require(name) {
    if (name === 'node:path') return path;
    assert.equal(name, 'node:fs'); return { readFileSync: fs.readFileSync.bind(fs), writeFileSync() {} };
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'build-empire.cjs'), 'utf8') + '\nthis.result = bootstrap;', context);
  return context.result;
}

test('grant review: bootstrap passes only the explicit permission and static observer to isolated bridge', () => {
  let supplied, calls = 0;
  const win = {}; win.top = win; win.self = win;
  const granted = () => { calls++; };
  const context = { window: win, location: { pathname: '/game/galaxy/alpha' }, document: { readyState: 'loading' },
    GM_addElement: granted, OldLightEmpireObserver: observer,
    OldLightEmpireBridgeFactory: { create(options) { supplied = options; return {}; } } };
  vm.runInNewContext(builtBootstrap(), context);
  assert.equal(typeof supplied.addElement, 'function');
  supplied.addElement(); assert.equal(calls, 1);
  assert.equal(supplied.observer, observer);
  assert.equal(supplied.observerSource, fs.readFileSync(path.join(root, 'docs/empire-observer.js'), 'utf8').trim());
  assert.equal(supplied.document, context.document);
  assert.equal(supplied.realm.document, context.document);
});

test('grant review: post-parse bootstrap passes the approved insertion capability privately', () => {
  for (const readyState of ['interactive', 'complete']) {
    const win = {}; win.top = win; win.self = win; let calls = 0;
    const granted = () => {};
    const context = { window: win, location: { pathname: '/game/galaxy/alpha' }, document: { readyState }, GM_addElement: granted,
      OldLightEmpireBridgeFactory: { create(options) { calls++; assert.equal(options.addElement, granted); return {}; } } };
    vm.runInNewContext(builtBootstrap(), context);
    assert.equal(calls, 1); assert.ok(context.OldLightEmpireBridge);
    assert.equal(context.OldLightEmpireBootstrapStatus().phase, 'attempted');
  }
});

test('grant review: a root discovered after parsing can install a passive observer', () => {
  const h = fixture({ rootAvailable: false }); h.document.readyState = 'interactive'; h.mountRoot();
  assert.equal(h.grantCalls.length, 1); assert.equal(h.app.status().installed, true);
  assert.equal(h.app.snapshot(), null); assert.equal(h.app.status().connected, false);
});

test('grant review: delayed page execution after parsing can install but grants no census', () => {
  const h = fixture({ mode: 'deferred' }); h.document.readyState = 'complete'; h.executeDelayed(); h.advance(2001);
  assert.equal(h.page.installCount, 1); assert.equal(h.app.status().installed, true);
  assert.equal(h.app.snapshot(), null); assert.equal(h.grantCalls[0].parent.isConnected, false);
});

test('grant review: observer installation failure never acknowledges an installed channel', () => {
  const h = fixture({ source: 'globalThis.OldLightEmpireObserver = { installPageObserver() { throw new Error("synthetic"); } };' });
  assert.equal(h.app.status().installed, false); assert.equal(h.handoffs.length, 0);
  assert.equal(h.ports.length, 2); assert.ok(h.ports.every(port => port.closed));
  h.advance(2001); assert.equal(h.app.status().reason, 'observer-injection-unavailable');
  assert.equal(h.app.snapshot(), null);
});

test('grant review: initial synchronous observer emission waits for a live content listener', () => {
  const reducer = observer.createReducer({ galaxy: 'alpha', now: () => NOW });
  const snapshot = reducer.snapshot();
  const h = fixture({ source: `globalThis.OldLightEmpireObserver = { installPageObserver({emit,onPending}) { const snapshot=${JSON.stringify(snapshot)};onPending(snapshot);emit({snapshot}); return {}; } };` });
  assert.equal(h.app.status().installed, true); h.advance(0);
  assert.deepEqual(h.app.snapshot(), snapshot);
  assert.equal(h.app.status().observed, true); assert.equal(h.app.status().connected, false);
  h.app.stop(); assert.equal(h.ports[1].closed, true); assert.equal(h.app.snapshot(), null);
});

test('grant review: connected-container and wrong-channel handoffs cannot claim the private pipe', () => {
  const h = fixture({ mode: 'deferred' }), parent = h.grantCalls[0].parent;
  parent.dispatchEvent({ type: 'oldlight-empire-bootstrap', data: 'oldlight_empire_' + 'c'.repeat(32), ports: [{}] });
  assert.equal(h.app.status().installed, false);
  parent.remove();
  parent.dispatchEvent({ type: 'oldlight-empire-bootstrap', data: 'wrong-channel', ports: [{}] });
  assert.equal(h.app.status().installed, false);
  h.app.stop();
});

test('grant review: real passive observer wraps only the page WebSocket realm', () => {
  const source = fs.readFileSync(path.join(root, 'docs/empire-observer.js'), 'utf8');
  const h = fixture({ source, setupPage: `
    const records = new WeakMap();
    class NativeSocket {
      constructor(url) { records.set(this, { url, state: 0, handler: null, listeners: new Map() }); }
      get url() { return records.get(this).url; }
      get readyState() { return records.get(this).state; }
      get onmessage() { return records.get(this).handler; }
      set onmessage(value) { records.get(this).handler = value; }
      addEventListener(type, fn) {
        const listeners = records.get(this).listeners;
        if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn);
      }
      removeEventListener(type, fn) { records.get(this).listeners.get(type)?.delete(fn); }
      send() { throw new Error('Passive observer must never send'); }
      close() { throw new Error('Passive observer must never close'); }
    }
    globalThis.WebSocket = NativeSocket;
    globalThis.CachedSocket = NativeSocket;
    globalThis.emitNative = (socket, data) => {
      for (const fn of [...records.get(socket).listeners.get('message') || []]) fn({ data, isTrusted: true });
    };
  ` });
  assert.equal(h.app.status().installed, true); assert.notEqual(h.page.WebSocket, h.page.CachedSocket);
  h.advance(0); assert.equal(h.app.snapshot().generation, 0);
  const socket = new h.page.CachedSocket('wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket');
  socket.onmessage = () => {}; h.advance(0);
  assert.equal(h.app.snapshot().generation, 1); assert.equal(h.app.snapshot().complete, false);
  assert.equal(h.privateReads, 0);
  assert.doesNotMatch(h.grantCalls[0].attrs.textContent, /GM_getValue|GM_setValue|GM_xmlhttpRequest|unsafeWindow|localStorage|sessionStorage/);
});


test('grant review: a grant throwing after successful execution closes and revokes its acknowledged pipe', () => {
  const h = fixture({ mode: 'execute-then-throw' });
  assert.equal(h.handoffs.length, 1); assert.equal(h.page.installCount, 1);
  assert.equal(h.app.status().installed, false); assert.equal(h.app.snapshot(), null);
  assert.equal(h.app.status().reason, 'observer-injection-unavailable');
  assert.equal(h.ports[1].closed, true); assert.equal(h.ports[1].listeners.get('message')?.size || 0, 0);
  assert.equal(h.grantCalls[0].parent.isConnected, false); assert.equal(h.timers.size, 0);
  h.advance(10000); assert.equal(h.app.status().installed, false); assert.equal(h.app.snapshot(), null);
});
