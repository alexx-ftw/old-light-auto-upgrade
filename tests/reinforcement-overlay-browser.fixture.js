/* Offline Canvas2D reference scene, with official Pixi or Canvas2D, not the native galaxy bootstrap or a game connection.
 * Production SVG overlay is unmodified. Projection follows the documented native
 * perspective camera; this boundary exercises the production camera observer, injector and MessagePort.
 */
async function installOverlayBrowserFixture() {
  const qa = globalThis.__overlayScenario || { order: "before", transport: 0, renderer: "canvas" };
  document.title = 'Offline reinforcement overlay QA';
  document.body.innerHTML = '<style>body{margin:0;background:#071421;color:white;font:14px system-ui}#stage{position:absolute;left:0;top:0;width:900px;height:600px}main{position:absolute;left:910px;top:0;width:280px}#caption{position:absolute;top:610px}</style><div id="app"><canvas id="stage" width="900" height="600"></canvas></div><main></main><p id="caption">OFFLINE REFERENCE SCENE · No game connection</p>';
  const canvas = document.querySelector('canvas');
  let pixi = null, context = null, dots = [];
  if (qa.renderer === 'pixi') {
    pixi = new PIXI.Application(); await pixi.init({ canvas, width: 900, height: 600, preference: 'webgl', background: '#071421', autoStart: false });
    for (let i = 0; i < 2; i++) { const dot = new PIXI.Graphics().circle(0, 0, 7).fill(0xffffff); pixi.stage.addChild(dot); dots.push(dot); }
  } else context = canvas.getContext('2d');
  const rows = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', q: -3, r: 1, name: 'Origin' },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', q: 4, r: -1, name: 'Destination' }];
  const camera = { x: 0, y: 0, zoom: 1 }, samples = [], waiters = [];
  let frame = 0, phase = 'rest', velocity = 0, dragging = false, lastX = 0;
  let projectionWidth = 900, complete = true, scope = 'fixture/self', revision = 0, stopped = false;
  let pointerEvents = 0, wheelEvents = 0, sceneCallbacks = 0, sampleCallbacks = 0;
  let painted = [], bridge = null, observer = null, portPosts = 0, portDeliveries = 0;
  const native = globalThis.__fixtureNative;
  function point(system) {
    const p = native.et(system.q, system.r);
    if (qa.method === 'unproject') {
      native.Y.visibleWorldBounds(camera.x, camera.y, camera.zoom, projectionWidth, 600);
      return native.J.prototype.project.call(native.Y, p.x, p.y, camera.x, camera.y, camera.zoom, projectionWidth, 600);
    }
    return native.Y.project(p.x, p.y, camera.x, camera.y, camera.zoom, projectionWidth, 600);
  }
  canvas.addEventListener('pointerdown', event => { pointerEvents++; dragging = true; lastX = event.clientX; velocity = 0; });
  canvas.addEventListener('pointermove', event => { if (!dragging) return; pointerEvents++; velocity = -(event.clientX - lastX) * 0.7; camera.x += velocity; lastX = event.clientX; });
  window.addEventListener('pointerup', () => { pointerEvents++; dragging = false; });
  canvas.addEventListener('wheel', event => { wheelEvents++; camera.zoom = Math.max(0.65, Math.min(1.3, camera.zoom - event.deltaY * 0.001)); event.preventDefault(); }, { passive: false });
  function scene() {
    if (stopped) return;
    sceneCallbacks++; frame++;
    if (!dragging) { camera.x += velocity; velocity *= 0.9; }
    if (frame % 7 === 0) revision++;
    if (context) { context.fillStyle = '#071421'; context.fillRect(0, 0, 900, 600); }
    painted = [];
    for (const system of rows) {
      const p = point(system); painted.push(p);
      if (pixi) dots[rows.indexOf(system)].position.set(p.x, p.y);
      else { context.fillStyle = '#ffffff'; context.beginPath(); context.arc(p.x, p.y, 7, 0, Math.PI * 2); context.fill(); context.fillText(system.name, p.x + 12, p.y - 12); }
    }
    if (pixi) painted = dots.map(dot => ({ x: dot.position.x, y: dot.position.y }));
    pixi?.render();
    document.querySelector('#caption').textContent = `OFFLINE REFERENCE · ${phase} · native animation frame ${frame}`;
    requestAnimationFrame(scene);
  }
  // Real production injector, observer and MessageChannel; only boot/import seams are synthetic.
  const controls = document.createElement('div'); controls.innerHTML = '<div class=star-hover></div><div class=star-actions></div>'; document.querySelector('#app').append(controls);
  const realm = { document, location: { origin: 'https://oldlight.io', pathname: '/game/galaxy/fixture' }, crypto: { randomUUID: () => globalThis.__fixtureUUID }, MutationObserver,
    performance: { getEntriesByType: () => [{ name: OldLightReinforcementMap.ASSET, initiatorType: 'script', responseEnd: 1 }] },
    setTimeout: setTimeout.bind(window), clearTimeout: clearTimeout.bind(window), requestAnimationFrame: requestAnimationFrame.bind(window), cancelAnimationFrame: cancelAnimationFrame.bind(window) };
  const originalObserver = OldLightReinforcementMap.installPageObserver;
  const observerSource = globalThis.__mapSource + '\nconst nativeAPI=globalThis.OldLightReinforcementMap;Object.defineProperty(globalThis,"OldLightReinforcementMap",{configurable:true,value:{...nativeAPI,installPageObserver:options=>globalThis.__installNativeObserver(options)}});';
  globalThis.__installNativeObserver = options => { observer = originalObserver({ ...options, realm, importModule: async () => native }); return observer; };
  const originalPost = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function(data, ...args) {
    if (typeof data !== 'string' || data === 'stop') return originalPost.call(this, data, ...args);
    portPosts++; const target = this;
    const send = () => { portDeliveries++; originalPost.call(target, data, ...args); };
    if (qa.transport) setTimeout(send, qa.transport); else send();
  };
  bridge = OldLightReinforcementMap.create({ realm, document, observerSource, getScope: () => scope, addElement(parent, tag, attrs) { const el = document.createElement(tag); el.textContent = attrs.textContent; parent.append(el); return el; } });
  const started = Date.now();
  while (!observer) { if (Date.now() - started > 2500) throw Error('Observer startup: ' + JSON.stringify(bridge.status())); await new Promise(resolve => setTimeout(resolve, 0)); }
  await observer.ready; point(rows[0]);
  await new Promise(resolve => setTimeout(resolve, qa.transport + 80));
  if (qa.order === 'before') requestAnimationFrame(scene);
  const panelWindow = globalThis.__disableOverlayFrames ? new Proxy(window, { get(target, key) { if (key === 'requestAnimationFrame') return () => 0; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } }) : window;
  const panel = OldLightReinforcementPanel.create({ document, window: panelWindow, getScope: () => scope,
    getWorld: () => ({ scope: 'fixture/self', galaxy: 'fixture', selfId: 'self', connected: true, complete,
      observedAt: Date.now(), generation: 1, epoch: 1, revision, systems: rows }),
    getRoutes: () => [{ id: 'route', originId: rows[0].id, destinationId: rows[1].id, paused: false, intervalMinutes: 5,
      ships: { probe: { mode: 'fixed', amount: 1 } } }],
    projectSystem: (system, options) => bridge.projectSystem(system, options),
    projectDecorationSystem: (system, options) => bridge.projectDecorationSystem ? bridge.projectDecorationSystem(system, options) : bridge.projectSystem(system, options),
    subscribeProjection: callback => globalThis.__disableProjectionNotifications ? (() => {}) : bridge.subscribeProjection?.(callback) || (() => {}) });
  panel.mount(document.querySelector('main'));
  if (qa.order === 'after') requestAnimationFrame(scene);
  function sample() {
    if (stopped) return;
    sampleCallbacks++;
    const svg = document.querySelector('.oldlight-route-overlay'), line = svg?.querySelector('line');
    const visible = !!line && !svg.hidden && getComputedStyle(svg).display !== 'none' && getComputedStyle(svg).visibility !== 'hidden';
    let error = null;
    if (visible) {
      const [a, b] = painted;
      // Route endpoints deliberately stop 9 logical pixels from star centres.
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      error = Math.max(Math.hypot(+line.getAttribute('x1') - (a.x + 9 * dx / length), +line.getAttribute('y1') - (a.y + 9 * dy / length)),
        Math.hypot(+line.getAttribute('x2') - (b.x - 9 * dx / length), +line.getAttribute('y2') - (b.y - 9 * dy / length)));
    }
    samples.push({ frame, phase, visible, error, authoritative: bridge.status().available, markerDisabled: [...document.querySelectorAll('[data-route-marker]')].every(node => node.disabled) });
    for (let i = waiters.length - 1; i >= 0; i--) if (frame >= waiters[i].until) { waiters[i].resolve(); waiters.splice(i, 1); }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
  globalThis.overlayQA = {
    phase(value) { phase = value; },
    frames(count) { return new Promise(resolve => waiters.push({ until: frame + count, resolve })); },
    negative(value) { velocity = 0; camera.zoom += .0001; projectionWidth = value === 'camera' ? 850 : 900; complete = value !== 'census'; scope = value === 'scope' ? 'other/self' : 'fixture/self'; panel.render(); },
    finish() { const diagnostics = panel.getVisualDiagnostics(); stopped = true; panel.destroy(); bridge.stop(); observer.stop(); MessagePort.prototype.postMessage = originalPost; pixi?.destroy(); return { scenario: qa, portPosts, portDeliveries, samples, sceneCallbacks, sampleCallbacks, pointerEvents, wheelEvents, diagnostics }; },
  };
}
