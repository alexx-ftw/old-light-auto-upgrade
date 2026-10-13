'use strict';
// Isolated simulated page only. Does not visit Old Light or contact a server.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  let checks = 0;
  const check = (value, message) => { assert.ok(value, message); checks++; };
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 920 } });
    const errors = [], network = [];
    page.on('pageerror', err => errors.push(err.message)); page.on('request', req => network.push(req.url()));
    await page.setContent('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Imperio: simulación local</title><body style="margin:0;background:#081019;padding:12px"><div style="font:12px system-ui;color:#acc3d2;margin:0 0 8px">SIMULACIÓN LOCAL · No conectado al juego</div><main style="width:540px;max-width:100%"></main></body></html>');
    await page.addScriptTag({ path: path.join(root, 'docs/empire-core.js') });
    await page.addScriptTag({ path: path.join(root, 'docs/empire-panel.js') });
    await page.evaluate(() => {
      const core = OldLightEmpireCore;
      window.A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; window.B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      window.clock = 10000; window.capable = true; window.writes = [];
      window.config = core.normalizeConfig({ fleetTargets: { marauder: 20 } });
      const sample = (id, name, n) => ({ scope: 'alpha/player', systemId: id, name, owned: true, observedAt: clock, censusId: 'single-response-1',
        resources: { palladium: { amount: 450+n, cap: 1000, rate: 2 }, iridium: { amount: 200+n, cap: 800, rate: 1 } },
        fleet: Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, { parked: ship === 'marauder' ? n : 0, away: 0, building: 0 }])),
        queue: { buildings: n ? 1 : 0, ships: 0 }, energy: 10 });
      window.snapshots = [sample(A, 'Sede imperial', 5), sample(B, 'Colonia industrial', 3)];
      window.roster = { scope: 'alpha/player', complete: true, observedAt: clock, systems: [{ id: A, owned: true, name: 'Sede imperial' }, { id: B, owned: true, name: 'Colonia industrial' }] };
      window.transitCensus = { scope: 'alpha/player', censusId: 'single-response-1', observedAt: clock, ships: Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, 0])) };
      window.getState = () => ({ config, scope: 'alpha/player', snapshots, roster, transitCensus,
        status: capable ? (config.enabled ? 'Imperio activo en una simulación.' : 'Imperio preparado, aún desactivado.') : 'Falta verificar el adaptador nativo.',
        ready: capable && config.enabled,
        plan: core.plan(config, snapshots, { scope: 'alpha/player', now: clock, expectedIds: roster.systems.map(x=>x.id), activeSystemId: A, transitCensus }) });
      window.panel = OldLightEmpirePanel.create({ document, core, getState, now: () => clock, canEnable: () => capable,
        setConfig: value => { writes.push(value); config = core.normalizeConfig(value); } });
      panel.mount(document.querySelector('main'));
    });
    check(await page.getByRole('heading', { name: 'Imperio', exact: true }).count() === 1, 'Heading');
    check(await page.locator('.empire-card').count() === 2, 'One card per system');
    check(await page.getByText('2 de 2 sistemas con datos recientes').count() === 1, 'Fresh summary');
    check(await page.getByText('Palladium 908 / 2000 · Iridium 408 / 1600').count() === 1, 'Resource and capacity sum');
    check(await page.getByText('Flota contada una vez en un censo verificado.').count() === 1, 'Verified census');
    await page.getByRole('button', { name: 'Activar imperio', exact: true }).click();
    check(await page.evaluate(() => config.enabled) === true, 'Explicit activation saves once');
    check(await page.locator('.empire-progress').first().textContent() === 'Reparto propuesto: Marauder ×6', 'Fleet deficit allocated once');
    const goal = page.getByRole('spinbutton', { name: 'Objetivo imperial de Marauder' });
    await goal.fill('40'); await goal.press('Tab');
    check(await page.evaluate(() => config.fleetTargets.marauder) === 40, 'Imperial target save');
    const before = await page.evaluate(() => writes.length);
    await goal.fill('-1'); await goal.press('Tab');
    check(await goal.getAttribute('aria-invalid') === 'true', 'Invalid target marked');
    check(await page.evaluate(() => writes.length) === before, 'Invalid target not persisted');
    await goal.fill('20'); await goal.press('Tab');
    check(await goal.getAttribute('aria-invalid') === null, 'Valid correction clears error');
    await page.getByRole('combobox', { name: 'Rol de Colonia industrial' }).selectOption('industry');
    check(await page.evaluate(() => config.systems[B].role) === 'industry', 'Role save');
    check(await page.locator('.empire-card').nth(1).locator('.empire-progress').textContent() === 'Sin producción imperial adicional asignada.', 'Industry receives no ship order');
    await page.getByRole('checkbox', { name: 'Atender Sede imperial' }).uncheck();
    check(await page.evaluate(() => config.systems[A].enabled) === false, 'Exclude system');
    await page.getByRole('checkbox', { name: 'Atender Sede imperial' }).check();
    await page.evaluate(() => { snapshots[1].observedAt = -300000; panel.render(); });
    check(await page.locator('.empire-card').nth(1).getAttribute('data-stale') === 'true', 'Invalid timestamp is stale');
    check(await page.getByText(/información incompleta/).count() === 1, 'Incomplete summary explicit');
    await page.evaluate(() => { snapshots[1].observedAt = clock; snapshots[1].censusId = null; panel.render(); });
    check(await page.getByText(/Flota sin censo sincronizado/).count() === 1, 'Unsynchronized census warning');
    check(await page.locator('.empire-progress').first().textContent() === 'Sin producción imperial adicional asignada.', 'No allocation from sequential caches');
    await page.evaluate(() => { snapshots[1].censusId = 'single-response-1'; config.enabled = false; capable = false; panel.render(); });
    check(await page.getByRole('button', { name: 'Activar imperio', exact: true }).isDisabled(), 'Real adapter absent blocks activation');
    await page.evaluate(() => { roster.systems[0].name = '<img src=x onerror=alert(1)>'; panel.render(); });
    check(await page.locator('img').count() === 0, 'Untrusted names render as text');
    check(await page.getByRole('heading', { name: '<img src=x onerror=alert(1)>' }).count() === 1, 'Full name safely displayed');
    await page.evaluate(() => { roster.systems[0].name = 'Sede imperial'; panel.render(); });
    await goal.focus(); await goal.fill('123'); await page.evaluate(() => panel.render());
    check(await goal.inputValue() === '123', 'Render preserves active draft');
    await goal.press('Tab');
    fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
    for (const width of [1200, 390, 320]) {
      await page.setViewportSize({ width, height: 920 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}`);
      await page.screenshot({ path: path.join(root, `qa/empire-${width}.png`), fullPage: true });
    }
    await page.evaluate(() => { roster.systems = []; panel.render(); });
    check(await page.locator('.empire-card').count() === 0, 'Ownership removal deletes cards');
    check(await page.locator('.empire-empty').isVisible(), 'Empty roster explains blocker');
    await page.evaluate(() => panel.destroy());
    check(await page.locator('.oldlight-empire').count() === 0, 'Destroy removes component');
    check(await page.locator('style').count() === 0, 'Destroy removes styles');
    check(errors.length === 0, 'No runtime browser errors: ' + errors.join(';'));
    check(network.length === 0, 'No network requests: ' + network.join(';'));
    console.log(`${checks} isolated empire panel browser checks passed.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
