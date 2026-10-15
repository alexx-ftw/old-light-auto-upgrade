/* Local reinforcement intent. The injected queue adapter alone may interact with
 * the game. This module never opens sockets, navigates, produces, or sends ships. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) Object.defineProperty(root, 'OldLightReinforcementCore', { configurable: true, value: api });
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const SHIPS = Object.freeze(['probe', 'marauder', 'sentinel', 'vanguard']);
  const MAX_AGE_MS = 120000, MAX_QUANTITY = 50000, MAX_ROUTES = 128, MAX_RECEIPTS = 256;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SCOPE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/;
  const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const copy = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  // Never evaluate an accessor supplied by a stored object or route editor.
  const get = (value, key) => {
    if (!object(value) && !Array.isArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && own(descriptor, 'value') ? descriptor.value : undefined;
  };
  const fail = message => { throw new Error(message || 'Datos de refuerzo no válidos.'); };
  const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(value) && value >= min && value <= max ? value : fail();
  const text = (value, max = 200) => typeof value === 'string' && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value) ? value : fail();
  const systemId = value => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : fail();
  const routeId = value => typeof value === 'string' && ID.test(value) ? value : fail();
  const scopeId = value => typeof value === 'string' && SCOPE.test(value) ? value : fail('Selecciona una cuenta y galaxia válidas.');
  const point = value => ({ q: integer(get(value, 'q'), -10000000, 10000000), r: integer(get(value, 'r'), -10000000, 10000000) });
  const samePoint = (a, b) => a?.q === b?.q && a?.r === b?.r;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const zeros = () => Object.fromEntries(SHIPS.map(type => [type, 0]));
  function shipRules(value) {
    if (value !== undefined && !object(value)) fail();
    if (value && Object.keys(value).some(key => !SHIPS.includes(key))) fail();
    return Object.fromEntries(SHIPS.map(type => {
      const raw = get(value, type);
      if (raw === undefined) return [type, { mode: 'fixed', amount: 0, reserve: 0 }];
      const mode = get(raw, 'mode');
      if (!object(raw) || !['fixed', 'excess'].includes(mode)) fail();
      return [type, { mode, amount: integer(get(raw, 'amount') ?? 0, 0, MAX_QUANTITY),
        reserve: integer(get(raw, 'reserve') ?? 0) }];
    }));
  }
  function amounts(value) {
    if (!object(value) || Object.keys(value).some(key => !SHIPS.includes(key))) fail();
    const result = Object.fromEntries(SHIPS.map(type => [type, integer(get(value, type), 0, MAX_QUANTITY)]));
    if (!SHIPS.some(type => result[type] > 0)) fail();
    return result;
  }
  function ticketFrom(value, route) {
    if (value === null) return null;
    if (!object(value)) fail();
    const sequence = integer(get(value, 'sequence'), 1);
    const id = `route:${route.id}:${sequence}`;
    if (get(value, 'id') !== id || sequence !== route.sequence || !['prepared', 'queued'].includes(get(value, 'state'))) fail();
    const result = { id, sequence, state: get(value, 'state'), createdAt: integer(get(value, 'createdAt')),
      originId: systemId(get(value, 'originId')), destinationId: systemId(get(value, 'destinationId')),
      originName: text(get(value, 'originName'), 400), targetLabel: text(get(value, 'targetLabel'), 400),
      coordinate: point(get(value, 'coordinate')), quantities: amounts(get(value, 'quantities')) };
    if (result.originId !== route.originId || result.destinationId !== route.destinationId
      || !result.originName.trim() || !result.targetLabel.trim()) fail();
    return result;
  }
  function routeFrom(value) {
    if (!object(value)) fail();
    const route = { id: routeId(get(value, 'id')), name: text(get(value, 'name') ?? ''),
      originId: systemId(get(value, 'originId')), destinationId: systemId(get(value, 'destinationId')),
      intervalMinutes: integer(get(value, 'intervalMinutes'), 1, 1440), ships: shipRules(get(value, 'ships')),
      paused: get(value, 'paused'), needsReview: get(value, 'needsReview'), status: get(value, 'status'),
      message: text(get(value, 'message'), 500), sequence: integer(get(value, 'sequence')),
      nextRunAt: integer(get(value, 'nextRunAt')), lastSentAt: get(value, 'lastSentAt') === null ? null : integer(get(value, 'lastSentAt')),
      createdAt: integer(get(value, 'createdAt')), updatedAt: integer(get(value, 'updatedAt')) };
    if (route.originId === route.destinationId || typeof route.paused !== 'boolean'
      || typeof route.needsReview !== 'boolean' || !['waiting', 'queued', 'paused', 'review'].includes(route.status)
      || (route.needsReview && (!route.paused || route.status !== 'review'))) fail();
    route.ticket = ticketFrom(get(value, 'ticket'), route);
    if (route.status === 'queued' && (!route.ticket || route.paused)) fail();
    return route;
  }
  function receiptFrom(value) {
    if (!object(value)) fail();
    const result = { originId: systemId(get(value, 'originId')), lastSentAt: integer(get(value, 'lastSentAt')),
      nextRunAt: integer(get(value, 'nextRunAt')) };
    if (result.nextRunAt < result.lastSentAt) fail();
    return result;
  }
  function mergeReceipt(receipts, value) {
    const next = receiptFrom(value), previous = receipts.find(item => item.originId === next.originId);
    if (previous) return receipts.map(item => item === previous ? { originId: next.originId,
      lastSentAt: Math.max(item.lastSentAt, next.lastSentAt), nextRunAt: Math.max(item.nextRunAt, next.nextRunAt) } : item);
    if (receipts.length >= MAX_RECEIPTS) fail('El registro de envíos está lleno. Espera a que haya un censo posterior y venzan los plazos pendientes.');
    return [...receipts, next];
  }
  function empty(scope) { return { schemaVersion: 1, scope, sequence: 0, routes: [], receipts: [] }; }
  function storeFrom(raw, scope) {
    if (raw === null || raw === undefined || raw === '') return empty(scope);
    if (typeof raw === 'string') {
      if (raw.length > 512 * 1024) fail();
      raw = JSON.parse(raw);
    }
    const routes = get(raw, 'routes');
    if (get(raw, 'schemaVersion') !== 1 || get(raw, 'scope') !== scope || !Array.isArray(routes) || routes.length > MAX_ROUTES) fail();
    const result = { schemaVersion: 1, scope, sequence: integer(get(raw, 'sequence')), routes: routes.map(routeFrom), receipts: [] };
    if (new Set(result.routes.map(route => route.id)).size !== result.routes.length
      || result.routes.some(route => route.sequence > result.sequence)) fail();
    const receipts = get(raw, 'receipts');
    if (receipts === undefined) {
      // Schema 1 predates origin receipts. Preserve every known send while
      // normalizing the old store; the next ordinary commit persists migration.
      for (const route of result.routes) if (route.lastSentAt !== null) result.receipts = mergeReceipt(result.receipts, {
        originId: route.originId, lastSentAt: route.lastSentAt,
        nextRunAt: Math.max(route.nextRunAt, integer(route.lastSentAt + route.intervalMinutes * 60000)) });
    } else {
      if (!Array.isArray(receipts) || receipts.length > MAX_RECEIPTS) fail();
      result.receipts = receipts.map(receiptFrom);
      if (new Set(result.receipts.map(item => item.originId)).size !== result.receipts.length) fail();
    }
    return result;
  }
  function create({ read, write, getContext, getWorld, getJobs, queue, cancel, now = Date.now, onChange = () => {} } = {}) {
    if (![read, write, getContext, getWorld, getJobs, queue, cancel, now, onChange].every(fn => typeof fn === 'function')) {
      throw new TypeError('Faltan adaptadores síncronos para las rutas de refuerzo.');
    }
    let running = false, localSequence = 0, error = '', activeScope = '', worldSession = '';
    // This is only a live-session authorization witness. Durable intent remains
    // in the scoped store. A recovered sending claim never inherits this witness.
    const liveTickets = new Map();
    const sync = value => {
      if (value && typeof value.then === 'function') fail('El almacenamiento y la cola deben ser síncronos.');
      return value;
    };
    const time = () => integer(now(), 0, 8640000000000000);
    function context() {
      let raw, scope;
      try { raw = sync(getContext()); scope = scopeId(get(raw, 'scope')); }
      catch (cause) { liveTickets.clear(); activeScope = ''; worldSession = ''; throw cause; }
      const coordinated = get(raw, 'coordinated') === true;
      if (scope !== activeScope || !coordinated) { liveTickets.clear(); worldSession = ''; }
      activeScope = scope;
      return { scope, originId: typeof get(raw, 'originId') === 'string' ? get(raw, 'originId').toLowerCase() : '',
        canAct: get(raw, 'canAct') === true, coordinated };
    }
    function load(scope = context().scope) { return storeFrom(sync(read(scope)), scope); }
    function notify() { try { onChange(); } catch (_) { /* Intent is already durable. */ } }
    function commit(next) {
      const clean = storeFrom(next, next.scope);
      if (context().scope !== clean.scope) fail('La cuenta o galaxia ha cambiado.');
      try {
        sync(write(clean.scope, copy(clean)));
        if (!same(load(clean.scope), clean)) fail('No se confirmó la escritura local.');
      } catch (cause) {
        error = 'No se pudo guardar el estado local. No se crearán envíos sin guardar antes su ticket.';
        // Failure is observable through state()/tick() and the thrown action.
        // Do not schedule another onChange tick for the same failing write.
        throw cause;
      }
      error = '';
      notify();
      return clean;
    }
    function jobs() {
      const result = sync(getJobs());
      if (!Array.isArray(result)) fail('No se puede comprobar la cola de misiones.');
      return result;
    }
    function stamp(route) { route.updatedAt = Math.max(time(), route.updatedAt); return route; }
    function replace(state, route) { return commit({ ...state, routes: state.routes.map(item => item.id === route.id ? stamp(route) : item) }); }
    function review(route, message) {
      return stamp({ ...route, paused: true, needsReview: true, status: 'review', message });
    }
    const witnessKey = (scope, ticket) => `${scope}/${ticket.id}`;
    const signature = ticket => JSON.stringify({ ...ticket, state: 'queued' });
    function spec(scope, ticket) {
      return { scope, originId: ticket.originId, originName: ticket.originName,
        target: { mode: 'custom', missionAction: 'send', coordinate: copy(ticket.coordinate),
          routeKey: '', presetKey: 'refuerzo', label: ticket.targetLabel },
        quantities: copy(ticket.quantities), produce: false, autoSend: true };
    }
    function matches(scope, ticket, job) {
      if (!job || job.id !== ticket.id || job.scope !== scope || job.originId !== ticket.originId
        || job.originName !== ticket.originName || job.produce !== false || job.autoSend !== true
        || job.campaignId !== undefined || job.target?.originCoordinate !== undefined) return false;
      const target = job.target;
      return target?.mode === 'custom' && target.missionAction === 'send' && target.routeKey === ''
        && target.presetKey === 'refuerzo' && target.label === ticket.targetLabel && samePoint(target.coordinate, ticket.coordinate)
        && object(job.quantities) && Object.keys(job.quantities).every(key => SHIPS.includes(key))
        && SHIPS.every(type => job.quantities[type] === ticket.quantities[type]);
    }
    function worldFor(scope) {
      const world = sync(getWorld()), at = time();
      if (!object(world) || world.scope !== scope || world.connected !== true || world.complete !== true
        || !Number.isSafeInteger(world.observedAt) || world.observedAt < 0 || world.observedAt > at
        || at - world.observedAt > MAX_AGE_MS || !Array.isArray(world.systems) || !Array.isArray(world.transits)) return null;
      if ((world.galaxy !== undefined || world.selfId !== undefined) && `${world.galaxy}/${world.selfId}` !== scope) return null;
      if ((world.epoch !== undefined && (!Number.isSafeInteger(world.epoch) || world.epoch < 0))
        || (world.generation !== undefined && (!Number.isSafeInteger(world.generation) || world.generation < 0))) return null;
      const session = JSON.stringify([scope, world.epoch ?? null, world.generation ?? null]);
      if (worldSession && session !== worldSession) liveTickets.clear();
      worldSession = session;
      const systems = new Map(), coordinates = new Set();
      for (const raw of world.systems) {
        const id = systemId(raw?.id), coordinate = point(raw), key = `${coordinate.q},${coordinate.r}`;
        if (systems.has(id) || coordinates.has(key) || !Array.isArray(raw.fleet) || raw.owned === false) return null;
        const fleet = zeros(), seen = new Set();
        for (const item of raw.fleet) {
          if (!SHIPS.includes(item?.type) || seen.has(item.type)) return null;
          fleet[item.type] = integer(item.quantity); seen.add(item.type);
        }
        systems.set(id, { id, ...coordinate, name: typeof raw.name === 'string' ? raw.name.slice(0, 200) : id, fleet });
        coordinates.add(key);
      }
      const transits = [];
      for (const transit of world.transits) {
        const to = point({ q: transit?.toQ, r: transit?.toR });
        const from = transit?.fromQ === null && transit?.fromR === null ? null : point({ q: transit?.fromQ, r: transit?.fromR });
        transits.push({ from, to });
      }
      return { systems, transits, observedAt: world.observedAt };
    }
    function receiptFor(state, originId) { return state.receipts.find(item => item.originId === originId); }
    function pruneReceipts(state, world) {
      if (!world) return state;
      const at = time(), receipts = state.receipts.filter(item => !(at > item.nextRunAt
        && world.systems.has(item.originId) && world.observedAt > item.lastSentAt
        && !state.routes.some(route => route.originId === item.originId && route.ticket)));
      return receipts.length === state.receipts.length ? state : { ...state, receipts };
    }
    function recordReceipt(state, originId, lastSentAt, nextRunAt) {
      let world = null;
      try { world = worldFor(state.scope); } catch (_) { /* Missing proof cannot expire a receipt. */ }
      const kept = pruneReceipts(state, world);
      return { ...kept, receipts: mergeReceipt(kept.receipts, { originId, lastSentAt, nextRunAt }) };
    }
    function preserveHistory(state, route) {
      return route.lastSentAt === null ? state : recordReceipt(state, route.originId, route.lastSentAt,
        Math.max(route.nextRunAt, integer(route.lastSentAt + route.intervalMinutes * 60000)));
    }
    function hasReceiptCapacity(state, originId) {
      // An outstanding ticket reserves its future receipt slot before a send.
      // No confirmed outcome has to evict unexpired evidence to be persisted.
      const origins = new Set(state.receipts.map(item => item.originId));
      for (const route of state.routes) if (route.ticket) origins.add(route.originId);
      origins.add(originId);
      return origins.size <= MAX_RECEIPTS;
    }
    function permits(state, route, world) {
      const receipt = receiptFor(state, route.originId);
      return Boolean(world && time() >= route.nextRunAt && (!receipt
        || (time() >= receipt.nextRunAt && world.observedAt > receipt.lastSentAt)) && hasReceiptCapacity(state, route.originId)
        && !state.routes.some(other => other.id !== route.id && other.originId === route.originId && (other.needsReview || other.ticket)));
    }
    function validSentAt(route, job) {
      return Number.isSafeInteger(job?.sentAt) && job.sentAt >= route.ticket.createdAt && job.sentAt <= time();
    }
    function accepted(state, route, sentAt) {
      const prior = receiptFor(state, route.originId);
      const lastSentAt = Math.max(route.lastSentAt ?? 0, sentAt);
      const nextRunAt = Math.max(route.nextRunAt, prior?.nextRunAt ?? 0, integer(sentAt + route.intervalMinutes * 60000));
      const next = stamp({ ...route, ticket: null, lastSentAt, nextRunAt, needsReview: false,
        status: route.paused ? 'paused' : 'waiting', message: 'Refuerzo enviado. Esperando al siguiente intervalo.' });
      const recorded = recordReceipt(state, route.originId, lastSentAt, nextRunAt);
      liveTickets.delete(witnessKey(state.scope, route.ticket));
      return { state: recorded, route: next };
    }
    function plan(route, world, requested = null) {
      if (!world || (route.lastSentAt !== null && world.observedAt <= route.lastSentAt)) return null;
      const origin = world.systems.get(route.originId), destination = world.systems.get(route.destinationId);
      if (!origin || !destination || samePoint(origin, destination)) return null;
      // The same route must settle before it can launch again. An independent
      // source may reinforce the same destination; its ships are not parked here.
      // A hidden origin cannot establish independence, so fail closed for either
      // endpoint until that transfer disappears from the native census.
      if (world.transits.some(transit => transit.from
        ? samePoint(transit.from, origin) && samePoint(transit.to, destination)
        : samePoint(transit.to, origin) || samePoint(transit.to, destination))) return null;
      const quantities = zeros();
      for (const type of SHIPS) {
        const rule = route.ships[type], available = Math.max(0, origin.fleet[type] - rule.reserve);
        const desired = requested ? requested[type] : rule.mode === 'fixed' ? rule.amount : Math.min(MAX_QUANTITY, available);
        if (!Number.isSafeInteger(desired) || desired < 0 || desired > MAX_QUANTITY || desired > available
          || (rule.mode === 'fixed' && desired !== rule.amount)) return null;
        quantities[type] = desired;
      }
      if (!SHIPS.some(type => quantities[type] > 0)) return null;
      return { origin, destination, quantities };
    }
    function reconcile(state, queueJobs, world) {
      const originalState = state;
      state = pruneReceipts(state, world);
      let changed = state !== originalState;
      const routes = state.routes.map(original => {
        if (!original.ticket || original.needsReview) return original;
        const route = copy(original), ticket = route.ticket, job = queueJobs.find(item => item.id === ticket.id);
        const key = witnessKey(state.scope, ticket);
        let next = route;
        if (!job || !matches(state.scope, ticket, job)) {
          next = review(route, 'La misión guardada ha desaparecido o ha cambiado. Comprueba si se envió; no se repetirá automáticamente.');
        } else if (job.needsReview || job.fleetEdit || ['paused', 'uncertain'].includes(job.status)) {
          next = review(route, 'La misión necesita revisión en la cola. Comprueba el envío antes de crear otra ruta.');
        } else if (job.status === 'sent') {
          if (!validSentAt(route, job)) {
            next = review(route, 'La confirmación del envío no tiene una fecha válida.');
          } else {
            const result = accepted(state, route, job.sentAt);
            state = result.state; next = result.route;
          }
        } else if (job.status === 'sending' && liveTickets.get(key) !== signature(ticket)) {
          next = review(route, 'Se recuperó un envío iniciado. Comprueba su resultado; no se repetirá automáticamente.');
        } else if (!['waiting', 'sending'].includes(job.status)) {
          next = review(route, 'La misión tiene un estado desconocido. Revisa la cola.');
        } else if (!route.paused) {
          liveTickets.set(key, signature(ticket));
          next = { ...route, ticket: { ...ticket, state: 'queued' }, status: 'queued', message: 'Refuerzo preparado en la cola.' };
        }
        if (!same(original, next)) { changed = true; return stamp(next); }
        return original;
      });
      return changed ? commit({ ...state, routes }) : state;
    }
    function state() {
      try { const value = load(); return { ...copy(value), error }; }
      catch (cause) { error = cause.message || 'No se puede leer el estado local de refuerzos.'; return { ...empty(''), error }; }
    }
    function list() { return state().routes; }
    function find(state, id) {
      const route = state.routes.find(item => item.id === id);
      return route || fail('La ruta ya no existe en esta cuenta y galaxia.');
    }
    function clearPending(state, route) {
      if (!route.ticket) return route;
      const job = jobs().find(item => item.id === route.ticket.id);
      if (!job || !matches(state.scope, route.ticket, job) || job.needsReview || job.fleetEdit
        || !['waiting', 'paused', 'sent'].includes(job.status)) {
        const next = review(route, 'La ruta está pausada. Comprueba el resultado de la misión antes de reanudarla.');
        replace(state, next); return next;
      }
      if (job.status === 'sent') {
        if (!validSentAt(route, job)) {
          const next = review(route, 'La confirmación del envío no tiene una fecha válida. Revisa los movimientos del juego.');
          replace(state, next); return next;
        }
        // Persist acceptance and its origin-wide cooldown BEFORE the ticket can
        // disappear. Pausing/editing is not a new send and cannot reset either.
        const result = accepted(state, route, job.sentAt);
        replace(result.state, result.route);
        return result.route;
      }
      try {
        sync(cancel(job.id));
        if (jobs().some(item => item.id === job.id)) fail('La misión sigue en la cola.');
      } catch (_) {
        const next = { ...route, message: 'La ruta está pausada, pero no se ha podido retirar su misión de la cola.' };
        replace(state, next); return next;
      }
      liveTickets.delete(witnessKey(state.scope, route.ticket));
      const next = { ...route, ticket: null, status: 'paused', nextRunAt: Math.max(route.nextRunAt, time()), message: '' };
      replace(load(state.scope), next); return next;
    }
    function pause(id, paused = true) {
      if (paused !== true && paused !== false) fail();
      if (!paused) return resume(id);
      const saved = load(), route = find(saved, id);
      const next = { ...route, paused: true, status: route.needsReview ? 'review' : 'paused' };
      const committed = replace(saved, next); // Revoke guards BEFORE queue cancellation.
      if (!next.needsReview) clearPending(committed, next);
      return copy(find(load(saved.scope), id));
    }
    function resume(id) {
      let saved = load(), route = find(saved, id);
      if (route.needsReview) fail('Comprueba primero el resultado del envío; esta ruta requiere revisión.');
      if (!route.paused) return copy(route);
      route = clearPending(saved, route); saved = load(saved.scope);
      if (route.needsReview || route.ticket) fail('No se puede reanudar mientras la misión pendiente no esté resuelta.');
      const receipt = receiptFor(saved, route.originId);
      return copy(find(replace(saved, { ...route, paused: false, status: 'waiting', message: '',
        nextRunAt: Math.max(route.nextRunAt, receipt?.nextRunAt ?? 0, time()) }), id));
    }
    function save(value) {
      const at = time();
      let saved = load();
      const suppliedId = get(value, 'id');
      let id = suppliedId === undefined || suppliedId === '' ? '' : routeId(suppliedId);
      if (!id) do { id = `r-${at.toString(36)}-${(++localSequence).toString(36)}-${(saved.sequence + 1).toString(36)}`; }
        while (saved.routes.some(item => item.id === id));
      const previous = saved.routes.find(item => item.id === id);
      const originId = systemId(get(value, 'originId')), destinationId = systemId(get(value, 'destinationId'));
      const intervalMinutes = integer(get(value, 'intervalMinutes'), 1, 1440), ships = shipRules(get(value, 'ships'));
      const name = text(get(value, 'name') ?? '');
      if (originId === destinationId) fail('El origen y el destino deben ser distintos.');
      const pausedInput = get(value, 'paused');
      if (pausedInput !== undefined && typeof pausedInput !== 'boolean') fail();
      const paused = pausedInput !== false;
      if (previous?.needsReview) fail('Revisa el envío pendiente antes de sustituir esta ruta.');
      if (previous?.ticket) {
        const stopped = pause(id); saved = load(saved.scope);
        if (stopped.needsReview || stopped.ticket) fail('No se puede editar una ruta con un envío pendiente sin resolver.');
      }
      if (!previous && saved.routes.length >= MAX_ROUTES) fail('Se ha alcanzado el límite de rutas.');
      const current = saved.routes.find(item => item.id === id);
      if (current) saved = preserveHistory(saved, current);
      const sameOrigin = current?.originId === originId, receipt = receiptFor(saved, originId);
      const lastSentAt = sameOrigin ? current.lastSentAt : null;
      const nextRunAt = Math.max(at, sameOrigin ? current.nextRunAt : 0, receipt?.nextRunAt ?? 0,
        lastSentAt === null ? 0 : integer(lastSentAt + intervalMinutes * 60000),
        receipt ? integer(receipt.lastSentAt + intervalMinutes * 60000) : 0);
      if (receipt) saved = recordReceipt(saved, originId, receipt.lastSentAt, nextRunAt);
      const route = { id, name, originId, destinationId, intervalMinutes, ships, paused, needsReview: false,
        status: paused ? 'paused' : 'waiting', message: '', sequence: current?.sequence ?? 0,
        nextRunAt, lastSentAt, createdAt: current?.createdAt ?? at,
        updatedAt: Math.max(at, current?.updatedAt ?? 0), ticket: null };
      commit({ ...saved, routes: previous ? saved.routes.map(item => item.id === id ? route : item) : [...saved.routes, route] });
      return copy(route);
    }
    function remove(id) {
      // Revocation comes first, but deletion cannot be used as an implicit
      // acknowledgment of a sending/uncertain/disappeared mission. Keep the route
      // visible with its review action instead of creating an invisible blocker.
      pause(id);
      let saved = load(), route = find(saved, id);
      if (route.ticket && route.needsReview) {
        const job = jobs().find(item => item.id === route.ticket.id);
        if (matches(saved.scope, route.ticket, job) && job.status === 'sent' && !job.needsReview && !job.fleetEdit && validSentAt(route, job)) {
          route = clearPending(saved, route); saved = load(saved.scope);
        }
      }
      if (route.ticket || route.needsReview) fail('La ruta sigue pausada y visible. Revisa los movimientos y pulsa «He revisado el envío» antes de eliminarla.');
      saved = preserveHistory(saved, route);
      commit({ ...saved, routes: saved.routes.filter(item => item.id !== id) });
      return true;
    }
    function acknowledgeRoute(id) {
      let saved = load(), route = find(saved, id);
      if (!route.needsReview) fail('La ruta no tiene un envío pendiente de revisión.');
      const queueJobs = jobs();
      if (queueJobs.some(job => job.scope === saved.scope && job.originId === route.originId && job.status === 'sending')) {
        fail('El envío sigue en curso. Espera a que termine antes de marcarlo como revisado.');
      }
      const ticket = route.ticket, job = ticket ? queueJobs.find(item => item.id === ticket.id) : null;
      if (job && !matches(saved.scope, ticket, job)) fail('La misión ha cambiado y no se retirará. Resuelve primero esa misión en la cola.');
      const at = time(), prior = receiptFor(saved, route.originId);
      const nextRunAt = Math.max(route.nextRunAt, prior?.nextRunAt ?? 0, integer(at + route.intervalMinutes * 60000));
      // The explicit human review never asserts "not sent". Assume it was sent
      // now, durably preserve that conservative barrier, and leave intent paused.
      route = stamp({ ...route, paused: true, needsReview: true, status: 'review',
        lastSentAt: Math.max(route.lastSentAt ?? 0, at), nextRunAt,
        message: 'Envío revisado. Retirando el intento local antes de cerrar la revisión.' });
      saved = recordReceipt(saved, route.originId, route.lastSentAt, nextRunAt);
      saved = replace(saved, route);
      if (context().scope !== saved.scope) fail('La cuenta o galaxia ha cambiado durante la revisión.');
      const durable = find(load(saved.scope), id);
      if (!durable.paused || !durable.needsReview || !same(durable.ticket, ticket)) fail('La ruta cambió durante la revisión; comprueba su estado actual.');
      if (job) {
        const live = jobs().find(item => item.id === ticket.id);
        if (!live || !matches(saved.scope, ticket, live) || live.status === 'sending') {
          fail('La misión cambió durante la revisión. La ruta continúa pausada y pendiente de revisión.');
        }
        try {
          sync(cancel(job.id));
          if (jobs().some(item => item.id === job.id)) fail();
        } catch (_) {
          fail('No se pudo retirar la misión. La ruta continúa pausada y pendiente de revisión.');
        }
      }
      saved = load(saved.scope);
      const current = find(saved, id);
      if (!same(current.ticket, ticket) || !current.paused) fail('La ruta cambió durante la revisión; comprueba su estado actual.');
      if (ticket) liveTickets.delete(witnessKey(saved.scope, ticket));
      const next = { ...current, ticket: null, needsReview: false, status: 'paused',
        message: 'Revisión completada. La ruta sigue pausada; al reanudar esperará el intervalo y un censo posterior.' };
      return copy(find(replace(saved, next), id));
    }
    // Read-only owner state, independent of fleet readiness and selected origin.
    // Do not reconcile here: rendering must never create tickets or accept sends.
    function jobState(job) {
      if (!job?.id?.startsWith('route:')) return null;
      const blocked = message => ({ blocked: true, needsReview: true, message });
      try {
        const saved = load(), route = saved.routes.find(item => item.ticket?.id === job.id);
        if (!route || job.scope !== saved.scope) return blocked('Refuerzo sin ruta local verificable. No se enviará. Revisa los movimientos y cancela este pendiente en la cola.');
        if (!matches(saved.scope, route.ticket, job)) return blocked('La misión de refuerzo ha cambiado. No se enviará. Pausa la ruta, comprueba los movimientos, cancela este pendiente local y completa la revisión de la ruta.');
        if (job.fleetEdit) return blocked('La misión conserva una edición independiente pendiente. Envío bloqueado. Pausa la ruta, comprueba los movimientos, cancela el pendiente local y completa la revisión de la ruta.');
        if (route.needsReview) return blocked('Ruta pendiente de revisión. Envío bloqueado. Comprueba los movimientos y pulsa «He revisado el envío» en la ruta.');
        if (job.needsReview || job.status === 'uncertain') return blocked('Envío sin confirmar. Comprueba los movimientos y pausa la ruta para iniciar su revisión. No se reintentará desde la cola.');
        if (job.status === 'paused') return blocked('Misión pausada. Gestiona o pausa su ruta; no se reanudará desde la cola.');
        if (route.paused) return { blocked: true, needsReview: false, message: 'Ruta pausada. Gestiona este refuerzo desde su ruta.' };
        return { blocked: false, needsReview: false, message: 'Refuerzo gestionado por su ruta; el envío requiere sus comprobaciones de seguridad.' };
      } catch (_) { return blocked('No se puede comprobar la ruta de refuerzo. Envío bloqueado hasta recuperar su estado local.'); }
    }
    function canRunJob(job) {
      if (typeof job?.id !== 'string' || !job.id.startsWith('route:')) return true;
      try {
        const ctx = context();
        if (!ctx.canAct || !ctx.coordinated || job.scope !== ctx.scope || job.originId !== ctx.originId) return false;
        const saved = load(ctx.scope), route = saved.routes.find(item => item.ticket?.id === job.id);
        if (!route || route.paused || route.needsReview || route.status !== 'queued' || route.ticket.state !== 'queued'
          || job.needsReview || job.fleetEdit || !['waiting', 'sending'].includes(job.status) || !matches(ctx.scope, route.ticket, job)) return false;
        if (!Number.isSafeInteger(job.createdAt) || job.createdAt < route.ticket.createdAt || job.createdAt > time()
          || job.sentAt !== null || (job.status === 'sending'
            && (!Number.isSafeInteger(job.claimedAt) || job.claimedAt < job.createdAt || job.claimedAt > time()))) return false;
        const live = jobs().find(item => item.id === job.id);
        if (!live || !matches(ctx.scope, route.ticket, live) || live.status !== job.status || live.claimedAt !== job.claimedAt
          || live.createdAt !== job.createdAt || live.sentAt !== job.sentAt || live.needsReview || live.fleetEdit) return false;
        const world = worldFor(ctx.scope), ready = plan(route, world, route.ticket.quantities);
        if (!ready || !permits(saved, route, world) || !samePoint(ready.destination, route.ticket.coordinate)) return false;
        const key = witnessKey(ctx.scope, route.ticket);
        if (job.status === 'sending' && liveTickets.get(key) !== signature(route.ticket)) return false;
        liveTickets.set(key, signature(route.ticket));
        return true;
      } catch (_) { return false; }
    }
    function dueOrigins() {
      try {
        const ctx = context();
        if (!ctx.coordinated) return [];
        const saved = load(ctx.scope), world = worldFor(ctx.scope), queueJobs = jobs(), at = time(), result = [];
        for (const route of saved.routes) {
          if (route.paused || route.needsReview || !permits(saved, route, world)) continue;
          if (route.ticket) {
            const job = queueJobs.find(item => item.id === route.ticket.id);
            const ready = plan(route, world, route.ticket.quantities);
            if (!matches(ctx.scope, route.ticket, job) || job.status !== 'waiting' || job.needsReview || job.fleetEdit
              || !ready || !samePoint(ready.destination, route.ticket.coordinate)) continue;
          } else if (route.nextRunAt > at || !plan(route, world)
            || queueJobs.some(job => job.scope === ctx.scope && job.originId === route.originId && (job.status !== 'sent' || job.needsReview))) continue;
          if (!result.includes(route.originId)) result.push(route.originId);
        }
        return result;
      } catch (_) { return []; }
    }
    function tick() {
      if (running) return { queued: [], error };
      running = true;
      try {
        const ctx = context();
        if (!ctx.coordinated || !ctx.canAct) return { queued: [], error };
        const world = worldFor(ctx.scope);
        let saved = reconcile(load(ctx.scope), jobs(), world);
        const at = time(), queueJobs = jobs();
        if (!world) return { queued: [], error };
        const routes = saved.routes.filter(route => !route.paused && !route.needsReview && !route.ticket
          && route.originId === ctx.originId && route.nextRunAt <= at).sort((a, b) => a.nextRunAt - b.nextRunAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
        for (const route of routes) {
          if (queueJobs.some(job => job.scope === ctx.scope && job.originId === route.originId && (job.status !== 'sent' || job.needsReview))) break;
          const ready = plan(route, world);
          if (!ready || !permits(saved, route, world)) continue;
          const sequence = integer(saved.sequence + 1, 1);
          const ticket = { id: `route:${route.id}:${sequence}`, sequence, state: 'prepared', createdAt: at,
            originId: route.originId, destinationId: route.destinationId, originName: ready.origin.name.trim() || route.originId,
            targetLabel: ready.destination.name.trim() || route.destinationId,
            coordinate: { q: ready.destination.q, r: ready.destination.r }, quantities: ready.quantities };
          const claimed = stamp({ ...route, sequence, ticket, status: 'queued', message: 'Guardando el refuerzo antes de crear la misión.' });
          saved = commit({ ...saved, sequence, routes: saved.routes.map(item => item.id === route.id ? claimed : item) });
          // A synchronous onChange hook may pause/delete the route or change the
          // account. Re-read all authority after persistence and before queueing.
          const latest = context(), durableBeforeQueue = load(ctx.scope), current = durableBeforeQueue.routes.find(item => item.id === route.id);
          const freshWorld = worldFor(ctx.scope), fresh = plan(claimed, freshWorld, ticket.quantities);
          if (latest.scope !== ctx.scope || latest.originId !== route.originId || !latest.canAct || !latest.coordinated
            || !current || current.paused || current.needsReview || !same(current.ticket, ticket) || !fresh
            || !permits(durableBeforeQueue, current, freshWorld)
            || !samePoint(fresh.destination, ticket.coordinate)
            || jobs().some(job => job.scope === ctx.scope && job.originId === route.originId && (job.status !== 'sent' || job.needsReview))) return { queued: [], error };
          try {
            sync(queue(spec(ctx.scope, ticket), { id: ticket.id }));
            const actual = jobs().find(job => job.id === ticket.id);
            if (!matches(ctx.scope, ticket, actual) || actual.status !== 'waiting' || actual.needsReview || actual.fleetEdit) fail('No se ha confirmado la misión en espera.');
            const durable = load(ctx.scope), still = durable.routes.find(item => item.id === route.id);
            if (!still || still.paused || !same(still.ticket, ticket)) return { queued: [ticket.id], error };
            liveTickets.set(witnessKey(ctx.scope, ticket), signature(ticket));
            replace(durable, { ...still, ticket: { ...ticket, state: 'queued' }, message: 'Refuerzo preparado en la cola.' });
            return { queued: [ticket.id], error };
          } catch (cause) {
            const durable = load(ctx.scope), still = durable.routes.find(item => item.id === route.id);
            if (still?.ticket?.id === ticket.id) replace(durable, review(still, 'No se pudo confirmar la creación de la misión. Revisa la cola; no se repetirá automáticamente.'));
            throw cause;
          }
        }
        return { queued: [], error };
      } catch (cause) { error = cause.message || 'No se pudo preparar el refuerzo.'; return { queued: [], error }; }
      finally { running = false; }
    }
    return Object.freeze({ state, list, save, pause, resume, remove, acknowledgeRoute, tick, canRunJob, jobState, dueOrigins });
  }
  return Object.freeze({ create, SHIPS, MAX_AGE_MS, MAX_QUANTITY, MAX_ROUTES, MAX_RECEIPTS });
});
