'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(root, 'docs/telemetry-core.js'), 'utf8');
const localSource = fs.readFileSync(path.join(root, 'docs/metrics-core.js'), 'utf8');
function slice(begin, end) {
  const start = source.indexOf(begin), stop = source.indexOf(end, start);
  assert.ok(start >= 0 && stop > start, 'Missing boundaries: ' + begin);
  return source.slice(start, stop);
}
const integration = slice('  // BEGIN REMOTE TELEMETRY INTEGRATION', '  // END REMOTE TELEMETRY INTEGRATION');
function harness(options = {}) {
  const nodes = [], storage = options.storage || new Map(); let network = 0, clockReads = 0;
  function element(tag) {
    const handlers = new Map();
    const node = { tagName: tag.toUpperCase(), textContent: '', children: [], dataset: {}, attributes: {}, style: {},
      disabled: false, checked: false, open: false, value: '',
      append(...children) { this.children.push(...children); },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(name, callback) { handlers.set(name, callback); },
      fire(name, value = {}) { handlers.get(name)?.({ isTrusted: true, ...value }); },
    };
    nodes.push(node); return node;
  }
  const page = element('div'), shadow = element('div'); shadow.querySelector = () => page;
  const forbidden = () => { network++; throw new Error('Forbidden remote IO'); };
  const context = vm.createContext({ SCRIPT_VERSION: '1.16.7', crypto, document: { createElement: element },
    setTimeout: forbidden, clearTimeout() {}, fetch: forbidden, GM_xmlhttpRequest: undefined,
    GM_getValue: forbidden, GM_setValue: forbidden,
    performance: { now() { clockReads++; return clockReads * 10; } },
    localStorage: { getItem(key) { if (options.originReadThrows) throw new Error('origin storage'); return storage.get(key) ?? null; }, setItem(key, value) { if (options.originWriteThrows) throw new Error('origin storage'); storage.set(key, value); }, removeItem: key => storage.delete(key) },
  });
  const privateStorage = options.privateStorage || new Map(options.configured && !options.fresh ? [[consentKey, JSON.stringify(consent(false))]] : []), listeners = new Map(), timers = new Map(), requests = [], windowHandlers = new Map();
  let listenerID = 0, timerID = 0, aborted = 0, privateReads = 0, privateWrites = 0;
  if (options.configured) {
    Object.assign(context, {
      AbortController,
      setTimeout(fn) { timers.set(++timerID, fn); return timerID; }, clearTimeout(id) { timers.delete(id); },
      privateHas: key => privateStorage.has(key),
      privateRead(key) {
        privateReads++;
        options.onRead?.({ key, count: privateReads, privateStorage, storage, listeners });
        if (options.readMode === 'throw') throw new Error('storage');
        return privateStorage.has(key) ? privateStorage.get(key) : undefined;
      },
      privateWrite(key, value) {
        privateWrites++;
        options.onWrite?.({ key, value, privateStorage, storage, listeners });
        if (options.writeMode === 'throw') throw new Error('storage');
        if (options.writeMode === 'async') return Promise.resolve();
        if (options.writeMode !== 'noop') privateStorage.set(key, value);
      },
      GM_addValueChangeListener(key, fn) { listeners.set(++listenerID, { key, fn }); return listenerID; },
      GM_removeValueChangeListener(id) { listeners.delete(id); },
      GM_xmlhttpRequest(details) { network++; requests.push(details); return { abort() { aborted++; } }; },
      window: { addEventListener(name, fn) { windowHandlers.set(name, fn); } },
    });
    vm.runInContext(`GM_getValue = (key, fallback) => { const raw = privateRead(key); return raw === undefined ? (privateHas(key) ? undefined : fallback) : JSON.parse(raw); };
      GM_setValue = (key, value) => privateWrite(key, JSON.stringify(value));`, context);
    if (options.readMode === 'async') context.GM_getValue = () => Promise.resolve(null);
    if (options.missing) context[options.missing] = undefined;
    if (options.missing === 'GM_xmlhttpRequest') context.GM_xmlhttpRequest = undefined;
  }
  const providerSources = ['telemetry-posthog-payload.js', 'telemetry-posthog-transport.js']
    .map(file => fs.readFileSync(path.join(root, 'docs', file), 'utf8')).join('\n');
  vm.runInContext(coreSource + providerSources + localSource + integration
    + slice('  function createLocalMetrics(', '  function installMetricsPanel(')
    + '\nthis.remote = createTelemetry(); this.local = createLocalMetrics(remote); this.mount = shadow => installTelemetryPanel(shadow, remote);', context);
  context.mount(shadow);
  return { context, nodes, page, storage, privateStorage, requests, timers, listeners, windowEvent: (name, event) => windowHandlers.get(name)?.(event), aborted: () => aborted,
    notify(value) {
      const encoded = JSON.stringify(value);
      for (const { key, fn } of listeners.values()) {
        privateStorage.set(key, encoded);
        context.changedValue = encoded;
        fn(key, null, vm.runInContext('JSON.parse(changedValue)', context), true);
      }
    }, remote: context.remote, local: context.local,
    action: name => nodes.find(node => node.dataset.action === name), field: name => nodes.find(node => node.dataset.field === name),
    privateWrites: () => privateWrites, privateReads: () => privateReads, network: () => network, clockReads: () => clockReads };
}

test('telemetry exact core is embedded once and initialization wires the optional adapter', () => {
  const start = '// BEGIN EMBEDDED TELEMETRY CORE\n', end = '// END EMBEDDED TELEMETRY CORE';
  assert.equal(source.split(start).length, 2); assert.equal(source.split(end).length, 2);
  assert.equal(slice(start, end).slice(start.length), coreSource.trim() + '\n');
  assert.match(source, /const telemetry = createTelemetry\(\);\s+const metrics = createLocalMetrics\(telemetry\);/);
  assert.match(source, /installMetricsPanel\(shadow\);\s+installTelemetryPanel\(shadow, telemetry\);/);
});

test('performance clock is not read with local opt-out and inactive remote collection', () => {
  const h = harness(); h.local.setEnabled(false); const started = h.local.startTiming(); h.local.finishTiming(started);
  assert.equal(started, null); assert.equal(h.clockReads(), 0); assert.equal(h.remote.getStatus().queued, 0);
});

test('telemetry local wrapper forwards only closed events and numeric durations without original notifications', () => {
  const h = harness(), events = [], durations = [];
  h.context.observer = { record: (...args) => events.push(args), isEnabled: () => true, duration: (...args) => durations.push(args) };
  const local = vm.runInContext('createLocalMetrics(observer);', h.context);
  local.setEnabled(false);
  local.observeHelperEvent('request.sent', 'PRIVATE_SYSTEM'); local.observeDriveStatus('connected');
  local.observeEmpireStatus('missing_init'); local.finishTiming(local.startTiming());
  assert.deepEqual(events, [['automation.sent'], ['drive.connected'], ['empire.observer.missing_init']]);
  assert.deepEqual(durations, [['helper.step', 10]]);
  assert.equal(local.isEnabled(), false); assert.equal(h.storage.size, 2);
  assert.match(source, /const timing = metrics.startTiming\?\.\(\);\s+try \{ step\(\); \} catch \(cause\) \{ metrics.record\('error.runtime'\); throw cause; \}\s+finally \{ metrics.finishTiming\?\.\(timing\); \}/);
});

test('telemetry throwing optional adapter cannot break local recording or timing wrapper', () => {
  const h = harness(); h.context.observer = { record() { throw new Error('private'); }, isEnabled() { throw new Error('private'); }, duration() { throw new Error('private'); } };
  const local = vm.runInContext('createLocalMetrics(observer);', h.context);
  local.setEnabled(true); assert.doesNotThrow(() => local.record('helper.loaded'));
  assert.equal(local.getStatus().total, 1); const timing = local.startTiming();
  assert.ok(timing.local); assert.equal(timing.remoteStart, null);
  local.finishTiming(timing); assert.equal(local.getStatus().total, 2);
  assert.doesNotThrow(() => local.finishTiming(1));
});


test('local duration samples stay local with independent remote collection enabled or disabled', () => {
  for (const enabled of [false, true]) {
    const h = harness(), events = [], durations = [];
    h.context.observer = { record: (...args) => events.push(args), isEnabled: () => enabled,
      duration: (...args) => durations.push(args) };
    const local = vm.runInContext('createLocalMetrics(observer);', h.context);
    local.setEnabled(true); const timing = local.startTiming(); local.finishTiming(timing);
    assert.equal(local.getStatus().total, 1);
    assert.match(Object.keys(local.snapshot().days[0].counts)[0], /^performance\.step\./);
    assert.deepEqual(events, [], 'local bins bypass remote record forwarding');
    assert.equal(durations.length, enabled ? 1 : 0);
    assert.equal(h.network(), 0);
  }
});

const consentKey = 'old-light-auto-upgrade:remote-consent:posthog-eu:v1';
const fenceKey = 'old-light-auto-upgrade:remote-revocation:v1';
const consent = enabled => ({ schema: 1, policy: 1, destinationId: 'posthog-eu-oldlight', enabled,
  generation: '12345678-1234-4234-8234-123456789abc' });

test('sole-owner factory has fixed EU destination and no persisted consent dependency', () => {
  const factory = slice('  function createTelemetry()', '  function installTelemetryPanel(');
  assert.match(factory, /destination: null, transport: null/);
  assert.match(factory, /id: 'posthog-eu-oldlight'/);
  assert.doesNotMatch(factory, /GM_getValue|GM_setValue|GM_addValueChangeListener|GM_removeValueChangeListener|localStorage|fetch\(/);
  const metadata = source.slice(0, source.indexOf('// ==\/UserScript=='));
  assert.deepEqual([...metadata.matchAll(/^\/\/ @connect\s+(.*)$/gm)].map(match => match[1]).sort(), ['api.telegram.org', 'eu.i.posthog.com', 'raw.githubusercontent.com']);
});

test('missing request adapter stays unconfigured despite local collection', async () => {
  const h = harness();
  h.local.setEnabled(true); h.local.record('helper.loaded');
  assert.equal(h.remote.isEnabled(), false);
  assert.equal(h.remote.getStatus().configured, false);
  assert.equal(await h.remote.flush(), false);
  assert.equal(h.network(), 0);
  assert.equal(h.action('telemetry-toggle'), undefined);
  assert.equal(h.action('telemetry-clear'), undefined);
  assert.match(h.field('telemetry-status').textContent, /Sin configurar/);
});

test('owner telemetry panel is compact, transparent, and has no disable controls', () => {
  const h = harness({ configured: true });
  assert.equal(h.remote.isEnabled(), true);
  assert.equal(h.action('telemetry-toggle'), undefined);
  assert.equal(h.action('telemetry-clear'), undefined);
  assert.equal(h.nodes.some(node => node.tagName === 'INPUT' || node.tagName === 'BUTTON'), false);
  const details = h.field('telemetry-details');
  assert.equal(details.tagName, 'DETAILS'); assert.equal(details.open, false);
  assert.equal(details.children[0].tagName, 'SUMMARY');
  assert.equal(h.field('remote-telemetry').children.length, 3);
  assert.equal(h.field('telemetry-preview').value, '');
  const text = h.nodes.map(node => node.textContent).join(' ');
  assert.match(text, /PostHog EU/);
  assert.match(text, /siempre|permanente/i);
  assert.match(text, /No se graban sesiones/);
  assert.match(text, /IP de origen/);
  assert.doesNotMatch(text, /puedes desactivar aquí|Una desactivación previa siempre se conserva|Vaciar y desactivar/);
});

test('preview opens and clears repeatedly without changing permanent collection', () => {
  const h = harness({ configured: true }), details = h.field('telemetry-details'), preview = h.field('telemetry-preview');
  for (let i = 0; i < 3; i++) {
    details.open = true; details.fire('toggle');
    assert.deepEqual(JSON.parse(preview.value), { schema: 1, helper_version: '1.16.7', counts: {}, duration_buckets: { helper_step: {} } });
    details.open = false; details.fire('toggle'); assert.equal(preview.value, '');
    assert.equal(h.remote.isEnabled(), true);
  }
  assert.equal(h.privateWrites(), 0); assert.equal(h.privateReads(), 0); assert.equal(h.network(), 0);
});

for (const raw of [undefined, null, false, true, 'oldlight-private-consent-absent-a', 'oldlight-private-consent-absent-b', {}, consent(false), consent(true)]) {
  test('explicit permanent-owner authorization supersedes saved state without modifying bytes: ' + JSON.stringify(raw), () => {
    const privateStorage = new Map([[consentKey, JSON.stringify(raw)]]);
    const storage = new Map([[fenceKey, 'disabled']]);
    const privateBefore = [...privateStorage], before = [...storage];
    const h = harness({ configured: true, privateStorage, storage });
    assert.equal(h.remote.isEnabled(), true);
    assert.equal(h.privateReads(), 0); assert.equal(h.privateWrites(), 0);
    assert.deepEqual([...privateStorage], privateBefore); assert.deepEqual([...storage], before);
    const reloaded = harness({ configured: true, privateStorage, storage });
    assert.equal(reloaded.remote.isEnabled(), true);
    assert.equal(reloaded.remote.getStatus().queued, 0);
    assert.equal(reloaded.network(), 0);
  });
}

test('fresh owner installation is enabled without persistent reads or writes and does not send empty data', async () => {
  const h = harness({ configured: true, fresh: true });
  assert.equal(h.remote.isEnabled(), true);
  assert.equal(h.privateStorage.size, 0); assert.equal(h.storage.size, 0);
  assert.equal(h.privateReads(), 0); assert.equal(h.privateWrites(), 0);
  assert.equal(await h.remote.flush(), false); assert.equal(h.network(), 0);
});

for (const missing of ['GM_getValue', 'GM_setValue', 'GM_addValueChangeListener', 'GM_removeValueChangeListener']) {
  test('permanent owner collection requires no private storage API: ' + missing, () => {
    const h = harness({ configured: true, missing });
    assert.equal(h.remote.isEnabled(), true); assert.equal(h.remote.getStatus().configured, true);
    assert.equal(h.privateReads(), 0); assert.equal(h.privateWrites(), 0); assert.equal(h.listeners.size, 0);
  });
}
for (const options of [{ readMode: 'throw' }, { readMode: 'async' }, { writeMode: 'throw' }, { writeMode: 'async' }, { originReadThrows: true }, { originWriteThrows: true }]) {
  test('consent storage failures do not affect permanent owner configuration: ' + JSON.stringify(options), () => {
    const h = harness({ configured: true, ...options });
    assert.equal(h.remote.isEnabled(), true);
    assert.equal(h.privateReads(), 0); assert.equal(h.privateWrites(), 0); assert.equal(h.network(), 0);
  });
}

test('local metrics preference remains independent and remote payload stays exactly allowlisted', async () => {
  const h = harness({ configured: true }); h.local.setEnabled(false);
  assert.equal(h.local.isEnabled(), false); assert.equal(h.remote.isEnabled(), true);
  h.local.record('helper.loaded'); h.local.observeHelperEvent('request.sent', 'PRIVATE_SYSTEM');
  h.local.finishTiming(h.local.startTiming());
  const pending = h.remote.flush(); assert.equal(h.requests.length, 1);
  const payload = JSON.parse(h.requests[0].data);
  assert.deepEqual(Object.keys(payload).sort(), ['api_key', 'distinct_id', 'event', 'properties']);
  assert.deepEqual(Object.keys(payload.properties).sort(), ['$geoip_disable', '$ip', '$process_person_profile', 'counts', 'duration_buckets', 'helper_version', 'schema']);
  assert.equal(payload.event, 'oldlight_helper.aggregate');
  assert.equal(payload.properties.$process_person_profile, false);
  assert.equal(payload.properties.$geoip_disable, true); assert.equal(payload.properties.$ip, '0.0.0.0');
  assert.deepEqual(payload.properties.counts, { 'helper.loaded': 1, 'automation.sent': 1 });
  assert.deepEqual(payload.properties.duration_buckets, { helper_step: { '4_16ms': 1 } });
  assert.doesNotMatch(h.requests[0].data, /PRIVATE_SYSTEM|remote-consent|generation|owner/);
  h.requests[0].onload({ status: 200, finalUrl: 'https://eu.i.posthog.com/i/v0/e/', responseText: '{"status":1}' });
  assert.equal(await pending, true); h.remote.destroy();
});

test('remote configuration and permission do not enter local metrics or backup serialization', () => {
  const h = harness({ configured: true }); h.local.setEnabled(true); h.local.record('helper.loaded');
  for (const [key, value] of h.storage) assert.doesNotMatch(key + value, /remote-consent|posthog-eu|destinationId/);
  assert.doesNotMatch(JSON.stringify(h.local.snapshot()), /remote-consent|posthog-eu|destinationId/);
  assert.equal(h.privateWrites(), 0); h.remote.destroy();
});

test('BFcache suspension aborts pending requests and resume starts a fresh empty collection', async () => {
  const h = harness({ configured: true }); h.local.record('helper.loaded');
  const pending = h.remote.flush(); h.local.record('drive.connected');
  h.windowEvent('pagehide', { persisted: true });
  assert.equal(await pending, false); assert.equal(h.aborted(), 1);
  assert.equal(h.remote.getStatus().queued, 0); assert.equal(h.remote.isEnabled(), false);
  h.local.record('helper.loaded'); assert.equal(h.remote.getStatus().queued, 0);
  h.windowEvent('pageshow', { persisted: true });
  assert.equal(h.remote.isEnabled(), true); assert.equal(h.remote.getStatus().queued, 0);
  h.requests[0].onload({ status: 200, finalUrl: 'https://eu.i.posthog.com/i/v0/e/', responseText: '{"status":1}' });
  assert.equal(h.remote.getStatus().accepted, 0); assert.equal(h.requests.length, 1);
});

test('normal pagehide destroys collection and pageshow cannot revive it', async () => {
  const h = harness({ configured: true }); h.local.record('helper.loaded');
  const pending = h.remote.flush(); h.windowEvent('pagehide', { persisted: false });
  assert.equal(await pending, false); assert.equal(h.aborted(), 1);
  assert.equal(h.remote.isEnabled(), false); assert.equal(h.remote.getStatus().queued, 0); assert.equal(h.timers.size, 0);
  h.windowEvent('pageshow', { persisted: true }); assert.equal(h.remote.isEnabled(), false);
});

test('permanent collection still rejects unknown event fields and failed transport never retries automatically', async () => {
  const h = harness({ configured: true });
  assert.equal(h.remote.record('unapproved.private.event'), false);
  assert.equal(h.remote.duration('private.duration', 20), false);
  assert.equal(h.remote.duration('helper.step', Infinity), false);
  assert.equal(h.remote.getStatus().queued, 0);
  h.local.record('helper.loaded');
  const pending = h.remote.flush(); assert.equal(h.requests.length, 1);
  h.requests[0].onerror({ error: 'network failure' });
  assert.equal(await pending, false); assert.equal(h.remote.getStatus().accepted, 0);
  assert.equal(h.remote.getStatus().queued, 0); assert.equal(h.timers.size, 0);
  assert.equal(await h.remote.flush(), false); assert.equal(h.requests.length, 1);
  assert.match(h.field('telemetry-status').textContent, /no se confirmó|fall|descart/i);
});
