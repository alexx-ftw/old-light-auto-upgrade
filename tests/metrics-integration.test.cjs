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
    SCRIPT_VERSION: '1.12.0', Date: options.clockDate || Date, crypto: options.crypto === undefined ? crypto : options.crypto,
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
  const document = element('document'); document.createElement = element; document.visibilityState = 'visible';
  const context = vm.createContext({ metrics, document, window, Blob, Date: options.clockDate || Date,
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
  return { metrics, storage, setFailWrite, nodes, dataPage, shadow, window, document, action, field, urls };
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

test('Metrics preview renders one coherent storage view instead of a healthy status beside a failed report', () => {
  let armed = false, counterReads = 0;
  class ChangingStorage extends Map {
    get(name) {
      const value = super.get(name);
      if (armed && name === key && ++counterReads === 2) return '{invalid';
      return value;
    }
  }
  const h = panelHarness({ storage: new ChangingStorage() });
  h.metrics.record('helper.loaded');
  armed = true;
  h.action('metrics-preview').fire('click');
  const report = JSON.parse(h.nodes.find(node => node.id === 'oldlight-metrics-report').value);
  // The stored healthy report contains exactly one event. A second read can
  // observe another tab's corrupt replacement, but must not mix both views.
  assert.equal(h.action('metrics-toggle').checked, true);
  assert.match(h.field('metrics-status').textContent, /1 eventos en 1 días/);
  assert.deepEqual(report.days.map(day => day.counts), [{ 'helper.loaded': 1 }]);
  assert.equal(counterReads, 1, 'A visible refresh must read counters once');
});

test('Metrics preview and export show a failed read immediately and recover only after explicit reactivation', async () => {
  let failRead = false;
  class FailingStorage extends Map {
    get(name) { if (failRead && name === key) throw Error('private storage failure'); return super.get(name); }
  }
  const h = panelHarness({ storage: new FailingStorage() });
  h.metrics.record('helper.loaded');
  failRead = true;
  h.action('metrics-preview').fire('click');
  const preview = h.nodes.find(node => node.id === 'oldlight-metrics-report');
  assert.equal(h.action('metrics-toggle').checked, false);
  assert.match(h.field('metrics-status').textContent, /medición está detenida/);
  assert.deepEqual(JSON.parse(preview.value).days, []);
  assert.equal(preview.value.includes('private'), false);
  h.action('metrics-export').fire('click');
  assert.equal(h.urls.length, 0, 'A failed view cannot become a downloaded empty success');
  failRead = false;
  h.action('metrics-preview').fire('click'); h.action('metrics-preview').fire('click');
  assert.equal(h.action('metrics-toggle').checked, false, 'Recovered storage does not silently reactivate');
  h.action('metrics-toggle').checked = true; h.action('metrics-toggle').fire('change');
  h.metrics.record('helper.loaded');
  assert.equal(h.action('metrics-toggle').checked, true);
  assert.deepEqual(JSON.parse(preview.value).days.map(day => day.counts), [{ 'helper.loaded': 1 }]);
  h.action('metrics-export').fire('click');
  assert.equal(h.urls.length, 1);
  const report = JSON.parse(await h.urls[0].text());
  assert.deepEqual(Object.keys(report).sort(), ['days', 'schema', 'version']);
  assert.deepEqual(report, JSON.parse(preview.value));
  assert.match(h.field('metrics-status').textContent, /Descarga solicitada al navegador/);
});

test('Real Chromium preserves a selected metrics report during new counts and invalidates it on blur or revocation', async t => {
  const browser = require('./helpers/native-browser.cjs');
  const b = await browser.open(url => url.origin === 'https://oldlight.io' && url.pathname === '/metrics-offline-qa'
    ? { type: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><title>Offline metrics QA</title><link rel=icon href=data:,><main></main>' } : null);
  try {
    await b.command('Page.navigate', { url: 'https://oldlight.io/metrics-offline-qa' });
    for (let i = 0; i < 100 && await b.evaluate('document.readyState') !== 'complete'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(await b.evaluate('document.title'), 'Offline metrics QA');
    const begin = source.indexOf('  function createLocalMetrics('), end = source.indexOf('  // END LOCAL METRICS INTEGRATION', begin);
    const installedVersion = source.match(/const SCRIPT_VERSION = '([^']+)'/)[1];
    await b.evaluate(coreSource);
    await b.evaluate(`(() => {
      const SCRIPT_VERSION = ${JSON.stringify(installedVersion)};
      const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
      ${source.slice(begin, end)}
      const host = document.createElement('div'); document.querySelector('main').append(host);
      const shadow = host.attachShadow({ mode: 'open' }); shadow.innerHTML = '<div data-page="data"></div>';
      const metrics = createLocalMetrics(); installMetricsPanel(shadow); metrics.record('helper.loaded');
      globalThis.metricsQA = { shadow, metrics };
      shadow.querySelector('[data-action="metrics-preview"]').click();
    })()`);
    const select = () => b.evaluate(`(() => { const p = metricsQA.shadow.querySelector('textarea'); p.focus(); p.setSelectionRange(0, p.value.length); return { value: p.value, start: p.selectionStart, end: p.selectionEnd }; })()`);
    const inspect = () => b.evaluate(`(() => {
      const s = metricsQA.shadow, p = s.querySelector('textarea'), n = s.querySelector('[data-field="metrics-preview-note"]');
      return { value: p.value, start: p.selectionStart, end: p.selectionEnd, noteVisible: Boolean(n && !n.hidden), note: n?.textContent || '', enabled: s.querySelector('[data-action="metrics-toggle"]').checked, status: s.querySelector('[data-field="metrics-status"]').textContent };
    })()`);
    const initial = await select();
    await b.evaluate("metricsQA.metrics.record('unknown.event')");
    const unchanged = await inspect();
    assert.deepEqual({ value: unchanged.value, start: unchanged.start, end: unchanged.end }, initial, 'An unchanged report remains selectable');
    await b.evaluate("metricsQA.metrics.record('settings.changed')");
    const held = await inspect();
    assert.equal(held.start, 0); assert.equal(held.end, initial.value.length, 'New counts must not collapse the real textarea selection');
    assert.equal(held.value, initial.value, 'The selected text stays byte-identical while copying');
    assert.equal(held.noteVisible, true); assert.match(held.note, /seleccionado|seleccionada/);
    await b.evaluate('metricsQA.shadow.querySelector(\'[data-action="metrics-export"]\').focus()');
    const released = await inspect();
    assert.equal(released.noteVisible, false);
    assert.equal(JSON.parse(released.value).days[0].counts['settings.changed'], 1, 'Blur updates from current metrics');
    await select();
    await b.evaluate(`localStorage.setItem(${JSON.stringify(consentKey)}, JSON.stringify({ enabled: false, generation: '00000000-0000-4000-8000-000000000002' })); window.dispatchEvent(new StorageEvent('storage', { key: ${JSON.stringify(consentKey)} }));`);
    const revoked = await inspect();
    assert.equal(revoked.enabled, false); assert.deepEqual(JSON.parse(revoked.value).days, []); assert.equal(revoked.noteVisible, false);
    await b.evaluate("metricsQA.metrics.setEnabled(true); metricsQA.metrics.record('helper.loaded')");
    await select();
    await b.evaluate(`const originalMetricsRead = Storage.prototype.getItem; Storage.prototype.getItem = function(name) { if (name === ${JSON.stringify(key)}) throw Error('private storage failure'); return originalMetricsRead.call(this, name); }; window.dispatchEvent(new StorageEvent('storage', { key: ${JSON.stringify(key)} }));`);
    const failed = await inspect();
    assert.equal(failed.enabled, false); assert.deepEqual(JSON.parse(failed.value).days, []); assert.equal(failed.noteVisible, false);
    assert.match(failed.status, /medición está detenida/); assert.equal(failed.value.includes('private'), false);
    await b.evaluate('Storage.prototype.getItem = originalMetricsRead');
    const evidence = { browser: (await b.command('Browser.getVersion', {}, null)).product, initial, held, released, revoked, failed, errors: b.errors, denied: b.denied };
    fs.writeFileSync(path.join(b.artifacts, 'metrics-preview.json'), JSON.stringify(evidence, null, 2));
    t.diagnostic('METRICS_BROWSER_ARTIFACTS=' + b.artifacts);
    assert.deepEqual(b.errors, []); assert.deepEqual(b.denied, []);
  } finally { await b.close(); }
});

test('Selected metrics previews export current data and invalidate on consent rotation or storage clear even while enabled', async () => {
  const h = panelHarness();
  h.metrics.record('helper.loaded'); h.action('metrics-preview').fire('click');
  const preview = h.nodes.find(node => node.id === 'oldlight-metrics-report');
  const select = () => { h.shadow.activeElement = preview; preview.selectionStart = 0; preview.selectionEnd = preview.value.length; };
  select(); const original = preview.value;
  h.metrics.record('settings.changed');
  assert.equal(preview.value, original, 'Copy selection holds the displayed snapshot');
  assert.equal(h.field('metrics-preview-note').hidden, false);
  h.action('metrics-export').fire('click');
  const exported = JSON.parse(await h.urls[0].text());
  assert.equal(exported.days[0].counts['settings.changed'], 1, 'Export always uses current permitted data');
  assert.deepEqual(exported, JSON.parse(preview.value));
  assert.deepEqual(Object.keys(exported).sort(), ['days', 'schema', 'version']);
  assert.equal(h.field('metrics-preview-note').hidden, true);
  select();
  h.metrics.setEnabled(false); h.metrics.setEnabled(true);
  h.window.fire('storage', { key: consentKey });
  assert.equal(h.action('metrics-toggle').checked, true, 'A newer generation may already be enabled');
  assert.deepEqual(JSON.parse(preview.value).days, [], 'Consent notification invalidates the old copy even after off-to-on');
  assert.equal(h.field('metrics-preview-note').hidden, true);
  h.metrics.record('helper.loaded'); select();
  h.storage.clear(); h.window.fire('storage', { key: null });
  assert.deepEqual(JSON.parse(preview.value).days, [], 'Whole-storage clear invalidates the selected copy immediately');
  assert.equal(h.field('metrics-preview-note').hidden, true);
});

test('Restored metrics panels reconcile consent and selected copies before delayed storage notifications without writing', () => {
  const writes = [];
  class ObservedStorage extends Map {
    set(name, value) { writes.push(name); return super.set(name, value); }
    delete(name) { writes.push(name); return super.delete(name); }
  }
  const h = panelHarness({ storage: new ObservedStorage() });
  h.metrics.record('helper.loaded'); h.action('metrics-preview').fire('click');
  const preview = h.nodes.find(node => node.id === 'oldlight-metrics-report');
  h.shadow.activeElement = preview; preview.selectionStart = 0; preview.selectionEnd = preview.value.length;
  h.metrics.record('settings.changed');
  assert.equal(h.field('metrics-preview-note').hidden, false);
  // Model a suspended page: external consent changes, with its storage task
  // intentionally delivered after the restored-page notification.
  h.window.fire('pagehide', { persisted: true });
  h.storage.set(consentKey, JSON.stringify({ enabled: false, generation: '00000000-0000-4000-8000-000000000002' }));
  writes.length = 0;
  h.window.fire('pageshow', { persisted: true });
  assert.equal(h.action('metrics-toggle').checked, false, 'The restored panel must not retain an old enabled checkbox');
  assert.deepEqual(JSON.parse(preview.value).days, [], 'Resume invalidates the selected copy after revocation');
  assert.equal(h.field('metrics-preview-note').hidden, true);
  assert.match(h.field('metrics-status').textContent, /Desactivadas/);
  assert.deepEqual(writes, [], 'Reconciliation must not opt in, count, erase, or rewrite storage');
  h.window.fire('storage', { key: consentKey });
  assert.equal(h.action('metrics-toggle').checked, false); assert.deepEqual(writes, []);
  h.shadow.activeElement = null;
  h.metrics.setEnabled(true); h.metrics.record('helper.loaded');
  h.shadow.activeElement = preview; preview.selectionStart = 0; preview.selectionEnd = preview.value.length;
  h.metrics.record('settings.changed');
  const generation = '00000000-0000-4000-8000-000000000003';
  h.storage.set(consentKey, JSON.stringify({ enabled: true, generation }));
  h.storage.set(key, JSON.stringify({ schema: 1, version: '1.12.0', generation, days: [] }));
  writes.length = 0;
  h.window.fire('pageshow', { persisted: true }); h.document.fire('resume');
  assert.equal(h.action('metrics-toggle').checked, true, 'Another tab may already have reactivated a new generation');
  assert.deepEqual(JSON.parse(preview.value).days, [], 'Resume never pins a revoked generation even when currently enabled');
  assert.equal(h.field('metrics-preview-note').hidden, true); assert.deepEqual(writes, []);
});

test('Visible and resumed metrics views reconcile current counters and retention without hidden reads or writes', () => {
  let stamp = Date.parse('2026-10-17T12:00:00Z'), reads = 0, writes = 0;
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [stamp])); } static now() { return stamp; } }
  class ObservedStorage extends Map {
    get(name) { if (name === key) reads++; return super.get(name); }
    set(name, value) { writes++; return super.set(name, value); }
  }
  const h = panelHarness({ storage: new ObservedStorage(), clockDate: ClockDate });
  h.metrics.record('helper.loaded'); h.action('metrics-preview').fire('click');
  const preview = h.nodes.find(node => node.id === 'oldlight-metrics-report');
  h.shadow.activeElement = preview; preview.selectionStart = 0; preview.selectionEnd = preview.value.length;
  const old = preview.value;
  stamp += 31 * 86400000;
  reads = 0; writes = 0;
  h.document.visibilityState = 'hidden'; h.document.fire('visibilitychange'); h.window.fire('resume');
  assert.equal(reads, 0, 'Hidden visibility and a resume event on the wrong target do not read counters');
  assert.equal(preview.value, old);
  h.document.fire('resume');
  assert.equal(reads, 1); assert.equal(writes, 0);
  assert.deepEqual(JSON.parse(preview.value).days, [], 'An actual document resume refreshes expired selected data');
  assert.equal(h.action('metrics-toggle').checked, true, 'Read-only retention reconciliation does not change consent');
  h.shadow.activeElement = null; h.metrics.record('settings.changed');
  const stored = JSON.parse(h.storage.get(key)); stored.days[0].counts['settings.changed'] = 2; h.storage.set(key, JSON.stringify(stored));
  reads = 0; writes = 0;
  h.document.visibilityState = 'hidden'; h.document.fire('visibilitychange'); assert.equal(reads, 0);
  h.document.visibilityState = 'visible'; h.document.fire('visibilitychange');
  assert.equal(reads, 1); assert.equal(writes, 0); assert.equal(JSON.parse(preview.value).days[0].counts['settings.changed'], 2);
  h.window.fire('pageshow', { persisted: false }); assert.equal(reads, 1, 'A fresh load already has its initial view');
});

test('Restored metrics read failures surface immediately and never implicitly reactivate recovered storage', () => {
  let failRead = false;
  class FailingStorage extends Map {
    get(name) { if (failRead && name === key) throw Error('private lifecycle storage failure'); return super.get(name); }
  }
  const h = panelHarness({ storage: new FailingStorage() });
  h.metrics.record('helper.loaded'); h.action('metrics-preview').fire('click');
  const preview = h.nodes.find(node => node.id === 'oldlight-metrics-report');
  h.shadow.activeElement = preview; preview.selectionStart = 0; preview.selectionEnd = preview.value.length;
  failRead = true;
  h.window.fire('pageshow', { persisted: true });
  assert.equal(h.action('metrics-toggle').checked, false); assert.deepEqual(JSON.parse(preview.value).days, []);
  assert.match(h.field('metrics-status').textContent, /medición está detenida/); assert.equal(preview.value.includes('private'), false);
  h.action('metrics-export').fire('click'); assert.equal(h.urls.length, 0);
  failRead = false;
  h.document.fire('resume'); h.document.fire('visibilitychange'); h.window.fire('pageshow', { persisted: true });
  assert.equal(h.action('metrics-toggle').checked, false, 'Lifecycle refreshes cannot clear forced-off state');
  h.action('metrics-toggle').checked = true; h.action('metrics-toggle').fire('change');
  assert.equal(h.action('metrics-toggle').checked, true); assert.deepEqual(JSON.parse(preview.value).days, []);
});

test('an older metrics panel explains newer-release suspension without exposing or deleting its counters', () => {
  const newer = { schema: 1, version: '99.0.0', generation: '00000000-0000-4000-8000-000000000001',
    days: [{ date: new Date().toISOString().slice(0, 10), counts: { 'helper.loaded': 7 } }] };
  const storage = new Map([[key, JSON.stringify(newer)]]), before = storage.get(key);
  const h = panelHarness({ storage });
  assert.match(h.field('metrics-status').textContent, /versión más reciente.*Recarga/);
  assert.equal(h.action('metrics-toggle').checked, false);
  h.action('metrics-preview').fire('click');
  assert.deepEqual(JSON.parse(h.nodes.find(node => node.id === 'oldlight-metrics-report').value).days, []);
  assert.equal(storage.get(key), before);
  assert.equal(storage.has(consentKey), false);
});
