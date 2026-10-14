'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../docs/sync-core.js');

const SCOPE = 'andromeda/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_SCOPE = 'pegasus/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHIPS = ['probe', 'marauder', 'sentinel', 'vanguard'];
const targets = value => Object.fromEntries(SHIPS.map(id => [id, value]));
const clone = value => JSON.parse(JSON.stringify(value));
const key = (id, field) => `empire.systems.${id}.${field}`;
const uuid = index => `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const rows = count => Object.fromEntries(Array.from({ length: count }, (_, i) => [uuid(i), {
  name: `System ${i}`, role: 'balanced', enabled: false,
}]));
const config = patch => ({ schemaVersion: 1, enabled: false, fleetTargets: targets(0), systems: {}, ...patch });
const backup = (patch = {}, configPatch = {}) => ({
  profile: SCOPE,
  settings: { enabled: true },
  notifications: { botToken: '', chatId: '' },
  attackRetries: { enabled: false, enabledAt: 0, autoMinimums: false, minimumsEnabledAt: 0 },
  empire: { scope: SCOPE, config: config(configPatch) },
  ...patch,
});
const empireValues = source => Object.fromEntries(Object.entries(core.project(source)).filter(([name]) => name.startsWith('empire.')));
const flat = patch => ({ ...empireValues(backup()), ...patch });
const make = (actor = 'local', time = 100, state = null, scope = SCOPE) => core.create({
  actor, scope, state, now: typeof time === 'function' ? time : () => time,
});
const doc = (values, actor = 'remote', time = 100, scope = SCOPE) => ({
  format: 'old-light-settings-sync', schemaVersion: 1, scope,
  fields: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { stamp: [time, 0, actor], value }])),
});
const systemValues = count => Object.fromEntries(Array.from({ length: count }, (_, i) => [key(uuid(i), 'role'), 'balanced']));

test('empire projection shares only fleet targets and per-system role/attend policy', () => {
  const source = backup({}, {
    enabled: true, fleetTargets: { probe: 10, marauder: 20, sentinel: 30, vanguard: 40 },
    systems: { [A]: { name: 'Local name', role: 'industry', enabled: true, resources: { palladium: 5 }, token: 'secret' } },
    runtime: { queue: ['order'], resources: 9 }, orders: ['order'], token: 'secret',
  });
  source.empire.runtime = { attack: 'private order' };
  const values = empireValues(source);
  assert.deepEqual(values, {
    'empire.fleetTargets.probe': 10, 'empire.fleetTargets.marauder': 20,
    'empire.fleetTargets.sentinel': 30, 'empire.fleetTargets.vanguard': 40,
    [key(A, 'role')]: 'industry', [key(A, 'enabled')]: true,
  });
  assert.doesNotMatch(JSON.stringify(values), /secret|Local name|runtime|resources|orders|token/);
  assert.equal(Object.hasOwn(values, 'empire.enabled'), false);
});

test('present empire always projects four fleet targets and safe missing policy defaults', () => {
  const source = backup({ empire: { scope: SCOPE, config: { schemaVersion: 1, systems: { [A]: { name: 'A' } } } } });
  assert.deepEqual(empireValues(source), {
    'empire.fleetTargets.probe': 0, 'empire.fleetTargets.marauder': 0,
    'empire.fleetTargets.sentinel': 0, 'empire.fleetTargets.vanguard': 0,
    [key(A, 'role')]: 'balanced', [key(A, 'enabled')]: false,
  });
});

test('absent or null empire does not project its namespace', () => {
  const absent = backup(); delete absent.empire;
  assert.deepEqual(empireValues(absent), {});
  assert.deepEqual(empireValues(backup({ empire: null })), {});
  for (const empire of [false, 0, '', [], { scope: SCOPE, config: null }]) {
    assert.throws(() => core.project(backup({ empire })));
  }
});

test('projection enforces matching profile, account scope and empire config schema', () => {
  for (const profile of [undefined, null, '', OTHER_SCOPE, '__proto__', 'bad scope']) {
    const source = backup({ profile });
    assert.throws(() => core.project(source), /scope|profile/i);
  }
  for (const schemaVersion of [undefined, null, 0, 2, '1']) {
    assert.throws(() => core.project(backup({}, { schemaVersion })), /schema/i);
  }
  assert.throws(() => core.project(backup({ empire: { scope: OTHER_SCOPE, config: config() } })), /scope/i);
});

test('local UUID case normalizes, while colliding and malformed identifiers fail', () => {
  const source = backup({}, { systems: { [A.toUpperCase()]: { name: 'A', role: 'defense', enabled: false } } });
  assert.equal(empireValues(source)[key(A, 'role')], 'defense');
  assert.equal(Object.hasOwn(empireValues(source), key(A.toUpperCase(), 'role')), false);
  const result = core.overlay(source, { 'empire.fleetTargets.probe': 1 });
  assert.deepEqual(Object.keys(result.empire.config.systems), [A]);
  assert.equal(result.empire.config.systems[A].name, 'A');
  assert.deepEqual(Object.keys(source.empire.config.systems), [A.toUpperCase()]);
  const collisions = backup({}, { systems: { [A]: {}, [A.toUpperCase()]: {} } });
  assert.throws(() => core.project(collisions), /collid/i);
  assert.throws(() => core.overlay(collisions, flat()), /collid/i);
  for (const id of ['not-a-uuid', `${A}.enabled`, A.replace('-', ''), '__proto__', 'constructor']) {
    const systems = Object.fromEntries([[id, { role: 'balanced', enabled: false }]]);
    assert.throws(() => core.project(backup({}, { systems })));
  }
});

test('local fleet target and system policy validation does not coerce values', () => {
  for (const value of [-1, 1000001, 1.5, '5', true, null, NaN, Infinity]) {
    assert.throws(() => core.project(backup({}, { fleetTargets: { ...targets(0), probe: value } })), /target/i);
  }
  for (const role of ['attacker', '', null, 1, true, {}]) {
    assert.throws(() => core.project(backup({}, { systems: { [A]: { role, enabled: false } } })), /policy/i);
  }
  for (const enabled of [null, 0, 1, 'true', {}]) {
    assert.throws(() => core.project(backup({}, { systems: { [A]: { role: 'balanced', enabled } } })), /policy/i);
  }
  assert.equal(empireValues(backup({}, { fleetTargets: targets(1000000) }))['empire.fleetTargets.probe'], 1000000);
});

test('wire allows lowercase UUID policy only, rejecting every local-only namespace', () => {
  const forbidden = [
    'empire.enabled', 'empire.config.enabled', 'empire.scope', 'empire.fleetTargets.unknown',
    key(A, 'name'), key(A, 'resources'), key(A, 'token'), key(A.toUpperCase(), 'enabled'),
    'empire.systems.__proto__.enabled', 'empire.systems.constructor.role',
    'empire.runtime', 'empire.orders', 'empire.resources', 'empire.accessToken',
  ];
  for (const name of forbidden) {
    assert.throws(() => make().capture({ [name]: null }), /unknown|unsafe/i, name);
    assert.throws(() => make().merge(doc({ [name]: null })), /unknown|unsafe/i, name);
    assert.throws(() => core.overlay(backup(), { [name]: null }), /unknown|unsafe/i, name);
  }
  assert.equal({}.enabled, undefined);
});

test('wire validates numbers, booleans and the four roles, including explicit tombstones', () => {
  for (const role of ['balanced', 'industry', 'shipyard', 'defense', null]) {
    const client = make(); client.capture({ [key(A, 'role')]: role });
    assert.equal(client.values()[key(A, 'role')], role);
  }
  for (const value of [0, 1000000, null]) assert.doesNotThrow(() => make().merge(doc({ 'empire.fleetTargets.probe': value })));
  for (const value of [true, false, null]) assert.doesNotThrow(() => make().capture({ [key(A, 'enabled')]: value }));
  for (const [name, value] of [
    ['empire.fleetTargets.probe', -1], ['empire.fleetTargets.probe', 1000001], ['empire.fleetTargets.probe', '10'],
    ['empire.fleetTargets.probe', 0.1], [key(A, 'enabled'), 1], [key(A, 'enabled'), 'false'],
    [key(A, 'role'), 'constructor'], [key(A, 'role'), {}],
  ]) {
    assert.throws(() => make().capture({ [name]: value }), /invalid/i);
    assert.throws(() => make().merge(doc({ [name]: value })), /invalid/i);
  }
});

test('overlay preserves local global enabled, system names and unrelated runtime', () => {
  for (const enabled of [true, false]) {
    const source = backup({}, { enabled, systems: { [A]: { name: 'Local A', role: 'balanced', enabled: false } } });
    source.empire.runtime = { queue: ['local'], resources: { palladium: 7 }, token: 'keep-local' };
    source.drive = { accessToken: 'local oauth' };
    const before = clone(source);
    const result = core.overlay(source, { 'empire.fleetTargets.probe': 12, [key(A, 'role')]: 'industry', [key(A, 'enabled')]: true });
    assert.equal(result.empire.config.enabled, enabled);
    assert.deepEqual(result.empire.config.systems[A], { name: 'Local A', role: 'industry', enabled: true });
    assert.deepEqual(result.empire.runtime, source.empire.runtime);
    assert.deepEqual(result.drive, source.drive);
    assert.deepEqual(source, before);
  }
});

test('overlay onto a new device creates a disabled empire and safe new systems', () => {
  for (const withNull of [false, true]) {
    const source = backup();
    if (withNull) source.empire = null; else delete source.empire;
    const result = core.overlay(source, { 'empire.fleetTargets.probe': 3, [key(A, 'role')]: 'shipyard', [key(B, 'enabled')]: true });
    assert.equal(result.empire.scope, SCOPE);
    assert.equal(result.empire.config.schemaVersion, 1);
    assert.equal(result.empire.config.enabled, false);
    assert.deepEqual(result.empire.config.fleetTargets, { ...targets(0), probe: 3 });
    assert.deepEqual(result.empire.config.systems[A], { name: '', role: 'shipyard', enabled: false });
    assert.deepEqual(result.empire.config.systems[B], { name: '', role: 'balanced', enabled: true });
  }
});

test('tombstones reset fleet targets, role and attend without switching on an empire', () => {
  const source = backup({}, { enabled: true, fleetTargets: targets(9), systems: { [A]: { name: 'Retained name', role: 'defense', enabled: true } } });
  const result = core.overlay(source, { 'empire.fleetTargets.probe': null, [key(A, 'role')]: null, [key(A, 'enabled')]: null, [key(B, 'role')]: null });
  assert.equal(result.empire.config.enabled, true);
  assert.equal(result.empire.config.fleetTargets.probe, 0);
  assert.equal(result.empire.config.fleetTargets.sentinel, 9);
  assert.deepEqual(result.empire.config.systems[A], { name: 'Retained name', role: 'balanced', enabled: false });
  assert.deepEqual(result.empire.config.systems[B], { name: '', role: 'balanced', enabled: false });
});

test('overlay enforces empire scope only when empire fields are being applied', () => {
  const mismatch = backup({ empire: { scope: OTHER_SCOPE, config: config({ enabled: true }) } });
  assert.throws(() => core.overlay(mismatch, flat()), /scope/i);
  assert.throws(() => core.overlay({ empire: null }, flat()), /profile|scope/i);
  const ordinary = core.overlay(mismatch, { 'settings.enabled': false });
  assert.deepEqual(ordinary.empire, mismatch.empire);
  assert.equal(ordinary.settings.enabled, false);
});

test('temporary empire absence preserves registers and observations in capture and accept', () => {
  const source = backup({}, { fleetTargets: targets(12), systems: { [A]: { role: 'industry', enabled: true } } });
  const client = make(); client.capture(core.project(source)); client.promoteSeeds();
  const initial = client.state();
  for (const partial of [backup({ empire: null }), (() => { const value = backup(); delete value.empire; return value; })()]) {
    client.capture(core.project(partial)); client.accept(core.project(partial));
    assert.deepEqual(client.document(), initial.document);
    for (const name of Object.keys(initial.observed).filter(name => name.startsWith('empire.'))) {
      assert.deepEqual(client.state().observed[name], initial.observed[name]);
    }
  }
  const reloaded = make('local', 1, client.state());
  reloaded.capture(core.project(source));
  assert.deepEqual(reloaded.document(), initial.document);
});

test('empty imperial namespace still updates ordinary settings without imperial tombstones', () => {
  const client = make(); client.capture({ ...flat({ [key(A, 'enabled')]: true }), 'settings.enabled': true }); client.promoteSeeds();
  const imperial = client.document().fields[key(A, 'enabled')];
  client.capture({ 'settings.enabled': false });
  client.accept({ 'settings.enabled': false });
  assert.equal(client.values()['settings.enabled'], false);
  assert.deepEqual(client.document().fields[key(A, 'enabled')], imperial);
  assert.equal(client.state().observed[key(A, 'enabled')], true);
});

test('removing one UUID from a present config tombstones only its two policy fields', () => {
  const source = backup({}, { fleetTargets: targets(5), systems: {
    [A]: { role: 'industry', enabled: true }, [B]: { role: 'shipyard', enabled: false },
  } });
  const client = make(); client.capture(core.project(source)); client.promoteSeeds();
  const before = client.document(); delete source.empire.config.systems[A];
  client.capture(core.project(source));
  for (const field of ['role', 'enabled']) {
    assert.equal(client.values()[key(A, field)], null);
    assert.notDeepEqual(client.document().fields[key(A, field)].stamp, before.fields[key(A, field)].stamp);
  }
  for (const name of Object.keys(before.fields).filter(name => !name.startsWith(`empire.systems.${A}.`))) {
    assert.deepEqual(client.document().fields[name], before.fields[name], name);
  }
});

test('empty present systems map deletes policies while keeping fleet targets', () => {
  const client = make(); client.capture(flat({ [key(A, 'role')]: 'defense', [key(A, 'enabled')]: true })); client.promoteSeeds();
  client.capture(empireValues(backup()));
  assert.equal(client.values()[key(A, 'role')], null);
  assert.equal(client.values()[key(A, 'enabled')], null);
  for (const ship of SHIPS) assert.equal(client.values()[`empire.fleetTargets.${ship}`], 0);
});

test('independent role, attend and fleet target edits merge field by field', () => {
  const seed = make('seed', 10); seed.capture(flat({ [key(A, 'role')]: 'balanced', [key(A, 'enabled')]: false })); seed.promoteSeeds();
  const left = make('left', 20, seed.state()), right = make('right', 20, seed.state());
  left.capture({ ...left.values(), [key(A, 'role')]: 'industry', 'empire.fleetTargets.probe': 15 });
  right.capture({ ...right.values(), [key(A, 'enabled')]: true, 'empire.fleetTargets.sentinel': 23 });
  left.merge(right.document()); right.merge(left.document());
  assert.deepEqual(left.document(), right.document());
  assert.equal(left.values()[key(A, 'role')], 'industry');
  assert.equal(left.values()[key(A, 'enabled')], true);
  assert.equal(left.values()['empire.fleetTargets.probe'], 15);
  assert.equal(left.values()['empire.fleetTargets.sentinel'], 23);
});

test('same-field imperial edits converge deterministically across all merge orders', () => {
  const documents = [doc({ [key(A, 'role')]: 'industry' }, 'a', 100), doc({ [key(A, 'role')]: 'shipyard' }, 'b', 100), doc({ [key(A, 'enabled')]: false }, 'c', 99)];
  const permutations = [[0, 1, 2], [2, 1, 0], [1, 0, 2], [2, 0, 1], [0, 2, 1], [1, 2, 0]];
  let expected;
  for (const order of permutations) {
    const client = make(); client.merge(order.map(index => documents[index])); client.merge(documents);
    expected ??= client.document(); assert.deepEqual(client.document(), expected);
    assert.equal(client.values()[key(A, 'role')], 'shipyard');
  }
});

test('new clients and clients lacking observations cannot overwrite remote policy with stale defaults', () => {
  const remote = make('remote', 100); remote.capture(flat({ [key(A, 'role')]: 'defense', [key(A, 'enabled')]: true, 'empire.fleetTargets.probe': 50 })); remote.promoteSeeds();
  const stale = flat({ [key(A, 'role')]: 'balanced', [key(A, 'enabled')]: false });
  const fresh = make('fresh', 9000); fresh.capture(stale); fresh.merge(remote.document()); fresh.capture(stale);
  assert.deepEqual(fresh.document(), remote.document());
  const withoutObservation = make('fresh', 9000, { document: remote.document(), observed: {} });
  withoutObservation.capture(stale);
  assert.deepEqual(withoutObservation.document(), remote.document());
});

test('remote deletions defeat stale clients and applied default values are not echoed as resurrection', () => {
  const remote = make('remote', 100); remote.capture(flat({ [key(A, 'role')]: 'industry', [key(A, 'enabled')]: true })); remote.promoteSeeds();
  remote.capture(flat());
  const receiver = make('receiver', 9000); receiver.capture(flat({ [key(A, 'role')]: 'defense', [key(A, 'enabled')]: true })); receiver.merge(remote.document());
  const local = core.overlay(backup({}, { enabled: false, systems: { [A]: { name: 'A', role: 'defense', enabled: true } } }), receiver.values());
  assert.deepEqual(local.empire.config.systems[A], { name: 'A', role: 'balanced', enabled: false });
  receiver.accept(empireValues(local)); receiver.capture(empireValues(local));
  assert.deepEqual(receiver.document(), remote.document());
  local.empire.config.systems[A].role = 'shipyard'; receiver.capture(empireValues(local));
  assert.equal(receiver.values()[key(A, 'role')], 'shipyard');
  assert.equal(receiver.values()[key(A, 'enabled')], null);
});

test('new clients read legacy schema 1 documents, and legacy documents cannot erase empire data', () => {
  const legacy = doc({ 'settings.enabled': true, 'settings.countAway': false }, 'old-client', 100);
  const client = make(); client.merge(legacy);
  assert.deepEqual(client.document(), legacy);
  client.capture({ ...client.values(), ...flat({ [key(A, 'role')]: 'industry' }) });
  client.promoteSeeds(); const before = client.document();
  client.merge(legacy); assert.deepEqual(client.document(), before);
  assert.equal(client.document().schemaVersion, 1);
});

test('scope mismatch rejects merge and restore without changing any existing account policy', () => {
  const local = make(); local.capture(flat({ [key(A, 'enabled')]: true })); const before = local.state();
  assert.throws(() => local.merge(doc(flat({ [key(B, 'enabled')]: true }), 'other', 100, OTHER_SCOPE)), /scope/i);
  assert.deepEqual(local.state(), before);
  assert.throws(() => make('other', 100, before, OTHER_SCOPE), /scope/i);
});

test('local projection and wire allow exactly 1024 systems, rejecting 1025', () => {
  const source = backup({}, { systems: rows(1024) });
  assert.equal(Object.keys(empireValues(source)).length, 2052);
  assert.doesNotThrow(() => make().merge(doc(systemValues(1024))));
  assert.throws(() => core.project(backup({}, { systems: rows(1025) })), /1024|limit/i);
  assert.throws(() => make().capture(systemValues(1025)), /1024|limit/i);
  assert.throws(() => make().merge(doc(systemValues(1025))), /1024|limit/i);
});

test('overlay checks the union of local and incoming system IDs atomically', () => {
  const source = backup({}, { systems: rows(1024) }); const before = clone(source);
  assert.throws(() => core.overlay(source, { [key(uuid(1024), 'enabled')]: true }), /1024|limit/i);
  assert.deepEqual(source, before);
  assert.equal(Object.keys(core.overlay(source, { [key(uuid(10), 'enabled')]: true }).empire.config.systems).length, 1024);
});

test('merge checks the union across documents and retained tombstones atomically', () => {
  const client = make(); client.merge(doc(systemValues(1024))); const before = client.state();
  assert.throws(() => client.merge(doc({ [key(uuid(1024), 'role')]: 'defense' })), /1024|limit/i);
  assert.deepEqual(client.state(), before);
  const empty = make();
  assert.throws(() => empty.merge([doc(systemValues(1024)), doc({ [key(uuid(1024), 'role')]: null })]), /1024|limit/i);
  assert.deepEqual(empty.document().fields, {});
});

test('capture and accept reject system union overflow without mutating their state', () => {
  const client = make(); client.capture(systemValues(1024)); const before = client.state();
  assert.throws(() => client.capture({ [key(uuid(1024), 'role')]: 'industry' }), /1024|limit/i);
  assert.deepEqual(client.state(), before);
  assert.throws(() => client.accept({ [key(uuid(1024), 'role')]: 'industry' }), /1024|limit/i);
  assert.deepEqual(client.state(), before);
  assert.throws(() => make('restore', 100, { document: before.document, observed: { [key(uuid(1024), 'role')]: 'industry' } }), /1024|limit/i);
});

test('encoded documents and values retain the 1 MiB bound', () => {
  const client = make(); const before = client.state();
  const huge = 'x'.repeat(1024 * 1024);
  assert.throws(() => client.merge(doc({ [key(A, 'role')]: huge })), /limit|byte/i);
  assert.throws(() => client.capture({ [key(A, 'role')]: huge }), /limit|byte/i);
  assert.deepEqual(client.state(), before);
});

test('accessors at backup, policy, flat, document, stamp and options boundaries never execute', () => {
  let calls = 0;
  const getter = (object, name) => Object.defineProperty(object, name, { enumerable: true, get() { calls += 1; throw new Error('executed getter'); } });
  const badBackup = backup(); getter(badBackup, 'empire');
  const badProfile = backup(); getter(badProfile, 'profile');
  const badPolicy = backup({}, { systems: { [A]: { role: 'industry', enabled: true } } }); getter(badPolicy.empire.config.systems[A], 'role');
  const badFlat = getter({}, key(A, 'enabled'));
  const badDoc = doc({ [key(A, 'enabled')]: true }); getter(badDoc.fields[key(A, 'enabled')].stamp, '0');
  const badOptions = getter({ scope: SCOPE }, 'actor');
  for (const source of [badBackup, badProfile, badPolicy]) assert.throws(() => core.project(source), /accessor|JSON/i);
  assert.throws(() => make().capture(badFlat), /accessor|JSON/i);
  assert.throws(() => make().accept(badFlat), /accessor|JSON/i);
  assert.throws(() => make().merge(badDoc), /accessor|JSON/i);
  assert.throws(() => core.overlay(backup(), badFlat), /accessor|JSON/i);
  assert.throws(() => core.create(badOptions), /accessor|JSON/i);
  assert.equal(calls, 0);
});

test('prototype, symbols and hidden data cannot enter imperial registers', () => {
  const polluted = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => make().capture(polluted));
  const inherited = Object.create({ [key(A, 'enabled')]: true });
  assert.throws(() => make().capture(inherited));
  const symbol = { [key(A, 'enabled')]: true, [Symbol('extra')]: false };
  assert.throws(() => make().capture(symbol));
  const hidden = Object.defineProperty(doc({ [key(A, 'enabled')]: true }), 'hidden', { value: 1 });
  assert.throws(() => make().merge(hidden), /JSON/i);
  const unsafeSystem = backup({}, { systems: JSON.parse(`{"${A}":{"role":"balanced","enabled":false,"__proto__":{"polluted":true}}}`) });
  assert.throws(() => core.project(unsafeSystem), /unsafe/i);
  assert.equal({}.polluted, undefined);
});

test('failed writes restore both state and hybrid clock before retry', () => {
  let calls = 0, mode = 'throw';
  const client = make('clock', () => {
    calls += 1;
    if (mode === 'throw' && calls === 2) throw new Error('clock unavailable');
    return mode === 'throw' ? 100 : 1;
  });
  client.capture(flat()); const before = client.state();
  assert.throws(() => client.promoteSeeds(), /clock unavailable/);
  assert.deepEqual(client.state(), before);
  mode = 'valid'; client.promoteSeeds();
  assert.ok(Object.values(client.document().fields).every(({ stamp }) => stamp[0] === 1));
});

test('imperial documents reject conflicting same-stamp payloads without partial merge', () => {
  const client = make();
  assert.throws(() => client.merge([doc({ [key(A, 'role')]: 'industry' }), doc({ [key(A, 'role')]: 'defense' })]), /conflict/i);
  assert.deepEqual(client.document().fields, {});
});
