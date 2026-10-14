'use strict';
// Synthetic execution/DOM feedback only. No browser, live game or orders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
function extract(name) {
  const start = source.indexOf('  function ' + name + '('), end = source.indexOf('\n  }\n', start);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end + 5);
}
function marker(name) {
  return source.slice(source.indexOf('// BEGIN ' + name), source.indexOf('// END ' + name));
}
function harness(extras = {}) {
  const context = vm.createContext(extras);
  vm.runInContext(marker('UPGRADE ETA ESTIMATOR') + '\n' + marker('FLEET PRIORITY PLANNER')
    + '\nconst fleetPriority = createFleetPriorityPlanner(createUpgradeEtaEstimator().formatDuration);\n'
    + extract('fleetProductionWaitMessage') + '\nthis.plan = s => fleetPriority.select(s);', context);
  return context;
}
function snapshot() {
  return { active: true, contextReady: true,
    resources: { palladium: { amount: 16300, cap: 131600, rate: 264.6 }, iridium: { amount: 17600, cap: 131600, rate: 235.2 } },
    ships: [{ id: 'vanguard', name: 'Vanguard', deficit: 4, maxBatch: 100000, blocker: 'resources',
      nativeReason: 'Not enough resources', unitCost: { palladium: 50000, iridium: 50000 } }],
    queue: { full: false, paused: false }, cooldownMs: 0 };
}

test('resource reservation explains the exact selected ship and missing known resources', () => {
  const h = harness(), s = snapshot(), p = h.plan(s), before = JSON.stringify(s);
  const message = h.fleetProductionWaitMessage(s, p);
  assert.match(message, /Ahorrando para Vanguard ×1/);
  assert.match(message, /33[.,]?700 P/); assert.match(message, /32[.,]?400 I/);
  assert.ok(message.length < 100, 'The visible resource wait remains one compact line');
  assert.equal(JSON.stringify(s), before);
});

test('native, manual, mission and incomplete data waits do not falsely claim resource savings', () => {
  const h = harness();
  for (const blocker of ['manual', 'mission', 'unknown']) {
    const s = snapshot(); s.ships[0].blocker = blocker;
    const message = h.fleetProductionWaitMessage(s, h.plan(s));
    assert.doesNotMatch(message, /Ahorrando/); assert.match(message, /Vanguard/);
  }
  const s = snapshot(); s.resources.palladium.amount = null;
  assert.doesNotMatch(h.fleetProductionWaitMessage(s, h.plan(s)), /Ahorrando|33[.,]?700/);
});

test('ready forecast after a failed native preparation waits for availability instead of claiming savings', () => {
  const h = harness(), s = snapshot();
  s.resources.palladium.amount = s.resources.iridium.amount = 50000; s.ships[0].blocker = 'ready';
  const message = h.fleetProductionWaitMessage(s, h.plan(s));
  assert.doesNotMatch(message, /Ahorrando/); assert.match(message, /disponibilidad del juego/);
});

test('fleet inline status uses supplied execution text and clears stale messages without empire or stock reads', () => {
  let writes = 0;
  const node = { textContent: '', hidden: true };
  const context = vm.createContext({ ui: { fleetExecutionStatus: node }, setText: (n, value) => {
    if (n.textContent !== value) { n.textContent = value; writes++; }
  } });
  vm.runInContext(extract('syncFleetExecutionStatus'), context);
  for (const message of ['Esperando respuesta: Vanguard…', 'No se pudo preparar el pedido.']) {
    context.syncFleetExecutionStatus(message); assert.equal(node.textContent, message); assert.equal(node.hidden, false);
  }
  const old = writes; context.syncFleetExecutionStatus(node.textContent); assert.equal(writes, old);
  context.syncFleetExecutionStatus(''); assert.equal(node.textContent, ''); assert.equal(node.hidden, true);
  context.ui = null; assert.doesNotThrow(() => context.syncFleetExecutionStatus(''));
});

test('distributed wiring shows explicit fleet states and does not retain them across other execution messages', () => {
  assert.ok(source.includes('data-field="fleet-execution-status" role="status" hidden'));
  assert.ok(source.includes("fleetExecutionStatus: shadow.querySelector('[data-field=\"fleet-execution-status\"]')"));
  assert.match(extract('show'), /syncFleetExecutionStatus\(fleetStatus \? message : ''\)/);
  assert.match(extract('show'), /function show\(message, fleetStatus = false\)/);
  assert.match(extract('step'), /if \(!quantity\) \{[\s\S]*?const waitingSnapshot = readFleetPrioritySnapshot\(shipRows\(\)\);[\s\S]*?fleetProductionWaitMessage\(waitingSnapshot, waitingPlan, fleetPlan.target.id\)/);
});

test('unknown reason, competing queue, changed priority or context cannot be described as saving', () => {
  const h = harness();
  for (const mutate of [s => s.ships[0].nativeReason = '', s => s.queue.full = true,
    s => s.contextReady = false, s => s.docksFull = true, s => s.treasuryBlocked = true, s => s.queue.paused = true]) {
    const s = snapshot(); mutate(s);
    assert.doesNotMatch(h.fleetProductionWaitMessage(s, h.plan(s)), /Ahorrando/);
  }
  const s = snapshot(); assert.doesNotMatch(h.fleetProductionWaitMessage(s, h.plan(s), 'sentinel'), /Ahorrando/);
  const queued = snapshot(); queued.queue.full = true; queued.queue.waitMs = 60000; queued.ships[0].blocker = 'queue';
  queued.ships[0].nativeReason = 'Build queue full';
  assert.match(h.fleetProductionWaitMessage(queued, h.plan(queued)), /esperando hueco en la cola/);
});

test('actual failed-preparation branch rereads current state, handles changed system and sends no orders', () => {
  const step = extract('step'), start = step.indexOf('      if (!quantity) {');
  const end = step.indexOf('      // Changing the native quantity', start);
  assert.ok(start > 0 && end > start);
  const branch = step.slice(start, end);
  for (const change of ['none', 'queue', 'system', 'target', 'unknown', 'read-error', 'account', 'pause', 'empire-permission', 'depot', 'hidden', 'mode', 'native-loading']) {
    const observed = [], fresh = snapshot(); let reads = 0;
    if (change === 'queue') { fresh.queue.full = true; fresh.ships[0].blocker = 'queue'; }
    if (change === 'target') fresh.ships[0].id = 'sentinel';
    if (change === 'unknown') fresh.resources.palladium.amount = null;
    const h = harness({ quantity: 0, activeSystem: 'one', systemId: () => change === 'system' ? 'two' : 'one',
      beforeWaitScope: 'alpha/player-A', beforeWaitImperial: true,
      missionContext: () => ({ scope: change === 'account' ? 'alpha/player-B' : 'alpha/player-A', selectionCount: 1 }),
      settings: { enabled: change !== 'pause' }, PANEL: '#structures', FLEET_PANEL: '#shipyard',
      document: { hidden: change === 'hidden', querySelector: () => change === 'native-loading' ? {} : null }, leader: true, pending: null,
      importingBackup: false, reports: { isRecovering: () => false }, missionAdapter: { isBusy: () => false }, attackRetry: { isBusy: () => false },
      empireController: { isEnabled: () => change !== 'mode', canAct: () => change !== 'empire-permission' },
      empireAdapter: { readActive: () => ({ context: {} }) },
      infrastructurePriority: { select: () => ({ reserve: change === 'depot' }) },
      readUpgradeEtaSnapshot: () => ({}), rows: () => [], depotPrioritySystem: null,
      fleetPlan: { target: { id: 'vanguard' } }, shipRows: () => [],
      readFleetPrioritySnapshot: () => { reads++; if (change === 'read-error') throw Error('Synthetic read failure'); return fresh; }, show: (...args) => observed.push(args),
      prepareShip() { throw Error('The diagnostic must not retry preparation'); },
    });
    vm.runInContext('(() => {\n' + branch + '\n})()', h);
    assert.equal(reads, ['account', 'system', 'pause', 'empire-permission', 'hidden', 'mode', 'native-loading'].includes(change) ? 0 : 1); assert.equal(observed.length, 1); assert.equal(observed[0][1], true);
    if (change === 'none') assert.match(observed[0][0], /Ahorrando/);
    else assert.doesNotMatch(observed[0][0], /Ahorrando/);
    if (change === 'system') assert.match(observed[0][0], /contexto seleccionado ha cambiado/);
    if (change === 'read-error') assert.match(observed[0][0], /Faltan datos actuales/);
    if (change === 'depot') assert.match(observed[0][0], /Depot\/Reactor prioritario/);
    if (change === 'pause') assert.match(observed[0][0], /Automatización pausada/);
  }
});
