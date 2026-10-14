'use strict';
// Regression for the 2026-10-14 report. Screenshot counts are a hypothetical
// synchronized fixture, not a claim that separate screenshots share one census.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../docs/empire-core.js');
const source = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = 'alpha/player', NOW = 10000;
const IDS = core.DEFAULT_SHIPS;
const ships = value => Object.fromEntries(IDS.map(id => [id, value]));
function extract(name) {
  const start = source.indexOf(`  function ${name}(`), end = source.indexOf('\n  }\n', start);
  assert.ok(start >= 0 && end > start, `${name} exists in distributed Helper`);
  return source.slice(start, end + 5);
}
function fixture() {
  const counts = [
    { probe: [0,30], marauder: [0,165], sentinel: [147,0], vanguard: [1,1] },
    { probe: [0,30], marauder: [0,238], sentinel: [163,0], vanguard: [3,1] },
  ];
  const snapshots = [A,B].map((systemId,index) => ({ scope:SCOPE,systemId,owned:true,observedAt:NOW,censusId:'one-response',
    resources:Object.fromEntries(['palladium','iridium'].map(id=>[id,{amount:50000,cap:150000,rate:200}])),
    energy:40,queue:{buildings:0,ships:0},
    fleet:Object.fromEntries(IDS.map(id=>[id,{parked:counts[index][id][0],away:counts[index][id][1],building:0}])) }));
  const config = { enabled:true,fleetTargets:{probe:30,marauder:300,sentinel:300,vanguard:5},systems:{} };
  const options = { scope:SCOPE,now:NOW,expectedIds:[A,B],transitCensus:{scope:SCOPE,observedAt:NOW,censusId:'one-response',ships:{probe:60,marauder:403,sentinel:0,vanguard:2}} };
  return {snapshots,config,options};
}

test('covered imperial goals create zero deficits while local away-excluded minima stay saved', () => {
  const f=fixture(), plan=core.plan(f.config,f.snapshots,f.options);
  assert.equal(plan.reason,'targets-met'); assert.deepEqual(plan.summary.deficits,ships(0));
  let enabled=true, selected=A;
  const settings={countAway:false,shipMinimums:{...f.config.fleetTargets},order:[]}, before=structuredClone(settings);
  const context=vm.createContext({settings,systemId:()=>selected,empireController:{isEnabled:()=>enabled,
    systemPolicy:id=>({role:'balanced',shipMinimums:plan.targetsBySystem[id].shipMinimums})}});
  vm.runInContext(extract('empireOperationalSettings')+'\n'+extract('fleetDeficit'),context);
  for(const row of f.snapshots) { selected=row.systemId; for(const id of IDS) assert.equal(context.fleetDeficit(id,row.fleet[id]),0,id); }
  assert.deepEqual(settings,before);
  enabled=false; selected=A;
  assert.equal(context.fleetDeficit('probe',f.snapshots[0].fleet.probe),30);
  assert.equal(context.fleetDeficit('marauder',f.snapshots[0].fleet.marauder),300);
  assert.equal(context.fleetDeficit('sentinel',f.snapshots[0].fleet.sentinel),153);
  assert.equal(context.fleetDeficit('vanguard',f.snapshots[0].fleet.vanguard),4);
});

test('verified loss or increased goal requests only the real global shortfall once', () => {
  const f=fixture(); f.config.fleetTargets.vanguard=9;
  let plan=core.plan(f.config,f.snapshots,f.options);
  assert.equal(plan.summary.deficits.vanguard,3);
  assert.equal(Object.values(plan.summary.allocationsBySystem).reduce((n,x)=>n+x.vanguard,0),3);
  f.config.fleetTargets.vanguard=5; f.snapshots[1].fleet.vanguard.parked=1;
  plan=core.plan(f.config,f.snapshots,f.options);
  assert.equal(plan.summary.deficits.vanguard,1);
  assert.equal(Object.values(plan.summary.allocationsBySystem).reduce((n,x)=>n+x.vanguard,0),1);
});

test('mixed censuses, missing transit and stale counts cannot authorize screenshot-like orders', () => {
  for(const mutate of [f=>f.snapshots[1].censusId='other',f=>f.options.transitCensus=null,f=>f.options.now+=120001]) {
    const f=fixture(); mutate(f); const plan=core.plan(f.config,f.snapshots,f.options);
    assert.equal(plan.complete,false); assert.deepEqual(plan.targetsBySystem,{});
  }
});

test('local fleet page identifies its scope and explains the active imperial override', () => {
  assert.match(source,/<h3>Flota mínima local<\/h3>/);
  assert.match(source,/Contar también las naves en misión \(solo modo local\)/);
  assert.match(source,/data-field="fleet-policy-notice"[^>]*hidden/);
  assert.match(source,/Imperio activo: estos mínimos locales no se aplican/);
  assert.match(source,/fleetPolicyNotice: shadow\.querySelector\('\[data-field="fleet-policy-notice"\]'\)/);
  assert.match(extract('syncFleetChoices'),/syncFleetPolicyNotice\(\)/);
});

test('local override notice follows active mode without changing settings or requiring census reads', () => {
  let enabled=true;
  const notice={hidden:true}, settings={countAway:false,shipMinimums:ships(12)};
  const context=vm.createContext({ui:{fleetPolicyNotice:notice},settings,empireController:{isEnabled:()=>enabled,
    state(){throw Error('No full snapshot needed');},systemPolicy(){throw Error('No policy read needed');}}});
  vm.runInContext(extract('syncFleetPolicyNotice'),context);
  const before=structuredClone(settings); context.syncFleetPolicyNotice(); assert.equal(notice.hidden,false);
  enabled=false; context.syncFleetPolicyNotice(); assert.equal(notice.hidden,true);
  context.empireController=null; context.syncFleetPolicyNotice(); assert.equal(notice.hidden,true);
  context.ui=null; assert.doesNotThrow(()=>context.syncFleetPolicyNotice());
  assert.deepEqual(settings,before);
});


test('local override notice writes visibility only when active mode changes', () => {
  let enabled = false, hidden = true, writes = 0;
  const notice = { get hidden() { return hidden; }, set hidden(value) { writes++; hidden = value; } };
  const context = vm.createContext({ ui: { fleetPolicyNotice: notice }, empireController: { isEnabled: () => enabled } });
  vm.runInContext(extract('syncFleetPolicyNotice'), context);
  for (let index = 0; index < 100; index++) context.syncFleetPolicyNotice();
  assert.equal(writes, 0);
  enabled = true; context.syncFleetPolicyNotice(); assert.equal(hidden, false); assert.equal(writes, 1);
  for (let index = 0; index < 100; index++) context.syncFleetPolicyNotice();
  assert.equal(writes, 1);
  enabled = false; context.syncFleetPolicyNotice(); assert.equal(hidden, true); assert.equal(writes, 2);
  context.empireController = null; context.syncFleetPolicyNotice(); assert.equal(writes, 2);
});
