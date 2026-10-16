'use strict';
const test = require('node:test');
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
const fixture = fixtureSource.slice(fixtureSource.indexOf('const BUILDINGS ='), fixtureSource.indexOf('const maybe ='));
const integration = source.slice(source.indexOf('  function createPreferenceSync('), source.indexOf('  // END SHARED PREFERENCES INTEGRATION'));
const clone = value => JSON.parse(JSON.stringify(value));
const SCOPE = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT = 'id:test-account';

function helper(initial, saved = new Map()) {
  let failWrite = false;
  const context = vm.createContext({ console, crypto: crypto.webcrypto,
    __read: key => saved.has(key) ? JSON.stringify(saved.get(key)) : null,
    __write: (key, text) => { if (failWrite) throw new Error('Storage failure'); saved.set(key, JSON.parse(text)); },
  });
  vm.runInContext(coreSource + '\nconst core = globalThis.OldLightSyncCore;\n' + fixture + '\n' + integration + `
    let current = backup(); let scope = SCOPE; let applied = 0; let blocked = false;
    function validateBackup(value) { return value; }
    const sync = createPreferenceSync({
      getBackup: () => current, getScope: () => scope, getClientId: () => 'test-client',
      gmGetValue: (key, fallback) => { const value = __read(key); return value === null ? fallback : JSON.parse(value); },
      gmSetValue: (key, value) => __write(key, JSON.stringify(value)),
      applyPreferences: value => { if (blocked) throw Object.assign(new Error('Editing'), { code: 'busy' }); current = value; applied++; },
    });
    this.invoke = (method, data) => {
      const value = JSON.parse(data);
      if (method === 'initial') { current = value; sync.observe(); return true; }
      if (method === 'observe') return sync.observe() || null;
      if (method === 'get') return sync.get(value);
      if (method === 'merge') return sync.merge(value);
      if (method === 'view') return { current, applied };
      if (method === 'blocked') { blocked = value; return true; }
      if (method === 'scope') { scope = value; return true; }
      if (method === 'edit') { current = core.overlay(current, value); sync.observe(); return true; }
      throw new Error('Unexpected helper method');
    };
    this.fixture = () => backup();
  `, context);
  const run = (method, value = null) => clone(context.invoke(method, JSON.stringify(value)));
  run('initial', initial || clone(context.fixture()));
  return { run, saved, failStorage: value => { failWrite = value; }, snapshot: () => run('view').current };
}
function receive(client, documents, extras = {}) {
  return client.run('merge', { account: ACCOUNT, scope: SCOPE, documents, ...extras });
}

test('userscript embeds the exact tested core without an external dependency', () => {
  const start = source.indexOf('// BEGIN EMBEDDED SYNC CORE\n') + '// BEGIN EMBEDDED SYNC CORE\n'.length;
  const finish = source.indexOf('\n// END EMBEDDED SYNC CORE');
  assert.ok(start > 0 && finish > start);
  assert.equal(source.slice(start, finish), coreSource.trim());
});

test('first connection bootstraps; stale second client automatically receives building priorities', () => {
  const a = helper(); a.run('edit', { 'settings.order': [...a.snapshot().settings.order].reverse() });
  const remote = receive(a, []).document;
  const b = helper(); receive(b, [remote]);
  assert.deepEqual(b.snapshot().settings.order, a.snapshot().settings.order);
  assert.equal(b.run('view').applied, 1);
  const again = receive(b, [remote]);
  assert.equal(again.changed, false);
  assert.deepEqual(again.document, remote);
});

test('offline changes survive a helper reload and merge with a different remote field', () => {
  const a = helper(), b = helper();
  const seed = receive(a, []).document; receive(b, [seed]);
  a.run('edit', { 'settings.shipMinimums.marauder': 12 });
  const reloaded = helper(a.snapshot(), a.saved);
  b.run('edit', { 'settings.depotFillPercent': 77 });
  const cloud = receive(b, [seed]).document;
  const merged = receive(reloaded, [cloud]);
  assert.equal(reloaded.snapshot().settings.shipMinimums.marauder, 12);
  assert.equal(reloaded.snapshot().settings.depotFillPercent, 77);
  receive(b, [merged.document]);
  assert.equal(b.snapshot().settings.shipMinimums.marauder, 12);
});

test('remote merge preserves local runtime, presentation and unrelated numeric drafts', () => {
  const a = helper(), b = helper(); const seed = receive(a, []).document; receive(b, [seed]);
  const before = b.snapshot();
  a.run('edit', { 'settings.shipMinimums.marauder': 18, 'notifications.paused': true });
  receive(b, [receive(a, [seed]).document]);
  const after = b.snapshot();
  assert.deepEqual(after.fleetMissions, before.fleetMissions);
  assert.deepEqual(after.attackRetries.campaigns, before.attackRetries.campaigns);
  assert.deepEqual(after.notifications.browserPauseEpoch, before.notifications.browserPauseEpoch);
  assert.deepEqual(after.settings.panelPosition, before.settings.panelPosition);
  assert.equal(after.settings.activeTab, before.settings.activeTab);
  assert.equal(after.notifications.paused, true);
});

test('editing defers applying remote data without stamping old values over the remote journal', () => {
  const a = helper(), b = helper(); const seed = receive(a, []).document; receive(b, [seed]);
  a.run('edit', { 'settings.shipMinimums.marauder': 33 });
  const remote = receive(a, [seed]).document;
  b.run('blocked', true);
  assert.throws(() => receive(b, [remote]), error => error.code === 'busy');
  assert.equal(b.snapshot().settings.shipMinimums.marauder, 0);
  b.run('blocked', false);
  const merged = receive(b, [remote]);
  assert.equal(b.snapshot().settings.shipMinimums.marauder, 33);
  assert.deepEqual(merged.document.fields['settings.shipMinimums.marauder'], remote.fields['settings.shipMinimums.marauder']);
});

test('storage failure rejects synchronization before replacing local settings', () => {
  const a = helper(), b = helper(); const seed = receive(a, []).document; receive(b, [seed]);
  a.run('edit', { 'settings.shipMinimums.marauder': 7 }); const remote = receive(a, [seed]).document;
  b.failStorage(true);
  assert.throws(() => receive(b, [remote]));
  assert.equal(b.snapshot().settings.shipMinimums.marauder, 0);
  b.failStorage(false); receive(b, [remote]);
  assert.equal(b.snapshot().settings.shipMinimums.marauder, 7);
});

test('scope changes during a request cannot apply a different game account snapshot', () => {
  const a = helper(), b = helper(); const remote = receive(a, []).document;
  b.run('scope', 'othergalaxy/otherplayer');
  assert.throws(() => receive(b, [remote]), error => error.code === 'invalid_sync');
  assert.equal(b.run('view').applied, 0);
});

test('Google account identity is required for synchronization', () => {
  const a = helper();
  for (const account of ['', null, 'not-an-account']) assert.throws(() => a.run('get', account), error => error.code === 'sync_account');
});

function fakeNode() {
  return { value: '', checked: false, disabled: false, hidden: false, textContent: '', dataset: {},
    classList: { toggle() {}, add() {}, remove() {} }, replaceChildren() {}, append() {},
    addEventListener() {}, setAttribute() {}, remove() {}, focus() {}, click() {} };
}
function companion(client, fetcher) {
  const nodes = new Map(), messages = [];
  const context = vm.createContext({ console, crypto: crypto.webcrypto, TextEncoder, TextDecoder, URL,
    Blob, Response, AbortController, Intl, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: fetcher, window: { google: null },
    document: { activeElement: null, hidden: false, getElementById: id => {
      if (!nodes.has(id)) nodes.set(id, fakeNode()); return nodes.get(id);
    }, createElement: () => fakeNode() },
    __post: message => messages.push(clone(message)),
    __rpc: (type, data) => {
      const message = JSON.parse(data);
      if (type === 'get-sync') return JSON.stringify(client.run('get', message.account));
      if (type === 'merge-sync') return JSON.stringify(client.run('merge', message));
      throw new Error('Unexpected RPC: ' + type);
    },
  });
  let bootstrap = companionSource.slice(0, companionSource.indexOf("  ui.connect.addEventListener"));
  bootstrap += `
    bridgeAlive = true; configReady = true; config = { ...config, clientId: 'test-client', autoSync: true };
    capabilities = new Set(['settings-sync-v1']); token = 'unit-test-only'; expiresAt = Date.now() + 600000;
    account = { id: 'test-account' }; port = { postMessage: __post };
    rpc = async (type, fields) => JSON.parse(await __rpc(type, JSON.stringify(fields)));
    globalThis.testing = {
      sync: () => syncSettings(),
      invalidate: () => { generation++; },
      status: code => status(code),
      changed: sharedChanged => {
        onPortMessage({ data: { protocol: PROTOCOL, type: 'settings-changed', sharedChanged } });
        // Keep these direct-cycle tests deterministic; production still schedules its retry.
        clearTimeout(syncTimer); syncTimer = null;
      },
      state: () => ({ syncPending, syncLastAt, syncFailures, syncFileId, syncPublishedHash,
        statusCode, syncText: ui['sync-status'].textContent, operationText: ui.status.textContent }),
    };
  })();`;
  vm.runInContext(coreSource + '\n' + bootstrap, context);
  return Object.assign(context.testing, { messages });
}
function drive() {
  const files = new Map(); let calls = 0, writes = 0, fail = false;
  const fetcher = async (urlString, options) => {
    calls++;
    if (fail) throw new Error('Offline');
    const url = new URL(urlString);
    if (options.method === 'GET' && url.pathname === '/drive/v3/files') {
      const scope = /key='scopeHash' and value='([^']+)'/.exec(url.searchParams.get('q'))?.[1];
      const filtered = [...files.values()].filter(file => file.metadata.appProperties.scopeHash === scope);
      const offset = Number(url.searchParams.get('pageToken') || 0), size = Number(url.searchParams.get('pageSize') || 100);
      return new Response(JSON.stringify({ files: filtered.slice(offset, offset + size).map(file => file.metadata),
        ...(filtered.length > offset + size ? { nextPageToken: String(offset + size) } : {}) }));
    }
    const id = url.pathname.split('/').at(-1);
    if (options.method === 'GET') return new Response(JSON.stringify(files.get(id).body));
    assert.ok(['POST', 'PATCH'].includes(options.method));
    const boundary = /boundary=(.+)$/.exec(options.headers['Content-Type'])[1];
    const parts = (await options.body.text()).split('--' + boundary).slice(1, -1)
      .map(part => JSON.parse(part.slice(part.indexOf('\r\n\r\n') + 4).trim()));
    const fileId = options.method === 'POST' ? 'file_' + (files.size + 1) : id;
    const version = String(Number(files.get(fileId)?.metadata.version || 0) + 1);
    const metadata = { ...parts[0], id: fileId, version, size: String(Buffer.byteLength(JSON.stringify(parts[1]))),
      createdTime: '2026-10-13T12:00:00Z', modifiedTime: new Date().toISOString() };
    files.set(fileId, { metadata, body: parts[1] }); writes++;
    return new Response(JSON.stringify(metadata));
  };
  return { files, fetch: fetcher, fail: value => { fail = value; }, counts: () => ({ calls, writes }) };
}

test('two complete companion transports converge automatically without manual backup restoration', async () => {
  const cloud = drive(), a = helper(), b = helper();
  const ca = companion(a, cloud.fetch), cb = companion(b, cloud.fetch);
  await ca.sync(); await cb.sync();
  a.run('edit', { 'settings.order': [...a.snapshot().settings.order].reverse() });
  b.run('edit', { 'settings.shipMinimums.marauder': 25 });
  await ca.sync(); await cb.sync(); await ca.sync(); await cb.sync();
  assert.deepEqual(a.snapshot().settings.order, b.snapshot().settings.order);
  assert.equal(a.snapshot().settings.shipMinimums.marauder, 25);
  assert.equal(b.snapshot().settings.shipMinimums.marauder, 25);
  const writes = cloud.counts().writes;
  await ca.sync(); await cb.sync();
  assert.equal(cloud.counts().writes, writes, 'unchanged settings must not produce an upload loop');
});

test('a shared edit immediately reports pending before any new Drive request', async () => {
  const cloud = drive(), a = helper(), ca = companion(a, cloud.fetch);
  await ca.sync();
  assert.equal(ca.state().statusCode, 'synced');
  const before = cloud.counts();
  a.run('edit', { 'settings.shipMinimums.marauder': 17 }); ca.changed(true);
  assert.deepEqual(cloud.counts(), before);
  assert.equal(ca.state().syncPending, true);
  assert.equal(ca.state().statusCode, 'sync_pending');
  assert.equal(ca.messages.at(-1).code, 'sync_pending');
  assert.match(ca.state().operationText, /cambios pendientes/i);
  assert.doesNotMatch(ca.state().syncText, /^Sincronizado/);
  await ca.sync();
  assert.equal(ca.state().statusCode, 'synced');
  assert.equal(ca.state().syncPending, false);
});

test('an edit during upload keeps the finished cycle pending until the later edit is uploaded', async () => {
  const cloud = drive(), a = helper(); let ca, edited = false;
  ca = companion(a, async (url, options) => {
    const response = await cloud.fetch(url, options);
    if (!edited && ['POST', 'PATCH'].includes(options.method)) {
      edited = true;
      a.run('edit', { 'settings.shipMinimums.marauder': 23 }); ca.changed(true);
      assert.equal(ca.state().statusCode, 'syncing', 'an active upload keeps its progress status');
    }
    return response;
  });
  await ca.sync();
  assert.equal(ca.state().syncPending, true);
  assert.equal(ca.state().statusCode, 'sync_pending');
  assert.equal(ca.messages.at(-1).code, 'sync_pending');
  assert.equal([...cloud.files.values()][0].body.document.fields['settings.shipMinimums.marauder'].value, 0);
  await ca.sync();
  assert.equal(ca.state().syncPending, false);
  assert.equal(ca.state().statusCode, 'synced');
  assert.equal([...cloud.files.values()][0].body.document.fields['settings.shipMinimums.marauder'].value, 23);
});

test('pending edits preserve current errors and local-only changes do not claim pending sync', async () => {
  const cloud = drive(), a = helper(), ca = companion(a, cloud.fetch);
  await ca.sync();
  const before = ca.messages.length;
  ca.changed(false);
  assert.equal(ca.state().statusCode, 'synced');
  assert.equal(ca.state().syncPending, false);
  assert.equal(ca.messages.length, before);
  for (const code of ['invalid_sync', 'sync_account', 'storage_error', 'rate_limit', 'failed', 'expired']) {
    ca.status(code); const previous = ca.messages.length;
    ca.changed(true);
    assert.equal(ca.state().statusCode, code);
    assert.equal(ca.messages.length, previous, 'pending must not conceal ' + code);
  }
});

test('transport retains an offline edit and sends it on the next successful cycle', async () => {
  const cloud = drive(), a = helper(), b = helper(); const ca = companion(a, cloud.fetch), cb = companion(b, cloud.fetch);
  await ca.sync(); await cb.sync();
  a.run('edit', { 'settings.depotFillPercent': 64 }); cloud.fail(true);
  await assert.rejects(ca.sync());
  assert.equal(a.snapshot().settings.depotFillPercent, 64);
  cloud.fail(false); await ca.sync(); await cb.sync();
  assert.equal(b.snapshot().settings.depotFillPercent, 64);
});

test('invalidated authorization cannot apply a download from the prior session', async () => {
  const cloud = drive(), a = helper(); const seed = companion(a, cloud.fetch); await seed.sync();
  const b = helper(); let cb; let invalidated = false;
  cb = companion(b, async (...args) => {
    const response = await cloud.fetch(...args);
    if (!invalidated) { invalidated = true; cb.invalidate(); }
    return response;
  });
  await assert.rejects(cb.sync(), error => error.code === 'expired');
  assert.equal(b.run('view').applied, 0);
});


test('many historical replicas paginate and merge without an oversized bridge message', async () => {
  const cloud = drive(), a = helper();
  a.run('edit', { 'settings.order': [...a.snapshot().settings.order].reverse() });
  await companion(a, cloud.fetch).sync();
  const seed = [...cloud.files.values()][0];
  for (let i = 0; i < 120; i++) {
    const replica = crypto.randomUUID(), item = clone(seed);
    item.metadata.id = 'archived_' + i;
    item.metadata.name = 'old-light-auto-upgrade-sync-' + replica + '.json';
    item.metadata.appProperties.replica = replica;
    cloud.files.set(item.metadata.id, item);
  }
  const b = helper(); await companion(b, cloud.fetch).sync();
  assert.deepEqual(b.snapshot().settings.order, a.snapshot().settings.order);
  assert.ok(cloud.counts().calls >= 124, 'must read every page and replica');
});

test('unchanged observations do not keep resetting the automatic synchronization timer', () => {
  const a = helper();
  assert.equal(a.run('observe'), null);
  receive(a, []);
  assert.equal(a.run('observe'), null);
  const state = a.run('get', ACCOUNT).document;
  for (let i = 0; i < 10; i++) a.run('observe');
  assert.deepEqual(a.run('get', ACCOUNT).document, state);
});

test('all persisted settings have an explicit shared or local classification', () => {
  const constants = source.slice(source.indexOf('  const KEY ='), source.indexOf('  const upgradeEta ='));
  const helpers = source.slice(source.indexOf('  function normalizeOrder('), source.indexOf('  function text(node)'));
  const ctx = vm.createContext({});
  vm.runInContext(constants + helpers + '\nthis.defaults = normalizeSettings({});', ctx);
  const knownLocal = ['creditProtection', 'expanded', 'minimized', 'panelPosition', 'panelWidth', 'uiSections', 'activeTab',
    'conditionsExpanded', 'automaticMinimumReceipts', 'fleetExpanded', 'numericDrafts'];
  const knownShared = ['enabled', 'excluded', 'order', 'shipMinimums', 'shipOrder', 'countAway',
    'shiftPresetShortcut', 'presetCatalog', 'depotFillPercent'];
  assert.deepEqual(Object.keys(ctx.defaults).sort(), [...knownLocal, ...knownShared].sort());
});
