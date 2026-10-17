'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.QA_SETTINGS_READ_SOURCE || path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
function harness(raw, failRead = false) {
  const writes = [], events = new Map();
  const context = vm.createContext({ localStorage: {
    getItem() { if (failRead) throw Error('synthetic storage unavailable'); return raw; },
    setItem(key, value) { writes.push([key, value]); raw = value; },
  }, window: { addEventListener: (type, fn) => events.set(type, fn) },
  shiftPresets: { cancel() {} }, allyProtection: { render() {} }, ui: null,
  restoreNumericInputs() {}, schedule() {} });
  const constants = source.slice(source.indexOf('  const KEY ='), source.indexOf('  const upgradeEta ='));
  const helpers = source.slice(source.indexOf('  function normalizeOrder('), source.indexOf('  function text(node)'));
  const permissionStart = source.indexOf('  function canOperateMission(');
  const permission = source.slice(permissionStart, source.indexOf('  function missionQueueContext(', permissionStart));
  const start = source.lastIndexOf("  window.addEventListener('storage', event => {");
  const listener = source.slice(start, source.indexOf("  window.addEventListener('resize'", start));
  vm.runInContext(constants + '\n' + helpers + `
    let settings = readSettings(), error = '', unconfirmed = 0;
    const leader=true, importingBackup=false, pending=null, reinforcementNavigation=null, conquestNavigation=null, empireController=null;
    const reports={isRecovering:()=>false}, document={hidden:false,querySelector:selector=>selector.includes('.b-loading')?null:{} };
    function missionContext(){return {scope:'synthetic/self',originId:'synthetic-origin',selectionCount:1};}
    function hudPanelAvailable(){return true;}
    ${permission}
    restoreNumericInputs = () => {};
    ${listener}
    globalThis.api = { state: () => settings, set: value => { settings = normalizeSettings(value); }, read: readSettings, save: saveSettings, canAct: canOperateMission };
  `, context);
  return { state: () => JSON.parse(JSON.stringify(context.api.state())), writes,
    canAct: () => context.api.canAct(), save: () => context.api.save(),
    set: value => context.api.set(value), replace: value => { raw = value; },
    fail: value => { failRead = value; }, storage: () => events.get('storage')({ key: 'old-light-auto-upgrade:v1' }), raw: () => raw };
}
for (const raw of ['{bad json', '', 'null', '[]', 'true', '17', '"text"']) {
  test('unreadable stored settings start paused without overwriting: ' + JSON.stringify(raw), () => {
    const h = harness(raw);
    assert.equal(h.state().enabled, false);
    assert.equal(h.raw(), raw);
    assert.deepEqual(h.writes, []);
  });
}
test('storage read failure starts paused and writes nothing', () => {
  const h = harness('{"enabled":false}', true);
  assert.equal(h.state().enabled, false);
  assert.deepEqual(h.writes, []);
});
test('a missing first-run configuration retains the existing enabled default', () => {
  assert.equal(harness(null).state().enabled, true);
});
test('a failed cross-tab read pauses while preserving current exclusions and active minimums', () => {
  const h = harness('{"enabled":true}');
  h.set({enabled:true, excluded:['reactor'], shipMinimums:{marauder:37}, countAway:true});
  const before = h.state();
  assert.ok(before.excluded.length, 'fixture must contain a real excluded building');
  h.fail(true); h.storage();
  assert.deepEqual(h.state(), {...before, enabled:false});
  h.fail(false); h.replace('{broken'); h.storage();
  assert.deepEqual(h.state(), {...before, enabled:false});
  assert.deepEqual(h.writes, []);
});
test('a later valid cross-tab configuration recovers its explicit enabled choice and values', () => {
  const h = harness('null');
  h.replace(JSON.stringify({enabled:false, shipMinimums:{marauder:44}})); h.storage();
  assert.equal(h.state().enabled, false); assert.equal(h.state().shipMinimums.marauder, 44);
  h.replace(JSON.stringify({enabled:true, shipMinimums:{marauder:55}})); h.storage();
  assert.equal(h.state().enabled, true); assert.equal(h.state().shipMinimums.marauder, 55);
  assert.deepEqual(h.writes, []);
});

const invalidEnabled = [null, 'false', 'true', '', 0, 1, -1, {}, [], ['false']];
test('invalid stored activation pauses cold loading while retaining valid preferences and original bytes', () => {
  for (const enabled of invalidEnabled) {
    const raw=JSON.stringify({enabled,excluded:['reactor'],shipMinimums:{marauder:17},countAway:true,panelWidth:480});
    const h=harness(raw);assert.equal(h.state().enabled,false);assert.equal(h.canAct(),false);
    assert.deepEqual(h.state().excluded,['reactor']);assert.equal(h.state().shipMinimums.marauder,17);assert.equal(h.state().countAway,true);assert.equal(h.state().panelWidth,480);
    assert.equal(h.raw(),raw);assert.deepEqual(h.writes,[]);
    assert.equal(harness(h.raw()).canAct(),false);
  }
});
test('invalid cross-tab activation pauses without adopting replacement preferences or losing current choices', () => {
  for (const enabled of invalidEnabled) {
    const h=harness('{"enabled":true}');h.set({enabled:true,excluded:['reactor'],shipMinimums:{marauder:37},countAway:true,panelWidth:480});const before=h.state();
    h.replace(JSON.stringify({enabled,excluded:[],shipMinimums:{marauder:0},panelWidth:300}));h.storage();
    assert.deepEqual(h.state(),{...before,enabled:false});assert.equal(h.canAct(),false);assert.deepEqual(h.writes,[]);
  }
});
test('deleting stored settings during an existing session preserves preferences and pauses instead of first-run activation', () => {
  for(const enabled of [true,false]){
    const h=harness(JSON.stringify({enabled,excluded:['reactor'],shipMinimums:{marauder:37},countAway:true})),before=h.state();
    h.replace(null);h.storage();assert.deepEqual(h.state(),{...before,enabled:false});assert.equal(h.canAct(),false);assert.deepEqual(h.writes,[]);
  }
});
test('a genuine first run remains compatible and the ordinary mission gate can act with valid context', () => {
  const h=harness(null);assert.equal(h.state().enabled,true);assert.equal(h.canAct(),true);assert.deepEqual(h.writes,[]);
});
test('legacy preferences without activation retain cold defaults but cannot reactivate a paused live session', () => {
  const raw=JSON.stringify({excluded:['reactor'],shipMinimums:{marauder:23},countAway:true});
  const cold=harness(raw);assert.equal(cold.state().enabled,true);assert.equal(cold.state().shipMinimums.marauder,23);assert.equal(cold.canAct(),true);
  const live=harness('{"enabled":false,"panelWidth":480,"excluded":["reactor"]}');
  live.replace('{"shipMinimums":{"marauder":55}}');live.storage();assert.equal(live.state().enabled,false);assert.equal(live.state().panelWidth,480);assert.deepEqual(live.state().excluded,['reactor']);assert.equal(live.state().shipMinimums.marauder,55);assert.equal(live.canAct(),false);assert.deepEqual(live.writes,[]);
});
test('future-looking metadata cannot override invalid activation and unknown stored fields remain untouched', () => {
  for(const enabled of invalidEnabled){
    const raw=JSON.stringify({enabled,schemaVersion:99,scriptVersion:'999.0.0',version:'999.0.0',futurePolicy:{mode:'synthetic'},excluded:['reactor'],shipMinimums:{marauder:17}});
    const h=harness(raw);assert.equal(h.state().enabled,false);assert.equal(h.canAct(),false);assert.equal(h.raw(),raw);assert.deepEqual(h.writes,[]);
  }
  for(const enabled of [true,false]){
    const raw=JSON.stringify({enabled,schemaVersion:99,scriptVersion:'999.0.0',version:'999.0.0',futurePolicy:{mode:'synthetic'}});
    const h=harness(raw);assert.equal(h.state().enabled,enabled);assert.equal(h.canAct(),enabled);assert.equal(h.raw(),raw);assert.deepEqual(h.writes,[]);
  }
});
test('explicitly saving a safely paused configuration preserves valid known preferences across reload', () => {
  const h=harness('{"enabled":"false","excluded":["reactor"],"shipMinimums":{"marauder":17},"countAway":true}');
  assert.equal(h.canAct(),false);assert.equal(h.save(),true);assert.equal(JSON.parse(h.raw()).enabled,false);assert.equal(h.writes.length,1);
  const reloaded=harness(h.raw());assert.equal(reloaded.canAct(),false);assert.equal(reloaded.state().shipMinimums.marauder,17);assert.deepEqual(reloaded.state().excluded,['reactor']);assert.equal(reloaded.state().countAway,true);
});
