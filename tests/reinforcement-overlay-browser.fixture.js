/* Offline Canvas2D reference scene, not the native Pixi scene or a game connection.
 * Production SVG overlay is unmodified. Projection follows the documented native
 * perspective camera; this boundary does NOT exercise the camera MessagePort.
 */
function installOverlayBrowserFixture() {
  document.title = 'Offline reinforcement overlay QA';
  document.body.innerHTML = '<style>body{margin:0;background:#071421;color:white;font:14px system-ui}#stage{position:absolute;left:0;top:0;width:900px;height:600px}main{position:absolute;left:910px;top:0;width:280px}#caption{position:absolute;top:610px}</style><div id="app"><canvas id="stage" width="900" height="600"></canvas></div><main></main><p id="caption">OFFLINE REFERENCE SCENE · No game connection</p>';
  const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
  const rows = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', q: -3, r: 1, name: 'Origin' },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', q: 4, r: -1, name: 'Destination' }];
  const camera = { x: 0, y: 0, zoom: 1 }, samples = [], waiters = [];
  let frame = 0, phase = 'rest', velocity = 0, dragging = false, lastX = 0;
  let cameraAvailable = true, complete = true, scope = 'fixture/self', revision = 0, stopped = false;
  let pointerEvents = 0, wheelEvents = 0, sceneCallbacks = 0, sampleCallbacks = 0;
  function point(system) {
    const x = 69 * system.q, y = 46 * Math.sqrt(3) * (system.r + system.q / 2);
    const depth = (y - camera.y) * Math.cos(55 * Math.PI / 180) + 1100;
    return { x: 1000 * camera.zoom * (x - camera.x) / depth + 450,
      y: -1000 * camera.zoom * (y - camera.y) * Math.sin(55 * Math.PI / 180) / depth + 300, visible: depth > 1 };
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
    context.fillStyle = '#071421'; context.fillRect(0, 0, 900, 600);
    for (const system of rows) {
      const p = point(system); context.fillStyle = '#ffffff'; context.beginPath(); context.arc(p.x, p.y, 7, 0, Math.PI * 2); context.fill();
      context.fillText(system.name, p.x + 12, p.y - 12);
    }
    document.querySelector('#caption').textContent = `OFFLINE REFERENCE · ${phase} · native animation frame ${frame}`;
    requestAnimationFrame(scene);
  }
  requestAnimationFrame(scene); // Reference renderer registers before the overlay.
  const panelWindow = globalThis.__disableOverlayFrames ? new Proxy(window, { get(target, key) { if (key === 'requestAnimationFrame') return () => 0; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } }) : window;
  const panel = OldLightReinforcementPanel.create({ document, window: panelWindow, getScope: () => scope,
    getWorld: () => ({ scope: 'fixture/self', galaxy: 'fixture', selfId: 'self', connected: true, complete,
      observedAt: Date.now(), generation: 1, epoch: 1, revision, systems: rows }),
    getRoutes: () => [{ id: 'route', originId: rows[0].id, destinationId: rows[1].id, paused: false, intervalMinutes: 5,
      ships: { probe: { mode: 'fixed', amount: 1 } } }],
    projectSystem: system => cameraAvailable ? point(system) : null });
  panel.mount(document.querySelector('main'));
  function sample() {
    if (stopped) return;
    sampleCallbacks++;
    const svg = document.querySelector('.oldlight-route-overlay'), line = svg?.querySelector('line');
    const visible = !!line && !svg.hidden && getComputedStyle(svg).display !== 'none' && getComputedStyle(svg).visibility !== 'hidden';
    let error = null;
    if (visible) {
      const a = point(rows[0]), b = point(rows[1]);
      // Route endpoints deliberately stop 9 logical pixels from star centres.
      const da = Math.hypot(+line.getAttribute('x1') - a.x, +line.getAttribute('y1') - a.y);
      const db = Math.hypot(+line.getAttribute('x2') - b.x, +line.getAttribute('y2') - b.y);
      error = Math.max(Math.abs(da - 9), Math.abs(db - 9));
    }
    samples.push({ frame, phase, visible, error });
    for (let i = waiters.length - 1; i >= 0; i--) if (frame >= waiters[i].until) { waiters[i].resolve(); waiters.splice(i, 1); }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
  globalThis.overlayQA = {
    phase(value) { phase = value; },
    frames(count) { return new Promise(resolve => waiters.push({ until: frame + count, resolve })); },
    negative(value) { velocity = 0; cameraAvailable = value !== 'camera'; complete = value !== 'census'; scope = value === 'scope' ? 'other/self' : 'fixture/self'; panel.render(); },
    finish() { const diagnostics = panel.getVisualDiagnostics(); stopped = true; panel.destroy(); return { samples, sceneCallbacks, sampleCallbacks, pointerEvents, wheelEvents, diagnostics }; },
  };
}
