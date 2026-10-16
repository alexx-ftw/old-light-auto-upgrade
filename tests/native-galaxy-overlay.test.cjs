'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const assets = require('../tools/native-scene-assets.cjs'), browser = require('./helpers/native-browser.cjs');
const root = path.join(__dirname, '..'), harnessSource = fs.readFileSync(__filename);
const html = `<!doctype html><meta charset=utf-8><title>Offline native galaxy QA</title><link rel=icon href=data:,><style>body{margin:0;background:#071421;color:white;font:14px system-ui}#stage{width:900px;height:600px}main{position:absolute;left:910px;top:0;width:280px}</style><script>globalThis.offlineNetworkAttempts=[];globalThis.WebSocket=class{constructor(){offlineNetworkAttempts.push('socket');throw Error('Offline socket denied')}};globalThis.fetch=()=>{offlineNetworkAttempts.push('fetch');throw Error('Offline fetch denied')};XMLHttpRequest.prototype.open=function(){offlineNetworkAttempts.push('xhr-open');throw Error('Offline XHR denied')};navigator.sendBeacon=()=>{offlineNetworkAttempts.push('beacon');return false};for(const key of ['Worker','SharedWorker','EventSource'])globalThis[key]=class{constructor(){offlineNetworkAttempts.push(key);throw Error('Offline worker/stream denied')}};if(navigator.serviceWorker)navigator.serviceWorker.register=()=>{offlineNetworkAttempts.push('service-worker');throw Error('Offline service worker denied')};</script><div id=app><canvas id=stage></canvas></div><main></main>`;
for (const order of ['before', 'after']) test('native galaxy GPU scene and isolated production overlay align across ' + order + ' renderer order with delayed reordered ports', { timeout: 180000 }, async t => {
  assets.verify(); // Missing or mismatched public assets fail closed; no network fetch in this test.
  const b = await browser.open(url => {
    if (url.origin !== 'https://oldlight.io') return null;
    if (url.pathname === '/game/galaxy/fixture') return { type: 'text/html; charset=utf-8', body: html };
    const name = url.pathname.slice('/assets/'.length);
    if (!url.pathname.startsWith('/assets/')) return null;
    if (name === 'galaxy-offline.js') return { type: 'text/javascript', body: assets.offlineGalaxy() };
    return Object.hasOwn(assets.manifest, name) ? { type: 'text/javascript', body: assets.readAsset(name) } : null;
  });
  try {
    await b.command('Page.navigate', { url: 'https://oldlight.io/game/galaxy/fixture' });
    for (let i = 0; i < 100 && await b.evaluate('document.readyState') !== 'complete'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(await b.evaluate('document.title'), 'Offline native galaxy QA');
    const sceneSource = fs.readFileSync(path.join(__dirname, 'native-galaxy-scene.fixture.js'), 'utf8'), overlaySource = fs.readFileSync(path.join(__dirname, 'native-galaxy-overlay.fixture.js'), 'utf8');
    await b.evaluate(sceneSource + '\ninstallNativeGalaxyScene(' + JSON.stringify({ order }) + ')');
    const isolated = await b.isolated(), evaluate = expression => b.evaluate(expression, isolated);
    const panelSource = fs.readFileSync(process.env.QA_REINFORCEMENT_PANEL_SOURCE || path.join(root, 'docs/reinforcement-panel.js'), 'utf8');
    const mapSource = fs.readFileSync(process.env.QA_REINFORCEMENT_MAP_SOURCE || path.join(root, 'docs/reinforcement-map.js'), 'utf8');
    await evaluate(panelSource); await evaluate(mapSource);
    await evaluate('globalThis.__shiftNativeOverlay=' + (process.env.QA_NATIVE_SHIFT_OVERLAY === '1'));
    await evaluate('globalThis.__disableNativeNotifications=' + (process.env.QA_DISABLE_NATIVE_NOTIFICATIONS === '1'));
    await evaluate(overlaySource + '\ninstallNativeGalaxyOverlay()');
    if (order === 'before') await b.evaluate('nativeGalaxyQA.start()');
    await evaluate('nativeOverlayQA.mount()');
    if (order === 'after') await b.evaluate('nativeGalaxyQA.start()');
    await evaluate('nativeOverlayQA.startSampling()');
    assert.equal(await evaluate("document.querySelectorAll('.oldlight-routes').length"), 1);
    const phase = name => evaluate('nativeOverlayQA.phase(' + JSON.stringify(name) + ')');
    const frames = count => evaluate('nativeOverlayQA.frames(' + count + ')');
    const mouse = (type, x, y, extra = {}) => b.command('Input.dispatchMouseEvent', { type, x, y, ...extra });
    await frames(4); await phase('rest'); await frames(8);
    await b.evaluate("nativeGalaxyQA.mode('delayed')"); await phase('pan');
    await mouse('mousePressed', 350, 420, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', 350 + i * 6, 420, { buttons: 1 }); await frames(2); }
    await mouse('mouseReleased', 398, 420, { button: 'left', buttons: 0, clickCount: 1 });
    await phase('inertia'); await b.evaluate("nativeGalaxyQA.mode('jitter');nativeGalaxyQA.coast()"); await frames(32);
    await phase('zoom');
    for (let i = 0; i < 6; i++) { await mouse('mouseWheel', 350, 420, { deltaY: i < 3 ? -40 : 40, deltaX: 0 }); await frames(3); }
    await phase('reversal'); await mouse('mousePressed', 420, 420, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', 420 - i * 6, 420, { buttons: 1 }); await frames(2); }
    await mouse('mouseReleased', 372, 420, { button: 'left', buttons: 0, clickCount: 1 }); await frames(16);
    const screenshot = await b.command('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(b.artifacts, 'movement.png'), Buffer.from(screenshot.data, 'base64'));
    await phase('pre-expiry'); await b.evaluate("nativeGalaxyQA.mode('immediate');nativeGalaxyQA.negative('none')"); await frames(12);
    await phase('invalid-expiry'); await b.evaluate('nativeGalaxyQA.stall()'); await frames(3);
    await b.evaluate("nativeGalaxyQA.mode('jitter')");
    for (const negative of ['camera', 'census', 'scope']) {
      await phase('invalid-' + negative); await b.evaluate('nativeGalaxyQA.negative(' + JSON.stringify(negative) + ')');
      await evaluate('nativeOverlayQA.scope(' + JSON.stringify(negative === 'scope' ? 'other/self' : 'fixture/self') + ')'); await frames(38);
    }
    await phase('recovery'); await b.evaluate("nativeGalaxyQA.negative('none')"); await evaluate("nativeOverlayQA.scope('fixture/self')"); await frames(120);
    await phase('recovered'); await b.evaluate("nativeGalaxyQA.mode('immediate');nativeGalaxyQA.negative('none')"); await frames(16);
    const result = await evaluate('nativeOverlayQA.finish()'); result.scene = await b.evaluate('nativeGalaxyQA.summary()');
    result.networkAttempts = await b.evaluate('offlineNetworkAttempts'); result.errors = b.errors; result.requests = b.requests; result.denied = b.denied; result.order = order;
    result.browser = (await b.command('Browser.getVersion', {}, null)).product;
    result.sourceHashes = { panel: assets.digest(panelSource), map: assets.digest(mapSource), assetManifest: assets.digest(fs.readFileSync(path.join(__dirname, 'fixtures/native-galaxy-assets.json'))), transformedGalaxy: assets.digest(assets.offlineGalaxy()), sceneFixture: assets.digest(sceneSource), overlayFixture: assets.digest(overlaySource), browserHarness: assets.digest(harnessSource) };
    fs.writeFileSync(path.join(b.artifacts, 'frames.json'), JSON.stringify(result, null, 2)); t.diagnostic('NATIVE_BROWSER_ARTIFACTS=' + b.artifacts);
    await b.evaluate('nativeGalaxyQA.stop()');
    assert.deepEqual(result.errors, [], 'Native application console/exceptions'); assert.deepEqual(result.networkAttempts, []); assert.deepEqual(result.denied, []);
    assert.ok(result.requests.includes('/assets/transits-DloGaxtE.js'));
    assert.equal(result.scene.stallsExecuted, 1, 'Real stalled native frame must execute');
    assert.ok(result.samples.some(sample => sample.phase === 'invalid-expiry' && !sample.authoritative), 'Stall must cross the actual camera freshness boundary');
    assert.ok(result.scene.gpuStarsEnabled && result.scene.nativeStars >= 6 && result.scene.pointerEvents > 10 && result.scene.wheelEvents === 6);
    for (const [name, column, minimum] of [['pan', 0, 10], ['inertia', 0, 20], ['zoom', 2, .03], ['reversal', 0, 10]]) { const values = result.samples.filter(sample => sample.phase === name).map(sample => sample.camera[column]); assert.ok(Math.max(...values) - Math.min(...values) > minimum, name + ' must move the native controller'); }
    assert.ok(new Set(result.samples.map(sample => sample.revision)).size > 20, 'Native World census updates must execute'); assert.ok(result.scene.layerCount === 6 && result.scene.renders > 150 && result.samplesExecuted > 150);
    assert.ok(result.received.length > 10 && result.reorders > 0, 'Real MessagePort delayed/reordered deliveries must execute');
    assert.ok(result.diagnostics.counts.rafCallbacks > 150 && result.diagnostics.counts.projectionNotifications > 10);
    for (const name of ['rest', 'pan', 'inertia', 'zoom', 'reversal']) {
      const samples = result.samples.filter(sample => sample.phase === name);
      assert.ok(samples.length >= 6, name + ' actual native frames');
      assert.ok(samples.every(sample => sample.visible), name + ' hidden frames: ' + samples.filter(sample => !sample.visible).length);
      assert.ok(samples.every(sample => sample.projectionError !== null && sample.projectionError < 1), name + ' projection alignment');
      assert.ok(samples.every(sample => sample.rasterError !== null && sample.rasterError < 2), name + ' GPU pixel alignment: ' + Math.max(...samples.map(sample => sample.rasterError || 0)));
      assert.ok(samples.every(sample => sample.raster.every(point => point && point.count >= 3)), name + ' native GPU stellar cores must actually render');
    }
    assert.ok(result.samples.filter(sample => sample.phase === 'recovery').some(sample => sample.visible && sample.authoritative && sample.markerReachable), 'Jitter recovery must actually regain useful authority');
    assert.ok(result.samples.some(sample => sample.visible && !sample.authoritative), 'Exercise decoration while authoritative camera is pending');
    assert.ok(result.samples.every(sample => sample.authoritative || !sample.markerReachable), 'No marker authority from decoration');
    for (const name of ['camera', 'census', 'scope']) assert.ok(result.samples.filter(sample => sample.phase === 'invalid-' + name).slice(-4).every(sample => !sample.visible), 'Invalid ' + name + ' revokes overlay');
    assert.ok(result.samples.filter(sample => sample.phase === 'recovered').slice(-4).every(sample => sample.visible && sample.rasterError < 2 && sample.authoritative && sample.markerReachable), 'Fresh recovery restores useful authoritative markers');
  } finally { await b.close(); }
});
