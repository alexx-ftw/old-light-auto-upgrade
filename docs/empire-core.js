(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) Object.defineProperty(root, 'OldLightEmpireCore', {
    configurable: true, enumerable: true, writable: true, value: api,
  });
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SHIPS = Object.freeze(['probe', 'marauder', 'sentinel', 'vanguard']);
  const RESOURCES = ['palladium', 'iridium'];
  const ROLES = new Set(['balanced', 'industry', 'shipyard', 'defense']);
  const MAX_TARGET = 1000000;
  const DEFAULT_MAX_AGE_MS = 120000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const plain = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  };
  // Stored or externally supplied objects must not execute accessors/coercion.
  const get = (object, key) => {
    if (!plain(object) && !Array.isArray(object)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && own(descriptor, 'value') ? descriptor.value : undefined;
  };
  const idOf = value => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
  const scopeOf = value => typeof value === 'string' && value.trim() && value.length <= 512 ? value.trim() : null;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const number = (value, signed = false) => typeof value === 'number' && Number.isFinite(value) && (signed || value >= 0) ? value : null;
  const censusOf = value => typeof value === 'string' && value.trim() && value.length <= 200 ? value.trim() : null;
  const nameOf = value => typeof value === 'string' ? value.slice(0, 200) : '';
  const ships = value => Object.fromEntries(DEFAULT_SHIPS.map(ship => [ship, value]));
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const systemConfig = value => ({
    name: nameOf(get(value, 'name')),
    role: ROLES.has(get(value, 'role')) ? get(value, 'role') : 'balanced',
    enabled: get(value, 'enabled') !== false,
  });

  function normalizeConfig(value) {
    const fleetTargets = ships(0);
    const rawTargets = get(value, 'fleetTargets');
    for (const ship of DEFAULT_SHIPS) {
      const target = get(rawTargets, ship);
      if (typeof target === 'number' && Number.isFinite(target)) fleetTargets[ship] = Math.max(0, Math.min(MAX_TARGET, Math.floor(target)));
    }
    const systems = {};
    const rawSystems = get(value, 'systems');
    const ambiguous = new Set();
    if (plain(rawSystems)) for (const key of Object.keys(rawSystems).sort(compare)) {
      const id = idOf(key);
      if (!id) continue;
      if (own(systems, id)) ambiguous.add(id);
      else systems[id] = systemConfig(get(rawSystems, key));
    }
    // Case-variant duplicate UUIDs must not silently re-enable a disabled system.
    for (const id of ambiguous) systems[id].enabled = false;
    const version = get(value, 'schemaVersion');
    return { schemaVersion: 1, enabled: get(value, 'enabled') === true && (version === undefined || version === 1), fleetTargets, systems };
  }

  function normalizeSnapshot(value) {
    const scope = scopeOf(get(value, 'scope'));
    const systemId = idOf(get(value, 'systemId'));
    const observedAt = count(get(value, 'observedAt'));
    const owned = get(value, 'owned');
    if (!scope || !systemId || observedAt === null || typeof owned !== 'boolean') return null;
    const resources = {};
    for (const resource of RESOURCES) {
      const raw = get(get(value, 'resources'), resource);
      resources[resource] = {
        amount: number(get(raw, 'amount')), cap: number(get(raw, 'cap')), rate: number(get(raw, 'rate'), true),
      };
    }
    const fleet = {};
    for (const ship of DEFAULT_SHIPS) {
      const raw = get(get(value, 'fleet'), ship);
      fleet[ship] = { parked: count(get(raw, 'parked')), away: count(get(raw, 'away')), building: count(get(raw, 'building')) };
    }
    const rawQueue = get(value, 'queue');
    return {
      scope, systemId, name: nameOf(get(value, 'name')), owned, observedAt,
      censusId: censusOf(get(value, 'censusId')), resources, fleet,
      queue: { buildings: count(get(rawQueue, 'buildings')), ships: count(get(rawQueue, 'ships')) },
      energy: number(get(value, 'energy'), true),
    };
  }

  function normalizeTransitCensus(value) {
    const scope = scopeOf(get(value, 'scope'));
    const censusId = censusOf(get(value, 'censusId'));
    const observedAt = count(get(value, 'observedAt'));
    const counts = Object.fromEntries(DEFAULT_SHIPS.map(ship => [ship, count(get(get(value, 'ships'), ship))]));
    if (!scope || !censusId || observedAt === null || Object.values(counts).some(value => value === null)) return null;
    return { scope, censusId, observedAt, ships: counts };
  }

  function context(options) {
    const scope = scopeOf(get(options, 'scope'));
    const now = count(get(options, 'now'));
    const rawAge = get(options, 'maxAgeMs');
    const maxAgeMs = rawAge === undefined ? DEFAULT_MAX_AGE_MS : count(rawAge);
    const rawIds = get(options, 'expectedIds');
    const expectedIds = [];
    let validRoster = Array.isArray(rawIds) && rawIds.length > 0;
    if (Array.isArray(rawIds)) for (let index = 0; index < rawIds.length; index += 1) {
      const id = idOf(get(rawIds, String(index)));
      if (!id || expectedIds.includes(id)) validRoster = false;
      else expectedIds.push(id);
    }
    expectedIds.sort(compare);
    return { scope, now, maxAgeMs, expectedIds, validRoster, valid: !!scope && now !== null && maxAgeMs !== null };
  }

  function sum(values, integer = false) {
    if (!values.length || values.some(value => value === null)) return null;
    const total = values.reduce((a, b) => a + b, 0);
    return Number.isFinite(total) && (!integer || Number.isSafeInteger(total)) ? total : null;
  }

  function known(row) {
    return row.energy !== null && Object.values(row.queue).every(value => value !== null)
      && RESOURCES.every(resource => Object.values(row.resources[resource]).every(value => value !== null))
      && DEFAULT_SHIPS.every(ship => Object.values(row.fleet[ship]).every(value => value !== null)
        && sum(Object.values(row.fleet[ship]), true) !== null);
  }

  // expectedIds MUST come from the current verified-owned roster in this scope,
  // never from persisted configuration or an inferred list of old snapshots.
  function inspect(snapshots, options) {
    const ctx = context(options);
    const expected = new Set(ctx.expectedIds);
    const candidates = new Map();
    const unknownIds = new Set();
    let malformed = !Array.isArray(snapshots);
    if (Array.isArray(snapshots)) for (let index = 0; index < snapshots.length; index += 1) {
      const raw = get(snapshots, String(index));
      // Other player/galaxy caches cannot contribute or poison this scope.
      if (scopeOf(get(raw, 'scope')) !== ctx.scope) continue;
      const id = idOf(get(raw, 'systemId'));
      if (!id) { malformed = true; continue; }
      if (!expected.has(id)) { unknownIds.add(id); continue; }
      if (!candidates.has(id)) candidates.set(id, []);
      candidates.get(id).push(normalizeSnapshot(raw));
    }
    const rows = [], missingIds = [], staleIds = [], duplicateIds = [], invalidIds = [], unownedIds = [], incompleteIds = [];
    for (const id of ctx.expectedIds) {
      const entries = candidates.get(id) || [];
      if (!entries.length) { missingIds.push(id); continue; }
      if (entries.length !== 1) { duplicateIds.push(id); continue; }
      const row = entries[0];
      if (!row) { invalidIds.push(id); continue; }
      if (!row.owned) { unownedIds.push(id); continue; }
      if (!ctx.valid || row.observedAt > ctx.now || ctx.now - row.observedAt > ctx.maxAgeMs) { staleIds.push(id); continue; }
      if (!known(row)) incompleteIds.push(id);
      rows.push(row);
    }
    const censusId = rows.length && rows.every(row => row.censusId && row.censusId === rows[0].censusId) ? rows[0].censusId : null;
    const rawTransit = get(options, 'transitCensus');
    const hasTransit = rawTransit !== undefined && rawTransit !== null;
    const transit = normalizeTransitCensus(rawTransit);
    const transitReason = !hasTransit ? 'missing-transit-census' : !transit ? 'invalid-transit-census'
      : transit.scope !== ctx.scope ? 'foreign-transit-census'
      : !censusId || transit.censusId !== censusId ? 'unsynchronized-transit-census'
      : !ctx.valid || transit.observedAt > ctx.now || ctx.now - transit.observedAt > ctx.maxAgeMs ? 'stale-transit-census'
      : DEFAULT_SHIPS.some(ship => {
        const hudAway = sum(rows.map(row => row.fleet[ship].away), true);
        return hudAway !== null && transit.ships[ship] < hudAway;
      }) ? 'inconsistent-transit-census' : 'ready';
    const validTransit = transitReason === 'ready';
    const singleSystemFallback = ctx.expectedIds.length === 1 && !hasTransit;
    const fleetTotalSource = validTransit ? 'transit-census' : singleSystemFallback ? 'single-system-away' : 'hud-estimate';
    const resources = {}, fleet = {};
    for (const resource of RESOURCES) resources[resource] = Object.fromEntries(['amount', 'cap', 'rate'].map(field => [field, sum(rows.map(row => row.resources[resource][field]))]));
    for (const ship of DEFAULT_SHIPS) {
      fleet[ship] = Object.fromEntries(['parked', 'away', 'building'].map(field => [field, sum(rows.map(row => row.fleet[ship][field]), true)]));
      fleet[ship].transit = validTransit ? transit.ships[ship] : null;
      // HUD away omits friendly transfers. A global self-transit census includes
      // them AND external missions, so HUD away must not be added a second time.
      fleet[ship].total = sum([fleet[ship].parked, fleet[ship].building, validTransit ? fleet[ship].transit : fleet[ship].away], true);
    }
    const totals = {
      resources, fleet,
      queue: Object.fromEntries(['buildings', 'ships'].map(field => [field, sum(rows.map(row => row.queue[field]), true)])),
      energy: sum(rows.map(row => row.energy)),
    };
    const overflow = rows.length > 0 && (DEFAULT_SHIPS.some(ship => ['parked', 'away', 'building', 'total'].some(field => fleet[ship][field] === null))
      || RESOURCES.some(resource => Object.values(resources[resource]).some(value => value === null))
      || Object.values(totals.queue).some(value => value === null) || totals.energy === null);
    const reason = !ctx.valid ? 'invalid-context' : !ctx.validRoster ? 'invalid-roster' : malformed ? 'malformed-snapshots'
      : duplicateIds.length ? 'duplicate-snapshots' : invalidIds.length ? 'invalid-snapshots'
      : unownedIds.length ? 'unverified-ownership' : missingIds.length ? 'missing-snapshots'
      : staleIds.length ? 'stale-snapshots' : incompleteIds.length || overflow ? 'unknown-measurements' : 'ready';
    const fleetReason = reason !== 'ready' ? reason : ctx.expectedIds.length > 1 && !censusId ? 'unsynchronized-fleet'
      : singleSystemFallback ? 'ready' : transitReason;
    const fleetComplete = fleetReason === 'ready';
    const result = {
      complete: reason === 'ready', fleetComplete, fleetReason, fleetTotalSource,
      censusId, transitCensus: validTransit ? transit : null, reason, expectedIds: ctx.expectedIds, rows, totals,
      missingIds, staleIds, duplicateIds, invalidIds, unownedIds, incompleteIds, unknownIds: [...unknownIds].sort(compare),
    };
    return { ctx, candidates, result };
  }

  function aggregate(snapshots, options) { return inspect(snapshots, options).result; }

  function nextSystem(config, state, activeSystemId) {
    const { ctx, candidates } = state;
    if (!config.enabled || !ctx.valid || !ctx.validRoster) return null;
    const active = idOf(activeSystemId);
    const eligible = ctx.expectedIds.filter(id => {
      if (config.systems[id] && !config.systems[id].enabled) return false;
      const entries = candidates.get(id) || [];
      return !entries.length || (entries.length === 1 && entries[0] && entries[0].owned && entries[0].observedAt <= ctx.now);
    });
    eligible.sort((a, b) => {
      const ageA = (candidates.get(a) || [])[0]?.observedAt ?? -1;
      const ageB = (candidates.get(b) || [])[0]?.observedAt ?? -1;
      return ageA - ageB || (a === active ? -1 : b === active ? 1 : compare(a, b));
    });
    return eligible[0] || null;
  }

  // Synchronization contract: matching censusId values MUST identify one
  // authoritative whole-account response, not a sequential browser sweep.
  // Cached per-system observations can duplicate or omit a transferring fleet.
  // Multi-system orders also require transitCensus from that SAME world state:
  // it must count ALL self-owned in-flight ships once, including friendly
  // transfers, external missions, and transits whose origin is no longer owned.
  // Native HUD away excludes friendly transfers. It remains display/local
  // engine accounting only; global totals use parked + building + transit.
  function plan(value, snapshots, options) {
    const config = normalizeConfig(value);
    const state = inspect(snapshots, options);
    const data = state.result;
    const targetsBySystem = {};
    const allocationsBySystem = {};
    const deficits = ships(null);
    const result = {
      complete: data.complete && data.fleetComplete, fleetComplete: data.fleetComplete,
      reason: !config.enabled ? 'disabled' : !data.complete ? data.reason : !data.fleetComplete ? data.fleetReason : data.reason, targetsBySystem,
      nextSystemId: nextSystem(config, state, get(options, 'activeSystemId')),
      summary: { totals: data.totals, fleetTotalSource: data.fleetTotalSource, deficits, allocationsBySystem, unallocated: ships(null), eligibleSystemIds: [] },
    };
    if (!config.enabled || !result.complete) return result;
    const eligible = data.rows.filter(row => {
      const settings = config.systems[row.systemId] || systemConfig(null);
      return settings.enabled && (settings.role === 'balanced' || settings.role === 'shipyard');
    }).sort((a, b) => a.queue.ships - b.queue.ships || a.observedAt - b.observedAt || compare(a.systemId, b.systemId));
    result.summary.eligibleSystemIds = eligible.map(row => row.systemId);
    for (const row of eligible) {
      allocationsBySystem[row.systemId] = ships(0);
      // Existing queues are included in the minimum because the local engine
      // subtracts parked + away + building. Only new allocations are deficits.
      targetsBySystem[row.systemId] = { shipMinimums: Object.fromEntries(DEFAULT_SHIPS.map(ship => [ship, row.fleet[ship].parked + row.fleet[ship].away + row.fleet[ship].building])) };
    }
    for (const ship of DEFAULT_SHIPS) {
      deficits[ship] = Math.max(0, config.fleetTargets[ship] - data.totals.fleet[ship].total);
      result.summary.unallocated[ship] = eligible.length ? 0 : deficits[ship];
      if (!eligible.length) continue;
      const each = Math.floor(deficits[ship] / eligible.length);
      const remainder = deficits[ship] % eligible.length;
      eligible.forEach((row, index) => {
        const allocation = each + (index < remainder ? 1 : 0);
        allocationsBySystem[row.systemId][ship] = allocation;
        targetsBySystem[row.systemId].shipMinimums[ship] += allocation;
      });
    }
    result.reason = !eligible.length && DEFAULT_SHIPS.some(ship => deficits[ship] > 0) ? 'no-production-systems'
      : DEFAULT_SHIPS.every(ship => deficits[ship] === 0) ? 'targets-met' : 'ready';
    return result;
  }

  return Object.freeze({ DEFAULT_SHIPS, MAX_TARGET, DEFAULT_MAX_AGE_MS, normalizeConfig, normalizeSnapshot, normalizeTransitCensus, aggregate, plan });
});
