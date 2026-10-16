'use strict';

// No real Google credentials, requests, browser windows, or game actions are used.
// The actual helper, private runtime, popup runtime and preference-sync core run in VMs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');
const companion = fs.readFileSync(path.join(root, 'docs/drive.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(root, 'docs/sync-core.js'), 'utf8');
const fixtureSource = fs.readFileSync(path.join(__dirname, 'drive-sync-core.test.cjs'), 'utf8');
const fixture = fixtureSource.slice(fixtureSource.indexOf('const BUILDINGS ='), fixtureSource.indexOf('const maybe ='));
const syncSource = source.slice(source.indexOf('  function createPreferenceSync('), source.indexOf('  // END SHARED PREFERENCES INTEGRATION'));
const CONFIG_KEY = 'old-light-auto-upgrade:drive:v1';
const AUTH_KEY = 'old-light-auto-upgrade:drive-authorization:v1';
const ROUTE = 'old-light-drive:tab-link:v1';
const GAME = 'https://oldlight.io';
const DRIVE = 'https://alexx-ftw.github.io';
const PROTOCOL = 'old-light-drive-v1';
const CLIENT = '123-fixture.apps.googleusercontent.com';
const OTHER_CLIENT = '456-fixture.apps.googleusercontent.com';
const TOKEN = 'FAKE_LOCAL_AUTHORIZATION_FOR_TESTS_ONLY';
const OTHER_TOKEN = 'FAKE_REPLACEMENT_AUTHORIZATION_FOR_TESTS_ONLY';
const ACCOUNT = 'fixture-account';
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 15; i++) await new Promise(setImmediate); };
async function waitFor(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(predicate(), label);
}

function eventTarget() {
  const handlers = new Map();
  return {
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
    emit(type, event = {}) { for (const fn of [...handlers.get(type) || []]) fn(event); },
    clear() { handlers.clear(); },
  };
}
function node() {
  const item = Object.assign(eventTarget(), {
    value: '', checked: false, disabled: false, hidden: false, textContent: '', dataset: {},
    children: [], classList: { toggle() {}, add() {}, remove() {} },
    replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); },
    remove() {}, focus() {}, setAttribute() {},
  });
  item.click = () => { if (!item.disabled) item.emit('click'); };
  return item;
}
function makeClock() {
  let now = 1_800_000_000_000, nextId = 1;
  const timers = new Map();
  function realm() {
    const owner = {};
    function add(fn, delay = 0, interval = false) {
      const id = nextId++; timers.set(id, { owner, fn, delay, interval, due: now + delay }); return id;
    }
    return {
      Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
      setTimeout: (fn, delay) => add(fn, delay), clearTimeout: id => timers.delete(id),
      setInterval: (fn, delay) => add(fn, delay, true), clearInterval: id => timers.delete(id),
      clear() { for (const [id, timer] of timers) if (timer.owner === owner) timers.delete(id); },
    };
  }
  return { realm, now: () => now,
    jump(ms) { now += ms; },
    intervals(delay) { for (const [id, timer] of [...timers]) if (timers.has(id) && timer.interval && timer.delay === delay) timer.fn(); },
    timeouts() { for (const [id, timer] of [...timers]) if (timers.has(id) && !timer.interval && timer.due <= now) { timers.delete(id); timer.fn(); } },
  };
}
function makePorts(log) {
  const a = { closed: false, start() {}, close() { this.closed = true; } };
  const b = { closed: false, start() {}, close() { this.closed = true; } };
  for (const [from, to, direction] of [[a, b, 'helper-to-popup'], [b, a, 'popup-to-helper']]) {
    from.postMessage = data => {
      if (from.closed) throw Error('Port closed');
      const copy = clone(data); log.push({ direction, data: copy });
      queueMicrotask(() => { if (!to.closed) to.onmessage?.({ data: clone(copy) }); });
    };
  }
  return { port1: a, port2: b };
}
function record(now, extra = {}) {
  return { version: 1, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', clientId: CLIENT,
    accessToken: TOKEN, expiresAt: now + 3_570_000, accountId: ACCOUNT, ...extra };
}
function setup(options = {}) {
  const clock = makeClock();
  const gm = new Map([[CONFIG_KEY, { clientId: CLIENT, autoBackup: false, autoSync: false }]]);
  if (options.savedAuthorization) gm.set(AUTH_KEY, record(clock.now(), options.savedAuthorization));
  const publicMessages = [], privateMessages = [], storageWrites = [], requests = [], statuses = [], runtimes = [];
  const pendingWrites = [], files = new Map(), tabs = [];
  let writeMode = options.writeMode || 'success', failRead = false;
  let aboutMode = options.aboutMode || ACCOUNT, aboutGate = null;
  let opened = 0, oauthRequests = 0, closed = 0;
  const read = (key, fallback) => {
    if (key === AUTH_KEY && failRead) throw Error('Simulated private storage read failure');
    return gm.has(key) ? clone(gm.get(key)) : clone(fallback);
  };
  const writeConfig = (key, value) => {
    assert.notEqual(key, AUTH_KEY, 'Credentials must use confirmed asynchronous GM.setValue');
    storageWrites.push({ async: false, key, value: clone(value) }); gm.set(key, clone(value));
  };
  const writeAuth = async (key, value) => {
    assert.equal(key, AUTH_KEY);
    storageWrites.push({ async: true, key, value: clone(value) });
    if (value && writeMode.startsWith('cache-first')) {
      gm.set(key, clone(value)); // Violentmonkey's readable cache changes before the async ACK.
      if (writeMode === 'cache-first-reject') throw Error('Simulated rejection after the cache changed');
      await new Promise((resolve, reject) => pendingWrites.push({ resolve, reject, key, value: clone(value) }));
      return undefined;
    }
    if (writeMode === 'reject') throw Error('Simulated async storage rejection');
    if (writeMode === 'false') return false;
    if (writeMode === 'no-write') return undefined;
    if (writeMode === 'deferred') {
      await new Promise((resolve, reject) => pendingWrites.push({ resolve, reject, key, value: clone(value) }));
    }
    gm.set(key, clone(value));
    return undefined;
  };
  async function fakeFetch(urlString, init) {
    const url = new URL(urlString);
    assert.equal(url.origin, 'https://www.googleapis.com', 'Fake transport must only receive Drive endpoints');
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.referrerPolicy, 'no-referrer');
    const request = { url: urlString, method: init.method, headers: clone(init.headers), body: init.body ? await init.body.text() : null };
    requests.push(request);
    if (url.pathname === '/drive/v3/about') {
      if (aboutGate) await aboutGate;
      if (aboutMode === 'unauthorized') return new Response('{}', { status: 401 });
      if (aboutMode === 'offline') throw Error('Simulated offline Google');
      return new Response(JSON.stringify({ user: aboutMode === 'missing' ? {} : {
        permissionId: aboutMode, displayName: 'Fixture User', emailAddress: 'fixture@example.test',
      } }));
    }
    if (url.pathname === '/drive/v3/files' && init.method === 'GET') {
      const q = url.searchParams.get('q') || '';
      const isSync = q.includes("key='syncFormat'");
      const found = [...files.values()].filter(file => Boolean(file.appProperties.syncFormat) === isSync);
      return new Response(JSON.stringify({ files: found }));
    }
    if (url.pathname === '/upload/drive/v3/files' && init.method === 'POST') {
      const boundary = /boundary=(.+)$/.exec(init.headers['Content-Type'])[1];
      const parts = request.body.split('--' + boundary).slice(1, -1)
        .map(part => JSON.parse(part.slice(part.indexOf('\r\n\r\n') + 4).trim()));
      const result = { ...parts[0], id: 'fixture_file_' + (files.size + 1), version: '1',
        size: String(Buffer.byteLength(JSON.stringify(parts[1]))),
        createdTime: '2026-10-13T12:00:00Z', modifiedTime: '2026-10-13T12:00:00Z' };
      files.set(result.id, result);
      return new Response(JSON.stringify(result));
    }
    throw Error('Unexpected fake Drive request: ' + init.method + ' ' + url.pathname);
  }
  const common = { console, crypto: crypto.webcrypto, TextEncoder, TextDecoder, URL, URLSearchParams,
    Blob, Response, AbortController, Intl, queueMicrotask, fetch: fakeFetch,
    MessageChannel: function () { return makePorts(privateMessages); } };
  function loadGame(previous) {
    if (previous) { previous.window.emit('beforeunload'); previous.api.destroy(); previous.window.clear(); previous.time.clear(); }
    const time = clock.realm(), window = eventTarget(), stored = new Map();
    const document = Object.assign(eventTarget(), { hidden: false, activeElement: null, createElement: node, createTextNode: value => ({ textContent: value }) });
    const gameRef = {};
    const tab = { window, document, time, stored, gameRef, popup: null, runtime: null };
    gameRef.postMessage = (data, origin) => {
      assert.equal(origin, GAME);
      publicMessages.push({ direction: 'popup-to-game', data: clone(data) });
      queueMicrotask(() => window.emit('message', { origin: DRIVE, source: tab.popup.ref, data: clone(data) }));
    };
    window.open = url => {
      opened++;
      const ref = { closed: false, focus() {}, close() {
        if (this.closed) return; this.closed = true; closed++;
        tab.popup.window?.emit('beforeunload'); tab.popup.time?.clear();
      } };
      tab.popup = { url, ref };
      ref.postMessage = (data, origin, ports = []) => {
        assert.equal(origin, DRIVE);
        publicMessages.push({ direction: 'game-to-popup', data: clone(data) });
        queueMicrotask(() => tab.popup.window?.emit('message', { origin: GAME, source: gameRef, data: clone(data), ports }));
      };
      return ref;
    };
    const ctx = vm.createContext({ ...common, ...time, window, document,
      ...(options.noGmInfo ? {} : { GM_info: options.gmInfo || { scriptHandler: 'Violentmonkey', injectInto: 'content' } }),
      sessionStorage: { getItem: key => stored.get(key) || null,
        setItem: (key, value) => { stored.set(key, value); }, removeItem: key => stored.delete(key) },
      __read: read, __writeConfig: writeConfig, __writeAuth: writeAuth,
      __status: value => statuses.push(clone(value)),
      __runtime: runtime => {
        const receive = runtime.receive;
        runtime.receive = message => { privateMessages.push({ direction: 'helper-to-local', data: clone(message) }); return receive(message); };
        tab.runtime = runtime; runtimes.push(runtime); return runtime;
      },
      __localMessage: data => privateMessages.push({ direction: 'local', data: clone(data) }),
    });
    let helper = source.slice(source.indexOf('  function createDriveBackup('), source.indexOf('  // END DRIVE BACKUP'));
    helper = helper.replace('return { mount, notifyChanged', 'return { testing: { openCompanion, closeSession, session: () => session }, mount, notifyChanged');
    const runtime = companion.trim().slice(0, -5) + '})';
    const instrumentedRuntime = runtime.replace('return { receive: message => onPortMessage({ data: message }), destroy: shutdown };',
      'return { receive: message => onPortMessage({ data: message }), destroy: shutdown, testing: { refresh: () => operate(listCopies), state: () => ({ authorized: isAuthorized(), busy, closed, hasToken: Boolean(token) }) } };');
    vm.runInContext(coreSource + '\nconst core = globalThis.OldLightSyncCore;\n' + fixture + '\n' + syncSource + '\n' + helper + `
      const readStorage = (key, fallback) => JSON.parse(JSON.stringify(__read(key, fallback)));
      let currentBackup = backup({ drive: {}, exportedAt: '2026-10-13T12:00:00Z' });
      function snapshot() { return { ...currentBackup, drive: globalThis.api ? api.exportConfig() : {} }; }
      function validateBackup(value) { return value; }
      const preferenceSync = createPreferenceSync({ getBackup: snapshot,
        applyPreferences: value => { currentBackup = value; }, getScope: () => SCOPE,
        getClientId: () => api.exportConfig().clientId, gmGetValue: readStorage, gmSetValue: __writeConfig });
      const runtimeFactory = ${instrumentedRuntime};
      this.api = createDriveBackup({ getBackup: snapshot, applyBackup: value => { currentBackup = value; },
        gmGetValue: readStorage, gmSetValue: __writeConfig, onStatus: __status,
        ${options.localAuthorization === false ? '' : 'gmSetAuthorization: __writeAuth,'}
        createRuntime: runtimeOptions => {
          const callback = runtimeOptions.onMessage;
          runtimeOptions.onMessage = message => { __localMessage(message); callback(message); };
          return __runtime(runtimeFactory(runtimeOptions), runtimeOptions);
        },
      });
      this.snapshot = snapshot;
    `, ctx);
    tab.api = ctx.api; tab.snapshot = ctx.snapshot; tabs.push(tab); return tab;
  }
  function loadPopup(tab) {
    const popup = tab.popup; assert.ok(popup, 'Open the helper popup first');
    const time = clock.realm(), window = eventTarget(), nodes = new Map();
    window.opener = tab.gameRef; window.close = () => popup.ref.close();
    window.google = { accounts: { oauth2: {
      initTokenClient(settings) { popup.oauth = settings; return { requestAccessToken() { oauthRequests++; } }; },
      hasGrantedAllScopes() { return true; },
      revoke(token, callback) { assert.ok([TOKEN, OTHER_TOKEN].includes(token)); callback({ successful: true }); },
    } } };
    const document = Object.assign(eventTarget(), { activeElement: null, hidden: false, head: { append() {} }, createElement: node,
      getElementById: id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } });
    const url = new URL(popup.url);
    const ctx = vm.createContext({ ...common, ...time, window, document,
      location: { origin: url.origin, pathname: url.pathname, hash: url.hash, search: url.search },
      history: { replaceState(...args) { popup.history = args; } }, navigator: {},
    });
    Object.assign(popup, { time, window, nodes });
    vm.runInContext(coreSource + '\n' + companion, ctx);
    return popup;
  }
  async function authorize(tab, token = TOKEN) {
    tab.api.testing.openCompanion();
    const popup = loadPopup(tab); await settle();
    popup.nodes.get('connect').click();
    assert.ok(popup.oauth, 'OAuth is initiated by the explicit Connect button');
    popup.oauth.callback({ access_token: token, expires_in: 3600 });
    await settle(); return popup;
  }
  return { clock, gm, publicMessages, privateMessages, storageWrites, requests, statuses, runtimes, tabs, pendingWrites,
    loadGame, loadPopup, authorize, counts: () => ({ opened, closed, oauthRequests }),
    writeMode: mode => { writeMode = mode; }, failRead: value => { failRead = value; },
    aboutMode: value => { aboutMode = value; }, aboutGate: value => { aboutGate = value; },
  };
}
async function connected(options = {}) {
  const env = setup(options), tab = env.loadGame(); await env.authorize(tab);
  assert.equal(tab.api.testing.session()?.local, true, 'The popup must transfer the confirmed authorization to the private runtime');
  assert.equal(tab.api.getStatus().code, 'connected'); return { env, tab };
}
function assertNoToken(value) { assert.doesNotMatch(JSON.stringify(value), /FAKE_(?:LOCAL|REPLACEMENT)_AUTHORIZATION_FOR_TESTS_ONLY|accessToken|access_token/); }

test('the userscript embeds the exact popup Drive engine as a private factory', () => {
  const begin = '  // BEGIN EMBEDDED PRIVATE DRIVE RUNTIME\n';
  const end = '\n  // END EMBEDDED PRIVATE DRIVE RUNTIME';
  const start = source.indexOf(begin), finish = source.indexOf(end);
  assert.ok(start >= 0 && finish > start);
  assert.equal(source.slice(start + begin.length, finish), '  const createLocalDriveRuntime = ' + companion.trim().slice(0, -5) + '});');
});

test('confirmed OAuth persists in a separate private key and runs after the popup closes', async () => {
  const { env, tab } = await connected();
  const saved = env.gm.get(AUTH_KEY);
  assert.equal(saved.accessToken, TOKEN); assert.equal(saved.accountId, ACCOUNT); assert.equal(saved.clientId, CLIENT);
  assert.equal(saved.expiresAt, env.clock.now() + 3_570_000);
  assert.match(saved.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(env.counts(), { opened: 1, closed: 1, oauthRequests: 1 });
  assert.equal(tab.popup.ref.closed, true);
  assert.equal(tab.runtime.testing.state().authorized, true);
  assert.ok(env.requests.some(request => new URL(request.url).pathname === '/drive/v3/files'));
  assert.ok(env.storageWrites.filter(write => write.key === AUTH_KEY).every(write => write.async));
});

test('reload restores the confirmed authorization without a popup or another OAuth request', async () => {
  const { env, tab } = await connected();
  const saved = clone(env.gm.get(AUTH_KEY)), before = env.requests.length;
  const reloaded = env.loadGame(tab); await settle();
  assert.equal(reloaded.api.testing.session()?.local, true);
  assert.equal(reloaded.api.getStatus().code, 'connected');
  assert.deepEqual(env.gm.get(AUTH_KEY), saved);
  assert.deepEqual(env.counts(), { opened: 1, closed: 1, oauthRequests: 1 });
  assert.equal(new URL(env.requests[before].url).pathname, '/drive/v3/about', 'Google account must be revalidated before listing or uploading');
});

test('the OAuth popup stays open until asynchronous storage succeeds and the private ACK arrives', async () => {
  const env = setup({ writeMode: 'deferred' }), tab = env.loadGame(); await env.authorize(tab);
  assert.equal(env.pendingWrites.length, 1);
  assert.equal(tab.popup.ref.closed, false);
  assert.notEqual(tab.api.testing.session()?.local, true);
  assert.equal(env.gm.has(AUTH_KEY), false);
  assert.equal(env.privateMessages.some(item => item.data.type === 'activate-local'), false);
  assert.equal(env.privateMessages.some(item => item.data.stored === true), false);
  env.pendingWrites.shift().resolve(); await settle();
  const ack = env.privateMessages.findIndex(item => item.data.type === 'reply' && item.data.stored === true);
  const activation = env.privateMessages.findIndex(item => item.data.type === 'activate-local');
  assert.ok(ack >= 0 && activation > ack);
  assert.equal(tab.popup.ref.closed, true);
  assert.equal(tab.api.testing.session()?.local, true);
});

for (const mode of ['reject', 'false', 'no-write']) test(`failed authorization storage (${mode}) never closes the popup or acknowledges persistence`, async () => {
  const env = setup({ writeMode: mode }), tab = env.loadGame(); await env.authorize(tab);
  assert.equal(tab.popup.ref.closed, false);
  assert.notEqual(tab.api.testing.session()?.local, true);
  assert.equal(env.gm.has(AUTH_KEY), false);
  assert.equal(env.privateMessages.some(item => item.data.stored === true || item.data.type === 'activate-local'), false);
  assert.ok(env.statuses.some(status => status.code === 'storage_error'));
});

test('expiration clears persisted authorization and never renews Google automatically', async () => {
  const { env, tab } = await connected();
  env.clock.jump(3_570_001); env.clock.timeouts(); await settle();
  assert.equal(env.gm.get(AUTH_KEY), null);
  assert.equal(tab.api.getStatus().code, 'expired');
  assert.equal(tab.runtime.testing.state().hasToken, false);
  const before = env.requests.length;
  const reloaded = env.loadGame(tab); await settle();
  env.clock.intervals(1000); env.clock.intervals(3000); await settle();
  assert.equal(reloaded.api.testing.session(), null);
  assert.equal(env.requests.length, before);
  assert.deepEqual(env.counts(), { opened: 1, closed: 1, oauthRequests: 1 });
});

for (const [name, patch] of [
  ['expired', { expiresAt: 1 }],
  ['malformed token', { accessToken: 'invalid\nfixture' }], ['too distant', { expiresAt: 1_900_000_000_000 }],
]) test(`invalid saved authorization (${name}) is erased without opening Google`, async () => {
  const env = setup({ savedAuthorization: patch }), tab = env.loadGame(); await settle();
  assert.equal(env.gm.get(AUTH_KEY), null); assert.equal(tab.api.testing.session(), null);
  assert.equal(env.requests.length, 0); assert.deepEqual(env.counts(), { opened: 0, closed: 0, oauthRequests: 0 });
});

test('private-storage read failure fails closed without exposing the token in status', async () => {
  const env = setup({ savedAuthorization: {} }); env.failRead(true);
  const tab = env.loadGame(); await settle();
  assert.equal(tab.api.testing.session(), null); assert.equal(env.requests.length, 0);
  assert.equal(tab.api.getStatus().code, 'auth_storage_error'); assertNoToken(env.statuses);
});

test('failed authorization deletion stops the runtime and reports that private storage still needs clearing', async () => {
  const { env, tab } = await connected(); env.writeMode('reject');
  tab.api.testing.closeSession(); await settle();
  assert.equal(tab.api.testing.session(), null);
  assert.equal(tab.runtime.testing.state().hasToken, false);
  assert.equal(tab.api.getStatus().code, 'auth_storage_error');
  assert.equal(env.gm.get(AUTH_KEY).accessToken, TOKEN, 'A failed deletion must not falsely claim the credential is gone');
  const before = env.requests.length;
  env.clock.intervals(1000); await settle(); assert.equal(env.requests.length, before);
});

test('local logout clears the shared authorization and a new load remains disconnected', async () => {
  const { env, tab } = await connected(); tab.api.testing.closeSession(); await settle();
  assert.equal(env.gm.get(AUTH_KEY), null);
  assert.equal(tab.runtime.testing.state().hasToken, false);
  const reloaded = env.loadGame(tab); await settle();
  assert.equal(reloaded.api.testing.session(), null); assert.equal(reloaded.api.getStatus().code, 'disconnected');
});

test('changing OAuth clients invalidates persisted authorization before the new client can use it', async () => {
  const { env, tab } = await connected(), before = env.requests.length;
  tab.api.importConfig({ ...tab.api.exportConfig(), clientId: OTHER_CLIENT }); await settle();
  assert.equal(env.gm.get(AUTH_KEY), null); assert.equal(tab.api.testing.session(), null);
  assert.equal(tab.runtime.testing.state().hasToken, false); assert.equal(env.requests.length, before);
  const reloaded = env.loadGame(tab); await settle();
  assert.equal(reloaded.api.testing.session(), null); assert.equal(env.requests.length, before);
});

for (const identity of ['other-fixture-account', 'unauthorized']) test(`restored authorization rejects Google identity ${identity} before touching backups or sync`, async () => {
  const env = setup({ savedAuthorization: {}, aboutMode: identity }), tab = env.loadGame(); await settle();
  assert.equal(env.requests.length, 1); assert.equal(new URL(env.requests[0].url).pathname, '/drive/v3/about');
  assert.equal(env.gm.get(AUTH_KEY), null); assert.equal(tab.api.testing.session(), null);
  assert.notEqual(tab.api.getStatus().code, 'connected');
});

test('account revalidation must finish before a restored session accesses backup files', async () => {
  let release;
  const env = setup({ savedAuthorization: {} }); env.aboutGate(new Promise(resolve => { release = resolve; }));
  const tab = env.loadGame(); await settle();
  assert.equal(env.requests.length, 1); assert.equal(new URL(env.requests[0].url).pathname, '/drive/v3/about');
  assert.equal(tab.runtime.testing.state().busy, true);
  assert.notEqual(tab.api.getStatus().code, 'connected', 'Restoring a saved token must not announce success before account verification');
  release(); await settle();
  assert.ok(env.requests.some(request => new URL(request.url).pathname === '/drive/v3/files'));
  assert.equal(tab.api.getStatus().code, 'connected');
});

test('credentials never enter helper exports, configuration messages, sync documents, status or page storage', async () => {
  const { env, tab } = await connected();
  tab.api.importConfig({ ...tab.api.exportConfig(), autoSync: true }); await settle();
  env.clock.jump(1000); env.clock.timeouts();
  await waitFor(() => tab.api.getStatus().code === 'synced', 'Settings sync must reach its completed state');
  assert.ok(env.requests.some(request => request.method === 'POST'), 'Exercise a real settings-sync upload through the fake transport');
  assert.equal(tab.api.getStatus().code, 'synced');
  assertNoToken(tab.api.exportConfig()); assertNoToken(tab.snapshot()); assertNoToken(env.statuses);
  assertNoToken(env.gm.get(CONFIG_KEY)); assertNoToken([...tab.stored]);
  assertNoToken(env.storageWrites.filter(write => write.key !== AUTH_KEY));
  assertNoToken(env.publicMessages);
  assertNoToken(env.privateMessages.filter(item => ['config', 'status', 'get-sync', 'merge-sync'].includes(item.data.type)));
  assertNoToken(env.requests.map(request => ({ url: request.url, body: request.body })));
  assert.ok(env.requests.every(request => request.headers.Authorization === 'Bearer ' + TOKEN));
});

test('a private bootstrap keeps its nonce out of sessionStorage, public ready messages, and credentials out of all URLs', async () => {
  const env = setup(), tab = env.loadGame(); tab.api.testing.openCompanion();
  const nonce = tab.api.testing.session().nonce;
  assert.match(nonce, /^[0-9a-f]{64}$/);
  assert.equal(new URLSearchParams(new URL(tab.popup.url).hash.slice(1)).get('private'), '1');
  assert.equal(tab.stored.has(ROUTE), false);
  const popup = env.loadPopup(tab); await settle();
  const ready = env.publicMessages.filter(item => item.direction === 'popup-to-game' && item.data.type === 'ready');
  assert.ok(ready.length > 0);
  assert.ok(ready.every(item => item.data.private === true && !Object.hasOwn(item.data, 'nonce')));
  assert.doesNotMatch(JSON.stringify(ready), new RegExp(nonce));
  assert.equal(popup.history[2], '/old-light-auto-upgrade/drive.html');
  assertNoToken(tab.popup.url); assertNoToken(env.publicMessages);
});

test('private helper bootstrap rejects public-mode, secret-bearing, wrong-origin and wrong-window announcements', () => {
  const env = setup(), tab = env.loadGame(); tab.api.testing.openCompanion();
  const current = tab.api.testing.session();
  const base = { origin: DRIVE, source: tab.popup.ref, data: { protocol: PROTOCOL, type: 'ready', private: true } };
  for (const event of [
    { ...base, origin: 'https://untrusted.example' }, { ...base, source: {} },
    { ...base, data: { ...base.data, protocol: 'wrong' } },
    { ...base, data: { ...base.data, private: false } },
    { ...base, data: { ...base.data, nonce: current.nonce } },
    { ...base, data: { protocol: PROTOCOL, type: 'ready', nonce: current.nonce } },
  ]) { tab.window.emit('message', event); assert.equal(current.port, null); }
  tab.window.emit('message', base); assert.ok(current.port);
});

test('without confirmed async credential storage the public compatibility bridge cannot receive or persist credentials', async () => {
  const env = setup({ localAuthorization: false }), tab = env.loadGame();
  await env.authorize(tab);
  assert.equal(new URLSearchParams(new URL(tab.popup.url).hash.slice(1)).has('private'), false);
  assert.equal(tab.stored.get(ROUTE), tab.api.testing.session().nonce);
  assert.equal(env.gm.has(AUTH_KEY), false); assert.equal(tab.popup.ref.closed, false);
  const configs = env.privateMessages.filter(item => item.data.type === 'config');
  assert.ok(configs.length > 0);
  assert.ok(configs.every(item => !item.data.capabilities.includes('local-authorization-v1')));
  assert.equal(env.privateMessages.some(item => ['store-authorization', 'restore-authorization'].includes(item.data.type)), false);
});

test('logout in another tab blocks the stale runtime before its next polling interval', async () => {
  const { env, tab: first } = await connected();
  const second = env.loadGame(); await settle();
  assert.equal(second.api.getStatus().code, 'connected');
  first.api.testing.closeSession(); await settle();
  const before = env.requests.length;
  await second.runtime.testing.refresh(); await settle();
  assert.equal(env.requests.length, before, 'A stale tab must not send a token after shared authorization is removed');
  env.clock.intervals(1000); await settle();
  assert.equal(second.api.testing.session(), null); assert.equal(second.runtime.testing.state().hasToken, false);
});

test('a newer shared authorization replaces the old tab token and cannot be erased by the old expiry timer', async () => {
  const { env, tab } = await connected();
  const oldRuntime = tab.runtime;
  const replacement = record(env.clock.now(), { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    accessToken: OTHER_TOKEN, accountId: 'other-fixture-account', expiresAt: env.clock.now() + 7_000_000 });
  env.gm.set(AUTH_KEY, clone(replacement)); env.aboutMode('other-fixture-account');
  const before = env.requests.length;
  await oldRuntime.testing.refresh(); await settle();
  assert.equal(env.requests.length, before, 'Changed authorization ID must stop stale outgoing requests immediately');
  env.clock.intervals(1000); await settle();
  assert.equal(tab.api.testing.session()?.authId, replacement.id);
  assert.ok(env.requests.slice(before).every(request => request.headers.Authorization === 'Bearer ' + OTHER_TOKEN));
  assert.deepEqual(env.gm.get(AUTH_KEY), replacement);
  env.clock.jump(3_570_001); env.clock.timeouts(); await settle();
  assert.deepEqual(env.gm.get(AUTH_KEY), replacement, 'An older session cannot delete the replacement credential');
});

test('a stale tab with another OAuth client cannot consume or delete a newer client authorization', async () => {
  const env = setup({ savedAuthorization: { clientId: OTHER_CLIENT } });
  const saved = clone(env.gm.get(AUTH_KEY)), tab = env.loadGame(); await settle();
  assert.deepEqual(env.gm.get(AUTH_KEY), saved);
  assert.equal(tab.api.testing.session(), null); assert.equal(env.requests.length, 0);
  assert.deepEqual(env.counts(), { opened: 0, closed: 0, oauthRequests: 0 });
});

for (const identity of ['missing', 'offline']) test(`unavailable Google identity (${identity}) pauses file operations and retries verification before any later request`, async () => {
  const env = setup({ savedAuthorization: {}, aboutMode: identity }), tab = env.loadGame(); await settle();
  assert.equal(env.requests.length, 1); assert.equal(new URL(env.requests[0].url).pathname, '/drive/v3/about');
  assert.equal(env.gm.get(AUTH_KEY).accessToken, TOKEN); assert.equal(tab.api.getStatus().code, 'sync_account');
  await tab.runtime.testing.refresh(); await settle();
  assert.equal(env.requests.length, 2);
  assert.ok(env.requests.every(request => new URL(request.url).pathname === '/drive/v3/about'));
  env.aboutMode(ACCOUNT);
  await tab.runtime.testing.refresh(); await settle();
  assert.equal(new URL(env.requests[2].url).pathname, '/drive/v3/about');
  assert.equal(new URL(env.requests[3].url).pathname, '/drive/v3/files');
  assert.equal(tab.api.getStatus().code, 'connected');
});

for (const action of ['disconnect', 'change-client', 'destroy']) test(`an authorization write finishing after ${action} cannot resurrect the prior session`, async () => {
  const env = setup({ writeMode: 'deferred' }), tab = env.loadGame(); await env.authorize(tab);
  assert.equal(env.pendingWrites.length, 1);
  env.writeMode('success');
  if (action === 'disconnect') tab.api.testing.closeSession();
  else if (action === 'change-client') tab.api.importConfig({ ...tab.api.exportConfig(), clientId: OTHER_CLIENT });
  else tab.api.destroy();
  await settle();
  env.pendingWrites.shift().resolve(); await settle();
  assert.equal(env.gm.get(AUTH_KEY), null);
  assert.equal(env.runtimes.length, 0);
  assert.equal(env.privateMessages.some(item => item.data.stored === true || item.data.type === 'activate-local'), false);
});

test('an old tab expiry cannot delete a newer shared authorization before that tab polls again', async () => {
  const { env, tab } = await connected();
  const replacement = record(env.clock.now(), { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    accessToken: OTHER_TOKEN, expiresAt: env.clock.now() + 7_000_000 });
  env.gm.set(AUTH_KEY, clone(replacement));
  env.clock.jump(3_570_001); env.clock.timeouts(); await settle();
  assert.deepEqual(env.gm.get(AUTH_KEY), replacement);
  assert.equal(tab.api.testing.session(), null);
  const reloaded = env.loadGame(tab); await settle();
  assert.equal(reloaded.api.testing.session()?.authId, replacement.id);
  assert.equal(reloaded.api.getStatus().code, 'connected');
});

test('disconnecting in the management popup deletes local authorization and stops all tabs', async () => {
  const { env, tab } = await connected();
  const second = env.loadGame(); await settle();
  tab.api.testing.openCompanion(); const popup = env.loadPopup(tab); await settle();
  assert.equal(popup.nodes.get('disconnect').disabled, false);
  popup.nodes.get('disconnect').click(); await settle();
  assert.equal(env.gm.get(AUTH_KEY), null);
  const before = env.requests.length;
  await second.runtime.testing.refresh(); env.clock.intervals(1000); await settle();
  assert.equal(env.requests.length, before);
  assert.equal(second.api.testing.session(), null);
});

test('confirmed Google revocation from the management popup also removes the saved local credential', async () => {
  const { env, tab } = await connected();
  tab.api.testing.openCompanion(); const popup = env.loadPopup(tab); await settle();
  assert.equal(popup.nodes.get('revoke').disabled, false);
  popup.nodes.get('revoke').click(); popup.nodes.get('confirm-revoke').click(); await settle();
  assert.equal(env.gm.get(AUTH_KEY), null);
  assert.equal(tab.api.getStatus().code, 'revoked');
  const before = env.requests.length;
  const reloaded = env.loadGame(tab); await settle();
  assert.equal(reloaded.api.testing.session(), null); assert.equal(env.requests.length, before);
});

async function renewingWithCachedCandidate() {
  const { env, tab } = await connected();
  tab.api.testing.openCompanion(); const popup = env.loadPopup(tab); await settle();
  const previousId = env.gm.get(AUTH_KEY).id;
  env.writeMode('cache-first-hold');
  popup.nodes.get('connect').click(); popup.oauth.callback({ access_token: OTHER_TOKEN, expires_in: 3600 });
  await settle();
  assert.equal(env.pendingWrites.length, 1);
  assert.equal(env.gm.get(AUTH_KEY).accessToken, OTHER_TOKEN, 'The mock must expose the unacknowledged cache value');
  assert.notEqual(env.gm.get(AUTH_KEY).id, previousId);
  return { env, tab, popup, previousId };
}

test('a cache-first renewal cannot start the new local token or close its popup while storage ACK is pending', async () => {
  const { env, tab, popup, previousId } = await renewingWithCachedCandidate();
  const before = env.requests.length, priorRuntimes = env.runtimes.length;
  for (let i = 0; i < 3; i++) { env.clock.jump(1000); env.clock.intervals(1000); await settle(); }
  assert.equal(popup.ref.closed, false);
  assert.notEqual(tab.api.testing.session()?.local, true);
  assert.equal(tab.api.testing.session()?.authId, previousId);
  assert.equal(env.runtimes.length, priorRuntimes);
  assert.equal(env.requests.length, before);
  env.pendingWrites.shift().resolve(); await settle();
  assert.equal(popup.ref.closed, true);
  assert.equal(tab.api.testing.session()?.local, true);
  assert.equal(env.gm.get(AUTH_KEY).accessToken, OTHER_TOKEN);
  assert.ok(env.requests.slice(before).length > 0);
  assert.ok(env.requests.slice(before).every(request => request.headers.Authorization === 'Bearer ' + OTHER_TOKEN));
});

test('a rejected cache-first renewal removes its unacknowledged candidate instead of activating it', async () => {
  const { env, tab, popup } = await renewingWithCachedCandidate();
  const priorRuntimes = env.runtimes.length, before = env.requests.length;
  env.pendingWrites.shift().reject(Error('Simulated late manager ACK rejection')); await settle();
  env.clock.intervals(1000); await settle();
  assert.equal(env.gm.get(AUTH_KEY), null);
  assert.equal(env.runtimes.length, priorRuntimes);
  assert.equal(env.requests.length, before);
  assert.equal(popup.ref.closed, false);
  assert.notEqual(tab.api.testing.session()?.local, true);
  assert.ok(env.statuses.some(status => status.code === 'storage_error' || status.code === 'auth_storage_error'));
});

test('an immediately rejected cache-first initial login never treats the visible cached token as saved', async () => {
  const env = setup({ writeMode: 'cache-first-reject' }), tab = env.loadGame(); await env.authorize(tab);
  env.clock.intervals(1000); await settle();
  assert.equal(env.gm.get(AUTH_KEY), null); assert.equal(env.runtimes.length, 0);
  assert.equal(tab.popup.ref.closed, false);
  assert.equal(env.privateMessages.some(item => item.data.stored === true || item.data.type === 'activate-local'), false);
});

for (const action of ['close-popup', 'disconnect']) test(`a cached pending authorization is never activated when the user chooses ${action}`, async () => {
  const { env, tab, popup } = await renewingWithCachedCandidate();
  const priorRuntimes = env.runtimes.length, before = env.requests.length;
  if (action === 'close-popup') popup.ref.close();
  else tab.api.testing.closeSession();
  await settle(); env.clock.intervals(1000); await settle();
  assert.equal(env.runtimes.length, priorRuntimes);
  env.pendingWrites.shift().resolve(); await settle();
  assert.equal(env.gm.get(AUTH_KEY), null);
  assert.equal(tab.api.testing.session(), null);
  assert.equal(env.requests.length, before);
  assert.equal(env.runtimes.length, priorRuntimes);
});

test('a pending automatic backup survives opening and closing management before its five-second delay', async () => {
  const { env, tab } = await connected();
  tab.api.importConfig({ ...tab.api.exportConfig(), autoBackup: true, autoSync: false }); await settle();
  tab.api.notifyChanged(); await settle();
  assert.ok(env.privateMessages.some(item => item.data.type === 'pending-backup' && item.data.pending === true));
  env.clock.jump(2000); env.clock.timeouts(); await settle();
  assert.equal(env.requests.some(request => request.method === 'POST'), false);
  tab.api.testing.openCompanion(); const popup = env.loadPopup(tab); await settle();
  popup.ref.close(); await settle();
  assert.equal(tab.api.testing.session()?.local, true);
  assert.ok(env.privateMessages.some(item => item.data.type === 'resume-pending-backup'));
  env.clock.jump(5001); env.clock.timeouts();
  await waitFor(() => tab.api.getStatus().code === 'saved', 'The pending backup should be uploaded after management closes');
  const uploads = env.requests.filter(request => request.method === 'POST');
  assert.equal(uploads.length, 1); assert.match(uploads[0].body, /old-light-auto-upgrade-drive-copy/);
  assertNoToken(uploads[0].body);
});

for (const [name, options] of [
  ['page injection', { gmInfo: { scriptHandler: 'Violentmonkey', injectInto: 'page' } }],
  ['a different manager', { gmInfo: { scriptHandler: 'AnotherManager', injectInto: 'content' } }],
  ['missing effective injection field', { gmInfo: { scriptHandler: 'Violentmonkey' } }],
  ['missing GM_info', { noGmInfo: true }],
]) test(`credential persistence is disabled for ${name}, retaining only the compatible public bridge`, async () => {
  const env = setup(options), tab = env.loadGame(); await env.authorize(tab);
  assert.equal(tab.api.testing.session()?.privateBridge, false);
  assert.equal(new URLSearchParams(new URL(tab.popup.url).hash.slice(1)).has('private'), false);
  assert.equal(env.gm.has(AUTH_KEY), false); assert.equal(env.runtimes.length, 0);
  assert.equal(tab.popup.ref.closed, false);
  assert.ok(env.privateMessages.filter(item => item.data.type === 'config')
    .every(item => !item.data.capabilities.includes('local-authorization-v1')));
  assert.equal(env.privateMessages.some(item => ['store-authorization', 'restore-authorization'].includes(item.data.type)), false);
});

test('pending edits replace the helper synced status before the next private-runtime upload', async () => {
  const { env, tab } = await connected();
  tab.api.importConfig({ ...tab.api.exportConfig(), autoSync: true }); await settle();
  env.clock.jump(1000); env.clock.timeouts();
  await waitFor(() => tab.api.getStatus().code === 'synced', 'Initial sync must finish');
  const requests = env.requests.length;
  tab.api.notifyChanged({ sharedChanged: false, backupChange: false }); await settle();
  assert.equal(tab.api.getStatus().code, 'synced', 'Local-only changes do not invalidate shared sync');
  tab.api.notifyChanged({ sharedChanged: true, backupChange: false }); await settle();
  assert.equal(env.requests.length, requests, 'The pending status precedes the debounce request');
  assert.equal(tab.api.getStatus().code, 'sync_pending');
  assert.match(tab.api.getStatus().message, /pendientes/i);
  assertNoToken(env.statuses);
  env.clock.jump(1500); env.clock.timeouts();
  await waitFor(() => tab.api.getStatus().code === 'synced', 'Next completed cycle clears pending');
  tab.api.destroy();
});

test('explicit helper disconnect gives its open private management window an actionable terminal state', async () => {
  const { env, tab } = await connected();
  tab.api.testing.openCompanion();
  const popup = env.loadPopup(tab); await settle();
  tab.api.testing.closeSession(); await settle();
  const message = popup.nodes.get('session-status').textContent;
  assert.match(message, /(?:abre|abrir).*(?:Drive|ventana).*helper/i);
  assert.doesNotMatch(message, /se recuperar[áa]|mant[ée]n.*abierta/i);
  assert.equal(popup.nodes.get('connect').disabled, true);
  assert.equal(tab.api.getStatus().code, 'disconnected');
  assert.equal(env.gm.get(AUTH_KEY), null);
  const requestCount = env.requests.length;
  env.clock.jump(65000); env.clock.intervals(3000); env.clock.timeouts(); await settle();
  assert.equal(env.requests.length, requestCount, 'Explicit disconnect cannot restart private access');
  assert.equal(popup.nodes.get('session-status').textContent, message);
  assertNoToken(env.statuses);
  tab.api.destroy();
});


test('returning to a dormant tab restores a newly confirmed shared authorization without another OAuth', async () => {
  const env = setup(), first = env.loadGame(), second = env.loadGame();
  await env.authorize(second); await settle();
  assert.equal(first.api.testing.session(), null);
  const saved = clone(env.gm.get(AUTH_KEY));
  first.window.emit('focus'); await settle();
  assert.equal(first.api.testing.session()?.authId, saved.id);
  assert.equal(first.api.getStatus().code, 'connected');
  assert.deepEqual(env.gm.get(AUTH_KEY), saved, 'Restoration never extends the absolute expiry');
  assert.deepEqual(env.counts(), { opened: 1, closed: 1, oauthRequests: 1 });
  const count = env.requests.length;
  first.window.emit('focus'); first.document.emit('visibilitychange'); await settle();
  assert.equal(env.requests.length, count, 'Repeated focus cannot restart an active session');
  assertNoToken(env.statuses);
});

test('visibility recovery waits until visible and rejects expired or other-client shared authorization', async () => {
  const env = setup(), tab = env.loadGame();
  env.gm.set(AUTH_KEY, record(env.clock.now()));
  tab.document.hidden = true; tab.document.emit('visibilitychange'); await settle();
  assert.equal(tab.api.testing.session(), null); assert.equal(env.requests.length, 0);
  tab.document.hidden = false; tab.document.emit('visibilitychange'); await settle();
  assert.equal(tab.api.getStatus().code, 'connected');
  tab.api.testing.closeSession(); await settle();
  env.gm.set(AUTH_KEY, record(env.clock.now(), { clientId: OTHER_CLIENT }));
  tab.window.emit('focus'); await settle();
  assert.equal(tab.api.testing.session(), null);
  const count = env.requests.length;
  env.gm.set(AUTH_KEY, record(env.clock.now(), { expiresAt: env.clock.now() - 1 }));
  tab.window.emit('focus'); await settle();
  assert.equal(tab.api.testing.session(), null); assert.equal(env.requests.length, count);
  assert.deepEqual(env.counts(), { opened: 0, closed: 0, oauthRequests: 0 });
});

test('focus cannot undo explicit disconnect or restart the same stopped authorization', async () => {
  const { env, tab } = await connected();
  const saved = clone(env.gm.get(AUTH_KEY));
  tab.api.testing.closeSession(); await settle();
  const count = env.requests.length;
  tab.window.emit('focus'); await settle();
  assert.equal(tab.api.testing.session(), null); assert.equal(env.requests.length, count);
  env.gm.set(AUTH_KEY, saved); // A stale manager view of the very same credential is not a new login.
  tab.window.emit('focus'); await settle();
  assert.equal(tab.api.testing.session(), null); assert.equal(env.requests.length, count);
  env.gm.set(AUTH_KEY, record(env.clock.now(), { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
  tab.window.emit('focus'); await settle();
  assert.equal(tab.api.getStatus().code, 'connected', 'A genuinely new confirmed login remains recoverable');
});

test('destroyed or storage-blocked dormant tabs never restore on focus', async () => {
  const env = setup(), tab = env.loadGame();
  env.failRead(true); tab.window.emit('focus'); await settle();
  assert.equal(tab.api.getStatus().code, 'auth_storage_error');
  env.failRead(false); env.gm.set(AUTH_KEY, record(env.clock.now()));
  tab.window.emit('focus'); await settle();
  assert.equal(tab.api.testing.session(), null); assert.equal(env.requests.length, 0);
  const other = env.loadGame(); await settle(); other.api.destroy();
  const count = env.requests.length;
  other.window.emit('focus'); other.document.emit('visibilitychange'); await settle();
  assert.equal(other.api.testing.session(), null); assert.equal(env.requests.length, count);
});
