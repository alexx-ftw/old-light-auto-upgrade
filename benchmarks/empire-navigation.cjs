'use strict';
// Focused companion to empire-runtime.cjs. Unlike the legacy benchmark, this
// installs the actual userscript navigation planner and supplies its native DTO
// facts. Run: node benchmarks/empire-navigation.cjs [repository]
// Optional stress scale: BENCH_SIZES=2,10,50,200 node benchmarks/empire-navigation.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const os = require('node:os');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const core = require(path.join(REPO, 'docs/empire-core.js'));
const adapterModule = require(path.join(REPO, 'docs/empire-adapter.js'));
const runtimeModule = require(path.join(REPO, 'docs/empire-runtime.js'));
const source = fs.readFileSync(path.join(REPO, 'old-light-auto-upgrade.user.js'), 'utf8');
const MARKERS = ['UPGRADE ETA ESTIMATOR', 'FLEET PRIORITY PLANNER', 'INFRASTRUCTURE PRIORITY PLANNER', 'EMPIRE NAVIGATION PLANNER'];
function extract(marker) {
  const start = source.indexOf('// BEGIN ' + marker), end = source.indexOf('// END ' + marker, start);
  assert.ok(start >= 0 && end > start, 'Missing actual userscript factory: ' + marker);
  return source.slice(start, end);
}
const factorySource = MARKERS.map(extract).join('\n');
const factories = vm.runInNewContext(factorySource + '\n({ createUpgradeEtaEstimator, createFleetPriorityPlanner, createInfrastructurePriorityPlanner, createEmpireNavigationPlanner })');
const TIME = 1000000, SHIPS = core.DEFAULT_SHIPS;
const BUILDINGS = ['command_center', 'reactor', 'palladium_extractor', 'iridium_extractor', 'warehouse', 'shipyard', 'trade_hub'];
const uuid = i => '00000000-0000-4000-8000-' + i.toString(16).padStart(12, '0');
const P = uuid(999999), SCOPE = 'alpha/' + P;
const iso = n => new Date(n).toISOString();
const counts = n => Object.fromEntries(SHIPS.map(id => [id, n]));
const copy = x => JSON.parse(JSON.stringify(x));
const digest = x => crypto.createHash('sha256').update(x).digest('hex');
const policy = { order: BUILDINGS, excluded: [], shipOrder: [...SHIPS], missionSystemIds: [], depotFillPercent: 90, retainedDepotId: '' };

function fixture(n, workload) {
  assert.ok(Number.isSafeInteger(n) && n >= 2 && n <= 1000);
  assert.ok(['buildings', 'fleet'].includes(workload));
  const expectedEligible = [], expectedIdle = [], caseCounts = {};
  const systems = Array.from({ length: n }, (_, i) => {
    const variant = i % 4;
    const name = variant === 0 ? 'ready' : variant === 1 ? 'resource-wait' : variant === 2 ? 'queue-wait' : 'urgent-depot-reactor';
    caseCounts[name] = (caseCounts[name] || 0) + 1;
    (variant === 0 || variant === 3 ? expectedEligible : expectedIdle).push(uuid(i + 1));
    const stock = variant === 1 ? 10 : variant === 3 ? 9500 : 5000;
    const buildingQueue = variant === 2
      ? [{ id: uuid(20000 + i), type: 'command_center', targetLevel: 11, completesAt: iso(TIME + 120000) }] : [];
    const shipQueue = variant === 2 && workload === 'fleet'
      ? [{ id: uuid(30000 + i), type: 'probe', kind: 'recruit', quantityRemaining: 5,
        nextCompletesAt: iso(TIME + 60000), heldReason: null }] : [];
    return {
      id: uuid(i + 1), playerId: P, q: i, r: 0, name: 'Synthetic ' + workload + ' ' + name + ' ' + i,
      buildings: BUILDINGS.map(type => ({ type, level: 10, unlockRequirement: { met: true },
        nextUpgrade: type === 'warehouse' && variant !== 3 ? null
          : { paCost: 1000, irCost: 1000, energyDelta: type === 'reactor' ? 50 : type === 'warehouse' ? -3 : -1 } })),
      fleet: SHIPS.map(type => ({ type, quantity: 10 })),
      economy: { resources: { palladium: stock, iridium: stock, settledAt: iso(TIME) },
        paCap: 10000, irCap: 10000, paRatePerMin: 60, irRatePerMin: 60,
        energyCap: 30, energyUsed: variant === 3 ? 28 : 10, queueSlots: 1, queue: buildingQueue },
      shipyard: { queueSlots: 1, queue: shipQueue,
        types: SHIPS.map((type, j) => ({ type, unlocked: true, stats: { paCost: 200 + j * 100, irCost: 100 + j * 50 } })) },
    };
  });
  const transits = Array.from({ length: n * 4 }, (_, i) => ({ id: uuid(10000 + i),
    fromQ: i % n, fromR: 0, toQ: n + 100 + i, toR: 9, ships: [{ type: 'probe', quantity: 5 }],
    phase: 'outbound', recalledAt: null, arrivesAt: iso(TIME + 60000) }));
  const world = { version: 1, galaxy: 'alpha', selfId: P, scope: SCOPE, generation: 1, epoch: 1, revision: 0,
    observedAt: TIME, connected: true, complete: true, systems, transits,
    transitShips: { ...counts(0), probe: transits.length * 5 }, credits: { inDeficit: false } };
  const context = { scope: SCOPE, systemId: systems[0].id, selectionCount: 1, settled: true, owned: true };
  // Exact synthetic native HUD for the always-ready first system.
  const hud = { scope: SCOPE, systemId: systems[0].id,
    resources: { palladium: { amount: 5000, cap: 10000, rate: 60 }, iridium: { amount: 5000, cap: 10000, rate: 60 } },
    fleet: Object.fromEntries(SHIPS.map(type => [type, { parked: 10, away: type === 'probe' ? 20 : 0, building: 0 }])),
    queue: { buildings: 0, ships: 0 }, energy: 20 };
  const config = core.normalizeConfig({ enabled: true, fleetTargets: counts(workload === 'fleet' ? n * 100 : 0),
    systems: Object.fromEntries(systems.map(system => [system.id, { enabled: true, role: 'balanced' }])) });
  return { world, context, hud, config, expectedEligible, expectedIdle, caseCounts };
}

function createPlanner(evidence) {
  const structures = new WeakSet();
  function instrument(api, label, methods) {
    if (!evidence) return api;
    return { ...api, ...Object.fromEntries(methods.map(method => [method, (...args) => {
      const key = label + '.' + method;
      if (label === 'infrastructurePriority' && !structures.has(args[0])) {
        structures.add(args[0]); evidence.structureEvaluations++;
      }
      evidence.calls[key] = (evidence.calls[key] || 0) + 1;
      const result = api[method](...args);
      const forecast = result.forecast || (method === 'estimate' ? result : null);
      if (forecast) {
        const outcome = key + ':' + forecast.state + ':' + (forecast.reason || 'known');
        evidence.forecasts[outcome] = (evidence.forecasts[outcome] || 0) + 1;
        if (forecast.reason === 'data') evidence.dataFallbacks++;
      }
      return result;
    }])) };
  }
  const upgradeEta = instrument(factories.createUpgradeEtaEstimator(), 'upgradeEta', ['estimate']);
  const fleetPriority = instrument(factories.createFleetPriorityPlanner(upgradeEta.formatDuration), 'fleetPriority', ['select', 'estimate']);
  const infrastructurePriority = instrument(factories.createInfrastructurePriorityPlanner(upgradeEta), 'infrastructurePriority', ['select']);
  const planner = factories.createEmpireNavigationPlanner({ infrastructurePriority, fleetPriority, upgradeEta });
  return input => {
    const result = planner({ ...input, policy });
    if (evidence) {
      evidence.navigationCalls++;
      if (!result) evidence.nullResults++;
      evidence.last = result ? copy(result) : null;
    }
    return result;
  };
}

function harness(n, { workload = 'buildings', installed = false, evidence = null, bridgeClone = true } = {}) {
  const f = fixture(n, workload), stats = { worldReads: 0, planCalls: 0, navigationCalls: 0 };
  let config = f.config;
  const document = { hidden: false, activeElement: null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const adapter = adapterModule.create({ getWorld() { stats.worldReads++; return bridgeClone ? copy(f.world) : f.world; },
    getContext: () => f.context, getHudSnapshot: () => f.hud, document, canNavigate: () => true, now: () => TIME });
  const coreWrapped = { ...core, plan(...args) { stats.planCalls++; return core.plan(...args); } };
  const options = { core: coreWrapped, adapter, read: () => copy(config), write: (_, value) => { config = value; }, now: () => TIME };
  if (installed) {
    const planner = createPlanner(evidence);
    options.planNavigation = input => { stats.navigationCalls++; return planner(input); };
  }
  const runtime = runtimeModule.create(options), update = () => runtime.update({ scope: SCOPE });
  assert.equal(update().ready, true, 'full native fixture must initialize the real runtime');
  assert.equal(runtime.canAct(f.context), true, 'full native fixture must pass the unchanged action boundary');
  function reset() { stats.worldReads = stats.planCalls = stats.navigationCalls = 0; }
  reset();
  return { f, stats, adapter, runtime, update, reset,
    cycle() { update(); update(); return runtime.canAct(adapter.readActive()?.context); },
    advanceRevision() { f.world.revision++; },
  };
}

function assertCoverage(n, workload) {
  const evidence = { navigationCalls: 0, nullResults: 0, dataFallbacks: 0, structureEvaluations: 0, calls: {}, forecasts: {}, last: null };
  const h = harness(n, { workload, installed: true, evidence });
  assert.ok(evidence.navigationCalls > 0, 'runtime must call the installed userscript planner');
  assert.equal(evidence.nullResults, 0, 'an unknown top-level forecast cannot masquerade as filter coverage');
  assert.equal(evidence.dataFallbacks, 0, 'missing native costs/energy cannot masquerade as real work');
  assert.deepEqual(evidence.last.eligibleSystemIds, h.f.expectedEligible, 'known ready systems remain eligible');
  assert.deepEqual(evidence.last.idleSystemIds, h.f.expectedIdle, 'known waiting systems must be filtered out');
  // Every row must have reached the real infrastructure selector. An early
  // unknown-data return cannot satisfy this, even if its eligible ID looks right.
  assert.equal(evidence.structureEvaluations, n * evidence.navigationCalls);
  assert.ok(Object.keys(evidence.forecasts).some(key => key.includes(':ready:')));
  assert.ok(Object.keys(evidence.forecasts).some(key => key.includes(':waiting:')));
  assert.ok((evidence.calls[workload === 'fleet' ? 'fleetPriority.estimate' : 'upgradeEta.estimate'] || 0) >= n / 2);
  const { last, ...summary } = evidence;
  return { ...summary, eligibleCount: last.eligibleSystemIds.length, idleCount: last.idleSystemIds.length,
    cases: h.f.caseCounts, actionBoundaryPassed: true };
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], minMs: sorted[0], maxMs: sorted.at(-1) };
}
function measurePair(baseline, installed, iterations) {
  for (let i = 0; i < 15; i++) { baseline(); installed(); }
  const times = [[], []], fns = [baseline, installed];
  // Alternate order to reduce consistent thermal/GC/order bias. This is still
  // process-local microbenchmark data, not a statistical browser performance claim.
  for (let round = 0; round < 5; round++) for (const index of round % 2 ? [1, 0] : [0, 1]) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fns[index]();
    times[index].push((performance.now() - start) / iterations);
  }
  const before = summarize(times[0]), after = summarize(times[1]);
  return { baseline: before, installed: after, deltaMedianMs: after.medianMs - before.medianMs,
    ratio: after.medianMs / before.medianMs, iterationsPerSample: iterations, samples: 5 };
}
function profile(h, cycles, revisions = false) {
  h.reset();
  const start = performance.now();
  for (let i = 0; i < cycles; i++) { if (revisions) h.advanceRevision(); assert.equal(h.cycle(), true); }
  return { elapsedMs: performance.now() - start, ...copy(h.stats), cycles };
}
function run() {
  const sizes = (process.env.BENCH_SIZES || '2,10,50').split(',').map(Number);
  const result = {
    generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0]?.model || 'unknown', repository: REPO,
    sourceHashes: Object.fromEntries(['docs/empire-core.js', 'docs/empire-adapter.js', 'docs/empire-runtime.js']
      .map(file => [file, digest(fs.readFileSync(path.join(REPO, file)))])
      .concat([['extractedPlannerFactories', digest(factorySource)]])),
    method: 'Same real adapter/core/runtime and full native-shaped DTO in both modes; baseline omits planNavigation, installed uses all four actual userscript factories. Four external probe transits per system, bridge JSON copying and exact synthetic active HUD. Fixed clock and ready active system deliberately keep this a synchronous hot-path comparison.',
    limits: [
      'Synthetic Node timings, not real Brave/Violentmonkey/Drive measurements. No network, DOM rendering, real native event capture, browser navigation, order dispatch or storage I/O.',
      'Ordinary cases use a maxed Depot so retained-Depot fallback does not hide the building/fleet path. Queue-wait cases block both production alternatives. No missions/retries, manual interaction, malformed data, or asynchronous navigation-preflight timing.',
      'Common-step slice is two runtime updates, one adapter active read and one canAct check, not the entire Helper step. Counters wrap the real core plan and installed navigation callback in both timing modes.',
      'Cold module/factory loading is excluded. Alternating five batches after fifteen warmups reports median/min/max, without a statistical significance claim. Fixed-clock revision churn changes census identity without simulating resource accrual.',
    ], rows: [],
  };
  for (const n of sizes) for (const workload of ['buildings', 'fleet']) {
    const coverage = assertCoverage(n, workload);
    const baseline = harness(n, { workload }), installed = harness(n, { workload, installed: true });
    const iterations = n <= 10 ? 40 : n <= 50 ? 12 : 3;
    const row = { systems: n, transits: n * 4, workload, coverage,
      update: measurePair(baseline.update, installed.update, iterations),
      canAct: measurePair(() => baseline.runtime.canAct(baseline.f.context), () => installed.runtime.canAct(installed.f.context), iterations),
      commonStepEmpireSlice: measurePair(baseline.cycle, installed.cycle, iterations),
      changedRevisionCycle: measurePair(() => { baseline.advanceRevision(); assert.equal(baseline.cycle(), true); },
        () => { installed.advanceRevision(); assert.equal(installed.cycle(), true); }, iterations),
      profile50UnchangedCycles: { baseline: profile(baseline, 50), installed: profile(installed, 50) },
      profile20DistinctRevisions: { baseline: profile(baseline, 20, true), installed: profile(installed, 20, true) },
    };
    result.rows.push(row);
  }
  const finalSource = fs.readFileSync(path.join(REPO, 'old-light-auto-upgrade.user.js'), 'utf8');
  const finalFactories = MARKERS.map(marker => {
    const start = finalSource.indexOf('// BEGIN ' + marker), end = finalSource.indexOf('// END ' + marker, start);
    return finalSource.slice(start, end);
  }).join('\n');
  result.sourceChangedDuringRun = Object.entries(result.sourceHashes).filter(([file, initial]) =>
    initial !== digest(file === 'extractedPlannerFactories' ? finalFactories : fs.readFileSync(path.join(REPO, file))))
    .map(([file]) => file);
  return result;
}
module.exports = { fixture, createPlanner, harness, assertCoverage, measurePair, run };
if (require.main === module) console.log(JSON.stringify(run(), null, 2));
