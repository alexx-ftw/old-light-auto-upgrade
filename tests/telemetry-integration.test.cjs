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
function harness() {
  const nodes = [], storage = new Map(); let network = 0, clockReads = 0;
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
    setTimeout: forbidden, clearTimeout() {}, fetch: forbidden, GM_xmlhttpRequest: forbidden,
    GM_getValue: forbidden, GM_setValue: forbidden,
    performance: { now() { clockReads++; return clockReads * 10; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  });
  vm.runInContext(coreSource + localSource + integration
    + slice('  function createLocalMetrics(', '  function installMetricsPanel(')
    + '\nthis.remote = createTelemetry(); this.local = createLocalMetrics(remote); this.mount = shadow => installTelemetryPanel(shadow, remote);', context);
  context.mount(shadow);
  return { context, nodes, page, storage, remote: context.remote, local: context.local,
    action: name => nodes.find(node => node.dataset.action === name), field: name => nodes.find(node => node.dataset.field === name),
    network: () => network, clockReads: () => clockReads };
}

test('telemetry exact core is embedded once and initialization wires the optional adapter', () => {
  const start = '// BEGIN EMBEDDED TELEMETRY CORE\n', end = '// END EMBEDDED TELEMETRY CORE';
  assert.equal(source.split(start).length, 2); assert.equal(source.split(end).length, 2);
  assert.equal(slice(start, end).slice(start.length), coreSource.trim() + '\n');
  assert.match(source, /const telemetry = createTelemetry\(\);\s+const metrics = createLocalMetrics\(telemetry\);/);
  assert.match(source, /installMetricsPanel\(shadow\);\s+installTelemetryPanel\(shadow, telemetry\);/);
});

test('telemetry released integration contains no destination, token, network or private storage adapter', () => {
  const factory = slice('  function createTelemetry()', '  function installTelemetryPanel(');
  assert.match(factory, /destination: null, transport: null/);
  assert.doesNotMatch(factory, /https?:|phc_|api_key|projectToken|GM_getValue|GM_setValue|localStorage|readConsent|writeConsent|fetch/);
  const metadata = source.slice(0, source.indexOf('// ==/UserScript=='));
  assert.deepEqual([...metadata.matchAll(/^\/\/ @connect\s+(.*)$/gm)].map(match => match[1]), ['api.telegram.org', 'raw.githubusercontent.com']);
});

test('telemetry public installation remains inert despite local opt-in and attempted remote toggle', async () => {
  const h = harness();
  assert.equal(h.local.setEnabled(true), true);
  h.local.record('helper.loaded'); h.local.observeDriveStatus('connected'); h.local.observeEmpireStatus('missing_init');
  h.action('telemetry-toggle').checked = true; h.action('telemetry-toggle').fire('change');
  assert.equal(h.action('telemetry-toggle').disabled, true); assert.equal(h.action('telemetry-toggle').checked, false);
  assert.equal(h.remote.isEnabled(), false); assert.equal(await h.remote.flush(), false);
  assert.equal(h.remote.getStatus().queued, 0); assert.equal(h.network(), 0);
  assert.ok(h.local.getStatus().total > 0);
  assert.deepEqual([...h.storage.keys()].sort(), ['old-light-auto-upgrade:metrics-consent:v1', 'old-light-auto-upgrade:metrics:v1']);
});

test('telemetry panel is compact, details closed, destination block visible and no fictitious active state', () => {
  const h = harness();
  assert.match(h.field('telemetry-status').textContent, /Sin configurar.*No se recopila ni se envía/);
  const details = h.field('telemetry-details'); assert.equal(details.tagName, 'DETAILS'); assert.equal(details.open, false);
  assert.equal(details.children[0].tagName, 'SUMMARY');
  assert.equal(h.field('telemetry-preview').value, '');
  assert.equal(h.action('telemetry-clear').disabled, true);
  assert.equal(h.field('remote-telemetry').children.length, 4);
  const text = h.nodes.map(node => node.textContent).join(' ');
  for (const phrase of [/PostHog no está conectado/, /propio de esta instalación/, /No se deduce del permiso local/, /no se aplica a otras personas/, /No se graban sesiones/, /no puede retirar datos ya entregados/]) assert.match(text, phrase);
});

test('telemetry details preview opens and clears across repeated dismissal without changing consent', () => {
  const h = harness(), details = h.field('telemetry-details'), preview = h.field('telemetry-preview');
  for (let i = 0; i < 3; i++) {
    details.open = true; details.fire('toggle');
    assert.deepEqual(JSON.parse(preview.value), { schema: 1, helper_version: '1.16.7', counts: {}, duration_buckets: { helper_step: {} } });
    details.open = false; details.fire('toggle'); assert.equal(preview.value, '');
  }
  assert.equal(h.storage.size, 0); assert.equal(h.network(), 0);
});

test('telemetry fake clicks cannot change configured consent and local metrics remain separate', () => {
  const h = harness(); let enabled = false, changes = 0, callback;
  const fake = { getStatus: () => ({ configured: true, enabled, state: enabled ? 'ready' : 'disabled' }),
    setEnabled(value) { changes++; enabled = value; callback?.(); }, snapshot: () => ({ counts: {} }), onChange(fn) { callback = fn; } };
  const shadow = { querySelector: () => h.page };
  h.context.fake = fake; h.context.shadow = shadow;
  vm.runInContext('installTelemetryPanel(shadow, fake);', h.context);
  const toggle = h.nodes.filter(node => node.dataset.action === 'telemetry-toggle').at(-1);
  const clear = h.nodes.filter(node => node.dataset.action === 'telemetry-clear').at(-1);
  toggle.checked = true; toggle.fire('change', { isTrusted: false }); assert.equal(changes, 0); assert.equal(toggle.checked, false);
  toggle.checked = true; toggle.fire('change'); assert.equal(changes, 1); assert.equal(enabled, true);
  clear.fire('click', { isTrusted: false }); assert.equal(changes, 1);
  clear.fire('click'); assert.equal(changes, 2); assert.equal(enabled, false);
  assert.equal(h.local.isEnabled(), true); assert.equal(h.storage.size, 0);
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
