'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../docs/telemetry-core.js');
const { create, ENDPOINT } = require('../docs/telemetry-posthog-transport.js');
const report = () => ({ schema: 1, helper_version: '1.17.8', counts: { 'helper.loaded': 1 }, duration_buckets: { helper_step: {} } });
function setup(extra = {}) {
  const requests = []; let aborted = 0, id = 0;
  const timers = new Map(); let timerID = 0;
  const transport = create({ projectToken: 'phc_syntheticTestOnly0123456789',
    randomUUID: () => `12345678-1234-4234-8234-${String(++id).padStart(12, '0')}`,
    request: options => { requests.push(options); return { abort() { aborted++; } }; },
    setTimeout: fn => { timers.set(++timerID, fn); return timerID; },
    clearTimeout: id => timers.delete(id), ...extra });
  const controller = new AbortController();
  return { transport, requests, timers, controller, aborted: () => aborted,
    send: (input = report()) => transport(input, { signal: controller.signal }),
    load: (response = {}) => requests.at(-1).onload({ status: 200, finalUrl: ENDPOINT, responseText: '{"status":1}', ...response }) };
}
test('fixed anonymous bounded request has no page/user data, and accepts expected JSON', async () => {
  const h = setup(), promise = h.send();
  const req = h.requests[0], event = JSON.parse(req.data);
  assert.equal(req.url, ENDPOINT); assert.equal(req.method, 'POST');
  assert.equal(req.anonymous, true); assert.equal(req.withCredentials, false);
  assert.equal(req.redirect, 'error'); assert.equal(req.timeout, core.TIMEOUT);
  assert.deepEqual(req.headers, { 'Content-Type': 'application/json', Accept: 'application/json', Referer: '', Origin: '' });
  assert.equal(event.properties.$process_person_profile, false); assert.equal(event.properties.$geoip_disable, true);
  assert.equal(event.properties.$ip, '0.0.0.0'); assert.equal(event.properties.synthetic, undefined);
  assert.deepEqual(Object.keys(event), ['api_key', 'event', 'distinct_id', 'properties']);
  assert.ok(req.data.length < core.MAX_BYTES);
  h.load(); assert.deepEqual(await promise, { accepted: true }); assert.equal(h.timers.size, 0);
});
for (const response of [
  { status: 0 }, { status: 199 }, { status: 300 }, { status: 500 }, { status: '200' },
  { finalUrl: undefined }, { finalUrl: ENDPOINT + '?private=1' }, { finalUrl: 'https://example.test/' },
  { responseText: '1' }, { responseText: 'null' }, { responseText: '[]' }, { responseText: '{"status":"1"}' },
  { responseText: '{"status":"ok"}' }, { responseText: '{"status":"OK"}' },
  { responseText: '{"status":"Ok","quota_limited":["events"]}' },
  { responseText: '{"status":"Ok","error":"bad"}' },
  { responseText: 'not json' }, { responseText: '{"status":0}' }, { responseText: '{"status":1,"error":"bad"}' },
  { responseText: '{"status":1,"quota_limited":["events"]}' }, { responseText: '{"status":1,"quota_limited":true}' },
  { responseText: ' '.repeat(4097) },
]) test('rejects invalid HTTP/URL/body without retries: ' + JSON.stringify(response).slice(0, 100), async () => {
  const h = setup(), promise = h.send(); h.load(response);
  assert.deepEqual(await promise, { accepted: false }); assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
});
test('empty quota list is accepted', async () => {
  const h = setup(), p = h.send(); h.load({ responseText: '{"status":1,"quota_limited":[]}' });
  assert.equal((await p).accepted, true);
});
test('abort and timeout cancel active request and ignore late acceptance', async () => {
  for (const cancel of [h => h.controller.abort(), h => [...h.timers.values()][0](), h => h.requests[0].ontimeout()]) {
    const h = setup(), promise = h.send(); cancel(h); h.load();
    assert.deepEqual(await promise, { accepted: false }); assert.equal(h.aborted(), 1); assert.equal(h.requests.length, 1);
    assert.equal(h.timers.size, 0);
  }
});
test('abort before dispatch sends nothing; missing signal sends nothing', async () => {
  const h = setup(); h.controller.abort();
  assert.equal((await h.send()).accepted, false); assert.equal((await h.transport(report())).accepted, false);
  assert.equal(h.requests.length, 0);
});
test('reentrant abort during request setup aborts returned handle', async () => {
  const controller = new AbortController(); let aborted = 0;
  const h = setup({ request() { controller.abort(); return { abort() { aborted++; } }; } });
  assert.equal((await h.transport(report(), { signal: controller.signal })).accepted, false); assert.equal(aborted, 1);
});
test('rejects observed redirect and aborts request', async () => {
  const h = setup(), p = h.send(); h.requests[0].onreadystatechange({ status: 302, finalUrl: ENDPOINT });
  h.load(); assert.equal((await p).accepted, false); assert.equal(h.aborted(), 1);
});
test('no concurrent send or automatic retry; fresh batch identifiers', async () => {
  const h = setup(), p = h.send(); assert.equal((await h.send()).accepted, false);
  h.load(); await p; const second = h.send(); h.load(); await second;
  assert.equal(h.requests.length, 2);
  assert.notEqual(JSON.parse(h.requests[0].data).distinct_id, JSON.parse(h.requests[1].data).distinct_id);
});
test('malformed report never reaches network, synthetic is construction-only', async () => {
  const h = setup(); assert.equal((await h.send({ ...report(), synthetic: true })).accepted, false);
  assert.equal((await h.send({ ...report(), account: 'secret' })).accepted, false); assert.equal(h.requests.length, 0);
  const s = setup({ synthetic: true }), p = s.send();
  assert.equal(JSON.parse(s.requests[0].data).properties.synthetic, true); s.load(); await p;
});
test('invalid tokens and missing dependencies fail at construction', () => {
  for (const projectToken of ['', 'phx_privateKey01234567890', 'phk_privateKey01234567890', 'https://example.test']) {
    assert.throws(() => setup({ projectToken }));
  }
  assert.throws(() => setup({ request: undefined })); assert.throws(() => setup({ randomUUID: undefined }));
  assert.throws(() => setup({ synthetic: 'yes' }));
});
test('network errors and thrown adapters settle once', async () => {
  for (const callback of ['onerror', 'onabort']) {
    const h = setup(), p = h.send(); h.requests[0][callback](); h.load();
    assert.equal((await p).accepted, false); assert.equal(h.timers.size, 0);
  }
  assert.equal((await setup({ request() { throw new Error('offline'); } }).send()).accepted, false);
});
test('browser globals load without CommonJS, storage or network side effects', () => {
  const sandbox = vm.createContext({});
  for (const file of ['telemetry-core.js', 'telemetry-posthog-payload.js', 'telemetry-posthog-transport.js'])
    vm.runInContext(fs.readFileSync(require.resolve('../docs/' + file), 'utf8'), sandbox);
  assert.equal(typeof sandbox.OldLightTelemetryPostHogPayload.encode, 'function');
  assert.equal(typeof sandbox.OldLightTelemetryPostHogTransport.create, 'function');
  assert.equal(sandbox.OldLightTelemetryPostHogTransport.ENDPOINT, ENDPOINT);
});
test('pure browser encoder stays disconnected', () => {
  const source = fs.readFileSync(require.resolve('../docs/telemetry-posthog-payload.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|GM_xmlhttpRequest|localStorage|sessionStorage)\b|phc_|phx_|phk_|api_key|https?:\/\//);
});
test('all maximum counters and synthetic marker still fit bounded envelope', async () => {
  const input = report();
  input.counts = Object.fromEntries(core.EVENTS.map(key => [key, core.MAX_COUNT]));
  input.duration_buckets.helper_step = Object.fromEntries(core.BUCKETS.map(key => [key, core.MAX_COUNT]));
  const h = setup({ synthetic: true, projectToken: 'phc_' + 'x'.repeat(200) }), p = h.send(input);
  assert.equal(h.requests.length, 1); assert.ok(h.requests[0].data.length <= core.MAX_BYTES); h.load();
  assert.equal((await p).accepted, true);
});
test('missing abort handle fails closed and late callbacks cannot change completed result', async () => {
  const h = setup({ request() { return {}; } }); assert.equal((await h.send()).accepted, false);
  const normal = setup(), p = normal.send(); normal.load();
  assert.equal((await p).accepted, true); normal.requests[0].ontimeout(); assert.equal(normal.aborted(), 0);
});

test('EU capture exact Ok acknowledgement is accepted alongside legacy numeric status', async () => {
  for (const body of ['{"status":"Ok"}', '{"status":"Ok","quota_limited":[]}', '{"status":1}']) {
    const h = setup(), p = h.send(); h.load({ responseText: body });
    assert.equal((await p).accepted, true); assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
  }
});
