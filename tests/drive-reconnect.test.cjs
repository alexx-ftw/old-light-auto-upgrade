'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');
const companionSource = fs.readFileSync(path.join(root, 'docs/drive.js'), 'utf8');
const PROTOCOL = 'old-light-drive-v1';
const GAME = 'https://oldlight.io';
const DRIVE = 'https://alexx-ftw.github.io';
const CLIENT = '123-test.apps.googleusercontent.com';
const ROUTE = 'old-light-drive:tab-link:v1';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function eventTarget() {
  const events = new Map();
  return { addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); },
    emit(type, event = {}) { for (const fn of events.get(type) || []) fn(event); },
    clear() { events.clear(); } };
}
function clock() {
  let now = 1_000_000, next = 1;
  const timers = new Map();
  function add(fn, delay, interval) { const id = next++; timers.set(id, { fn, delay, interval, due: now + delay }); return id; }
  return { Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, delay) => add(fn, delay, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => add(fn, delay, true), clearInterval: id => timers.delete(id),
    jump(ms) { now += ms; },
    fireIntervals(delay) { for (const timer of [...timers.values()]) if (timer.interval && timer.delay === delay) timer.fn(); },
    fireTimeouts() { for (const [id, timer] of [...timers]) if (!timer.interval && timer.due <= now) { timers.delete(id); timer.fn(); } },
    has(id) { return timers.has(id); },
    clear() { timers.clear(); }, now: () => now };
}
function ports() {
  const a = { closed: false, start() {}, close() { this.closed = true; } };
  const b = { closed: false, start() {}, close() { this.closed = true; } };
  a.postMessage = data => { if (a.closed) throw Error('closed'); queueMicrotask(() => { if (!b.closed) b.onmessage?.({ data }); }); };
  b.postMessage = data => { if (b.closed) throw Error('closed'); queueMicrotask(() => { if (!a.closed) a.onmessage?.({ data }); }); };
  return { port1: a, port2: b };
}
function node() { return Object.assign(eventTarget(), { value: '', checked: false, disabled: false, hidden: false, textContent: '', dataset: {},
  classList: { toggle() {}, add() {}, remove() {} }, replaceChildren() {}, append() {}, remove() {}, focus() {}, click() {}, setAttribute() {} }); }
function setup({ storedRoute, storageFailure = false } = {}) {
  const stored = new Map(storedRoute ? [[ROUTE, storedRoute]] : []);
  const gm = new Map([['old-light-auto-upgrade:drive:v1', { clientId: CLIENT, autoBackup: false, autoSync: false }]]);
  const gameRef = {}, driveRef = { closed: false, focus() {} };
  let game, drive, opened = 0, oauthRequests = 0;
  const common = { console, crypto: crypto.webcrypto, TextEncoder, TextDecoder, URL, URLSearchParams, Blob, Response,
    AbortController, Intl, MessageChannel: function () { return ports(); } };
  gameRef.postMessage = (data, origin) => { assert.equal(origin, GAME); queueMicrotask(() => game.window.emit('message', { origin: DRIVE, source: driveRef, data })); };
  driveRef.postMessage = (data, origin, transferred) => { assert.equal(origin, DRIVE); queueMicrotask(() => drive.window.emit('message', { origin: GAME, source: gameRef, data, ports: transferred || [] })); };
  function loadGame() {
    if (game) { game.window.clear(); game.time.clear(); }
    const time = clock(), window = eventTarget();
    window.open = () => { opened++; return driveRef; };
    const ctx = vm.createContext({ ...common, ...time, window, document: { createElement: node }, preferenceSync: null,
      sessionStorage: { getItem: key => { if (storageFailure) throw Error('storage'); return stored.get(key) || null; },
        setItem: (key, value) => { if (storageFailure) throw Error('storage'); stored.set(key, value); },
        removeItem: key => { if (storageFailure) throw Error('storage'); stored.delete(key); } },
      __get: (key, fallback) => gm.get(key) ?? fallback,
      __set: (key, value) => gm.set(key, value) });
    let body = source.slice(source.indexOf('  function createDriveBackup('), source.indexOf('  // END DRIVE BACKUP'));
    body = body.replace('return { mount, notifyChanged', 'return { testing: { openCompanion, closeSession, session: () => session }, mount, notifyChanged');
    vm.runInContext(body + `\nthis.api = createDriveBackup({ getBackup: () => ({}), applyBackup() {}, gmGetValue: __get, gmSetValue: __set });`, ctx);
    game = { window, time, api: ctx.api }; return game;
  }
  function loadDrive() {
    const time = clock(), window = eventTarget(), nodes = new Map(); window.opener = gameRef;
    window.google = { accounts: { oauth2: { initTokenClient() { return { requestAccessToken() { oauthRequests++; } }; }, hasGrantedAllScopes() { return true; } } } };
    const document = Object.assign(eventTarget(), { hidden: false, activeElement: null, head: { append() {} },
      getElementById: id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node });
    const nonce = game.api.testing.session().nonce;
    const ctx = vm.createContext({ ...common, ...time, window, document,
      location: { origin: DRIVE, pathname: '/old-light-auto-upgrade/drive.html', hash: '#bridge=' + nonce, search: '' }, history: { replaceState() {} },
      navigator: {}, fetch() { throw Error('Network must not be used in reconnect tests'); } });
    const instrumented = companionSource.replace('  beginBootstrap();', `
      globalThis.testing = {
        authorize() { token = 'test-memory-token'; account = { id: 'test-user' }; expiresAt = Date.now() + 3600000;
          expirationTimer = setTimeout(expireToken, 3600000); status('connected'); },
        state: () => ({ hasToken: Boolean(token), authorized: isAuthorized(), bridgeAlive, configReady, statusCode, connectionCode, authPending, dirty, autoTimer }),
        lose: () => loseBridge(), expire: expireToken,
      };
      beginBootstrap();`);
    drive = { window, time, nodes };
    vm.runInContext(instrumented, ctx); drive.api = ctx.testing; return drive;
  }
  loadGame();
  return { loadGame, loadDrive, get game() { return game; }, get drive() { return drive; }, stored, gm, gameRef, driveRef,
    opened: () => opened, oauthRequests: () => oauthRequests };
}
async function connected() {
  const env = setup(); env.game.api.testing.openCompanion(); env.loadDrive(); await flush();
  assert.equal(env.drive.api.state().bridgeAlive, true);
  env.drive.api.authorize(); await flush(); assert.equal(env.game.api.getStatus().code, 'connected'); return env;
}

test('game reload recovers the same authorized Drive window without OAuth or a new popup', async () => {
  const env = await connected(), nonce = env.stored.get(ROUTE);
  env.loadGame(); assert.equal(env.game.api.getStatus().code, 'bridge_reconnecting');
  env.drive.time.fireIntervals(3000); await flush();
  assert.equal(env.drive.api.state().authorized, true);
  assert.equal(env.game.api.getStatus().code, 'connected');
  assert.equal(env.stored.get(ROUTE), nonce); assert.equal(env.opened(), 1); assert.equal(env.oauthRequests(), 0);
});
test('a throttled companion heartbeat preserves the token and recovers after a new handshake', async () => {
  const env = await connected(); env.drive.time.jump(70000); env.drive.time.fireIntervals(10000); await flush();
  assert.equal(env.drive.api.state().hasToken, true); assert.equal(env.drive.api.state().authorized, false);
  env.drive.time.fireIntervals(3000); await flush();
  assert.equal(env.drive.api.state().authorized, true); assert.equal(env.game.api.getStatus().code, 'connected');
  assert.equal(env.oauthRequests(), 0);
});
test('a throttled game heartbeat detaches instead of revoking the active token', async () => {
  const env = await connected(); env.game.time.jump(70000); env.game.time.fireIntervals(1000); await flush();
  assert.equal(env.drive.api.state().hasToken, true);
  env.drive.time.fireIntervals(3000); await flush(); assert.equal(env.drive.api.state().authorized, true);
});
test('explicit disconnect clears the route and token and cannot reconnect by timer', async () => {
  const env = await connected(); env.game.api.testing.closeSession(); await flush();
  assert.equal(env.stored.has(ROUTE), false); assert.equal(env.drive.api.state().hasToken, false);
  env.drive.time.fireIntervals(3000); await flush(); assert.equal(env.game.api.getStatus().code, 'disconnected');
});
test('explicit disconnect gives terminal reopen guidance instead of promising automatic recovery', async () => {
  const env = await connected(); env.game.api.testing.closeSession(); await flush();
  assert.equal(env.drive.api.state().statusCode, 'disconnected');
  assert.equal(env.drive.nodes.get('connect').disabled, true);
  assert.match(env.drive.nodes.get('session-status').textContent, /vuelve a abrir Drive desde el helper/);
  assert.doesNotMatch(env.drive.nodes.get('session-status').textContent, /se recuperar[áa]|Mantén esta ventana abierta/);
  env.loadGame(); env.drive.time.jump(65000); env.drive.time.fireIntervals(3000); env.drive.time.fireTimeouts(); await flush();
  assert.equal(env.drive.api.state().hasToken, false);
  assert.equal(env.drive.api.state().bridgeAlive, false);
  assert.equal(env.drive.nodes.get('connect').disabled, true);
  assert.match(env.drive.nodes.get('session-status').textContent, /vuelve a abrir Drive desde el helper/);
});
test('temporary transport loss retains recovery guidance and the existing authorization', async () => {
  const env = await connected(); env.drive.api.lose(); await flush();
  assert.equal(env.drive.api.state().statusCode, 'bridge_reconnecting');
  assert.equal(env.drive.api.state().hasToken, true);
  assert.match(env.drive.nodes.get('session-status').textContent, /Recuperando el enlace/);
  assert.doesNotMatch(env.drive.nodes.get('session-status').textContent, /Cierra esta ventana/);
  env.drive.time.fireIntervals(3000); await flush();
  assert.equal(env.drive.api.state().authorized, true);
  assert.equal(env.drive.nodes.get('connect').disabled, false);
  assert.equal(env.oauthRequests(), 0);
});
test('closing the companion clears the route; a reload cannot claim a connection', async () => {
  const env = await connected(); env.driveRef.closed = true; env.game.time.fireIntervals(1000); await flush();
  assert.equal(env.stored.has(ROUTE), false); env.loadGame(); assert.equal(env.game.api.getStatus().code, 'disconnected');
});
test('expired Google authorization is never restored or renewed by reconnection', async () => {
  const env = await connected(); env.drive.api.expire(); env.loadGame(); env.drive.time.fireIntervals(3000); await flush();
  assert.equal(env.drive.api.state().authorized, false); assert.equal(env.drive.api.state().hasToken, false);
  assert.equal(env.game.api.getStatus().code, 'expired'); assert.equal(env.oauthRequests(), 0);
});
test('only a validated nonce is stored; no Google token, account or client enters tab routing storage', async () => {
  const env = await connected(); assert.equal(env.stored.size, 1); assert.match(env.stored.get(ROUTE), /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify([...env.stored, ...env.gm]), /test-memory-token|test-user/);
});
test('malformed remembered routing identifiers are ignored', () => {
  for (const storedRoute of ['wrong', 'a'.repeat(63), 'g'.repeat(64), JSON.stringify({ token: 'bad' })]) {
    const env = setup({ storedRoute }); assert.equal(env.game.api.testing.session(), null);
  }
});
test('missing companion shows a recoverable warning after the initial recovery deadline', () => {
  const env = setup({ storedRoute: 'a'.repeat(64) }); env.game.time.jump(21000); env.game.time.fireTimeouts();
  assert.equal(env.game.api.getStatus().code, 'bridge_lost');
  assert.equal(env.game.api.testing.session().ready, false);
});
test('blocked tab storage does not break the normal explicit connection', async () => {
  const env = setup({ storageFailure: true }); env.game.api.testing.openCompanion(); env.loadDrive(); await flush();
  env.drive.api.authorize(); await flush(); assert.equal(env.game.api.getStatus().code, 'connected');
});
test('helper rejects wrong origin, nonce, protocol and a changed source', async () => {
  const env = await connected(); env.game.api.testing.closeSession('bridge_lost'); await flush();
  const current = env.game.api.testing.session(), nonce = current.nonce;
  const base = { origin: DRIVE, source: env.driveRef, data: { protocol: PROTOCOL, type: 'ready', nonce } };
  for (const event of [{ ...base, origin: 'https://evil.example' }, { ...base, source: {} },
    { ...base, data: { ...base.data, nonce: 'b'.repeat(64) } }, { ...base, data: { ...base.data, protocol: 'bad' } }]) {
    env.game.window.emit('message', event); assert.equal(current.port, null);
  }
  env.drive.time.fireIntervals(3000); await flush(); assert.equal(current.ready, true);
});
test('companion rejects rebind attempts from a wrong origin, source or nonce', async () => {
  const env = await connected(); const nonce = env.game.api.testing.session().nonce;
  const base = { origin: GAME, source: env.gameRef, data: { protocol: PROTOCOL, type: 'port', nonce }, ports: [ports().port1] };
  for (const event of [{ ...base, origin: 'https://evil.example' }, { ...base, source: {} },
    { ...base, data: { ...base.data, nonce: 'b'.repeat(64) } }, { ...base, ports: [] }]) {
    env.drive.window.emit('message', event); assert.equal(env.drive.api.state().authorized, true);
  }
  env.game.api.testing.closeSession(); await flush(); assert.equal(env.drive.api.state().hasToken, false, 'original private port remains in control');
});
test('a changed OAuth client on game reload invalidates the old token before any operation', async () => {
  const env = await connected(); env.gm.set('old-light-auto-upgrade:drive:v1', { clientId: '456-other.apps.googleusercontent.com', autoBackup: false, autoSync: false });
  env.loadGame(); env.drive.time.fireIntervals(3000); await flush();
  assert.equal(env.drive.api.state().hasToken, false); assert.equal(env.drive.api.state().authorized, false);
  assert.equal(env.oauthRequests(), 0);
});

test('explicit disconnect after transport loss clears the token through its authenticated window route', async () => {
  const env = await connected(); env.game.api.testing.closeSession('bridge_lost'); await flush();
  assert.equal(env.drive.api.state().hasToken, true);
  env.game.api.testing.closeSession(); await flush();
  assert.equal(env.drive.api.state().hasToken, false); assert.equal(env.stored.has(ROUTE), false);
  env.drive.time.fireIntervals(3000); await flush(); assert.equal(env.drive.api.state().bridgeAlive, false);
});
test('cancelling recovery before the companion returns rejects its handshake and closes authorization', async () => {
  const env = await connected(); env.loadGame(); env.game.api.testing.closeSession(); await flush();
  env.drive.time.fireIntervals(3000); await flush();
  assert.equal(env.drive.api.state().hasToken, false); assert.equal(env.game.api.getStatus().code, 'disconnected');
});
test('Drive can close its own Google session even when the game bridge is absent', async () => {
  const env = await connected(); env.drive.api.lose(); await flush();
  assert.equal(env.drive.nodes.get('disconnect').disabled, false);
  env.drive.nodes.get('disconnect').emit('click'); await flush(); assert.equal(env.drive.api.state().hasToken, false);
});
test('an explicit window disconnect rejects a wrong origin, source or nonce', async () => {
  const env = await connected(), nonce = env.game.api.testing.session().nonce;
  const base = { origin: GAME, source: env.gameRef, data: { protocol: PROTOCOL, type: 'disconnect', nonce }, ports: [] };
  for (const event of [{ ...base, origin: 'https://evil.example' }, { ...base, source: {} },
    { ...base, data: { ...base.data, nonce: 'b'.repeat(64) } }]) {
    env.drive.window.emit('message', event); assert.equal(env.drive.api.state().authorized, true);
  }
});
test('a pending automatic backup gets a real new timer after recovery even with settings sync disabled', async () => {
  const env = await connected();
  env.game.api.importConfig({ ...env.game.api.exportConfig(), autoBackup: true, autoSync: false }); await flush();
  env.game.api.notifyChanged(); await flush();
  assert.equal(env.drive.api.state().dirty, true);
  assert.equal(env.drive.time.has(env.drive.api.state().autoTimer), true);
  env.game.api.testing.closeSession('bridge_lost'); await flush();
  assert.equal(env.drive.time.has(env.drive.api.state().autoTimer), false);
  env.drive.time.fireIntervals(3000); await flush();
  assert.equal(env.drive.api.state().dirty, true); assert.equal(env.drive.api.state().authorized, true);
  assert.equal(env.drive.time.has(env.drive.api.state().autoTimer), true);
});
