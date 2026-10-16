/* Reinforcement preferences and a read-only map overlay. Never issues game orders.
 * Native evidence: galaxy-CqK10P8m.js (SHA-256 ba9c761ac00e7f513a58014a33574fbcfef1f4942ffc3b337ef606ea4ab0ccdc):
 * #stage boot 530821; Sl .star-hover 334350–335670; B camera closure 543866.
 * A hover supplies an exact projected point, but only a name. Resolve a unique
 * own-system name against the current census, check cursor proximity, and ask
 * the user to review the explicit system names/coordinates before saving.
 * The native radial menu is clamped and MUST NOT be used as a map anchor.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OldLightReinforcementPanel = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const SHIPS = ['probe', 'marauder', 'sentinel', 'vanguard'];
  const LABELS = { probe: 'Probe', marauder: 'Marauder', sentinel: 'Sentinel', vanguard: 'Vanguard' };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SVG = 'http://www.w3.org/2000/svg';
  const CSS = `
.oldlight-routes{font:13px/1.4 system-ui,sans-serif;color:#e5eef6;background:#101d29;border:1px solid #415a70;border-radius:9px;padding:10px;max-width:100%;box-sizing:border-box;color-scheme:dark}
.oldlight-routes *{box-sizing:border-box}.oldlight-routes summary{font-weight:650;cursor:pointer;min-height:28px;padding:3px 0}.oldlight-routes p{margin:7px 0}.oldlight-routes button,.oldlight-routes select,.oldlight-routes input{font:inherit;color:inherit;background:#172b3c;border:1px solid #526b7e;border-radius:6px;min-height:32px;max-width:100%;padding:5px;min-width:0}.oldlight-routes button{cursor:pointer}.oldlight-routes button:disabled{opacity:.5;cursor:default}.oldlight-routes :focus-visible{outline:2px solid #79d7dd;outline-offset:2px}.oldlight-routes [hidden]{display:none!important}.oldlight-route-hint{font-size:11px;color:#b5c6d6}.oldlight-route-error{color:#ffb3a7}.oldlight-route-status{color:#a7d9d6}.oldlight-route-tools{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.oldlight-route-editor{border-top:1px solid #415a70;margin-top:9px;padding-top:8px}.oldlight-route-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.oldlight-route-fields label{display:grid;gap:3px;min-width:0}.oldlight-route-ship{display:grid;grid-template-columns:minmax(64px,1fr) minmax(90px,1.3fr) minmax(50px,1fr);gap:6px;align-items:center;margin:6px 0}.oldlight-route-ship input{width:100%}.oldlight-route-row{padding:8px 0;border-top:1px solid #30485a}.oldlight-route-row p{overflow-wrap:anywhere}.oldlight-route-map{display:block;width:100%;height:150px;background:#09131e;border-radius:6px;margin:8px 0}.oldlight-route-map text{fill:#c9dce7;font:10px system-ui,sans-serif}.oldlight-route-map circle{fill:#b7e9ee;stroke:#0c1721;stroke-width:2}.oldlight-route-map line,.oldlight-route-overlay line{stroke:#6be1d3;stroke-width:2;vector-effect:non-scaling-stroke}.oldlight-route-map line[data-paused=true],.oldlight-route-overlay line[data-paused=true]{stroke:#adb6c4;stroke-dasharray:5 4}.oldlight-route-overlay{position:fixed;pointer-events:none;z-index:0;overflow:hidden}.oldlight-route-overlay *{pointer-events:none}.oldlight-route-overlay line[data-preview=true]{stroke-dasharray:4 4}.oldlight-route-row[data-paused=true]{opacity:.8}
@media(max-width:420px){.oldlight-route-fields{grid-template-columns:minmax(0,1fr)}.oldlight-routes button,.oldlight-routes select,.oldlight-routes input{min-height:40px}.oldlight-route-ship{grid-template-columns:minmax(60px,1fr) minmax(90px,1.5fr) minmax(50px,1fr)}}`;
  let sequence = 0;
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const integer = (value, minimum, maximum) => /^(?:0|[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= maximum;
  const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 180) : '';
  const label = system => `${clean(system.name) || 'Sistema'} (${system.q}, ${system.r})`;
  const pointValid = p => p && finite(p.x) && finite(p.y) && p.visible !== false;
  function ownSystems(world, scope, at = Date.now()) {
    if (!scope || !world || world.scope !== scope || world.connected !== true || world.complete !== true
        || scope !== `${world.galaxy}/${world.selfId}` || !world.selfId
        || !Number.isSafeInteger(world.observedAt) || world.observedAt < 0 || world.observedAt > at
        || at - world.observedAt > 120000 || !Array.isArray(world.systems)) return [];
    const ids = new Set(), coords = new Set(), result = [];
    for (const system of world.systems) {
      if (!system || !UUID.test(system.id || '') || !Number.isSafeInteger(system.q) || !Number.isSafeInteger(system.r)) return [];
      const id = system.id.toLowerCase(), key = `${system.q},${system.r}`;
      if (ids.has(id) || coords.has(key)) return [];
      ids.add(id); coords.add(key); result.push({ ...system, id });
    }
    return result;
  }
  function create(options = {}) {
    const document = options.document || globalThis.document;
    const window = options.window || document?.defaultView || globalThis;
    if (!document?.createElement) throw new TypeError('A document is required.');
    const getWorld = options.getWorld || (() => null), getScope = options.getScope || (() => getWorld()?.scope || '');
    const getRoutes = options.getRoutes || (() => []), now = options.now || Date.now;
    const timer = options.setTimeout || window.setTimeout?.bind(window) || setTimeout;
    const clearTimer = options.clearTimeout || window.clearTimeout?.bind(window) || clearTimeout;
    const id = ++sequence, markerId = `oldlight-route-arrow-${id}`, miniMarkerId = markerId + '-mini';
    let root, style, details, list, status, error, availability, editor, mini, overlay, markers, origin, destination, interval, saveButton, mapHint;
    let destroyed = false, scope = null, scopeEpoch = 0, editorScope = '', draftId = null, busy = false, operation = 0;
    let pointerSample = null, intent = null, gestureNotice = null;
    let gesture = null, releaseTimer = null, ignoreClick = null, anchors = new Map(), hoverSample = null;
    let listSignature = '', selectSignature = '', overlaySignature = '', miniSignature = '', frame = null, lastFrame = 0, viewIdentity = '';
    let explicitEndpoints = false;
    let sourceError = '', mapCache = null;
    let lastPaint = null, visualGapAt = null, paintSession = null;
    const readError = () => { try { return clean(options.getError?.() || ''); } catch (_) { return 'No se puede leer el estado de las rutas.'; } };
    const fields = new Map(), listeners = [], diagnosticNodes = new Map(), markerNodes = new Map();
    const helperContains = node => root?.contains?.(node) || markers?.contains?.(node);
    const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
    const svg = tag => document.createElementNS(SVG, tag);
    const attr = (node, key, value) => { const s = String(value); if (node.getAttribute(key) !== s) node.setAttribute(key, s); };
    const write = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
    // SVGElement.hidden is not a reliable reflected property in browsers.
    const hideSVG = (node, hidden) => { node.hidden = hidden; node.style.display = hidden ? 'none' : ''; };
    const call = (name, ...args) => { if (typeof options[name] !== 'function') throw new Error('El guardado de rutas no está disponible.'); return options[name](...args); };
    const listen = (target, name, callback, capture = false) => {
      if (!target?.addEventListener) return;
      target.addEventListener(name, callback, capture); listeners.push(() => target.removeEventListener(name, callback, capture));
    };
    const systems = () => {
      const world = getWorld();
      paintSession = world ? JSON.stringify([world.generation, world.epoch]) : null;
      const identity = `${getScope()}|${world?.epoch ?? ''}|${window.location?.pathname || ''}|${window.location?.search || ''}|${document.querySelector?.('[data-field="nameplate-name"]')?.textContent || ''}`;
      if (identity !== viewIdentity) { viewIdentity = identity; cancelGesture(); invalidateMap(); }
      return ownSystems(world, getScope(), now());
    };
    const routes = () => { const value = getRoutes(); return Array.isArray(value) ? value.filter(route => route && (!route.scope || route.scope === scope)) : []; };
    const button = (text, action) => { const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
    const current = () => !destroyed && root && scope && scope === getScope();
    const report = (message, failed = false) => { write(error, failed ? message : ''); write(status, failed ? '' : message); };
    function reportGesture(message, failed = false) {
      report(message, failed);
      if (gestureNotice) { write(gestureNotice, message); gestureNotice.hidden = !message; gestureNotice.setAttribute('role', failed ? 'alert' : 'status'); }
    }
    function observeScope(next) {
      next = typeof next === 'string' ? next : '';
      if (next === scope) return false;
      scope = next; scopeEpoch++; operation++; busy = false; editorScope = ''; draftId = null; explicitEndpoints = false;
      if (editor) editor.hidden = true;
      cancelGesture(); invalidateMap(); mapCache = null; listSignature = ''; selectSignature = ''; miniSignature = '';
      if (root) report('');
      return true;
    }
    function invalidateMap() {
      lastPaint = null; visualGapAt = null;
      anchors.clear(); hoverSample = null; pointerSample = null; overlaySignature = '';
      if (overlay) { overlay.replaceChildren(); hideSVG(overlay, true); }
      if (markers) { markers.hidden = true; markers.replaceChildren(); markerNodes.clear(); }
    }
    function cancelGesture() {
      const previous = gesture; gesture = null;
      if (gestureNotice) gestureNotice.hidden = true;
      try { if (previous?.capture?.hasPointerCapture?.(previous.pointerId)) previous.capture.releasePointerCapture(previous.pointerId); } catch (_) {}
      if (releaseTimer !== null) clearTimer(releaseTimer);
      releaseTimer = null; overlaySignature = '';
      if (overlay) { overlay.replaceChildren(); hideSVG(overlay, true); }
    }
    function makeMarker(container, name) {
      const defs = svg('defs'), marker = svg('marker'), path = svg('path');
      for (const node of [defs, marker, path]) { node.style.pointerEvents = 'none'; attr(node, 'pointer-events', 'none'); }
      for (const [key, value] of Object.entries({ id: name, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto', markerUnits: 'strokeWidth' })) attr(marker, key, value);
      attr(path, 'd', 'M 0 0 L 8 4 L 0 8 z'); attr(path, 'fill', '#6be1d3'); marker.append(path); defs.append(marker); container.append(defs);
    }
    function addLine(container, from, to, route, marker, preview = false) {
      if (!pointValid(from) || !pointValid(to)) return;
      const length = Math.hypot(to.x - from.x, to.y - from.y); if (length < 2) return;
      const padding = Math.min(9, length / 4), dx = (to.x - from.x) / length, dy = (to.y - from.y) / length;
      const line = svg('line');
      for (const [key, value] of Object.entries({ x1: from.x + dx * padding, y1: from.y + dy * padding,
        x2: to.x - dx * padding, y2: to.y - dy * padding, 'marker-end': `url(#${marker})`, 'data-route-id': route.id || 'draft', 'data-paused': route.paused === true, 'data-preview': preview,
        stroke: route.paused ? '#adb6c4' : '#6be1d3', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke',
        'pointer-events': 'none', ...(preview || route.paused ? { 'stroke-dasharray': preview ? '4 4' : '5 4' } : {}) })) attr(line, key, value);
      line.style.pointerEvents = 'none';
      const title = svg('title'); title.style.pointerEvents = 'none'; title.textContent = preview ? 'Nueva ruta' : `Ruta ${route.paused ? 'pausada' : 'activa'}`; line.append(title); container.append(line);
    }
    function drawMini(rows, items) {
      const signature = JSON.stringify([rows.map(s => [s.id, s.name, s.q, s.r]), items.map(r => [r.id, r.originId, r.destinationId, r.paused])]);
      if (signature === miniSignature) return;
      miniSignature = signature; mini.replaceChildren(); makeMarker(mini, miniMarkerId);
      if (!rows.length) { hideSVG(mini, true); return; }
      hideSVG(mini, false); attr(mini, 'viewBox', '0 0 320 150');
      // A schematic uses axial coordinates only; it never claims native camera alignment.
      const raw = rows.map(s => ({ s, x: s.q + s.r / 2, y: s.r * Math.sqrt(3) / 2 }));
      const xs = raw.map(p => p.x), ys = raw.map(p => p.y), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const scale = Math.min(268 / Math.max(1, maxX - minX), 108 / Math.max(1, maxY - minY));
      const points = new Map(raw.map(p => [p.s.id, { x: 160 + (p.x - (minX + maxX) / 2) * scale, y: 75 + (p.y - (minY + maxY) / 2) * scale }]));
      for (const route of items) addLine(mini, points.get(route.originId), points.get(route.destinationId), route, miniMarkerId);
      for (const s of rows) {
        const point = points.get(s.id), circle = svg('circle'), title = svg('title');
        attr(circle, 'cx', point.x); attr(circle, 'cy', point.y); attr(circle, 'r', 4); title.textContent = label(s); circle.append(title); mini.append(circle);
      }
    }
    function stage() { return options.getMapElement?.() || document.querySelector?.('canvas#stage'); }
    function nativeHover(rows) {
      const node = document.querySelector?.('.star-hover');
      if (!node || node.hidden || node.style?.display === 'none' || node.getClientRects?.().length === 0) return null;
      const name = node.querySelector?.('.star-hover-name')?.textContent;
      if (!name || !rows.length) return null;
      const matches = rows.filter(s => s.name === name);
      if (matches.length !== 1) return null;
      const canvas = stage(), rect = canvas?.getBoundingClientRect?.(), parent = node.parentNode?.getBoundingClientRect?.();
      const left = /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/.test(node.style?.left || '') ? parseFloat(node.style.left) : NaN;
      const top = /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/.test(node.style?.top || '') ? parseFloat(node.style.top) : NaN;
      if (!rect || !parent || !finite(left) || !finite(top) || rect.width <= 0 || rect.height <= 0) return null;
      const point = { x: parent.left + left, y: parent.top + top };
      if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) return null;
      return { system: matches[0], point };
    }
    function sampleHover(rows) {
      const sample = nativeHover(rows);
      if (!sample) { hoverSample = null; return null; }
      const existing = anchors.get(sample.system.id);
      if (existing && Math.hypot(existing.x - sample.point.x, existing.y - sample.point.y) > .5) invalidateMap();
      anchors.set(sample.system.id, sample.point); hoverSample = sample;
      return sample;
    }
    function blocked() {
      return document.hidden === true || !!document.querySelector?.('dialog[open]') || document.body?.classList?.contains('ui-hidden') || options.canInteract?.() === false;
    }
    function pick(event, rows, nativeCard = false) {
      if (nativeCard) {
        const sample = nativeHover(rows);
        return sample && Math.hypot(sample.point.x - event.clientX, sample.point.y - event.clientY) <= 22 ? sample.system : null;
      }
      if (typeof options.hitTestSystem === 'function') {
        const found = options.hitTestSystem({ x: event.clientX, y: event.clientY }, rows);
        const system = rows.find(s => s.id === (typeof found === 'string' ? found : found?.id));
        return system || null;
      }
      const sample = sampleHover(rows);
      return sample && Math.hypot(sample.point.x - event.clientX, sample.point.y - event.clientY) <= 22 ? sample.system : null;
    }
    function projected(system, rect) {
      if (!system) return null;
      const given = options.projectSystem?.(system, { scope, canvas: stage(), rect });
      const point = typeof options.projectSystem === 'function' ? given : anchors.get(system.id);
      return pointValid(point) ? { x: point.x - rect.left, y: point.y - rect.top, visible: point.visible } : null;
    }
    function placeOverlay(canvas) {
      const parent = canvas?.parentNode;
      if (!canvas || canvas.isConnected === false || !parent || typeof parent.insertBefore !== 'function') return false;
      // Native #stage is unpositioned; its later #hud sibling is absolute/auto.
      // At z-index 0, DOM order keeps us above the canvas and below even auto
      // HUD layers, not just positive-z panels. Reattach after native remounts.
      try {
        if (overlay.parentNode !== parent || canvas.nextSibling !== overlay) parent.insertBefore(overlay, canvas.nextSibling);
        // A positioned zero-layer control paints above the unpositioned canvas,
        // while its DOM position before the canvas keeps it below the native HUD.
        if (markers && (markers.parentNode !== parent || markers.nextSibling !== canvas)) parent.insertBefore(markers, canvas);
        return true;
      } catch (_) { return false; }
    }
    function drawOverlay() {
      if (!overlay || destroyed) return;
      observeScope(getScope());
      if (holdVisualGap()) return;
      const canvas = stage(), rect = canvas?.getBoundingClientRect?.();
      if ((!current() && !gesture) || blocked() || !rect || rect.width <= 0 || rect.height <= 0 || canvas.hidden || !placeOverlay(canvas)) { hideSVG(overlay, true); if (markers) markers.hidden = true; return; }
      const at = now();
      if (!mapCache || mapCache.scope !== scope || at < mapCache.at || at - mapCache.at >= 500) {
        const items = routes();
        mapCache = { scope, at, items, rows: (gesture || items.length) ? systems() : [] };
      }
      const { rows, items } = mapCache;
      if (!gesture && !items.length) { hideSVG(overlay, true); if (markers) markers.hidden = true; return; }
      sampleHover(rows);
      const byId = new Map(rows.map(s => [s.id, s]));
      const segments = items.map(route => ({ route, from: projected(byId.get(route.originId), rect), to: projected(byId.get(route.destinationId), rect) })).filter(s => pointValid(s.from) && pointValid(s.to));
      // A screen-space gesture preview expresses intent, not a verified route.
      // Persisted routes above continue to require a current camera projection.
      if (gesture && gesture.scope === scope) segments.push({ route: { id: 'draft' }, from: { x: gesture.sourceX - rect.left, y: gesture.sourceY - rect.top }, to: { x: gesture.x - rect.left, y: gesture.y - rect.top }, preview: true });
      // Runtime counters and scheduling timestamps do not change a line. Keep
      // its SVG nodes when the actual endpoints/style are unchanged.
      const signature = JSON.stringify([rect.left, rect.top, rect.width, rect.height,
        segments.map(s => [s.route.id, s.route.paused, s.from, s.to, !!s.preview])]);
      hideSVG(overlay, !segments.length);
      drawMarkers(segments.filter(segment => !segment.preview), rect);
      if (segments.length && !gesture) lastPaint = { scope, session: paintSession, path: window.location?.pathname || '', canvas,
        rect: JSON.stringify([rect.left, rect.top, rect.width, rect.height]),
        routes: JSON.stringify(items.map(route => [route.id, route.originId, route.destinationId, route.paused])),
        rows, geometry: JSON.stringify(segments.map(segment => [segment.route.id, segment.from, segment.to])) };
      else lastPaint = null;
      visualGapAt = null; attr(overlay, 'data-census-pending', 'false');
      if (signature === overlaySignature) return;
      overlaySignature = signature; overlay.replaceChildren();
      Object.assign(overlay.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      attr(overlay, 'viewBox', `0 0 ${rect.width} ${rect.height}`); makeMarker(overlay, markerId);
      for (const segment of segments) addLine(overlay, segment.from, segment.to, segment.route, markerId, segment.preview);
    }
    function holdVisualGap() {
      let pending = false;
      try { pending = options.isCensusPending?.(scope, lastPaint?.session ?? null) === true; } catch (_) { /* No presentation fallback. */ }
      if (!pending) { visualGapAt = null; return false; }
      const deny = () => { invalidateMap(); mapCache = null; return false; };
      // A maximum 100 ms of unchanged decorative geometry may bridge one native
      // publication gap. No cached world is exposed to gestures, editor or Send.
      const at = now();
      if (!Number.isSafeInteger(at) || at < 0) return deny();
      if (visualGapAt === null) visualGapAt = at;
      if (!lastPaint || gesture || !current() || blocked() || at < visualGapAt || at - visualGapAt > 100
        || lastPaint.scope !== scope || lastPaint.path !== (window.location?.pathname || '')
        || typeof options.projectSystem !== 'function') return deny();
      const canvas = stage(), rect = canvas?.getBoundingClientRect?.();
      if (canvas !== lastPaint.canvas || canvas?.isConnected === false || canvas?.hidden || !rect
        || JSON.stringify([rect.left, rect.top, rect.width, rect.height]) !== lastPaint.rect || !placeOverlay(canvas)) return deny();
      const items = routes();
      if (JSON.stringify(items.map(route => [route.id, route.originId, route.destinationId, route.paused])) !== lastPaint.routes) return deny();
      const byId = new Map(lastPaint.rows.map(system => [system.id, system]));
      const geometry = items.map(route => ({ route, from: projected(byId.get(route.originId), rect), to: projected(byId.get(route.destinationId), rect) }))
        .filter(segment => pointValid(segment.from) && pointValid(segment.to));
      if (JSON.stringify(geometry.map(segment => [segment.route.id, segment.from, segment.to])) !== lastPaint.geometry) return deny();
      for (const node of markerNodes.values()) node.disabled = true;
      attr(overlay, 'data-census-pending', 'true');
      return true;
    }
    function openRoute(id) {
      observeScope(getScope()); if (!current() || busy) return;
      const route = routes().find(item => item.id === id);
      if (!route) { reportGesture('La ruta ya no existe en esta cuenta y galaxia.', true); return; }
      if (!editor.hidden && editorScope === scope && draftId === id) {
        // Repeated marker activation must not replace an unsaved draft.
        details.open = true;
        try { options.onOpen?.({ routeId: id, originId: route.originId, destinationId: route.destinationId }); }
        catch (_) { reportGesture('No se pudo mostrar la configuración. Abre Flota y Misiones en el Helper.', true); return; }
      } else showEditor(route.originId, route.destinationId, route);
      const nodes = diagnosticNodes.get(id);
      nodes?.reason?.scrollIntoView?.({ block: 'nearest' });
    }
    function drawMarkers(segments, rect) {
      if (!markers) return;
      const keep = new Set();
      for (const [index, segment] of segments.entries()) {
        const fraction = .45 + (index % 3) * .1;
        const x = rect.left + segment.from.x + (segment.to.x - segment.from.x) * fraction;
        const y = rect.top + segment.from.y + (segment.to.y - segment.from.y) * fraction;
        if (!finite(x) || !finite(y) || x < rect.left + 28 || x > rect.right - 28 || y < rect.top + 18 || y > rect.bottom - 18) continue;
        const id = segment.route.id; keep.add(id);
        let node = markerNodes.get(id);
        if (!node) {
          const epoch = scopeEpoch;
          node = button('Ruta', event => { if (!node.disabled && trusted(event) && current() && epoch === scopeEpoch) openRoute(id); });
          node.dataset.routeMarker = id;
          Object.assign(node.style, { position: 'fixed', pointerEvents: 'auto', transform: 'translate(-50%,-50%)', minHeight: '32px', padding: '4px 8px', border: '1px solid #79d7dd', borderRadius: '8px', background: '#101d29', color: '#e5eef6', font: '12px system-ui,sans-serif', cursor: 'pointer' });
          markers.append(node); markerNodes.set(id, node);
        }
        const name = clean(segment.route.name) || `Ruta ${index + 1}`;
        node.setAttribute('aria-label', `Abrir resumen y configuración: ${name}`);
        node.title = `Abrir resumen y configuración: ${name}. No envía naves.`;
        node.disabled = false;
        node.style.left = `${x}px`; node.style.top = `${y}px`;
      }
      for (const [id, node] of markerNodes) if (!keep.has(id)) { node.remove(); markerNodes.delete(id); }
      markers.hidden = keep.size === 0;
    }
    function showEditor(originId, destinationId, route = null, unresolved = false) {
      observeScope(getScope()); if (!current() || busy) return;
      const rows = systems(); if (rows.length < 2) { report('Se necesitan dos sistemas propios verificados.', true); return; }
      editorScope = scope; draftId = route?.id || null; editor.hidden = false; details.open = true; explicitEndpoints = unresolved;
      populateSelects(rows);
      if (unresolved) {
        for (const select of [origin, destination]) select.value = '';
      } else { origin.value = originId || rows[0].id; destination.value = destinationId || rows.find(s => s.id !== origin.value)?.id || ''; }
      interval.value = String(route?.intervalMinutes || 5);
      for (const type of SHIPS) {
        const cfg = route?.ships?.[type], f = fields.get(type);
        f.mode.value = cfg?.mode === 'excess' ? 'excess' : 'fixed';
        f.amount.value = String(cfg?.mode === 'excess' ? cfg.reserve || 0 : cfg?.amount || 0);
        updateShip(type);
      }
      saveButton.textContent = draftId ? 'Guardar cambios' : 'Crear ruta';
      reportGesture(unresolved ? 'No se identificó el origen del arrastre. Elige explícitamente ambos sistemas propios; no se ha creado ninguna ruta.' : 'Revisa los extremos y la composición antes de guardar.');
      const openingEpoch = scopeEpoch;
      try { options.onOpen?.({ originId: origin.value, destinationId: destination.value, routeId: draftId }); }
      catch (_) { reportGesture('No se pudo mostrar la configuración de la ruta. Abre Flota y Misiones en el Helper.', true); return; }
      observeScope(getScope());
      if (current() && openingEpoch === scopeEpoch && !editor.hidden && editorScope === scope) origin.focus?.();
    }
    function updateShip(type) {
      const f = fields.get(type), excess = f.mode.value === 'excess';
      f.amount.setAttribute('aria-label', `${excess ? 'Reserva' : 'Cantidad'} de ${LABELS[type]}`);
      f.amount.max = excess ? '1000000000' : '50000';
      f.amount.title = excess ? 'Dejar esta cantidad en el origen; enviar el excedente disponible.' : 'Cantidad por envío; cero desactiva este tipo.';
    }
    function populateSelects(rows) {
      const signature = JSON.stringify([explicitEndpoints, rows.map(s => [s.id, s.q, s.r, s.name])]);
      if (signature === selectSignature) return;
      selectSignature = signature;
      for (const select of [origin, destination]) {
        const previous = select.value; select.replaceChildren();
        if (explicitEndpoints) { const placeholder = el('option', 'Elige un sistema propio'); placeholder.value = ''; select.append(placeholder); }
        for (const system of rows) { const option = el('option', label(system)); option.value = system.id; select.append(option); }
        if (rows.some(s => s.id === previous)) select.value = previous;
        else if (explicitEndpoints) select.value = '';
      }
    }
    function save() {
      const previousScope = editorScope; observeScope(getScope());
      if (!current() || busy || editor.hidden || !previousScope || previousScope !== scope || editorScope !== scope) return;
      const rows = systems(), ids = new Set(rows.map(s => s.id));
      if (!ids.has(origin.value) || !ids.has(destination.value) || origin.value === destination.value) { report('Elige dos sistemas propios distintos y verificados.', true); return; }
      if (!integer(interval.value, 1, 1440)) { report('El intervalo debe ser de 1 a 1440 minutos enteros.', true); return; }
      const ships = {}; let enabled = false;
      for (const type of SHIPS) {
        const f = fields.get(type), mode = f.mode.value;
        if (!['fixed', 'excess'].includes(mode) || !integer(f.amount.value, 0, mode === 'fixed' ? 50000 : 1000000000)) { report('Usa enteros: cantidad entre 0 y 50000; reserva entre 0 y 1000000000.', true); return; }
        ships[type] = { mode, amount: mode === 'fixed' ? Number(f.amount.value) : 0, reserve: mode === 'excess' ? Number(f.amount.value) : 0 };
        enabled ||= mode === 'excess' || Number(f.amount.value) > 0;
      }
      if (!enabled) { report('Indica al menos una cantidad o un tipo con excedente.', true); return; }
      const existing = draftId ? routes().find(route => route.id === draftId) : null;
      if (draftId && !existing) { report('La ruta ya no existe. Ábrela de nuevo para editarla.', true); return; }
      const next = { ...(draftId ? { id: draftId } : {}), ...(typeof existing?.name === 'string' ? { name: existing.name } : {}), originId: origin.value, destinationId: destination.value,
        intervalMinutes: Number(interval.value), ships, paused: existing?.paused === true };
      act(() => call('onSave', next), () => { editor.hidden = true; editorScope = ''; draftId = null; report('Ruta guardada.'); });
    }
    function act(callback, success) {
      observeScope(getScope()); if (!current() || busy) return;
      const failure = readError(); if (failure) { report(failure, true); return; }
      const epoch = scopeEpoch, token = ++operation; busy = true; updateDisabled();
      const done = (result, cause) => {
        observeScope(getScope()); if (destroyed || epoch !== scopeEpoch || token !== operation) return;
        busy = false;
        if (cause || result === false || result?.ok === false) report(clean(cause?.message || result?.message || result?.reason) || 'No se pudo guardar el cambio.', true);
        else success();
        listSignature = ''; render();
      };
      try { const result = callback(); if (result?.then) Promise.resolve(result).then(value => done(value), cause => done(null, cause)); else done(result); }
      catch (cause) { done(null, cause); }
    }
    function updateDisabled() {
      if (!root) return;
      for (const node of root.querySelectorAll?.('button, input, select') || []) node.disabled = busy || node.dataset.routeBlocked === 'true';
    }
    function render() {
      if (!root || destroyed) return;
      observeScope(getScope());
      const previousError = sourceError; sourceError = readError();
      if (sourceError) write(error, sourceError); else if (previousError && error.textContent === previousError) write(error, '');
      const capability = options.getAvailability?.();
      const measured = capability?.cameraGeometry, dimensions = ['nativeWidth', 'nativeHeight', 'cssWidth', 'cssHeight'];
      const geometryHint = capability?.cameraReason === 'native-viewport-size-mismatch' && measured
        && dimensions.every(key => finite(measured[key]) && measured[key] > 0 && measured[key] <= 100000)
        ? ` Cámara ${Number(measured.nativeWidth.toFixed(4))} × ${Number(measured.nativeHeight.toFixed(4))}; lienzo ${Number(measured.cssWidth.toFixed(4))} × ${Number(measured.cssHeight.toFixed(4))} px CSS.` : '';
      write(mapHint, typeof options.projectSystem === 'function'
        ? capability?.cameraAvailable === false ? `Flechas del mapa principal ocultas: ${capability.cameraReason === 'native-viewport-size-mismatch' ? 'el tamaño de la cámara no coincide con el lienzo' : 'cámara no disponible'}${capability.cameraReason ? ' (' + clean(capability.cameraReason) + ')' : ''}.${geometryHint} El esquema de arriba sigue disponible. Puedes crear o editar rutas con los selectores, o iniciar Ctrl + arrastre sobre la ficha de un sistema propio.` : 'Las flechas del mapa principal siguen la cámara y el zoom con posiciones verificadas. El esquema de arriba es independiente de la cámara.'
        : 'Esquema por coordenadas. Las flechas sobre el mapa principal aparecen con posiciones verificadas; se ocultan al mover o ampliar la vista.');
      write(availability, capability?.coordinated === false ? 'Envíos bloqueados: este navegador no ofrece Web Locks para coordinar las pestañas.' : 'Los envíos necesitan datos recientes y coordinación Web Locks entre pestañas.');
      const holding = holdVisualGap();
      const rows = holding ? lastPaint.rows : systems(), items = routes(), byId = new Map(rows.map(s => [s.id, s]));
      mapCache = { scope, at: now(), rows, items };
      populateSelects(rows); drawMini(rows, items);
      const signature = JSON.stringify([scope, sourceError, rows.map(s => [s.id, s.name, s.q, s.r]), items]);
      if (signature !== listSignature) {
        listSignature = signature; list.replaceChildren(); diagnosticNodes.clear();
        if (sourceError) list.append(el('p', 'Las rutas están bloqueadas hasta recuperar su estado local.', 'oldlight-route-error'));
        else if (!scope || !rows.length) list.append(el('p', 'Esperando el censo propio de la cuenta y galaxia actuales.', 'oldlight-route-hint'));
        else if (!items.length) list.append(el('p', 'Aún no hay rutas de refuerzo.', 'oldlight-route-hint'));
        for (const route of items) {
          const rowEpoch = scopeEpoch;
          const row = el('div', undefined, 'oldlight-route-row'); row.dataset.paused = String(route.paused === true);
          const source = byId.get(route.originId), target = byId.get(route.destinationId);
          row.append(el('p', `${source ? label(source) : 'Origen no verificado'} → ${target ? label(target) : 'Destino no verificado'}`));
          const composition = SHIPS.flatMap(type => {
            const s = route.ships?.[type]; if (!s) return [];
            if (s.mode === 'excess') return [`${LABELS[type]}: excedente, reserva ${s.reserve || 0}`];
            return s.amount > 0 ? [`${s.amount} ${LABELS[type]}`] : [];
          }).join(' · ');
          row.append(el('p', `${route.needsReview ? 'Revisión necesaria' : route.paused ? 'Pausada' : route.status === 'queued' ? 'En cola' : 'Activa'} · cada ${route.intervalMinutes} min${composition ? ' · ' + composition : ''}`, 'oldlight-route-hint'));
          if (route.needsReview) row.append(el('p', 'Comprueba los movimientos del juego. Marcar como revisado descarta este intento local, conserva la ruta pausada y exige un nuevo intervalo y censo; no se repetirá el envío automáticamente.', 'oldlight-route-hint'));
          if (route.message) row.append(el('p', clean(route.message), route.needsReview ? 'oldlight-route-error' : 'oldlight-route-hint'));
          const reason = el('p', '', 'oldlight-route-status'), checked = el('p', '', 'oldlight-route-hint');
          const eta = el('p', '', 'oldlight-route-status'); eta.dataset.routeEta = route.id;
          const lastSend = el('p', '', 'oldlight-route-hint');
          reason.dataset.routeDiagnostic = route.id;
          row.append(eta, reason, checked, lastSend);
          diagnosticNodes.set(route.id, { reason, checked, lastSend, eta });
          const controls = el('div', undefined, 'oldlight-route-tools');
          controls.append(button('Editar', () => { if (current() && rowEpoch === scopeEpoch) showEditor(route.originId, route.destinationId, routes().find(r => r.id === route.id)); }),
            button(route.paused ? 'Reanudar' : 'Pausar', () => { if (!current() || rowEpoch !== scopeEpoch) return; const latest = routes().find(r => r.id === route.id); if (latest) act(() => call('onPause', route.id, !latest.paused), () => report(latest.paused ? 'Ruta reanudada.' : 'Ruta pausada.')); }),
            button('Eliminar', () => { if (current() && rowEpoch === scopeEpoch && routes().some(r => r.id === route.id)) act(() => call('onDelete', route.id), () => report('Ruta eliminada.')); }));
          const sendNow = button('Enviar ahora', event => {
            if (!trusted(event) || !current() || rowEpoch !== scopeEpoch) return;
            const latest = routes().find(item => item.id === route.id);
            if (!latest || latest.paused || latest.needsReview || latest.ticket) { report('Ruta pausada, en revisión o con envío pendiente. No se reanuda ni se duplica.', true); return; }
            act(() => call('onSendNow', route.id), () => report('Solicitud preparada en la cola. El envío conserva sus comprobaciones nativas y de protección.'));
          });
          sendNow.title = 'Omite solo el intervalo. Envía lo disponible de los tipos configurados, hasta la cantidad fija y dejando la reserva. Requiere seleccionar el origen y superar las demás comprobaciones.';
          sendNow.dataset.routeBlocked = String(!!(route.paused || route.needsReview || route.ticket));
          controls.append(sendNow);
          if (route.needsReview) for (const control of controls.querySelectorAll('button')) {
            control.dataset.routeBlocked = 'true';
            control.title = 'Comprueba el envío y completa primero la revisión de la ruta.';
          }
          if (route.needsReview) controls.append(button('He revisado el envío', () => {
            if (!current() || rowEpoch !== scopeEpoch || !routes().find(r => r.id === route.id)?.needsReview) return;
            act(() => call('onAcknowledge', route.id), () => report('Envío revisado. La ruta sigue pausada; deberá esperar su intervalo y datos nuevos.'));
          }));
          row.append(controls); list.append(row);
        }
      }
      // Refresh just the text; ticking checks must not replace focused controls.
      let diagnostics;
      try { diagnostics = options.getDiagnostics?.(); } catch (_) { diagnostics = { error: 'No se puede comprobar el estado actual de envío.' }; }
      const formatTime = at => Number.isSafeInteger(at) && at >= 0 && at <= 8640000000000000
        ? new Date(at).toLocaleTimeString() : '';
      for (const [id, nodes] of diagnosticNodes) {
        const diagnostic = diagnostics?.routes?.find(item => item.id === id);
        const route = items.find(item => item.id === id), at = now(), next = diagnostic?.nextRunAt ?? route?.nextRunAt;
        const seconds = Number.isSafeInteger(next) && next >= 0 && finite(at) ? Math.max(0, Math.ceil((next - at) / 1000)) : null;
        const duration = seconds === null ? '' : `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        write(nodes.eta, route?.paused || route?.needsReview ? 'Cuenta atrás suspendida: la ruta no se reanudará automáticamente.'
          : route?.ticket ? 'Envío pendiente: esperando comprobaciones y confirmación.'
          : seconds === null ? 'ETA de comprobación sin verificar.' : seconds > 0
            ? `Próxima comprobación en ${duration}. No garantiza un envío.` : 'Intervalo vencido: próxima comprobación pendiente. No garantiza un envío.');
        write(nodes.reason, clean(diagnostic?.message || diagnostics?.error || 'Motivo actual de espera no disponible.'));
        const checked = formatTime(diagnostic?.checkedAt ?? diagnostics?.checkedAt);
        write(nodes.checked, checked ? `Comprobación local: ${checked}. No confirma un envío ni actividad en la partida.` : 'Sin comprobación local disponible.');
        const sent = formatTime(diagnostic?.lastSentAt);
        write(nodes.lastSend, diagnostic ? sent ? `Último envío confirmado: ${sent}.` : 'Último envío confirmado: ninguno registrado.' : 'Último envío confirmado: sin verificar.');
      }
      updateDisabled(); drawOverlay();
    }
    function swallow(event) { event.preventDefault?.(); event.stopImmediatePropagation?.(); }
    function trusted(event) { return options.requireTrustedEvents === false || event.isTrusted === true; }
    function down(event) {
      if (destroyed) return;
      const canvas = stage();
      if (!trusted(event)) { if (!helperContains(event.target)) { cancelGesture(); invalidateMap(); } return; }
      if (intent && event.type === 'mousedown') { swallow(event); return; }
      if (event.target !== canvas) { if (!helperContains(event.target)) { cancelGesture(); invalidateMap(); } return; }
      if (!event.ctrlKey || event.shiftKey || event.metaKey || event.altKey || event.button !== 0 || (event.pointerType && event.pointerType !== 'mouse')) { intent = null; cancelGesture(); invalidateMap(); return; }
      // Reserve only this exact map gesture, independently of route authority.
      // Missing census/camera must never turn a requested route into native pan.
      const rect = canvas?.getBoundingClientRect?.();
      if (!canvas || canvas.hidden || canvas.style?.display === 'none' || canvas.getClientRects?.().length === 0
          || !rect || rect.width <= 0 || rect.height <= 0 || !inside(event) || blocked()) return;
      swallow(event);
      intent = { pointerId: event.pointerId, canvas };
      let interactionFailed = false;
      try { options.onInteraction?.(event); } catch (_) { interactionFailed = true; }
      try {
      observeScope(getScope());
      const freshRows = systems();
      let picked = null, nativeCard = false, reason = '';
      if (!current()) reason = 'No se pudo verificar la cuenta y galaxia actuales. Abre de nuevo el mapa y espera a que el Helper las reconozca.';
      else if (busy) reason = 'Hay un cambio de ruta pendiente. Espera a que termine.';
      else if (!freshRows.length) reason = 'No hay un censo propio completo y reciente. Espera a que se recuperen los datos antes de elegir los extremos.';
      else {
        picked = pick(event, freshRows);
        const cameraUnavailable = options.getAvailability?.()?.cameraAvailable === false;
        if (!picked && cameraUnavailable && pointerSample?.canvas === canvas
            && now() - pointerSample.at >= 300 && now() - pointerSample.at <= 30000
            && Math.hypot(event.clientX - pointerSample.x, event.clientY - pointerSample.y) <= 3) {
          picked = pick(event, freshRows, true); nativeCard = !!picked;
        }
        if (!picked) reason = cameraUnavailable
          ? 'Cámara no disponible: el origen no está verificado. Puedes arrastrar; al soltar elegirás ambos sistemas propios.'
          : 'No se identificó un sistema propio en el inicio. Al soltar podrás elegir ambos sistemas propios.';
      }
      if (interactionFailed) { picked = null; reason = 'No se pudo preparar el gesto de refuerzo. Elige los extremos manualmente.'; }
      mapCache = { scope, at: now(), rows: freshRows, items: routes() };
      gesture = { originId: picked?.id || null, scope, nativeCard, capture: canvas, pointerId: event.pointerId, x: event.clientX, y: event.clientY, sourceX: event.clientX, sourceY: event.clientY, moved: false, manual: !picked };
      if (event.pointerId !== undefined) { try { canvas.setPointerCapture?.(event.pointerId); } catch (_) {} }
      reportGesture(reason || (nativeCard ? 'Origen verificado por ficha nativa. Suelta sobre otro sistema propio; las flechas guardadas esperan una cámara verificada.' : 'Arrastra hasta otro sistema propio y suelta para configurar la ruta.'), !!reason);
      drawOverlay();
      } catch (_) { cancelGesture(); reportGesture('No se pudieron leer los datos del mapa. El gesto se ha detenido; vuelve a intentarlo cuando el Helper recupere sus datos.', true); }
    }
    function inside(event) {
      const rect = stage()?.getBoundingClientRect?.();
      return rect && event.clientX >= rect.left && event.clientX <= rect.left + rect.width
        && event.clientY >= rect.top && event.clientY <= rect.top + rect.height;
    }
    function move(event) {
      if (!trusted(event)) return;
      if (!gesture) {
        if (event.target === stage() && (!event.buttons) && (!event.pointerType || event.pointerType === 'mouse')) {
          if (!pointerSample || Math.hypot(event.clientX - pointerSample.x, event.clientY - pointerSample.y) > 3)
            pointerSample = { canvas: stage(), x: event.clientX, y: event.clientY, at: now() };
        } else pointerSample = null;
        return;
      }
      if (gesture.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== gesture.pointerId) return;
      systems(); if (!gesture) { drawOverlay(); return; }
      if (!event.ctrlKey || !inside(event) || blocked() || scope !== getScope()) { cancelGesture(); drawOverlay(); return; }
      if (releaseTimer !== null) {
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 3) { cancelGesture(); drawOverlay(); }
        return;
      }
      gesture.x = event.clientX; gesture.y = event.clientY;
      gesture.moved ||= Math.hypot(gesture.x - gesture.sourceX, gesture.y - gesture.sourceY) > 4;
      drawOverlay();
      // Leave pointermove untouched: without native pointerdown, Pixi only
      // updates hover. This gives a fresh destination card without selecting it.
    }
    function up(event) {
      if (!trusted(event) || event.button !== 0) return;
      if (intent && (intent.pointerId === undefined || event.pointerId === undefined || event.pointerId === intent.pointerId)) {
        swallow(event); intent = null;
        ignoreClick = { until: now() + 700, x: event.clientX, y: event.clientY };
      }
      if (!gesture) return;
      if (gesture.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== gesture.pointerId) return;
      swallow(event);
      if (releaseTimer !== null) return;
      const active = gesture;
      // Pointer capture is implicitly released after pointerup. Its resulting
      // lostpointercapture must not cancel the delayed native-hover check.
      active.released = true;
      try { if (active.capture?.hasPointerCapture?.(active.pointerId)) active.capture.releasePointerCapture(active.pointerId); } catch (_) {}
      ignoreClick = { until: now() + 700, x: event.clientX, y: event.clientY };
      if (!event.ctrlKey || event.target !== stage() || !inside(event) || !active.moved || blocked() || active.scope !== getScope()) { cancelGesture(); drawOverlay(); return; }
      if (active.manual) {
        const rows = systems();
        if (gesture !== active) { drawOverlay(); return; }
        cancelGesture();
        if (rows.length >= 2 && current() && !busy) showEditor('', '', null, true);
        else reportGesture('No hay dos sistemas propios verificados disponibles. Espera al censo propio y usa Nueva ruta.', true);
        drawOverlay(); return;
      }
      const endpoint = { clientX: event.clientX, clientY: event.clientY };
      const finish = () => {
        releaseTimer = null;
        if (gesture !== active || active.scope !== getScope() || blocked()) { cancelGesture(); drawOverlay(); return; }
        const rows = systems();
        if (gesture !== active || !rows.some(row => row.id === active.originId)) { cancelGesture(); drawOverlay(); return; }
        const picked = pick(endpoint, rows, active.nativeCard); cancelGesture();
        if (picked && picked.id !== active.originId) showEditor(active.originId, picked.id);
        else reportGesture('No se pudo verificar el destino. Mantén el puntero sobre su ficha o elígelo en Nueva ruta.', true);
        drawOverlay();
      };
      const picked = pick(endpoint, systems(), active.nativeCard);
      if (picked && picked.id !== active.originId) finish();
      else releaseTimer = timer(finish, 320); // Native own-system hover delay is 250 ms.
    }
    function installMap() {
      for (const name of ['pointerdown', 'mousedown']) listen(window, name, down, true);
      for (const name of ['pointermove', 'mousemove']) listen(window, name, move, true);
      for (const name of ['pointerup', 'mouseup']) listen(window, name, up, true);
      listen(window, 'click', event => {
        if (ignoreClick && event.target === stage() && now() < ignoreClick.until && Math.hypot(event.clientX - ignoreClick.x, event.clientY - ignoreClick.y) < 12) { ignoreClick = null; swallow(event); return; }
        if (!helperContains(event.target)) { cancelGesture(); invalidateMap(); }
      }, true);
      listen(window, 'keydown', event => {
        if (event.key === 'Escape') { cancelGesture(); if (gestureNotice) gestureNotice.hidden = true; drawOverlay(); }
        else if (!['Control', 'Shift', 'Alt', 'Meta'].includes(event.key) && !helperContains(event.target)) { cancelGesture(); invalidateMap(); }
      }, true);
      listen(window, 'keyup', event => { if (event.key === 'Control') { cancelGesture(); drawOverlay(); } }, true);
      for (const name of ['wheel', 'resize', 'scroll', 'blur', 'pointercancel', 'pagehide', 'popstate', 'hashchange']) listen(window, name, () => { cancelGesture(); invalidateMap(); if (gestureNotice) gestureNotice.hidden = true; if (['blur', 'pointercancel', 'pagehide'].includes(name)) intent = null; }, true);
      listen(window, 'lostpointercapture', event => { if (gesture && !gesture.released && (event.pointerId === undefined || gesture.pointerId === event.pointerId)) { cancelGesture(); invalidateMap(); } }, true);
      listen(window, 'pointerleave', event => { if (gesture && event.target === stage()) { cancelGesture(); invalidateMap(); } }, true);
      listen(window, 'pointerout', event => { if (gesture && (event.relatedTarget === null || !inside(event))) { cancelGesture(); invalidateMap(); } }, true);
      listen(document, 'visibilitychange', () => { cancelGesture(); invalidateMap(); });
      const tick = timestamp => {
        if (destroyed) return;
        if (timestamp - lastFrame >= 80) { lastFrame = timestamp; drawOverlay(); }
        frame = window.requestAnimationFrame?.(tick) || null;
      };
      frame = window.requestAnimationFrame?.(tick) || null;
    }
    function mount(container) {
      if (destroyed) throw new Error('Panel has been destroyed.');
      if (root) { if (root.parentNode !== container) container.append(root); render(); return root; }
      root = el('section', undefined, 'oldlight-routes'); root.setAttribute('aria-label', 'Rutas de refuerzo');
      style = el('style', CSS); details = el('details'); details.append(el('summary', 'Rutas de refuerzo'));
      details.append(el('p', 'Ctrl + arrastrar entre dos sistemas propios abre una ruta. También puedes elegirlos aquí.', 'oldlight-route-hint'));
      const tools = el('div', undefined, 'oldlight-route-tools'); tools.append(button('Nueva ruta', () => showEditor())); details.append(tools);
      status = el('p', '', 'oldlight-route-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      error = el('p', '', 'oldlight-route-error'); error.setAttribute('role', 'alert'); details.append(status, error);
      availability = el('p', '', 'oldlight-route-hint'); details.append(availability);
      details.append(el('p', 'Enviar ahora omite solo el intervalo: selecciona el origen y envía lo disponible de los tipos configurados, hasta su cantidad fija y dejando la reserva. No reanuda rutas pausadas ni elimina bloqueos.', 'oldlight-route-hint'));
      details.append(el('p', 'Esquema de rutas · independiente de la cámara', 'oldlight-route-hint'));
      mini = svg('svg'); mini.classList?.add('oldlight-route-map'); attr(mini, 'role', 'img'); attr(mini, 'aria-label', 'Esquema de rutas entre sistemas propios'); details.append(mini);
      mapHint = el('p', '', 'oldlight-route-hint'); details.append(mapHint);
      list = el('div'); details.append(list);
      editor = el('div', undefined, 'oldlight-route-editor'); editor.hidden = true;
      editor.append(el('strong', 'Configurar ruta'));
      const inputs = el('div', undefined, 'oldlight-route-fields');
      const makeField = (title, node) => { const wrapper = el('label', title); node.setAttribute('aria-label', title); wrapper.append(node); inputs.append(wrapper); return node; };
      origin = makeField('Sistema de origen', el('select')); destination = makeField('Sistema de destino', el('select'));
      interval = makeField('Intervalo en minutos', el('input')); interval.type = 'number'; interval.min = '1'; interval.max = '1440'; interval.step = '1';
      editor.append(inputs);
      for (const type of SHIPS) {
        const row = el('div', undefined, 'oldlight-route-ship'), mode = el('select'), amount = el('input');
        mode.setAttribute('aria-label', `Modo de ${LABELS[type]}`);
        for (const [value, text] of [['fixed', 'Cantidad fija'], ['excess', 'Excedente']]) { const option = el('option', text); option.value = value; mode.append(option); }
        mode.value = 'fixed'; amount.type = 'number'; amount.min = '0'; amount.max = '1000000000'; amount.step = '1'; amount.value = '0';
        fields.set(type, { mode, amount }); mode.addEventListener('change', () => updateShip(type)); updateShip(type);
        row.append(el('span', LABELS[type]), mode, amount); editor.append(row);
      }
      editor.append(el('p', 'Cantidad fija: espera a disponer de la cantidad completa por envío. Excedente: envía lo disponible dejando la reserva indicada.', 'oldlight-route-hint'));
      const controls = el('div', undefined, 'oldlight-route-tools'); saveButton = button('Crear ruta', save);
      controls.append(saveButton, button('Cancelar', () => { if (busy) return; editor.hidden = true; editorScope = ''; draftId = null; report(''); })); editor.append(controls); details.append(editor);
      root.append(style, details); container.append(root);
      gestureNotice = el('div', '', 'oldlight-route-gesture-notice'); gestureNotice.hidden = true;
      gestureNotice.setAttribute('aria-live', 'polite');
      Object.assign(gestureNotice.style, { position: 'fixed', bottom: '18px', left: '50%', transform: 'translateX(-50%)', maxWidth: 'min(600px,90vw)', padding: '10px 14px', background: '#101d29', color: '#e5eef6', border: '1px solid #79d7dd', borderRadius: '8px', zIndex: '2147483646', pointerEvents: 'none', font: '13px/1.4 system-ui,sans-serif' });
      (document.body || container).append(gestureNotice);
      markers = el('div'); markers.setAttribute('aria-label', 'Accesos a rutas de refuerzo'); markers.setAttribute('role', 'group');
      options.onControlRoot?.(markers);
      markers.className = 'oldlight-route-markers'; markers.hidden = true;
      Object.assign(markers.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '0' });
      overlay = svg('svg'); overlay.classList?.add('oldlight-route-overlay'); attr(overlay, 'aria-hidden', 'true');
      // The panel may live in Helper's ShadowRoot, but the arrow belongs beside
      // the native canvas, below its UI. Inline paint crosses no shadow boundary.
      Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: '0', overflow: 'hidden' });
      attr(overlay, 'pointer-events', 'none'); hideSVG(overlay, true); placeOverlay(stage());
      installMap(); render(); return root;
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true; operation++; cancelGesture();
      if (frame !== null) window.cancelAnimationFrame?.(frame);
      for (const remove of listeners.splice(0)) remove();
      root?.remove(); overlay?.remove(); markers?.remove(); markerNodes.clear(); gestureNotice?.remove(); intent = null; anchors.clear();
    }
    return Object.freeze({ mount, render, observeScope, open: showEditor, openRoute, containsControl: node => markers?.contains?.(node) === true, cancelGesture, invalidateMap, destroy });
  }
  return Object.freeze({ create, ownSystems, SHIPS: Object.freeze(SHIPS.slice()) });
});
