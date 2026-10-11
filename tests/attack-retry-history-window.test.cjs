'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = process.env.QA_ATTACK_RETRY_SOURCE
  || path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const source = fs.readFileSync(filename, 'utf8');
function factory(startMarker, endMarker, name) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(source.slice(start, end) + '\n' + name + ';',
    { Date, TextEncoder, structuredClone, URLSearchParams, AbortController },
    { filename: path.basename(filename) });
}
const createController = factory('// BEGIN ATTACK RETRY CONTROLLER', '// END ATTACK RETRY CONTROLLER', 'createAttackRetryController');
const createWatcher = factory('// BEGIN REPORTS', '// END REPORTS', 'createReportsWatcher');
const START = Date.parse('2026-10-11T17:12:00.000Z');
const GALAXY = 'history-window-qa';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORIGIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = GALAXY + '/' + ACCOUNT;
const RUNTIME_KEY = 'old-light-reports:runtime:v1:' + GALAXY + ':' + ACCOUNT;
const id = value => '00000000-0000-4000-8000-' + String(value).padStart(12, '0');
const copy = value => structuredClone(value);

function report(number, verdict, targetQ) {
  const takenAt = START - 1000 - number * 100;
  return { item: { id: id(number), takenAt: new Date(takenAt).toISOString(), verdict, title: 'You attacked a star' },
    detail: { id: id(number), createdAt: new Date(takenAt).toISOString(),
      route: {
        from: { q: -95, r: 260, name: 'Technocratic Imperium', ownerKind: 'owned' },
        to: { q: targetQ, r: 266, name: targetQ === -93 ? 'Mirairot Sovereignty 001' : 'Other system',
          ownerKind: 'human', ownerName: 'Mirairot' },
      },
      sections: { battle: {
        attackerShips: [{ type: 'marauder', kind: 'exact', quantity: 8 }],
        attackerLost: [{ type: 'marauder', kind: 'exact', quantity: verdict === 'Defeat' ? 8 : 0 }],
      } },
    } };
}

function harness(t) {
  let clock = START - 60_000;
  let controllerStore = {};
  let timerId = 0;
  let controller;
  let watcher;
  let held = null;
  let holdVictory = true;
  let recoverySnapshot = null;
  const store = new Map();
  const timers = new Map();
  const queue = [];
  const observations = [];
  const notifications = [];
  const recoveryBatches = [];
  const controllerEvents = [];
  const schedulerErrors = [];
  const rows = Array.from({ length: 20 }, (_, index) => report(index + 1, 'Victory', 100 + index));
  const victory = report(21, 'Victory', -93);
  const defeat = report(22, 'Defeat', -93);
  rows.push(victory, defeat);
  const runScheduler = async () => {
    if (watcher && !watcher.isRecovering()) await controller.tick();
  };
  const schedule = () => queueMicrotask(() => { runScheduler().catch(error => schedulerErrors.push(error.message)); });
  const controllerDeps = {
    now: () => clock,
    load: () => copy(controllerStore),
    save: value => { controllerStore = copy(value); },
    getContext: () => ({ scope: SCOPE, originId: ORIGIN, originName: 'Technocratic Imperium', selectionCount: 1,
      active: Boolean(watcher && !watcher.isRecovering()), canAct: Boolean(watcher && !watcher.isRecovering()) }),
    verifyOrigin: async () => ({ originId: ORIGIN, name: 'Technocratic Imperium', coordinate: { q: -95, r: 260 } }),
    getJobs: () => copy(queue),
    queueOnce: (spec, options) => {
      const job = { id: options.id, ...copy(spec), status: 'waiting', createdAt: clock, updatedAt: clock,
        claimedAt: null, sentAt: null, message: '', needsReview: false };
      queue.push(job);
      return copy(job);
    },
    pauseJob: jobId => { const job = queue.find(value => value.id === jobId); if (job) job.status = 'paused'; },
    cancelJob: jobId => { const index = queue.findIndex(value => value.id === jobId); if (index >= 0) queue.splice(index, 1); },
    send: value => controllerEvents.push(copy(value)),
    onSettingsChange: schedule,
  };
  function makeWatcher() {
    return createWatcher({
      now: () => clock,
      setTimeout: (fn, delay) => { const timer = ++timerId; timers.set(timer, { fn, due: clock + delay }); return timer; },
      clearTimeout: timer => timers.delete(timer),
      gmGetValue: (key, fallback) => store.has(key) ? copy(store.get(key)) : fallback,
      gmSetValue: (key, value) => {
        store.set(key, copy(value));
        if (!recoverySnapshot && key === RUNTIME_KEY && value.recovery && value.pending.length === rows.length) {
          recoverySnapshot = copy(value);
        }
      },
      getPathname: () => '/game/galaxy/' + GALAXY,
      getAccount: () => ACCOUNT,
      getHidden: () => false,
      getBaselineSince: () => controller.isEnabled() ? controller.getEnabledAt() : null,
      fetch: async (url, init) => {
        const endpoint = new URL(url);
        assert.equal(endpoint.origin, 'https://api.oldlight.io');
        assert.equal(init.method, 'GET');
        assert.equal(init.body, undefined);
        let value;
        if (endpoint.pathname.endsWith('/reports')) {
          const offset = Number(endpoint.searchParams.get('before') || 0);
          const limit = Number(endpoint.searchParams.get('limit'));
          assert.equal(limit, 20);
          value = { items: rows.slice(offset, offset + limit).map(row => copy(row.item)),
            nextCursor: offset + limit < rows.length ? String(offset + limit) : null };
        } else {
          const row = rows.find(row => endpoint.pathname.endsWith('/' + row.item.id));
          assert.ok(row, 'Every detail GET belongs to an isolated fixture report');
          value = copy(row.detail);
          if (holdVictory && row.item.id === victory.item.id && watcher.getDiagnostics().phase === 'detail') {
            holdVictory = false;
            await new Promise(resolve => { held = resolve; });
          }
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => copy(value) };
      },
      onRecoverReports: value => {
        recoveryBatches.push(copy(value));
        return controller.recoverReports(value);
      },
      onReport: value => {
        observations.push(copy(value));
        controller.observeReport(value);
        schedule();
      },
      send: value => { notifications.push(copy(value)); },
    });
  }
  controller = createController(controllerDeps);
  controller.setConfig({ enabled: true });
  clock = START;
  watcher = makeWatcher();
  store.set(RUNTIME_KEY, { version: 1, initialized: true, suspended: false,
    watermark: START - 60_000, seen: [], pending: [], scan: null });
  async function settle() { for (let pass = 0; pass < 10; pass++) await new Promise(resolve => setImmediate(resolve)); }
  async function advance(milliseconds) {
    const target = clock + milliseconds;
    let steps = 0;
    while (true) {
      await settle();
      const next = [...timers].filter(([, value]) => value.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      assert.ok(++steps < 200, 'The watcher does not spin timers');
      clock = Math.max(clock, next[1].due);
      timers.delete(next[0]);
      next[1].fn();
    }
    clock = target;
    await settle();
  }
  t.after(() => { watcher.destroy(); controller.destroy(); held?.(); });
  return {
    queue, observations, notifications, recoveryBatches, controllerEvents, schedulerErrors, defeat, victory, settle, advance,
    get controller() { return controller; },
    get watcher() { return watcher; },
    get held() { return Boolean(held); },
    get recoverySnapshot() { return recoverySnapshot && copy(recoverySnapshot); },
    async start() { watcher.tick({ active: true, enabled: true, unread: rows.length }); await settle(); },
    async release() { const resolve = held; held = null; resolve?.(); await settle(); },
    async reloadAtRecoveryCheckpoint() {
      assert.ok(recoverySnapshot, 'A completed recovery marker and its ordinary backlog were persisted together');
      watcher.destroy(); controller.destroy();
      store.set(RUNTIME_KEY, copy(recoverySnapshot));
      controller = createController(controllerDeps);
      watcher = makeWatcher();
      await this.start();
    },
  };
}

test('An older defeat outside the recovery window cannot create an attack while its newer victory GET is pending', async t => {
  const h = harness(t);
  await h.start();
  assert.equal(h.recoveryBatches.length, 1);
  assert.equal(h.recoveryBatches[0].reports.length, 20);
  assert.equal(h.held, true, 'The normal notification stream is waiting for the older route victory');
  assert.equal(h.watcher.isRecovering(), true, 'Ordinary backlog reading retains the action guard');
  assert.equal(h.observations.some(value => value.item.id === h.defeat.item.id), false);
  assert.equal(h.queue.length, 0);
  assert.equal(h.controller.exportConfig().campaigns.length, 0);
  assert.equal(h.controllerEvents.length, 0);

  await h.release();
  await h.advance(25_000);
  assert.equal(h.queue.length, 0);
  assert.equal(h.controller.exportConfig().campaigns.length, 0);
  for (const entry of [h.defeat, h.victory]) {
    assert.equal(h.notifications.filter(value => value.id === 'report:' + entry.item.id).length, 1,
      'Excluding old operational callbacks preserves each ordinary game report notification');
  }
  assert.deepEqual(h.schedulerErrors, []);
});

test('The persisted recovery window also excludes older pending attacks after a reload', async t => {
  const h = harness(t);
  await h.start();
  await h.release();
  await h.advance(25_000);
  const recovered = h.recoveryBatches.length;
  const before = h.observations.length;
  await h.reloadAtRecoveryCheckpoint();
  await h.advance(25_000);
  assert.equal(h.recoveryBatches.length, recovered, 'The durable marker avoids repeating recovery');
  assert.equal(h.observations.slice(before).some(value => value.item.id === h.defeat.item.id), false);
  assert.equal(h.queue.length, 0);
  assert.equal(h.controller.exportConfig().campaigns.length, 0);
  assert.equal(h.controllerEvents.length, 0);
  assert.deepEqual(h.schedulerErrors, []);
});
