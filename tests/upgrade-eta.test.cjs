'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = process.env.QA_ETA_SOURCE
  ? path.resolve(process.env.QA_ETA_SOURCE)
  : path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const fullSource = fs.readFileSync(file, 'utf8');
const begin = '// BEGIN UPGRADE ETA ESTIMATOR';
const end = '// END UPGRADE ETA ESTIMATOR';
const start = fullSource.indexOf(begin);
const stop = fullSource.indexOf(end, start + begin.length);
assert.ok(process.env.QA_ETA_SOURCE || (start >= 0 && stop > start),
  'The published userscript must include the upgrade ETA estimator markers');
const source = start >= 0 && stop > start
  ? fullSource.slice(start + begin.length, stop)
  : fullSource;
const { estimate, parseRate, parseDuration, formatDuration } = vm.runInNewContext(
  `${source}\ncreateUpgradeEtaEstimator();`, {}, { filename: path.basename(file) });

const minute = 60_000;
const names = {
  command_center: 'Command Center',
  palladium_extractor: 'Palladium Extractor',
  iridium_extractor: 'Iridium Extractor',
  reactor: 'Reactor',
  warehouse: 'Resource Depot',
  shipyard: 'Shipyard',
};

function building(id, extra = {}) {
  return {
    id,
    name: names[id] || id,
    visible: true,
    targetLevel: 4,
    blocker: 'resources',
    cost: { palladium: 100, iridium: 100 },
    energy: -1,
    ...extra,
  };
}

function snapshot(extra = {}) {
  const buildings = extra.buildings || [building('command_center')];
  const base = {
    buildings,
    order: buildings.map(row => row.id),
    excluded: [],
    energy: 10,
    depotFillPercent: 90,
    cooldownMs: 0,
    fleetPriority: false,
    ...extra,
  };
  base.resources = Object.fromEntries(['palladium', 'iridium'].map(id => [id, {
    amount: 0,
    cap: 1_000,
    rate: 10,
    ...extra.resources?.[id],
  }]));
  base.queue = { full: false, waitMs: null, buildings: {}, ...extra.queue };
  return base;
}

function expectEta(input, id, ms) {
  const result = estimate(input);
  assert.equal(result.buildingId, id, result.detail);
  assert.equal(result.state, ms === 0 ? 'ready' : 'waiting', result.detail);
  assert.ok(Math.abs(result.waitMs - ms) < 0.001,
    `Expected ${ms}ms, got ${result.waitMs}ms: ${result.detail}`);
  return result;
}

test('native production rates use a fixed decimal separator and reject compact or unknown values', () => {
  assert.equal(parseRate('+35.0/min'), 35);
  assert.equal(parseRate('-2.5/min'), -2.5);
  assert.equal(parseRate('−2.5/min'), -2.5);
  assert.equal(parseRate('+0.0/min'), 0);
  assert.equal(parseRate(' +12345.6/min '), 12345.6);
  for (const value of ['—/min', '+35,0/min', '+12K/min', '35/day', '', null]) {
    assert.equal(parseRate(value), null, String(value));
  }
});

test('queue duration parser reads native units and rejects malformed or duplicate units', () => {
  assert.equal(parseDuration('2d 0h 5m 6s'), 173_106_000);
  assert.equal(parseDuration('1h 0m 2s'), 3_602_000);
  assert.equal(parseDuration('59s'), 59_000);
  assert.equal(parseDuration('0s'), 0);
  for (const value of ['Wealth · ongoing', 'Command Center → Lvl 4', '1m 2m', '1.5m', '-2s', '', null]) {
    assert.equal(parseDuration(value), null, String(value));
  }
});

test('duration display rounds upwards instead of announcing readiness early', () => {
  assert.equal(formatDuration(1), '1s');
  assert.equal(formatDuration(59_001), '1m 0s');
  assert.equal(formatDuration(3_601_000), '1h 0m 1s');
  assert.equal(formatDuration(86_461_000), '1d 0h 1m');
});

test('paired resource deficits wait for the slower resource, not the sum', () => {
  expectEta(snapshot({
    buildings: [building('command_center', { cost: { palladium: 200, iridium: 400 } })],
    resources: {
      palladium: { amount: 100, rate: 50 },
      iridium: { amount: 100, rate: 100 },
    },
  }), 'command_center', 3 * minute);
});

test('a cheaper lower priority building is the next automatic order', () => {
  expectEta(snapshot({ buildings: [
    building('command_center', { cost: { palladium: 200, iridium: 200 } }),
    building('shipyard', { cost: { palladium: 100, iridium: 100 } }),
  ] }), 'shipyard', 10 * minute);
});

test('configured priority breaks equal eligibility time ties', () => {
  const input = snapshot({ buildings: [building('command_center'), building('shipyard')],
    order: ['shipyard', 'command_center'] });
  expectEta(input, 'shipyard', 10 * minute);
});

test('a resource threshold crossed before queue opening respects priority at queue opening', () => {
  expectEta(snapshot({
    buildings: [
      building('command_center', { blocker: 'queue', cost: { palladium: 150, iridium: 150 } }),
      building('shipyard', { blocker: 'queue', cost: { palladium: 100, iridium: 100 } }),
    ],
    queue: { full: true, waitMs: 20 * minute },
  }), 'command_center', 20 * minute);
});

test('resource and queue waits run concurrently and combine using max', () => {
  expectEta(snapshot({ buildings: [building('command_center', { blocker: 'queue' })],
    queue: { full: true, waitMs: 4 * minute } }), 'command_center', 10 * minute);
  expectEta(snapshot({ buildings: [building('command_center', { blocker: 'queue' })],
    queue: { full: true, waitMs: 14 * minute } }), 'command_center', 14 * minute);
});

test('a free slot allows immediate enqueuing even with a building already active', () => {
  expectEta(snapshot({
    buildings: [building('command_center', { blocker: 'ready' })],
    resources: { palladium: { amount: 100 }, iridium: { amount: 100 } },
    queue: { full: false, waitMs: 20 * minute, buildings: { command_center: true } },
  }), 'command_center', 0);
});

test('helper cooldown is an earliest order time, not an additional resource delay', () => {
  expectEta(snapshot({ cooldownMs: 12 * minute }), 'command_center', 12 * minute);
  expectEta(snapshot({ cooldownMs: 500 }), 'command_center', 10 * minute);
});

test('reactor waits until another included consuming upgrade becomes affordable', () => {
  const result = expectEta(snapshot({ energy: 0, buildings: [
    building('reactor', { energy: 10, cost: { palladium: 20, iridium: 20 } }),
    building('command_center', { energy: -2, cost: { palladium: 100, iridium: 100 } }),
  ] }), 'reactor', 10 * minute);
  assert.match(result.detail, /Command Center/);
});

test('reactor also waits for its own resources and the queue opening', () => {
  expectEta(snapshot({ energy: 0, buildings: [
    building('reactor', { energy: 10, blocker: 'queue', cost: { palladium: 200, iridium: 200 } }),
    building('command_center', { energy: -2, blocker: 'queue', cost: { palladium: 100, iridium: 100 } }),
  ], queue: { full: true, waitMs: 15 * minute } }), 'reactor', 20 * minute);
});

test('disabled, excluded or impossible consumers cannot justify a reactor upgrade', () => {
  for (const consumer of [
    building('command_center', { blocker: 'locked', visible: false }),
    building('command_center', { blocker: 'maxed', targetLevel: null, visible: false }),
    building('command_center', { cost: { palladium: 1_001, iridium: 100 } }),
  ]) {
    const result = estimate(snapshot({ energy: 0, buildings: [building('reactor', { energy: 10 }), consumer] }));
    assert.notEqual(result.buildingId, 'reactor');
    assert.equal(result.waitMs, null);
  }
  const result = estimate(snapshot({ energy: 0,
    buildings: [building('reactor', { energy: 10 }), building('command_center')],
    excluded: ['command_center'] }));
  assert.equal(result.state, 'idle');
  assert.equal(result.reason, 'demand');
});

test('reactor stays idle without power demand and zero remaining power is sufficient', () => {
  expectEta(snapshot({ energy: 1, buildings: [
    building('reactor', { energy: 10 }), building('command_center', { energy: -1 }),
  ] }), 'command_center', 10 * minute);
  const result = estimate(snapshot({ energy: -5, buildings: [building('reactor', { energy: 10 })] }));
  assert.equal(result.state, 'idle');
  assert.equal(result.reason, 'demand');
});

test('reactor respects configured order against another independently eligible building', () => {
  expectEta(snapshot({ energy: 0, buildings: [
    building('shipyard', { energy: 0 }),
    building('reactor', { energy: 10 }),
    building('command_center', { energy: -1 }),
  ] }), 'shipyard', 10 * minute);
});

test('an existing reactor job prevents a second reactor and does not invent its power gain', () => {
  const result = estimate(snapshot({ energy: 0,
    buildings: [building('reactor', { energy: 999 }), building('command_center', { energy: -20 })],
    queue: { buildings: { reactor: true } },
  }));
  assert.equal(result.state, 'blocked');
  assert.equal(result.reason, 'energy');
  assert.equal(result.waitMs, null);
  assert.match(result.detail, /Reactor en cola/);
});

test('an excluded reactor produces a clear power blocker', () => {
  const result = estimate(snapshot({ energy: 0,
    buildings: [building('reactor', { energy: 10 }), building('command_center')], excluded: ['reactor'] }));
  assert.equal(result.reason, 'energy');
  assert.match(result.detail, /desmarcado/);
});

test('depot waits until either resource reaches the configured fill threshold', () => {
  expectEta(snapshot({
    buildings: [building('warehouse', { energy: 0 })],
    depotFillPercent: 80,
    resources: { palladium: { amount: 700, rate: 50 }, iridium: { amount: 100, rate: 1 } },
  }), 'warehouse', 2 * minute);
});

test('depot waits for both its resource costs and threshold', () => {
  expectEta(snapshot({
    buildings: [building('warehouse', { energy: 0, cost: { palladium: 100, iridium: 400 } })],
    resources: { palladium: { amount: 850, rate: 50 }, iridium: { amount: 100, rate: 100 } },
  }), 'warehouse', 3 * minute);
});

test('depot threshold is rechecked at final eligibility when resources decrease', () => {
  const result = estimate(snapshot({
    buildings: [building('warehouse', { blocker: 'queue', energy: 0 })],
    resources: { palladium: { amount: 950, rate: -100 }, iridium: { amount: 200, rate: 0 } },
    queue: { full: true, waitMs: 2 * minute },
  }));
  assert.equal(result.state, 'blocked');
  assert.equal(result.waitMs, null);
});

test('a future rising resource can restore depot threshold after another resource falls', () => {
  expectEta(snapshot({
    buildings: [building('warehouse', { blocker: 'queue', energy: 0 })],
    resources: { palladium: { amount: 950, rate: -100 }, iridium: { amount: 100, rate: 100 } },
    queue: { full: true, waitMs: 2 * minute },
  }), 'warehouse', 8 * minute);
});

test('a queued depot is not ordered again and its future capacity is not invented', () => {
  const result = estimate(snapshot({
    buildings: [building('warehouse', { energy: 0 })],
    queue: { buildings: { warehouse: true } },
  }));
  assert.equal(result.reason, 'queued');
  assert.equal(result.waitMs, null);
});

test('depot is not a reactor trigger before its own threshold is satisfied', () => {
  expectEta(snapshot({ energy: 0, buildings: [
    building('reactor', { energy: 10, cost: { palladium: 10, iridium: 10 } }),
    building('warehouse', { energy: -1, cost: { palladium: 100, iridium: 100 } }),
  ], resources: { palladium: { amount: 800, rate: 50 }, iridium: { amount: 100, rate: 0 } } }),
  'reactor', 2 * minute);
});

test('costs exceeding capacity cannot produce a finite resource ETA', () => {
  const result = estimate(snapshot({ buildings: [building('command_center', {
    blocker: 'capacity', cost: { palladium: 1_001, iridium: 100 },
  })] }));
  assert.equal(result.reason, 'capacity');
  assert.equal(result.waitMs, null);
});

test('an impossible high priority upgrade does not hide a feasible lower priority one', () => {
  expectEta(snapshot({ buildings: [
    building('command_center', { blocker: 'capacity', cost: { palladium: 1_001, iridium: 100 } }),
    building('shipyard'),
  ] }), 'shipyard', 10 * minute);
});

test('a missing resource with zero production never counts down', () => {
  const result = estimate(snapshot({ resources: { palladium: { rate: 0 } } }));
  assert.equal(result.reason, 'production');
  assert.equal(result.waitMs, null);
});

test('zero production does not block a currently affordable native-ready order', () => {
  expectEta(snapshot({ buildings: [building('command_center', { blocker: 'ready' })],
    resources: { palladium: { amount: 100, rate: 0 }, iridium: { amount: 100, rate: 0 } } }),
  'command_center', 0);
});

test('decreasing resources can make an initially affordable upgrade impossible by queue opening', () => {
  const result = estimate(snapshot({ buildings: [building('command_center', { blocker: 'queue' })],
    resources: { palladium: { amount: 150, rate: -100 }, iridium: { amount: 100, rate: 0 } },
    queue: { full: true, waitMs: minute },
  }));
  assert.equal(result.reason, 'production');
  assert.equal(result.waitMs, null);
});

test('negative production permits a future order when sufficient funds will remain', () => {
  expectEta(snapshot({ buildings: [building('command_center', { blocker: 'queue' })],
    resources: { palladium: { amount: 250, rate: -100 }, iridium: { amount: 100, rate: 0 } },
    queue: { full: true, waitMs: minute },
  }), 'command_center', minute);
});

test('missing resource amounts or capacity cannot produce a made-up ETA', () => {
  for (const resources of [
    { palladium: { amount: null } },
    { iridium: { cap: null } },
    { palladium: { cap: 0 } },
  ]) {
    const result = estimate(snapshot({ resources }));
    assert.equal(result.reason, 'data');
    assert.equal(result.waitMs, null);
  }
});

test('unknown future production blocks a forecast but not a verified ready order', () => {
  const result = estimate(snapshot({ resources: { iridium: { rate: null } } }));
  assert.equal(result.reason, 'rate');
  assert.equal(result.waitMs, null);
  expectEta(snapshot({ buildings: [building('command_center', { blocker: 'ready' })],
    resources: { palladium: { amount: 100, rate: null }, iridium: { amount: 100, rate: null } } }),
  'command_center', 0);
});

test('unknown exact cost or power cannot be treated as zero', () => {
  for (const row of [
    building('command_center', { cost: { palladium: null, iridium: 100 } }),
    building('command_center', { energy: null }),
  ]) {
    const result = estimate(snapshot({ buildings: [row] }));
    assert.equal(result.reason, 'data');
    assert.equal(result.waitMs, null);
  }
});

test('hidden or locked rows cannot use stale cost text left in the native DOM', () => {
  for (const stale of [
    building('command_center', { visible: false, cost: { palladium: 0, iridium: 0 } }),
    building('command_center', { blocker: 'locked', cost: { palladium: 0, iridium: 0 } }),
    building('command_center', { blocker: 'maxed', targetLevel: null, cost: { palladium: 0, iridium: 0 } }),
    building('command_center', { blocker: 'error', cost: { palladium: 0, iridium: 0 } }),
    building('command_center', { blocker: 'tutorial', cost: { palladium: 0, iridium: 0 } }),
  ]) {
    expectEta(snapshot({ buildings: [stale, building('shipyard')] }), 'shipyard', 10 * minute);
  }
});

test('all unavailable native rows produce blockers, not a countdown', () => {
  for (const blocker of ['locked', 'maxed', 'error', 'tutorial']) {
    const result = estimate(snapshot({ buildings: [building('command_center', {
      visible: false, blocker, targetLevel: null, nativeReason: 'Requires Shipyard lvl 6',
    })] }));
    assert.equal(result.state, 'blocked');
    assert.equal(result.waitMs, null);
  }
});

test('a full queue with no known completion time never guesses from a future build duration', () => {
  const result = estimate(snapshot({ buildings: [building('command_center', { blocker: 'queue', durationMs: minute })],
    queue: { full: true, waitMs: null } }));
  assert.equal(result.reason, 'queue');
  assert.equal(result.waitMs, null);
});

test('a full queue whose countdown reached zero waits for native confirmation', () => {
  const result = estimate(snapshot({ buildings: [building('command_center', { blocker: 'queue' })],
    queue: { full: true, waitMs: 0 } }));
  assert.equal(result.reason, 'refresh');
  assert.equal(result.waitMs, null);
});

test('native resource blocking with apparently enough displayed funds is not immediately declared ready', () => {
  const result = estimate(snapshot({
    resources: { palladium: { amount: 100 }, iridium: { amount: 100 } },
  }));
  assert.equal(result.state, 'blocked');
  assert.equal(result.reason, 'refresh');
  assert.equal(result.waitMs, null);
});

test('excluded buildings are omitted and fleet priority is disclosed without mutating the forecast inputs', () => {
  const input = snapshot({ buildings: [building('command_center'), building('shipyard')],
    excluded: ['command_center'], fleetPriority: true });
  const before = JSON.stringify(input);
  const result = expectEta(input, 'shipyard', 10 * minute);
  assert.match(result.detail, /naves tiene prioridad/);
  assert.equal(JSON.stringify(input), before);
});

test('no enabled buildings has no synthetic next upgrade', () => {
  const result = estimate(snapshot({ excluded: ['command_center'] }));
  assert.equal(result.state, 'idle');
  assert.equal(result.waitMs, null);
  assert.equal(result.buildingId, '');
});
