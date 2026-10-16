/* Consumer runs in a real Chromium isolated world. The native scene remains in
 * the page world. Production map injection, import and MessagePort are intact. */
async function installNativeGalaxyOverlay() {
  const canvas = document.querySelector('#stage'), samples = [], waiters = [], received = [];
  let phase = 'bootstrap', scope = 'fixture/self', stopped = false, samplesExecuted = 0;
  const originalAdd = MessagePort.prototype.addEventListener, originalRemove = MessagePort.prototype.removeEventListener, wrapped = new WeakMap();
  MessagePort.prototype.addEventListener = function(type, callback, ...args) {
    if (type !== 'message' || typeof callback !== 'function') return originalAdd.call(this, type, callback, ...args);
    const listener = function(event) { try { const value = JSON.parse(event.data); if (value.camera) received.push(value.revision); } catch (_) {} return callback.call(this, event); };
    wrapped.set(callback, listener); return originalAdd.call(this, type, listener, ...args);
  };
  MessagePort.prototype.removeEventListener = function(type, callback, ...args) { return originalRemove.call(this, type, wrapped.get(callback) || callback, ...args); };
  const map = OldLightReinforcementMap.create({ realm: globalThis, document, getScope: () => scope,
    addElement(parent, tag, attributes) { const element = document.createElement(tag); element.textContent = attributes.textContent; parent.appendChild(element); return element; } });
  const started = Date.now();
  while (!map.status().installed) { if (Date.now() - started > 3000) throw Error('Production native map bootstrap failed: ' + JSON.stringify(map.status())); await new Promise(resolve => setTimeout(resolve, 5)); }
  while (!map.status().observed && map.status().reason !== 'awaiting-native-projection') { if (Date.now() - started > 5000) throw Error('Native observer unavailable: ' + JSON.stringify(map.status())); await new Promise(resolve => setTimeout(resolve, 5)); }
  // Import/shape validation is async in the page observer. Native initial draw
  // did not establish authority: subsequent real native projections must do so.
  const world = () => JSON.parse(canvas.getAttribute('data-offline-world'));
  const panel = OldLightReinforcementPanel.create({ document, window, getScope: () => scope, getWorld: world,
    getRoutes: () => [{ id: 'route', originId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', destinationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', paused: false, intervalMinutes: 5, ships: { probe: { mode: 'fixed', amount: 1 } } }],
    projectSystem: (system, options) => map.projectSystem(system, options),
    projectDecorationSystem: (system, options) => map.projectDecorationSystem ? map.projectDecorationSystem(system, options) : map.projectSystem(system, options),
    subscribeProjection: callback => globalThis.__disableNativeNotifications ? () => {} : map.subscribeProjection?.(callback) || (() => {}) });
  function endpointError(line, points) {
    if (points.length !== 2 || points.some(point => !point)) return null;
    const rect = canvas.getBoundingClientRect();
    const [a, b] = points.map(point => ({ x: rect.left + point.x * rect.width / 900, y: rect.top + point.y * rect.height / 600 })), dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    const matrix = line.getScreenCTM(), start = new DOMPoint(+line.getAttribute('x1'), +line.getAttribute('y1')).matrixTransform(matrix), end = new DOMPoint(+line.getAttribute('x2'), +line.getAttribute('y2')).matrixTransform(matrix);
    return Math.max(Math.hypot(start.x - a.x - 9 * dx / length, start.y - a.y - 9 * dy / length),
      Math.hypot(end.x - b.x + 9 * dx / length, end.y - b.y + 9 * dy / length));
  }
  function sample() {
    if (stopped) return;
    samplesExecuted++;
    const native = JSON.parse(canvas.getAttribute('data-offline-frame'));
    const svg = document.querySelector('.oldlight-route-overlay'), line = svg?.querySelector('line');
    const visible = !!line && !svg.hidden && getComputedStyle(svg).display !== 'none';
    samples.push({ frame: native.frame, phase, visible, raster: native.raster, camera: native.camera, revision: native.revision,
      rasterError: visible ? endpointError(line, native.raster) : null, projectionError: visible ? endpointError(line, native.projected) : null,
      authoritative: map.status().available, cameraReason: map.status().reason, markerDisabled: [...document.querySelectorAll('[data-route-marker]')].every(node => node.disabled), markerReachable: [...document.querySelectorAll('[data-route-marker]')].some(node => !node.disabled && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden') });
    for (let i = waiters.length - 1; i >= 0; i--) if (native.frame >= waiters[i].until) { waiters[i].resolve(); waiters.splice(i, 1); }
    requestAnimationFrame(sample);
  }
  globalThis.nativeOverlayQA = {
    mount() { panel.mount(document.querySelector('main')); if (globalThis.__shiftNativeOverlay) document.querySelector('.oldlight-route-overlay').style.transform = 'translateX(8px)'; }, startSampling() { requestAnimationFrame(sample); },
    phase(value) { phase = value; }, frames(count) { const frame = JSON.parse(canvas.getAttribute('data-offline-frame')).frame; return new Promise(resolve => waiters.push({ until: frame + count, resolve })); },
    scope(value) { scope = value; panel.render(); },
    finish() { const diagnostics = panel.getVisualDiagnostics(), status = map.status(); stopped = true; panel.destroy(); map.stop(); MessagePort.prototype.addEventListener = originalAdd; MessagePort.prototype.removeEventListener = originalRemove;
      return { samples, samplesExecuted, diagnostics, status, received, reorders: received.filter((revision, index) => index && revision < received[index - 1]).length, world: world() }; },
  };
}
