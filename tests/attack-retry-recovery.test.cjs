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

const START = Date.parse('2026-10-11T17:12:00.000Z');
const GALAXY = 'attack-recovery-qa';
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const PREFIX = 'old-light-reports:runtime:v1:';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
let sequence = 0;

function report({ when = START - 500, verdict = 'Defeat', quantity = 8, id } = {}) {
  id ||= `aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12, '0')}`;
  const takenAt = new Date(when).toISOString();
  return {
    item: { id, takenAt, verdict, title: "You attacked Mirairot's Mirairot Sovereignty 001" },
    detail: { id, createdAt: takenAt,
      route: { from: { name: 'Technocratic Imperium', q: -95, r: 260, ownerKind: 'owned' },
        to: { name: 'Mirairot Sovereignty 001', q: -93, r: 266, ownerKind: 'human', ownerName: 'Mirairot' } },
      sections: { battle: {
        attackerShips: [{ type: 'marauder', kind: 'exact', quantity }],
        attackerLost: [{ type: 'marauder', kind: 'exact', quantity }],
        defenderShips: [{ type: 'marauder', kind: 'unknown' }],
        defenderLost: [{ type: 'marauder', kind: 'unknown' }],
        plundered: { pa: 0, ir: 0, credits: 0 },
      } },
    },
  };
}

function harness(t, options = {}) {
  let clock = START;
  let account = options.account || ACCOUNT_A;
  let since = Object.hasOwn(options, 'since') ? options.since : START - 1_000;
  let hidden = false;
  let pathname = `/game/galaxy/${GALAXY}`;
  let timerSequence = 0;
  let callbackFailures = 0;
  let markerFailures = 0;
  let hold = null;
  let held = null;
  let pageOverride = null;
  const rows = new Map();
  const details = new Map();
  const timers = new Map();
  const store = options.store || new Map();
  const reads = [];
  const recoveries = [];
  const recoveryAttempts = [];
  const observations = [];
  const notifications = [];
  const order = [];
  const gates = [];
  const watchers = [];
  const key = (owner = account) => PREFIX + GALAXY + ':' + owner;
  const later = (fn, ms) => {
    const id = ++timerSequence;
    timers.set(id, { fn, at: clock + Math.max(0, Number(ms) || 0) });
    return id;
  };
  const settle = async () => {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  };
  function replace(values, owner = account) {
    rows.set(owner, values.map(value => clone(value.item))
      .sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt)));
    details.set(owner, new Map(values.map(value => [value.item.id,
      { status: 200, detail: clone(value.detail) }])));
  }
  function seedSeen(owner = account) {
    const values = rows.get(owner) || [];
    store.set(key(owner), { version: 1, initialized: true, suspended: false,
      watermark: values.length ? Math.max(...values.map(item => Date.parse(item.takenAt))) : null,
      seen: values.map(item => [item.id, Date.parse(item.takenAt)]), pending: [], scan: null });
  }
  function seedPending(values, owner = account) {
    const all = rows.get(owner) || [];
    const ids = new Set(values.map(value => value.item.id));
    store.set(key(owner), { version: 1, initialized: true, suspended: false,
      watermark: all.length ? Math.max(...all.map(item => Date.parse(item.takenAt))) : null,
      seen: all.filter(item => !ids.has(item.id)).map(item => [item.id, Date.parse(item.takenAt)]),
      pending: values.map(value => clone(value.item)), scan: null,
      recovery: store.get(key(owner))?.recovery || null });
  }
  function makeWatcher() {
    const deps = {
      gmGetValue: (name, fallback) => store.has(name) ? clone(store.get(name)) : fallback,
      gmSetValue: (name, value) => {
        if (value.recovery && markerFailures > 0) {
          markerFailures--;
          throw new Error('Fixture marker write failure');
        }
        store.set(name, clone(value));
      },
      now: () => clock,
      setTimeout: later,
      clearTimeout: id => timers.delete(id),
      AbortController,
      getPathname: () => pathname,
      getHidden: () => hidden,
      getAccount: () => account,
      getBaselineSince: () => since,
      fetch: async (url, init) => {
        const endpoint = new URL(url);
        const owner = account;
        const kind = endpoint.pathname.endsWith('/reports') ? 'list' : 'detail';
        const phase = watcher.getDiagnostics().phase;
        reads.push({ url, owner, kind, phase, method: init.method,
          credentials: init.credentials, body: init.body });
        assert.equal(endpoint.origin, 'https://api.oldlight.io');
        assert.equal(init.method, 'GET');
        assert.equal(init.credentials, 'include');
        assert.equal(init.body, undefined);
        let status = 200;
        let payload;
        if (kind === 'list') {
          const before = endpoint.searchParams.get('before');
          const offset = Number(before || '0');
          const limit = Number(endpoint.searchParams.get('limit'));
          assert.equal(limit, 20, 'Uses native bounded pagination');
          const values = rows.get(owner) || [];
          payload = pageOverride ? pageOverride({ owner, before, offset, limit, phase })
            : { items: values.slice(offset, offset + limit),
              nextCursor: offset + limit < values.length ? String(offset + limit) : null };
        } else {
          assert.match(endpoint.pathname, new RegExp(`^/api/galaxy/${GALAXY}/reports/[a-f0-9-]{36}$`));
          const value = details.get(owner)?.get(endpoint.pathname.split('/').pop());
          status = value?.status || 404;
          payload = value?.detail || {};
        }
        const response = { ok: status === 200, status, headers: { get: () => null },
          json: async () => clone(payload) };
        if (hold && hold.kind === kind && (!hold.phase || hold.phase === phase)) {
          hold = null;
          return new Promise(resolve => { held = { owner, signal: init.signal,
            resolve: () => resolve(response) }; });
        }
        return response;
      },
    };
    if (options.observe !== false) deps.onReport = value => {
      order.push('observe');
      gates.push({ event: 'observe', reportId: value.item.id, blocked: watcher.isRecovering() });
      observations.push(clone(value));
    };
    if (options.notify !== false) deps.send = value => {
      order.push('notify');
      gates.push({ event: 'notify', reportId: value.id.slice('report:'.length), blocked: watcher.isRecovering() });
      notifications.push(clone(value));
    };
    if (options.recover !== false) deps.onRecoverReports = value => {
      order.push('recover');
      gates.push({ event: 'recover', blocked: watcher.isRecovering() });
      recoveryAttempts.push({ payload: clone(value), marker: clone(store.get(key())?.recovery || null) });
      if (callbackFailures > 0) {
        callbackFailures--;
        throw new Error('Fixture recovery persistence failure');
      }
      recoveries.push(clone(value));
      if (options.asyncRecovery) return Promise.resolve();
    };
    const instance = createReportsWatcher(deps);
    watchers.push(instance);
    return instance;
  }
  let watcher = makeWatcher();
  async function advance(ms) {
    const target = clock + ms;
    let count = 0;
    for (;;) {
      await settle();
      const next = [...timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      assert.ok(++count < 250, 'Watcher does not spin timers');
      clock = Math.max(clock, next[1].at);
      timers.delete(next[0]);
      next[1].fn();
    }
    clock = target;
    await settle();
  }
  async function tick(input = {}) {
    watcher.tick({ active: true, enabled: true, unread: rows.get(account)?.length || 0, ...input });
    await settle();
  }
  t.after(() => {
    for (const instance of watchers) instance.destroy();
    held?.resolve();
  });
  return {
    store, reads, recoveries, recoveryAttempts, observations, notifications, order, gates,
    key, replace, seedSeen, seedPending, tick, advance, settle,
    get watcher() { return watcher; }, get held() { return held; },
    setSince: value => { since = value; },
    setHidden: value => { hidden = value; },
    setAccount: value => { account = value; },
    setPathname: value => { pathname = value; },
    failCallbacks: count => { callbackFailures = count; },
    failMarkerWrites: count => { markerFailures = count; },
    overridePages: fn => { pageOverride = fn; },
    holdNext: (kind = 'detail', phase = 'recovery-detail') => { hold = { kind, phase }; },
    release: async () => { const value = held; held = null; value?.resolve(); await settle(); },
    setDetailStatus: (id, status, owner = account) => { details.get(owner).get(id).status = status; },
    setDetail: (id, value, owner = account) => { details.get(owner).get(id).detail = clone(value); },
    restart: async () => { watcher.destroy(); watcher = makeWatcher(); await tick(); },
  };
}

test('Previously seen post-enable defeat is recovered without repeating its notification or changing seen', async t => {
  const h = harness(t);
  const defeated = report({ quantity: 8 });
  h.replace([defeated]);
  h.seedSeen();
  const seen = clone(h.store.get(h.key()).seen);
  await h.tick();
  assert.equal(h.recoveries.length, 1);
  assert.equal(h.recoveries[0].scope, `${GALAXY}/${ACCOUNT_A}`);
  assert.equal(h.recoveries[0].reports[0].item.id, defeated.item.id);
  assert.equal(h.recoveries[0].reports[0].item.takenAt, Date.parse(defeated.item.takenAt));
  assert.deepEqual(h.recoveries[0].reports[0].detail, defeated.detail);
  assert.deepEqual(h.observations, []);
  assert.deepEqual(h.notifications, []);
  assert.deepEqual(h.store.get(h.key()).seen, seen);
  assert.deepEqual(h.store.get(h.key()).recovery, { version: 1, since: START - 1_000, floor: START - 1_000 });
  assert.equal(h.recoveryAttempts[0].marker, null, 'Marker is written only after the durable callback');
  assert.equal(h.watcher.isRecovering(), false);
  assert.equal(h.watcher.getDiagnostics().counters.recovered, 1);
});

test('Recovery consumer alone can read native reports with both notification and live callbacks absent', async t => {
  const h = harness(t, { observe: false, notify: false });
  h.replace([report()]);
  h.seedSeen();
  await h.tick();
  assert.equal(h.recoveries.length, 1);
  assert.equal(h.watcher.getDiagnostics().apiAvailable, true);
  assert.deepEqual(h.notifications, []);
});

test('The recovery batch is delivered before ordinary pending callbacks and first-time notifications', async t => {
  const h = harness(t);
  const fresh = report();
  h.replace([fresh]);
  await h.tick();
  assert.deepEqual(h.order, ['recover', 'observe', 'notify']);
  assert.equal(h.recoveries[0].reports[0].item.id, fresh.item.id);
  assert.equal(h.notifications[0].id, `report:${fresh.item.id}`);
});

test('Recovery ignores disabled, zero, invalid, and non-numeric enable timestamps', async t => {
  for (const since of [null, 0, -1, NaN, Infinity, '2026-10-11T17:00:00Z']) {
    const h = harness(t, { since });
    h.replace([report()]);
    h.seedSeen();
    await h.tick();
    assert.equal(h.recoveries.length, 0);
    assert.equal(h.reads.filter(read => read.kind === 'detail').length, 0);
    assert.equal(h.watcher.isRecovering(), false);
    assert.equal(h.store.get(h.key()).recovery, null);
  }
});

test('Only combat summaries strictly after the enable timestamp enter the recovery batch', async t => {
  const h = harness(t);
  const newer = ['Defeat', 'Victory', 'Draw', 'Captured'].map((verdict, index) =>
    report({ verdict, when: START - 100 - index }));
  const probe = report({ verdict: 'Probed', when: START - 50 });
  const boundary = report({ when: START - 1_000 });
  const old = report({ when: START - 40_000_000 });
  h.replace([...newer, probe, boundary, old]);
  h.seedSeen();
  await h.tick();
  assert.deepEqual(h.recoveries[0].reports.map(value => value.item.id), newer.map(value => value.item.id));
  assert.equal(h.reads.filter(read => read.kind === 'detail').length, 4);
  assert.equal(h.notifications.length, 0);
});

test('Newer reports with unknown or invalid fleet quantities are passed through for route-level blocking', async t => {
  const h = harness(t);
  const defeat = report({ when: START - 500 });
  const newer = report({ when: START - 100, verdict: 'Victory' });
  newer.detail.sections.battle.attackerShips = [{ type: 'marauder', kind: 'unknown' },
    { type: 'unrecognized', kind: 'exact', quantity: -2 }];
  h.replace([newer, defeat]);
  h.seedSeen();
  await h.tick();
  assert.deepEqual(h.recoveries[0].reports.map(value => value.item.id), [newer.item.id, defeat.item.id]);
  assert.deepEqual(h.recoveries[0].reports[0].detail, newer.detail);
});

test('UUID duplicates are read once and a successful marker prevents recovery after polling or reload', async t => {
  const h = harness(t);
  const first = report();
  h.replace([first, first]);
  h.seedSeen();
  await h.tick();
  await h.advance(25_000);
  await h.restart();
  await h.advance(25_000);
  assert.equal(h.recoveries.length, 1);
  assert.equal(h.recoveries[0].reports.length, 1);
  assert.equal(h.reads.filter(read => read.kind === 'detail').length, 1);
  assert.equal(h.notifications.length, 0);
});

test('A successful marker is retained when rebuilding an uninitialized silent baseline', async t => {
  const h = harness(t, { observe: false });
  h.replace([report()]);
  h.store.set(h.key(), { version: 1, initialized: false, suspended: false, seen: [], pending: [], scan: null,
    recovery: { version: 1, since: START - 1_000 } });
  await h.tick();
  assert.equal(h.recoveries.length, 0);
  assert.deepEqual(h.store.get(h.key()).recovery, { version: 1, since: START - 1_000, floor: START - 1_000 });
});

test('Different accounts keep independent recovery markers even for identical report UUIDs', async t => {
  const h = harness(t);
  const first = report();
  h.replace([first], ACCOUNT_A);
  h.seedSeen(ACCOUNT_A);
  h.replace([report({ id: first.item.id, quantity: 9 })], ACCOUNT_B);
  h.seedSeen(ACCOUNT_B);
  await h.tick();
  h.setAccount(ACCOUNT_B);
  await h.tick();
  assert.deepEqual(h.recoveries.map(value => value.scope), [`${GALAXY}/${ACCOUNT_A}`, `${GALAXY}/${ACCOUNT_B}`]);
  assert.equal(h.recoveries[1].reports[0].detail.sections.battle.attackerShips[0].quantity, 9);
  assert.ok(h.store.get(h.key(ACCOUNT_A)).recovery);
  assert.ok(h.store.get(h.key(ACCOUNT_B)).recovery);
});

test('A later enable period recovers only its own new combat reports', async t => {
  const h = harness(t);
  const oldPeriod = report({ when: START - 500 });
  h.replace([oldPeriod]);
  h.seedSeen();
  await h.tick();
  const newPeriod = report({ when: START + 5_000 });
  h.replace([newPeriod, oldPeriod]);
  h.seedSeen();
  h.setSince(START + 1_000);
  await h.advance(25_000);
  assert.equal(h.recoveries.length, 2);
  assert.deepEqual(h.recoveries[1].reports.map(value => value.item.id), [newPeriod.item.id]);
  assert.equal(h.store.get(h.key()).recovery.since, START + 1_000);
});

test('Recovery blocks actions from the initial list GET and while a detail is pending', async t => {
  const h = harness(t);
  h.replace([report()]);
  h.seedSeen();
  h.holdNext('list', 'list');
  await h.tick();
  assert.ok(h.held);
  assert.equal(h.watcher.isRecovering(), true);
  assert.equal(h.watcher.getDiagnostics().recovering, true);
  h.holdNext();
  await h.release();
  assert.ok(h.held);
  assert.equal(h.watcher.isRecovering(), true);
  assert.match(h.watcher.getDiagnostics().status, /recuperando los combates/);
  await h.release();
  assert.equal(h.watcher.isRecovering(), false);
});

test('Disabling the watcher aborts a recovery GET and ignores its late response', async t => {
  const h = harness(t);
  h.replace([report()]);
  h.seedSeen();
  h.holdNext();
  await h.tick();
  const signal = h.held.signal;
  await h.tick({ active: false, enabled: false });
  assert.equal(signal.aborted, true);
  await h.release();
  await h.advance(60_000);
  assert.equal(h.recoveries.length, 0);
  assert.equal(h.notifications.length, 0);
  assert.equal(h.store.get(h.key()).recovery, null);
  assert.equal(h.watcher.isRecovering(), false);
});

test('Disabling only the retry rule rejects a late recovery response without a watcher tick', async t => {
  const h = harness(t);
  h.replace([report()]);
  h.seedSeen();
  h.holdNext();
  await h.tick();
  h.setSince(null);
  await h.release();
  assert.equal(h.recoveries.length, 0);
  assert.equal(h.store.get(h.key()).recovery, null);
  assert.equal(h.watcher.isRecovering(), false);
  assert.equal(h.notifications.length, 0);
});

test('Changing the retry enable period aborts the old request and restarts with the new boundary', async t => {
  const h = harness(t);
  const older = report({ when: START - 500 });
  const newer = report({ when: START - 100 });
  h.replace([newer, older]);
  h.seedSeen();
  h.holdNext();
  await h.tick();
  const signal = h.held.signal;
  h.setSince(START - 200);
  await h.tick();
  assert.equal(signal.aborted, true);
  await h.release();
  await h.advance(3_000);
  assert.equal(h.recoveries.length, 1);
  assert.deepEqual(h.recoveries[0].reports.map(value => value.item.id), [newer.item.id]);
  assert.equal(h.store.get(h.key()).recovery.since, START - 200);
});

test('Account changes before a tick prevent the old response from reaching the recovery callback', async t => {
  const h = harness(t);
  h.replace([report()], ACCOUNT_A);
  h.seedSeen(ACCOUNT_A);
  const replacement = report({ quantity: 10 });
  h.replace([replacement], ACCOUNT_B);
  h.seedSeen(ACCOUNT_B);
  h.holdNext();
  await h.tick();
  h.setAccount(ACCOUNT_B);
  await h.release();
  assert.equal(h.recoveries.length, 0);
  await h.tick();
  assert.equal(h.recoveries.length, 1);
  assert.equal(h.recoveries[0].scope, `${GALAXY}/${ACCOUNT_B}`);
  assert.equal(h.recoveries[0].reports[0].item.id, replacement.item.id);
  assert.equal(h.store.get(h.key(ACCOUNT_A)).recovery, null);
});

test('Hiding the document rejects a pending recovery batch until a visible pass can finish', async t => {
  const h = harness(t);
  h.replace([report()]);
  h.seedSeen();
  h.holdNext();
  await h.tick();
  h.setHidden(true);
  await h.release();
  assert.equal(h.recoveries.length, 0);
  assert.equal(h.store.get(h.key()).recovery, null);
  h.setHidden(false);
  await h.tick();
  await h.advance(3_000);
  assert.equal(h.recoveries.length, 1);
});

test('Changing galaxy before a late response prevents recovery under the old scope', async t => {
  const h = harness(t);
  h.replace([report()]);
  h.seedSeen();
  h.holdNext();
  await h.tick();
  h.setPathname('/game/galaxy/another-galaxy');
  await h.release();
  assert.equal(h.recoveries.length, 0);
  assert.equal(h.store.get(h.key()).recovery, null);
});

test('A failed durable callback leaves recovery pending through backoff and redelivers the full batch', async t => {
  const h = harness(t);
  const value = report();
  h.replace([value]);
  h.seedSeen();
  h.failCallbacks(1);
  await h.tick();
  assert.equal(h.recoveryAttempts.length, 1);
  assert.equal(h.recoveries.length, 0);
  assert.equal(h.store.get(h.key()).recovery, null);
  assert.equal(h.watcher.isRecovering(), true);
  assert.match(h.watcher.getDiagnostics().status, /no se pudo completar la recuperación/);
  await h.advance(4_999);
  assert.equal(h.recoveryAttempts.length, 1);
  await h.advance(1);
  assert.equal(h.recoveryAttempts.length, 2);
  assert.equal(h.recoveries.length, 1);
  assert.equal(h.recoveries[0].reports[0].item.id, value.item.id);
  assert.equal(h.watcher.isRecovering(), false);
  assert.equal(h.notifications.length, 0);
});

test('Asynchronous recovery callbacks cannot acknowledge or persist a completed marker', async t => {
  const h = harness(t, { asyncRecovery: true });
  h.replace([report()]);
  h.seedSeen();
  await h.tick();
  assert.equal(h.store.get(h.key()).recovery, null);
  assert.equal(h.watcher.isRecovering(), true);
  assert.equal(h.watcher.getDiagnostics().phase, 'error');
  assert.equal(h.notifications.length, 0);
});

test('A recovery marker storage failure preserves redelivery after a successful consumer callback', async t => {
  const h = harness(t);
  h.replace([report()]);
  h.seedSeen();
  h.failMarkerWrites(1);
  await h.tick();
  assert.equal(h.recoveries.length, 1);
  assert.equal(h.store.get(h.key()).recovery, null);
  assert.equal(h.watcher.isRecovering(), true);
  assert.match(h.watcher.getDiagnostics().status, /no se pudo guardar el progreso/);
  await h.advance(5_000);
  assert.equal(h.recoveries.length, 2);
  assert.deepEqual(h.recoveries[0], h.recoveries[1]);
  assert.equal(h.watcher.isRecovering(), false);
  assert.ok(h.store.get(h.key()).recovery);
  assert.equal(h.notifications.length, 0);
});

test('A missing newer combat detail prevents partial recovery and is retried without notification fallbacks', async t => {
  const h = harness(t);
  const older = report({ when: START - 500 });
  const newer = report({ when: START - 100, verdict: 'Victory' });
  h.replace([newer, older]);
  h.seedSeen();
  h.setDetailStatus(newer.item.id, 404);
  await h.tick();
  await h.advance(15_000);
  assert.equal(h.recoveries.length, 0);
  assert.equal(h.store.get(h.key()).recovery, null);
  assert.equal(h.watcher.isRecovering(), true);
  assert.equal(h.watcher.getDiagnostics().counters.fallbacks, 0);
  assert.match(h.watcher.getDiagnostics().status, /HTTP 404/);
  h.setDetailStatus(newer.item.id, 200);
  await h.advance(20_000);
  assert.equal(h.recoveries.length, 1);
  assert.deepEqual(h.recoveries[0].reports.map(value => value.item.id), [newer.item.id, older.item.id]);
  assert.equal(h.notifications.length, 0);
});

test('An unrelated report detail UUID cannot complete the recovery batch', async t => {
  const h = harness(t);
  const value = report();
  h.replace([value]);
  h.seedSeen();
  h.setDetail(value.item.id, report().detail);
  await h.tick();
  assert.equal(h.recoveries.length, 0);
  assert.equal(h.store.get(h.key()).recovery, null);
  assert.equal(h.watcher.isRecovering(), true);
  assert.match(h.watcher.getDiagnostics().status, /formato de respuesta no compatible/);
});

test('Recovery reads no more than the latest 20 combat details', async t => {
  const h = harness(t);
  const values = Array.from({ length: 25 }, (_, index) => report({ when: START - index }));
  h.replace(values);
  h.seedSeen();
  await h.tick();
  assert.equal(h.recoveries[0].reports.length, 20);
  assert.deepEqual(h.recoveries[0].reports.map(value => value.item.id), values.slice(0, 20).map(value => value.item.id));
  assert.equal(h.reads.filter(read => read.phase === 'recovery-detail').length, 20);
  assert.equal(h.reads.filter(read => read.phase === 'recovery-list').length, 1);
  assert.equal(h.notifications.length, 0);
});

test('Recovery scans at most five native pages when non-combat reports fill the list', async t => {
  const h = harness(t);
  const values = Array.from({ length: 120 }, (_, index) => report({ when: START - index,
    verdict: index % 20 === 19 ? 'Defeat' : 'Probed' }));
  h.replace(values);
  h.seedSeen();
  await h.tick();
  assert.equal(h.reads.filter(read => read.phase === 'recovery-list').length, 5);
  assert.equal(h.reads.filter(read => read.phase === 'recovery-detail').length, 5);
  assert.deepEqual(h.recoveries[0].reports.map(value => value.item.id),
    [19, 39, 59, 79, 99].map(index => values[index].item.id));
  assert.ok(!h.recoveries[0].reports.some(value => value.item.id === values[119].item.id));
});

test('A native pagination loop is rejected instead of processing an incomplete recovery batch', async t => {
  const h = harness(t);
  const value = report();
  h.replace([value]);
  h.seedSeen();
  h.overridePages(() => ({ items: [value.item], nextCursor: '20' }));
  await h.tick();
  assert.equal(h.recoveries.length, 0);
  assert.equal(h.reads.filter(read => read.phase === 'recovery-list').length, 2);
  assert.equal(h.store.get(h.key()).recovery, null);
  assert.equal(h.watcher.isRecovering(), true);
});

test('Malformed combat summary timestamps prevent guessing whether a report is after enable', async t => {
  const h = harness(t);
  const value = report();
  h.replace([value]);
  h.seedSeen();
  h.overridePages(({ phase }) => ({ items: [{ ...value.item,
    takenAt: phase === 'recovery-list' ? 'not a date' : value.item.takenAt }], nextCursor: null }));
  await h.tick();
  assert.equal(h.recoveries.length, 0);
  assert.equal(h.store.get(h.key()).recovery, null);
  assert.match(h.watcher.getDiagnostics().status, /formato de respuesta no compatible/);
});

test('Recovery does not skip an invalid UUID row that might contain a newer outcome', async t => {
  const h = harness(t);
  const value = report();
  h.replace([value]);
  h.seedSeen();
  h.overridePages(({ phase }) => ({ items: phase === 'recovery-list'
    ? [{ ...value.item, id: 'invalid', verdict: 'Victory' }, value.item] : [value.item], nextCursor: null }));
  await h.tick();
  assert.equal(h.recoveries.length, 0);
  assert.equal(h.store.get(h.key()).recovery, null);
  assert.equal(h.watcher.isRecovering(), true);
});

test('A 20-combat recovery floor prevents an older pending defeat from starting before its victory', async t => {
  const h = harness(t);
  const recent = Array.from({ length: 20 }, (_, index) => report({ when: START - index }));
  const victory = report({ when: START - 20, verdict: 'Victory' });
  const defeat = report({ when: START - 21, quantity: 8 });
  h.replace([...recent, victory, defeat]);
  h.seedPending([...recent, victory, defeat]);
  await h.tick();
  assert.equal(h.recoveries[0].reports.length, 20);
  assert.equal(h.store.get(h.key()).recovery.floor, START - 19);
  assert.ok(!h.observations.some(value => [defeat.item.id, victory.item.id].includes(value.item.id)),
    'Older outcomes outside the reconstructed window never reach the attack controller');
  assert.equal(h.notifications[0].id, `report:${defeat.item.id}`, 'The old defeat still gets its ordinary notification');
  assert.equal(h.notifications[1].id, `report:${victory.item.id}`);
  assert.equal(h.watcher.getDiagnostics().pending, 2);
  assert.equal(h.watcher.isRecovering(), true, 'Remaining reports keep the batch gate closed between cycles');
  await h.restart();
  assert.equal(h.recoveries.length, 1, 'Floor and recovery marker survive a reload');
  assert.equal(h.store.get(h.key()).recovery.floor, START - 19);
  assert.equal(h.notifications.length, 22);
  assert.equal(new Set(h.notifications.map(value => value.id)).size, 22);
  assert.ok(!h.observations.some(value => [defeat.item.id, victory.item.id].includes(value.item.id)));
  assert.equal(h.store.get(h.key()).seen.length, 22);
  assert.equal(h.watcher.isRecovering(), false);
});

test('A five-page recovery floor suppresses pending outcomes beyond the scanned combat window', async t => {
  const h = harness(t);
  const values = Array.from({ length: 120 }, (_, index) => report({ when: START - index,
    verdict: index % 20 === 19 ? 'Defeat' : 'Probed' }));
  values[105].item.verdict = 'Victory';
  values[110].item.verdict = 'Defeat';
  h.replace(values);
  h.seedPending([values[105], values[110]]);
  await h.tick();
  assert.equal(h.recoveries[0].reports.length, 5);
  assert.equal(h.store.get(h.key()).recovery.floor, START - 99);
  assert.equal(h.observations.length, 0);
  assert.deepEqual(h.notifications.map(value => value.id), [values[110], values[105]]
    .map(value => `report:${value.item.id}`));
  assert.equal(h.watcher.isRecovering(), false);
});

test('A truncated non-combat-only scan uses its newest native timestamp as the recovery floor', async t => {
  const h = harness(t);
  const values = Array.from({ length: 120 }, (_, index) => report({ when: START - index, verdict: 'Probed' }));
  values[105].item.verdict = 'Victory';
  values[110].item.verdict = 'Defeat';
  h.replace(values);
  h.seedPending([values[105], values[110]]);
  await h.tick();
  assert.equal(h.recoveries[0].reports.length, 0);
  assert.equal(h.store.get(h.key()).recovery.floor, START);
  assert.equal(h.observations.length, 0);
  assert.equal(h.notifications.length, 2);
  assert.equal(h.watcher.isRecovering(), false);
});

test('Exactly 20 combats at the end of the native list keep the original enable floor', async t => {
  const h = harness(t);
  const values = Array.from({ length: 20 }, (_, index) => report({ when: START - index }));
  h.replace(values);
  h.seedSeen();
  await h.tick();
  assert.equal(h.store.get(h.key()).recovery.floor, START - 1_000);
});

test('An exhausted fifth page without a cursor does not truncate the enable window', async t => {
  const h = harness(t);
  const values = Array.from({ length: 100 }, (_, index) => report({ when: START - index, verdict: 'Probed' }));
  h.replace(values);
  h.seedSeen();
  await h.tick();
  assert.equal(h.reads.filter(read => read.phase === 'recovery-list').length, 5);
  assert.equal(h.store.get(h.key()).recovery.floor, START - 1_000);
});

test('Live report batches keep actions blocked through every callback, a second cycle, and detail backoff', async t => {
  const h = harness(t);
  await h.tick();
  const defeat = report({ when: START + 1 });
  const middle = Array.from({ length: 20 }, (_, index) => report({ when: START + index + 2, verdict: 'Probed' }));
  const victory = report({ when: START + 30, verdict: 'Victory' });
  h.replace([victory, ...middle, defeat]);
  h.seedPending([victory, ...middle, defeat]);
  h.holdNext('detail', 'detail');
  await h.restart();
  assert.ok(h.held);
  assert.equal(h.recoveries.length, 1, 'A completed recovery does not run again for the live batch');
  assert.equal(h.watcher.isRecovering(), true);
  await h.release();
  assert.equal(h.observations[0].item.id, defeat.item.id);
  assert.equal(h.observations.length, 20);
  assert.equal(h.watcher.getDiagnostics().pending, 2);
  assert.equal(h.watcher.isRecovering(), true);
  h.setDetailStatus(victory.item.id, 500);
  await h.advance(25_000);
  assert.equal(h.observations.length, 21);
  assert.equal(h.watcher.getDiagnostics().pending, 1);
  assert.equal(h.watcher.isRecovering(), true);
  assert.equal(h.watcher.getDiagnostics().phase, 'error');
  h.setDetailStatus(victory.item.id, 200);
  await h.advance(5_000);
  assert.equal(h.observations.length, 22);
  assert.equal(h.observations.at(-1).item.id, victory.item.id);
  assert.ok(h.gates.every(value => value.blocked), 'No operational callback can release an attack before the batch finishes');
  assert.equal(h.watcher.isRecovering(), false);
});

test('A normal list GET keeps the gate closed even before new summaries become pending', async t => {
  const h = harness(t);
  await h.tick();
  h.holdNext('list', 'list');
  await h.advance(25_000);
  assert.ok(h.held);
  assert.equal(h.watcher.isRecovering(), true);
  assert.equal(h.watcher.getDiagnostics().pending, 0);
  await h.release();
  assert.equal(h.watcher.isRecovering(), false);
});

test('A notification-only detail backlog does not block actions when attack retries are off', async t => {
  const h = harness(t, { since: null });
  const value = report();
  h.replace([value]);
  h.seedPending([value]);
  h.holdNext('detail', 'detail');
  await h.tick();
  assert.ok(h.held);
  assert.equal(h.watcher.isRecovering(), false);
  await h.release();
  assert.equal(h.notifications.length, 1);
});

test('A pending summary without a timestamp cannot bypass a protected recovery floor using its detail date', async t => {
  const h = harness(t);
  const recent = Array.from({ length: 20 }, (_, index) => report({ when: START - index }));
  const older = report({ when: START - 200 });
  h.replace([...recent, older]);
  h.seedPending([older]);
  h.store.get(h.key()).pending[0].takenAt = null;
  await h.tick();
  assert.equal(h.store.get(h.key()).recovery.floor, START - 19);
  assert.equal(h.observations.length, 0);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].id, `report:${older.item.id}`);
  assert.equal(h.watcher.isRecovering(), false);
});
