/* Offline map-scene entrypoint: real native classes/methods and complete map
 * stage layers, synthetic World/config/sector records, no authenticated boot. */
async function installNativeGalaxyScene(scenario) {
  const native = await import('/assets/galaxy-offline.js');
  native.setConfig({ sectorSpacing: 12, sectorShapeSalt: 12345, galaxyBounds: { qMin: -30, qMax: 30, rMin: -30, rMax: 30 } });
  const rows = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', q: -3, r: 1, name: 'Origin' }, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', q: 4, r: -1, name: 'Destination' }].map(row => ({ ...row, score: 100, capturedAt: 0, buildings: [], fleet: [] }));
  const player = { id: 'self', kind: 'human', name: 'Offline owner', spawn: { q: -3, r: 1 }, owned: rows, transits: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', fromQ: -6, fromR: 2, toQ: -6, toR: -2, phase: 'outbound', kind: 'trade', departureAt: new Date(Date.now() - 5000).toISOString(), arrivesAt: new Date(Date.now() + 60000).toISOString(), recalledAt: null, ships: [{ type: 'probe', quantity: 2 }] }], incomingTransits: [], markers: [] };
  const world = new native.World({ players: [player], shipSpeeds: {} }, 'self');
  const stars = rows.map(row => ({ ...row, type: 'medium', ownerId: 'self', hexId: row.id, ownerKind: 'human', ownerName: player.name, ownerHexName: row.name }));
  // Additional unowned native star types, without replacing GPU star meshes.
  for (const [q, r, type] of [[-6, 2, 'small'], [7, -3, 'large'], [2, 3, 'binary'], [-6, -2, 'medium']]) stars.push({ q, r, type });
  world.stars.upsertCells(new Set(stars.map(row => row.q + ',' + row.r)), stars); world.rebuildOwnedMap();
  const canvas = document.querySelector('#stage'), app = new native.App();
  await app.init({ canvas, width: 900, height: 600, background: native.palette.bg, antialias: true, autoDensity: true, preference: 'webgl', resolution: 1, autoStart: false });
  const layers = Array.from({ length: 4 }, () => new native.Container()); app.stage.addChild(...layers);
  let dirty = true, grid, hover;
  const controller = new native.Controller(app, canvas, {
    onChange() { dirty = true; }, onHover(hex) { grid?.setHover(hex); hover?.setHover(hex); dirty = true; },
    // Native picking can select locally; no dispatch/client/network handlers.
    onClick(hex) { world.setSelected(hex); dirty = true; }, onLongPress() {},
  });
  controller.setZoom(1); controller.centerOn(0, 0);
  grid = new native.Grid(layers[1], world, controller, () => { dirty = true; }, () => { dirty = true; });
  const transits = new native.Transits(layers[2]), selection = new native.Selection(layers[2]);
  const cache = new native.SectorCache({ request: async coords => coords.map(coord => ({ ...coord, name: 'Offline sector', holderId: null, holderName: null, holderKind: null, bonusType: 'production', bonusPct: 5 })) });
  const sectors = new native.Sectors(layers[3], controller, cache, app.renderer, () => undefined, (q, r) => grid.liveSectors.has(q + ',' + r));
  cache.onUpdate(() => { dirty = true; });
  const actions = new native.Actions(document.querySelector('#app')); hover = new native.Hover(document.querySelector('#app'), world);
  const pulse = new native.Graphics(); pulse.eventMode = 'none'; app.stage.addChild(pulse);
  const shade = new native.Sprite(native.vignette(native.palette.bg)); shade.width = 900; shade.height = 600; shade.eventMode = 'none'; app.stage.addChild(shade);
  let frame = 0, revision = 0, complete = true, stopped = false, renders = 0, portPosts = 0, deliveredPosts = 0;
  let portMode = 'immediate', parity = 0, stallNextFrame = false, stallsExecuted = 0;
  const originalPost = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function(data, ...args) {
    let packet; try { packet = typeof data === 'string' && JSON.parse(data); } catch (_) {}
    if (!packet?.camera) return originalPost.call(this, data, ...args);
    portPosts++; const receiver = this, delay = portMode === 'jitter' ? (++parity % 2 ? 20 : 320) : portMode === 'delayed' ? 180 : 0;
    const send = () => { deliveredPosts++; originalPost.call(receiver, data, ...args); };
    if (delay) setTimeout(send, delay); else send();
  };
  // Observe the actual native controller's browser input methods, preserving
  // argument/receiver behavior rather than replacing the input pipeline.
  let pointerEvents = 0, wheelEvents = 0;
  canvas.addEventListener('pointerdown', () => pointerEvents++); canvas.addEventListener('pointermove', () => pointerEvents++); canvas.addEventListener('pointerup', () => pointerEvents++); canvas.addEventListener('wheel', () => wheelEvents++);
  function expected(row) {
    const p = native.axial(row.q, row.r);
    return Object.getPrototypeOf(native.camera).project.call(native.camera, p.x, p.y, controller.cameraX, controller.cameraY, controller.zoom, controller.screenWidth, controller.screenHeight);
  }
  function starPixels(point) {
    const size = 48, left = Math.round(point.x) - size / 2, top = Math.round(point.y) - size / 2;
    if (left < 0 || top < 0 || left + size > 900 || top + size > 600) return null;
    const pixels = new Uint8Array(size * size * 4), gl = app.renderer.gl;
    gl.readPixels(left, 600 - top - size, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const weights = new Float64Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = ((size - 1 - y) * size + x) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      // Gold native stellar core and symmetric orbital ring. White active
      // brackets and lime territory borders are excluded by colour.
      if (r > 190 && g > 160 && b > 100 && b < r * .92) weights[y * size + x] = Math.max(0, r + g + b - 580);
    }
    let total = 0, sx = 0, sy = 0, count = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const weight = weights[y * size + x]; total += weight; sx += (left + x + .5) * weight; sy += (top + y + .5) * weight; if (weight) count++;
    }
    return total > 0 ? { x: sx / total, y: sy / total, count } : null;
  }
  function publish() {
    canvas.setAttribute('data-offline-world', JSON.stringify({ scope: 'fixture/self', galaxy: 'fixture', selfId: 'self', connected: true, complete, observedAt: Date.now(), generation: 1, epoch: 1, revision, systems: world.ownedHexes().filter(row => row.playerId === world.myPlayerId) }));
  }
  function draw() {
    if (stopped) return;
    frame++;
    const zooming = controller.stepZoom(), moving = controller.stepPan();
    if (moving || zooming) dirty = true;
    if (frame % 7 === 0) { revision++; world.applyDelta({ updated: { players: [{ ...player, owned: rows.map(row => ({ ...row, score: 100 + revision })) }] } }); dirty = true; }
    publish();
    if (dirty) { dirty = false; grid.render(); selection.render(controller, world); sectors.render(); }
    grid.tickAnimations(Date.now()); transits.update(world.myTransits(), controller, Date.now(), world.myIncomingTransits(), (q, r) => world.isMine(q, r)); actions.tick(controller); hover.tick(controller, actions.isOpen());
  }
  const nativeRender = app.render.bind(app);
  function renderAndCapture() {
    nativeRender(); renders++;
    const projected = rows.map(expected), raster = projected.map(starPixels);
    if (stallNextFrame) { stallNextFrame = false; const until = performance.now() + 1700; while (performance.now() < until) {} stallsExecuted++; }
    canvas.setAttribute('data-offline-frame', JSON.stringify({ frame, projected, raster, camera: [controller.cameraX, controller.cameraY, controller.zoom], active: grid.activeCount, renders, pointerEvents, wheelEvents, revision }));
  }
  // Same native ticker arrangement as galaxy boot: update NORMAL, render LOW.
  app.ticker.remove(app.render, app); app.ticker.add(draw); app.ticker.add(renderAndCapture, undefined, native.priority.LOW); app.ticker.maxFPS = 60;
  publish(); draw(); renderAndCapture();
  globalThis.nativeGalaxyQA = {
    start() { app.ticker.start(); },
    mode(value) { portMode = value; }, stall() { stallNextFrame = true; },
    coast() { controller.swoopTo(controller.cameraX + 50, controller.cameraY + 20); dirty = true; },
    negative(value) { complete = value !== 'census'; canvas.hidden = value === 'camera'; dirty = true; controller.swoopTo(controller.cameraX + .5, controller.cameraY); publish(); },
    summary() { return { frame, renders, portPosts, deliveredPosts, controllerClass: controller.constructor.name, gridClass: grid.constructor.name, layerCount: app.stage.children.length, nativeStars: grid.stars.count, gpuStarsEnabled: grid.stars.enabled, pointerEvents, wheelEvents, stallsExecuted }; },
    stop() { stopped = true; app.ticker.stop(); cache.clear(); controller.destroy(); MessagePort.prototype.postMessage = originalPost; app.destroy(); },
  };
}
