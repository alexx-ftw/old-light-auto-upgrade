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

function harness({ ids = [A, B], capable = true, shadow = false } = {}) {
  const document = new Document(), container = document.createElement('main');
  const host = document.createElement('div'), root = shadow ? new Element('#shadow-root', document) : document;
  document.append(host); root.append(container); if (shadow) document.activeElement = host;
  let clock = 10000, failure = '', writes = 0;
  const data = { scope: SCOPE, config: core.normalizeConfig({ fleetTargets: { marauder: 20 } }), ready: false, maxAgeMs: 120000,
    roster: { systems: ids.map(id => ({ id, owned: true, name: id === A ? 'Sede' : 'Colonia' })) },
    snapshots: ids.map(id => ({ scope: SCOPE, systemId: id, owned: true, observedAt: clock, censusId: 'source-1', name: id === A ? 'Sede' : 'Colonia',
      resources: { palladium: { amount: 100, cap: 1000, rate: 2 }, iridium: { amount: 50, cap: 500, rate: 1 } },
      fleet: Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, { parked: ship === 'marauder' ? (id === A ? 5 : 3) : 0, away: 0, building: 0 }])),
      queue: { buildings: 0, ships: 0 }, energy: 10 })),
    transitCensus: { scope: SCOPE, censusId: 'source-1', observedAt: clock, ships: Object.fromEntries(core.DEFAULT_SHIPS.map(ship => [ship, 0])) },
  };
  const app = panel.create({ document, core, now: () => clock, canEnable: () => capable,
    getState: () => ({ ...data, plan: core.plan(data.config, data.snapshots, { scope: SCOPE, now: clock, maxAgeMs: data.maxAgeMs,
      expectedIds: data.roster.systems.map(row => row.id), transitCensus: data.transitCensus }) }),
    setConfig: value => {
      writes++;
      if (failure === 'sync') throw new Error('No se pudo guardar.');
      if (failure === 'async') return Promise.resolve();
      data.config = core.normalizeConfig(value);
    },
  });
  app.mount(container);
  return { app, document, container, root, data,
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
