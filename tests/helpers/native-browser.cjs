'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawn } = require('node:child_process');
const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/opt/google/chrome/chrome'];
async function open(serve) {
  const executable = candidates.find(file => fs.existsSync(file));
  if (!executable) throw Error('Native galaxy coverage requires Chromium');
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'oldlight-native-browser-'));
  const child = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', '--user-data-dir=' + path.join(artifacts, 'profile'), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket, serial = 0, session, stderr = '', command;
  const pending = new Map(), errors = [], requests = [], denied = [];
  async function close() {
    if (command && socket?.readyState === WebSocket.OPEN) await command('Browser.close', {}, null).catch(() => {});
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Browser closed')); } pending.clear(); socket?.close(); child.kill('SIGKILL');
  }
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Native Chromium startup timeout')), 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stderr.on('data', data => { stderr += data; const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    socket = new WebSocket(endpoint); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    command = (method, params = {}, target = session) => new Promise((resolve, reject) => {
      const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 60000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
    });
    socket.addEventListener('message', event => {
      const value = JSON.parse(event.data), request = pending.get(value.id);
      if (request) { pending.delete(value.id); clearTimeout(request.timer); value.error ? request.reject(Error(JSON.stringify(value.error))) : request.resolve(value.result); }
      if (value.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(value.params.type)) errors.push({ type: value.params.type, text: value.params.args.map(a => a.value || a.description || '').join(' ') });
      if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails);
      if (value.method === 'Network.webSocketCreated') { errors.push('Unexpected native socket'); denied.push('socket'); }
      if (value.method === 'Fetch.requestPaused') {
        const p = value.params;
        Promise.resolve().then(() => {
          const url = new URL(p.request.url), item = p.request.method === 'GET' ? serve(url) : null;
          if (!item) { denied.push(url.pathname); return command('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }); }
          requests.push(url.pathname);
          return command('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: item.type }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(item.body).toString('base64') });
        }).catch(error => { errors.push(error.message); command('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); });
      }
    });
    const targetId = (await command('Target.createTarget', { url: 'about:blank' }, null)).targetId;
    session = (await command('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId;
    await command('Runtime.enable'); await command('Page.enable'); await command('Network.enable'); await command('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await command('Emulation.setDeviceMetricsOverride', { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
    async function evaluate(expression, contextId) {
      const r = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
    }
    async function isolated() { const frame = (await command('Page.getFrameTree')).frameTree.frame; return (await command('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'oldlight-offline-helper', grantUniveralAccess: false })).executionContextId; }
    return { artifacts, executable, errors, requests, denied, command, evaluate, isolated, close };
  } catch (error) { await close(); throw error; }
}
module.exports = { open };
