'use strict';
// Run actual extracted priority/permission functions in a synthetic HUD fixture.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { createRequire } = require('node:module');
const REPO = process.argv[2] || path.resolve(__dirname, '..');
const testPath = path.resolve(__dirname, '../tests/empire-scheduler-performance.test.cjs');
const normalRequire = createRequire(testPath);
let body = fs.readFileSync(testPath, 'utf8');
body = body.replace("const source = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');", `const source = fs.readFileSync(${JSON.stringify(REPO + '/old-light-auto-upgrade.user.js')}, 'utf8');`);
const ctx = { __dirname: path.dirname(testPath), require: id => id === 'node:test' ? { test() {} } : normalRequire(id) };
vm.createContext(ctx); vm.runInContext(body + '\nglobalThis.harness=missionHarness;globalThis.installOperational=globals=>vm.runInContext([\'empireOperationalSettings\',\'fleetEnabled\',\'fleetDeficit\'].map(extract).join(\'\\n\'),globals);', ctx);
const noMission = ctx.harness(); noMission.read();
const mission = ctx.harness(); mission.data.job = { id: 'synthetic', status: 'waiting', produce: true }; mission.read();
const { harness, measure } = require('./empire-runtime.cjs');
const rows = [];
for (const n of [2,10,50]) {
  const h = harness(n), m = ctx.harness();
  m.globals.empireController = h.runtime; m.globals.empireAdapter = h.adapter;
  m.globals.systemId = () => h.f.context.systemId;
  m.globals.missionContext = () => ({ scope: h.f.context.scope, originId: h.f.context.systemId, selectionCount: 1 });
  ctx.installOperational(m.globals);
  const noMissionPriorityRead = measure(m.read, 20);
  h.reset(); m.read();
  const noMissionWorldReads = h.stats.worldReads;
  m.data.job = { id: 'synthetic', status: 'waiting', produce: true };
  const waitingMissionPriorityRead = measure(m.read, 20);
  h.reset(); m.read();
  rows.push({ systems: n, noMissionPriorityRead, noMissionWorldReads, waitingMissionPriorityRead, waitingMissionWorldReads: h.stats.worldReads });
}
console.log(JSON.stringify({ repo: REPO, method: 'Actual extracted readFleetPrioritySnapshot / missionQueueContext / canOperateMission / empireMissionPermission. Synthetic four-ship HUD; empireOperationalSettings, fleetEnabled and fleetDeficit also extracted, using real runtime state copies; permission work uses real runtime + adapter and bridge-copy simulation. Not a full step or browser timing.', noMissionCalls: { canAct: noMission.data.canActCalls, readActive: noMission.data.activeReads }, waitingMissionCalls: { canAct: mission.data.canActCalls, readActive: mission.data.activeReads }, rows }, null, 2));
