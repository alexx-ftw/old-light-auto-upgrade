'use strict';
// Production panel/planner, with the existing synthetic DOM fixture. No browser
// layout or real game behavior is claimed by these interaction/accessibility tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const fixturePath = path.join(__dirname, 'empire-panel.test.cjs');
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const stop = fixtureSource.indexOf("\ntest('panel renders complete synchronized inventory");
assert.ok(stop > 0, 'Existing DOM fixture boundary must remain explicit.');
// Keep fixture values in the module's realm: core intentionally rejects foreign
// object prototypes, so a separate VM would test a different input contract.
const fixture = Function('require', 'structuredClone', fixtureSource.slice(0, stop)
  + '\nreturn {harness, all, byLabel, withClass, A, B, SCOPE};')(createRequire(fixturePath), structuredClone);
const { harness, all, byLabel, withClass, A, B, SCOPE } = fixture;
const core = require('../docs/empire-core.js');
const help = card => withClass(card, 'empire-role-help')[0];
const role = h => byLabel(h.container, 'Rol de Sede');
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const startOperational = source.indexOf('  function empireOperationalSettings() {');
const endOperational = source.indexOf('\n  function empireMissionPermission()', startOperational);
assert.ok(startOperational > 0 && endOperational > startOperational);
function operational(name) {
  const settings = { order: ['trade_hub', 'warehouse', 'reactor'], excluded: ['shipyard'], depotFillPercent: 80 };
  const realm = { settings, systemId: () => A,
    empireController: { isEnabled: () => true, systemPolicy: () => ({ role: name, shipMinimums: { probe: 7 } }) } };
  vm.runInNewContext(source.slice(startOperational, endOperational) + '\nthis.result = empireOperationalSettings();', realm);
  return JSON.parse(JSON.stringify(realm.result));
}

test('each role has visible contextual help linked by a stable unique accessible ID', () => {
  const h = harness(), other = harness();
  const descriptions = [...h.cards, ...other.cards].map(help);
  assert.equal(new Set(descriptions.map(node => node.id)).size, descriptions.length);
  for (const card of [...h.cards, ...other.cards]) {
    const selector = all(card).find(node => node.tagName === 'SELECT');
    assert.equal(selector.getAttribute('aria-describedby'), help(card).id);
    assert.match(help(card).textContent, /Equilibrado.*tu orden.*flota/);
  }
  const oldId = help(h.cards[0]).id;
  h.app.render(); assert.equal(help(h.cards[0]).id, oldId);
  assert.equal(h.writes, 0); assert.equal(h.data.config.enabled, false);
});

test('role explanations track the chosen option without changing goals, Atender or activation', () => {
  const h = harness(), selector = role(h);
  const expected = {
    industry: /Industria.*extractores, almacén y reactor.*No recibe nuevos pedidos por los objetivos imperiales de flota/,
    shipyard: /Astillero.*astillero, centro de mando, reactor y almacén.*sin más peso que Equilibrado/,
    defense: /Defensa.*centro de mando, almacén y reactor.*No recibe nuevos pedidos.*ni activa defensa militar/,
    balanced: /Equilibrado.*tu orden.*reparto.*flota/,
  };
  for (const [name, text] of Object.entries(expected)) {
    selector.value = name; selector.dispatch('change');
    assert.equal(h.data.config.systems[A].role, name);
    assert.match(help(h.cards[0]).textContent, text);
    assert.equal(h.data.config.enabled, false);
    assert.equal(h.data.config.systems[A].enabled, true);
    assert.equal(h.data.config.fleetTargets.marauder, 20);
    assert.equal(h.data.config.systems[B], undefined);
  }
  assert.equal(h.writes, 4);
  assert.ok(h.paragraphs().some(value => /El reparto requiere Atender.*no excluyen otros edificios.*edificios marcados.*Depot\/Reactor.*No organizan patrullas, ataques ni transportes/.test(value)));
});

test('help claims agree with the real operational order and planner eligibility without extra shipyard weight', () => {
  const priorities = { balanced: ['trade_hub', 'warehouse', 'reactor'],
    industry: ['palladium_extractor', 'iridium_extractor', 'warehouse', 'reactor'],
    shipyard: ['shipyard', 'command_center', 'reactor', 'warehouse'],
    defense: ['command_center', 'warehouse', 'reactor'] };
  for (const [name, first] of Object.entries(priorities)) {
    const settings = operational(name);
    assert.deepEqual(settings.order.slice(0, first.length), first);
    assert.deepEqual(settings.excluded, ['shipyard']);
    assert.equal(settings.depotFillPercent, 80);
    if (name !== 'balanced') assert.equal(new Set(settings.order).size, 7, 'roles reorder, never remove buildings');
    const h = harness(); h.data.config = core.normalizeConfig({ enabled: true, fleetTargets: { marauder: 20 },
      systems: { [A]: { role: name }, [B]: { role: 'balanced' } } });
    const planned = core.plan(h.data.config, h.data.snapshots, { scope: SCOPE, now: h.clock,
      expectedIds: [A, B], transitCensus: h.data.transitCensus });
    assert.equal(planned.summary.eligibleSystemIds.includes(A), ['balanced', 'shipyard'].includes(name));
    if (['balanced', 'shipyard'].includes(name)) {
      assert.equal(planned.summary.allocationsBySystem[A].marauder, 6);
      assert.equal(planned.summary.allocationsBySystem[B].marauder, 6);
    }
  }
});

test('focused drafts, failed saves and remote policies keep help aligned with the visible choice', () => {
  for (const failure of ['sync', 'async']) {
    const h = harness({ shadow: true }), selector = role(h);
    selector.focus(); selector.value = 'defense'; h.failure = failure; selector.dispatch('change');
    assert.match(help(h.cards[0]).textContent, /^Defensa/);
    assert.equal(h.data.config.systems[A], undefined);
    assert.notEqual(h.error.textContent, '');
    h.data.config.systems[A] = { role: 'industry', enabled: true, name: '' };
    h.app.render(); assert.equal(selector.value, 'defense'); assert.match(help(h.cards[0]).textContent, /^Defensa/);
    h.root.activeElement = null; h.app.render();
    assert.equal(selector.value, 'industry'); assert.match(help(h.cards[0]).textContent, /^Industria/);
    assert.equal(h.writes, 1);
  }
});

test('Atender and malformed profiles do not mislabel roles or write extra preferences', () => {
  const h = harness(), selector = role(h);
  selector.value = 'shipyard'; selector.dispatch('change');
  const enabled = byLabel(h.container, 'Atender Sede'); enabled.checked = false; enabled.dispatch('change');
  assert.equal(h.data.config.systems[A].enabled, false);
  assert.match(help(h.cards[0]).textContent, /^Astillero/);
  assert.equal(h.writes, 2);
  h.data.config.systems[A].role = 'unknown'; h.app.render();
  assert.equal(selector.value, 'balanced'); assert.match(help(h.cards[0]).textContent, /^Equilibrado/);
  assert.equal(h.writes, 2);
});

test('stable and hidden renders retain performance and do not steal focus', () => {
  const h = harness({ shadow: true }), selector = role(h); selector.focus();
  const node = help(h.cards[0]); h.document.textWrites = 0;
  for (let i = 0; i < 20; i++) h.app.render();
  assert.equal(h.document.textWrites, 0); assert.equal(h.root.activeElement, selector);
  h.visible = false; const reads = h.reads;
  h.root.activeElement = null; h.data.config.systems[A] = { role: 'defense', enabled: true };
  h.app.render(); assert.equal(h.reads, reads); assert.match(node.textContent, /^Equilibrado/);
  h.visible = true; h.app.render(); assert.match(node.textContent, /^Defensa/);
  assert.equal(h.writes, 0);
});

test('removed cards release their description and new cards do not reuse another accessible ID', () => {
  const h = harness(), previous = help(h.cards[0]); h.data.roster.systems.shift(); h.app.render();
  assert.ok(!all(h.container).includes(previous));
  h.data.roster.systems.push({ id: A, owned: true, name: '<script>unsafe</script>' }); h.app.render();
  const card = h.cards.find(node => node.dataset.systemId === A);
  assert.notEqual(help(card).id, previous.id);
  assert.doesNotMatch(help(card).id, /script|unsafe/);
  assert.equal(new Set(h.cards.map(node => help(node).id)).size, h.cards.length);
  assert.ok(!h.document.createdTags.includes('script'));
  h.app.destroy(); assert.equal(h.container.children.length, 0);
});
