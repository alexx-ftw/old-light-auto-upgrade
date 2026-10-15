'use strict';
// Offline DOM/interaction tests only; no native game or network calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const panel = require('../docs/reinforcement-panel.js');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', SCOPE = 'alpha/self';
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.parentNode = null;
    this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.style = {}; this.className = ''; this.value = ''; this.hidden = false; this._text = ''; this.disabled = false;
    this.classList = { add: name => { this.className += (this.className ? ' ' : '') + name; }, contains: name => this.className.split(/\s+/).includes(name) };
  }
  set innerHTML(_) { throw new Error('HTML parsing is forbidden.'); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...nodes); }
  remove() { if (this.parentNode) { const children = this.parentNode.children; children.splice(children.indexOf(this), 1); this.parentNode = null; } }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type, data = {}) {
    const event = { type, target: this, isTrusted: true, button: 0, ctrlKey: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...data };
    for (const callback of this.listeners.get(type) || []) callback(event); return event;
  }
  contains(node) { return node === this || this.children.some(c => c.contains(node)); }
  querySelectorAll(selector) { return all(this).slice(1).filter(node => selector.split(',').some(s => matches(node, s.trim()))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return this.rect || { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }; }
  getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; }
  focus() { this.ownerDocument.activeElement = this; }
}
function matches(node, selector) {
  if (selector === 'canvas#stage') return node.tagName === 'CANVAS' && node.id === 'stage';
  if (selector === 'dialog[open]') return node.tagName === 'DIALOG' && node.open;
  if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
  return node.tagName.toLowerCase() === selector;
}
const all = node => [node, ...node.children.flatMap(all)];
class Document extends Element {
  constructor() { super('#document', null); this.ownerDocument = this; this.body = this.createElement('body'); this.append(this.body); this.defaultView = new Element('window', this); }
  createElement(tag) { return new Element(tag, this); }
  createElementNS(_, tag) { return this.createElement(tag); }
}
const byLabel = (root, name) => all(root).find(n => n.getAttribute('aria-label') === name);
const byButton = (root, name) => all(root).find(n => n.tagName === 'BUTTON' && n.textContent === name);
function harness(extra = {}) {
  const document = new Document(), window = document.defaultView, container = document.createElement('main'), canvas = document.createElement('canvas'); canvas.id = 'stage';
  document.body.append(canvas, container);
  let scope = SCOPE, clock = 1000, routes = [], calls = [], serial = 0, timers = new Map(), timerSerial = 0, failure = null;
  let world = { scope: SCOPE, galaxy: 'alpha', selfId: 'self', connected: true, complete: true, observedAt: 1000, systems: [{ id: A, q: 0, r: 0, name: 'Origen' }, { id: B, q: 10, r: 2, name: 'Destino' }] };
  const save = route => { calls.push(['save', route]); if (failure) return failure(); const id = route.id || `route-${++serial}`; routes = [...routes.filter(r => r.id !== id), { ...route, id }]; return { ok: true }; };
  const app = panel.create({ document, window, getScope: () => scope, getWorld: () => world, getRoutes: () => routes,
    now: () => clock, setTimeout: fn => { timers.set(++timerSerial, fn); return timerSerial; }, clearTimeout: id => timers.delete(id),
    onSave: save, onPause: (id, paused) => { calls.push(['pause', id, paused]); routes = routes.map(r => r.id === id ? { ...r, paused } : r); },
    onDelete: id => { calls.push(['delete', id]); routes = routes.filter(r => r.id !== id); }, ...extra });
  app.mount(container);
  const api = { document, window, container, canvas, app, calls,
    get scope() { return scope; }, set scope(v) { scope = v; }, get world() { return world; }, set world(v) { world = v; },
    get routes() { return routes; }, set routes(v) { routes = v; }, get failure() { return failure; }, set failure(v) { failure = v; },
    field: name => byLabel(container, name), click: name => { const node = byButton(container, name); assert.ok(node, name); node.dispatch('click'); },
    get error() { return all(container).find(n => n.getAttribute('role') === 'alert').textContent; },
    get status() { return all(container).find(n => n.getAttribute('role') === 'status').textContent; },
    advance: ms => { clock += ms; },
    tick: () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    gesture: (type, x, y, extra = {}) => window.dispatch(type, { target: canvas, clientX: x, clientY: y, ctrlKey: true, pointerType: 'mouse', pointerId: 1, ...extra }),
    hover: (name, x, y) => {
      let node = document.querySelector('.star-hover');
      if (!node) { node = document.createElement('div'); node.className = 'star-hover'; const title = document.createElement('div'); title.className = 'star-hover-name'; node.append(title); document.body.append(node); }
      node.hidden = false; node.querySelector('.star-hover-name').textContent = name; node.style.left = `${x}px`; node.style.top = `${y}px`;
    },
  };
  return api;
}
function fill(h, amount = '5') { h.click('Nueva ruta'); h.field('Cantidad de Marauder').value = amount; }
function create(h) { fill(h); h.click('Crear ruta'); }

test('exports factory in a browser global and CommonJS without game execution', () => {
  const vm = require('node:vm'), fs = require('node:fs'), context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../docs/reinforcement-panel.js'), 'utf8'), context);
  assert.equal(typeof context.OldLightReinforcementPanel.create, 'function'); assert.deepEqual(panel.SHIPS, ['probe', 'marauder', 'sentinel', 'vanguard']);
});
test('owned census fails closed on disconnection, scope, duplicate ids and coordinates', () => {
  const h = harness(); assert.equal(panel.ownSystems(h.world, h.scope, 1000).length, 2);
  assert.deepEqual(panel.ownSystems({ ...h.world, connected: false }, h.scope, 1000), []);
  assert.deepEqual(panel.ownSystems(h.world, 'beta/self', 1000), []);
  assert.deepEqual(panel.ownSystems({ ...h.world, systems: [h.world.systems[0], { ...h.world.systems[1], id: A }] }, h.scope, 1000), []);
  assert.deepEqual(panel.ownSystems({ ...h.world, systems: [h.world.systems[0], { ...h.world.systems[1], q: 0, r: 0 }] }, h.scope, 1000), []);
});
test('manual creation saves only after explicit review with per-type fixed/excess composition', () => {
  const h = harness(); fill(h, '9'); assert.equal(h.calls.length, 0);
  const mode = h.field('Modo de Sentinel'); mode.value = 'excess'; mode.dispatch('change'); h.field('Reserva de Sentinel').value = '12';
  h.field('Intervalo en minutos').value = '7'; h.click('Crear ruta');
  assert.equal(h.calls.length, 1); const route = h.calls[0][1];
  assert.deepEqual(route, { originId: A, destinationId: B, intervalMinutes: 7, paused: false, ships: {
    probe: { mode: 'fixed', amount: 0, reserve: 0 }, marauder: { mode: 'fixed', amount: 9, reserve: 0 },
    sentinel: { mode: 'excess', amount: 0, reserve: 12 }, vanguard: { mode: 'fixed', amount: 0, reserve: 0 },
  } }); assert.match(h.status, /guardada/);
});
test('zero composition, same system and missing ownership cannot be saved', () => {
  const h = harness(); fill(h, '0'); h.click('Crear ruta'); assert.match(h.error, /al menos/);
  h.field('Cantidad de Marauder').value = '1'; h.field('Sistema de destino').value = A; h.click('Crear ruta'); assert.match(h.error, /distintos/);
  h.field('Sistema de destino').value = B; h.world.connected = false; h.click('Crear ruta'); assert.match(h.error, /verificados/); assert.equal(h.calls.length, 0);
});
for (const value of ['', '0', '-1', '1.5', '1e3', 'Infinity', '1441']) test(`interval rejects ${JSON.stringify(value)}`, () => {
  const h = harness(); fill(h); h.field('Intervalo en minutos').value = value; h.click('Crear ruta'); assert.equal(h.calls.length, 0); assert.match(h.error, /intervalo/);
});
for (const value of ['', '-1', '1.5', '1e3', 'NaN', '1000000001']) test(`fleet count rejects ${JSON.stringify(value)}`, () => {
  const h = harness(); fill(h, value); h.click('Crear ruta'); assert.equal(h.calls.length, 0); assert.match(h.error, /enteros/);
});
test('excess with zero reserve is explicitly enabled', () => {
  const h = harness(); fill(h, '0'); h.field('Modo de Probe').value = 'excess'; h.field('Modo de Probe').dispatch('change'); h.click('Crear ruta'); assert.equal(h.calls.length, 1);
});
test('pause, resume, edit and delete pass exact route ids and preserve paused edits', () => {
  const h = harness(); create(h); h.click('Pausar'); assert.deepEqual(h.calls[1], ['pause', 'route-1', true]);
  h.click('Editar'); h.field('Intervalo en minutos').value = '10'; h.click('Guardar cambios'); assert.equal(h.routes[0].paused, true); assert.equal(h.routes[0].id, 'route-1');
  h.click('Reanudar'); assert.equal(h.routes[0].paused, false); h.click('Eliminar'); assert.equal(h.routes.length, 0);
});
test('cancel discards unsaved edits and repeated render preserves in-progress fields', () => {
  const h = harness(); fill(h, '44'); h.app.render(); assert.equal(h.field('Cantidad de Marauder').value, '44'); h.click('Cancelar'); assert.equal(h.calls.length, 0);
  h.click('Nueva ruta'); assert.equal(h.field('Cantidad de Marauder').value, '0');
});
test('scope change clears drafts even A to B to A and cannot save to another account', () => {
  const h = harness(); fill(h); h.scope = 'beta/self'; h.app.render(); h.scope = SCOPE; h.app.render(); h.click('Crear ruta'); assert.equal(h.calls.length, 0);
});
test('ownership loss while editing is checked again at save', () => {
  const h = harness(); fill(h); h.world.systems.pop(); h.click('Crear ruta'); assert.equal(h.calls.length, 0); assert.match(h.error, /propios/);
});
test('deleted edited route is never recreated accidentally', () => {
  const h = harness(); create(h); h.click('Editar'); h.routes = []; h.click('Guardar cambios'); assert.equal(h.calls.length, 1); assert.match(h.error, /ya no existe/);
});
test('failed writes retain draft and show error instead of claiming saved', () => {
  const h = harness(); fill(h); h.failure = () => ({ ok: false, reason: 'storage-full' }); h.click('Crear ruta'); assert.equal(h.error, 'storage-full'); assert.equal(h.field('Cantidad de Marauder').value, '5');
  h.failure = () => { throw new Error('denied'); }; h.click('Crear ruta'); assert.equal(h.error, 'denied');
});
test('async save cannot apply its success or error to a new scope, and duplicate submits are blocked', async () => {
  const h = harness(); let reject; h.failure = () => new Promise((_, no) => { reject = no; }); fill(h); h.click('Crear ruta'); h.click('Crear ruta'); assert.equal(h.calls.length, 1);
  h.scope = 'beta/self'; h.app.render(); reject(new Error('old failure')); await Promise.resolve(); await Promise.resolve(); assert.equal(h.error, '');
});
test('untrusted, ordinary, alt, shift and non-mouse events do not create or consume gestures', () => {
  const h = harness(); h.hover('Origen', 100, 100);
  for (const extra of [{ ctrlKey: false }, { shiftKey: true }, { altKey: true }, { metaKey: true }, { pointerType: 'touch' }, { isTrusted: false }]) {
    const down = h.gesture('pointerdown', 100, 100, extra); assert.notEqual(down.prevented, true);
  }
  assert.equal(h.calls.length, 0);
});
test('Ctrl drag uses fresh unique own hover names and opens an editable draft, never saving', () => {
  const h = harness(); h.hover('Origen', 100, 100); const down = h.gesture('pointerdown', 100, 100); assert.equal(down.prevented, true);
  const move = h.gesture('pointermove', 300, 200); assert.notEqual(move.stopped, true); h.hover('Destino', 300, 200);
  const up = h.gesture('pointerup', 300, 200); assert.equal(up.prevented, true); assert.equal(h.field('Sistema de origen').value, A); assert.equal(h.field('Sistema de destino').value, B); assert.equal(h.calls.length, 0);
  const click = h.gesture('click', 300, 200); assert.equal(click.prevented, true);
});
test('duplicate native hover names are not identities', () => {
  const h = harness(); h.world.systems[1].name = 'Origen'; h.hover('Origen', 100, 100); const down = h.gesture('pointerdown', 100, 100); assert.notEqual(down.prevented, true); assert.match(h.error, /Señala/);
});
test('hover must be near actual mouse position; stale cards are rejected', () => {
  const h = harness(); h.hover('Origen', 100, 100); const down = h.gesture('pointerdown', 500, 500); assert.notEqual(down.prevented, true);
});
test('late native hover may resolve release, while movement cancels delayed resolution', () => {
  const h = harness(); h.hover('Origen', 100, 100); h.gesture('pointerdown', 100, 100); h.gesture('pointermove', 300, 200); h.gesture('pointerup', 300, 200); h.hover('Destino', 300, 200); h.tick(); assert.match(h.status, /Revisa/);
  h.click('Cancelar'); h.hover('Origen', 100, 100); h.gesture('pointerdown', 100, 100); h.gesture('pointermove', 300, 200); h.gesture('pointerup', 300, 200); h.gesture('pointermove', 310, 210); h.hover('Destino', 300, 200); h.tick(); assert.doesNotMatch(h.status, /Revisa/);
});
for (const kind of ['blur', 'wheel', 'resize', 'pointercancel', 'popstate', 'pagehide']) test(`${kind} cancels Ctrl drag and invalidates map anchors`, () => {
  const h = harness(); h.hover('Origen', 100, 100); h.gesture('pointerdown', 100, 100); h.gesture('pointermove', 300, 200); h.window.dispatch(kind); h.hover('Destino', 300, 200); h.gesture('pointerup', 300, 200); h.tick(); assert.doesNotMatch(h.status, /Revisa/);
});
test('Escape, modifier release, pointer mismatch and release outside map never open route', () => {
  for (const variation of ['escape', 'modifier', 'pointer', 'outside', 'same']) {
    const h = harness(); h.hover('Origen', 100, 100); h.gesture('pointerdown', 100, 100); h.gesture('pointermove', 300, 200); h.hover('Destino', 300, 200);
    if (variation === 'escape') h.window.dispatch('keydown', { key: 'Escape' });
    if (variation === 'modifier') h.window.dispatch('keyup', { key: 'Control' });
    if (variation === 'same') h.hover('Origen', 100, 100);
    h.gesture('pointerup', variation === 'same' ? 100 : 300, variation === 'same' ? 100 : 200, variation === 'pointer' ? { pointerId: 9 } : variation === 'outside' ? { target: h.container } : {});
    h.tick(); assert.doesNotMatch(h.status, /Revisa/, variation);
  }
});
test('schematic arrows persist through pause and native map invalidation', () => {
  const h = harness(); create(h); const mini = h.document.querySelector('.oldlight-route-map');
  assert.equal(mini.querySelectorAll('line').length, 1); h.click('Pausar'); assert.equal(mini.querySelector('line').getAttribute('data-paused'), 'true');
  h.window.dispatch('wheel'); assert.equal(mini.querySelectorAll('line').length, 1);
});
test('native overlay uses verified anchors, hides on camera movement, and is noninteractive', () => {
  const h = harness(); create(h); h.hover('Origen', 100, 100); h.app.render(); h.hover('Destino', 300, 200); h.app.render();
  const overlay = h.document.querySelector('.oldlight-route-overlay'); assert.equal(overlay.hidden, false); assert.equal(overlay.querySelectorAll('line').length, 1); assert.equal(overlay.getAttribute('aria-hidden'), 'true');
  h.window.dispatch('wheel'); assert.equal(overlay.hidden, true); assert.equal(overlay.querySelectorAll('line').length, 0);
  h.app.render(); assert.equal(overlay.hidden, true); h.hover('Origen', 120, 120); h.app.render(); assert.equal(overlay.hidden, false);
});
test('verified external projection supports arrows independent of native hover availability', () => {
  const h = harness({ projectSystem: system => system.id === A ? { x: 100, y: 120 } : { x: 400, y: 300 } }); create(h);
  assert.equal(h.document.querySelector('.oldlight-route-overlay').hidden, false);
});
test('untrusted labels are rendered as text and never parsed as markup', () => {
  const h = harness(); h.world.systems[0].name = '<img src=x onerror=boom()>'; create(h); assert.match(h.container.textContent, /<img src=x onerror=boom\(\)>/);
  assert.equal(h.container.querySelectorAll('img').length, 0);
});
test('mount is idempotent, destroy removes listeners and both panel and overlay', () => {
  const h = harness(); h.app.mount(h.container); assert.equal(h.document.querySelectorAll('.oldlight-routes').length, 1);
  h.app.destroy(); h.app.destroy(); assert.equal(h.document.querySelectorAll('.oldlight-routes').length, 0); assert.equal(h.document.querySelectorAll('.oldlight-route-overlay').length, 0);
  assert.ok([...h.window.listeners.values()].every(set => set.size === 0)); assert.throws(() => h.app.mount(h.container), /destroyed/);
});

test('census completeness, freshness, future observations and self identity gate drafts', () => {
  const h = harness();
  for (const patch of [{ complete: false }, { selfId: 'someone-else' }, { galaxy: 'beta' }, { observedAt: 1001 }, { observedAt: -1 }]) {
    assert.deepEqual(panel.ownSystems({ ...h.world, ...patch }, h.scope, 1000), [], JSON.stringify(patch));
  }
  assert.equal(panel.ownSystems(h.world, h.scope, 121000).length, 2);
  assert.deepEqual(panel.ownSystems(h.world, h.scope, 121001), []);
});
test('storage errors are explicit, never an empty-state success, and block mutating callbacks', () => {
  let failure = 'No se puede leer el estado local'; const h = harness({ getError: () => failure });
  assert.equal(h.error, failure); assert.match(h.container.textContent, /bloqueadas hasta recuperar/);
  fill(h); h.click('Crear ruta'); assert.equal(h.calls.length, 0); assert.equal(h.error, failure);
  failure = ''; h.app.render(); h.click('Crear ruta'); assert.equal(h.calls.length, 1);
});
test('missing Web Locks availability is visible and uncertain sends explain manual review', () => {
  const h = harness({ getAvailability: () => ({ coordinated: false }) }); create(h);
  h.routes[0].needsReview = true; h.routes[0].paused = true; h.routes[0].message = 'Resultado desconocido'; h.app.render();
  assert.match(h.container.textContent, /no ofrece Web Locks/); assert.match(h.container.textContent, /Revisión necesaria/);
  assert.match(h.container.textContent, /no se repetirá el envío automáticamente/); assert.match(h.container.textContent, /Resultado desconocido/);
});
test('old detached route buttons cannot act in a later account scope', () => {
  const h = harness(); create(h); const oldDelete = byButton(h.container, 'Eliminar'), oldPause = byButton(h.container, 'Pausar');
  h.scope = 'beta/self'; h.world = { ...h.world, scope: h.scope, galaxy: 'beta' }; h.app.render();
  oldDelete.dispatch('click'); oldPause.dispatch('click'); assert.equal(h.calls.length, 1);
});
test('synthetic native navigation invalidates cached arrows without starting a Ctrl gesture', () => {
  const h = harness(); create(h); h.hover('Origen', 100, 100); h.app.render(); h.hover('Destino', 300, 200); h.app.render();
  const overlay = h.document.querySelector('.oldlight-route-overlay'); assert.equal(overlay.style.display, '');
  h.gesture('pointerdown', 100, 100, { isTrusted: false }); assert.equal(overlay.style.display, 'none');
  h.hover('Origen', 100, 100); h.app.render(); h.hover('Destino', 300, 200); h.app.render();
  h.window.dispatch('click', { target: h.canvas, isTrusted: false }); assert.equal(overlay.style.display, 'none');
  assert.equal(h.calls.length, 1);
});
test('new native observation epoch revokes earlier camera anchor cache', () => {
  const h = harness(); create(h); h.hover('Origen', 100, 100); h.app.render(); h.hover('Destino', 300, 200); h.app.render();
  const overlay = h.document.querySelector('.oldlight-route-overlay'); assert.equal(overlay.hidden, false);
  h.world.epoch = 2; h.app.render(); assert.equal(overlay.hidden, true);
});
test('missing save handler never claims persistence', () => {
  const h = harness({ onSave: undefined }); fill(h); h.click('Crear ruta'); assert.match(h.error, /no está disponible/); assert.doesNotMatch(h.status, /guardada/);
});
test('fixed quantity maximum matches the reinforcement core', () => {
  const h = harness(); fill(h, '50001'); h.click('Crear ruta'); assert.equal(h.calls.length, 0); assert.match(h.error, /50000/);
  h.field('Cantidad de Marauder').value = '50000'; h.click('Crear ruta'); assert.equal(h.calls.length, 1);
});

test('body overlay has its own inline geometry, pointer exclusion and SVG paint outside Helper shadow styles', () => {
  const h = harness({ projectSystem: system => system.id === A ? { x: 100, y: 120 } : { x: 400, y: 300 } });
  const shadow = new Element('#shadow-root', h.document); shadow.append(h.container); create(h);
  const overlay = h.document.querySelector('.oldlight-route-overlay');
  assert.equal(overlay.parentNode, h.document.body); assert.equal(h.container.contains(overlay), false);
  assert.equal(overlay.style.position, 'fixed'); assert.equal(overlay.style.pointerEvents, 'none');
  assert.equal(overlay.style.zIndex, '140'); assert.equal(overlay.style.overflow, 'hidden'); assert.equal(overlay.getAttribute('pointer-events'), 'none');
  const line = overlay.querySelector('line'); assert.equal(line.style.pointerEvents, 'none');
  assert.equal(line.getAttribute('pointer-events'), 'none'); assert.equal(line.getAttribute('stroke'), '#6be1d3');
  assert.equal(line.getAttribute('stroke-width'), '2'); assert.equal(line.getAttribute('vector-effect'), 'non-scaling-stroke');
  assert.equal(overlay.querySelector('path').getAttribute('fill'), '#6be1d3');
  h.click('Pausar'); const paused = overlay.querySelector('line'); assert.equal(paused.getAttribute('stroke'), '#adb6c4'); assert.equal(paused.getAttribute('stroke-dasharray'), '5 4');
});
test('opening a draft invokes Helper navigation before focusing an editor field', () => {
  let h, opened = []; h = harness({ onOpen: data => { opened.push({ ...data, activeElement: h.document.activeElement }); } });
  h.click('Nueva ruta'); assert.equal(opened.length, 1); assert.equal(opened[0].originId, A); assert.equal(opened[0].destinationId, B); assert.equal(opened[0].routeId, null);
  assert.notEqual(opened[0].activeElement, h.field('Sistema de origen')); assert.equal(h.document.activeElement, h.field('Sistema de origen'));
  h.click('Cancelar'); h.hover('Origen', 100, 100); h.gesture('pointerdown', 100, 100); h.gesture('pointermove', 300, 200); h.hover('Destino', 300, 200); h.gesture('pointerup', 300, 200);
  assert.equal(opened.length, 2); assert.equal(h.calls.length, 0);
});
test('Helper navigation callback cannot restore editor focus after an account change', () => {
  let h; h = harness({ onOpen: () => { h.scope = 'beta/self'; } }); h.click('Nueva ruta');
  assert.notEqual(h.document.activeElement, h.field('Sistema de origen')); h.click('Crear ruta'); assert.equal(h.calls.length, 0);
});
test('fixed quantity explanation reflects waiting for the entire requested quantity', () => {
  const h = harness(); assert.match(h.container.textContent, /Cantidad fija: espera a disponer de la cantidad completa por envío/);
  assert.doesNotMatch(h.container.textContent, /Cantidad fija: máximo por envío/);
});

test('unavailable external camera never falls back to old hover anchors for arrows', () => {
  let ready = true;
  const h = harness({ projectSystem: system => ready ? { x: system.id === A ? 100 : 300, y: 100 } : null });
  create(h); h.hover('Origen', 100, 100); h.app.render(); h.hover('Destino', 300, 200); h.app.render();
  const overlay = h.document.querySelector('.oldlight-route-overlay');
  assert.equal(overlay.style.display, ''); ready = false; h.app.render(); assert.equal(overlay.style.display, 'none');
});
test('unavailable external camera never accepts a stale hover hit instead', () => {
  const h = harness({ hitTestSystem: () => null }); h.hover('Origen', 100, 100);
  const event = h.gesture('pointerdown', 100, 100); h.gesture('pointermove', 300, 200); h.hover('Destino', 300, 200); h.gesture('pointerup', 300, 200); h.tick();
  assert.doesNotMatch(h.status, /Revisa/); assert.equal(h.calls.length, 0);
});

test('a rejected in-flight deletion keeps the route visible and explains the blocker', () => {
  const h = harness({ onDelete: () => { throw new Error('Espera a que termine el envío. Comprueba los movimientos.'); } });
  create(h); h.click('Eliminar'); assert.equal(h.routes.length, 1);
  assert.match(h.error, /Espera a que termine el envío/); assert.ok(byButton(h.container, 'Eliminar'));
  assert.doesNotMatch(h.status, /eliminada/);
});
test('reviewed-send acknowledgement is explicit and never resumes the route', () => {
  const calls=[]; const h=harness({ onAcknowledge:id=>{calls.push(id);h.routes[0].needsReview=false;return true;} });
  create(h); h.routes[0].needsReview=true;h.routes[0].paused=true;h.app.render();
  assert.equal(calls.length,0); assert.match(h.container.textContent,/Comprueba los movimientos del juego/);
  h.click('He revisado el envío');assert.equal(calls.length,1);assert.equal(h.routes[0].paused,true);
  assert.equal(h.calls.filter(x=>x[0]==='pause').length,0);assert.match(h.status,/pausada/);
});
test('review acknowledgement rejected while sending stays visible without claiming success',()=>{
  const h=harness({onAcknowledge:()=>{throw Error('El envío sigue en curso.');}});create(h);h.routes[0].needsReview=true;h.routes[0].paused=true;h.app.render();
  h.click('He revisado el envío');assert.match(h.error,/sigue en curso/);assert.equal(h.routes[0].needsReview,true);assert.doesNotMatch(h.status,/revisado/);
});
test('a detached review button cannot acknowledge after an account change',()=>{
  let calls=0;const h=harness({onAcknowledge:()=>{calls++;}});create(h);h.routes[0].needsReview=true;h.routes[0].paused=true;h.app.render();const old=byButton(h.container,'He revisado el envío');assert.ok(old);
  h.scope='beta/self';h.world={...h.world,scope:h.scope,galaxy:'beta'};h.app.render();old.dispatch('click');assert.equal(calls,0);
});

// Browser order: window capture precedes Pixi's document/canvas listeners.
// Native camera behavior is transcribed from galaxy-CqK10P8m.js pt.
// FederatedEventTarget-wp-sye9G.js (SHA256 a02af9618c6edab9cb9d6001c03a70fa6de319962ee3023195e623467b1ad0c8):
// down on canvas capture, move on document capture, up on window capture.
function nativeEvents(h) {
  let dragging = false, pan = 0, downs = 0, clicks = 0;
  const captures = new Set();
  h.canvas.setPointerCapture = id => captures.add(id);
  h.canvas.hasPointerCapture = id => captures.has(id);
  h.canvas.releasePointerCapture = id => captures.delete(id);
  const emit = (type, x, y, extra = {}) => {
    const event = { type, target: h.canvas, isTrusted: true, button: 0, buttons: /down|move/.test(type) ? 1 : 0,
      ctrlKey: true, pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    for (const node of [h.window, h.document, h.canvas]) {
      for (const callback of node.listeners.get(type) || []) { callback(event); if (event.stopped) break; }
      if (event.stopped) break;
    }
    return event;
  };
  // Pixi registers DOM listeners before the userscript mounts; capture phase,
  // rather than registration time on another target, decides precedence.
  h.canvas.addEventListener('pointerdown', e => { if (e.target === h.canvas) { dragging = true; downs++; } });
  h.document.addEventListener('pointermove', () => { if (dragging) pan++; });
  const nativeUp = () => { if (dragging) clicks++; dragging = false; };
  // The game's window listener was registered before the late panel mount.
  h.window.listeners.set('pointerup', new Set([nativeUp, ...(h.window.listeners.get('pointerup') || [])]));
  return { emit, captures, get pan() { return pan; }, get downs() { return downs; }, get clicks() { return clicks; } };
}
test('unavailable camera: fresh own native card recovers Ctrl drag before Pixi pan, without stale anchors', () => {
  const h = harness({ hitTestSystem: () => null, projectSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) });
  const native = nativeEvents(h);
  native.emit('pointermove', 100, 100, { buttons: 0 }); h.advance(301); h.hover('Origen', 100, 100);
  const down = native.emit('pointerdown', 100, 100); assert.equal(down.stopped, true);
  native.emit('mousedown', 100, 100); native.emit('pointermove', 300, 200); native.emit('mousemove', 300, 200);
  h.hover('Destino', 300, 200); native.emit('pointerup', 300, 200); native.emit('mouseup', 300, 200);
  assert.equal(native.pan, 0); assert.equal(native.downs, 0); assert.equal(native.clicks, 0); assert.equal(native.captures.size, 0);
  assert.match(h.status, /Revisa/); assert.equal(h.field('Sistema de origen').value, A); assert.equal(h.field('Sistema de destino').value, B);
  assert.equal(h.calls.length, 0); assert.equal(h.document.querySelector('.oldlight-route-overlay').style.display, 'none');
});
test('verified camera captures a route and leaves ordinary pan and Shift untouched', () => {
  const h = harness({ hitTestSystem: p => p.x === 100 ? A : B }); const n = nativeEvents(h);
  n.emit('pointerdown', 100, 100); assert.equal(n.captures.has(1), true); n.emit('pointermove', 300, 200); n.emit('pointerup', 300, 200);
  assert.equal(n.pan, 0); assert.match(h.status, /Revisa/);
  for (const modifiers of [{ ctrlKey: false }, { shiftKey: true }]) {
    n.emit('pointerdown', 100, 100, modifiers); n.emit('pointermove', 300, 200, modifiers); n.emit('pointerup', 300, 200, modifiers);
  }
  assert.equal(n.downs, 2); assert.equal(n.pan, 2);
});
for (const kind of ['no-card', 'ambiguous', 'foreign', 'stale-position', 'no-dwell']) test('camera fallback rejects ' + kind + ' without claiming native input', () => {
  const h = harness({ hitTestSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) }); const n = nativeEvents(h);
  n.emit('pointermove', 100, 100, { buttons: 0 }); if (kind !== 'no-dwell') h.advance(301);
  if (kind !== 'no-card') h.hover(kind === 'foreign' ? 'Enemigo' : 'Origen', kind === 'stale-position' ? 500 : 100, 100);
  if (kind === 'ambiguous') h.world.systems[1].name = 'Origen';
  const e = n.emit('pointerdown', 100, 100); assert.notEqual(e.stopped, true); assert.equal(n.downs, 1);
  assert.match(h.error, /Cámara no disponible/); assert.equal(h.calls.length, 0);
});
for (const kind of ['Escape', 'blur', 'Control', 'pointercancel', 'lostpointercapture', 'outside-move', 'pointerout']) test('captured route cancels and releases capture on ' + kind, () => {
  const h = harness({ hitTestSystem: p => p.x === 100 ? A : B }); const n = nativeEvents(h);
  n.emit('pointerdown', 100, 100); n.emit('pointermove', 300, 200);
  if (kind === 'Escape') h.window.dispatch('keydown', { key: 'Escape' });
  else if (kind === 'Control') h.window.dispatch('keyup', { key: 'Control' });
  else if (kind === 'outside-move') n.emit('pointermove', 900, 200);
  else if (kind === 'pointerout') n.emit('pointerout', 300, 200, { relatedTarget: null });
  else h.window.dispatch(kind);
  n.emit('pointerup', 300, 200); h.tick(); assert.doesNotMatch(h.status, /Revisa/); assert.equal(n.captures.size, 0); assert.equal(h.calls.length, 0);
});
test('Control release also cancels delayed native destination verification', () => {
  const h = harness(); h.hover('Origen', 100, 100); h.gesture('pointerdown', 100, 100); h.gesture('pointermove', 300, 200); h.gesture('pointerup', 300, 200);
  h.window.dispatch('keyup', { key: 'Control' }); h.hover('Destino', 300, 200); h.tick(); assert.doesNotMatch(h.status, /Revisa/);
});

test('implicit lostpointercapture after pointerup preserves pending fresh tooltip verification', () => {
  const h = harness({ hitTestSystem: () => null, projectSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) }); const n = nativeEvents(h);
  n.emit('pointermove', 100, 100, { buttons: 0 }); h.advance(301); h.hover('Origen', 100, 100);
  n.emit('pointerdown', 100, 100); n.emit('pointermove', 300, 200); n.emit('pointerup', 300, 200);
  n.emit('lostpointercapture', 300, 200); h.hover('Destino', 300, 200); h.tick(); assert.match(h.status, /Revisa/); assert.equal(h.calls.length, 0);
});
test('available camera rejection never falls back to a native tooltip', () => {
  const h = harness({ hitTestSystem: () => null, getAvailability: () => ({ cameraAvailable: true }) }); const n = nativeEvents(h);
  n.emit('pointermove', 100, 100, { buttons: 0 }); h.advance(301); h.hover('Origen', 100, 100);
  assert.notEqual(n.emit('pointerdown', 100, 100).stopped, true); assert.equal(n.downs, 1);
});

for (const change of ['epoch', 'path', 'origin']) test('pending native-card gesture rejects changed ' + change, () => {
  const h = harness({ hitTestSystem: () => null, projectSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) }); const n = nativeEvents(h);
  n.emit('pointermove', 100, 100, { buttons: 0 }); h.advance(301); h.hover('Origen', 100, 100);
  n.emit('pointerdown', 100, 100); n.emit('pointermove', 300, 200); n.emit('pointerup', 300, 200);
  if (change === 'epoch') h.world.epoch = 2;
  if (change === 'path') h.window.location = { pathname: '/game/galaxy/other' };
  if (change === 'origin') h.world.systems.shift();
  h.hover('Destino', 300, 200); h.tick(); assert.doesNotMatch(h.status, /Revisa/); assert.equal(h.calls.length, 0);
});
