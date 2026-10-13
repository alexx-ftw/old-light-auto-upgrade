/* Source-backed passive Old Light observer. No game connection or action API.
 * Evidence: galaxy-CqK10P8m.js, release 526e1feaf0acb4d2fcc1648f1c61eb81a26f0884.
 * Must run in the page realm before that module caches window.WebSocket.
 * Keep the privileged Helper and all GM/Drive storage in the content realm.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else Object.defineProperty(root, 'OldLightEmpireObserver', { configurable: true, value: api });
})(typeof globalThis === 'object' ? globalThis : this, function (realm) {
  'use strict';
  const VERSION = 1;
  const LIMITS = Object.freeze({ frame: 8 * 1024 * 1024, depth: 32, nodes: 250000,
    players: 10000, systems: 10000, transits: 20000, queue: 128, string: 1024 });
  const SHIPS = Object.freeze(['probe', 'marauder', 'sentinel', 'vanguard']);
  const BUILDINGS = Object.freeze(['command_center', 'reactor', 'palladium_extractor',
    'iridium_extractor', 'warehouse', 'shipyard', 'trade_hub']);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const GALAXY = /^[A-Za-z0-9_-]{1,64}$/;
  const own = (x, key) => Object.prototype.hasOwnProperty.call(x, key);
  const fail = () => { throw new Error('Unsupported game data'); };
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const record = x => object(x) ? x : fail();
  const array = (x, max) => Array.isArray(x) && x.length <= max ? x : fail();
  const num = (x, signed = false) => typeof x === 'number' && Number.isFinite(x)
    && Math.abs(x) <= Number.MAX_SAFE_INTEGER && (signed || x >= 0) ? x : fail();
  const int = x => Number.isSafeInteger(x) && x >= 0 ? x : fail();
  const coord = x => Number.isSafeInteger(x) && Math.abs(x) <= 10000000 ? x : fail();
  const id = x => typeof x === 'string' && UUID.test(x) ? x.toLowerCase() : fail();
  const word = (x, values) => values.includes(x) ? x : fail();
  const bool = x => typeof x === 'boolean' ? x : fail();
  const stamp = x => typeof x === 'string' && x.length <= 64 && Number.isFinite(Date.parse(x))
    && Date.parse(x) >= 0 ? x : fail();
  const name = x => typeof x === 'string' && x.length <= LIMITS.string
    ? x.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) : fail();
  const clone = x => JSON.parse(JSON.stringify(x));
  function optional(out, source, key, convert) {
    if (source[key] !== undefined) out[key] = convert(source[key]);
  }
  function unique(values, key) {
    const seen = new Set();
    for (const value of values) { const k = key(value); if (seen.has(k)) fail(); seen.add(k); }
    return values;
  }
  function ships(value) {
    return unique(array(value, SHIPS.length).map(x => {
      record(x); return { type: word(x.type, SHIPS), quantity: int(x.quantity) };
    }), x => x.type);
  }
  function building(value) {
    const x = record(value), out = { type: word(x.type, BUILDINGS), level: int(x.level) };
    if (x.nextUpgrade === null) out.nextUpgrade = null;
    else if (x.nextUpgrade !== undefined) {
      const u = record(x.nextUpgrade);
      out.nextUpgrade = { paCost: num(u.paCost), irCost: num(u.irCost), timeMs: num(u.timeMs), energyDelta: num(u.energyDelta, true) };
    }
    if (x.unlockRequirement !== undefined && x.unlockRequirement !== null) {
      const u = record(x.unlockRequirement);
      out.unlockRequirement = { type: word(u.type, BUILDINGS), level: int(u.level), met: bool(u.met) };
    }
    return out;
  }
  function buildJob(value) {
    const x = record(value);
    return { id: id(x.id), type: word(x.type, BUILDINGS), targetLevel: int(x.targetLevel),
      startedAt: stamp(x.startedAt), completesAt: stamp(x.completesAt) };
  }
  function shipJob(value) {
    const x = record(value), out = { id: id(x.id), type: word(x.type, SHIPS),
      kind: word(x.kind, ['recruit', 'scrap']), quantityTotal: int(x.quantityTotal),
      quantityRemaining: int(x.quantityRemaining), startedAt: stamp(x.startedAt), nextCompletesAt: stamp(x.nextCompletesAt) };
    if (out.quantityRemaining > out.quantityTotal) fail();
    optional(out, x, 'heldReason', name);
    return out;
  }
  function economy(value) {
    if (value === undefined || value === null) return null;
    const x = record(value), r = record(x.resources);
    const out = { resources: { palladium: num(r.palladium), iridium: num(r.iridium), settledAt: stamp(r.settledAt) },
      paCap: num(x.paCap), irCap: num(x.irCap), paRatePerMin: num(x.paRatePerMin, true),
      irRatePerMin: num(x.irRatePerMin, true), energyCap: num(x.energyCap), energyUsed: num(x.energyUsed),
      deficitMultiplier: num(x.deficitMultiplier), queueSlots: int(x.queueSlots),
      queue: unique(array(x.queue, LIMITS.queue).map(buildJob), j => j.id) };
    if (x.wealth !== undefined && x.wealth !== null) {
      const w = record(x.wealth); out.wealth = { active: bool(w.active), unlocked: bool(w.unlocked) };
    }
    return out;
  }
  function shipyard(value) {
    if (value === undefined || value === null) return null;
    const x = record(value);
    const types = unique(array(x.types, SHIPS.length).map(t => {
      record(t); const s = record(t.stats), stats = {};
      for (const key of ['paCost', 'irCost', 'buildTimeSec', 'scrapTimeSec', 'lyPerHour', 'upkeepPerDay']) optional(stats, s, key, num);
      return { type: word(t.type, SHIPS), unlocked: bool(t.unlocked), shipyardLevelRequired: int(t.shipyardLevelRequired), stats };
    }), t => t.type);
    return { queueSlots: int(x.queueSlots), types, queue: unique(array(x.queue, LIMITS.queue).map(shipJob), j => j.id) };
  }
  function system(value) {
    const x = record(value), out = { id: id(x.id), q: coord(x.q), r: coord(x.r), name: name(x.name),
      buildings: unique(array(x.buildings, BUILDINGS.length).map(building), b => b.type),
      fleet: x.fleet == null ? null : ships(x.fleet), economy: economy(x.economy), shipyard: shipyard(x.shipyard) };
    optional(out, x, 'capturedAt', int); optional(out, x, 'score', num); optional(out, x, 'garrisonCap', int);
    return out;
  }
  function systems(value) {
    const list = unique(array(value, LIMITS.systems).map(system), s => s.id);
    return unique(list, s => `${s.q},${s.r}`);
  }
  function transit(value) {
    const x = record(value), out = { id: id(x.id),
      fromQ: x.fromQ === null ? null : coord(x.fromQ), fromR: x.fromR === null ? null : coord(x.fromR),
      toQ: coord(x.toQ), toR: coord(x.toR), ships: ships(x.ships), arrivesAt: stamp(x.arrivesAt),
      recalledAt: x.recalledAt === null ? null : stamp(x.recalledAt) };
    if ((out.fromQ === null) !== (out.fromR === null)) fail();
    // Only these fields are needed for identity/counts. Phase strings are bounded;
    // the native renderer distinguishes returning from all other phase values.
    optional(out, x, 'phase', name);
    optional(out, x, 'kind', v => word(v, ['combat', 'trade', 'deal']));
    optional(out, x, 'departsAt', stamp);
    return out;
  }
  function transits(value) {
    const out = [], byId = new Map();
    for (const raw of array(value, LIMITS.transits)) {
      const t = transit(raw), old = byId.get(t.id);
      if (old) { if (JSON.stringify(old) !== JSON.stringify(t)) fail(); continue; }
      byId.set(t.id, t); out.push(t);
    }
    return out;
  }
  function credits(value) {
    if (value === undefined || value === null) return null;
    const x = record(value); return { amount: num(x.amount, true), settledAt: stamp(x.settledAt),
      incomePerDay: num(x.incomePerDay), upkeepPerDay: num(x.upkeepPerDay), inDeficit: bool(x.inDeficit) };
  }
  function selfPlayer(value, initial) {
    const x = record(value), out = { id: id(x.id), owned: systems(x.owned) };
    // Absence is deliberately distinct from an empty array in the native reducer.
    if (initial || x.transits !== undefined) out.transits = x.transits === undefined ? null : transits(x.transits);
    if (initial || x.credits !== undefined) out.credits = credits(x.credits);
    if (x.eliminatedAt !== undefined) out.eliminatedAt = x.eliminatedAt === null ? null : stamp(x.eliminatedAt);
    return out;
  }
  function boundedJson(text) {
    let depth = 0, nodes = 0, quoted = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
      if (c === '"') { quoted = true; if (++nodes > LIMITS.nodes) fail(); }
      else if (c === '[' || c === '{') { if (++depth > LIMITS.depth || ++nodes > LIMITS.nodes) fail(); }
      else if (c === ']' || c === '}') { if (--depth < 0) fail(); }
      else if (c === ',' && ++nodes > LIMITS.nodes) fail();
    }
    if (quoted || depth !== 0) fail();
    return JSON.parse(text);
  }
  function projectInit(payload) {
    const p = record(payload), selfId = id(p.selfId), world = record(p.world);
    const list = array(world.players, LIMITS.players), seen = new Set();
    let self = null;
    for (const raw of list) {
      const player = record(raw), key = id(player.id); if (seen.has(key)) fail(); seen.add(key);
      if (key === selfId) self = selfPlayer(player, true);
    }
    if (!self) fail();
    const configVersion = p.config && ['string', 'number'].includes(typeof p.config.version)
      ? String(p.config.version).slice(0, 100) : '';
    return { kind: 'init', selfId, self, serverNow: int(p.serverNow), configVersion };
  }
  function projectDelta(payload, selfId) {
    if (!selfId || !UUID.test(selfId)) fail();
    const p = record(payload), out = { kind: 'delta', removedSelf: false, selfUpdate: null, selfAdded: null, claims: [] };
    if (p.removed !== undefined) {
      const removed = record(p.removed);
      if (removed.playerIds !== undefined) out.removedSelf = array(removed.playerIds, LIMITS.players).some(x => id(x) === selfId);
    }
    const seen = new Set(), claimKeys = new Set();
    for (const group of ['updated', 'added']) {
      if (p[group] === undefined) continue;
      const data = record(p[group]); if (data.players === undefined) continue;
      for (const raw of array(data.players, LIMITS.players)) {
        const player = record(raw), key = id(player.id), seenKey = `${group}:${key}`;
        if (seen.has(seenKey)) fail(); seen.add(seenKey);
        if (key === selfId) {
          const field = group === 'updated' ? 'selfUpdate' : 'selfAdded'; out[field] = selfPlayer(player, false);
        } else {
          // Only coordinates of other owners' new claims affect self ownership.
          for (const item of array(player.owned, LIMITS.systems)) {
            record(item); const q = coord(item.q), r = coord(item.r), k = `${q},${r}`;
            if (!claimKeys.has(k)) { claimKeys.add(k); out.claims.push({ q, r }); }
            if (out.claims.length > LIMITS.systems) fail();
          }
        }
      }
    }
    return out;
  }
  /** Returns a sanitized event, {kind:'ignore'}, or {kind:'invalid'}; never raw payloads. */
  function parseFrame(data, selfId = '') {
    if (typeof data !== 'string') return { kind: 'invalid' };
    if (data.length > LIMITS.frame) return { kind: 'invalid' };
    if (data === '1' || data === '41' || data.startsWith('44')) return { kind: 'lost' };
    // Binary Socket.IO event envelopes cannot be reconstructed by this observer.
    if (data.startsWith('45') || data.startsWith('46')) return { kind: 'invalid' };
    if (!data.startsWith('42')) return { kind: 'ignore' };
    const packet = /^42(?:[0-9]{1,12})?(\[.*)$/s.exec(data);
    if (!packet) return { kind: 'invalid' };
    const payloadText = packet[1];
    // Discard session.token/chat/etc before JSON parsing or retaining their bodies.
    const event = /^\[\s*"(world\.init|world\.delta|session\.displaced)"\s*[,\]]/.exec(payloadText)?.[1];
    if (!event) return { kind: 'ignore' };
    if (event === 'session.displaced') return { kind: 'lost' };
    try {
      const value = boundedJson(payloadText);
      if (!Array.isArray(value) || value.length !== 2 || value[0] !== event) fail();
      return event === 'world.init' ? projectInit(value[1]) : projectDelta(value[1], selfId);
    } catch { return { kind: 'invalid' }; }
  }
  function createReducer({ galaxy, now = Date.now } = {}) {
    if (!GALAXY.test(galaxy || '') || typeof now !== 'function') throw new TypeError('Invalid observer scope');
    let generation = 0, epoch = 0, revision = 0, current = null, connected = false, reason = 'awaiting-init';
    let receivedAt = 0, serverNow = null, lastInitServerNow = null, configVersion = '';
    function invalidate(why) { connected = false; current = null; receivedAt = 0; serverNow = null; reason = why; }
    function beginConnection() { generation++; lastInitServerNow = null; invalidate('awaiting-init'); return generation; }
    function loseConnection(token, why = 'connection-lost') {
      if (token !== generation) return false;
      invalidate(['connection-lost', 'stopped', 'malformed', 'session-lost', 'missing-init'].includes(why) ? why : 'connection-lost');
      return true;
    }
    function ingest(data, token = generation) {
      if (token !== generation) return false;
      const event = parseFrame(data, current?.id || '');
      if (event.kind === 'ignore') return false;
      if (event.kind === 'invalid') { invalidate('malformed'); return true; }
      if (event.kind === 'lost') { invalidate('session-lost'); return true; }
      const observedAt = now();
      if (!Number.isSafeInteger(observedAt) || observedAt < 0) { invalidate('malformed'); return true; }
      if (event.kind === 'init') {
        if (lastInitServerNow !== null && event.serverNow < lastInitServerNow) { invalidate('malformed'); return true; }
        epoch++; revision = 0; current = event.self; connected = true; reason = '';
        serverNow = event.serverNow; lastInitServerNow = event.serverNow; configVersion = event.configVersion; receivedAt = observedAt; return true;
      }
      if (!current || !connected) { invalidate('missing-init'); return true; }
      if (event.removedSelf) { invalidate('session-lost'); return true; }
      // Native applyDelta replaces the self record, retaining owned on [], and
      // retaining omitted transits/credits. Added self is ignored when it exists.
      if (event.selfUpdate) {
        const next = event.selfUpdate, old = current;
        current = { ...next, owned: next.owned.length ? next.owned : old.owned,
          transits: own(next, 'transits') ? next.transits : old.transits,
          credits: own(next, 'credits') ? next.credits : old.credits,
          eliminatedAt: own(next, 'eliminatedAt') ? next.eliminatedAt : old.eliminatedAt };
      }
      // Captures prune only players absent from this delta's added/updated sets.
      if (!event.selfUpdate && !event.selfAdded && event.claims.length) {
        const keys = new Set(event.claims.map(x => `${x.q},${x.r}`));
        current = { ...current, owned: current.owned.filter(x => !keys.has(`${x.q},${x.r}`)) };
      }
      revision++; receivedAt = observedAt; return true;
    }
    function snapshot() {
      const out = { version: VERSION, galaxy, selfId: current?.id || '', scope: current ? `${galaxy}/${current.id}` : '',
        epoch, revision, generation, observedAt: receivedAt, serverNow, configVersion, connected,
        complete: false, reason, systems: [], transits: [], transitShips: Object.fromEntries(SHIPS.map(x => [x, 0])), credits: null };
      if (!current) return out;
      out.systems = clone(current.owned); out.transits = clone(current.transits || []); out.credits = clone(current.credits || null);
      let complete = current.owned.length > 0 && Array.isArray(current.transits) && !current.eliminatedAt;
      for (const s of out.systems) {
        const yardLevel = s.buildings.find(x => x.type === 'shipyard')?.level;
        if (!s.economy || !s.fleet || (yardLevel !== 0 && !s.shipyard)) complete = false;
      }
      for (const t of out.transits) for (const ship of t.ships) {
        if (out.transitShips[ship.type] === null) continue;
        const total = out.transitShips[ship.type] + ship.quantity;
        if (!Number.isSafeInteger(total)) { complete = false; out.transitShips[ship.type] = null; }
        else if (out.transitShips[ship.type] !== null) out.transitShips[ship.type] = total;
      }
      out.complete = complete && connected;
      out.reason = current.eliminatedAt ? 'eliminated' : complete ? '' : 'incomplete-data';
      return out;
    }
    return Object.freeze({ beginConnection, loseConnection, ingest, snapshot });
  }
  // Revalidate the unprivileged page-to-content bridge without invoking input
  // accessors, toJSON, iterators, or prototype hooks. JSON text is preferred.
  function plainCopy(value) {
    let nodes = 0, bytes = 0;
    function visit(x, depth) {
      if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail();
      if (x === null || typeof x === 'boolean') return x;
      if (typeof x === 'number') return Number.isFinite(x) ? x : fail();
      if (typeof x === 'string') { bytes += x.length; if (bytes > LIMITS.frame) fail(); return x; }
      if (!object(x) && !Array.isArray(x)) fail();
      const proto = Object.getPrototypeOf(x);
      if (Array.isArray(x) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail();
      const out = Array.isArray(x) ? [] : Object.create(null);
      const keys = Object.keys(x); if (keys.length > LIMITS.nodes) fail();
      for (const key of keys) {
        bytes += key.length; if (bytes > LIMITS.frame) fail();
        const d = Object.getOwnPropertyDescriptor(x, key);
        if (!d || !own(d, 'value')) fail();
        Object.defineProperty(out, key, { value: visit(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      if (Array.isArray(x) && (x.length > LIMITS.nodes || keys.length !== x.length)) fail();
      return out;
    }
    return visit(value, 0);
  }
  function validateSnapshot(input) {
    try {
      if (typeof input === 'string' && input.length > LIMITS.frame) fail();
      const p = record(typeof input === 'string' ? boundedJson(input) : plainCopy(input));
      if (p.version !== VERSION || !GALAXY.test(p.galaxy || '')) fail();
      const connected = bool(p.connected), selfId = p.selfId === '' ? '' : id(p.selfId);
      if (p.scope !== (selfId ? `${p.galaxy}/${selfId}` : '') || (connected && !selfId)) fail();
      const out = { version: VERSION, galaxy: p.galaxy, selfId, scope: p.scope,
        epoch: int(p.epoch), revision: int(p.revision), generation: int(p.generation),
        observedAt: int(p.observedAt), serverNow: p.serverNow === null ? null : int(p.serverNow),
        configVersion: typeof p.configVersion === 'string' && p.configVersion.length <= 100 ? p.configVersion : fail(),
        connected, complete: bool(p.complete), reason: word(p.reason, ['', 'awaiting-init', 'connection-lost',
          'stopped', 'malformed', 'session-lost', 'missing-init', 'eliminated', 'incomplete-data']),
        systems: systems(p.systems), transits: transits(p.transits),
        transitShips: Object.fromEntries(SHIPS.map(type => [type, 0])), credits: credits(p.credits) };
      if (!selfId && (out.systems.length || out.transits.length || out.credits)) fail();
      for (const t of out.transits) for (const ship of t.ships) {
        const n = out.transitShips[ship.type];
        if (n !== null) out.transitShips[ship.type] = Number.isSafeInteger(n + ship.quantity) ? n + ship.quantity : null;
      }
      record(p.transitShips);
      for (const type of SHIPS) if (p.transitShips[type] !== out.transitShips[type]) fail();
      if (out.complete) {
        if (!connected || !selfId || out.epoch < 1 || out.generation < 1 || out.serverNow === null
          || !out.systems.length || out.reason !== '' || Object.values(out.transitShips).some(x => x === null)) fail();
        for (const s of out.systems) {
          const level = s.buildings.find(x => x.type === 'shipyard')?.level;
          if (!s.economy || !s.fleet || (level !== 0 && !s.shipyard)) fail();
        }
      }
      return out;
    } catch { return null; }
  }
  function isGameSocket(value) {
    if (typeof value !== 'string' || value.length > 4096) return false;
    try {
      const u = new URL(value);
      return u.protocol === 'wss:' && u.hostname === 'api.oldlight.io' && !u.port && !u.username && !u.password
        && u.pathname === '/socket.io/' && u.searchParams.getAll('EIO').length === 1 && u.searchParams.getAll('transport').length === 1
        && u.searchParams.get('EIO') === '4' && u.searchParams.get('transport') === 'websocket';
    } catch { return false; }
  }
  /** Page-world only. It never initiates/changes a connection, or accesses send. */
  function installPageObserver({ channel, emit } = {}) {
    if (typeof channel !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(channel) || typeof emit !== 'function') throw new TypeError('Invalid observer channel');
    const location = realm.location;
    const galaxy = location?.origin === 'https://oldlight.io'
      ? /^\/game\/galaxy\/([A-Za-z0-9_-]{1,64})(?:\/|$)/.exec(location.pathname)?.[1] : null;
    const Native = realm.WebSocket, descriptor = Object.getOwnPropertyDescriptor(realm, 'WebSocket');
    if (!galaxy || typeof Native !== 'function' || !descriptor || !own(descriptor, 'value')
      || (!descriptor.writable && !descriptor.configurable)) throw new Error('Observer unavailable');
    const reducer = createReducer({ galaxy, now: () => Date.now() });
    let stopped = false, active = null, lastError = false, publishTimer = null;
    const later = realm.setTimeout.bind(realm), cancel = realm.clearTimeout.bind(realm);
    const publish = (defer = false) => {
      if (stopped) return;
      if (defer) {
        if (publishTimer === null) publishTimer = later(() => { publishTimer = null; publish(); }, 0);
        return;
      }
      if (publishTimer !== null) { cancel(publishTimer); publishTimer = null; }
      try { emit({ channel, snapshot: reducer.snapshot() }); } catch { lastError = true; }
    };
    function detach() {
      if (!active) return;
      for (const [type, fn] of active.listeners) active.socket.removeEventListener(type, fn);
      active = null;
    }
    function watch(socket) {
      detach(); const token = reducer.beginConnection();
      const onMessage = event => {
        if (stopped || active?.socket !== socket || event.isTrusted !== true) return;
        if (reducer.ingest(event.data, token)) publish(reducer.snapshot().complete);
      };
      const onLost = () => {
        if (stopped || active?.socket !== socket) return;
        reducer.loseConnection(token); publish(); detach();
      };
      const listeners = [['message', onMessage], ['close', onLost], ['error', onLost]];
      active = { socket, listeners };
      for (const [type, fn] of listeners) socket.addEventListener(type, fn);
      publish();
    }
    let Wrapped;
    Wrapped = new Proxy(Native, { construct(target, args, newTarget) {
      // Construction and all static/prototype behavior remain native. Unknown
      // sockets pass through untouched. We do not inspect protocols or send().
      const socket = Reflect.construct(target, args, newTarget);
      if (!stopped && isGameSocket(args[0])) {
        try { watch(socket); } catch { reducer.loseConnection(reducer.snapshot().generation, 'malformed'); publish(); }
      }
      return socket;
    } });
    Object.defineProperty(realm, 'WebSocket', { ...descriptor, value: Wrapped });
    publish();
    return Object.freeze({
      status: () => ({ installed: !stopped, emissionError: lastError, ...reducer.snapshot() }),
      stop() {
        if (stopped) return;
        reducer.loseConnection(reducer.snapshot().generation, 'stopped'); publish(); stopped = true; detach();
        if (realm.WebSocket === Wrapped) Object.defineProperty(realm, 'WebSocket', descriptor);
      },
    });
  }
  return Object.freeze({ VERSION, LIMITS, SHIPS, parseFrame, createReducer, validateSnapshot, isGameSocket, installPageObserver });
});
