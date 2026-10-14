'use strict';
// Optional isolated Chromium QA: production panel, synthetic state, no network.
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const root = path.join(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), requests = [], errors = [];
  let checks = 0; const check = (value, message) => { assert.ok(value, message); checks++; };
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA aislada del lector</title><body style="margin:10px;background:#080f17"><main style="width:300px;max-width:100%"></main></body></html>');
    await page.addScriptTag({ path: path.join(root, 'docs/empire-core.js') });
    await page.addScriptTag({ path: path.join(root, 'docs/empire-panel.js') });
    await page.evaluate(() => {
      let recovery = { reason: 'connection-unobserved', readyState: 'complete' }, writes = 0, scope = 'alpha/synthetic';
      const state = { config: OldLightEmpireCore.normalizeConfig({}), ready: false, roster: { systems: [] }, snapshots: [],
        status: 'Lector instalado; esperando la conexión nativa del juego.' };
      const panel = OldLightEmpirePanel.create({ document, core: OldLightEmpireCore,
        getState: () => ({ ...state, scope }), getRecovery: () => recovery, canEnable: () => false,
        setConfig: () => { writes++; } });
      panel.mount(document.querySelector('main'));
      window.fixture = { panel, recovery(value) { recovery = value; panel.render(); },
        scope(value) { scope = value; panel.render(); }, writes: () => writes };
    });
    const help = page.locator('.empire-recovery'), summary = help.locator('summary');
    for (const [viewport, width] of [[320, 300], [390, 360], [1200, 560]]) {
      await page.setViewportSize({ width: viewport, height: 844 });
      await page.locator('main').evaluate((node, value) => node.style.width = value + 'px', width);
      check(await help.evaluate(node => !node.open), `closed at ${viewport}/${width}`);
      check(await page.locator('.empire-status').evaluate(node => node.textContent.length < 90), 'short visible status');
      await summary.click();
      check(await help.evaluate(node => node.open), 'native disclosure opens');
      check(await help.locator('li').count() === 3, 'three manual recovery steps');
      check(await help.evaluate(node => node.scrollWidth <= node.clientWidth), 'expanded text fits');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');
      check(await page.getByRole('button', { name: 'Activar imperio', exact: true }).isDisabled(), 'help cannot enable empire');
      await summary.press('Enter'); check(await help.evaluate(node => !node.open), 'keyboard closes help');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('main').evaluate(node => node.style.width = '360px');
    const evidence = process.env.OLDLIGHT_QA_DIR;
    if (evidence) { fs.mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, 'recovery-collapsed.png'), fullPage: true }); }
    await summary.click();
    if (evidence) await page.screenshot({ path: path.join(evidence, 'recovery-expanded.png'), fullPage: true });
    await page.evaluate(() => fixture.panel.render()); check(await help.evaluate(node => node.open), 'stable render preserves open help');
    await page.evaluate(() => fixture.recovery({ reason: 'missing-init', readyState: 'loading' }));
    check(await help.evaluate(node => !node.open), 'new diagnosis closes stale disclosure');
    await summary.click(); await page.evaluate(() => fixture.scope('beta/synthetic'));
    check(await help.evaluate(node => !node.open), 'scope change resets disclosure');
    await summary.focus(); await page.evaluate(() => fixture.recovery(null));
    check(await help.isHidden(), 'verified recovery removes help');
    check(await page.locator('.empire-status').evaluate(node => node === document.activeElement), 'focused help returns to visible status');
    check(await page.evaluate(() => fixture.writes()) === 0, 'no preference writes');
    check(requests.length === 0, 'no network requests'); check(errors.length === 0, 'no page errors');
    console.log(JSON.stringify({ checks, passed: true, requests: requests.length, errors, scope: 'isolated Chromium synthetic UI; no Brave/Violentmonkey/Drive or game session' }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
