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
  const start = source.lastIndexOf("  window.addEventListener('storage', event => {");
  const listener = source.slice(start, source.indexOf("  window.addEventListener('resize'", start));
  vm.runInContext(constants + '\n' + helpers + `
    let settings = readSettings(), error = '', unconfirmed = 0;
    restoreNumericInputs = () => {};
    ${listener}
    globalThis.api = { state: () => settings, set: value => { settings = normalizeSettings(value); }, read: readSettings };
  `, context);
  return { state: () => JSON.parse(JSON.stringify(context.api.state())), writes,
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
