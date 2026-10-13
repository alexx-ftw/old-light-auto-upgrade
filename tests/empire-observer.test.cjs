'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const O = require('../docs/empire-observer.js');
const source = fs.readFileSync(require.resolve('../docs/empire-observer.js'), 'utf8');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SELF = uuid(1), OTHER = uuid(2), NOW = 1791930000000;
const iso = n => new Date(NOW + n).toISOString();
const frame = (event, payload) => '42' + JSON.stringify([event, payload]);
const copy = x => JSON.parse(JSON.stringify(x));
function system(n = 10) {
  return { id: uuid(n), q: n, r: -n, name: `System ${n}`, capturedAt: NOW - 100000, score: 10,
    buildings: O.SHIPS.length ? [{ type: 'shipyard', level: 1, nextUpgrade: { paCost: 100, irCost: 50, timeMs: 5000, energyDelta: -2 },
      unlockRequirement: { type: 'command_center', level: 1, met: true } }] : [],
    fleet: [{ type: 'marauder', quantity: n }], garrisonCap: 1000,
    economy: { resources: { palladium: 123, iridium: 456, settledAt: iso(-1000) },
      paCap: 1000, irCap: 2000, paRatePerMin: 5, irRatePerMin: 2, energyCap: 10, energyUsed: 7,
      deficitMultiplier: 1, queueSlots: 3,
      queue: [{ id: uuid(100 + n), type: 'warehouse', targetLevel: 2, startedAt: iso(-1000), completesAt: iso(5000) }],
      wealth: { active: false, unlocked: false } },
    shipyard: { queueSlots: 3, types: [{ type: 'marauder', unlocked: true, shipyardLevelRequired: 1,
      stats: { paCost: 5, irCost: 2, buildTimeSec: 30, scrapTimeSec: 15, lyPerHour: 100, upkeepPerDay: 1 } }],
      queue: [{ id: uuid(200 + n), type: 'marauder', kind: 'recruit', quantityTotal: 4, quantityRemaining: 3,
        startedAt: iso(-1000), nextCompletesAt: iso(29000) },
      { id: uuid(300 + n), type: 'sentinel', kind: 'scrap', quantityTotal: 1, quantityRemaining: 1,
        startedAt: iso(30000), nextCompletesAt: iso(45000), heldReason: 'garrison' }] } };
}
function transit(n = 500, quantity = 3) {
  return { id: uuid(n), fromQ: 10, fromR: -10, toQ: 11, toR: -11,
    ships: [{ type: 'marauder', quantity }], arrivesAt: iso(60000), recalledAt: null, phase: 'outbound', kind: 'combat' };
}
function player(id = SELF, owned = [system()]) {
  return { id, owned, transits: [transit()], credits: { amount: 100, settledAt: iso(-1000), incomePerDay: 50, upkeepPerDay: 10, inDeficit: false } };
}
function init(self = player(), serverNow = NOW) {
  return { selfId: self.id, serverNow, config: { version: 'v1' }, world: { players: [self, player(OTHER, [system(20)])] } };
}
function ready(value = init()) {
  let time = NOW; const reducer = O.createReducer({ galaxy: 'alpha', now: () => time });
  const token = reducer.beginConnection(); reducer.ingest(frame('world.init', value), token);
  return { reducer, token, advance: () => { time += 1000; } };
}

test('world.init returns complete sanitized roster, native resource anchors and all own transits', () => {
  const { reducer } = ready(init(player(SELF, [system(10), system(11)])));
  const s = reducer.snapshot();
  assert.equal(s.complete, true); assert.equal(s.scope, `alpha/${SELF}`);
  assert.equal(s.systems.length, 2); assert.equal(s.transitShips.marauder, 3);
  assert.equal(s.systems[0].economy.resources.palladium, 123);
  assert.equal(s.systems[0].shipyard.queue[1].kind, 'scrap');
  assert.equal(s.serverNow, NOW); assert.equal(s.epoch, 1); assert.equal(s.revision, 0);
});
test('unknown frames including action tokens and chat are ignored before parsing their payload', () => {
  for (const text of ['42["session.token",{"token":"SENSITIVE"}]', '42["chat",not-json]', '0{"sid":"SENSITIVE"}', '40{"sid":"SENSITIVE"}', '2', '3']) {
    assert.deepEqual(O.parseFrame(text), { kind: 'ignore' });
  }
});
test('projection drops all other player data and extraneous self/system/config properties', () => {
  const input = init(); input.token = 'ROOT_SECRET'; input.world.players[0].email = 'SELF_SECRET';
  input.world.players[0].owned[0].token = 'SYSTEM_SECRET'; input.world.players[1].name = 'OTHER_SECRET';
  input.config.token = 'CONFIG_SECRET'; input.world.players[0].transits[0].token = 'TRANSIT_SECRET';
  const serialized = JSON.stringify(O.parseFrame(frame('world.init', input)));
  assert.equal(/SECRET|token|email/.test(serialized), false);
  assert.equal(serialized.includes(OTHER), false);
});
test('native delta retains omitted transits/credits and empty owned list', () => {
  const { reducer, token, advance } = ready(); advance();
  reducer.ingest(frame('world.delta', { updated: { players: [{ id: SELF, owned: [] }] } }), token);
  const s = reducer.snapshot();
  assert.equal(s.complete, true); assert.equal(s.systems.length, 1); assert.equal(s.transitShips.marauder, 3);
  assert.equal(s.credits.amount, 100); assert.equal(s.revision, 1); assert.equal(s.observedAt, NOW + 1000);
});
test('present empty transit array clears fleet in flight', () => {
  const { reducer } = ready();
  reducer.ingest(frame('world.delta', { updated: { players: [{ id: SELF, owned: [], transits: [] }] } }));
  assert.equal(reducer.snapshot().transitShips.marauder, 0); assert.equal(reducer.snapshot().transits.length, 0);
});
test('nonempty own roster replaces it rather than appending systems', () => {
  const { reducer } = ready();
  reducer.ingest(frame('world.delta', { updated: { players: [{ id: SELF, owned: [system(11)] }] } }));
  assert.deepEqual(reducer.snapshot().systems.map(s => s.id), [uuid(11)]);
});
test('capture by another updated player removes coordinate from nonupdated self roster', () => {
  const { reducer } = ready(init(player(SELF, [system(10), system(11)])));
  reducer.ingest(frame('world.delta', { updated: { players: [{ id: OTHER, owned: [{ q: 10, r: -10, name: 'discard me' }] }] } }));
  assert.deepEqual(reducer.snapshot().systems.map(s => s.id), [uuid(11)]);
});
test('native reducer does not prune self when self is also explicitly updated', () => {
  const { reducer } = ready();
  reducer.ingest(frame('world.delta', { updated: { players: [{ id: OTHER, owned: [{ q: 10, r: -10 }] }, { id: SELF, owned: [] }] } }));
  assert.equal(reducer.snapshot().systems.length, 1);
});
test('added rival coordinates prune self, existing added self is ignored', () => {
  const { reducer } = ready(init(player(SELF, [system(10), system(11)])));
  reducer.ingest(frame('world.delta', { added: { players: [{ id: OTHER, owned: [{ q: 10, r: -10 }] }] } }));
  assert.deepEqual(reducer.snapshot().systems.map(x => x.id), [uuid(11)]);
  reducer.ingest(frame('world.delta', { added: { players: [{ id: SELF, owned: [system(12)], transits: [] }] } }));
  assert.deepEqual(reducer.snapshot().systems.map(x => x.id), [uuid(11)]);
  assert.equal(reducer.snapshot().transitShips.marauder, 3);
});
test('removed self and eliminated self both close the complete gate', () => {
  const a = ready().reducer; a.ingest(frame('world.delta', { removed: { playerIds: [SELF] } }));
  assert.equal(a.snapshot().complete, false); assert.equal(a.snapshot().selfId, '');
  const b = ready().reducer; b.ingest(frame('world.delta', { updated: { players: [{ id: SELF, owned: [], eliminatedAt: iso(1) }] } }));
  assert.equal(b.snapshot().complete, false); assert.equal(b.snapshot().reason, 'eliminated');
});
test('new connection cannot consume previous generations or delta before fresh init', () => {
  const { reducer, token } = ready(); const next = reducer.beginConnection();
  assert.equal(reducer.ingest(frame('world.init', init()), token), false);
  assert.equal(reducer.snapshot().complete, false);
  reducer.ingest(frame('world.delta', {}), next); assert.equal(reducer.snapshot().complete, false);
  reducer.ingest(frame('world.init', init()), next); assert.equal(reducer.snapshot().complete, true);
  assert.equal(reducer.snapshot().epoch, 2);
});
test('reconnect self ID shift clears all prior player data', () => {
  const { reducer } = ready(); const next = reducer.beginConnection();
  const other = player(uuid(3), [system(30)]); other.transits = [];
  reducer.ingest(frame('world.init', init(other, NOW + 1000)), next);
  assert.equal(reducer.snapshot().selfId, uuid(3)); assert.deepEqual(reducer.snapshot().systems.map(s => s.id), [uuid(30)]);
  assert.equal(reducer.snapshot().transitShips.marauder, 0);
});
test('same-connection older init fails closed and does not reset the high-water mark', () => {
  const { reducer } = ready();
  reducer.ingest(frame('world.init', init(player(), NOW - 1))); assert.equal(reducer.snapshot().complete, false);
  reducer.ingest(frame('world.init', init(player(), NOW - 2))); assert.equal(reducer.snapshot().complete, false);
  reducer.ingest(frame('world.init', init(player(), NOW + 1))); assert.equal(reducer.snapshot().complete, true);
});
test('session displaced, socket disconnect and connect error invalidate without retaining body', () => {
  for (const text of ['42["session.displaced",{"token":"secret"}]', '41', '1', '44{"message":"invalid token SECRET"}']) {
    const { reducer } = ready(); reducer.ingest(text);
    const s = reducer.snapshot(); assert.equal(s.connected, false); assert.equal(s.complete, false); assert.equal(JSON.stringify(s).includes('SECRET'), false);
  }
});
test('duplicate identical transit IDs are counted once; conflicting duplicates invalidate', () => {
  const p = player(); p.transits.push(copy(p.transits[0]));
  assert.equal(ready(init(p)).reducer.snapshot().transitShips.marauder, 3);
  p.transits[1].ships[0].quantity++;
  assert.equal(ready(init(p)).reducer.snapshot().complete, false);
});
test('transit count overflow is incomplete and never silently wraps', () => {
  const p = player(); p.transits = [transit(500, Number.MAX_SAFE_INTEGER), transit(501, 1), transit(502, 1)];
  const s = ready(init(p)).reducer.snapshot(); assert.equal(s.complete, false); assert.equal(s.transitShips.marauder, null);
});
test('missing full economy/fleet/transits/shipyard data cannot become complete', () => {
  for (const alter of [p => delete p.owned[0].economy, p => delete p.owned[0].fleet, p => delete p.transits,
    p => delete p.owned[0].shipyard, p => { delete p.owned[0].shipyard; p.owned[0].buildings = []; }]) {
    const p = player(); alter(p); assert.equal(ready(init(p)).reducer.snapshot().complete, false);
  }
});
test('explicit level-zero locked shipyard can have no shipyard object', () => {
  const p = player(); delete p.owned[0].shipyard; p.owned[0].buildings[0].level = 0;
  assert.equal(ready(init(p)).reducer.snapshot().complete, true);
});
test('duplicate system IDs/coordinates, malformed quantities and unsupported ship type fail closed', () => {
  const cases = [p => p.owned.push(copy(p.owned[0])), p => { const x = system(11); x.q=10; x.r=-10; p.owned.push(x); },
    p => p.owned[0].fleet[0].quantity = -1, p => p.owned[0].fleet[0].type = 'mystery',
    p => p.owned[0].shipyard.queue[0].quantityRemaining = 100,
    p => p.owned[0].economy.resources.settledAt = 'invalid'];
  for (const alter of cases) { const p = player(); alter(p); assert.equal(ready(init(p)).reducer.snapshot().complete, false); }
});
test('malformed, oversized, overdeep and binary event envelopes fail closed', () => {
  for (const text of ['42["world.init",{}]', '42["world.delta",{}', '45anything', '46anything',
    '42["world.init",'+ '['.repeat(40)+'0'+']'.repeat(40)+']', 'x'.repeat(O.LIMITS.frame+1)]) assert.equal(O.parseFrame(text).kind, 'invalid');
  assert.equal(O.parseFrame(new Uint8Array([1])).kind, 'invalid');
});
test('too many systems/players fail closed before projection', () => {
  const input = init(); input.world.players = Array(O.LIMITS.players + 1).fill({ id: SELF });
  assert.equal(O.parseFrame(frame('world.init', input)).kind, 'invalid');
  const p = player(); p.owned = Array(O.LIMITS.systems + 1).fill(system());
  assert.equal(O.parseFrame(frame('world.init', init(p))).kind, 'invalid');
});
test('get snapshot returns copies; caller edits cannot modify reducer state', () => {
  const { reducer } = ready(); const s = reducer.snapshot(); s.systems[0].fleet[0].quantity = 999;
  assert.equal(reducer.snapshot().systems[0].fleet[0].quantity, 10);
});
test('ordinary Socket.IO event packet ACK ID is permitted without sending an ACK', () => {
  const text = frame('world.init', init()).replace(/^42/, '42123');
  assert.equal(O.parseFrame(text).kind, 'init');
});
test('strict bridge validator accepts valid DTO and drops arbitrary extras', () => {
  const s = ready().reducer.snapshot(); s.token = 'SECRET'; s.systems[0].token = 'SECRET';
  const validated = O.validateSnapshot(JSON.stringify(s));
  assert.ok(validated); assert.equal(validated.complete, true); assert.equal(JSON.stringify(validated).includes('SECRET'), false);
});
test('bridge validator rejects forged totals/scope, missing data and unsupported version', () => {
  for (const alter of [s => s.transitShips.marauder++, s => s.scope = `beta/${SELF}`, s => s.version = 2,
    s => s.systems[0].fleet = null, s => s.systems[0].economy = null, s => s.generation = 0,
    s => s.observedAt = -1, s => s.connected = false]) {
    const s = ready().reducer.snapshot(); alter(s); assert.equal(O.validateSnapshot(JSON.stringify(s)), null);
  }
});
test('bridge validator never invokes object accessors or toJSON', () => {
  let ran = false; const s = ready().reducer.snapshot();
  Object.defineProperty(s, 'systems', { enumerable:true, get() { ran=true; throw Error('getter'); } });
  assert.equal(O.validateSnapshot(s), null); assert.equal(ran, false);
  const b = ready().reducer.snapshot(); b.toJSON = () => { ran=true; return {}; };
  assert.equal(O.validateSnapshot(b), null); assert.equal(ran, false);
});
test('bridge validator permits safely incomplete and disconnected observer status', () => {
  const { reducer } = ready(); reducer.loseConnection(reducer.snapshot().generation);
  const s=O.validateSnapshot(JSON.stringify(reducer.snapshot())); assert.ok(s); assert.equal(s.complete,false);
  const p=player();delete p.owned[0].fleet;
  assert.ok(O.validateSnapshot(JSON.stringify(ready(init(p)).reducer.snapshot())));
});
test('only exact credential-free native secure Socket.IO path is observed', () => {
  assert.equal(O.isGameSocket('wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket'), true);
  for (const url of ['ws://api.oldlight.io/socket.io/?EIO=4&transport=websocket', 'wss://evil.example/socket.io/?EIO=4&transport=websocket',
    'wss://api.oldlight.io.evil.example/socket.io/?EIO=4&transport=websocket', 'wss://api.oldlight.io/other?EIO=4&transport=websocket',
    'wss://api.oldlight.io/socket.io/?EIO=4&transport=polling', 'wss://x:y@api.oldlight.io/socket.io/?EIO=4&transport=websocket',
    'wss://api.oldlight.io:8443/socket.io/?EIO=4&transport=websocket']) assert.equal(O.isGameSocket(url), false);
});
function browser() {
  const sockets=[], sent=[], messages=[], timers=new Map(); let timerId=0;
  const flush=()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}};
  class NativeWebSocket {
    static CONNECTING=0; static OPEN=1; static CLOSED=3;
    constructor(url, protocols) { this.url=url;this.protocols=protocols;this.listeners=new Map();this.closed=0;sockets.push(this); }
    addEventListener(type, fn) { if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    dispatch(type, data, trusted=true) { const event={data,isTrusted:trusted};for(const fn of [...this.listeners.get(type)||[]])fn(event);this['on'+type]?.(event);flush(); }
    send(data) { sent.push(data); }
    close() { this.closed++; }
  }
  const sandbox = { URL, Proxy, Reflect, Date, setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id), location:{origin:'https://oldlight.io',pathname:'/game/galaxy/alpha'}, WebSocket:NativeWebSocket };
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  const api=sandbox.OldLightEmpireObserver;
  const control=api.installPageObserver({channel:'empire_test',emit: x=>messages.push(JSON.parse(JSON.stringify(x)))});
  return {sandbox,api,control,NativeWebSocket,sockets,sent,messages};
}
const SOCKET='wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket';
test('installation creates no socket and preserves native constructor prototype/static surface', () => {
  const b=browser(); assert.equal(b.sockets.length,0);assert.equal(b.sent.length,0);
  assert.equal(b.sandbox.WebSocket.prototype,b.NativeWebSocket.prototype);assert.equal(b.sandbox.WebSocket.OPEN,b.NativeWebSocket.OPEN);
  const socket=new b.sandbox.WebSocket(SOCKET,['some-protocol']);
  assert.ok(socket instanceof b.NativeWebSocket);assert.ok(socket instanceof b.sandbox.WebSocket);assert.deepEqual(socket.protocols,['some-protocol']);
  assert.throws(()=>b.sandbox.WebSocket(SOCKET),TypeError);
});
test('native subclass construction stays subclassed', () => {
  const b=browser();class Child extends b.sandbox.WebSocket { own=true; }
  const s=new Child(SOCKET);assert.ok(s instanceof Child);assert.equal(s.own,true);assert.equal(s.constructor,Child);
});
test('observer watches inbound only and does not override native onmessage or send', () => {
  const b=browser(), s=new b.sandbox.WebSocket(SOCKET);let received=0;s.onmessage=()=>received++;
  const send=s.send;s.send('AUTH_DO_NOT_READ'); assert.equal(s.send,send);assert.equal(b.sent.length,1);
  s.dispatch('message',frame('world.init',init()));
  assert.equal(received,1);assert.equal(b.messages.at(-1).snapshot.complete,true);assert.equal(b.sent.length,1);
  assert.equal(JSON.stringify(b.messages).includes('AUTH_DO_NOT_READ'),false);
});
test('unknown socket routes are never observed and can keep their normal listeners', () => {
  const b=browser(),s=new b.sandbox.WebSocket('wss://example.org/socket');
  assert.equal(s.listeners.size,0);s.dispatch('message',frame('world.init',init()));
  assert.equal(b.messages.at(-1).snapshot.complete,false);
});
test('new native socket detaches old listeners and requires its own init', () => {
  const b=browser(),a=new b.sandbox.WebSocket(SOCKET);a.dispatch('message',frame('world.init',init()));
  const second=new b.sandbox.WebSocket(SOCKET);assert.equal(a.listeners.get('message').size,0);
  assert.equal(b.messages.at(-1).snapshot.complete,false);
  a.dispatch('message',frame('world.init',init()));assert.equal(b.messages.at(-1).snapshot.complete,false);
  second.dispatch('message',frame('world.init',init(player(uuid(3),[system(30)]))));
  assert.equal(b.messages.at(-1).snapshot.selfId,uuid(3));assert.equal(a.closed,0);assert.equal(second.closed,0);
});
test('socket error/close invalidates and removes own listeners without closing or sending', () => {
  for(const type of ['error','close']){
    const b=browser(),s=new b.sandbox.WebSocket(SOCKET);s.dispatch('message',frame('world.init',init()));s.dispatch(type);
    assert.equal(b.messages.at(-1).snapshot.complete,false);assert.equal(s.listeners.get('message').size,0);assert.equal(s.closed,0);assert.equal(b.sent.length,0);
  }
});
test('stop restores only its own wrapper and leaves game connection untouched', () => {
  const b=browser(),s=new b.sandbox.WebSocket(SOCKET);s.dispatch('message',frame('world.init',init()));b.control.stop();
  assert.equal(b.sandbox.WebSocket,b.NativeWebSocket);assert.equal(s.closed,0);assert.equal(s.listeners.get('message').size,0);
  const before=b.messages.length;s.dispatch('message',frame('world.init',init()));assert.equal(b.messages.length,before);
});
test('stop does not overwrite a wrapper installed later by another component', () => {
  const b=browser(),ours=b.sandbox.WebSocket;class Later extends ours {}
  b.sandbox.WebSocket=Later;b.control.stop();assert.equal(b.sandbox.WebSocket,Later);
  const s=new Later(SOCKET);assert.equal(s.listeners.size,0);
});
test('emitter errors do not propagate into native WebSocket construction/messages', () => {
  const b=browser();b.control.stop();
  const control=b.api.installPageObserver({channel:'empire_test',emit:()=>{throw Error('not part of game');}});
  const s=new b.sandbox.WebSocket(SOCKET);assert.doesNotThrow(()=>s.dispatch('message',frame('world.init',init())));
  assert.equal(control.status().emissionError,true);
});

test('synthetic untrusted MessageEvent cannot initialize or advance the census', () => {
  const b=browser(),s=new b.sandbox.WebSocket(SOCKET);
  s.dispatch('message',frame('world.init',init()),false);
  assert.equal(b.messages.at(-1).snapshot.complete,false);
  s.dispatch('message',frame('world.init',init()));const before=b.messages.at(-1).snapshot.revision;
  s.dispatch('message',frame('world.delta',{updated:{players:[{id:SELF,owned:[],transits:[]}]}}),false);
  assert.equal(b.messages.at(-1).snapshot.revision,before);assert.equal(b.messages.at(-1).snapshot.transitShips.marauder,3);
});
test('valid snapshot emission waits until native onmessage handler has run', () => {
  const b=browser(),s=new b.sandbox.WebSocket(SOCKET);let nativeHasRun=false;
  s.onmessage=()=>{assert.equal(b.messages.at(-1).snapshot.complete,false);nativeHasRun=true;};
  s.dispatch('message',frame('world.init',init()));
  assert.equal(nativeHasRun,true);assert.equal(b.messages.at(-1).snapshot.complete,true);
});
test('duplicate transport/scheme query parameters are not a matching native route', () => {
  assert.equal(O.isGameSocket(SOCKET+'&transport=polling'),false);
  assert.equal(O.isGameSocket(SOCKET+'&EIO=3'),false);
});
