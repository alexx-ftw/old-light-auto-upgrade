'use strict';
// Offline DOM/interaction tests only; no native game or network calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const panel = require(process.env.QA_REINFORCEMENT_PANEL_SOURCE || '../docs/reinforcement-panel.js');
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
  get nextSibling() { const siblings = this.parentNode?.children || []; return siblings[siblings.indexOf(this) + 1] || null; }
  insertBefore(node, reference) { if (node === reference) return node; node.remove(); const index = reference === null ? this.children.length : this.children.indexOf(reference); if (index < 0) throw new Error('Unknown reference'); node.parentNode = this; this.children.splice(index, 0, node); return node; }
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
  const frames = new Map(); let frameId = 0, framesExecuted = 0;
  window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = id => frames.delete(id);
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
    get error() { return container.querySelector('.oldlight-route-error').textContent; },
    get status() { return container.querySelector('.oldlight-route-status').textContent; },
    advance: ms => { clock += ms; },
    get framesExecuted() { return framesExecuted; },
    frame: ms => { clock += ms; const tasks = [...frames.values()]; frames.clear(); for (const fn of tasks) { framesExecuted++; fn(clock - 1000); } },
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
function visibleGestureNotice(h) {
  const notice = h.document.querySelector('.oldlight-route-gesture-notice');
  assert.ok(notice, 'Ctrl outcome has its own visible notice');
  assert.ok(['status', 'alert'].includes(notice.getAttribute('role')), 'gesture notice is announced accessibly');
  assert.ok(notice.textContent.trim(), 'gesture notice explains the outcome');
  for (let node = notice; node; node = node.parentNode) {
    assert.notEqual(node.tagName, 'DETAILS', 'gesture notice stays outside collapsible details');
    assert.notEqual(node.hidden, true, 'notice ancestors remain visible');
    assert.notEqual(node.style?.display, 'none', 'notice ancestors are not display:none');
    assert.notEqual(node.style?.visibility, 'hidden', 'notice ancestors are not visibility:hidden');
  }
  return notice;
}
function assertManualDraft(h) {
  assert.equal(h.container.querySelector('.oldlight-route-editor').hidden, false, 'manual editor is reachable');
  for (const label of ['Sistema de origen', 'Sistema de destino']) {
    const select = h.field(label);
    assert.equal(select.value, '', label + ' requires an explicit choice');
    assert.ok(select.children.some(option => option.value === ''), label + ' has a real blank option');
  }
  assert.equal(h.calls.length, 0, 'opening a manual draft never sends or saves');
}
function assertPreview(h, from, to) {
  const overlay = h.document.querySelector('.oldlight-route-overlay');
  assert.notEqual(overlay.style.display, 'none', 'screen-space preview is visible during Ctrl drag');
  assert.notEqual(overlay.hidden, true);
  const lines = overlay.querySelectorAll('line').filter(line => line.getAttribute('data-preview') === 'true');
  assert.equal(lines.length, 1, 'one live preview, regardless of camera availability');
  const rect = h.canvas.getBoundingClientRect(), distance = Math.hypot(to.x - from.x, to.y - from.y);
  const padding = Math.min(9, distance / 4), dx = (to.x - from.x) / distance, dy = (to.y - from.y) / distance;
  for (const [attr, expected] of Object.entries({ x1: from.x - rect.left + dx * padding, y1: from.y - rect.top + dy * padding,
    x2: to.x - rect.left - dx * padding, y2: to.y - rect.top - dy * padding }))
    assert.ok(Math.abs(Number(lines[0].getAttribute(attr)) - expected) < .001, attr + ' follows pointer-down screen coordinates');
  return overlay;
}

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
  const h = harness(); h.world.systems[1].name = 'Origen'; h.hover('Origen', 100, 100); const down = h.gesture('pointerdown', 100, 100); assert.equal(down.prevented, true); visibleGestureNotice(h);
});
test('hover must be near actual mouse position; stale cards are rejected', () => {
  const h = harness(); h.hover('Origen', 100, 100); const down = h.gesture('pointerdown', 500, 500); assert.equal(down.prevented, true); visibleGestureNotice(h);
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
  assert.equal(overlay.style.zIndex, '0'); assert.equal(overlay.style.overflow, 'hidden'); assert.equal(overlay.getAttribute('pointer-events'), 'none');
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
  assert.equal(event.prevented, true); assertManualDraft(h); assert.equal(h.calls.length, 0);
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
  assertPreview(h, { x: 100, y: 100 }, { x: 300, y: 200 });
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
for (const kind of ['no-card', 'ambiguous', 'foreign', 'stale-position', 'no-dwell']) test('camera fallback rejects ' + kind + ' identity while reserving Ctrl intent before native input', () => {
  const h = harness({ hitTestSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) }); const n = nativeEvents(h);
  n.emit('pointermove', 100, 100, { buttons: 0 }); if (kind !== 'no-dwell') h.advance(301);
  if (kind !== 'no-card') h.hover(kind === 'foreign' ? 'Enemigo' : 'Origen', kind === 'stale-position' ? 500 : 100, 100);
  if (kind === 'ambiguous') h.world.systems[1].name = 'Origen';
  const e = n.emit('pointerdown', 100, 100); assert.equal(e.stopped, true); assert.equal(e.prevented, true); assert.equal(n.downs, 0);
  visibleGestureNotice(h); n.emit('mousedown', 100, 100); n.emit('pointermove', 300, 200);
  assertPreview(h, { x: 100, y: 100 }, { x: 300, y: 200 });
  h.hover('Destino', 300, 200); n.emit('pointerup', 300, 200); h.tick();
  assert.equal(n.pan, 0); assert.equal(n.clicks, 0); assertManualDraft(h); assert.equal(h.calls.length, 0);
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
  assert.equal(n.emit('pointerdown', 100, 100).stopped, true); assert.equal(n.downs, 0); visibleGestureNotice(h);
  n.emit('pointermove', 300, 200); h.hover('Destino', 300, 200); n.emit('pointerup', 300, 200); h.tick();
  assertManualDraft(h); assert.equal(n.pan, 0); assert.equal(h.calls.length, 0);
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

// Intent is reserved before identity/readiness checks. These rows independently
// vary the dependency, rather than requiring a fresh tooltip in every fixture.
for (const [reason, setup, expected] of [
  ['missing scope', h => { h.scope = ''; }, /cuenta|galaxia/i],
  ['disconnected census', h => { h.world.connected = false; }, /censo/i],
  ['incomplete census', h => { h.world.complete = false; }, /censo/i],
  ['stale census', h => { h.advance(120001); }, /censo/i],
  ['future census', h => { h.world.observedAt = 1001; }, /censo/i],
  ['wrong self identity', h => { h.world.selfId = 'other'; }, /censo/i],
  ['empty census', h => { h.world.systems = []; }, /censo/i],
  ['one own system', h => { h.world.systems.splice(1); }, /origen|sistema/i],
]) test('Ctrl intent reserves before ' + reason + ' and exposes the blocker outside closed details', () => {
  let interactions = 0;
  const h = harness({ hitTestSystem: () => null, projectSystem: () => null, getAvailability: () => ({ cameraAvailable: false }),
    onInteraction: event => { interactions++; assert.equal(event.prevented, true); assert.equal(event.stopped, true); } });
  setup(h); const n = nativeEvents(h), details = h.container.querySelector('details'); details.open = false;
  const down = n.emit('pointerdown', 100, 100);
  assert.equal(down.prevented, true); assert.equal(down.stopped, true); assert.equal(interactions, 1);
  assert.match(visibleGestureNotice(h).textContent, expected); assert.equal(details.open, false);
  assert.equal(n.emit('mousedown', 100, 100).prevented, true);
  n.emit('pointermove', 300, 200); assertPreview(h, { x: 100, y: 100 }, { x: 300, y: 200 });
  n.emit('pointerup', 300, 200); n.emit('mouseup', 300, 200); h.tick();
  assert.equal(n.pan, 0); assert.equal(n.downs, 0); assert.equal(n.clicks, 0); assert.equal(n.captures.size, 0);
  assert.equal(h.container.querySelector('.oldlight-route-editor').hidden, true); assert.equal(h.calls.length, 0);
  assert.match(visibleGestureNotice(h).textContent, /sistemas|censo|cuenta/i);
});

test('failed interaction preparation reserves Ctrl and offers only an explicit blank manual draft', () => {
  let attempted = 0;
  const h = harness({ hitTestSystem: p => p.x === 100 ? A : B, projectSystem: () => null,
    onInteraction: event => { attempted++; assert.equal(event.prevented, true); throw new Error('interruption failed'); } });
  const n = nativeEvents(h); n.emit('pointerdown', 100, 100);
  assert.equal(attempted, 1); assert.match(visibleGestureNotice(h).textContent, /preparar|manual/i);
  n.emit('pointermove', 300, 200); assertPreview(h, { x: 100, y: 100 }, { x: 300, y: 200 });
  n.emit('pointerup', 300, 200); assertManualDraft(h); assert.equal(n.pan, 0);
});

test('camera rejection still interrupts automatic navigation after reserving native down', () => {
  let interactions = 0;
  const h = harness({ hitTestSystem: () => null, getAvailability: () => ({ cameraAvailable: true }),
    onInteraction: event => { interactions++; assert.equal(event.prevented, true); assert.equal(event.stopped, true); } });
  const n = nativeEvents(h); n.emit('pointerdown', 100, 100); n.emit('mousedown', 100, 100);
  assert.equal(interactions, 1); n.emit('pointermove', 300, 200); n.emit('pointerup', 300, 200);
  assertManualDraft(h); assert.equal(n.pan, 0);
});

test('verified camera hit acquires immediately without native hover or dwell', () => {
  const h = harness({ hitTestSystem: p => p.x === 100 ? A : B, projectSystem: () => null,
    getAvailability: () => ({ cameraAvailable: true }) });
  const n = nativeEvents(h); assert.equal(h.document.querySelector('.star-hover'), null);
  const down = n.emit('pointerdown', 100, 100); assert.equal(down.stopped, true);
  n.emit('pointermove', 300, 200); assertPreview(h, { x: 100, y: 100 }, { x: 300, y: 200 });
  n.emit('pointerup', 300, 200);
  assert.equal(h.field('Sistema de origen').value, A); assert.equal(h.field('Sistema de destino').value, B);
  assert.equal(h.container.querySelector('.oldlight-route-editor').hidden, false); assert.equal(h.calls.length, 0); assert.equal(n.pan, 0);
});

test('camera-free live preview is screen-space while saved route arrows stay hidden', () => {
  const h = harness({ hitTestSystem: () => null, projectSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) });
  h.canvas.rect = { left: 20, top: 30, width: 800, height: 600, right: 820, bottom: 630 };
  h.routes = [{ id: 'saved-route', originId: A, destinationId: B, intervalMinutes: 5, ships: {}, paused: false }];
  h.hover('Origen', 110, 100); h.app.render(); h.hover('Destino', 300, 200); h.app.render();
  const overlay = h.document.querySelector('.oldlight-route-overlay'); assert.equal(overlay.style.display, 'none');
  const n = nativeEvents(h); n.emit('pointerdown', 100, 100); n.emit('pointermove', 350, 210);
  assertPreview(h, { x: 100, y: 100 }, { x: 350, y: 210 });
  assert.equal(overlay.querySelectorAll('line').filter(line => line.getAttribute('data-preview') !== 'true').length, 0);
  n.emit('pointerup', 350, 210); assert.equal(overlay.style.display, 'none'); assert.equal(overlay.querySelectorAll('line').length, 0);
  assertManualDraft(h); assert.equal(h.routes.length, 1);
});

test('live preview starts at actual pointer down rather than a projected system anchor', () => {
  const h = harness({ hitTestSystem: p => p.x === 100 ? A : B,
    projectSystem: system => ({ x: system.id === A ? 600 : 700, y: 500 }) });
  const n = nativeEvents(h); n.emit('pointerdown', 100, 100); n.emit('pointermove', 300, 200);
  assertPreview(h, { x: 100, y: 100 }, { x: 300, y: 200 });
});

test('unresolved origin draft requires both explicit choices and stays blank after a fresh census render', () => {
  const opened = [];
  const h = harness({ hitTestSystem: () => null, projectSystem: () => null, getAvailability: () => ({ cameraAvailable: false }), onOpen: data => opened.push(data) });
  const n = nativeEvents(h); n.emit('pointerdown', 100, 100); n.emit('pointermove', 300, 200); n.emit('pointerup', 300, 200);
  assertManualDraft(h); assert.deepEqual(opened, [{ originId: '', destinationId: '', routeId: null }]);
  h.field('Cantidad de Marauder').value = '5'; h.click('Crear ruta'); assert.equal(h.calls.length, 0);
  h.world.systems.push({ id: C, q: 15, r: 6, name: 'Tercero' }); h.app.render(); assertManualDraft(h);
  h.field('Sistema de origen').value = A; h.click('Crear ruta'); assert.equal(h.calls.length, 0);
  h.field('Sistema de destino').value = B; assert.equal(h.calls.length, 0); h.click('Crear ruta');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0][1].originId, A); assert.equal(h.calls[0][1].destinationId, B);
});

for (const kind of ['ordinary', 'Shift', 'Alt', 'Meta', 'touch', 'pen', 'untrusted', 'right-button', 'outside-target', 'outside-geometry', 'modal', 'ui-hidden', 'document-hidden', 'canvas-hidden', 'canvas-display-none', 'canvas-no-client-rects', 'zero-width', 'interaction-disabled']) test('Ctrl reservation leaves ' + kind + ' native input untouched', () => {
  const h = harness({ hitTestSystem: p => p.x === 100 ? A : B, ...(kind === 'interaction-disabled' ? { canInteract: () => false } : {}) });
  const n = nativeEvents(h), extra = {};
  if (kind === 'ordinary') extra.ctrlKey = false;
  if (kind === 'Shift') extra.shiftKey = true;
  if (kind === 'Alt') extra.altKey = true;
  if (kind === 'Meta') extra.metaKey = true;
  if (kind === 'touch' || kind === 'pen') extra.pointerType = kind;
  if (kind === 'untrusted') extra.isTrusted = false;
  if (kind === 'right-button') extra.button = 2;
  if (kind === 'outside-target') extra.target = h.container;
  if (kind === 'modal') { const dialog = h.document.createElement('dialog'); dialog.open = true; h.document.body.append(dialog); }
  if (kind === 'ui-hidden') h.document.body.classList.add('ui-hidden');
  if (kind === 'document-hidden') h.document.hidden = true;
  if (kind === 'canvas-hidden') h.canvas.hidden = true;
  if (kind === 'canvas-display-none') h.canvas.style.display = 'none';
  if (kind === 'canvas-no-client-rects') h.canvas.getClientRects = () => [];
  if (kind === 'zero-width') h.canvas.rect = { left: 100, top: 0, width: 0, height: 600, right: 100, bottom: 600 };
  const down = n.emit('pointerdown', kind === 'outside-geometry' ? 900 : 100, 100, extra);
  assert.notEqual(down.prevented, true); assert.notEqual(down.stopped, true);
  n.emit('pointermove', 300, 200, extra); n.emit('pointerup', 300, 200, extra);
  assert.equal(n.downs, kind === 'outside-target' ? 0 : 1); assert.equal(n.pan, kind === 'outside-target' ? 0 : 1);
  assert.equal(h.container.querySelector('.oldlight-route-editor').hidden, true); assert.equal(h.calls.length, 0);
});

for (const getter of ['getScope', 'getWorld', 'getRoutes', 'hitTestSystem', 'getAvailability']) test('Ctrl reservation reports a throwing ' + getter + ' without leaking native pan', () => {
  let armed = false;
  const values = { getScope: () => SCOPE, getWorld: () => null, getRoutes: () => [], hitTestSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) };
  const h = harness({ hitTestSystem: () => null, [getter]: (...args) => { if (armed) throw new Error('unavailable dependency'); return values[getter](...args); } });
  const n = nativeEvents(h); armed = true;
  let down; assert.doesNotThrow(() => { down = n.emit('pointerdown', 100, 100); });
  assert.equal(down.prevented, true); assert.equal(down.stopped, true); assert.match(visibleGestureNotice(h).textContent, /datos|detenido|recuper/i);
  assert.equal(n.emit('mousedown', 100, 100).prevented, true);
  n.emit('pointermove', 300, 200); n.emit('pointerup', 300, 200);
  assert.equal(n.downs, 0); assert.equal(n.pan, 0); assert.equal(n.clicks, 0); assert.equal(h.calls.length, 0);
  assert.equal(h.container.querySelector('.oldlight-route-editor').hidden, true);
});

for (const kind of ['Escape', 'Control', 'blur', 'pointercancel', 'outside', 'epoch', 'scope', 'path']) test('unresolved Ctrl intent cancels safely on ' + kind, () => {
  const h = harness({ hitTestSystem: () => null, projectSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) });
  const n = nativeEvents(h); n.emit('pointerdown', 100, 100); n.emit('pointermove', 300, 200);
  if (kind === 'Escape') h.window.dispatch('keydown', { key: 'Escape' });
  if (kind === 'Control') h.window.dispatch('keyup', { key: 'Control' });
  if (kind === 'blur' || kind === 'pointercancel') h.window.dispatch(kind);
  if (kind === 'outside') n.emit('pointermove', 900, 200);
  if (kind === 'epoch') h.world.epoch = 2;
  if (kind === 'scope') h.scope = 'beta/self';
  if (kind === 'path') h.window.location = { pathname: '/game/galaxy/other' };
  n.emit('pointerup', 300, 200); h.tick();
  assert.equal(h.container.querySelector('.oldlight-route-editor').hidden, true); assert.equal(h.calls.length, 0);
  assert.equal(h.document.querySelector('.oldlight-route-overlay').style.display, 'none');
  assert.equal(n.pan, 0); assert.equal(n.captures.size, 0);
});

test('unresolved Ctrl intent can use a newly fresh census only for a blank manual draft', () => {
  const h = harness({ hitTestSystem: () => null, projectSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) });
  h.world.complete = false; const n = nativeEvents(h);
  n.emit('pointerdown', 100, 100); n.emit('pointermove', 300, 200); h.world.complete = true;
  n.emit('pointerup', 300, 200); assertManualDraft(h); assert.equal(n.pan, 0);
});

test('new gesture notice is noninteractive outside a hidden Helper container and removed on destroy', () => {
  const h = harness({ hitTestSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) });
  h.container.hidden = true; const n = nativeEvents(h); n.emit('pointerdown', 100, 100);
  const notice = visibleGestureNotice(h); assert.equal(notice.style.pointerEvents, 'none'); assert.equal(h.container.contains(notice), false);
  h.app.destroy(); assert.equal(h.document.querySelector('.oldlight-route-gesture-notice'), null); assert.equal(n.captures.size, 0);
});

test('Ctrl intent without camera or tooltip never pans and opens an explicit manual draft', () => {
  const h = harness({ hitTestSystem: () => null, projectSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) });
  const n = nativeEvents(h);
  n.emit('pointerdown', 100, 100); n.emit('mousedown', 100, 100);
  n.emit('pointermove', 300, 200); n.emit('mousemove', 300, 200);
  n.emit('pointerup', 300, 200); n.emit('mouseup', 300, 200); h.tick();
  // Run the whole sequence before asserting: the same baseline probe records
  // actual simulated Pixi pan, rather than stopping at a missing interception.
  assert.equal(n.pan, 0, 'Ctrl route intent must never reach native pan');
  assert.equal(n.downs, 0); assert.equal(n.clicks, 0); assertManualDraft(h);
});
test('cancelling Ctrl removes the visible active-gesture instruction', () => {
  const h = harness({ hitTestSystem: () => null, getAvailability: () => ({ cameraAvailable: false }) }), n = nativeEvents(h);
  n.emit('pointerdown', 100, 100); n.emit('pointermove', 200, 100);
  const notice = h.document.querySelector('.oldlight-route-gesture-notice'); assert.equal(notice.hidden, false);
  h.window.dispatch('keyup', { key: 'Control' }); assert.equal(notice.hidden, true);
});
test('opening failure replaces the map notice with an actionable error', () => {
  const h = harness({ hitTestSystem: p => p.x === 100 ? A : B, onOpen() { throw new Error('probe'); } }), n = nativeEvents(h);
  n.emit('pointerdown', 100, 100); n.emit('pointermove', 300, 200); n.emit('pointerup', 300, 200);
  const notice = h.document.querySelector('.oldlight-route-gesture-notice'); assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /No se pudo mostrar/); assert.equal(h.calls.length, 0);
});

test('route review keeps conflicting route controls disabled while acknowledgement remains available', () => {
  const h=harness();create(h);h.routes[0].needsReview=true;h.routes[0].paused=true;h.app.render();
  for (const label of ['Editar','Reanudar','Eliminar']) assert.equal(byButton(h.container,label).disabled,true,label);
  assert.equal(byButton(h.container,'He revisado el envío').disabled,false);
  h.app.render();
  for (const label of ['Editar','Reanudar','Eliminar']) assert.equal(byButton(h.container,label).disabled,true,label+' after render');
  h.routes[0].needsReview=false;h.app.render();
  assert.equal(byButton(h.container,'Reanudar').disabled,false);
});


test('camera mismatch distinguishes static schematic from hidden main-map arrows and recovers hint', () => {
  let cameraAvailable = false;
  const h = harness({ projectSystem: () => null, getAvailability: () => ({ cameraAvailable, cameraReason: 'native-viewport-size-mismatch', cameraGeometry: {nativeWidth:1000.8,nativeHeight:700.8,cssWidth:1000.796875,cssHeight:700.796875} }) });
  create(h);
  assert.match(h.container.textContent, /Esquema de rutas · independiente de la cámara/);
  assert.match(h.container.textContent, /Flechas del mapa principal ocultas: el tamaño de la cámara no coincide con el lienzo/);
  assert.match(h.container.textContent, /El esquema de arriba sigue disponible/);
  assert.match(h.container.textContent, /Cámara 1000.8 × 700.8; lienzo 1000.7969 × 700.7969 px CSS/);
  assert.equal(h.container.querySelector('.oldlight-route-map').querySelectorAll('line').length, 1);
  cameraAvailable = true; h.app.render();
  assert.doesNotMatch(h.container.textContent, /native-viewport-size-mismatch|flechas están detenidas/);
  assert.match(h.container.textContent, /siguen la cámara y el zoom/);
  h.app.destroy();
});

test('route card explains current wait and check time without replacing controls or issuing actions', () => {
  let checks = {routes:[{id:'route-1',code:'hud',message:'Abre Structures o Shipyard para continuar.',checkedAt:1000,lastSentAt:null,nextRunAt:1000}]};
  const h = harness({getDiagnostics:()=>checks}); create(h);
  assert.match(h.container.textContent, /Abre Structures o Shipyard/);
  assert.match(h.container.textContent, /Comprobación local:/);
  assert.match(h.container.textContent, /Último envío confirmado: ninguno registrado/);
  const edit = byButton(h.container, 'Editar'), calls = h.calls.length;
  checks = {routes:[{...checks.routes[0],code:'no-ships',message:'Sin naves disponibles tras la reserva.',checkedAt:2000}]};
  h.app.render();
  assert.match(h.container.textContent, /Sin naves disponibles tras la reserva/);
  assert.doesNotMatch(h.container.textContent, /Abre Structures o Shipyard/);
  assert.equal(byButton(h.container, 'Editar'), edit);
  assert.equal(h.calls.length, calls);
  h.app.destroy();
});

test('route countdown updates to expiry without replacing controls and pauses explicitly',()=>{
 const h=harness();create(h);h.routes[0].nextRunAt=16000;h.app.render();
 const edit=byButton(h.container,'Editar');assert.match(h.container.textContent,/Próxima comprobación en 00:00:15/);
 h.advance(1000);h.app.render();assert.match(h.container.textContent,/00:00:14/);assert.equal(byButton(h.container,'Editar'),edit);
 h.advance(14000);h.app.render();assert.match(h.container.textContent,/Intervalo vencido/);assert.equal(h.calls.length,1);
 h.click('Pausar');assert.match(h.container.textContent,/Cuenta atrás suspendida/);assert.equal(byButton(h.container,'Enviar ahora').disabled,true);
 h.click('Reanudar');assert.match(h.container.textContent,/Intervalo vencido/);h.app.destroy();
});
test('floating route control follows projections, opens summary and preserves repeated-open drafts',()=>{
 let shift=0,scale=1,available=true;
 const h=harness({projectSystem:s=>available?{x:150+s.q*20*scale+shift,y:150+s.r*20*scale,visible:true}:null});create(h);
 let marker=h.document.querySelector('.oldlight-route-markers').querySelector('button');assert.ok(marker);
 assert.equal(marker.style.pointerEvents,'auto');assert.equal(h.app.containsControl(marker),true);
 const x=marker.style.left;shift=40;h.app.render();assert.equal(h.document.querySelector('.oldlight-route-markers').querySelector('button'),marker);assert.notEqual(marker.style.left,x);
 marker.dispatch('click');assert.equal(h.field('Sistema de origen').value,A);assert.equal(h.field('Sistema de destino').value,B);
 h.field('Intervalo en minutos').value='27';marker.dispatch('click');assert.equal(h.field('Intervalo en minutos').value,'27');assert.equal(h.calls.length,1);
 const beforeZoom=marker.style.left;scale=1.4;h.app.render();assert.notEqual(marker.style.left,beforeZoom);assert.equal(h.document.querySelector('.oldlight-route-markers').querySelector('button'),marker);
 h.window.dispatch('pointerdown',{target:marker});h.window.dispatch('click',{target:marker});assert.equal(marker.parentNode!==null,true);
 available=false;h.app.render();assert.equal(h.document.querySelector('.oldlight-route-markers').hidden,true);
 available=true;h.app.render();assert.equal(h.document.querySelector('.oldlight-route-markers').hidden,false);
 h.scope='other/self';h.app.render();assert.equal(h.document.querySelector('.oldlight-route-markers').hidden,true);
 const before=h.calls.length;marker.dispatch('click');assert.equal(h.calls.length,before);h.app.destroy();assert.equal(h.document.querySelector('.oldlight-route-markers'),null);
});
test('send now requires explicit trusted click and double activation cannot duplicate pending action',()=>{
 let resolve,calls=0;
 const h=harness({onSendNow:()=>{calls++;return new Promise(r=>resolve=r);}});create(h);
 const button=byButton(h.container,'Enviar ahora');button.dispatch('click',{isTrusted:false});assert.equal(calls,0);
 button.dispatch('click');button.dispatch('click');assert.equal(calls,1);assert.equal(button.disabled,true);
 resolve({ok:true});h.app.destroy();
});
test('multiple route markers open their own endpoints and keep rendering below native controls',()=>{
 const h=harness({projectSystem:s=>({x:150+s.q*15,y:150+s.r*15,visible:true})});create(h);
 h.routes.push({...h.routes[0],id:'route-2',originId:B,destinationId:A});h.app.render();
 const markers=h.document.querySelector('.oldlight-route-markers'),buttons=markers.querySelectorAll('button');assert.equal(buttons.length,2);
 buttons[1].dispatch('click');assert.equal(h.field('Sistema de origen').value,B);assert.equal(h.field('Sistema de destino').value,A);
 assert.equal(markers.style.zIndex,'0');assert.equal(markers.style.pointerEvents,'none');assert.equal(markers.nextSibling,h.canvas);
 h.app.destroy();
});

test('floating route control contains keydown and keypress but preserves native key release',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../old-light-auto-upgrade.user.js'),'utf8');
 const first=source.indexOf('// BEGIN HELPER KEYBOARD BOUNDARY'),last=source.indexOf('// END HELPER KEYBOARD BOUNDARY',first);
 const context=require('node:vm').createContext({});require('node:vm').runInContext(source.slice(first,last)+';this.install=installHelperKeyboardBoundary;',context);
 assert.match(source,/onControlRoot: installHelperKeyboardBoundary/);
 const h=harness({onControlRoot:context.install,projectSystem:s=>({x:150+s.q*20,y:150+s.r*20,visible:true})});create(h);
 const markers=h.document.querySelector('.oldlight-route-markers'),marker=markers.querySelector('button');
 let stopped=0;
 for(const name of ['keydown','keypress'])markers.dispatch(name,{target:marker,key:'g',stopPropagation(){stopped++;}});
 assert.equal(stopped,2,'focused route control cannot bubble game shortcuts');
 markers.dispatch('keyup',{target:marker,key:'w',stopPropagation(){stopped++;}});
 assert.equal(stopped,2,'held native movement keys must still be released');
 assert.equal(h.calls.length,1);h.app.destroy();
});

test('hovering floating route control does not clear arrow or marker on native canvas leave',()=>{
 let shift=0;
 const h=harness({projectSystem:s=>({x:150+s.q*20+shift,y:150+s.r*20,visible:true})});create(h);
 const overlay=h.document.querySelector('.oldlight-route-overlay'),line=overlay.querySelector('line');
 const layer=h.document.querySelector('.oldlight-route-markers'),marker=layer.querySelector('button');assert.ok(marker);assert.ok(line);
 for(let i=0;i<20;i++){
  h.window.dispatch('pointerleave',{target:h.canvas,relatedTarget:marker});
  assert.equal(overlay.querySelector('line'),line,'entering marker cannot delete the arrow and trigger hit-test oscillation');
  assert.equal(marker.parentNode,layer);assert.equal(layer.hidden,false);
  h.advance(500);h.world.observedAt+=500;h.app.render();
  assert.equal(overlay.querySelector('line'),line);assert.equal(layer.querySelector('button'),marker);
 }
 const before=line.getAttribute('x1');shift=40;h.app.render();assert.notEqual(overlay.querySelector('line').getAttribute('x1'),before,'actual camera movement still reprojects');
 h.app.destroy();
});

test('bounded visual census gap preserves unchanged arrow but disables marker and all authority reads stay unavailable',()=>{
 let pending=false,shift=0,opens=0;
 const h=harness({isCensusPending:()=>pending,onOpen:()=>opens++,projectSystem:s=>({x:150+s.q*20+shift,y:150+s.r*20,visible:true})});create(h);
 const world=h.world,overlay=h.document.querySelector('.oldlight-route-overlay'),line=overlay.querySelector('line');
 const marker=h.document.querySelector('.oldlight-route-markers').querySelector('button');
 pending=true;h.world=null;h.app.render();
 assert.equal(overlay.querySelector('line'),line);assert.notEqual(overlay.style.display,'none');assert.equal(marker.disabled,true);
 assert.equal(overlay.getAttribute('data-census-pending'),'true');marker.dispatch('click');assert.equal(opens,1,'only initial create opened editor');
 h.advance(80);h.app.render();assert.equal(overlay.querySelector('line'),line);
 pending=false;world.observedAt+=80;h.world=world;h.app.render();assert.equal(overlay.querySelector('line'),line);assert.equal(marker.disabled,false);
 pending=true;h.world=null;h.app.render();h.advance(101);h.app.render();assert.equal(overlay.style.display,'none','unsettled gap cannot retain visual indefinitely');
 pending=false;world.observedAt+=101;h.world=world;h.app.render();assert.notEqual(overlay.style.display,'none');
 pending=true;h.world=null;shift=10;h.app.render();assert.equal(overlay.style.display,'none','camera changes cannot retain old geometry');
 h.app.destroy();
});
for(const change of ['scope','pause','viewport','camera unavailable'])test('visual gap drops cached decoration on '+change,()=>{
 let pending=false,available=true;
 const h=harness({isCensusPending:()=>pending,projectSystem:s=>available?{x:150+s.q*20,y:150+s.r*20,visible:true}:null});create(h);
 pending=true;h.world=null;
 if(change==='scope')h.scope='other/self';if(change==='pause')h.routes[0].paused=true;
 if(change==='viewport')h.canvas.rect={left:0,top:0,width:700,height:600,right:700,bottom:600};
 if(change==='camera unavailable')available=false;
 h.app.render();assert.equal(h.document.querySelector('.oldlight-route-overlay').style.display,'none');h.app.destroy();
});

test('authoritative loss of route endpoint after visual gap immediately removes decoration',()=>{
 let pending=false;
 const h=harness({isCensusPending:()=>pending,projectSystem:s=>({x:150+s.q*20,y:150+s.r*20,visible:true})});create(h);
 const world=h.world;pending=true;h.world=null;h.app.render();
 assert.notEqual(h.document.querySelector('.oldlight-route-overlay').style.display,'none');
 pending=false;world.systems=world.systems.filter(s=>s.id!==B);h.world=world;h.app.render();
 assert.equal(h.document.querySelector('.oldlight-route-overlay').style.display,'none');
 assert.equal(h.document.querySelector('.oldlight-route-markers').hidden,true);h.app.destroy();
});


test('helper scroll and wheel preserve continuous arrow DOM across frames census updates pointer and editor activity', () => {
  const host = {}, h = harness({ isHelperEvent: event => event.composedPath?.().includes(host) === true,
    projectSystem: s => ({ x: 150 + s.q * 20, y: 150 + s.r * 20, visible: true }) }); create(h);
  const overlay = h.document.querySelector('.oldlight-route-overlay'), line = overlay.querySelector('line');
  const layer = h.document.querySelector('.oldlight-route-markers'), marker = layer.querySelector('button');
  const root = h.container.querySelector('.oldlight-routes'); let replacements = 0;
  const replace = overlay.replaceChildren.bind(overlay); overlay.replaceChildren = (...nodes) => { replacements++; replace(...nodes); };
  const states = [];
  for (let i = 0; i < 120; i++) {
    h.world = { ...h.world, revision: i + 1, observedAt: 1000 + i * 16 };
    const target = i % 3 === 0 ? root : i % 3 === 1 ? marker : host;
    h.window.dispatch(i % 2 ? 'wheel' : 'scroll', { target, composedPath: () => [target, host] });
    states.push(overlay.style.display !== 'none' && overlay.querySelector('line') === line);
    h.window.dispatch('pointerleave', { target: h.canvas, relatedTarget: marker });
    h.hover(i % 2 ? 'Origen' : 'Destino', 150, 150);
    if (i % 15 === 0) { marker.dispatch('click'); h.app.render(); }
    h.frame(16);
    states.push(overlay.style.display !== 'none' && overlay.querySelector('line') === line);
    assert.ok(layer.querySelector('button') === marker, 'Marker keeps identity across helper events');
  }
  assert.equal(h.framesExecuted, 120, 'A temporal claim requires executed rAF callbacks, not just requested frames');
  assert.equal(states.length, 240); assert.ok(states.every(Boolean), 'No hidden frame or SVG replacement while verified geometry stays equal');
  assert.equal(replacements, 0); assert.equal(h.calls.filter(call => call[0] === 'save').length, 1);
  h.app.destroy();
});

test('helper scroll still cancels an active drag and invalid camera or census hides the persisted arrow', () => {
  let camera = true;
  const h = harness({ projectSystem: s => camera ? { x: 150 + s.q * 20, y: 150 + s.r * 20, visible: true } : null }); create(h);
  const root = h.container.querySelector('.oldlight-routes'), overlay = h.document.querySelector('.oldlight-route-overlay');
  h.gesture('pointerdown', 150, 150); h.gesture('pointermove', 220, 180);
  h.window.dispatch('scroll', { target: root });
  assert.equal(overlay.style.display, 'none'); assert.equal(overlay.querySelectorAll('line').length, 0);
  h.app.render(); camera = false; h.window.dispatch('scroll', { target: root });
  assert.equal(overlay.style.display, 'none', 'Helper scroll cannot mask an unavailable camera');
  camera = true; h.app.render(); h.world = null; h.window.dispatch('wheel', { target: root });
  assert.equal(overlay.style.display, 'none', 'Helper event must not retain a cached authoritative census');
  assert.equal(h.calls.filter(call => call[0] === 'save').length, 1); h.app.destroy();
});

test('map wheel and genuine camera movement keep invalidation and reprojection during helper scroll recovery', () => {
  let shift = 0;
  const h = harness({ projectSystem: s => ({ x: 150 + s.q * 20 + shift, y: 150 + s.r * 20, visible: true }) }); create(h);
  const root = h.container.querySelector('.oldlight-routes'), overlay = h.document.querySelector('.oldlight-route-overlay');
  const previous = overlay.querySelector('line').getAttribute('x1');
  h.window.dispatch('wheel', { target: h.canvas }); assert.equal(overlay.style.display, 'none');
  shift = 30; h.frame(80); assert.notEqual(overlay.querySelector('line').getAttribute('x1'), previous);
  shift = 50; h.window.dispatch('scroll', { target: root });
  assert.notEqual(overlay.querySelector('line').getAttribute('x1'), previous);
  h.document.hidden = true; h.window.dispatch('scroll', { target: root }); assert.equal(overlay.style.display, 'none');
  h.app.destroy();
});


test('production helper event boundary recognizes the Shadow DOM host and rejects unrelated targets', () => {
  const fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
  const integration = source.slice(source.indexOf('    reinforcementPanel = globalThis.OldLightReinforcementPanel.create('));
  const expression = integration.match(/isHelperEvent: (event => [^\n]+),\n/)[1];
  const host = {}, unrelated = {};
  const boundary = new Function('host', `return (${expression});`)(host);
  assert.equal(boundary({ target: host, composedPath: () => [host] }), true);
  assert.equal(boundary({ target: unrelated, composedPath: () => [unrelated] }), false);
  assert.equal(boundary({ target: unrelated }), false);
});

test('temporal census gaps tooltip changes and zoom preserve only valid decoration and revoke prolonged gaps', () => {
  let pending = false, shift = 0, camera = true;
  const h = harness({ isCensusPending: () => pending,
    projectSystem: s => camera ? { x: 150 + s.q * 20 + shift, y: 150 + s.r * 20, visible: true } : null }); create(h);
  const root = h.container.querySelector('.oldlight-routes'), overlay = h.document.querySelector('.oldlight-route-overlay');
  let world = h.world, visible = 0;
  for (let i = 0; i < 240; i++) {
    pending = i % 60 >= 20 && i % 60 < 24;
    world = { ...world, observedAt: 1000 + i * 16, revision: i + 1 };
    h.world = pending ? null : world;
    if (i % 60 === 40) shift += 10; // A newly verified camera position; no stale geometry is retained.
    h.hover(i % 2 ? 'Origen' : 'Destino', 150, 150);
    h.window.dispatch('scroll', { target: root });
    h.app.render(); h.frame(16);
    assert.notEqual(overlay.style.display, 'none', `Valid geometry or bounded pending delivery remains visible at frame ${i}`);
    visible++;
  }
  assert.equal(h.framesExecuted, 240, 'Every requested simulation step must execute its queued rAF callback');
  assert.equal(visible, 240);
  pending = true; h.world = null; h.app.render(); h.advance(101); h.app.render();
  assert.equal(overlay.style.display, 'none', 'A prolonged unsettled census still removes decoration');
  pending = false; h.world = world; h.app.render(); camera = false;
  h.window.dispatch('scroll', { target: root }); assert.equal(overlay.style.display, 'none');
  h.app.destroy();
});


test('local visual diagnostics record categorical movement and census cadence without payloads or authority', () => {
  let camera = true, pending = false;
  const h = harness({ scriptVersion: '1.17.16', isCensusPending: () => pending,
    getAvailability: () => ({ cameraAvailable: camera, cameraReason: camera ? '' : 'camera-observation-pending' }),
    projectSystem: system => camera ? { x: 150 + system.q * 20, y: 150 + system.r * 20, visible: true } : null }); create(h);
  const root = h.container.querySelector('.oldlight-routes'), world = h.world;
  const initialChanges = h.app.getVisualDiagnostics().counts.censusChanges || 0;
  for (let i = 0; i < 20; i++) {
    h.world = { ...world, revision: i + 1, generation: 'PRIVATE_GENERATION', observedAt: 1000 + i * 16 };
    camera = i % 2 === 0; h.app.render(); h.frame(16);
    h.window.dispatch('scroll', { target: root });
  }
  const state = h.app.getVisualDiagnostics();
  assert.equal(state.scriptVersion, '1.17.16'); assert.equal(state.cameraState, 'pending-delivery-or-change');
  assert.ok(state.counts.hiddenTransitions > 0 && state.counts.visibleTransitions > 0);
  assert.ok(state.transitionReasons['projection-unavailable'] > 0);
  assert.equal(state.counts.rafCallbacks, 20); assert.equal(state.counts.censusChanges - initialChanges, 20);
  assert.equal(state.counts['event:scroll:helper'], 20);
  assert.ok(state.intervals.censusChanges.some(value => value > 0));
  const text = JSON.stringify(state); assert.ok(text.length < 6000);
  for (const value of [A, B, SCOPE, 'PRIVATE_GENERATION', 'Origen', 'Destino']) assert.ok(!text.includes(value), value);
  assert.equal(state.recentTransitions.length, 12);
  assert.ok(state.recentTransitions.every(item => Object.keys(item).sort().join(',') === 'reason,visible'));
  const before = JSON.stringify(h.routes), calls = h.calls.length;
  h.click('Ver diagnóstico local de flechas');
  const output = byLabel(h.container, 'Diagnóstico local de flechas'); assert.equal(output.hidden, false);
  assert.equal(JSON.parse(output.textContent).counts.rafCallbacks, 20);
  assert.equal(JSON.stringify(h.routes), before); assert.equal(h.calls.length, calls);
  state.recentTransitions.length = 0; state.counts.rafCallbacks = 999;
  assert.equal(h.app.getVisualDiagnostics().counts.rafCallbacks, 20, 'Report is a detached snapshot');
  h.app.destroy();
});

test('local visual diagnostics tolerate clock reversal and never export raw camera reasons or errors', () => {
  const h = harness({ scriptVersion: 'not-a-version PRIVATE_VALUE', getAvailability: () => ({ cameraAvailable: false, cameraReason: 'PRIVATE_REASON' }),
    projectSystem: () => null, getError: () => 'PRIVATE_ERROR' });
  h.app.render(); h.frame(16); h.advance(-100); h.app.render(); h.frame(16);
  const report = h.app.getVisualDiagnostics(), text = JSON.stringify(report);
  assert.equal(report.scriptVersion, 'unknown'); assert.equal(report.cameraState, 'unavailable');
  assert.ok(!text.includes('PRIVATE_')); assert.ok(Object.values(report.intervals).flat().every(Number.isSafeInteger));
  h.app.destroy();
});
