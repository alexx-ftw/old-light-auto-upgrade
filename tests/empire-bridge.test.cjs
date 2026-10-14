'use strict';
// Transport/lifecycle fixtures only. No real page, socket, network, or GM API.
// A detached element contains the one-shot port handoff. This does not defend
// against pre-compromised page built-ins or authenticate a hostile game origin.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const observer = require('../docs/empire-observer.js');
const bridge = require('../docs/empire-bridge.js');
const SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SYSTEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = 1791930000000;

function validSnapshot() {
  const reducer = observer.createReducer({ galaxy: 'alpha', now: () => NOW });
  const token = reducer.beginConnection();
  reducer.ingest('42' + JSON.stringify(['world.init', { selfId: SELF, serverNow: NOW, config: { version: 'test' },
    world: { players: [{ id: SELF, transits: [], credits: null, owned: [{ id: SYSTEM, q: 0, r: 0, name: 'Sede',
      buildings: [{ type: 'shipyard', level: 0 }], fleet: [],
      economy: { resources: { palladium: 10, iridium: 5, settledAt: new Date(NOW).toISOString() },
        paCap: 100, irCap: 100, paRatePerMin: 0, irRatePerMin: 0, energyCap: 10, energyUsed: 1,
        deficitMultiplier: 1, queueSlots: 1, queue: [] } }] }] } }]), token);
  const value = reducer.snapshot(); assert.equal(value.complete, true); return value;
}

function harness({ rootAvailable = true, injectionFailure = false } = {}) {
  let changes = 0, removed = 0, observerDisconnected = false, watcher;
  const channels = [], scripts = [], handoffs = [], scriptNodes = [];
  class Port {
    constructor() { this.listeners = new Set(); this.closed = false; this.started = false; }
    addEventListener(type, fn) { assert.equal(type, 'message'); this.listeners.add(fn); }
    removeEventListener(type, fn) { this.listeners.delete(fn); }
    start() { this.started = true; }
    close() { this.closed = true; }
    postMessage(data) {
      if (!this.closed && !this.peer.closed) for (const fn of [...this.peer.listeners]) fn({ data });
    }
  }
  class MessageChannel {
    constructor() {
      this.port1 = new Port(); this.port2 = new Port(); this.port1.peer = this.port2; this.port2.peer = this.port1; channels.push(this);
    }
  }
  let page;
  const parent = { appendChild(container) { container.isConnected = true; } };
  function addElement(container, tag, attrs) {
    assert.equal(tag, 'script'); assert.equal(container.hidden, true);
    if (injectionFailure) throw new Error('CSP refused injection');
    const script = { textContent: attrs.textContent, parentNode: container };
    scripts.push(script.textContent); document.currentScript = script;
    try { vm.runInContext(script.textContent, page); } finally { document.currentScript = null; }
    return script;
  }
  const document = { readyState: 'loading', documentElement: rootAvailable ? parent : null, head: null,
    createElement(tag) {
      assert.equal(tag, 'div');
      const script = { textContent: '', isConnected: false, listeners: new Set(),
        remove() { removed++; this.isConnected = false; },
        addEventListener(type, fn) { this.listeners.add(fn); },
        removeEventListener(type, fn) { this.listeners.delete(fn); },
        dispatchEvent(event) {
          event.target = this;
          handoffs.push({ event, connected: this.isConnected });
          for (const fn of [...this.listeners]) fn(event);
        },
      };
      scriptNodes.push(script); return script;
    },
  };
  const timers = new Map(); let nextTimer = 0;
  const realm = { document, setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }, crypto: { randomUUID: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    location: { pathname: '/game/galaxy/alpha', origin: 'https://oldlight.io' },
    postMessage() { throw new Error('Do not broadcast the port to page-wide listeners.'); },
    MutationObserver: class {
      constructor(fn) { watcher = fn; }
      observe(node, opts) { assert.equal(node, document); assert.equal(opts.subtree, true); }
      disconnect() { observerDisconnected = true; }
    },
  };
  for (const key of ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'localStorage', 'sessionStorage', 'WebSocket']) {
    Object.defineProperty(realm, key, { get() { throw new Error('Bridge must not access ' + key); } });
  }
  page = vm.createContext({ document, MessageChannel,
    MessageEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  });
  const staticSource = 'globalThis.OldLightEmpireObserver = { installPageObserver() {} };';
  const app = bridge.create({ realm, document, observer, observerSource: staticSource, addElement, now: () => NOW, onChange: () => changes++ });
  return { app, realm, document, channels, scripts, handoffs, scriptNodes, staticSource,
    send: data => channels[0].port1.postMessage(typeof data === 'string' ? data : JSON.stringify(data)),
    sendRaw: data => channels[0].port1.postMessage(data),
    mountRoot() { document.documentElement = parent; watcher(); },
    get changes() { return changes; }, get removed() { return removed; }, get observerDisconnected() { return observerDisconnected; },
  };
}

test('early bootstrap transfers one bounded pipe without granting page privileged APIs', () => {
  const h = harness();
  assert.equal(h.app.snapshot(), null); assert.equal(h.app.status().observed, false);
  assert.equal(h.handoffs.length, 1); assert.equal(h.handoffs[0].connected, false);
  assert.equal(h.handoffs[0].event.ports.length, 1); assert.equal(h.handoffs[0].event.ports[0], h.channels[0].port2);
  assert.equal(h.handoffs[0].event.bubbles, false); assert.equal(h.handoffs[0].event.composed, false);
  assert.equal(h.handoffs[0].event.type, 'oldlight-empire-bootstrap'); assert.equal(h.scriptNodes[0].listeners.size, 0);
  assert.equal(h.scripts.length, 1); assert.ok(h.scripts[0].includes(h.staticSource));
  assert.ok(!/GM_|localStorage|sessionStorage|new WebSocket|window\.postMessage|\.send\(/.test(h.scripts[0]));
  assert.ok(h.removed >= 1);
});

test('bridge validates and copies a complete snapshot, dropping unrecognized secrets', () => {
  const h = harness(), value = validSnapshot(); value.token = 'MUST_NOT_SURVIVE'; value.extra = { password: 'MUST_NOT_SURVIVE' };
  h.send(value); assert.equal(h.app.snapshot().complete, true); assert.equal(h.app.status().connected, true);
  assert.equal(JSON.stringify(h.app.snapshot()).includes('MUST_NOT_SURVIVE'), false);
  const read = h.app.snapshot(); read.systems[0].name = 'mutated';
  assert.equal(h.app.snapshot().systems[0].name, 'Sede'); assert.equal(h.changes, 1);
});

test('malformed JSON, wrong scope and future observations clear a prior valid census', () => {
  for (const corrupt of [
    () => '{broken',
    value => ({ ...value, galaxy: 'beta', scope: 'beta/' + SELF }),
    value => ({ ...value, observedAt: NOW + 1001 }),
    value => ({ ...value, transitShips: { ...value.transitShips, probe: 1 } }),
  ]) {
    const h = harness(), value = validSnapshot(); h.send(value); h.send(corrupt(value));
    assert.equal(h.app.snapshot(), null); assert.equal(h.app.status().reason, 'invalid-observation');
  }
});

test('unexpected non-string or oversized data revokes rather than retains prior authority', () => {
  for (const data of [{}, null, 'x'.repeat(observer.LIMITS.frame + 1)]) {
    const h = harness(); h.send(validSnapshot()); h.sendRaw(data);
    assert.equal(h.app.snapshot(), null);
    assert.equal(h.app.status().reason, 'invalid-observation');
  }
});

test('out-of-order epochs and revisions revoke the observed state', () => {
  for (const old of [{ epoch: 1, revision: 4 }, { epoch: 0, revision: 10 }]) {
    const h = harness(), value = validSnapshot(); h.send({ ...value, revision: 5 }); h.send({ ...value, ...old });
    assert.equal(h.app.snapshot(), null);
    assert.ok(['out-of-order-observation', 'invalid-observation'].includes(h.app.status().reason));
    h.send({ ...value, epoch: 2, revision: 0 }); assert.equal(h.app.snapshot().epoch, 2);
  }
});

test('session loss replaces the cached connected state and notifies subscribers', () => {
  const h = harness(); let notices = 0;
  const unsubscribe = h.app.subscribe(() => notices++); h.app.subscribe(() => { throw new Error('view failed'); });
  h.send(validSnapshot());
  const reducer = observer.createReducer({ galaxy: 'alpha', now: () => NOW });
  reducer.beginConnection(); const disconnected = reducer.snapshot();
  h.send({ ...disconnected, epoch: 1, revision: 1 });
  assert.equal(h.app.status().connected, false); assert.equal(h.app.snapshot().complete, false);
  assert.equal(notices, 2); unsubscribe(); h.send({ ...disconnected, epoch: 1, revision: 2 }); assert.equal(notices, 2);
});

test('missing document root waits to inject exactly once when it becomes available', () => {
  const h = harness({ rootAvailable: false }); assert.equal(h.handoffs.length, 0);
  h.mountRoot(); h.mountRoot(); assert.equal(h.handoffs.length, 1); assert.equal(h.scripts.length, 1);
  assert.equal(h.observerDisconnected, true);
});

test('blocked injection never manufactures a connected observation', () => {
  const h = harness({ injectionFailure: true });
  assert.equal(h.handoffs.length, 0); assert.equal(h.app.snapshot(), null);
  assert.equal(h.app.status().reason, 'observer-injection-unavailable'); assert.equal(h.app.status().installed, false);
});

test('stop closes the pipe, clears data and prevents subsequent notifications', () => {
  const h = harness(); h.send(validSnapshot()); const count = h.changes;
  h.app.stop(); assert.equal(h.app.snapshot(), null);
  assert.equal(h.channels[0].port2.closed, true);
  h.send(validSnapshot()); assert.equal(h.app.snapshot(), null); assert.equal(h.changes, count); h.app.stop();
});
