'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = process.env.QA_ATTACK_RETRY_SOURCE
  || path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const source = fs.readFileSync(filename, 'utf8');
const begin = source.indexOf('// BEGIN ATTACK RETRY CONTROLLER');
const end = source.indexOf('// END ATTACK RETRY CONTROLLER', begin);
assert.ok(begin >= 0 && end > begin);
const factory = vm.runInNewContext(source.slice(begin, end) + '\ncreateAttackRetryController;',
  { Date, TextEncoder, structuredClone }, { filename: path.basename(filename) });

const SCOPE = 'recovery-qa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORIGIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const copy = value => structuredClone(value);

function harness() {
  let clock = 1000;
  let stored = {};
  let controller;
  const queue = [];
  const events = [];
  const deps = {
    now: () => clock,
    load: () => copy(stored),
    save: value => { stored = copy(value); },
    getContext: () => ({ scope: SCOPE, originId: ORIGIN, originName: 'Technocratic Imperium',
      selectionCount: 1, active: true, canAct: true }),
    verifyOrigin: async () => ({ originId: ORIGIN, name: 'Technocratic Imperium', coordinate: { q: -95, r: 260 } }),
    getJobs: () => copy(queue),
    queueOnce: (spec, options) => {
      const job = { id: options.id, ...copy(spec), status: 'waiting', createdAt: clock, updatedAt: clock,
        claimedAt: null, sentAt: null, message: '', needsReview: false };
      queue.push(job);
      return copy(job);
    },
    send: event => { events.push(copy(event)); },
  };
  controller = factory(deps);
  controller.setConfig({ enabled: true });
  clock = 10_000;
  function report(number, verdict, takenAt) {
    return { item: { id: id(number), takenAt, verdict, title: 'You attacked Mirairot' },
      detail: { id: id(number), createdAt: takenAt,
        route: {
          from: { ownerKind: 'owned', name: 'Technocratic Imperium', q: -95, r: 260 },
          to: { ownerKind: 'human', ownerName: 'Mirairot', name: 'Mirairot Sovereignty 001', q: -93, r: 266 },
        },
        sections: { battle: { attackerShips: [{ type: 'marauder', quantity: 8, kind: 'exact' }],
          attackerLost: [{ type: 'marauder', quantity: verdict === 'Defeat' ? 8 : 0, kind: 'exact' }] } },
      } };
  }
  return {
    queue, events, report,
    get controller() { return controller; },
    get state() { return copy(stored); },
    reload: () => { controller.destroy(); controller = factory(deps); },
    batch: reports => ({ scope: SCOPE, reports }),
  };
}

for (const reverse of [false, true]) {
  test('A newer victory without a route aborts the whole recovery before any mutation, order ' + reverse, async () => {
    const h = harness();
    const defeat = h.report(1, 'Defeat', 2000);
    const victory = h.report(2, 'Victory', 3000);
    delete victory.detail.route.to.q;
    const batch = h.batch(reverse ? [victory, defeat] : [defeat, victory]);
    const before = h.state;

    assert.throws(() => h.controller.recoverReports(batch), /recuper|combate|coordenad|incomplet|ruta/i);
    assert.deepEqual(h.state, before, 'No campaign or history from a partial batch is persisted');
    assert.equal(h.queue.length, 0);
    assert.equal(h.events.length, 0);
    const diagnosis = h.controller.getDiagnostics().lastReportDecision;
    assert.ok(diagnosis?.message, 'The helper explains why recovery could not authorize an attack');
    await h.controller.tick();
    assert.equal(h.queue.length, 0);
  });
}

test('Redelivering a corrected batch records the newer victory and blocks the old defeat', async () => {
  const h = harness();
  const defeat = h.report(3, 'Defeat', 2000);
  const victory = h.report(4, 'Victory', 3000);
  const broken = copy(victory);
  delete broken.detail.route.to.q;
  assert.throws(() => h.controller.recoverReports(h.batch([defeat, broken])));
  const before = h.state;

  h.reload();
  assert.deepEqual(h.state, before);
  assert.throws(() => h.controller.recoverReports(h.batch([defeat, broken])));
  await h.controller.tick();
  assert.equal(h.queue.length, 0, 'A repeated incomplete fetch does not authorize its old defeat');
  assert.deepEqual(h.state.campaigns, []);
  assert.deepEqual(h.state.processed, []);
  assert.deepEqual(h.state.outcomes, []);

  assert.doesNotThrow(() => h.controller.recoverReports(h.batch([defeat, victory])));
  assert.equal(h.state.outcomes.length, 1);
  assert.equal(h.state.outcomes[0].verdict, 'Victory');
  assert.equal(h.state.outcomes[0].takenAt, 3000);
  assert.equal(h.controller.observeReport({ scope: SCOPE, ...defeat }), false);
  await h.controller.tick();
  assert.equal(h.queue.length, 0);
  assert.deepEqual(h.state.campaigns, []);

  h.reload();
  assert.equal(h.controller.observeReport({ scope: SCOPE, ...defeat }), false);
  await h.controller.tick();
  assert.equal(h.queue.length, 0, 'The newer outcome boundary survives a reload');
  assert.equal(h.events.length, 0);
});
