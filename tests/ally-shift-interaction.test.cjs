'use strict';
// Real window-capture Shift handler -> actual imperial integration -> adapter/runtime.
// Event propagation, DOM and time are simulated; no browser, network or game orders.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { createRequire } = require('node:module');
const fixture = path.join(__dirname, 'empire-interaction.test.cjs'), input = fs.readFileSync(fixture, 'utf8');
const { harness, A, B } = Function('require', '__dirname', input.slice(0, input.indexOf('const canAct = h =>'))
  + '\nreturn { harness, A, B };')(createRequire(fixture), __dirname);
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const shift = source.slice(source.indexOf('// BEGIN SHIFT PRESETS'), source.indexOf('// END SHIFT PRESETS'));
function install(t, h, { throws = false } = {}) {
  const listeners = new Map();
  const window = { addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); } };
  class Element { constructor() { this.isConnected = true; this.dataset = {}; this.style = {}; }
    remove() { this.isConnected = false; } setAttribute() {} closest() { return null; } }
  class Canvas extends Element { constructor() { super(); this.id = 'stage'; } dispatchEvent(event) { event.target = this; dispatch(event); } }
  class PointerEvent { constructor(type, fields) { Object.assign(this, fields); this.type = type; this.isTrusted = false; }
    stopImmediatePropagation() { this.stopped = true; } preventDefault() { this.prevented = true; } }
  const canvas = new Canvas(), document = { head: { appendChild() {} }, createElement: () => new Element(),
    querySelector: () => null, querySelectorAll: () => [], body: { classList: { contains: () => false } } };
  function dispatch(event) {
    for (const listener of listeners.get(event.type) || []) { listener(event); if (event.stopped) break; }
    if (!event.stopped) h.event(event.type, 'game', event.isTrusted, event);
    return event;
  }
  const ctx = { window, document, AbortController, HTMLCanvasElement: Canvas, HTMLButtonElement: Element,
    HTMLDialogElement: Element, HTMLElement: Element, PointerEvent, performance: { now: () => h.clock },
    setTimeout() {}, clearTimeout() {}, cancelAnimationFrame() {} };
  vm.createContext(ctx); vm.runInContext(shift + '\nthis.factory = createShiftPresetMenu;', ctx);
  const callback = source.match(/onNativeInteraction: (event => empireAdapter\?\.observeInteraction\(event\)),/);
  assert.ok(callback, 'Production wiring must route to the actual adapter classifier');
  vm.runInContext('this.forwardShiftInteraction = ' + callback[1] + ';', h.ctx);
  let forwards = 0;
  const menu = ctx.factory({ onNativeInteraction(event) { forwards++; if (throws) throw new Error('Synthetic failure'); h.ctx.forwardShiftInteraction(event); } });
  t.after(() => menu.destroy());
  return { get forwards() { return forwards; },
    event(type = 'pointerdown', extra = {}) {
      return dispatch({ type, target: canvas, isTrusted: true, button: 0, pointerType: 'mouse', pointerId: 1,
        clientX: 10, clientY: 10, shiftKey: true, altKey: false, ctrlKey: false, metaKey: false,
        composedPath: () => [canvas, document, window], stopImmediatePropagation() { this.stopped = true; },
        preventDefault() { this.prevented = true; }, ...extra });
    } };
}
test('Shift held beyond cooldown revokes queued navigation before window capture swallows the gesture', async t => {
  const h = harness(t, { ids: [A, B] }), shortcut = install(t, h);
  h.event('keydown'); h.jump(16000); h.tick();
  const event = shortcut.event(); assert.equal(event.stopped, true); assert.equal(shortcut.forwards, 1);
  assert.equal(h.controller.state().pausedUntil, h.clock + 15000); assert.equal(h.adapter.canNavigate(), false);
  await h.microtasks(); assert.equal(h.clicks, 0); assert.equal(h.controller.state().manualHold, false);
  await h.advance(15250); assert.equal(h.controller.state().manualHold, false); assert.ok(h.clicks <= 1);
});
test('Shift during an imperial hop cancels both coordinators without a permanent hold', async t => {
  const h = harness(t, { ids: [A, B] }), shortcut = install(t, h);
  await h.advance(5001); assert.equal(h.clicks, 1); assert.equal(h.controller.state().moving, true);
  shortcut.event(); await h.advance(200);
  assert.equal(h.adapter.canNavigate(), false); assert.equal(h.controller.state().moving, false);
  assert.equal(h.controller.state().manualHold, false); assert.match(h.tick().status, /Pausa por interacción/);
});
test('synthetic and Helper-classified Shift input cannot create a cooldown', t => {
  const h = harness(t), shortcut = install(t, h);
  shortcut.event('pointerdown', { isTrusted: false });
  shortcut.event('pointerdown', { composedPath: () => [h.host, h.document] });
  assert.equal(h.controller.state().pausedUntil, 0); assert.equal(h.adapter.canNavigate(), true);
});
test('Shift drag replays native pointerdown without renewing the original deadline', async t => {
  const h = harness(t), shortcut = install(t, h);
  shortcut.event(); const deadline = h.controller.state().pausedUntil;
  await h.advance(3000); shortcut.event('pointermove', { clientX: 20 });
  assert.equal(shortcut.forwards, 1); assert.equal(h.controller.state().pausedUntil, deadline);
});
test('classifier callback failure leaves native input unconsumed and the document guard still pauses', async t => {
  const h = harness(t, { ids: [A, B] }), shortcut = install(t, h, { throws: true });
  h.jump(5000); h.tick(); const event = shortcut.event();
  assert.notEqual(event.stopped, true); assert.equal(h.controller.state().pausedUntil, h.clock + 15000);
  await h.microtasks(); assert.equal(h.clicks, 0);
});
test('a disposed imperial adapter cannot be revived by a retained shortcut callback', t => {
  const h = harness(t), shortcut = install(t, h); h.adapter.dispose();
  shortcut.event(); assert.equal(h.controller.state().pausedUntil, 0); assert.equal(h.adapter.canNavigate(), false);
});
