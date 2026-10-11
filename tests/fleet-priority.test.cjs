'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publishedFile = path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const published = fs.readFileSync(publishedFile, 'utf8');
const plannerFile = process.env.QA_FLEET_PRIORITY_SOURCE
  ? path.resolve(process.env.QA_FLEET_PRIORITY_SOURCE) : publishedFile;
const plannerSource = plannerFile === publishedFile ? published : fs.readFileSync(plannerFile, 'utf8');

function extract(source, marker, allowFragment = false) {
  const begin = `// BEGIN ${marker}`;
  const end = `// END ${marker}`;
  const start = source.indexOf(begin);
  const stop = source.indexOf(end, start + begin.length);
  assert.ok(allowFragment || (start >= 0 && stop > start), `Missing ${marker} factory in published userscript`);
  return start >= 0 && stop > start ? source.slice(start + begin.length, stop) : source;
}

const factorySource = extract(published, 'UPGRADE ETA ESTIMATOR') + '\n'
  + extract(plannerSource, 'FLEET PRIORITY PLANNER', Boolean(process.env.QA_FLEET_PRIORITY_SOURCE));
const { select, estimate } = vm.runInNewContext(factorySource
  + '\ncreateFleetPriorityPlanner(createUpgradeEtaEstimator().formatDuration);', {},
{ filename: path.basename(plannerFile) });

const minute = 60_000;
const names = { probe: 'Probe', marauder: 'Marauder', sentinel: 'Sentinel', vanguard: 'Vanguard' };

function ship(id = 'vanguard', extra = {}) {
  return {
    id,
    name: names[id],
    deficit: 1,
    maxBatch: 50_000,
    blocker: 'resources',
    nativeReason: 'Not enough resources',
    unitCost: { palladium: 100, iridium: 100 },
    ...extra,
  };
}

function snapshot(extra = {}) {
  const result = {
    active: true,
    contextReady: true,
    ships: [ship()],
    docksFull: false,
    treasuryBlocked: false,
    cooldownMs: 0,
    ...extra,
  };
  result.resources = Object.fromEntries(['palladium', 'iridium'].map(id => [id, {
    amount: 0,
    cap: 1_000,
    rate: 10,
    ...extra.resources?.[id],
  }]));
  result.queue = { full: false, paused: false, waitMs: null, identity: [], ...extra.queue };
  return result;
}

function expectEta(input, id, ms) {
  const plan = select(input);
  assert.equal(plan.target?.id, id, plan.notice);
  assert.equal(plan.reserve, true, plan.notice);
  const forecast = estimate(input, plan);
  assert.equal(forecast.kind, 'ship');
  assert.equal(forecast.shipId, id, forecast.detail);
  assert.equal(forecast.buildingId, '');
  assert.equal(forecast.targetLevel, null);
  assert.equal(forecast.quantity, plan.target.quantity);
  assert.equal(forecast.state, ms === 0 ? 'ready' : 'waiting', forecast.detail);
  assert.ok(Number.isFinite(forecast.waitMs), forecast.detail);
  assert.ok(Math.abs(forecast.waitMs - ms) < 0.001,
    `Expected ${ms}ms, got ${forecast.waitMs}ms: ${forecast.detail}`);
  return { plan, forecast };
}

function expectNoEta(input, reserve) {
  const plan = select(input);
  if (reserve !== undefined) assert.equal(plan.reserve, reserve, plan.notice);
  const forecast = estimate(input, plan);
  assert.equal(forecast.waitMs, null, forecast.detail);
  assert.notEqual(forecast.state, 'ready', forecast.detail);
  assert.ok(forecast.detail?.trim(), 'A missing ETA must explain its blocker');
  return { plan, forecast };
}

test('the first outstanding ship reserves resources ahead of a cheaper lower priority ship', () => {
  const input = snapshot({ ships: [ship('vanguard'), ship('probe', {
    blocker: 'ready', unitCost: { palladium: 5, iridium: 5 },
  })], resources: { palladium: { amount: 10 }, iridium: { amount: 10 } } });
  expectEta(input, 'vanguard', 9 * minute);
});

test('changing the configured ship order immediately changes the selected priority', () => {
  const vanguard = ship('vanguard');
  const probe = ship('probe', { blocker: 'ready', unitCost: { palladium: 5, iridium: 5 } });
  const input = snapshot({ ships: [vanguard, probe],
    resources: { palladium: { amount: 10 }, iridium: { amount: 10 } } });
  assert.equal(select(input).target.id, 'vanguard');
  input.ships = [probe, vanguard];
  expectEta(input, 'probe', 0);
});

test('covered Probe, queued Marauder, and covered Sentinel leave Vanguard as the target', () => {
  // Deficits are computed by the DOM adapter using parked, away and building
  // counts. This is the screenshot case after those counts are accounted for.
  const input = snapshot({ ships: [ship('probe', { deficit: 0 }), ship('marauder', { deficit: 0 }),
    ship('sentinel', { deficit: 0 }), ship('vanguard', {
      unitCost: { palladium: 25_000, iridium: 25_000 },
    })], resources: { palladium: { amount: 15_000, cap: 30_000, rate: 500 },
    iridium: { amount: 20_000, cap: 30_000, rate: 500 } } });
  const { forecast } = expectEta(input, 'vanguard', 20 * minute);
  assert.equal(forecast.name, 'Vanguard');
  assert.equal(forecast.quantity, 1);
});

test('covered minima release the reservation without depending on stale previous targets', () => {
  const input = snapshot();
  assert.equal(select(input).reserve, true);
  input.ships[0].deficit = 0;
  const plan = select(input);
  assert.equal(plan.target, null);
  assert.equal(plan.reserve, false);
});

test('an affordable part of a deficit can be ordered now instead of saving for the entire minimum', () => {
  const input = snapshot({ ships: [ship('marauder', { deficit: 8 })],
    resources: { palladium: { amount: 250 }, iridium: { amount: 370 } } });
  const { plan } = expectEta(input, 'marauder', 0);
  assert.equal(plan.target.quantity, 2);
  assert.equal(plan.target.cost.palladium, 200);
  assert.equal(plan.target.cost.iridium, 200);
});

test('the smaller resource affordability determines the next batch size', () => {
  const input = snapshot({ ships: [ship('marauder', { deficit: 8,
    unitCost: { palladium: 100, iridium: 50 } })],
  resources: { palladium: { amount: 900 }, iridium: { amount: 170 } } });
  assert.equal(expectEta(input, 'marauder', 0).plan.target.quantity, 3);
});

test('the native maximum batch is respected even when the deficit and funds are larger', () => {
  const input = snapshot({ ships: [ship('marauder', { deficit: 8, maxBatch: 3 })],
    resources: { palladium: { amount: 900 }, iridium: { amount: 900 } } });
  assert.equal(expectEta(input, 'marauder', 0).plan.target.quantity, 3);
});

test('capacity is checked for one ship and does not require storing the whole minimum at once', () => {
  const input = snapshot({ ships: [ship('vanguard', { deficit: 20 })],
    resources: { palladium: { cap: 150 }, iridium: { cap: 150 } } });
  assert.equal(expectEta(input, 'vanguard', 10 * minute).plan.target.quantity, 1);
});

test('a native insufficient batch quote can still build one affordable unit immediately', () => {
  const input = snapshot({ ships: [ship('vanguard', { blocker: 'resources', deficit: 1 })],
    resources: { palladium: { amount: 100 }, iridium: { amount: 100 } } });
  expectEta(input, 'vanguard', 0);
});

test('paired resource waits combine using their maximum', () => {
  const input = snapshot({ ships: [ship('vanguard', { unitCost: { palladium: 200, iridium: 400 } })],
    resources: { palladium: { amount: 100, rate: 50 }, iridium: { amount: 100, rate: 100 } } });
  expectEta(input, 'vanguard', 3 * minute);
});

test('a finite ship queue wait overlaps with production instead of being added to it', () => {
  for (const [queueWait, expected] of [[4 * minute, 10 * minute], [14 * minute, 14 * minute]]) {
    expectEta(snapshot({ ships: [ship('vanguard', { blocker: 'queue' })],
      queue: { full: true, waitMs: queueWait } }), 'vanguard', expected);
  }
});

test('a free ship queue slot does not wait for another ongoing batch to complete', () => {
  expectEta(snapshot({ ships: [ship('vanguard', { blocker: 'ready' })],
    queue: { full: false, waitMs: 20 * minute },
    resources: { palladium: { amount: 100 }, iridium: { amount: 100 } } }), 'vanguard', 0);
});

test('helper cooldown overlaps with production and queue waits', () => {
  expectEta(snapshot({ cooldownMs: 12 * minute }), 'vanguard', 12 * minute);
  expectEta(snapshot({ cooldownMs: 500 }), 'vanguard', 10 * minute);
});

test('an unknown full queue duration preserves priority without inventing a countdown', () => {
  expectNoEta(snapshot({ ships: [ship('vanguard', { blocker: 'queue' })],
    queue: { full: true, waitMs: null } }), true);
});

test('zero remaining queue time waits for the native queue to actually become available', () => {
  expectNoEta(snapshot({ ships: [ship('vanguard', { blocker: 'queue' })],
    queue: { full: true, waitMs: 0 },
    resources: { palladium: { amount: 100 }, iridium: { amount: 100 } } }), true);
});

test('unknown production keeps the priority but has no numerical ETA', () => {
  expectNoEta(snapshot({ resources: { palladium: { rate: null } } }), true);
});

test('unknown production is unnecessary when all resources are already available now', () => {
  expectEta(snapshot({ ships: [ship('vanguard', { blocker: 'ready' })],
    resources: { palladium: { amount: 100, rate: null }, iridium: { amount: 100, rate: null } } }),
  'vanguard', 0);
});

test('unknown unit costs preserve the first priority without interpreting a cheaper ship as next', () => {
  const input = snapshot({ ships: [ship('vanguard', { unitCost: { palladium: null, iridium: 100 } }),
    ship('probe', { blocker: 'ready', unitCost: { palladium: 0, iridium: 0 } })] });
  const { plan } = expectNoEta(input, true);
  assert.equal(plan.target.id, 'vanguard');
});

test('an unrecognized native blocker cannot be announced as ready even with enough resources', () => {
  expectNoEta(snapshot({ ships: [ship('vanguard', { blocker: 'unknown', nativeReason: 'A new game restriction' })],
    resources: { palladium: { amount: 100 }, iridium: { amount: 100 } } }), true);
});

test('manual quantity editing preserves priority while withholding automatic readiness', () => {
  expectNoEta(snapshot({ ships: [ship('vanguard', { blocker: 'manual' })],
    resources: { palladium: { amount: 100 }, iridium: { amount: 100 } } }), true);
});

test('a temporarily blocked mission keeps its reservation until mission actions are available', () => {
  const input = snapshot({ ships: [ship('vanguard', { blocker: 'mission' }),
    ship('probe', { blocker: 'ready', unitCost: { palladium: 0, iridium: 0 } })] });
  assert.equal(expectNoEta(input, true).plan.target.id, 'vanguard');
  input.ships[0].blocker = 'resources';
  expectEta(input, 'vanguard', 10 * minute);
});

test('a one-unit cost above capacity releases the reservation and explains the blocker', () => {
  const { plan, forecast } = expectNoEta(snapshot({ ships: [ship('vanguard', {
    unitCost: { palladium: 1_001, iridium: 100 },
  })] }), false);
  assert.equal(plan.target.id, 'vanguard');
  assert.equal(forecast.name, 'Vanguard');
  assert.ok(plan.notice?.trim());
});

test('a locked higher priority ship does not prevent a possible lower priority ship', () => {
  const input = snapshot({ ships: [ship('vanguard', { blocker: 'locked',
    nativeReason: 'Requires Command Centre lvl 15 and Shipyard lvl 12' }), ship('probe')] });
  expectEta(input, 'probe', 10 * minute);
});

test('capacity impossible higher priority ships do not block a feasible lower priority ship', () => {
  const input = snapshot({ ships: [ship('vanguard', { unitCost: { palladium: 1_001, iridium: 100 } }),
    ship('probe')] });
  expectEta(input, 'probe', 10 * minute);
});

test('known hard native blockers permit building fallback while retaining an explanation', () => {
  for (const blocker of ['locked', 'error', 'unavailable']) {
    const { plan } = expectNoEta(snapshot({ ships: [ship('vanguard', { blocker })] }), false);
    assert.equal(plan.target.id, 'vanguard');
    assert.ok(plan.notice?.trim(), blocker);
  }
});

test('full docks, treasury deficit, and a paused ship queue release resource reservation', () => {
  for (const extra of [{ docksFull: true }, { treasuryBlocked: true },
    { queue: { full: true, paused: true, waitMs: 60_000 } }]) {
    expectNoEta(snapshot(extra), false);
  }
});

test('missing resources with zero or negative production are an explained hard blocker', () => {
  for (const rate of [0, -1]) {
    const { plan } = expectNoEta(snapshot({ resources: { palladium: { rate } } }), false);
    assert.equal(plan.target.id, 'vanguard');
  }
});

test('zero production does not block a ship whose resources are already available', () => {
  expectEta(snapshot({ ships: [ship('vanguard', { blocker: 'ready' })],
    resources: { palladium: { amount: 100, rate: 0 }, iridium: { amount: 100, rate: 0 } } }),
  'vanguard', 0);
});

test('decreasing resources are revalidated at the other resource arrival time', () => {
  expectNoEta(snapshot({ resources: { palladium: { amount: 150, rate: -10 },
    iridium: { amount: 0, rate: 10 } } }));
});

test('decreasing resources are revalidated when the full ship queue becomes available', () => {
  expectNoEta(snapshot({ ships: [ship('vanguard', { blocker: 'queue' })],
    queue: { full: true, waitMs: 2 * minute },
    resources: { palladium: { amount: 110, rate: -10 }, iridium: { amount: 100, rate: 0 } } }));
});

test('unknown current resources cannot produce a numerical ETA or bypass priority', () => {
  expectNoEta(snapshot({ resources: { palladium: { amount: null } } }), true);
});

test('unknown capacity cannot produce a countdown that assumes a ship can fit', () => {
  expectNoEta(snapshot({ resources: { palladium: { cap: null } } }), true);
});

test('planning and forecasting are read-only and can be repeated without changing their snapshot', () => {
  const input = snapshot({ ships: [ship('vanguard'), ship('probe')] });
  const before = JSON.stringify(input);
  function freeze(value) {
    for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
    return Object.freeze(value);
  }
  freeze(input);
  const first = estimate(input, select(input));
  const second = estimate(input, select(input));
  assert.equal(first.shipId, second.shipId);
  assert.equal(first.waitMs, second.waitMs);
  assert.equal(JSON.stringify(input), before);
});
