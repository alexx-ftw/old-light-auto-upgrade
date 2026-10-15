'use strict';
// Offline transport E2E: production journal, scheduler, merge engine and multipart
// Drive transport run in isolated clients. No Google, game or login is contacted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(root, 'docs/sync-core.js'), 'utf8');
const companionSource = fs.readFileSync(path.join(root, 'docs/drive.js'), 'utf8');
const fixtureSource = fs.readFileSync(path.join(__dirname, 'drive-sync-core.test.cjs'), 'utf8');
// Extract only data/helpers; requiring the existing test would run its tests again.
const fixtureStart = fixtureSource.indexOf('const BUILDINGS =');
const fixtureEnd = fixtureSource.indexOf('const maybe =');
const integrationStart = source.indexOf('  function createPreferenceSync(');
const integrationEnd = source.indexOf('  // END SHARED PREFERENCES INTEGRATION');
const companionEnd = companionSource.indexOf('  ui.connect.addEventListener');
assert.ok(fixtureStart >= 0 && fixtureEnd > fixtureStart);
assert.ok(integrationStart >= 0 && integrationEnd > integrationStart);
assert.ok(companionEnd > 0);
const fixture = fixtureSource.slice(fixtureStart, fixtureEnd);
const integration = source.slice(integrationStart, integrationEnd);
const clone = value => JSON.parse(JSON.stringify(value));
const SCOPE = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_GALAXY = 'orion/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_PLAYER = 'andromeda/dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FIRST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECOND = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACCOUNT = 'imperial-account';
const OTHER_ACCOUNT = 'second-google-account';
const target = ship => 'empire.fleetTargets.' + ship;
const system = (id, field) => `empire.systems.${id}.${field}`;
const imperialFields = doc => Object.fromEntries(Object.entries(doc.fields).filter(([key]) => key.startsWith('empire.')));

function imperial({ scope = SCOPE, enabled = false, label = 'local', fleetTargets = {}, systems } = {}) {
  return { scope, config: { schemaVersion: 1, enabled,
    fleetTargets: { probe: 3, marauder: 4, sentinel: 0, vanguard: 0, ...fleetTargets },
    systems: systems || {
      [FIRST]: { name: `private-name-${label}`, role: 'industry', enabled: true },
      [SECOND]: { name: `private-name-${label}`, role: 'defense', enabled: false },
    },
    resources: { palladium: 987654321 }, token: `private-token-${label}`,
  }, runtime: { activeSystem: FIRST, pending: `private-pending-${label}` },
  snapshots: [{ resources: { iridium: 876543210 }, coordinates: [91, 82, 73] }] };
}
function helper({ scope = SCOPE, empire = imperial({ scope }), initial, saved = new Map() } = {}) {
  const context = vm.createContext({ crypto: crypto.webcrypto,
    __read: key => saved.has(key) ? JSON.stringify(saved.get(key)) : null,
    __write: (key, text) => saved.set(key, JSON.parse(text)),
  });
  vm.runInContext(coreSource + '\nconst core = OldLightSyncCore;\n' + fixture + '\n' + integration + `
    let current = backup(); let scope = SCOPE; let applied = 0;
    function validateBackup(value) { return value; }
    const sync = createPreferenceSync({
      getBackup: () => current, getScope: () => scope, getClientId: () => 'imperial-test-client',
      gmGetValue: (key, fallback) => { const value = __read(key); return value === null ? fallback : JSON.parse(value); },
      gmSetValue: (key, value) => __write(key, JSON.stringify(value)),
      applyPreferences: value => { current = value; applied++; },
    });
    this.invoke = (method, text) => {
      const value = JSON.parse(text);
      if (method === 'initial' || method === 'replace') { current = value; scope = value.profile; sync.observe(); return true; }
      if (method === 'view') return { current, applied };
      if (method === 'get') return sync.get(value);
      if (method === 'merge') return sync.merge(value);
      if (method === 'observe') return sync.observe();
      if (method === 'edit') { current = core.overlay(current, value); sync.observe(); return true; }
      throw new Error('Unexpected helper operation: ' + method);
    };
    this.fixture = () => backup();
  `, context);
  const run = (method, value = null) => clone(context.invoke(method, JSON.stringify(value)) ?? null);
  run('initial', initial || { ...clone(context.fixture()), profile: scope, ...(empire ? { empire } : {}) });
  return { run, saved, snapshot: () => run('view').current,
    document: (account = ACCOUNT) => run('get', 'id:' + account).document };
}
function fakeNode() {
  return { value: '', checked: false, disabled: false, hidden: false, textContent: '', dataset: {},
    classList: { toggle() {}, add() {}, remove() {} }, replaceChildren() {}, append() {},
    addEventListener() {}, setAttribute() {}, remove() {}, focus() {}, click() {} };
}
function companion(client, fetcher, identity = ACCOUNT) {
  const nodes = new Map(), timers = new Map(), rpcCalls = [], authCalls = [];
  let nextTimer = 0;
  const setTimer = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; };
  const context = vm.createContext({ console, crypto: crypto.webcrypto, TextEncoder, TextDecoder, URL,
    Blob, Response, AbortController, Intl,
    setTimeout: setTimer, clearTimeout: id => timers.delete(id),
    setInterval: setTimer, clearInterval: id => timers.delete(id),
    fetch: fetcher,
    window: { google: { accounts: { oauth2: {
      initTokenClient() { authCalls.push('initTokenClient'); throw new Error('Unexpected OAuth request'); },
      revoke() { authCalls.push('revoke'); throw new Error('Unexpected OAuth revocation'); },
    } } } },
    document: { activeElement: null, hidden: false, getElementById: id => {
      if (!nodes.has(id)) nodes.set(id, fakeNode()); return nodes.get(id);
    }, createElement: () => { throw new Error('Unexpected script or login injection'); } },
    __fireTimer: id => {
      assert.ok(timers.has(id), 'automatic sync must schedule a timer');
      const task = timers.get(id); timers.delete(id); task.callback(); return task.delay;
    },
    __rpc: (type, data) => {
      const message = JSON.parse(data); rpcCalls.push({ type, message });
      if (type === 'get-sync') return JSON.stringify(client.run('get', message.account));
      if (type === 'merge-sync') return JSON.stringify(client.run('merge', message));
      throw new Error('Unexpected RPC or manual restore: ' + type);
    },
  });
  const bootstrap = companionSource.slice(0, companionEnd) + `
    bridgeAlive = true; configReady = true;
    config = { ...config, clientId: 'imperial-test-client', autoSync: true, autoBackup: false };
    capabilities = new Set(['settings-sync-v1']);
    account = { id: ${JSON.stringify(identity)} };
    token = 'fake-token-' + account.id; expiresAt = Date.now() + 600000;
    port = { postMessage() {} };
    rpc = async (type, fields) => JSON.parse(await __rpc(type, JSON.stringify(fields)));
    let operation = null; const productionOperate = operate;
    operate = task => { operation = productionOperate(task); return operation; };
    globalThis.testing = {
      sync: () => syncSettings(),
      auto: async () => { scheduleSync(); const delay = __fireTimer(syncTimer); await operation; return delay; },
      invalidate: () => { generation++; },
      switchAccount: id => { generation++; resetSync(); account = { id }; token = 'fake-token-' + id; },
      state: () => ({ syncPending, syncLastAt, syncFailures, syncFileId, syncPublishedHash, statusCode }),
      scope: () => SCOPE,
    };
  })();`;
  vm.runInContext(coreSource + '\n' + bootstrap, context);
  return { ...context.testing, rpcCalls, authCalls };
}
function drive() {
  const files = new Map(), requests = [];
  let offline = false, writes = 0, nextFile = 0;
  const fetcher = async (urlString, options) => {
    const url = new URL(urlString);
    const account = String(options.headers.Authorization).replace('Bearer fake-token-', '');
    requests.push({ url: url.href, method: options.method, account, credentials: options.credentials,
      redirect: options.redirect, referrerPolicy: options.referrerPolicy });
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.match(url.pathname, /^\/(?:upload\/)?drive\/v3\/files(?:\/[A-Za-z0-9_-]+)?$/);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    if (offline) throw new Error('Simulated offline transport');
    if (options.method === 'GET' && url.pathname === '/drive/v3/files') {
      assert.equal(url.searchParams.get('spaces'), 'appDataFolder');
      const scopeHash = /key='scopeHash' and value='([^']+)'/.exec(url.searchParams.get('q'))?.[1];
      assert.ok(scopeHash, 'each automatic listing must be scoped');
      const matching = [...files.values()].filter(file => file.account === account
        && file.metadata.appProperties.scopeHash === scopeHash);
      const offset = Number(url.searchParams.get('pageToken') || 0);
      const size = Number(url.searchParams.get('pageSize') || 100);
      return new Response(JSON.stringify({ files: matching.slice(offset, offset + size).map(file => file.metadata),
        ...(matching.length > offset + size ? { nextPageToken: String(offset + size) } : {}) }));
    }
    const id = url.pathname.split('/').at(-1);
    if (options.method === 'GET') {
      assert.equal(files.get(id)?.account, account, 'a Drive token cannot read another account');
      return new Response(JSON.stringify(files.get(id).body));
    }
    assert.ok(['POST', 'PATCH'].includes(options.method));
    if (options.method === 'PATCH') assert.equal(files.get(id)?.account, account);
    assert.equal(url.searchParams.get('uploadType'), 'multipart');
    const boundary = /boundary=(.+)$/.exec(options.headers['Content-Type'])[1];
    const parts = (await options.body.text()).split('--' + boundary).slice(1, -1)
      .map(part => JSON.parse(part.slice(part.indexOf('\r\n\r\n') + 4).trim()));
    assert.equal(parts.length, 2);
    const fileId = options.method === 'POST' ? 'empire_file_' + (++nextFile) : id;
    const metadata = { ...parts[0], id: fileId,
      version: String(Number(files.get(fileId)?.metadata.version || 0) + 1),
      size: String(Buffer.byteLength(JSON.stringify(parts[1]))),
      createdTime: '2026-10-13T12:00:00Z', modifiedTime: new Date().toISOString() };
    files.set(fileId, { account, metadata, body: parts[1] }); writes++;
    return new Response(JSON.stringify(metadata));
  };
  return { files, requests, fetch: fetcher, offline: value => { offline = value; }, writes: () => writes };
}
async function converge(...clients) {
  for (let round = 0; round < 2; round++) for (const client of clients) {
    await client.auto(); assert.equal(client.state().syncFailures, 0);
    assert.equal(client.state().syncPending, false);
  }
}

// The scheduler and operate() run unchanged; only wall-clock timer delivery and
// fetch are controlled. No restore/import RPC exists in this harness.
test('empire transport: scheduled clients converge goals, roles and Atender with local global switches', async () => {
  const cloud = drive();
  const a = helper({ empire: imperial({ enabled: true, label: 'a' }) });
  const b = helper({ empire: imperial({ enabled: false, label: 'b' }) });
  const ca = companion(a, cloud.fetch), cb = companion(b, cloud.fetch);
  await converge(ca, cb);
  const beforeA = a.snapshot(), beforeB = b.snapshot();
  a.run('edit', { [target('marauder')]: 31, [system(FIRST, 'role')]: 'shipyard' });
  b.run('edit', { [target('sentinel')]: 12, [system(FIRST, 'enabled')]: false,
    [system(SECOND, 'enabled')]: true });
  await converge(ca, cb);
  for (const client of [a, b]) {
    assert.equal(client.snapshot().empire.config.fleetTargets.marauder, 31);
    assert.equal(client.snapshot().empire.config.fleetTargets.sentinel, 12);
    assert.equal(client.snapshot().empire.config.systems[FIRST].role, 'shipyard');
    assert.equal(client.snapshot().empire.config.systems[FIRST].enabled, false);
    assert.equal(client.snapshot().empire.config.systems[SECOND].enabled, true);
  }
  assert.deepEqual(a.document(), b.document());
  for (const [client, before] of [[a, beforeA], [b, beforeB]]) {
    const after = client.snapshot();
    assert.equal(after.empire.config.enabled, before.empire.config.enabled);
    assert.equal(after.empire.config.systems[FIRST].name, before.empire.config.systems[FIRST].name);
    assert.deepEqual(after.empire.runtime, before.empire.runtime);
    assert.deepEqual(after.empire.snapshots, before.empire.snapshots);
    assert.deepEqual(after.fleetMissions, before.fleetMissions);
  }
  for (const { body } of cloud.files.values()) {
    const fields = imperialFields(body.document);
    assert.equal(Object.keys(fields).length, 8);
    for (const key of Object.keys(fields)) assert.match(key,
      /^empire\.(fleetTargets\.(probe|marauder|sentinel|vanguard)|systems\.[0-9a-f-]{36}\.(role|enabled))$/);
    assert.doesNotMatch(JSON.stringify(body), /private-name|private-token|private-pending|987654321|876543210|coordinates|snapshots/);
    assert.equal(Object.hasOwn(body.document.fields, 'empire.enabled'), false);
    assert.equal(Object.hasOwn(body.document.fields, 'empire.config.enabled'), false);
  }
  const writes = cloud.writes(); await converge(ca, cb);
  assert.equal(cloud.writes(), writes, 'stable imperial state must not trigger repeated uploads');
  for (const companion of [ca, cb]) {
    assert.deepEqual(companion.authCalls, []);
    assert.equal(companion.scope(), 'https://www.googleapis.com/auth/drive.appdata');
    assert.ok(companion.rpcCalls.every(call => ['get-sync', 'merge-sync'].includes(call.type)));
  }
  assert.ok(cloud.requests.every(request => !/oauth|accounts\.google|oldlight\.io/.test(request.url)));
});

test('empire transport: global activation, local names and runtime alone create no new registers or upload', async () => {
  const cloud = drive(), a = helper(); const ca = companion(a, cloud.fetch);
  await converge(ca); const original = a.document(), writes = cloud.writes();
  const local = a.snapshot(); local.empire.config.enabled = true;
  local.empire.config.systems[FIRST].name = 'private-renamed-system';
  local.empire.runtime.pending = 'private-runtime-change';
  local.empire.snapshots[0].resources.iridium = 111222333;
  a.run('replace', local); await converge(ca);
  assert.deepEqual(a.document(), original);
  assert.equal(cloud.writes(), writes);
  assert.equal(a.snapshot().empire.config.enabled, true);
  assert.doesNotMatch(JSON.stringify([...cloud.files.values()]), /private-renamed-system|private-runtime-change|111222333/);
  // Sync adds no grant. The observer and update-installer permissions are separately approved.
  const metadata = source.slice(0, source.indexOf('// ==/UserScript=='));
  assert.deepEqual([...metadata.matchAll(/^\/\/ @grant\s+(\S+)/gm)].map(match => match[1]),
    ['GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue', 'GM.setValue', 'GM_openInTab', 'GM_addElement']);
});

test('empire transport: an offline journal survives reload and combines with a remote role edit', async () => {
  const cloud = drive(), a = helper(), b = helper();
  let ca = companion(a, cloud.fetch); const cb = companion(b, cloud.fetch);
  await converge(ca, cb);
  a.run('edit', { [target('vanguard')]: 27, [system(FIRST, 'enabled')]: false });
  const offlineRegisters = imperialFields(a.document());
  cloud.offline(true); await ca.auto();
  assert.equal(ca.state().syncFailures, 1); assert.equal(ca.state().syncPending, true);
  const saved = new Map(clone([...a.saved]));
  const reloaded = helper({ initial: a.snapshot(), saved });
  ca = companion(reloaded, cloud.fetch);
  await ca.auto(); assert.equal(ca.state().syncFailures, 1);
  b.run('edit', { [system(SECOND, 'role')]: 'shipyard' });
  cloud.offline(false); await cb.auto(); await converge(ca, cb);
  for (const client of [reloaded, b]) {
    assert.equal(client.snapshot().empire.config.fleetTargets.vanguard, 27);
    assert.equal(client.snapshot().empire.config.systems[FIRST].enabled, false);
    assert.equal(client.snapshot().empire.config.systems[SECOND].role, 'shipyard');
  }
  assert.deepEqual(reloaded.document().fields[target('vanguard')], offlineRegisters[target('vanguard')]);
  assert.deepEqual(reloaded.document().fields[system(FIRST, 'enabled')], offlineRegisters[system(FIRST, 'enabled')]);
  assert.deepEqual(reloaded.document(), b.document());
});

test('empire transport: per-UUID deletion tombstones survive stale replicas and reload', async () => {
  const cloud = drive(), a = helper(), b = helper();
  const ca = companion(a, cloud.fetch), cb = companion(b, cloud.fetch);
  await converge(ca, cb); const staleBackup = b.snapshot();
  const modified = a.snapshot(); delete modified.empire.config.systems[FIRST];
  a.run('replace', modified); await converge(ca, cb);
  const document = a.document();
  assert.equal(document.fields[system(FIRST, 'role')].value, null);
  assert.equal(document.fields[system(FIRST, 'enabled')].value, null);
  assert.equal(b.snapshot().empire.config.systems[FIRST].role, 'balanced');
  assert.equal(b.snapshot().empire.config.systems[FIRST].enabled, false);
  assert.equal(b.snapshot().empire.config.systems[FIRST].name, staleBackup.empire.config.systems[FIRST].name);
  assert.deepEqual(b.snapshot().empire.config.systems[SECOND], staleBackup.empire.config.systems[SECOND],
    'equal local names must never identify the system being deleted');
  const stale = helper({ initial: staleBackup }); const cs = companion(stale, cloud.fetch);
  await converge(cs, ca, cb);
  assert.equal(stale.snapshot().empire.config.systems[FIRST].enabled, false);
  const reloaded = helper({ initial: stale.snapshot(), saved: new Map(clone([...stale.saved])) });
  await converge(companion(reloaded, cloud.fetch), ca);
  for (const client of [a, b, stale, reloaded]) for (const field of ['role', 'enabled']) {
    assert.deepEqual(client.document().fields[system(FIRST, field)], document.fields[system(FIRST, field)]);
  }
});

test('empire transport: old documents without empire preserve a new client policy and propagate it', async () => {
  const cloud = drive(), old = helper({ empire: null });
  const oldCompanion = companion(old, cloud.fetch); await converge(oldCompanion);
  assert.deepEqual(imperialFields(old.document()), {});
  const fresh = helper({ empire: imperial({ enabled: true, fleetTargets: { probe: 81 } }) });
  const cf = companion(fresh, cloud.fetch); await converge(cf);
  assert.equal(fresh.snapshot().empire.config.fleetTargets.probe, 81);
  assert.equal(fresh.snapshot().empire.config.enabled, true);
  const next = helper({ empire: null }); const cn = companion(next, cloud.fetch);
  await converge(cn, cf);
  assert.equal(next.snapshot().empire.scope, SCOPE);
  assert.equal(next.snapshot().empire.config.fleetTargets.probe, 81);
  assert.equal(next.snapshot().empire.config.enabled, false);
  assert.equal(next.snapshot().empire.config.systems[FIRST].role, 'industry');
  assert.equal(next.snapshot().empire.config.systems[FIRST].name, '');
  assert.deepEqual(next.document(), fresh.document());
});

test('empire transport: another Google account cannot receive an in-flight prior account download', async () => {
  const cloud = drive();
  const first = helper({ empire: imperial({ fleetTargets: { probe: 15 } }) });
  const second = helper({ empire: imperial({ fleetTargets: { probe: 55 } }) });
  await converge(companion(first, cloud.fetch, ACCOUNT));
  await converge(companion(second, cloud.fetch, OTHER_ACCOUNT));
  const client = helper(); let transport, switched = false;
  transport = companion(client, async (url, options) => {
    const response = await cloud.fetch(url, options);
    if (!switched && /\/files\/[^/?]+\?/.test(url)) {
      switched = true; transport.switchAccount(OTHER_ACCOUNT);
    }
    return response;
  });
  await assert.rejects(transport.sync(), error => error.code === 'expired');
  assert.equal(switched, true); assert.equal(client.run('view').applied, 0);
  assert.equal(client.snapshot().empire.config.fleetTargets.probe, 3);
  await converge(transport);
  assert.equal(client.snapshot().empire.config.fleetTargets.probe, 55);
  for (const file of cloud.files.values()) assert.equal(file.body.document.fields[target('probe')].value,
    file.account === ACCOUNT ? 15 : 55);
  assert.deepEqual(transport.authCalls, []);
});

test('empire transport: changing galaxy or game player rejects stale downloads and isolates subsequent polling', async () => {
  for (const nextScope of [OTHER_GALAXY, OTHER_PLAYER]) {
    const cloud = drive();
    const remote = helper({ empire: imperial({ fleetTargets: { probe: 71 } }) });
    await converge(companion(remote, cloud.fetch));
    const nextBackupClient = helper({ scope: nextScope, empire: imperial({ scope: nextScope, fleetTargets: { probe: 22 } }) });
    const local = helper(); let switched = false;
    const transport = companion(local, async (url, options) => {
      const response = await cloud.fetch(url, options);
      if (!switched && /\/files\/[^/?]+\?/.test(url)) {
        switched = true; local.run('replace', nextBackupClient.snapshot());
      }
      return response;
    });
    await assert.rejects(transport.sync(), error => error.code === 'invalid_sync');
    assert.equal(local.run('view').applied, 0);
    assert.equal(local.snapshot().empire.scope, nextScope);
    assert.equal(local.snapshot().empire.config.fleetTargets.probe, 22);
    await converge(transport);
    const scopes = new Set([...cloud.files.values()].map(file => file.body.document.scope));
    assert.deepEqual(scopes, new Set([SCOPE, nextScope]));
    const hashes = new Set([...cloud.files.values()].map(file => file.metadata.appProperties.scopeHash));
    assert.equal(hashes.size, 2);
    for (const file of cloud.files.values()) assert.equal(file.body.document.fields[target('probe')].value,
      file.body.document.scope === SCOPE ? 71 : 22);
  }
});
