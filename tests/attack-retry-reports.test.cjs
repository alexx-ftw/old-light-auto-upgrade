'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourceFile = process.env.QA_REPORTS_SOURCE
  ? path.resolve(process.env.QA_REPORTS_SOURCE)
  : path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const source = fs.readFileSync(sourceFile, 'utf8');
const begin = source.indexOf('// BEGIN REPORTS');
const end = source.indexOf('// END REPORTS', begin);
assert.ok(begin >= 0 && end > begin, 'Published reports factory is present');
const createReportsWatcher = vm.runInNewContext(
  source.slice(begin, end) + '\ncreateReportsWatcher;',
  { URLSearchParams, AbortController }, { filename: path.basename(sourceFile) },
);

const START = Date.parse('2026-10-11T17:00:00.000Z');
const GALAXY = 'retry-reports-qa';
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const PREFIX = 'old-light-reports:runtime:v1:';
const SHIPS = ['probe', 'marauder', 'sentinel', 'vanguard'];
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const quantities = values => SHIPS.map(type => ({ type, kind: 'exact', quantity: values[type] || 0 }));
let reportSequence = 0;

function report({ when = START, verdict = 'Defeat', quantity = 7, id } = {}) {
  id ||= `aaaaaaaa-aaaa-4aaa-8aaa-${String(++reportSequence).padStart(12, '0')}`;
  const stamp = new Date(when).toISOString();
  return {
    item: { id, title: "You attacked Mirairot's Mirairot Sovereignty 001", takenAt: stamp,
      verdict, verdictTone: 'negative', borderKind: 'combat', readAt: null },
    detail: { id, createdAt: stamp,
      route: { from: { name: "xMix's System", q: -95, r: 260, ownerKind: 'owned' },
        to: { name: 'Mirairot Sovereignty 001', q: -93, r: 266, ownerKind: 'human', ownerName: 'Mirairot' } },
      sections: { battle: { attackerShips: quantities({ marauder: quantity }),
        attackerLost: quantities({ marauder: quantity }),
        defenderShips: SHIPS.map(type => ({ type, kind: 'unknown' })),
        defenderLost: SHIPS.map(type => ({ type, kind: 'unknown' })),
        targetOwnerKind: 'human', plundered: { pa: 0, ir: 0, credits: 0 } } } },
  };
}

function harness(t, options = {}) {
  let clock = START;
  let timerSequence = 0;
  let account = options.account ?? ACCOUNT_A;
  let since = options.since ?? null;
  let hidden = false;
  let pathname = `/game/galaxy/${GALAXY}`;
  let callbackFailures = 0;
  let notificationFailures = 0;
  let holdNextDetail = false;
  let held = null;
  const timers = new Map();
  const store = options.store || new Map();
  const rowsByAccount = new Map();
  const detailsByAccount = new Map();
  const callbacks = [];
  const callbackAttempts = [];
  const notifications = [];
  const reads = [];
  const callbackOrder = [];
  const checkpoints = [];
  const watchers = [];
  const later = (fn, ms) => {
    const id = ++timerSequence;
    timers.set(id, { fn, at: clock + Math.max(0, Number(ms) || 0) });
    return id;
  };
  const cancel = id => timers.delete(id);
  const key = owner => PREFIX + GALAXY + (options.omitAccount ? '' : `:${owner}`);
  const records = owner => rowsByAccount.get(owner) || [];
  const detailRecords = owner => detailsByAccount.get(owner) || new Map();
  const settle = async () => {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  };
  function replace(recordsInput, owner = account) {
    rowsByAccount.set(owner, recordsInput.map(value => clone(value.item)).sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt)));
    detailsByAccount.set(owner, new Map(recordsInput.map(value => [value.item.id, { detail: clone(value.detail), status: 200 }])));
  }
  function makeWatcher() {
    const deps = {
      gmGetValue: (name, fallback) => store.has(name) ? clone(store.get(name)) : fallback,
      gmSetValue: (name, value) => {
        const saved = clone(value);
        store.set(name, saved);
        checkpoints.push({ key: name, value: saved });
      },
      now: () => clock,
      setTimeout: later,
      clearTimeout: cancel,
      AbortController,
      getPathname: () => pathname,
      getHidden: () => hidden,
      getBaselineSince: () => since,
      fetch: async (url, init) => {
        const endpoint = new URL(url);
        const owner = account;
        reads.push({ account: owner, url, ...init, signal: undefined });
        assert.equal(endpoint.origin, 'https://api.oldlight.io');
        assert.equal(init.method, 'GET');
        assert.equal(init.credentials, 'include');
        assert.equal(init.body, undefined);
        if (endpoint.pathname === `/api/galaxy/${GALAXY}/reports`) {
          const list = clone(records(owner));
          const cursor = Number(endpoint.searchParams.get('before') || '0');
          const limit = Number(endpoint.searchParams.get('limit') || '20');
          return { ok: true, status: 200, json: async () => ({ items: list.slice(cursor, cursor + limit),
            nextCursor: cursor + limit < list.length ? String(cursor + limit) : null }) };
        }
        assert.match(endpoint.pathname, new RegExp(`^/api/galaxy/${GALAXY}/reports/[a-f0-9-]{36}$`));
        const value = detailRecords(owner).get(endpoint.pathname.split('/').pop());
        assert.ok(value, 'Fixture has the requested report detail');
        const response = { ok: value.status === 200, status: value.status,
          headers: { get: () => null }, json: async () => clone(value.detail) };
        if (!holdNextDetail) return response;
        holdNextDetail = false;
        return new Promise(resolve => { held = { owner, resolve: () => resolve(response), signal: init.signal }; });
      },
    };
    if (!options.omitAccount) deps.getAccount = () => account;
    if (options.callback !== false) deps.onReport = value => {
      callbackAttempts.push(clone(value));
      callbackOrder.push('callback');
      if (callbackFailures > 0) { callbackFailures--; throw new Error('Fixture storage failure'); }
      callbacks.push(clone(value));
    };
    if (options.notify !== false) deps.send = value => {
      callbackOrder.push('notification');
      if (notificationFailures > 0) { notificationFailures--; throw new Error('Fixture notification failure'); }
      notifications.push(clone(value));
      return true;
    };
    const instance = createReportsWatcher(deps);
    watchers.push(instance);
    return instance;
  }
  let watcher = makeWatcher();
  t.after(() => {
    for (const instance of watchers) instance.destroy();
    held?.resolve();
    for (const read of reads) {
      assert.equal(read.method, 'GET');
      assert.equal(read.credentials, 'include');
      assert.equal(read.body, undefined);
    }
  });
  async function advance(ms) {
    const target = clock + ms;
    let count = 0;
    for (;;) {
      await settle();
      const next = [...timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      assert.ok(++count < 200, 'No timer spin');
      clock = Math.max(clock, next[1].at);
      timers.delete(next[0]);
      next[1].fn();
    }
    clock = target;
    await settle();
  }
  async function tick(input = {}) {
    watcher.tick({ active: true, enabled: true, unread: records(account).length, ...input });
    await settle();
  }
  async function add(value, owner = account) {
    rowsByAccount.set(owner, [clone(value.item), ...records(owner)].sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt)));
    const details = detailRecords(owner);
    details.set(value.item.id, { detail: clone(value.detail), status: 200 });
    detailsByAccount.set(owner, details);
    await advance(3_000);
    await tick();
  }
  return {
    callbacks, callbackAttempts, callbackOrder, notifications, reads, store, checkpoints,
    key, replace, add, tick, advance, settle,
    get watcher() { return watcher; }, get now() { return clock; }, get held() { return held; },
    setAccount: value => { account = value; },
    setSince: value => { since = value; },
    setHidden: value => { hidden = value; },
    setPathname: value => { pathname = value; },
    failCallbacks: value => { callbackFailures = value; },
    failNotifications: value => { notificationFailures = value; },
    holdDetail: () => { holdNextDetail = true; },
    releaseDetail: async () => { const pending = held; held = null; pending?.resolve(); await settle(); },
    setDetailStatus: (id, status) => { detailRecords(account).get(id).status = status; },
    restart: async () => { watcher.destroy(); watcher = makeWatcher(); await tick(); },
  };
}

test('Raw report callback runs before notification with exact detail and unchanged combat formatting', async t => {
  const h = harness(t);
  await h.tick();
  const value = report({ when: h.now + 1 });
  await h.add(value);
  assert.equal(h.callbacks.length, 1);
  assert.deepEqual(h.callbackOrder, ['callback', 'notification']);
  const received = h.callbacks[0];
  assert.equal(received.scope, `${GALAXY}/${ACCOUNT_A}`);
  assert.deepEqual(received.detail, value.detail);
  assert.equal(received.item.id, value.item.id);
  assert.equal(received.item.verdict, 'Defeat');
  assert.equal(received.item.takenAt, Date.parse(value.item.takenAt));
  assert.equal(h.notifications.length, 1);
  const notification = h.notifications[0];
  assert.equal(notification.type, 'game.reports');
  assert.equal(notification.id, `report:${value.item.id}`);
  assert.equal(notification.title, 'Old Light');
  assert.equal(notification.reportKind, 'battle');
  assert.equal(notification.systemName, '');
  assert.match(notification.message, /📍 Destino: Mirairot Sovereignty 001 · \(-93, 266\)/);
  assert.match(notification.message, /Origen: xMix's System · \(-95, 260\)/);
  assert.match(notification.message, /Resultado: Derrota/);
  assert.match(notification.message, /Flota atacante: 7 Marauder/);
  assert.match(notification.message, /Bajas atacantes: 7 Marauder/);
  assert.match(notification.message, /Flota defensora: desconocida/);
  assert.doesNotMatch(notification.message, /Probe 0|Marauder 0|You attacked|undefined/);
});

test('Retry report observation works with no notification callback or notification channels', async t => {
  const h = harness(t, { notify: false });
  await h.tick();
  assert.equal(h.watcher.getDiagnostics().apiAvailable, true);
  await h.add(report({ when: h.now + 1 }));
  assert.equal(h.callbacks.length, 1);
  assert.equal(h.notifications.length, 0);
  assert.equal(h.watcher.getDiagnostics().pending, 0);
});

test('Initial baseline delivers only reports strictly newer than retry enable timestamp', async t => {
  const h = harness(t, { since: START - 1_000, notify: false });
  const older = report({ when: START - 2_000 });
  const atBoundary = report({ when: START - 1_000 });
  const fresh = report({ when: START - 500 });
  h.replace([fresh, atBoundary, older]);
  await h.tick();
  assert.deepEqual(h.callbacks.map(value => value.item.id), [fresh.item.id]);
  assert.equal(h.watcher.getDiagnostics().baselineReady, true);
  assert.equal(h.reads.filter(value => /\/reports\//.test(value.url)).length, 1);
  const saved = h.store.get(h.key(ACCOUNT_A));
  assert.equal(saved.pending.length, 0);
  assert.deepEqual(new Set(saved.seen.map(([id]) => id)), new Set([older.item.id, atBoundary.item.id, fresh.item.id]));
});

test('Retry enable baseline continues pagination when more than one page of fresh reports exists', async t => {
  const h = harness(t, { since: START - 1_000, notify: false });
  const fresh = Array.from({ length: 21 }, (_, index) => report({ when: START - 900 + index }));
  const atBoundary = report({ when: START - 1_000 });
  const historical = report({ when: START - 2_000 });
  h.replace([...fresh, atBoundary, historical]);
  await h.tick();
  assert.equal(h.callbacks.length, 20);
  await h.restart();
  await h.advance(25_000);
  assert.deepEqual(new Set(h.callbacks.map(value => value.item.id)), new Set(fresh.map(value => value.item.id)));
  assert.ok(!h.callbacks.some(value => value.item.id === historical.item.id));
  assert.ok(!h.callbacks.some(value => value.item.id === atBoundary.item.id));
  assert.equal(h.watcher.getDiagnostics().pending, 0);
});

test('Ordinary baseline remains silent when no retry enable timestamp is supplied', async t => {
  const h = harness(t);
  const historical = report({ when: START - 11 * 3_600_000 });
  h.replace([historical]);
  await h.tick();
  assert.equal(h.callbacks.length, 0);
  assert.equal(h.notifications.length, 0);
  const fresh = report({ when: h.now + 1 });
  await h.add(fresh);
  assert.deepEqual(h.callbacks.map(value => value.item.id), [fresh.item.id]);
});

test('Legacy notification-only clients retain the original per-galaxy checkpoint key and delivery', async t => {
  const h = harness(t, { callback: false, omitAccount: true });
  await h.tick();
  await h.add(report({ when: h.now + 1 }));
  assert.equal(h.notifications.length, 1);
  assert.equal(h.callbacks.length, 0);
  assert.ok(h.store.has(PREFIX + GALAXY));
  assert.ok([...h.store.keys()].every(value => value === PREFIX + GALAXY));
});

test('Disabling the watcher aborts a pending detail and prevents late callbacks or notifications', async t => {
  const h = harness(t);
  await h.tick();
  h.holdDetail();
  await h.add(report({ when: h.now + 1 }));
  assert.ok(h.held);
  const signal = h.held.signal;
  await h.tick({ active: false, enabled: false });
  assert.equal(signal.aborted, true);
  await h.releaseDetail();
  await h.advance(60_000);
  assert.equal(h.callbacks.length, 0);
  assert.equal(h.notifications.length, 0);
  assert.equal(h.watcher.getDiagnostics().enabled, false);
  assert.equal(h.watcher.getDiagnostics().inFlight, false);
  assert.equal(h.store.get(h.key(ACCOUNT_A)).suspended, true);
});

test('Account change before the next tick rejects an old in-flight response', async t => {
  const h = harness(t, { since: START - 1_000 });
  await h.tick();
  h.holdDetail();
  const old = report({ when: h.now + 1 });
  await h.add(old);
  assert.ok(h.held);
  h.setAccount(ACCOUNT_B);
  await h.releaseDetail();
  assert.equal(h.callbacks.length, 0);
  assert.equal(h.notifications.length, 0);
  const fresh = report({ when: h.now - 1 });
  h.replace([fresh], ACCOUNT_B);
  await h.tick();
  assert.deepEqual(h.callbacks.map(value => [value.scope, value.item.id]), [[`${GALAXY}/${ACCOUNT_B}`, fresh.item.id]]);
  assert.ok(h.store.has(h.key(ACCOUNT_A)));
  assert.ok(h.store.has(h.key(ACCOUNT_B)));
  assert.ok(!h.store.get(h.key(ACCOUNT_A)).seen.some(([id]) => id === old.item.id));
});

test('Changing account during a pending fetch aborts its generation and starts an independent checkpoint', async t => {
  const h = harness(t, { since: START - 1_000, notify: false });
  await h.tick();
  h.holdDetail();
  await h.add(report({ when: h.now + 1 }));
  assert.ok(h.held);
  const signal = h.held.signal;
  const fresh = report({ when: h.now - 1 });
  h.replace([fresh], ACCOUNT_B);
  h.setAccount(ACCOUNT_B);
  await h.tick();
  assert.equal(signal.aborted, true);
  await h.releaseDetail();
  await h.advance(0);
  assert.deepEqual(h.callbacks.map(value => [value.scope, value.item.id]), [[`${GALAXY}/${ACCOUNT_B}`, fresh.item.id]]);
  assert.ok(h.store.has(h.key(ACCOUNT_A)));
  assert.ok(h.store.has(h.key(ACCOUNT_B)));
});

test('Callback persistence failure leaves report pending and unremembered until a successful retry', async t => {
  const h = harness(t);
  await h.tick();
  h.failCallbacks(1);
  const value = report({ when: h.now + 1 });
  await h.add(value);
  assert.equal(h.callbackAttempts.length, 1);
  assert.equal(h.callbacks.length, 0);
  assert.equal(h.notifications.length, 0);
  assert.equal(h.watcher.getDiagnostics().pending, 1);
  let saved = h.store.get(h.key(ACCOUNT_A));
  assert.ok(saved.pending.some(item => item.id === value.item.id));
  assert.ok(!saved.seen.some(([id]) => id === value.item.id));
  await h.advance(5_000);
  assert.equal(h.callbackAttempts.length, 2);
  assert.equal(h.callbacks.length, 1);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.watcher.getDiagnostics().pending, 0);
  saved = h.store.get(h.key(ACCOUNT_A));
  assert.ok(saved.seen.some(([id]) => id === value.item.id));
  assert.equal(saved.pending.length, 0);
});

test('Seen report UUIDs prevent duplicate callbacks across polling, unread changes, and reload', async t => {
  const h = harness(t, { since: START - 1_000 });
  await h.tick();
  const value = report({ when: h.now + 1 });
  await h.add(value);
  await h.advance(25_000);
  await h.tick({ unread: 50 });
  await h.advance(3_000);
  await h.restart();
  await h.advance(0);
  assert.deepEqual(h.callbacks.map(item => item.item.id), [value.item.id]);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.watcher.getDiagnostics().pending, 0);
});

test('Identical report IDs in different accounts never share the seen checkpoint', async t => {
  const h = harness(t, { since: START - 1_000, notify: false });
  const first = report({ when: START - 1 });
  h.replace([first], ACCOUNT_A);
  await h.tick();
  const second = report({ when: START - 1, id: first.item.id, quantity: 8 });
  h.replace([second], ACCOUNT_B);
  h.setAccount(ACCOUNT_B);
  await h.tick();
  await h.advance(0);
  assert.deepEqual(h.callbacks.map(value => [value.scope, value.detail.sections.battle.attackerShips[1].quantity]),
    [[`${GALAXY}/${ACCOUNT_A}`, 7], [`${GALAXY}/${ACCOUNT_B}`, 8]]);
  assert.equal(h.store.get(h.key(ACCOUNT_A)).seen.length, 1);
  assert.equal(h.store.get(h.key(ACCOUNT_B)).seen.length, 1);
});

test('Missing report detail produces only a null-detail callback and the normal notification fallback', async t => {
  const h = harness(t);
  await h.tick();
  const value = report({ when: h.now + 1 });
  h.replace([value]);
  h.setDetailStatus(value.item.id, 404);
  await h.advance(3_000);
  await h.tick();
  assert.equal(h.callbacks.length, 1);
  assert.equal(h.callbacks[0].detail, null);
  assert.equal(h.callbacks[0].item.id, value.item.id);
  assert.equal(h.notifications.length, 1);
  assert.match(h.notifications[0].message, /ya no está disponible/);
  assert.equal(h.watcher.getDiagnostics().pending, 0);
});

test('Hidden document rejects a pending report before any operational callback', async t => {
  const h = harness(t, { notify: false });
  await h.tick();
  h.holdDetail();
  await h.add(report({ when: h.now + 1 }));
  assert.ok(h.held);
  h.setHidden(true);
  await h.releaseDetail();
  assert.equal(h.callbacks.length, 0);
  assert.equal(h.notifications.length, 0);
});
