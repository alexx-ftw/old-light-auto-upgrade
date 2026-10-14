'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertCoverage, harness } = require('../benchmarks/empire-navigation.cjs');
for (const workload of ['buildings', 'fleet']) for (const systems of [2, 10, 50]) {
  test(`installed filter has bounded real-planner work and known results: ${systems} ${workload}`, () => {
    const report = assertCoverage(systems, workload);
    assert.equal(report.eligibleCount + report.idleCount, systems);
    assert.equal(report.nullResults, 0); assert.equal(report.dataFallbacks, 0);
    assert.equal(report.structureEvaluations, systems * report.navigationCalls);
    assert.ok(report.calls['infrastructurePriority.select'] <= 2 * systems * report.navigationCalls);
    assert.ok((report.calls['upgradeEta.estimate'] || 0) <= 3 * systems * report.navigationCalls);
    assert.ok((report.calls['fleetPriority.select'] || 0) <= systems * report.navigationCalls);
  });
}
test('installed filter adds no source reads or action-boundary cache to the synthetic common-step slice', () => {
  const baseline = harness(10), installed = harness(10, { installed: true });
  assert.equal(baseline.cycle(), true); assert.equal(installed.cycle(), true);
  assert.equal(installed.stats.worldReads, baseline.stats.worldReads);
  assert.equal(installed.stats.planCalls, baseline.stats.planCalls);
  assert.equal(installed.stats.navigationCalls, 2); assert.equal(baseline.stats.navigationCalls, 0);
});
