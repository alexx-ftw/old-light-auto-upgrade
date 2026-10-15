/* Read-only native camera observation for reinforcement arrows. No game orders.
 * Verified public asset: transits-DloGaxtE.js, SHA-256
 * 4d79f1bb4e9ca042385be2b49cea6c952d7c21d660de35e30b20b11ec5c11880.
 * Y is the shared J camera; et converts axial q,r to world coordinates.
 * The native perspective projection is at byte 7190. No source, names,
 * account identifiers, coordinates of systems, or privileged APIs cross the pipe.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else Object.defineProperty(root, 'OldLightReinforcementMap', { configurable: true, value: factory() });
})(globalThis, function mapFactory() {
  'use strict';
  const ASSET = 'https://oldlight.io/assets/transits-DloGaxtE.js';
  const LIMITS = Object.freeze({ frame: 2048, staleMs: 1500, heartbeatMs: 500, pollMs: 250, systems: 10000, hitRadius: 18 });
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const bounded = (value, max) => finite(value) && Math.abs(value) <= max;
  const galaxyAt = realm => realm.location?.origin === 'https://oldlight.io'
    ? /^\/game\/galaxy\/([A-Za-z0-9_-]{1,64})(?:\/|$)/.exec(realm.location.pathname)?.[1] || '' : '';
  const equalRect = (a, b) => !!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
  const stamp = value => JSON.stringify([value.galaxy, value.revision, value.observedAt]);
  function rectValue(value) {
    if (!value || !bounded(value.left, 100000) || !bounded(value.top, 100000)
      || !finite(value.width) || value.width <= 0 || value.width > 100000
      || !finite(value.height) || value.height <= 0 || value.height > 100000) return null;
    return { left: value.left, top: value.top, width: value.width, height: value.height };
  }
  function viewport(document) {
    if (!document || document.hidden === true) return null;
    const matches = document.querySelectorAll('canvas#stage');
    if (matches.length !== 1) return null;
    const canvas = matches[0], app = document.getElementById('app');
    if (!canvas.isConnected || canvas.hidden || !app?.isConnected || !app.contains(canvas)
      || (typeof canvas.getClientRects === 'function' && !canvas.getClientRects().length)) return null;
    const rect = rectValue(canvas.getBoundingClientRect());
    return rect ? { canvas, rect } : null;
  }
  function cameraValue(value) {
    if (!value || !bounded(value.x, 1e9) || !bounded(value.y, 1e9)
      || !finite(value.zoom) || value.zoom <= 0 || value.zoom > 100
      || !finite(value.sinTilt) || value.sinTilt <= 0 || value.sinTilt > 1
      || !finite(value.cosTilt) || value.cosTilt < 0 || value.cosTilt > 1
      || Math.abs(value.sinTilt * value.sinTilt + value.cosTilt * value.cosTilt - 1) > 1e-10
      || !finite(value.L) || value.L <= 1 || value.L > 1e7
      || !finite(value.baseFocal) || value.baseFocal <= 0 || value.baseFocal > 1e7) return null;
    return { x: value.x, y: value.y, zoom: value.zoom, sinTilt: value.sinTilt, cosTilt: value.cosTilt, L: value.L, baseFocal: value.baseFocal };
  }
  function validateSnapshot(input) {
    let value;
    try {
      if (typeof input === 'string') { if (input.length > LIMITS.frame) return null; value = JSON.parse(input); }
      else value = input;
      if (!value || value.version !== 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(value.galaxy || '')
        || !Number.isSafeInteger(value.revision) || value.revision < 1
        || !Number.isSafeInteger(value.observedAt) || value.observedAt < 0) return null;
      const camera = cameraValue(value.camera), rect = rectValue(value.viewport);
      return camera && rect ? { version: 1, galaxy: value.galaxy, revision: value.revision, observedAt: value.observedAt, camera, viewport: rect } : null;
    } catch (_) { return null; }
  }
  function projectPoint(system, value) {
    if (!system || !Number.isSafeInteger(system.q) || !Number.isSafeInteger(system.r)
      || Math.abs(system.q) > 1000000 || Math.abs(system.r) > 1000000 || !value?.camera || !value?.viewport) return null;
    const c = value.camera, v = value.viewport;
    const dx = 69 * system.q - c.x, dy = 46 * Math.sqrt(3) * (system.r + system.q / 2) - c.y;
    const depth = dy * c.cosTilt + c.L;
    if (!finite(depth) || depth <= 1) return null;
    const focal = c.baseFocal * c.zoom;
    const x = focal * dx / depth + v.width / 2, y = -focal * dy * c.sinTilt / depth + v.height / 2;
    return finite(x) && finite(y) ? { x: v.left + x, y: v.top + y, scale: focal / depth, depth, visible: true } : null;
  }
  function unprojectHex(point, value) {
    const c = value?.camera, v = value?.viewport;
    if (!c || !v || !point || !finite(point.x) || !finite(point.y)) return null;
    const screenX = point.x - v.left - v.width / 2, screenY = point.y - v.top - v.height / 2;
    const focal = c.baseFocal * c.zoom, denominator = focal * c.sinTilt + screenY * c.cosTilt;
    // Native unproject uses a distant fallback at the perspective horizon.
    // A hit test must reject it instead of guessing a system at that position.
    if (!finite(denominator) || Math.abs(denominator) < 1e-6) return null;
    const dy = -screenY * c.L / denominator, depth = dy * c.cosTilt + c.L;
    if (!finite(depth) || depth <= 1) return null;
    const worldX = c.x + screenX * depth / focal, worldY = c.y + dy;
    const q = 2 / 3 * (worldX / 46), r = -1 / 3 * (worldX / 46) + Math.sqrt(3) / 3 * (worldY / 46), cubeY = -q - r;
    if (!bounded(q, 1000000) || !bounded(r, 1000000)) return null;
    let roundedQ = Math.round(q), roundedR = Math.round(r);
    const roundedY = Math.round(cubeY), qError = Math.abs(roundedQ - q), yError = Math.abs(roundedY - cubeY), rError = Math.abs(roundedR - r);
    // Exact tie-breaking from native k/A, not nearest-own-system selection.
    if (qError > yError && qError > rError) roundedQ = -roundedY - roundedR;
    else if (yError <= rError) roundedR = -roundedQ - roundedY;
    return { q: roundedQ || 0, r: roundedR || 0 };
  }
  // The importer is injectable only for offline fixtures. Production imports the
  // exact module URL already loaded by this completed, evaluated game page.
  function installPageObserver({ realm = globalThis, document = realm.document, importModule = url => import(url), now = Date.now,
    onPending = () => {}, emit = () => {} } = {}) {
    let stopped = false, installed = false, importing = false, failed = false, reason = 'awaiting-native-camera';
    let moduleValue = null, camera = null, original = null, wrapper = null, ownDescriptor = null, originalUnproject = null, unprojectWrapper = null, ownUnprojectDescriptor = null;
    let activeGalaxy = '', activePath = '', activeCanvas = null, cachedViewport = null, candidate = null, pending = null;
    let revision = 0, frame = null, timer = null, lastEmittedAt = 0, observing = false, notifying = false, ordinal = 0, lastObservedOrdinal = 0;
    let resolveReady; const ready = new Promise(resolve => { resolveReady = resolve; });
    const apply = Reflect.apply;
    const safePending = value => { try { onPending(value); } catch (_) {} };
    function invalidate(why) {
      reason = why; candidate = null; pending = null;
      safePending(null);
    }
    function cancelFrame() { if (frame !== null) { try { realm.cancelAnimationFrame(frame); } catch (_) {} frame = null; } }
    function unhook() {
      try {
        const descriptor = camera && Object.getOwnPropertyDescriptor(camera, 'project');
        if (descriptor?.value === wrapper) {
          if (ownDescriptor) Object.defineProperty(camera, 'project', ownDescriptor);
          else delete camera.project;
        }
      } catch (_) {}
      try {
        const descriptor = camera && Object.getOwnPropertyDescriptor(camera, 'unproject');
        if (descriptor?.value === unprojectWrapper) {
          if (ownUnprojectDescriptor) Object.defineProperty(camera, 'unproject', ownUnprojectDescriptor);
          else delete camera.unproject;
        }
      } catch (_) {}
      installed = false;
    }
    function fail(why) { failed = true; if (timer !== null) realm.clearTimeout(timer); timer = null; unhook(); cancelFrame(); invalidate(why); resolveReady(false); }
    function ownsHook() { return installed && Object.getOwnPropertyDescriptor(camera, 'project')?.value === wrapper
      && Object.getOwnPropertyDescriptor(camera, 'unproject')?.value === unprojectWrapper; }
    function constantsMatch(c) { return c && camera.sinTilt === c.sinTilt && camera.cosTilt === c.cosTilt && camera.L === c.L && camera.baseFocal === c.baseFocal; }
    function scheduleFrame() {
      if (frame !== null || stopped || failed) return;
      frame = realm.requestAnimationFrame(flush);
    }
    function queue(value) {
      value.revision = ++revision; value.observedAt = now();
      candidate = value; pending = value;
      safePending(value); scheduleFrame();
    }
    function flush() {
      frame = null; cachedViewport = null;
      if (stopped || failed || !installed) return;
      try {
        if (!ownsHook()) { fail('camera-hook-replaced'); return; }
        const view = viewport(document);
        if (!view || view.canvas !== activeCanvas || galaxyAt(realm) !== activeGalaxy) { invalidate('viewport-unavailable'); return; }
        cachedViewport = view;
        if (candidate && !equalRect(view.rect, candidate.viewport)) { invalidate('camera-observation-pending'); return; }
        if (!pending) return;
        const value = pending; pending = null;
        if (!equalRect(view.rect, value.viewport) || !constantsMatch(value.camera)) { invalidate('camera-observation-pending'); return; }
        // Publish at most once per animation frame. Observing a newer camera has
        // already invalidated the content-world snapshot synchronously.
        notifying = true;
        try { emit(value); lastEmittedAt = now(); reason = ''; } finally { notifying = false; }
      } catch (_) { invalidate('camera-observation-failed'); }
    }
    function observe(receiver, args, callOrdinal) {
      if (stopped || failed || !installed || receiver !== camera || observing || notifying || callOrdinal < lastObservedOrdinal) return;
      observing = true;
      try {
        lastObservedOrdinal = callOrdinal;
        if (realm.location.pathname !== activePath || realm.location.origin !== 'https://oldlight.io') { invalidate('game-navigation'); return; }
        // Zero allocation and no DOM/JSON work for the thousands of matching
        // projections in a frame. The frame callback refreshes CSS geometry.
        const x = args[2], y = args[3], zoom = args[4], width = args[5], height = args[6];
        const c = candidate?.camera, r = cachedViewport?.rect;
        if (c && r && x === c.x && y === c.y && zoom === c.zoom && width === r.width && height === r.height && constantsMatch(c)) {
          scheduleFrame(); return;
        }
        if (!cachedViewport) cachedViewport = viewport(document);
        const view = cachedViewport;
        if (!view || view.canvas !== activeCanvas) { invalidate('viewport-unavailable'); return; }
        // Native dimensions are CSS pixels. Never accept canvas.width/height,
        // which are backing-store pixels and differ at DPR > 1.
        if (width !== view.rect.width || height !== view.rect.height) { invalidate('native-viewport-size-mismatch'); return; }
        if (!bounded(args[0], 1e12) || !bounded(args[1], 1e12)) return;
        const values = cameraValue({ x, y, zoom, sinTilt: camera.sinTilt, cosTilt: camera.cosTilt, L: camera.L, baseFocal: camera.baseFocal });
        if (!values) { invalidate('invalid-native-camera'); return; }
        if (candidate && c && x === c.x && y === c.y && zoom === c.zoom && constantsMatch(c) && equalRect(candidate.viewport, view.rect)) { scheduleFrame(); return; }
        queue({ version: 1, galaxy: activeGalaxy, revision: 0, observedAt: 0, camera: values, viewport: view.rect });
      } finally { observing = false; }
    }
    function moduleShape(value) {
      const shared = value?.Y, Class = value?.J;
      if (!shared || typeof shared !== 'object' || typeof Class !== 'function' || Object.getPrototypeOf(shared) !== Class.prototype
        || typeof value.et !== 'function' || value.et.length !== 2) return false;
      const protoProject = Object.getOwnPropertyDescriptor(Class.prototype, 'project');
      const focal = Object.getOwnPropertyDescriptor(Class.prototype, 'focal');
      const unproject = Object.getOwnPropertyDescriptor(Class.prototype, 'unproject');
      // A changed shape or another hook is not a reason to patch prototypes.
      if (!protoProject || typeof protoProject.value !== 'function' || protoProject.value.length !== 8 || !protoProject.writable || !protoProject.configurable
        || !focal || typeof focal.value !== 'function' || focal.value.length !== 1
        || !unproject || typeof unproject.value !== 'function' || unproject.value.length !== 7 || !unproject.writable || !unproject.configurable) return false;
      for (const key of ['sinTilt', 'cosTilt', 'L', 'baseFocal']) {
        const descriptor = Object.getOwnPropertyDescriptor(shared, key);
        if (!descriptor || !('value' in descriptor) || !finite(descriptor.value)) return false;
      }
      if (!cameraValue({ x: 0, y: 0, zoom: 1, sinTilt: shared.sinTilt, cosTilt: shared.cosTilt, L: shared.L, baseFocal: shared.baseFocal })) return false;
      for (const [key, method] of [['project', protoProject], ['unproject', unproject]]) {
        const own = Object.getOwnPropertyDescriptor(shared, key);
        if (own && (!('value' in own) || own.value !== method.value || !own.writable || !own.configurable)) return false;
        if (!own && !Object.isExtensible(shared)) return false;
      }
      return true;
    }
    function attach(value, galaxy, view) {
      if (stopped || failed || galaxyAt(realm) !== galaxy) return;
      if (!moduleShape(value)) { fail('native-camera-shape-changed'); return; }
      camera = value.Y; ownDescriptor = Object.getOwnPropertyDescriptor(camera, 'project'); original = camera.project;
      activeGalaxy = galaxy; activePath = realm.location.pathname; activeCanvas = view.canvas; cachedViewport = view;
      // Do not touch the shared prototype. Arguments, this, returned identity,
      // optional out mutation and native exceptions are forwarded unchanged.
      wrapper = function project(e, t, n, r, i, a, o, s) {
        const callOrdinal = ++ordinal;
        const result = apply(original, this, arguments);
        try { observe(this, arguments, callOrdinal); } catch (_) { try { invalidate('camera-observation-failed'); } catch (_) {} }
        return result;
      };
      const descriptor = ownDescriptor || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(camera), 'project');
      Object.defineProperty(camera, 'project', { ...descriptor, value: wrapper });
      // GPU rendering can run without any project call. Native hover, pan and
      // visibleWorldBounds still use this same singleton's unproject method,
      // whose arguments 2..6 carry the exact same camera and CSS dimensions.
      ownUnprojectDescriptor = Object.getOwnPropertyDescriptor(camera, 'unproject'); originalUnproject = camera.unproject;
      unprojectWrapper = function unproject(e, t, n, r, i, a, o) {
        const callOrdinal = ++ordinal;
        const result = apply(originalUnproject, this, arguments);
        try { observe(this, arguments, callOrdinal); } catch (_) { try { invalidate('camera-observation-failed'); } catch (_) {} }
        return result;
      };
      const unprojectDescriptor = ownUnprojectDescriptor || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(camera), 'unproject');
      Object.defineProperty(camera, 'unproject', { ...unprojectDescriptor, value: unprojectWrapper });
      installed = true; reason = 'awaiting-native-projection'; resolveReady(true);
    }
    function nativeReady() {
      if (document.readyState !== 'complete' || !galaxyAt(realm)) return null;
      const view = viewport(document); if (!view) return null;
      // Both controls are constructed under #app by the evaluated galaxy
      // module. A static canvas or a modulepreload alone is not sufficient.
      const app = document.getElementById('app');
      for (const selector of ['.star-hover', '.star-actions']) {
        const controls = document.querySelectorAll(selector);
        if (controls.length !== 1 || !controls[0].isConnected || !app.contains(controls[0])) return null;
      }
      // Vite modulepreload entries retain initiatorType=link after evaluation.
      // Runtime-created controls above distinguish this from preload alone.
      const resources = realm.performance?.getEntriesByType?.('resource');
      if (!Array.isArray(resources) || !resources.some(entry => entry.name === ASSET && (entry.initiatorType === 'script' || entry.initiatorType === 'link') && finite(entry.responseEnd) && entry.responseEnd > 0)) return null;
      return view;
    }
    function tick() {
      timer = null;
      if (stopped || failed) return;
      try {
        if (installed) {
          if (!ownsHook()) { fail('camera-hook-replaced'); return; }
          const view = viewport(document), galaxy = galaxyAt(realm);
          if (!view || view.canvas !== activeCanvas || galaxy !== activeGalaxy) {
            unhook(); cancelFrame(); invalidate('viewport-unavailable'); cachedViewport = null;
          } else {
            cachedViewport = view;
            if (candidate && (!equalRect(candidate.viewport, view.rect) || !constantsMatch(candidate.camera))) invalidate('camera-observation-pending');
            if (candidate && !pending && now() - lastEmittedAt >= LIMITS.heartbeatMs) queue({ ...candidate, camera: { ...candidate.camera }, viewport: { ...candidate.viewport } });
          }
        }
        if (!installed && !importing) {
          const view = nativeReady();
          if (view) {
            const galaxy = galaxyAt(realm);
            if (moduleValue) attach(moduleValue, galaxy, view);
            else {
              importing = true;
              Promise.resolve().then(() => importModule(ASSET)).then(value => {
                importing = false;
                if (stopped || failed) return;
                moduleValue = value;
                const current = nativeReady();
                if (current && current.canvas === view.canvas && galaxyAt(realm) === galaxy) attach(value, galaxy, current);
              }).catch(() => { importing = false; if (!stopped) fail('native-camera-import-failed'); });
            }
          }
        }
      } catch (_) { fail('native-camera-unavailable'); }
      if (!stopped && !failed) timer = realm.setTimeout(tick, LIMITS.pollMs);
    }
    if (typeof realm.requestAnimationFrame !== 'function' || typeof realm.cancelAnimationFrame !== 'function'
      || typeof realm.setTimeout !== 'function' || typeof realm.clearTimeout !== 'function') fail('camera-timing-unavailable');
    else tick();
    return Object.freeze({ ready, status: () => ({ installed, observed: !!candidate, reason, stopped }),
      stop() { if (stopped) return; stopped = true; if (timer !== null) realm.clearTimeout(timer); timer = null; cancelFrame(); unhook(); invalidate('stopped'); resolveReady(false); },
    });
  }
  function create({ realm = globalThis, document = realm.document, addElement, observerSource, now = Date.now, getScope } = {}) {
    const eventName = 'oldlight-reinforcement-map-bootstrap', pendingAttribute = 'data-oldlight-map-pending';
    let stopped = false, failed = false, installed = false, reason = 'awaiting-native-camera', current = null, currentCanvas = null;
    let container = null, port = null, ackTimer = null, watcher = null, lastRevision = 0, boundScope = '';
    let channel;
    try { channel = 'oldlight_map_' + realm.crypto.randomUUID().replace(/-/g, ''); } catch (_) { failed = true; reason = 'camera-channel-unavailable'; }
    function cleanupBootstrap() {
      watcher?.disconnect(); watcher = null;
      if (ackTimer !== null) { realm.clearTimeout(ackTimer); ackTimer = null; }
      container?.removeEventListener(eventName, handshake); container?.remove();
    }
    function clear(why) { current = null; currentCanvas = null; reason = why; }
    function fail(why) { failed = true; installed = false; cleanupBootstrap(); try { port?.postMessage('stop'); } catch (_) {} port?.close(); port = null; clear(why); }
    function receive(event) {
      if (stopped || failed) return;
      if (typeof event.data === 'string' && event.data.length <= 256) {
        try {
          const diagnostic = JSON.parse(event.data);
          if (diagnostic.version === 1 && diagnostic.type === 'status' && [
            'native-camera-import-failed', 'native-camera-shape-changed', 'native-camera-unavailable',
            'camera-hook-replaced', 'camera-timing-unavailable', 'awaiting-native-projection',
            'viewport-unavailable', 'game-navigation', 'camera-observation-failed', 'native-viewport-size-mismatch',
          ].includes(diagnostic.reason)) { clear(diagnostic.reason); return; }
        } catch (_) { /* Snapshot validation below remains authoritative. */ }
      }
      const value = typeof event.data === 'string' ? validateSnapshot(event.data) : null;
      if (!value || value.galaxy !== galaxyAt(realm) || value.observedAt > now() || now() - value.observedAt > LIMITS.staleMs) { clear('invalid-camera-observation'); return; }
      if (value.revision <= lastRevision) { clear('out-of-order-camera-observation'); return; }
      lastRevision = value.revision;
      try {
        const view = viewport(document);
        if (!view || !equalRect(value.viewport, view.rect)) { clear('viewport-unavailable'); return; }
        current = value; currentCanvas = view.canvas; reason = '';
      } catch (_) { clear('viewport-unavailable'); }
    }
    function handshake(event) {
      if (stopped || failed || port || event.target !== container || container.isConnected || event.data !== channel || event.ports?.length !== 1) return;
      port = event.ports[0]; port.addEventListener('message', receive); port.start(); installed = true; cleanupBootstrap();
    }
    function inject() {
      if (stopped || failed || installed || container) return;
      const parent = document.documentElement || document.head; if (!parent) return;
      container = document.createElement('div'); container.hidden = true; container.addEventListener(eventName, handshake);
      const source = typeof observerSource === 'string'
        ? observerSource + '\nconst api=globalThis.OldLightReinforcementMap;'
        : 'const api=(' + mapFactory.toString() + ')();';
      const textContent = `(()=>{const target=document.currentScript?.parentNode;if(!target||!target.isConnected)return;target.remove();${source}\nconst channel=${JSON.stringify(channel)},attribute=${JSON.stringify(pendingAttribute)};const pipe=new MessageChannel();const send=pipe.port1.postMessage.bind(pipe.port1);pipe.port1.start();let ready=false,pending=null,handle=null;const cleanup=()=>{try{handle?.stop();}catch(_){}pipe.port1.close();pipe.port2.close();};pipe.port1.addEventListener('message',event=>{if(event.data==='stop')cleanup();});try{handle=api.installPageObserver({onPending:value=>{if(value)target.setAttribute(attribute,JSON.stringify([value.galaxy,value.revision,value.observedAt]));else {target.removeAttribute(attribute);const reason=handle?.status?.().reason;if(ready&&reason)send(JSON.stringify({version:1,type:'status',reason}));}},emit:value=>{const data=JSON.stringify(value);if(ready)send(data);else pending=data;}});target.dispatchEvent(new MessageEvent(${JSON.stringify(eventName)},{data:channel,ports:[pipe.port2],bubbles:false,composed:false}));ready=true;if(pending!==null)send(pending);handle.ready?.then(()=>{const reason=handle?.status?.().reason;if(reason)send(JSON.stringify({version:1,type:'status',reason}));});}catch(_){cleanup();}})();`;
      try {
        parent.appendChild(container);
        ackTimer = realm.setTimeout(() => { ackTimer = null; if (!installed && !stopped) fail('camera-injection-unavailable'); }, 2000);
        addElement(container, 'script', { textContent });
      } catch (_) { fail('camera-injection-unavailable'); }
    }
    function settled({ canvas, rect, scope } = {}) {
      if (stopped || failed || !current) return null;
      if (typeof scope === 'string' && scope) {
        if (scope.split('/')[0] !== current.galaxy) { clear('game-scope-changed'); return null; }
        if (boundScope && scope !== boundScope) { boundScope = scope; clear('game-scope-changed'); return null; }
        boundScope = scope;
      }
      if (current.galaxy !== galaxyAt(realm) || current.observedAt > now() || now() - current.observedAt > LIMITS.staleMs) { clear('stale-camera-observation'); return null; }
      try {
        if (container?.getAttribute(pendingAttribute) !== stamp(current)) return null;
        const view = viewport(document);
        if (!view || view.canvas !== currentCanvas || (canvas && canvas !== view.canvas) || !equalRect(view.rect, current.viewport)
          || (rect && !equalRect(rect, view.rect))) return null;
        return current;
      } catch (_) { return null; }
    }
    if (!failed) {
      if (typeof addElement !== 'function') fail('camera-permission-unavailable');
      else {
        inject();
        if (!container && !failed && typeof realm.MutationObserver === 'function') {
          watcher = new realm.MutationObserver(() => { inject(); if (container || failed) { watcher?.disconnect(); watcher = null; } });
          watcher.observe(document, { childList: true, subtree: true });
        }
      }
    }
    return Object.freeze({
      projectSystem(system, options = {}) { const value = settled(options); return value ? projectPoint(system, value) : null; },
      hitTestSystem(point, rows) {
        if (!point || !finite(point.x) || !finite(point.y) || !Array.isArray(rows) || rows.length > LIMITS.systems) return null;
        let scope; try { scope = typeof getScope === 'function' ? getScope() : boundScope; } catch (_) { return null; }
        const value = settled({ scope }); if (!value) return null;
        const rect = value.viewport;
        if (point.x < rect.left || point.x > rect.left + rect.width || point.y < rect.top || point.y > rect.top + rect.height) return null;
        const hex = unprojectHex(point, value); if (!hex) return null;
        let match = null;
        for (const system of rows) {
          if (!system || system.q !== hex.q || system.r !== hex.r) continue;
          const p = projectPoint(system, value);
          if (!p || p.x < rect.left || p.x > rect.left + rect.width || p.y < rect.top || p.y > rect.top + rect.height
            || Math.hypot(p.x - point.x, p.y - point.y) > LIMITS.hitRadius) continue;
          if (match) return null;
          match = system;
        }
        return match;
      },
      status() { const valid = !!settled(); return { installed, observed: !!current, available: valid, reason: valid ? '' : reason || 'camera-observation-pending' }; },
      stop() {
        if (stopped) return; stopped = true; cleanupBootstrap();
        try { port?.postMessage('stop'); } catch (_) {}
        port?.removeEventListener('message', receive); port?.close(); port = null; installed = false; clear('stopped');
      },
    });
  }
  return Object.freeze({ create, installPageObserver, validateSnapshot, projectPoint, unprojectHex, ASSET, LIMITS });
});
