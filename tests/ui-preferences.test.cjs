'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const constants = source.slice(source.indexOf('  const KEY ='), source.indexOf('  const upgradeEta ='));
const helpers = source.slice(source.indexOf('  function normalizeOrder('), source.indexOf('  function text(node)'));
const validation = source.slice(source.indexOf('  function backupError('), source.indexOf('  function applyBackup('));
const context = vm.createContext({});
vm.runInContext(constants + helpers + `
  const notifier = { validateConfig: v => v };
  const levelTargets = { validateConfig: v => v };
  const fleetWait = { validateConfig: v => v };
  const attackRetry = { validateConfig: v => v };
  const driveBackup = { validateConfig: v => v };
  ${validation}
  this.api = { normalize: normalizeSettings, validate: validateBackup };
`, context);
const clone = value => JSON.parse(JSON.stringify(value));
const normalize = value => clone(context.api.normalize(value));
const backup = settings => ({ format: 'old-light-auto-upgrade-backup', schemaVersion: 1, settings, notifications: {} });
const validate = settings => clone(context.api.validate(backup(settings))).settings;

test('Older backups open with the readable default width and no forced new disclosures', () => {
  const saved = normalize({ enabled: false, shipMinimums: { marauder: 9 }, panelPosition: { x: 55, y: 80 } });
  delete saved.panelWidth;
  delete saved.uiSections;
  const restored = validate(saved);
  assert.equal(restored.panelWidth, 360);
  assert.deepEqual(restored.uiSections, {});
  assert.equal(restored.enabled, false);
  assert.equal(restored.shipMinimums.marauder, 9);
  assert.deepEqual(restored.panelPosition, { x: 55, y: 80 });
});

test('Width and disclosure choices survive a backup without changing automation settings', () => {
  const saved = normalize({ panelWidth: 480, uiSections: { telegramConnection: false, notificationDiagnostics: true, driveAdvanced: true },
    enabled: false, activeTab: 'notifications', countAway: true, shipMinimums: { marauder: 12, vanguard: 3 } });
  const restored = validate(clone(saved));
  assert.equal(restored.panelWidth, 480);
  assert.deepEqual(restored.uiSections, { telegramConnection: false, notificationDiagnostics: true, driveAdvanced: true });
  assert.equal(restored.enabled, false);
  assert.equal(restored.activeTab, 'notifications');
  assert.equal(restored.countAway, true);
  assert.deepEqual(restored.shipMinimums, { probe: 0, marauder: 12, sentinel: 0, vanguard: 3 });
});

test('Locally saved widths are clamped to supported limits', () => {
  assert.equal(normalize({ panelWidth: 100 }).panelWidth, 300);
  assert.equal(normalize({ panelWidth: 900 }).panelWidth, 560);
  assert.equal(normalize({ panelWidth: 420.6 }).panelWidth, 421);
  for (const panelWidth of [null, '480', NaN, Infinity]) assert.equal(normalize({ panelWidth }).panelWidth, 360);
});

test('Malformed imported widths are rejected before applying any backup settings', () => {
  for (const panelWidth of [null, '480', 299, 561, 420.5, NaN, Infinity]) {
    assert.throws(() => validate({ ...normalize({}), panelWidth }), /ajustes del helper inválidos/);
  }
  for (const panelWidth of [300, 360, 560]) assert.equal(validate({ ...normalize({}), panelWidth }).panelWidth, panelWidth);
});

test('Only known boolean disclosure preferences are restored', () => {
  assert.deepEqual(normalize({ uiSections: { telegramConnection: false, driveAdvanced: true, ignored: true, notificationDiagnostics: 'yes' } }).uiSections,
    { telegramConnection: false, driveAdvanced: true });
  for (const uiSections of [null, [], { driveAdvanced: 1 }, { unknown: true }, JSON.parse('{"__proto__":true}')]) {
    assert.throws(() => validate({ ...normalize({}), uiSections }), /ajustes del helper inválidos/);
  }
});

test('Normalization copies presentation preferences instead of sharing mutable backup input', () => {
  const input = { panelWidth: 400, uiSections: { telegramConnection: true } };
  const result = normalize(input);
  input.uiSections.telegramConnection = false;
  assert.equal(result.uiSections.telegramConnection, true);
  assert.equal(result.panelWidth, 400);
});
