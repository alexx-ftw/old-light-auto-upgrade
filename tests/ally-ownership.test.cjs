'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const O = require('../docs/empire-observer.js');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SELF = uuid(1), ALLY = uuid(2), OTHER = uuid(3), NOW = 1791930000000;
const frame = (event, data) => '42' + JSON.stringify([event, data]);
const copy = x => JSON.parse(JSON.stringify(x));
const xy = q => ({ q, r: -q });
function system(q = 10) {
  return { id: uuid(q), ...xy(q), name: `System ${q}`, buildings: [{ type: 'shipyard', level: 0 }], fleet: [],
    economy: { resources: { palladium: 100, iridium: 100, settledAt: new Date(NOW).toISOString() },
      paCap: 100, irCap: 100, paRatePerMin: 1, irRatePerMin: 1, energyCap: 1, energyUsed: 0,
      deficitMultiplier: 1, queueSlots: 1, queue: [] } };
}
function initial() {
  return { selfId: SELF, serverNow: NOW, config: { version: 'fixture' }, world: { players: [
    { id: SELF, name: 'Self', owned: [system()], transits: [] },
    { id: ALLY, name: 'Public ally', owned: [xy(20), xy(21)] },
    { id: OTHER, name: 'Public rival', owned: [xy(30)] },
  ] } };
}
function ready(payload = initial()) {
  let time = NOW;
  const r = O.createReducer({ galaxy: 'alpha', now: () => time++ });
  r.beginConnection(); r.ingest(frame('world.init', payload));
  return r;
}
const delta = (r, data) => r.ingest(frame('world.delta', data));
const players = r => r.snapshot().ownership?.players;
const player = (r, owner) => players(r)?.find(p => p.id === owner);

test('ownership is explicitly partial and retains only public ID/name/coordinate claims', () => {
  const p = initial(), raw = p.world.players[1];
  raw.email = 'private@example.invalid'; raw.transits = [{ secret: 'PRIVATE_TRANSIT' }];
  raw.credits = { amount: 'PRIVATE_CREDIT' }; raw.owned[0].fleet = [{ secret: 'PRIVATE_FLEET' }];
  raw.owned[0].economy = { secret: 'PRIVATE_ECONOMY' }; raw.name = 'Public\u0000 ally';
  const r = ready(p), s = r.snapshot();
  assert.equal(s.complete, true); assert.equal(s.ownership.version, 1); assert.equal(s.ownership.complete, false);
  assert.deepEqual(player(r, ALLY), { id: ALLY, name: 'Public ally', owned: [xy(20), xy(21)] });
  assert.doesNotMatch(JSON.stringify(s), /PRIVATE_|private@example|secret/);
  assert.equal(player(r, ALLY).owned.some(p => p.q === 999), false);
});
test('native update empty owned keeps earlier coordinates, nonempty replaces exactly', () => {
  const r = ready();
  delta(r, { updated: { players: [{ id: ALLY, name: 'Renamed ally', owned: [] }] } });
  assert.deepEqual(player(r, ALLY).owned, [xy(20), xy(21)]);
  assert.equal(player(r, ALLY).name, 'Renamed ally');
  delta(r, { updated: { players: [{ id: ALLY, owned: [xy(22)] }] } });
  assert.deepEqual(player(r, ALLY), { id: ALLY, owned: [xy(22)] });
});
test('native captures prune all untouched owners by exact coordinates', () => {
  const r = ready();
  delta(r, { updated: { players: [{ id: OTHER, name: 'Public rival', owned: [xy(20), xy(30)] }] } });
  assert.deepEqual(player(r, ALLY).owned, [xy(21)]);
  assert.deepEqual(player(r, OTHER).owned, [xy(20), xy(30)]);
  assert.equal(r.snapshot().complete, true);
});
test('added unknown player claims prune other owners and updated unknown player is inserted', () => {
  const r = ready(), newer = uuid(4);
  delta(r, { added: { players: [{ id: newer, name: 'New player', owned: [xy(20)] }] } });
  assert.deepEqual(player(r, ALLY).owned, [xy(21)]);
  assert.deepEqual(player(r, newer).owned, [xy(20)]);
  delta(r, { updated: { players: [{ id: uuid(5), owned: [xy(30)] }] } });
  assert.deepEqual(player(r, OTHER).owned, []);
  assert.deepEqual(player(r, uuid(5)).owned, [xy(30)]);
});
test('native added existing player is ignored as a record but its coordinates still prune others', () => {
  const r = ready();
  delta(r, { added: { players: [{ id: ALLY, owned: [xy(30)] }] } });
  assert.deepEqual(player(r, ALLY).owned, [xy(20), xy(21)]);
  assert.deepEqual(player(r, OTHER).owned, []);
});
test('all touched IDs are protected from pruning; contradictory touched ownership closes guard only', () => {
  const r = ready();
  delta(r, { updated: { players: [{ id: ALLY, owned: [] }, { id: OTHER, owned: [xy(20)] }] } });
  assert.equal(r.snapshot().ownership, null); assert.equal(r.snapshot().complete, true);
  delta(r, { updated: { players: [{ id: OTHER, owned: [xy(30)] }] } });
  assert.equal(r.snapshot().ownership, null, 'an incomplete later delta cannot reconstruct missing base');
});
test('removed player is forgotten; remove then update re-adds native record', () => {
  const r = ready();
  delta(r, { removed: { playerIds: [ALLY] } });
  assert.equal(player(r, ALLY), undefined);
  delta(r, { removed: { playerIds: [OTHER] }, updated: { players: [{ id: OTHER, owned: [xy(31)] }] } });
  assert.deepEqual(player(r, OTHER).owned, [xy(31)]);
});
test('own capture is coherent with self economy roster; conflicting self claim is unknown', () => {
  const r = ready();
  delta(r, { updated: { players: [{ id: ALLY, owned: [xy(10), xy(20)] }] } });
  assert.deepEqual(player(r, SELF).owned, []); assert.equal(r.snapshot().systems.length, 0);
  const conflicting = ready();
  delta(conflicting, { updated: { players: [{ id: SELF, owned: [] }, { id: ALLY, owned: [xy(10)] }] } });
  assert.equal(conflicting.snapshot().ownership, null);
  assert.equal(conflicting.snapshot().systems.length, 1);
});
test('nonempty or malformed dirty-sector data invalidates ownership until next init', () => {
  for (const dirty of [[{ sq: 1, sr: 2 }], null, 'invalid']) {
    const r = ready(); delta(r, { updated: { dirtySectors: dirty } });
    assert.equal(r.snapshot().ownership, null); assert.equal(r.snapshot().complete, true);
    delta(r, {}); assert.equal(r.snapshot().ownership, null);
    r.ingest(frame('world.init', initial())); assert.ok(r.snapshot().ownership);
  }
  const r = ready(); delta(r, { updated: { dirtySectors: [] } }); assert.ok(r.snapshot().ownership);
});
test('bad public names, duplicate coordinate claims and incomplete initial peers do not corrupt own economy', () => {
  for (const edit of [p => p.world.players[1].name = {}, p => delete p.world.players[1].owned,
    p => p.world.players[1].owned.push(xy(30)), p => p.world.players[1].owned.push(xy(20)),
    p => p.world.players[1].owned[0].q = 0.5]) {
    const p = initial(); edit(p); const s = ready(p).snapshot();
    assert.equal(s.ownership, null); assert.equal(s.complete, true);
  }
});
test('disconnect, malformed frame, session loss and new connection forget all owner claims', () => {
  for (const act of [r => r.loseConnection(r.snapshot().generation), r => r.ingest('42["world.delta",{'),
    r => r.ingest('41'), r => r.beginConnection(), r => delta(r, { removed: { playerIds: [SELF] } })]) {
    const r = ready(); act(r); const s = r.snapshot();
    assert.equal(s.ownership, null); assert.equal(s.connected, false);
    assert.doesNotMatch(JSON.stringify(s), /Public ally/);
  }
});
test('reconnect replaces rather than merges owner identities and coordinates', () => {
  const r = ready(), old = r.snapshot().generation, p = initial();
  p.world.players = p.world.players.slice(0, 1);
  r.beginConnection(); r.ingest(frame('world.init', p), old);
  assert.equal(r.snapshot().ownership, null);
  r.ingest(frame('world.init', p));
  assert.deepEqual(players(r).map(p => p.id), [SELF]);
});
test('ownership snapshot copies cannot alter reducer data', () => {
  const r = ready(), s = r.snapshot();
  s.ownership.players[1].owned[0].q = 999; s.ownership.players[1].name = 'changed';
  assert.equal(player(r, ALLY).name, 'Public ally'); assert.equal(player(r, ALLY).owned[0].q, 20);
});
test('bridge validator accepts allowlist, strips extras and treats old absent claims as unknown', () => {
  const s = ready().snapshot();
  s.ownership.players[1].transits = [{ secret: 'secret' }];
  s.ownership.players[1].owned[0].fleet = 'secret'; s.ownership.secret = 'secret';
  const checked = O.validateSnapshot(s);
  assert.ok(checked); assert.equal(checked.complete, true);
  assert.doesNotMatch(JSON.stringify(checked.ownership), /secret|fleet|transits/);
  delete s.ownership;
  assert.equal(O.validateSnapshot(s).ownership, null); assert.equal(O.validateSnapshot(s).complete, true);
});
test('bridge validator rejects unsafe ownership while preserving otherwise valid economy', () => {
  for (const edit of [s => s.ownership.version = 2, s => s.ownership.complete = true,
    s => s.ownership.players[0].owned = [], s => s.ownership.players.push(copy(s.ownership.players[1])),
    s => s.ownership.players[1].owned.push(xy(30)), s => s.ownership.players[1].id = 'not-an-id',
    s => s.ownership.players[1].name = {}, s => s.ownership = []]) {
    const s = ready().snapshot(); edit(s); const checked = O.validateSnapshot(s);
    assert.ok(checked); assert.equal(checked.ownership, null); assert.equal(checked.complete, true);
  }
  const s = ready().snapshot(); s.connected = false; s.complete = false; s.reason = 'connection-lost';
  assert.equal(O.validateSnapshot(s).ownership, null);
});
test('ownership safety limits apply to the aggregate and do not leak a partially projected census', () => {
  const p = initial(); p.world.players[1].owned = Array.from({ length: O.LIMITS.systems }, (_, i) => ({ q: 100 + i, r: 0 }));
  const s = ready(p).snapshot(); assert.equal(s.ownership, null); assert.equal(s.complete, true);
});
test('dirty-sector ownership invalidation reaches bridge before native callbacks or queued timers', () => {
  const tasks = new Map(), messages = [], pending = []; let seq = 0;
  class FakeSocket {
    constructor() { this.listeners = new Map(); }
    addEventListener(kind, fn) { this.listeners.set(kind, fn); }
    removeEventListener(kind) { this.listeners.delete(kind); }
    emit(data) { this.listeners.get('message')?.({ data, isTrusted: true }); this.onmessage?.(); }
  }
  const sandbox = { URL, Proxy, Reflect, Date,
    setTimeout(fn) { const key = ++seq; tasks.set(key, fn); return key; }, clearTimeout(key) { tasks.delete(key); },
    location: { origin: 'https://oldlight.io', pathname: '/game/galaxy/alpha' }, WebSocket: FakeSocket };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../docs/empire-observer.js'), 'utf8'), sandbox);
  sandbox.OldLightEmpireObserver.installPageObserver({ channel: 'ally_test', emit: p => messages.push(copy(p.snapshot)),
    onPending: p => pending.push([p.generation, p.epoch, p.revision, p.connected, p.observedAt]) });
  const socket = new sandbox.WebSocket('wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket');
  socket.emit(frame('world.init', initial()));
  for (const [key, fn] of [...tasks]) { tasks.delete(key); fn(); }
  assert.ok(messages.at(-1).ownership);
  socket.onmessage = () => {
    assert.equal(messages.at(-1).revision, 0, 'normal publication still waits for native processing');
    assert.equal(pending.at(-1)[2], 1, 'pending marker precedes the native callback and deferred delivery');
  };
  socket.emit(frame('world.delta', { updated: { players: [{ id: ALLY, name: 'Ally renamed', owned: [] }] } }));
  for (const [key, fn] of [...tasks]) { tasks.delete(key); fn(); }
  assert.equal(messages.at(-1).revision, 1);
  socket.onmessage = () => {
    assert.equal(messages.at(-1).ownership, null);
    assert.equal(messages.at(-1).complete, true);
  };
  socket.emit(frame('world.delta', { updated: { dirtySectors: [{ sq: 1, sr: 2 }] } }));
  assert.equal(tasks.size, 0);
});
