'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, '..', 'docs/metrics-core.js'), 'utf8');
const key = 'old-light-auto-upgrade:metrics:v1';
const consentKey = 'old-light-auto-upgrade:metrics-consent:v1';
const clone = value => JSON.parse(JSON.stringify(value));
function harness(options = {}) {
  const storage = options.storage || new Map();
  const writes = [];
  let failWrite = false;
  const begin = source.indexOf('  function createLocalMetrics(');
  const end = source.indexOf('  function installMetricsPanel(', begin);
  assert.ok(begin > 0 && end > begin);
  const context = vm.createContext({
    SCRIPT_VERSION: '1.12.0', crypto: options.crypto === undefined ? crypto : options.crypto,
    localStorage: {
      getItem: name => storage.get(name) ?? null,
      setItem: (name, value) => { if (failWrite) throw new Error('quota'); writes.push(name); storage.set(name, value); },
      removeItem: name => storage.delete(name),
    },
  });
  vm.runInContext(coreSource, context);
  const metrics = vm.runInContext(source.slice(begin, end) + '\ncreateLocalMetrics();', context);
  return { metrics, storage, writes, setFailWrite: value => { failWrite = value; } };
}
function counts(metrics) {
  return Object.assign({}, ...clone(metrics.snapshot()).days.map(day => day.counts));
}

test('Published userscript embeds the exact reviewed metrics core', () => {
  const begin = '// BEGIN EMBEDDED METRICS CORE\n';
  const end = '// END EMBEDDED METRICS CORE';
  const start = source.indexOf(begin);
  assert.ok(start >= 0);
  assert.equal(source.slice(start + begin.length, source.indexOf(end, start)),
    fs.readFileSync(path.join(__dirname, '..', 'docs/metrics-core.js'), 'utf8').trim() + '\n');
});

test('Helper metrics preserve a stored opt-out and never touch configuration or Drive storage', () => {
  const { metrics, storage, writes } = harness({ storage: new Map([[consentKey, JSON.stringify({enabled:false,generation:'00000000-0000-4000-8000-000000000002'})]]) });
  metrics.observeHelperEvent('request.sent', 'sent:private-system-id');
  metrics.observeDriveStatus('connected');
  assert.deepEqual(counts(metrics), {});
  assert.equal(storage.size, 1);
  assert.equal(metrics.setEnabled(true), true);
  metrics.observeHelperEvent('request.sent', 'sent:private-system-id');
  metrics.observeHelperEvent('settings.minimum', 'some-private-draft');
  assert.deepEqual(counts(metrics), { 'automation.sent': 1, 'settings.changed': 1 });
  assert.deepEqual([...new Set(writes)].sort(), [key, consentKey].sort());
  assert.equal(JSON.stringify(metrics.snapshot()).includes('private'), false);
});

test('Only known outcome names are counted, never game notifications or mission identifiers', () => {
  const { metrics } = harness();
  metrics.setEnabled(true);
  const allowed = [
    ['request.sent', 'automation.sent'], ['request.failed', 'automation.failed'],
    ['request.rejected', 'automation.rejected'], ['request.unconfirmed', 'automation.unconfirmed'],
    ['building.queued', 'automation.confirmed'], ['ships.queued', 'automation.confirmed'],
    ['automation.paused', 'automation.paused'],
  ];
  for (const [input] of allowed) metrics.observeHelperEvent(input, 'secret:token');
  for (const input of ['game.toast', 'game.messages', 'game.reports', 'fleet.changed', '__proto__', 'constructor', null]) {
    metrics.observeHelperEvent(input, 'private-player-id');
  }
  metrics.observeHelperEvent('request.sent', 'mission:private-id');
  metrics.observeHelperEvent('request.unconfirmed', 'mission-uncertain:private-id');
  const expected = {};
  for (const [, name] of allowed) expected[name] = (expected[name] || 0) + 1;
  assert.deepEqual(counts(metrics), expected);
});

test('Drive instrumentation counts fixed status transitions without error messages or account data', () => {
  const { metrics } = harness();
  metrics.setEnabled(true);
  for (const code of ['connected', 'connected', 'syncing', 'synced', 'synced', 'sync_retry', 'invalid_sync', 'storage_error']) {
    metrics.observeDriveStatus(code);
  }
  for (const code of ['failed', 'auth_error', 'api_denied', 'popup_blocked', 'timeout']) metrics.observeDriveStatus(code);
  metrics.observeDriveStatus('https://example.invalid/?token=private');
  assert.deepEqual(counts(metrics), { 'drive.connected': 1, 'drive.synced': 1, 'drive.retry': 1, 'drive.error': 6, 'error.storage': 1 });
  assert.equal(JSON.stringify(metrics.snapshot()).includes('token'), false);
});

test('Another instance immediately respects local opt-out and cleared counters', () => {
  const { metrics, storage } = harness();
  metrics.setEnabled(true);
  metrics.record('helper.loaded');
  storage.set(consentKey, JSON.stringify({ enabled: false, generation: crypto.randomUUID() }));
  metrics.observeHelperEvent('request.sent', 'sent:private-id');
  assert.equal(metrics.isEnabled(), false);
  assert.deepEqual(counts(metrics), {});
});

test('Oversized or malformed local metrics fail closed while regular settings remain intact', () => {
  for (const raw of ['{bad json', ' '.repeat(65537)]) {
    const { metrics, storage } = harness();
    storage.set('old-light-auto-upgrade:v1', '{"enabled":true}');
    storage.set(key, raw);
    assert.doesNotThrow(() => metrics.record('helper.loaded'));
    assert.equal(metrics.isEnabled(), false);
    assert.deepEqual(counts(metrics), {});
    assert.equal(storage.get('old-light-auto-upgrade:v1'), '{"enabled":true}');
  }
});

function panelHarness(options = {}) {
  const { metrics, storage, setFailWrite } = harness(options);
  const nodes = [];
  function element(tag) {
    const handlers = new Map();
    const node = { tagName: tag.toUpperCase(), textContent: '', dataset: {}, style: {}, children: [], hidden: false,
      attributes: {}, handlers, value: '', checked: false,
      append(...items) { this.children.push(...items); },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { handlers.set(name, callback); },
      click() { handlers.get('click')?.({ isTrusted: false }); },
      fire(name, extra = {}) { return handlers.get(name)?.({ isTrusted: true, ...extra }); },
    };
    nodes.push(node); return node;
  }
  const dataPage = element('div');
  const shadow = element('div'); shadow.querySelector = selector => selector === '[data-page="data"]' ? dataPage : null;
  const window = element('window');
  const urls = [];
  const context = vm.createContext({ metrics, document: { createElement: element }, window, Blob,
    URL: { createObjectURL(blob) { urls.push(blob); return 'blob:local-report'; }, revokeObjectURL() {} },
    setTimeout: callback => callback(),
    setText: (node, value) => { node.textContent = value; },
  });
  const begin = source.indexOf('  function installMetricsPanel(');
  const end = source.indexOf('  // END LOCAL METRICS INTEGRATION', begin);
  vm.runInContext(source.slice(begin, end) + '\nthis.install = installMetricsPanel;', context);
  context.install(shadow);
  const action = name => nodes.find(node => node.dataset.action === name);
  const field = name => nodes.find(node => node.dataset.field === name);
  return { metrics, storage, setFailWrite, nodes, dataPage, shadow, window, action, field, urls };
}

test('Metrics controls require trusted reactivation after opt-out, support preview, and preserve game settings', () => {
  const h = panelHarness({ storage: new Map([[consentKey, JSON.stringify({enabled:false,generation:'00000000-0000-4000-8000-000000000002'})]]) });
  assert.equal(h.action('metrics-toggle').checked, false);
  assert.match(h.field('metrics-status').textContent, /Desactivadas/);
  h.storage.set('old-light-auto-upgrade:v1', '{"enabled":true,"token":"private"}');
  h.action('metrics-toggle').checked = true;
  h.action('metrics-toggle').fire('change', { isTrusted: false });
  assert.equal(h.metrics.isEnabled(), false);
  assert.equal(h.action('metrics-toggle').checked, false);
  h.action('metrics-toggle').checked = true;
  h.action('metrics-toggle').fire('change');
  assert.equal(h.metrics.isEnabled(), true);
  h.metrics.record('helper.loaded');
  h.action('metrics-preview').fire('click');
  const report = h.nodes.find(node => node.id === 'oldlight-metrics-report');
  assert.equal(report.hidden, false);
  assert.equal(h.action('metrics-preview').attributes['aria-expanded'], 'true');
  assert.deepEqual(JSON.parse(report.value), clone(h.metrics.snapshot()));
  assert.equal(report.value.includes('private'), false);
  h.action('metrics-preview').fire('click');
  assert.equal(report.hidden, true);
  assert.equal(h.action('metrics-preview').attributes['aria-expanded'], 'false');
  assert.equal(h.storage.get('old-light-auto-upgrade:v1'), '{"enabled":true,"token":"private"}');
});

test('Feature handlers count only explicit helper navigation, including keyboard-generated clicks', () => {
  const h = panelHarness();
  h.action('metrics-toggle').checked = true; h.action('metrics-toggle').fire('change');
  for (const dataset of [{ settingsTab: 'empire' }, { settingsTab: 'fleet' }, { fleetViewTab: 'campaigns' }, { settingsTab: 'https://private' }]) {
    h.shadow.fire('click', { isTrusted: false, composedPath: () => [{ dataset, matches: () => true }] });
  }
  h.shadow.fire('click', { composedPath: () => [{ value: 'password', matches: () => false }] });
  assert.deepEqual(counts(h.metrics), { 'ui.tab.empire': 1, 'ui.tab.fleet': 1, 'ui.fleet.campaigns': 1 });
});

test('Export downloads only the exact sanitized metrics document after a trusted click', async () => {
  const h = panelHarness();
  h.metrics.setEnabled(true); h.metrics.record('helper.loaded');
  h.action('metrics-export').fire('click', { isTrusted: false });
  assert.equal(h.urls.length, 0);
  h.action('metrics-export').fire('click');
  assert.equal(h.urls.length, 1);
  assert.deepEqual(JSON.parse(await h.urls[0].text()), clone(h.metrics.snapshot()));
  assert.match(h.field('metrics-status').textContent, /No se ha enviado a ningún servidor/);
});

test('Clear and opt-out update controls, erase previewed counts and reject synthetic destructive clicks', () => {
  const h = panelHarness();
  h.metrics.setEnabled(true); h.metrics.record('helper.loaded');
  h.action('metrics-clear').fire('click', { isTrusted: false });
  assert.equal(h.metrics.getStatus().total, 1);
  h.action('metrics-preview').fire('click');
  h.action('metrics-clear').fire('click');
  assert.equal(h.metrics.getStatus().total, 0);
  assert.equal(h.metrics.isEnabled(), false);
  assert.deepEqual(JSON.parse(h.nodes.find(node => node.id === 'oldlight-metrics-report').value).days, []);
  h.metrics.setEnabled(true);
  h.metrics.record('helper.loaded');
  h.action('metrics-toggle').checked = false; h.action('metrics-toggle').fire('change');
  assert.equal(h.metrics.isEnabled(), false);
  assert.equal(h.metrics.getStatus().total, 0);
  assert.match(h.field('metrics-status').textContent, /Desactivadas/);
});

test('Cross-tab storage notifications refresh consent and a corrupt state surfaces an actionable warning', () => {
  const h = panelHarness();
  h.metrics.setEnabled(true); h.metrics.record('helper.loaded');
  h.storage.set(key, '{invalid');
  h.window.fire('storage', { key });
  assert.equal(h.action('metrics-toggle').checked, false);
  assert.match(h.field('metrics-status').textContent, /medición está detenida/);
  h.action('metrics-export').fire('click');
  assert.equal(h.urls.length, 0);
});


test('Background storage failures update the visible status without a tab change or another click', () => {
  const h = panelHarness();
  h.action('metrics-toggle').checked = true; h.action('metrics-toggle').fire('change');
  assert.match(h.field('metrics-status').textContent, /Activadas/);
  h.setFailWrite(true);
  assert.doesNotThrow(() => h.metrics.record('error.runtime'));
  assert.equal(h.action('metrics-toggle').checked, false);
  assert.match(h.field('metrics-status').textContent, /medición está detenida/);
});


test('A browser without secure randomness explains why opt-in failed', () => {
  const h = panelHarness({ crypto: null });
  h.action('metrics-toggle').checked = true; h.action('metrics-toggle').fire('change');
  assert.equal(h.metrics.isEnabled(), false);
  assert.equal(h.action('metrics-toggle').checked, false);
  assert.match(h.field('metrics-status').textContent, /no permite activar las métricas con seguridad/);
  assert.equal(h.storage.get(consentKey), undefined);
});

test('Opt-out succeeds across tabs even when the revoking browser lacks secure randomness', () => {
  const first = harness();
  first.metrics.setEnabled(true); first.metrics.record('helper.loaded');
  const h = panelHarness({ crypto: null, storage: first.storage });
  assert.equal(h.action('metrics-toggle').checked, true);
  h.action('metrics-toggle').checked = false; h.action('metrics-toggle').fire('change');
  assert.equal(h.metrics.isEnabled(), false);
  assert.equal(first.metrics.isEnabled(), false);
  assert.equal(JSON.parse(h.storage.get(consentKey)).enabled, false);
  assert.match(h.field('metrics-status').textContent, /Desactivadas/);
});


test('Imperial consent text describes fixed local startup categories and report export is exact', async () => {
  const h = panelHarness();
  const text = h.nodes.map(node => node.textContent).join(' ');
  for (const expected of [/Activado por defecto si no hay una elección guardada/, /apertura de Imperio/,
    /cambios de estado de su lector/, /No envía datos a ningún servidor/,
    /no contiene tramas del juego ni textos de error/, /al activar no se recupera el historial anterior/,
    /No se incluye en las copias ni se sincroniza por Drive/]) assert.match(text, expected);
  h.action('metrics-toggle').checked = true;
  h.action('metrics-toggle').fire('change');
  h.metrics.observeEmpireStatus('missing_init');
  h.metrics.observeEmpireStatus('missing_init');
  h.metrics.record('ui.tab.empire');
  h.action('metrics-preview').fire('click');
  const report = JSON.parse(h.nodes.find(node => node.id === 'oldlight-metrics-report').value);
  assert.deepEqual(Object.keys(report).sort(), ['days', 'schema', 'version']);
  assert.deepEqual(report.days[0].counts, { 'empire.observer.missing_init': 1, 'ui.tab.empire': 1 });
  h.action('metrics-export').fire('click');
  assert.equal(h.urls.length, 1);
  assert.deepEqual(JSON.parse(await h.urls[0].text()), report);
  h.action('metrics-toggle').checked = false;
  h.action('metrics-toggle').fire('change');
  assert.deepEqual(JSON.parse(h.nodes.find(node => node.id === 'oldlight-metrics-report').value).days, []);
});


test('Privacy policy and rendered metrics panel agree with adapter defaults and saved choices', () => {
  const privacy = fs.readFileSync(path.join(__dirname, '..', 'docs/privacy.html'), 'utf8');
  const section = privacy.match(/<section aria-labelledby="metrics-heading">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(section, 'local metrics policy section exists');
  assert.match(section, /activad[ao]s? por defecto si no hay una elección guardada/i);
  assert.match(section, /Respeta cualquier desactivación anterior/i);
  assert.doesNotMatch(section, /desactivad[ao]s? inicialmente|desactivad[ao]s? por defecto/i);
  for (const enabled of [undefined, false, true]) {
    const raw = enabled === undefined ? undefined : JSON.stringify({ enabled, generation: '00000000-0000-4000-8000-000000000002' });
    const storage = new Map(raw === undefined ? [] : [[consentKey, raw]]);
    const h = panelHarness({ storage });
    const expected = enabled !== false;
    assert.equal(h.metrics.isEnabled(), expected, 'adapter respects absent and explicit choices');
    assert.equal(h.action('metrics-toggle').checked, expected, 'rendered checkbox agrees with adapter');
    const text = h.nodes.map(node => node.textContent).join(' ');
    assert.match(text, /Activado por defecto si no hay una elección guardada/);
    assert.match(text, /Respeta cualquier desactivación anterior/);
    assert.equal(storage.get(consentKey), raw, 'render does not initialize or rewrite consent');
  }
});
