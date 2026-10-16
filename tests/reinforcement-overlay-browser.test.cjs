'use strict';
// No npm dependencies, requests to the game, accounts, or production actions.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, '..');
const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/opt/google/chrome/chrome'];

for (const scenario of [{ order: 'before', transport: 0, renderer: 'canvas' }, { order: 'after', transport: 0, renderer: 'canvas' }, { order: 'before', transport: 45, renderer: 'pixi' }, { order: 'after', transport: 45, renderer: 'pixi' }, { order: 'before', transport: 180, renderer: 'pixi', method: 'unproject' }, { order: 'after', transport: 180, renderer: 'pixi', method: 'unproject' }])
test('browser overlay remains visible and aligned during offline pan inertia zoom reversal and census updates' + (scenario.order === 'before' && scenario.transport === 0 ? '' : ' [' + scenario.order + '/' + scenario.transport + '/' + scenario.renderer + ']'), { timeout: 60000 }, async t => {
  const executable = candidates.find(file => fs.existsSync(file));
  if (!executable) {
    assert.notEqual(process.env.OVERLAY_BROWSER_REQUIRED, '1', 'Required Chromium browser is unavailable');
    t.diagnostic('BROWSER_UNAVAILABLE: no rendered evidence; install Chromium or use the required-browser CI job.');
    return;
  }
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'oldlight-overlay-browser-'));
  const processHandle = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--no-first-run', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', '--user-data-dir=' + path.join(artifacts, 'profile'), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket, serial = 0, session, stderr = '', closeBrowser;
  const pending = new Map(), errors = [], requests = [];
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Chromium startup timeout: ' + stderr.slice(-500))), 15000);
      processHandle.once('error', error => { clearTimeout(timer); reject(error); });
      processHandle.stderr.on('data', chunk => { stderr += chunk; const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const value = JSON.parse(event.data), request = pending.get(value.id);
      if (request) { pending.delete(value.id); clearTimeout(request.timer); value.error ? request.reject(Error(JSON.stringify(value.error))) : request.resolve(value.result); }
      if (value.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(value.params.type)) errors.push(value.params.type);
      if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.text);
      if (value.method === 'Network.requestWillBeSent') requests.push(value.params.request.url);
    });
    function command(method, params = {}, target = session) {
      return new Promise((resolve, reject) => {
        const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
      });
    }
    closeBrowser = () => command('Browser.close', {}, null);
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
    session = (await command('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await command('Runtime.enable'); await command('Page.enable'); await command('Network.enable');
    await command('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    await command('Emulation.setDeviceMetricsOverride', { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
    async function evaluate(expression) {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
    }
    const source = fs.readFileSync(process.env.QA_REINFORCEMENT_PANEL_SOURCE || path.join(root, 'docs/reinforcement-panel.js'), 'utf8');
    await evaluate(source);
    const mapSource = fs.readFileSync(process.env.QA_REINFORCEMENT_MAP_SOURCE || path.join(root, 'docs/reinforcement-map.js'), 'utf8');
    await evaluate(mapSource); await evaluate('globalThis.__mapSource=' + JSON.stringify(mapSource));
    await evaluate(fs.readFileSync(path.join(__dirname, 'native-camera-excerpt.fixture.js'), 'utf8'));
    const pixiSource = fs.readFileSync(path.join(__dirname, 'vendor/pixi-8.22.0.min.js'), 'utf8');
    const pixiSha256 = require('node:crypto').createHash('sha256').update(pixiSource).digest('hex');
    assert.equal(pixiSha256, '06d9ef9823e743518793083c296d801e752db128cb1f519fbabe37e1259567ea', 'Unmodified official Pixi distribution');
    if (scenario.renderer === 'pixi') await evaluate(pixiSource);
    await evaluate('globalThis.__fixtureUUID=' + JSON.stringify(require('node:crypto').randomUUID()));
    await evaluate('globalThis.__overlayScenario=' + JSON.stringify(scenario));
    await evaluate('globalThis.__disableProjectionNotifications=' + (process.env.QA_OVERLAY_DISABLE_NOTIFICATIONS === '1'));
    await evaluate('globalThis.__disableOverlayFrames=' + (process.env.OVERLAY_BROWSER_DISABLE_CALLBACKS === '1')); 
    await evaluate(fs.readFileSync(path.join(__dirname, 'reinforcement-overlay-browser.fixture.js'), 'utf8') + '\ninstallOverlayBrowserFixture();');
    assert.equal(await evaluate('document.title'), 'Offline reinforcement overlay QA');
    assert.equal(await evaluate("document.querySelectorAll('.oldlight-routes').length"), 1, 'Production UI must render');
    const frames = count => evaluate(`overlayQA.frames(${count})`);
    const phase = name => evaluate(`overlayQA.phase(${JSON.stringify(name)})`);
    const mouse = (type, x, y, extra = {}) => command('Input.dispatchMouseEvent', { type, x, y, ...extra });
    await phase('rest'); await frames(8);
    await phase('pan'); await mouse('mousePressed', 260, 360, { button: 'left', buttons: 1, clickCount: 1 });
    for (let n = 1; n <= 12; n++) { await mouse('mouseMoved', 260 + n * 12, 360, { buttons: 1 }); await frames(2); }
    await mouse('mouseReleased', 404, 360, { button: 'left', buttons: 0, clickCount: 1 });
    await phase('inertia'); await frames(25);
    await phase('zoom');
    for (let n = 0; n < 8; n++) { await mouse('mouseWheel', 350, 350, { deltaY: n < 4 ? -40 : 40, deltaX: 0 }); await frames(3); }
    await phase('reversal'); await mouse('mousePressed', 420, 360, { button: 'left', buttons: 1, clickCount: 1 });
    for (let n = 1; n <= 10; n++) { await mouse('mouseMoved', 420 - n * 15, 360, { buttons: 1 }); await frames(2); }
    await mouse('mouseReleased', 270, 360, { button: 'left', buttons: 0, clickCount: 1 }); await frames(12);
    const shot = await command('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(artifacts, 'movement.png'), Buffer.from(shot.data, 'base64'));
    for (const negative of ['camera', 'census', 'scope']) { await phase('invalid-' + negative); await evaluate(`overlayQA.negative('${negative}')`); await frames(38); }
    await phase('recovery'); await evaluate("overlayQA.negative('none')"); await frames(38);
    const result = await evaluate('overlayQA.finish()');
    result.pixiSha256 = scenario.renderer === 'pixi' ? pixiSha256 : null;
    result.fixtureSha256 = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'reinforcement-overlay-browser.fixture.js'))).digest('hex');
    result.nativeExcerptSha256 = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'native-camera-excerpt.fixture.js'))).digest('hex');
    result.mapSourceSha256 = require('node:crypto').createHash('sha256').update(mapSource).digest('hex');
    result.sourceSha256 = require('node:crypto').createHash('sha256').update(source).digest('hex');
    result.browserVersion = (await command('Browser.getVersion', {}, null)).product;
    result.browser = executable; result.renderer = 'real Chromium Canvas2D/Pixi 8.22.0 reference + native camera excerpt + production observer/MessagePort/SVG; not native galaxy boot';
    result.errors = errors; result.requests = requests;
    fs.writeFileSync(path.join(artifacts, 'frames.json'), JSON.stringify(result, null, 2)); t.diagnostic('BROWSER_ARTIFACTS=' + artifacts);
    assert.equal(errors.length, 0, JSON.stringify(errors)); assert.ok(result.portPosts > 0 && result.portDeliveries > 0, 'Real MessagePort transport must execute'); assert.equal(requests.length, 0);
    assert.ok(result.sceneCallbacks > 100 && result.sampleCallbacks > 100 && result.pointerEvents > 10 && result.wheelEvents === 8);
    assert.ok(result.samples.filter(sample => sample.visible && !sample.authoritative).length > 10, 'Exercise pending authoritative transport while decoration is visible');
    assert.ok(result.samples.every(sample => sample.authoritative || sample.markerDisabled), 'Pending decoration must not enable route markers');
    assert.ok(result.diagnostics.counts.rafCallbacks > 100, 'Production overlay RAF callbacks must execute');
    for (const name of ['rest', 'pan', 'inertia', 'zoom', 'reversal']) {
      const samples = result.samples.filter(sample => sample.phase === name);
      assert.ok(samples.length > 3, name + ' must execute actual browser frames');
      assert.equal(samples.filter(sample => !sample.visible).length, 0, name + ' has hidden frames');
      assert.ok(samples.every(sample => sample.error < 1), name + ' has misaligned frames; max=' + Math.max(...samples.map(sample => sample.error || 0)));
    }
    assert.ok(result.diagnostics.counts.projectionNotifications > 10, 'Native projection notifications must execute');
    const recovery = result.samples.filter(sample => sample.phase === 'recovery').slice(33);
    assert.ok(recovery.length >= 3 && recovery.every(sample => sample.visible && sample.error < 1 && sample.authoritative && !sample.markerDisabled), 'Fresh camera and census must recover usable route markers');
    for (const name of ['camera', 'census', 'scope']) {
      const samples = result.samples.filter(sample => sample.phase === 'invalid-' + name).slice(33);
      assert.ok(samples.length >= 3); assert.ok(samples.every(sample => !sample.visible), 'invalid ' + name + ' retains overlay');
    }
  } finally {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('Browser closed')); } pending.clear();
    if (closeBrowser) await closeBrowser().catch(() => {});
    socket?.close(); processHandle.kill('SIGKILL');
  }
});
