/* Native empire adapter. Receives sanitized observer DTOs, never credentials.
 * Source: galaxy-CqK10P8m.js, cn (26613), ra (108268), cycleActiveStar (41084).
 * No fetch, socket, URL/history writes, or order controls are used here.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.defineProperty(root, 'OldLightEmpireAdapter', { configurable: true, value: api });
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const SHIPS = Object.freeze(['probe', 'marauder', 'sentinel', 'vanguard']);
  const RESOURCES = Object.freeze(['palladium', 'iridium']);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SCOPE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/;
  const own = (x, key) => Object.prototype.hasOwnProperty.call(x, key);
  const get = (x, key) => {
    if (x === null || typeof x !== 'object') return undefined;
    const d = Object.getOwnPropertyDescriptor(x, key);
    return d && own(d, 'value') ? d.value : undefined;
  };
  const id = x => typeof x === 'string' && UUID.test(x) ? x.toLowerCase() : null;
  const count = x => Number.isSafeInteger(x) && x >= 0 ? x : null;
  const coordinate = x => Number.isSafeInteger(x) && Math.abs(x) <= 10000000 ? x : null;
  const number = (x, signed = false) => typeof x === 'number' && Number.isFinite(x)
    && Math.abs(x) <= Number.MAX_SAFE_INTEGER && (signed || x >= 0) ? x : null;
  const counts = value => Object.fromEntries(SHIPS.map(ship => [ship, value]));
  const copy = value => JSON.parse(JSON.stringify(value));
  const array = (x, limit) => Array.isArray(x) && x.length <= limit;
  const stamp = x => typeof x === 'string' && x.length <= 64 && Number.isFinite(Date.parse(x)) && Date.parse(x) >= 0 ? Date.parse(x) : null;
  const coordKey = (q, r) => `${q},${r}`;
  const OBSERVATION_REASONS = Object.freeze(['', 'awaiting-native-init', 'awaiting-init', 'connection-lost', 'stopped',
    'malformed', 'session-lost', 'missing-init', 'eliminated', 'incomplete-data', 'observer-injection-unavailable',
    'invalid-observation', 'out-of-order-observation', 'observer-permission-unavailable', 'observer-started-late']);
  const OBSERVATION_MESSAGES = Object.freeze({
    'observer-permission-unavailable': 'El gestor no ofrece GM_addElement. Actualiza el Helper, acepta el permiso de inserción y recarga el juego.',
    'observer-started-late': 'El lector arrancó después de la carga inicial. Recarga Old Light para observar la conexión nativa desde el inicio.',
    'observer-injection-unavailable': 'No se pudo instalar el observador nativo en la página. No hay un censo verificado.',
    'connection-lost': 'Se perdió la conexión nativa del juego. Esperando una nueva conexión y su estado inicial.',
    'session-lost': 'La sesión nativa dejó de estar disponible. Esperando un nuevo estado inicial de la cuenta.',
    stopped: 'El observador nativo está detenido. No hay un censo verificado.',
    malformed: 'El observador recibió datos nativos con un formato no válido. Esperando un nuevo estado inicial.',
    'missing-init': 'Llegaron actualizaciones nativas sin el estado inicial de la cuenta. No se puede reconstruir el censo.',
    'invalid-observation': 'El censo nativo recibido no supera la validación de seguridad. No se habilitan acciones imperiales.',
    'out-of-order-observation': 'Se rechazó un censo nativo anterior al último observado. Esperando datos actuales.',
    'contradictory-observation': 'El mismo censo nativo contiene datos contradictorios. Esperando una nueva revisión.',
    eliminated: 'El estado nativo indica que la cuenta está eliminada. No hay sistemas propios verificados.',
    'incomplete-data': 'El estado nativo recibido está incompleto. Esperando el censo completo de la cuenta.',
  });
  // Diagnostic input is separate from world validation and never grants
  // ownership, connection readiness, navigation or order authority.
  function observationStatus(read) {
    if (typeof read !== 'function') return null;
    try {
      const raw = read();
      if (!raw || typeof raw !== 'object') return null;
      const out = {};
      for (const key of ['installed', 'observed', 'connected']) {
        const value = get(raw, key);
        if (value !== undefined && typeof value !== 'boolean') return null;
        out[key] = value;
      }
      const reason = get(raw, 'reason');
      if (reason !== undefined && !OBSERVATION_REASONS.includes(reason)) return null;
      out.reason = reason;
      const bootstrap = get(raw, 'bootstrap');
      if (bootstrap !== undefined && bootstrap !== null) {
        const phase = get(bootstrap, 'phase'), readyState = get(bootstrap, 'readyState'), error = get(bootstrap, 'error');
        if (!['late-start', 'attempted', 'unavailable'].includes(phase)
          || !['loading', 'interactive', 'complete', 'unknown'].includes(readyState)
          || !['', 'bridge-create-failed', 'ready-state-unavailable'].includes(error)) return null;
        out.bootstrap = { phase, readyState, error };
      }
      return out;
    } catch { return null; }
  }
  function add(a, b) { const n = a === null || b === null ? null : a + b; return count(n); }
  function shipCounts(rows) {
    if (!array(rows, SHIPS.length)) return counts(null);
    const out = counts(0), seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const row = get(rows, String(i)), type = get(row, 'type'), quantity = count(get(row, 'quantity'));
      if (!SHIPS.includes(type) || quantity === null || seen.has(type)) return counts(null);
      seen.add(type); out[type] = quantity;
    }
    return out;
  }
  function projectResources(economy, at) {
    const out = {}, settledAt = stamp(get(get(economy, 'resources'), 'settledAt'));
    for (const [resource, prefix] of [['palladium', 'pa'], ['iridium', 'ir']]) {
      const cap = number(get(economy, `${prefix}Cap`));
      const rate = number(get(economy, `${prefix}RatePerMin`), true);
      const stock = number(get(get(economy, 'resources'), resource));
      // cn uses wall-clock time, no server-clock offset and no lower clamp.
      const projected = cap === null || rate === null || stock === null || settledAt === null || count(at) === null
        ? null : Math.min(cap, stock + rate * Math.max(0, (at - settledAt) / 60000));
      out[resource] = { amount: number(projected), cap, rate };
    }
    return out;
  }
  function shipProduction(system) {
    const yard = get(system, 'shipyard');
    if (yard === null) {
      const buildings = get(system, 'buildings');
      // The verified renderer treats a locked yard as an empty queue. Require an
      // explicit zero-level source record before translating absence to zero.
      if (array(buildings, 64) && buildings.some(x => get(x, 'type') === 'shipyard' && get(x, 'level') === 0)) {
        return { jobs: 0, building: counts(0) };
      }
      return { jobs: null, building: counts(null) };
    }
    const queue = get(yard, 'queue');
    if (!array(queue, 128)) return { jobs: null, building: counts(null) };
    const building = counts(0), seen = new Set();
    for (let i = 0; i < queue.length; i++) {
      const job = get(queue, String(i)), jobId = id(get(job, 'id')), type = get(job, 'type');
      const kind = get(job, 'kind'), remaining = count(get(job, 'quantityRemaining'));
      if (!jobId || seen.has(jobId) || !SHIPS.includes(type) || !['recruit', 'scrap'].includes(kind) || remaining === null) {
        return { jobs: null, building: counts(null) };
      }
      seen.add(jobId);
      if (kind !== 'scrap') building[type] = add(building[type], remaining);
    }
    // Queue occupancy includes scrap jobs, while future ship production does not.
    return { jobs: queue.length, building };
  }
  function deduplicateTransits(rows) {
    if (!array(rows, 20000)) return null;
    const byId = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = get(rows, String(i)), transitId = id(get(row, 'id'));
      const ships = shipCounts(get(row, 'ships'));
      const fromQ = get(row, 'fromQ'), fromR = get(row, 'fromR'), toQ = coordinate(get(row, 'toQ')), toR = coordinate(get(row, 'toR'));
      const phase = get(row, 'phase'), recalledAt = get(row, 'recalledAt');
      if (!transitId || Object.values(ships).some(x => x === null) || toQ === null || toR === null
        || !((fromQ === null && fromR === null) || (coordinate(fromQ) !== null && coordinate(fromR) !== null))
        || !(phase === undefined || typeof phase === 'string' && phase.length <= 200)
        || !(recalledAt === null || stamp(recalledAt) !== null)) return null;
      const transit = { id: transitId, fromQ, fromR, toQ, toR, phase: phase || '', recalledAt, ships };
      // Compare all sanitized routing/count/timing fields, not only quantities.
      for (const field of ['arrivesAt', 'departsAt', 'kind']) {
        const value = get(row, field);
        if (value !== undefined) {
          if (field === 'kind' ? !['combat', 'trade', 'deal'].includes(value) : stamp(value) === null) return null;
          transit[field] = value;
        }
      }
      const old = byId.get(transitId);
      if (old && JSON.stringify(old) !== JSON.stringify(transit)) return null;
      byId.set(transitId, transit);
    }
    return [...byId.values()];
  }
  /** Native ra semantics: own transfers excluded; recalled/returning reverse
   * home and remote endpoints. Only the caller's own transit array is accepted.
   * Hostile incomingTransits are intentionally never read by this adapter. */
  function nativeAwayBySystem(systems, transits) {
    if (!array(systems, 10000)) return null;
    const owned = new Set(), byCoordinate = new Map(), out = {};
    for (const system of systems) {
      const systemId = id(get(system, 'id')), q = coordinate(get(system, 'q')), r = coordinate(get(system, 'r'));
      if (!systemId || q === null || r === null || own(out, systemId) || owned.has(coordKey(q, r))) return null;
      owned.add(coordKey(q, r)); byCoordinate.set(coordKey(q, r), systemId); out[systemId] = counts(0);
    }
    const unique = deduplicateTransits(transits);
    if (!unique) return null;
    for (const transit of unique) {
      const returning = transit.phase === 'returning' || transit.recalledAt !== null;
      const home = coordKey(returning ? transit.toQ : transit.fromQ, returning ? transit.toR : transit.fromR);
      const remote = coordKey(returning ? transit.fromQ : transit.toQ, returning ? transit.fromR : transit.toR);
      if (owned.has(remote)) continue;
      const homeId = byCoordinate.get(home);
      if (!homeId) continue;
      for (const ship of SHIPS) out[homeId][ship] = add(out[homeId][ship], transit.ships[ship]);
    }
    return out;
  }
  /**
   * @typedef {{phase:'late-start'|'attempted'|'unavailable',
   * readyState:'loading'|'interactive'|'complete'|'unknown',
   * error:''|'bridge-create-failed'|'ready-state-unavailable'}} BootstrapDiagnostic
   * @typedef {''|'awaiting-native-init'|'awaiting-init'|'connection-lost'|'stopped'|
   * 'malformed'|'session-lost'|'missing-init'|'eliminated'|'incomplete-data'|
   * 'observer-injection-unavailable'|'invalid-observation'|'out-of-order-observation'} ObservationReason
   * @typedef {{installed?:boolean, observed?:boolean, connected?:boolean,
   * reason?:ObservationReason, bootstrap?:BootstrapDiagnostic}} ObservationDiagnostic
   * options.getObservationStatus is an optional () => ObservationDiagnostic
   * reader for diagnostic text only; none of its fields authorize actions.
   */
  function create(options = {}) {
    const { getWorld, getContext, getHudSnapshot, document: doc, canNavigate: allowed,
      onChange = () => {}, now = Date.now, setTimeout: later = setTimeout, clearTimeout: clear = clearTimeout } = options;
    const readStyle = options.getComputedStyle === undefined
      ? node => doc?.defaultView?.getComputedStyle?.(node) : options.getComputedStyle;
    if (![getWorld, getContext, getHudSnapshot, now, later, clear].every(x => typeof x === 'function')) throw new TypeError('Missing native adapter readers');
    const maxAgeMs = Math.max(1000, number(options.maxAgeMs) ?? 120000);
    const hopTimeoutMs = Math.min(10000, Math.max(100, number(options.hopTimeoutMs) ?? 1800));
    const pollMs = Math.max(10, Math.min(250, number(options.pollMs) ?? 50));
    const settleMs = Math.max(20, Math.min(1000, number(options.settleMs) ?? 100));
    const renderLagMs = Math.min(1500, Math.max(0, number(options.renderLagMs) ?? 1500));
    const manualHoldMs = Math.max(0, number(options.manualHoldMs) ?? 15000);
    let disposed = false, moving = null, manualUntil = 0, lastKey = '', lastFingerprint = '', poisonedKey = '';
    let lastVersion = null;
    let status = '', worldIssue = '', observationGeneration = null;
    const timers = new Map();
    function notify() { try { onChange(); } catch { /* Rendering cannot authorize navigation. */ } }
    function world() {
      worldIssue = ''; observationGeneration = null;
      if (disposed) return null;
      try {
        const source = getWorld(), clock = now(), scope = get(source, 'scope'), selfId = id(get(source, 'selfId'));
        worldIssue = source === null || source === undefined ? '' : 'invalid-observation';
        const galaxy = get(source, 'galaxy'), observedAt = count(get(source, 'observedAt'));
        const epoch = count(get(source, 'epoch')), revision = count(get(source, 'revision')), generation = count(get(source, 'generation'));
        observationGeneration = generation;
        const systems = get(source, 'systems');
        if (get(source, 'version') !== 1 || get(source, 'connected') !== true || !selfId || typeof scope !== 'string' || !SCOPE.test(scope)
          || scope !== `${galaxy}/${selfId}` || observedAt === null || count(clock) === null || observedAt > clock || clock - observedAt > maxAgeMs
          || epoch === null || epoch < 1 || revision === null || generation === null || generation < 1 || !array(systems, 10000) || !systems.length) return null;
        const roster = [], rawById = new Map(), coords = new Set();
        for (let i = 0; i < systems.length; i++) {
          const item = get(systems, String(i)), systemId = id(get(item, 'id'));
          const q = coordinate(get(item, 'q')), r = coordinate(get(item, 'r')), name = get(item, 'name');
          if (!systemId || q === null || r === null || rawById.has(systemId) || coords.has(coordKey(q, r)) || typeof name !== 'string'
            || get(item, 'playerId') !== undefined && get(item, 'playerId') !== selfId) return null;
          rawById.set(systemId, item); coords.add(coordKey(q, r));
          roster.push({ id: systemId, name: name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200), owned: true });
        }
        const censusId = `native:${generation}:${epoch}:${revision}`;
        const transits = deduplicateTransits(get(source, 'transits'));
        const away = nativeAwayBySystem(systems, get(source, 'transits'));
        const ships = counts(transits ? 0 : null);
        if (transits) for (const transit of transits) for (const ship of SHIPS) ships[ship] = add(ships[ship], transit.ships[ship]);
        const reported = get(source, 'transitShips');
        if (reported !== undefined && SHIPS.some(ship => get(reported, ship) !== ships[ship])) return null;
        const snapshots = roster.map(item => {
          const raw = rawById.get(item.id), economy = get(raw, 'economy'), production = shipProduction(raw), parked = shipCounts(get(raw, 'fleet'));
          const energyCap = number(get(economy, 'energyCap')), energyUsed = number(get(economy, 'energyUsed'));
          const queue = get(economy, 'queue');
          return { scope, systemId: item.id, name: item.name, owned: true, observedAt, censusId,
            resources: projectResources(economy, observedAt),
            fleet: Object.fromEntries(SHIPS.map(ship => [ship, { parked: parked[ship], away: away?.[item.id]?.[ship] ?? null, building: production.building[ship] }])),
            queue: { buildings: array(queue, 128) ? queue.length : null, ships: production.jobs },
            energy: energyCap === null || energyUsed === null ? null : number(energyCap - energyUsed, true) };
        });
        const complete = get(source, 'complete') === true;
        // A connection reset must advance generation/epoch; an older DTO must
        // never restore ownership or a pre-arrival fleet after a newer census.
        if (lastVersion?.scope === scope && (generation < lastVersion.generation
          || generation === lastVersion.generation && (epoch < lastVersion.epoch
            || epoch === lastVersion.epoch && (revision < lastVersion.revision || observedAt < lastVersion.observedAt)))) {
          worldIssue = 'out-of-order-observation'; return null;
        }
        const identity = `${scope}:${generation}:${epoch}`, key = `${identity}:${revision}`;
        const fingerprint = JSON.stringify({ complete, observedAt, roster, snapshots, transits });
        if (key === poisonedKey) { worldIssue = 'contradictory-observation'; return null; }
        if (lastKey === key && lastFingerprint !== fingerprint) { poisonedKey = key; worldIssue = 'contradictory-observation'; return null; }
        lastKey = key; lastFingerprint = fingerprint;
        lastVersion = { scope, generation, epoch, revision, observedAt };
        worldIssue = '';
        return { scope, identity, censusId, observedAt, roster, rawById, snapshots, complete,
          transit: transits && Object.values(ships).every(x => x !== null) ? { scope, censusId, observedAt, ships } : null };
      } catch { worldIssue = 'invalid-observation'; return null; }
    }
    function getStatus() {
      if (disposed) return OBSERVATION_MESSAGES.stopped;
      const current = world();
      if (current?.complete) return status || 'Esperando datos nativos y una selección única confirmada.';
      if (current) return OBSERVATION_MESSAGES['incomplete-data'];
      if (['out-of-order-observation', 'contradictory-observation'].includes(worldIssue)) return OBSERVATION_MESSAGES[worldIssue];
      const diagnostic = observationStatus(options.getObservationStatus);
      if (diagnostic?.bootstrap?.phase === 'late-start') {
        return 'El helper arrancó después de la carga inicial de la página; el observador nativo no se instaló. Recarga la página con el userscript activado.';
      }
      if (diagnostic?.bootstrap?.phase === 'unavailable') return OBSERVATION_MESSAGES['observer-injection-unavailable'];
      if (diagnostic && own(OBSERVATION_MESSAGES, diagnostic.reason)) return OBSERVATION_MESSAGES[diagnostic.reason];
      if (diagnostic?.installed === true) {
        if (diagnostic.reason === 'awaiting-init' && observationGeneration !== null && observationGeneration > 0) {
          return 'Conexión nativa detectada; esperando el estado inicial de la cuenta.';
        }
        if (diagnostic.connected === false && diagnostic.observed === false) {
          return 'Canal del observador instalado; esperando los primeros datos del observador nativo.';
        }
        if (diagnostic.connected === false && observationGeneration === 0) {
          return 'Canal del observador instalado; esperando la conexión nativa del juego.';
        }
        if (diagnostic.connected === false && diagnostic.reason === 'awaiting-init') {
          return 'Canal del observador instalado; esperando el estado inicial de la cuenta.';
        }
      }
      if (worldIssue) return OBSERVATION_MESSAGES[worldIssue];
      if (diagnostic?.bootstrap?.phase === 'attempted' && diagnostic.installed === false) {
        return 'Se intentó iniciar el observador nativo, pero todavía no se ha confirmado su instalación.';
      }
      return 'Estado del observador nativo desconocido; esperando un censo completo y verificado de la cuenta.';
    }
    function readRoster() {
      const current = world();
      return current ? { scope: current.scope, complete: current.complete, observedAt: current.observedAt, systems: copy(current.roster) } : null;
    }
    function readSnapshots() { const current = world(); return current ? copy(current.snapshots) : null; }
    function readTransitCensus() { const current = world(); return current?.complete && current.transit ? copy(current.transit) : null; }
    function context() {
      try {
        const raw = getContext();
        return { scope: get(raw, 'scope'), systemId: id(get(raw, 'systemId')), selectionCount: get(raw, 'selectionCount'),
          settled: get(raw, 'settled') === true, owned: get(raw, 'owned'),
          blocked: ['pending', 'loading', 'modal', 'manual'].some(key => get(raw, key) === true) };
      } catch { return null; }
    }
    function hudMatches(snapshot, raw, at) {
      let hud; try { hud = getHudSnapshot(); } catch { return false; }
      if (!hud || get(hud, 'scope') !== undefined && get(hud, 'scope') !== snapshot.scope
        || get(hud, 'systemId') !== undefined && id(get(hud, 'systemId')) !== snapshot.systemId) return false;
      for (const ship of SHIPS) for (const field of ['parked', 'away', 'building']) {
        const source = snapshot.fleet[ship][field];
        if (source === null || count(get(get(get(hud, 'fleet'), ship), field)) !== source) return false;
      }
      for (const field of ['buildings', 'ships']) {
        if (snapshot.queue[field] === null || count(get(get(hud, 'queue'), field)) !== snapshot.queue[field]) return false;
      }
      if (snapshot.energy === null || number(get(hud, 'energy'), true) !== snapshot.energy) return false;
      const economy = get(raw, 'economy'), fresh = projectResources(economy, at), previous = projectResources(economy, Math.max(0, at - renderLagMs));
      for (const resource of RESOURCES) {
        const value = get(get(hud, 'resources'), resource), expected = fresh[resource], earlier = previous[resource];
        if (Object.values(expected).some(x => x === null) || earlier.amount === null) return false;
        const amount = count(get(value, 'amount')), cap = count(get(value, 'cap')), rate = number(get(value, 'rate'), true);
        const min = Math.floor(Math.min(expected.amount, earlier.amount)), max = Math.floor(Math.max(expected.amount, earlier.amount));
        if (amount === null || amount < min || amount > max || cap !== Math.floor(expected.cap) || rate !== Number(expected.rate.toFixed(1))) return false;
      }
      return true;
    }
    function active(current = world()) {
      const ctx = context();
      if (!ctx) return null;
      const snapshot = current?.snapshots.find(x => x.systemId === ctx.systemId);
      const owned = !!current && current.scope === ctx.scope && !!snapshot && ctx.owned !== false;
      const settled = !!owned && current.complete && ctx.selectionCount === 1 && ctx.settled && !ctx.blocked
        && hudMatches(snapshot, current.rawById.get(ctx.systemId), now());
      return { context: { scope: ctx.scope || '', systemId: ctx.systemId || '', selectionCount: ctx.selectionCount ?? null, owned, settled },
        snapshot: settled ? copy(snapshot) : null };
    }
    function readActive() { return active(); }
    function gates() {
      if (disposed || now() < manualUntil || typeof allowed !== 'function') return false;
      try {
        if (allowed() !== true || doc?.hidden === true) return false;
        const ctx = context(); if (!ctx || ctx.blocked || !ctx.settled || ctx.selectionCount !== 1) return false;
        if (!doc || typeof doc.querySelector !== 'function' || typeof doc.querySelectorAll !== 'function') return false;
        if (doc.querySelector('dialog[open], [aria-modal="true"], .b-loading, .ship-build-btn.b-loading')) return false;
        const focused = doc.activeElement;
        if (focused?.isContentEditable || focused?.matches?.('input, textarea, select, [contenteditable="true"]')) return false;
        return true;
      } catch { return false; }
    }
    function canNavigate() { return !moving && gates(); }
    function button() {
      const matches = doc.querySelectorAll('[data-field="nameplate-next"]');
      if (matches.length !== 1) return null;
      const node = matches[0];
      if (!node || typeof node.click !== 'function' || node.disabled || node.hidden || node.isConnected === false
        || node.getAttribute?.('aria-disabled') === 'true' || node.getAttribute?.('aria-busy') === 'true'
        || node.getAttribute?.('aria-hidden') === 'true'
        || node.classList?.contains('b-loading') || node.closest?.('[hidden], [inert], [aria-hidden="true"]')
        || typeof node.getClientRects === 'function' && node.getClientRects().length === 0) return null;
      // A layout box can exist for visibility:hidden/collapse. Check the native
      // view (or an injected reader) and ancestors before permitting a click.
      // Missing/throwing style access cannot establish a visible native control.
      if (typeof readStyle !== 'function') return null;
      try {
        const seen = new Set();
        for (let current = node; current; current = current.parentElement) {
          if (seen.has(current) || seen.size >= 128) return null;
          seen.add(current);
          const style = readStyle(current);
          if (!style || style.visibility !== 'visible' || style.display === 'none'
            || current.getAttribute?.('aria-hidden') === 'true') return null;
        }
      } catch { return null; }
      return node;
    }
    const rosterKey = current => current.roster.map(x => x.id).sort().join(',');
    function safeWorld(operation) {
      if (moving !== operation || operation.cancelled || !gates()) return null;
      const current = world();
      return current?.complete && current.identity === operation.identity && current.scope === operation.scope
        && rosterKey(current) === operation.roster && current.roster.some(x => x.id === operation.target) ? current : null;
    }
    function delay(ms) {
      return new Promise(resolve => {
        const handle = later(() => { timers.delete(handle); resolve(); }, ms);
        timers.set(handle, resolve);
      });
    }
    async function waitForHop(operation, fromId) {
      const started = now(); let candidate = '', seenAt = 0, polls = 0;
      const maxPolls = Math.ceil(hopTimeoutMs / pollMs) + 2;
      while (now() - started <= hopTimeoutMs && polls++ < maxPolls) {
        const current = safeWorld(operation); if (!current) return null;
        const value = active(current), ctx = value?.context;
        if (!ctx || ctx.scope !== operation.scope || !ctx.owned || ctx.selectionCount !== 1) return null;
        if (ctx.systemId !== fromId) {
          if (candidate && candidate !== ctx.systemId || operation.seen.has(ctx.systemId)) return null;
          if (!candidate) { candidate = ctx.systemId; seenAt = now(); }
          if (ctx.settled && value.snapshot && now() - seenAt >= settleMs) return { current, value };
        } else if (candidate) return null;
        await delay(pollMs);
      }
      return null;
    }
    async function selectSystem(uuid, { scope } = {}) {
      const target = id(uuid);
      if (!target || !SCOPE.test(scope || '') || moving || !gates()) return false;
      const initial = world(), before = active(initial);
      if (!initial?.complete || initial.scope !== scope || !before?.context.settled || !initial.roster.some(x => x.id === target)) return false;
      if (before.context.systemId === target) return true;
      const operation = { target, scope, identity: initial.identity, roster: rosterKey(initial), seen: new Set([before.context.systemId]), cancelled: false };
      moving = operation; status = 'Confirmando la selección nativa del sistema.';
      let currentId = before.context.systemId;
      try {
        for (let hop = 0; hop < initial.roster.length - 1; hop++) {
          const current = safeWorld(operation), value = active(current);
          if (!current || value?.context.systemId !== currentId || !value?.context.settled) return false;
          const next = button(); if (!next || !safeWorld(operation)) return false;
          // This is the only navigation side effect. The native callback selects
          // an owned system, clears multi-selection, and refreshes the HUD.
          next.click();
          const arrived = await waitForHop(operation, currentId);
          if (!arrived) return false;
          currentId = arrived.value.context.systemId; operation.seen.add(currentId);
          if (currentId === target) {
            const finalWorld = safeWorld(operation), finalActive = finalWorld && active(finalWorld);
            return finalActive?.context.systemId === target && finalActive?.context.settled === true;
          }
        }
        return false;
      } catch { return false; }
      finally { if (moving === operation) moving = null; status = ''; notify(); }
    }
    function onManual(event) {
      if (!event?.isTrusted) return;
      manualUntil = now() + manualHoldMs;
      if (moving) moving.cancelled = true;
      notify();
    }
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    for (const type of events) doc?.addEventListener?.(type, onManual, true);
    function dispose() {
      disposed = true; if (moving) moving.cancelled = true;
      for (const [handle, resolve] of timers) { clear(handle); resolve(); } timers.clear();
      for (const type of events) doc?.removeEventListener?.(type, onManual, true);
    }
    return Object.freeze({ readRoster, readSnapshots, readTransitCensus, readActive, selectSystem, canNavigate,
      isAvailable: () => world()?.complete === true,
      getStatus, dispose });
  }
  return Object.freeze({ create, projectResources, nativeAwayBySystem });
});
