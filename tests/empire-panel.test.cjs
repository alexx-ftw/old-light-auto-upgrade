'use strict';
// Minimal DOM behavior tests only. No browser, game endpoint, or network is used.
// These assertions do not establish visual layout, CSS, or browser accessibility.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../docs/empire-core.js');
const panel = require('../docs/empire-panel.js');

class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.children = []; this.parentNode = null; this.dataset = {};
    this.attributes = new Map(); this.listeners = new Map();
    this.className = ''; this.value = ''; this.checked = false; this.disabled = false;
    this._text = '';
    this.classList = { toggle: (name, force) => {
      const values = new Set(this.className.split(/\s+/).filter(Boolean));
      const enabled = force === undefined ? !values.has(name) : force;
      if (enabled) values.add(name); else values.delete(name);
      this.className = [...values].join(' '); return enabled;
    } };
  }
  set textContent(value) {
    if (this.ownerDocument) this.ownerDocument.textWrites = (this.ownerDocument.textWrites || 0) + 1;
    for (const child of this.children) child.parentNode = null;
    this.children = []; this._text = String(value);
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('The panel must not interpret untrusted text as HTML.'); }
  append(...nodes) {
    for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); }
  }
  remove() {
    if (this.parentNode) {
      const children = this.parentNode.children; children.splice(children.indexOf(this), 1);
      this.parentNode = null;
    }
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this }); }
  getRootNode() { let root = this; while (root.parentNode) root = root.parentNode; return root; }
  focus() { this.getRootNode().activeElement = this; }
}

class Document extends Element {
  constructor() { super('#document', null); this.ownerDocument = this; this.activeElement = null; this.createdTags = []; }
  createElement(tag) { this.createdTags.push(tag); return new Element(tag, this); }
}

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE = 'alpha/player';
const all = root => [root, ...root.children.flatMap(all)];
const byLabel = (root, label) => all(root).find(node => node.getAttribute('aria-label') === label);
const withClass = (root, name) => all(root).filter(node => node.className.split(/\s+/).includes(name));

function harness({ ids = [A, B], capable = true, shadow = false, visible = true, recovery = null } = {}) {
  const document = new Document(), container = document.createElement('main');
  const host = document.createElement('div'), root = shadow ? new Element('#shadow-root', document) : document;
  document.append(host); root.append(container); if (shadow) document.activeElement = host;
  let clock = 10000, failure = '', writes = 0, reads = 0;
  const data = { scope: SCOPE, config: core.normalizeConfig({ fleetTargets: { marauder: 20 } }), ready: false, maxAgeMs: 120000,
    roster: { systems: ids.map(id => ({ id, owned: true, name: id === A ? 'Sede' : 'Colonia' })) },
    snapshots: ids.map(id => ({ scope: SCOPE, systemId: id, owned: true, observedAt: clock, censusId: 'source-1', name: id === A ? 'Sede' : 'Colonia',
      resources: { palladium: { amount: 100, cap: 1000, rate: 2 }, iridium: { amount: 50, cap: 500, rate: 1 } },
      fleet: Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, { parked: ship === 'marauder' ? (id === A ? 5 : 3) : 0, away: 0, building: 0 }])),
      queue: { buildings: 0, ships: 0 }, energy: 10 })),
    transitCensus: { scope: SCOPE, censusId: 'source-1', observedAt: clock, ships: Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, 0])) },
  };
  const app = panel.create({ document, core, now: () => clock, canEnable: () => capable, isVisible: () => visible,
    getRecovery: () => typeof recovery === 'function' ? recovery() : recovery,
    getState: () => (reads++, { ...data, plan: data.cachedPlan || core.plan(data.config, data.snapshots, { scope: data.scope, now: clock, maxAgeMs: data.maxAgeMs,
      expectedIds: data.roster.systems.map(row => row.id), transitCensus: data.transitCensus }) }),
    setConfig: value => {
      writes++;
      if (typeof failure === 'function') return failure(value, app);
      if (failure === 'sync') throw new Error('No se pudo guardar.');
      if (failure === 'async') return Promise.resolve();
      data.config = core.normalizeConfig(value);
    },
  });
  app.mount(container);
  return { app, document, container, root, data,
    get recovery() { return recovery; }, set recovery(value) { recovery = value; },
    get reads() { return reads; }, get visible() { return visible; }, set visible(value) { visible = value; },
    get clock() { return clock; }, set clock(value) { clock = value; },
    get capable() { return capable; }, set capable(value) { capable = value; },
    get failure() { return failure; }, set failure(value) { failure = value; },
    get writes() { return writes; },
    goal: ship => byLabel(container, 'Objetivo imperial de ' + ship),
    get toggle() { return all(container).find(node => node.tagName === 'BUTTON'); },
    get error() { return all(container).find(node => node.getAttribute('role') === 'alert'); },
    get cards() { return withClass(container, 'empire-card'); },
    paragraphs: () => all(container).filter(node => node.tagName === 'P').map(node => node.textContent),
  };
}

test('panel renders complete synchronized inventory without saving or enabling', () => {
  const h = harness();
  assert.equal(h.cards.length, 2); assert.equal(h.writes, 0); assert.equal(h.data.config.enabled, false);
  assert.ok(h.paragraphs().includes('2 de 2 sistemas con datos recientes'));
  assert.ok(h.paragraphs().includes('Palladium 200 / 2000 · Iridium 100 / 1000'));
  assert.ok(h.paragraphs().includes('Flota contada una vez en un censo verificado.'));
  assert.equal(h.toggle.getAttribute('aria-pressed'), 'false');
});

test('card and aggregate respect runtime age policy, including its exact boundary', () => {
  const h = harness(); h.data.maxAgeMs = 15000; h.clock = 25000; h.app.render();
  assert.equal(h.cards[0].dataset.stale, 'false');
  h.clock++; h.app.render();
  assert.equal(h.cards[0].dataset.stale, 'true');
  assert.ok(h.paragraphs().includes('0 de 2 sistemas con datos recientes · información incompleta'));
  assert.ok(h.paragraphs().some(text => text.startsWith('Flota sin censo sincronizado')));
});

test('future, negative, duplicate, foreign and incomplete snapshots are never fresh cards', () => {
  for (const change of [
    h => { h.data.snapshots[0].observedAt = h.clock + 1; },
    h => { h.data.snapshots[0].observedAt = -1; },
    h => { h.data.snapshots.push(structuredClone(h.data.snapshots[0])); },
    h => { h.data.snapshots[0].scope = 'other/player'; },
    h => { h.data.snapshots[0].fleet.probe.parked = null; },
  ]) {
    const h = harness(); change(h); h.app.render();
    assert.equal(h.cards[0].dataset.stale, 'true');
    assert.ok(h.paragraphs().some(text => text.includes('información incompleta')));
  }
});

test('single-system HUD reading does not claim a verified whole-account census', () => {
  const h = harness({ ids: [A] }); h.data.snapshots[0].censusId = null; h.data.transitCensus = null; h.app.render();
  assert.ok(h.paragraphs().includes('Recuento exacto del sistema seleccionado.'));
  assert.ok(!h.paragraphs().some(text => text.includes('censo verificado')));
});

test('missing transit source and mixed census generations warn and do not show allocations', () => {
  for (const change of [h => { h.data.transitCensus = null; }, h => { h.data.snapshots[1].censusId = 'source-2'; }]) {
    const h = harness(); h.data.config.enabled = true; change(h); h.app.render();
    assert.ok(h.paragraphs().some(text => text.startsWith('Flota sin censo sincronizado')));
    assert.ok(withClass(h.container, 'empire-progress').every(node => node.textContent === 'Sin producción imperial adicional asignada.'));
  }
});

test('activation rechecks capability and stopping stays available when capability is lost', () => {
  const h = harness({ capable: false });
  assert.equal(h.toggle.disabled, true); h.toggle.dispatch('click'); assert.equal(h.writes, 0);
  h.capable = true; h.app.render(); h.toggle.dispatch('click');
  assert.equal(h.data.config.enabled, true); assert.equal(h.toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(withClass(h.cards[0], 'empire-progress')[0].textContent, 'Sin producción imperial adicional asignada.');
  h.data.ready = true; h.app.render();
  assert.equal(withClass(h.cards[0], 'empire-progress')[0].textContent, 'Reparto propuesto: Marauder ×6');
  h.capable = false; h.app.render(); assert.equal(h.toggle.disabled, false); h.toggle.dispatch('click');
  assert.equal(h.data.config.enabled, false); assert.equal(h.writes, 2);
});

test('invalid fleet targets never save; a valid correction clears validation', () => {
  const h = harness(), goal = h.goal('Marauder');
  for (const value of ['', '-1', '1.5', '1000001', 'NaN', 'Infinity']) {
    goal.value = value; goal.dispatch('change'); assert.equal(goal.getAttribute('aria-invalid'), 'true');
    assert.equal(h.writes, 0); assert.equal(h.data.config.fleetTargets.marauder, 20);
  }
  goal.value = '40'; goal.dispatch('change');
  assert.equal(goal.getAttribute('aria-invalid'), null); assert.equal(h.error.textContent, '');
  assert.equal(h.data.config.fleetTargets.marauder, 40); assert.equal(h.writes, 1);
});

test('failed and asynchronous saves are disclosed without a false persisted state', () => {
  for (const failure of ['sync', 'async']) {
    const h = harness(); h.failure = failure; h.toggle.dispatch('click');
    assert.equal(h.data.config.enabled, false); assert.equal(h.toggle.getAttribute('aria-pressed'), 'false');
    assert.match(h.error.textContent, failure === 'sync' ? /No se pudo guardar/ : /guardado síncrono/);
    h.app.render(); assert.notEqual(h.error.textContent, '');
  }
});

test('malicious system names remain plain text in labels and headings', () => {
  const h = harness(), name = '<img src=x onerror=alert(1)><script>bad()</script>';
  h.data.roster.systems[0].name = name; h.app.render();
  assert.equal(all(h.cards[0]).find(node => node.tagName === 'H3').textContent, name);
  assert.ok(byLabel(h.container, 'Rol de ' + name));
  assert.ok(!h.document.createdTags.some(tag => ['img', 'script'].includes(tag)));
});

test('render preserves focused goal and role drafts in both document and shadow roots', () => {
  for (const shadow of [false, true]) {
    const h = harness({ shadow }), goal = h.goal('Marauder'), role = byLabel(h.container, 'Rol de Sede');
    goal.focus(); goal.value = '123'; h.app.render(); assert.equal(goal.value, '123');
    role.focus(); role.value = 'defense'; h.app.render(); assert.equal(role.value, 'defense');
    h.root.activeElement = null; h.app.render(); assert.equal(goal.value, '20'); assert.equal(role.value, 'balanced');
  }
});

test('role and exclusion controls save only their intended system policy', () => {
  const h = harness(); h.toggle.dispatch('click');
  const role = byLabel(h.container, 'Rol de Colonia'); role.value = 'industry'; role.dispatch('change');
  assert.equal(h.data.config.systems[B].role, 'industry'); assert.equal(h.data.config.systems[A], undefined);
  assert.equal(withClass(h.cards[1], 'empire-progress')[0].textContent, 'Sin producción imperial adicional asignada.');
  const enabled = byLabel(h.container, 'Atender Colonia'); enabled.checked = false; enabled.dispatch('change');
  assert.equal(h.data.config.systems[B].enabled, false); assert.equal(h.data.config.systems[B].role, 'industry');
  assert.equal(h.data.config.fleetTargets.marauder, 20);
});

test('roster removal clears obsolete cards and reveals the empty state', () => {
  const h = harness(); h.data.roster.systems = []; h.app.render();
  assert.equal(h.cards.length, 0); assert.equal(withClass(h.container, 'empire-empty')[0].hidden, false);
});

test('destroy removes panel and style, prevents saves, and cannot be remounted', () => {
  const h = harness(), toggle = h.toggle, goal = h.goal('Marauder');
  assert.equal(h.container.children.length, 2); h.app.destroy();
  assert.equal(h.container.children.length, 0); h.app.render();
  toggle.dispatch('click'); goal.value = '35'; goal.dispatch('change'); assert.equal(h.writes, 0);
  assert.throws(() => h.app.mount(h.container), /destruido/); h.app.destroy();
});


test('stable visible render does not rewrite identical text or lose live age updates', () => {
  const h = harness(); h.document.textWrites = 0;
  for (let i = 0; i < 20; i++) h.app.render();
  assert.equal(h.document.textWrites, 0);
  h.clock += 1000; h.app.render();
  assert.equal(h.document.textWrites, 2);
  assert.ok(h.paragraphs().filter(text => text === 'Lectura de hace 1 s').length === 2);
  h.document.textWrites = 0;
  h.data.snapshots[0].resources.palladium.amount = 123.45; h.app.render();
  assert.ok(h.document.textWrites > 0);
  assert.ok(h.paragraphs().includes('Palladium 223,45 / 2000 · Iridium 100 / 1000'));
});

test('hidden dashboard does no census reads and renders the latest values when opened', () => {
  const h = harness({ visible: false });
  assert.equal(h.reads, 0); assert.equal(h.cards.length, 0);
  for (let i = 0; i < 20; i++) h.app.render();
  assert.equal(h.reads, 0);
  h.data.snapshots[0].resources.palladium.amount = 999; h.visible = true; h.app.render();
  assert.equal(h.reads, 1); assert.equal(h.cards.length, 2);
  assert.ok(h.paragraphs().includes('Palladium 1099 / 2000 · Iridium 100 / 1000'));
  h.visible = false; h.clock += 120001; h.app.render(); assert.equal(h.reads, 1);
  h.visible = true; h.app.render(); assert.equal(h.reads, 2);
  assert.equal(h.cards[0].dataset.stale, 'true');
  assert.ok(h.paragraphs().includes('0 de 2 sistemas con datos recientes · información incompleta'));
});


test('reported ship totals explain covered imperial goals despite unmet local minima', () => {
  const h = harness();
  h.data.config = core.normalizeConfig({ enabled: true, fleetTargets: { probe: 30, marauder: 300, sentinel: 300, vanguard: 5 } });
  const quantities = [
    { probe: [0, 30], marauder: [0, 165], sentinel: [147, 0], vanguard: [1, 1] },
    { probe: [0, 30], marauder: [0, 238], sentinel: [163, 0], vanguard: [3, 1] },
  ];
  h.data.snapshots.forEach((row, index) => { for (const [ship, [parked, away]] of Object.entries(quantities[index])) row.fleet[ship] = { parked, away, building: 0 }; });
  h.data.transitCensus.ships = { probe: 60, marauder: 403, sentinel: 0, vanguard: 2 };
  h.data.status = 'Imperio activo: Sede.'; h.data.ready = true; h.app.render();
  const summaries = withClass(h.container, 'empire-goal-status').map(node => node.textContent);
  assert.deepEqual(summaries, [
    '60 en el imperio · objetivo 30 · faltan 0', '403 en el imperio · objetivo 300 · faltan 0',
    '310 en el imperio · objetivo 300 · faltan 0', '6 en el imperio · objetivo 5 · faltan 0',
  ]);
  assert.ok(h.paragraphs().includes('Objetivos de flota cubiertos: no se necesitan naves nuevas.'));
  assert.ok(h.paragraphs().includes('Imperio activo: Sede.'));
  for (const message of ['Imperio pausado con el Helper.', 'Esperando un censo nativo posterior al pedido confirmado; no se enviarán nuevos pedidos.']) {
    h.data.status = message; h.data.ready = false; h.app.render();
    assert.ok(h.paragraphs().includes(message), 'Stock feedback must not replace operational pauses or barriers');
  }
  assert.equal(h.writes, 0);
  for (const ship of ['Probe', 'Marauder', 'Sentinel', 'Vanguard']) {
    const describedBy = h.goal(ship).getAttribute('aria-describedby');
    assert.ok(describedBy && describedBy.split(' ').every(id => all(h.container).some(node => node.id === id)));
    assert.equal(describedBy.split(' ').length, 2);
    assert.match(describedBy.split(' ').at(-1), /empire-edit/);
  }
});

test('goal feedback never labels partial, stale or unsynchronized totals as verified', () => {
  for (const change of [
    h => { h.data.snapshots.pop(); },
    h => { h.clock += 120001; },
    h => { h.data.transitCensus = null; },
    h => { h.data.snapshots[1].censusId = 'other'; },
    h => { h.data.snapshots[0].fleet.probe.parked = null; },
  ]) {
    const h = harness(); h.data.config.enabled = true; h.data.ready = true;
    h.data.status = 'Imperio activo: Sede.'; h.app.render(); change(h); h.app.render();
    const summaries = withClass(h.container, 'empire-goal-status');
    assert.equal(summaries.length, 4);
    assert.ok(summaries.every(node => node.textContent === 'Total y faltantes sin verificar: falta un censo actual y completo.'));
    assert.ok(h.paragraphs().includes('Producción imperial sin calcular: falta un censo actual y completo.'));
    assert.ok(!h.paragraphs().includes('Objetivos de flota cubiertos: no se necesitan naves nuevas.'));
    assert.ok(withClass(h.container, 'empire-progress').every(node => !node.textContent.startsWith('Reparto propuesto')));
  }
});

test('goal feedback uses saved goals while editing and updates after save', () => {
  const h = harness(); h.data.config.enabled = true; h.app.render();
  const goal = h.goal('Marauder'); goal.focus(); goal.value = '40'; h.app.render();
  assert.equal(goal.value, '40');
  assert.equal(withClass(h.container, 'empire-goal-status')[1].textContent, '8 en el imperio · objetivo 20 · faltan 12');
  goal.dispatch('change');
  assert.equal(withClass(h.container, 'empire-goal-status')[1].textContent, '8 en el imperio · objetivo 40 · faltan 32');
  assert.equal(h.writes, 1);
});

test('production summary distinguishes stopped mode, no fleet goal, and ineligible roles', () => {
  const h = harness();
  assert.ok(h.paragraphs().includes('Imperio desactivado: se aplican los mínimos locales de Flota.'));
  h.data.config.enabled = true;
  h.data.config.systems = { [A]: { role: 'industry' }, [B]: { role: 'shipyard', enabled: false } }; h.app.render();
  assert.ok(h.paragraphs().includes('Faltan naves, pero no hay sistemas con Atender y rol Equilibrado o Astillero.'));
  h.data.config.systems = {}; h.app.render();
  assert.ok(h.paragraphs().includes('Faltan naves para los objetivos imperiales. Los pedidos respetan pausas, recursos, colas y Depot/Reactor.'));
  h.data.config.fleetTargets = {}; h.app.render();
  assert.ok(h.paragraphs().includes('No hay objetivos imperiales de flota activados.'));
});


test('goal feedback clears cross-scope totals and cached allocations before any new census', () => {
  for (const scope of ['other-galaxy/player', 'alpha/other-player']) {
    const h = harness(); h.data.config.enabled = true; h.data.ready = true; h.app.render();
    h.data.cachedPlan = core.plan(h.data.config, h.data.snapshots, { scope: SCOPE, now: h.clock,
      expectedIds: [A, B], transitCensus: h.data.transitCensus });
    assert.ok(withClass(h.container, 'empire-goal-status').some(node => /8 en el imperio/.test(node.textContent)));
    assert.ok(withClass(h.container, 'empire-progress').some(node => /Reparto propuesto/.test(node.textContent)));
    h.data.scope = scope; h.data.status = 'Falta verificar la identidad de la cuenta y galaxia.'; h.data.ready = false;
    h.app.render();
    assert.ok(withClass(h.container, 'empire-goal-status').every(node => node.textContent === 'Total y faltantes sin verificar: falta un censo actual y completo.'));
    assert.ok(withClass(h.container, 'empire-progress').every(node => !node.textContent.includes('Reparto propuesto')));
    assert.ok(h.paragraphs().includes(h.data.status)); assert.equal(h.writes, 0);
  }
});

test('goal feedback rejects conflicting, unowned and foreign transit observations', () => {
  for (const change of [
    h => { h.data.snapshots.push(structuredClone(h.data.snapshots[0])); },
    h => { h.data.snapshots[0].owned = false; },
    h => { h.data.snapshots[0].scope = 'other/player'; },
    h => { h.data.transitCensus.scope = 'other/player'; },
    h => { h.data.snapshots[0].fleet.marauder.away = 1; },
  ]) {
    const h = harness(); h.data.config.enabled = true; h.app.render(); change(h); h.app.render();
    const statuses = withClass(h.container, 'empire-goal-status');
    assert.equal(statuses.length, 4); assert.ok(statuses.every(node => node.textContent.startsWith('Total y faltantes sin verificar:')));
    assert.ok(h.paragraphs().includes('Producción imperial sin calcular: falta un censo actual y completo.'));
    assert.equal(h.writes, 0);
  }
});

test('goal feedback expires reused census objects at the runtime freshness boundary', () => {
  const h = harness(); h.data.config.enabled = true; h.data.maxAgeMs = 15000;
  const snapshots = h.data.snapshots, transit = h.data.transitCensus;
  h.clock = 25000; h.app.render();
  assert.equal(withClass(h.container, 'empire-goal-status')[1].textContent, '8 en el imperio · objetivo 20 · faltan 12');
  h.data.cachedPlan = core.plan(h.data.config, snapshots, { scope: SCOPE, now: h.clock, maxAgeMs: 15000, expectedIds: [A, B], transitCensus: transit });
  h.clock++; h.app.render();
  assert.equal(h.data.snapshots, snapshots); assert.equal(h.data.transitCensus, transit);
  assert.ok(withClass(h.container, 'empire-goal-status').every(node => node.textContent.startsWith('Total y faltantes sin verificar:')));
  assert.ok(withClass(h.container, 'empire-progress').every(node => !node.textContent.includes('Reparto propuesto')));
  for (const row of snapshots) { row.observedAt = h.clock; row.censusId = 'source-2'; }
  h.app.render();
  assert.ok(withClass(h.container, 'empire-goal-status').every(node => node.textContent.startsWith('Total y faltantes sin verificar:')));
  h.data.transitCensus = { ...transit, observedAt: h.clock, censusId: 'source-2' }; h.data.cachedPlan = null; h.app.render();
  assert.equal(withClass(h.container, 'empire-goal-status')[1].textContent, '8 en el imperio · objetivo 20 · faltan 12');
});

test('goal feedback preserves focused drafts and saved goals across conflicts and failed saves', () => {
  for (const shadow of [false, true]) for (const failure of ['sync', 'async']) {
    const h = harness({ shadow }); h.data.config.enabled = true; h.app.render();
    const goal = h.goal('Marauder'); goal.focus(); goal.value = '40';
    h.data.config.fleetTargets.marauder = 30; h.app.render();
    assert.equal(goal.value, '40');
    assert.equal(withClass(h.container, 'empire-goal-status')[1].textContent, '8 en el imperio · objetivo 30 · faltan 22');
    h.failure = failure; goal.dispatch('change');
    assert.equal(goal.value, '40'); assert.equal(h.data.config.fleetTargets.marauder, 30);
    assert.equal(withClass(h.container, 'empire-goal-status')[1].textContent, '8 en el imperio · objetivo 30 · faltan 22');
    assert.match(h.error.textContent, failure === 'sync' ? /No se pudo guardar/ : /guardado síncrono/);
    h.app.render(); assert.notEqual(h.error.textContent, '');
    h.root.activeElement = null; h.app.render(); assert.equal(goal.value, '40');
    h.failure = ''; goal.focus(); goal.value = '40'; goal.dispatch('change');
    assert.equal(h.error.textContent, ''); assert.equal(h.data.config.fleetTargets.marauder, 40);
    assert.equal(withClass(h.container, 'empire-goal-status')[1].textContent, '8 en el imperio · objetivo 40 · faltan 32');
  }
});

test('production feedback respects disabled and conflicting producers without clearing runtime errors', () => {
  for (const systems of [
    { [A]: { role: 'industry' }, [B]: { role: 'defense' } },
    { [A]: { role: 'balanced', enabled: false }, [B]: { role: 'shipyard', enabled: false } },
    { [A]: { role: 'shipyard' }, [A.toUpperCase()]: { role: 'shipyard', enabled: false }, [B]: { role: 'industry' } },
  ]) {
    const h = harness(); h.data.config = { enabled: true, fleetTargets: { marauder: 20 }, systems };
    h.data.status = 'Error del selector; detén y vuelve a activar Imperio.'; h.data.ready = false; h.app.render();
    assert.ok(h.paragraphs().includes('Faltan naves, pero no hay sistemas con Atender y rol Equilibrado o Astillero.'));
    assert.ok(h.paragraphs().includes(h.data.status));
    assert.ok(withClass(h.container, 'empire-progress').every(node => !node.textContent.includes('Reparto propuesto')));
    h.data.config.fleetTargets.marauder = 8; h.app.render();
    assert.ok(h.paragraphs().includes('Objetivos de flota cubiertos: no se necesitan naves nuevas.'));
    assert.ok(h.paragraphs().includes(h.data.status)); assert.equal(h.writes, 0);
  }
});

// UI/UX regression matrix: real production handlers, simulated DOM only.
test('invalid imperial drafts survive blur and passive refresh until corrected', () => {
  const h = harness({ shadow: true }), goal = h.goal('Marauder');
  goal.focus(); goal.value = '-1'; goal.dispatch('input'); goal.dispatch('change');
  h.root.activeElement = null;
  for (let i = 0; i < 3; i++) h.app.render();
  assert.equal(goal.value, '-1'); assert.equal(goal.getAttribute('aria-invalid'), 'true');
  assert.equal(h.writes, 0); assert.equal(h.data.config.fleetTargets.marauder, 20);
  const feedback = withClass(h.container, 'empire-edit-status').find(node => node.id === goal.getAttribute('aria-describedby').split(' ').at(-1));
  assert.match(feedback.textContent, /entero/);
  goal.value = '0'; goal.dispatch('input'); goal.dispatch('change'); h.app.render();
  assert.equal(h.data.config.fleetTargets.marauder, 0); assert.equal(goal.getAttribute('aria-invalid'), null);
  assert.match(feedback.textContent, /Guardado/);
});

test('failed imperial goal saves retain the attempted value with local failure feedback', () => {
  for (const failure of ['sync', 'async']) {
    const h = harness(), goal = h.goal('Marauder'); h.failure = failure;
    goal.value = '43'; goal.dispatch('input'); goal.dispatch('change'); h.app.render();
    assert.equal(goal.value, '43'); assert.equal(h.data.config.fleetTargets.marauder, 20);
    assert.match(withClass(h.container, 'empire-edit-status').map(node => node.textContent).join(' '), /Guardado sin confirmar/);
    h.failure = ''; goal.dispatch('change'); h.app.render();
    assert.equal(h.data.config.fleetTargets.marauder, 43);
  }
});

test('goal draft and validation are discarded when account or galaxy scope changes', () => {
  for (const nextScope of ['beta/player', 'alpha/other-player', '']) {
    const h = harness({ shadow: true }), goal = h.goal('Marauder');
    goal.focus(); goal.value = '-7'; goal.dispatch('input'); goal.dispatch('change');
    h.data.scope = nextScope; h.data.config.fleetTargets.marauder = 64; h.app.render();
    assert.equal(goal.value, '64'); assert.equal(goal.getAttribute('aria-invalid'), null);
    assert.ok(withClass(h.container, 'empire-edit-status').every(node => node.textContent === ''));
    assert.equal(h.writes, 0);
  }
});

test('late change events cannot commit a draft into a new imperial scope', () => {
  const h = harness(), goal = h.goal('Marauder');
  goal.focus(); goal.value = '80'; goal.dispatch('input');
  h.data.scope = 'beta/other-player'; h.data.config.fleetTargets.marauder = 6;
  goal.dispatch('change');
  assert.equal(h.writes, 0); assert.equal(goal.value, '6'); assert.equal(h.data.config.fleetTargets.marauder, 6);
});

test('Drive-like updates preserve a local draft and merge the eventual edit into latest policy', () => {
  const h = harness(), goal = h.goal('Marauder');
  goal.focus(); goal.value = '48'; goal.dispatch('input');
  h.data.config.fleetTargets.marauder = 31; h.data.config.fleetTargets.probe = 9;
  h.data.config.systems[A] = { role: 'industry', enabled: false };
  h.app.render(); assert.equal(goal.value, '48'); assert.equal(h.writes, 0);
  goal.dispatch('change');
  assert.equal(h.data.config.fleetTargets.marauder, 48); assert.equal(h.data.config.fleetTargets.probe, 9);
  assert.equal(h.data.config.systems[A].role, 'industry'); assert.equal(h.data.config.systems[A].enabled, false);
  h.root.activeElement = null; h.data.config.fleetTargets.marauder = 67; h.app.render();
  assert.equal(goal.value, '67');
  assert.ok(withClass(h.container, 'empire-edit-status').every(node => node.textContent === ''));
});

test('imperial goal feedback covers empty, integer bounds and invalid numeric formats', () => {
  const invalid = ['', ' ', '-1', '0.5', String(core.MAX_TARGET + 1), 'NaN', 'Infinity', 'abc', '1,5'];
  for (const value of invalid) {
    const h = harness(), goal = h.goal('Probe'); goal.value = value; goal.dispatch('input'); goal.dispatch('change');
    h.app.render(); assert.equal(goal.value, value); assert.equal(goal.getAttribute('aria-invalid'), 'true'); assert.equal(h.writes, 0);
  }
  for (const value of ['0', '1', String(core.MAX_TARGET)]) {
    const h = harness(), goal = h.goal('Probe'); goal.value = value; goal.dispatch('input'); goal.dispatch('change');
    assert.equal(h.data.config.fleetTargets.probe, Number(value)); assert.equal(h.writes, 1);
  }
});

test('imperial long-form help is closed by default while scope and counting remain visible', () => {
  const h = harness(), disclosure = withClass(h.container, 'empire-help')[0];
  assert.ok(disclosure); assert.notEqual(disclosure.open, true);
  assert.equal(disclosure.children[0].tagName, 'SUMMARY');
  assert.match(disclosure.textContent, /Drive/); assert.match(disclosure.textContent, /Atender/);
  const summary = withClass(h.container, 'empire-scope-help')[0];
  assert.ok(summary); assert.equal(summary.parentNode.className, 'oldlight-empire');
  assert.match(summary.textContent, /misiones/);
  assert.equal(h.writes, 0);
});

test('returning a goal to its starting value clears an uncommitted no-op on blur', () => {
  for (const remoteDuringEdit of [false, true]) {
    const h = harness(), goal = h.goal('Marauder');
    goal.focus(); goal.value = '40'; goal.dispatch('input');
    if (remoteDuringEdit) h.data.config.fleetTargets.marauder = 67;
    goal.value = '20'; goal.dispatch('input'); h.root.activeElement = null; goal.dispatch('blur');
    h.app.render(); assert.equal(h.writes, 0);
    assert.ok(withClass(h.container, 'empire-edit-status').every(node => node.textContent === ''));
    h.data.config.fleetTargets.marauder = 67; h.app.render(); assert.equal(goal.value, '67');
  }
});

test('cheap hidden-scope observation invalidates round-trip drafts without reading a census', () => {
  const h = harness(), goal = h.goal('Marauder');
  goal.value = '-8'; goal.dispatch('input'); goal.dispatch('change'); h.visible = false;
  const reads = h.reads;
  h.data.scope = 'beta/other-player'; h.app.observeScope(h.data.scope); h.app.render();
  h.data.scope = SCOPE; h.app.observeScope(h.data.scope); h.app.render();
  assert.equal(h.reads, reads);
  h.visible = true; h.app.render();
  assert.equal(goal.value, '20'); assert.equal(goal.getAttribute('aria-invalid'), null); assert.equal(h.writes, 0);
});

test('re-editing the same failed goal retries on blur when native change is absent', () => {
  const h = harness(), goal = h.goal('Marauder'); h.failure = 'sync';
  goal.value = '43'; goal.dispatch('input'); goal.dispatch('change');
  assert.equal(h.writes, 1); assert.equal(h.data.config.fleetTargets.marauder, 20);
  h.failure = ''; goal.value = '44'; goal.dispatch('input'); goal.value = '43'; goal.dispatch('input');
  h.root.activeElement = null; goal.dispatch('blur');
  assert.equal(h.writes, 2); assert.equal(h.data.config.fleetTargets.marauder, 43);
  goal.dispatch('blur'); assert.equal(h.writes, 2);
});

test('blur commit followed by a late repeated change does not save a goal twice', () => {
  const h = harness(), goal = h.goal('Marauder');
  goal.value = '44'; goal.dispatch('input'); h.root.activeElement = null; goal.dispatch('blur');
  assert.equal(h.writes, 1); goal.dispatch('change'); goal.dispatch('blur');
  assert.equal(h.writes, 1); assert.equal(h.data.config.fleetTargets.marauder, 44);
});

test('reentrant save completion cannot overwrite a newer imperial draft or nested save', () => {
  for (const mode of ['draft', 'same-value-draft', 'nested-save', 'draft-error']) {
    const h = harness(), goal = h.goal('Marauder'); goal.value = '40'; goal.dispatch('input');
    h.failure = value => {
      h.failure = ''; h.data.config = core.normalizeConfig(value);
      goal.value = '55'; goal.dispatch('input');
      if (mode === 'same-value-draft') { goal.value = '40'; goal.dispatch('input'); }
      if (mode === 'nested-save') goal.dispatch('change');
      if (mode === 'draft-error') throw Error('Obsolete operation');
    };
    goal.dispatch('change'); h.app.render();
    assert.equal(goal.value, mode === 'same-value-draft' ? '40' : '55');
    const feedback = withClass(h.container, 'empire-edit-status')[1];
    assert.equal(feedback.dataset.state, mode === 'nested-save' ? 'saved' : 'draft');
    assert.equal(h.error.textContent, '');
    assert.equal(h.writes, mode === 'nested-save' ? 2 : 1);
  }
});

test('scope generation prevents reentrant errors or success leaking across A to B to A', () => {
  for (const roundTrip of [false, true]) for (const fail of [false, true]) {
    const h = harness(), goal = h.goal('Marauder'); goal.value = '40'; goal.dispatch('input');
    h.failure = () => {
      h.data.scope = 'beta/other'; h.app.observeScope?.(h.data.scope); h.app.render();
      if (roundTrip) { h.data.scope = SCOPE; h.app.observeScope?.(h.data.scope); }
      h.data.config.fleetTargets.marauder = 73; h.app.render();
      if (fail) throw Error('Old-scope failure');
    };
    goal.dispatch('change'); h.app.render();
    assert.equal(goal.value, '73'); assert.equal(h.error.textContent, '');
    assert.ok(withClass(h.container, 'empire-edit-status').every(node => node.textContent === ''));
    assert.equal(h.writes, 1);
  }
});

test('destroy during an imperial save leaves no detached feedback writes or exception', () => {
  const h = harness(), goal = h.goal('Marauder'); goal.value = '40'; goal.dispatch('input');
  h.failure = () => h.app.destroy();
  assert.doesNotThrow(() => goal.dispatch('change'));
  const writes = h.document.textWrites;
  goal.dispatch('input'); goal.dispatch('blur'); goal.dispatch('change'); h.app.render();
  assert.equal(h.document.textWrites, writes); assert.equal(h.container.children.length, 0); assert.equal(h.writes, 1);
});

test('rejected async goal saves are consumed and never reported as confirmed local saves', async () => {
  const h = harness(), goal = h.goal('Marauder'); goal.value = '40'; goal.dispatch('input');
  h.failure = () => Promise.reject(Error('Synthetic async storage failure'));
  goal.dispatch('change'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(goal.value, '40'); assert.equal(h.data.config.fleetTargets.marauder, 20);
  assert.match(h.error.textContent, /síncrono/);
  assert.equal(withClass(h.container, 'empire-edit-status')[1].dataset.state, 'error');
  h.data.scope = 'beta/other'; h.app.render();
  assert.equal(h.error.textContent, '');
});

test('resetting policy releases saved feedback but preserves a pending draft until scope changes', () => {
  const h = harness(), goal = h.goal('Marauder'); goal.value = '40'; goal.dispatch('input'); goal.dispatch('change');
  h.data.config = core.normalizeConfig({}); h.app.render();
  assert.equal(goal.value, '0'); assert.equal(withClass(h.container, 'empire-edit-status')[1].textContent, '');
  goal.value = '-4'; goal.dispatch('input'); goal.dispatch('blur'); h.data.config = core.normalizeConfig({fleetTargets:{marauder:21}}); h.app.render();
  assert.equal(goal.value, '-4'); assert.equal(goal.getAttribute('aria-invalid'), 'true');
  h.data.scope = ''; h.app.render(); goal.value = '50'; goal.dispatch('input'); goal.dispatch('change');
  assert.equal(h.writes, 1); assert.equal(h.data.config.fleetTargets.marauder, 21);
});

test('stable renders preserve invalid feedback and closed role help without rewriting text', () => {
  const h = harness(), goal = h.goal('Marauder'); goal.value = '-2'; goal.dispatch('input'); goal.dispatch('change');
  const writes = h.document.textWrites;
  for (let i = 0; i < 50; i++) h.app.render();
  assert.equal(h.document.textWrites, writes);
  assert.equal(withClass(h.container, 'empire-role-details').length, 2);
  assert.ok(withClass(h.container, 'empire-role-details').every(node => node.open !== true));
  assert.equal(withClass(h.container, 'empire-goal-status').length, 4);
});


test('nested saves of different goals finish independently without clearing the newer error', () => {
  for (const fails of [false, true]) {
    const h = harness(), marauder = h.goal('Marauder'), probe = h.goal('Probe');
    marauder.value = '40'; marauder.dispatch('input');
    h.failure = value => {
      h.data.config = core.normalizeConfig(value); h.failure = fails ? 'sync' : '';
      probe.value = '9'; probe.dispatch('input'); probe.dispatch('change');
    };
    marauder.dispatch('change'); h.app.render();
    const messages = withClass(h.container, 'empire-edit-status');
    assert.equal(messages[1].dataset.state, 'saved'); assert.equal(marauder.value, '40');
    assert.equal(messages[0].dataset.state, fails ? 'error' : 'saved'); assert.equal(probe.value, '9');
    assert.equal(h.data.config.fleetTargets.marauder, 40); assert.equal(h.data.config.fleetTargets.probe, fails ? 0 : 9);
    assert.equal(h.writes, 2);
    if (fails) assert.match(h.error.textContent, /No se pudo guardar/); else assert.equal(h.error.textContent, '');
    assert.ok(messages.every(node => node.textContent !== 'Guardando…'));
  }
});


test('observer recovery is compact collapsed help with manual steps and no effects', () => {
  const h = harness({ capable: false, recovery: { reason: 'connection-unobserved', readyState: 'complete' } });
  const help = withClass(h.container, 'empire-recovery')[0];
  assert.ok(help); assert.equal(help.tagName, 'DETAILS'); assert.equal(help.hidden, false);
  assert.equal(Boolean(help.open), false);
  assert.equal(help.children[0].tagName, 'SUMMARY');
  assert.equal(help.children[0].textContent, 'Cómo recuperar el lector');
  assert.match(help.textContent, /Pausa el Helper/);
  assert.match(help.textContent, /Recarga esta pestaña/);
  assert.match(help.textContent, /antes de reanudar/);
  assert.match(help.textContent, /documento cargado/);
  assert.match(help.textContent, /No indica cuándo se abrió/);
  assert.equal(all(help).filter(node => ['BUTTON', 'A', 'INPUT'].includes(node.tagName)).length, 0);
  help.open = true; h.app.render();
  assert.equal(help.open, true); assert.equal(h.writes, 0); assert.equal(h.toggle.disabled, true);
});

test('observer recovery closes on success, scope and diagnosis changes without hiding other errors', () => {
  const h = harness({ recovery: { reason: 'connection-unobserved', readyState: 'loading' } });
  const help = withClass(h.container, 'empire-recovery')[0];
  assert.ok(help); help.open = true; h.data.status = 'Guardia de seguridad activa'; h.app.render();
  assert.equal(help.open, true); assert.ok(h.paragraphs().includes('Guardia de seguridad activa'));
  h.recovery = { reason: 'missing-init', readyState: 'loading' }; h.app.render();
  assert.equal(help.open, false); assert.match(help.textContent, /actualizaciones.*falta el estado inicial/);
  help.open = true; h.data.scope = 'beta/player'; h.app.render(); assert.equal(help.open, false);
  help.open = true; h.recovery = null; h.app.render();
  assert.equal(help.hidden, true); assert.equal(help.open, false); assert.equal(h.writes, 0);
});

test('recovery accepts only fixed categories and never renders arbitrary diagnostic content', () => {
  for (const recovery of [null, {}, { reason: 'SECRET', readyState: 'SECRET' }, () => { throw Error('SECRET'); }]) {
    const h = harness({ recovery }); const help = withClass(h.container, 'empire-recovery')[0];
    assert.ok(help); assert.equal(help.hidden, true); assert.equal(h.container.textContent.includes('SECRET'), false);
    assert.equal(h.writes, 0);
  }
});


test('recovery focus stays visible and hidden account round trips close stale help', () => {
  const h = harness({ recovery: { reason: 'connection-unobserved', readyState: 'complete' } });
  const help = withClass(h.container, 'empire-recovery')[0], summary = help.children[0];
  help.contains = node => all(help).includes(node); summary.focus();
  h.recovery = null; h.app.render();
  assert.equal(h.document.activeElement, withClass(h.container, 'empire-status')[0]);
  h.recovery = { reason: 'connection-unobserved', readyState: 'complete' }; h.app.render();
  help.open = true; h.visible = false;
  h.app.observeScope('beta/player'); h.app.observeScope(SCOPE); h.visible = true; h.app.render();
  assert.equal(help.open, false); assert.equal(h.writes, 0);
});
