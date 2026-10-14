'use strict';

// Offline regression tests: real production boundary/drag functions run against
// a phase-aware event model and a fixture of the observed native shortcut code.
// Default editing callbacks and IME events are simulated, not browser/Drive QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { Element, Event, dispatch, createDOM, installNativeShortcuts } = require('./helper-keyboard.fixture.cjs');
const sourcePath = process.env.QA_HELPER_KEYBOARD_SOURCE || path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const boundaryStart = source.indexOf('  // BEGIN HELPER KEYBOARD BOUNDARY');
const boundaryEnd = source.indexOf('  // END HELPER KEYBOARD BOUNDARY');
// A missing installer is a deliberate no-op so the SAME behavioral regression
// fails on a pre-fix source, rather than aborting on a missing symbol.
const boundarySource = boundaryStart >= 0 && boundaryEnd > boundaryStart
  ? source.slice(boundaryStart, boundaryEnd) : 'function installHelperKeyboardBoundary() {}';
const dragStart = source.indexOf('  function bindPointerDrag(');
const dragEnd = source.indexOf('\n  function installHelperDragging(', dragStart);
assert.ok(dragStart >= 0 && dragEnd > dragStart, 'Production drag function must be extractable');

function harness({ boundary = true, nativeFirst = true } = {}) {
  const dom = createDOM();
  let native;
  if (nativeFirst) native = installNativeShortcuts(dom.window, dom.document);
  const context = vm.createContext({ window: dom.window, document: dom.document });
  vm.runInContext(boundarySource + source.slice(dragStart, dragEnd)
    + '\nthis.api = { installHelperKeyboardBoundary, bindPointerDrag };', context);
  const host = new Element('DIV', dom.document.body, 'helper-host');
  const root = host.attachShadow({ mode: 'open' });
  const form = new Element('FORM', root, 'helper-form');
  const input = new Element('INPUT', form, 'helper-input');
  const button = new Element('BUTTON', form, 'helper-button');
  const canvas = new Element('CANVAS', dom.document.body, 'game-canvas');
  if (boundary) context.api.installHelperKeyboardBoundary(root);
  if (!nativeFirst) native = installNativeShortcuts(dom.window, dom.document);
  return { ...dom, ...context.api, native, host, root, form, input, button, canvas,
    key(target, key, fields = {}, defaultAction) {
      const event = new Event('keydown', { key, ...fields });
      dispatch(target, event, defaultAction);
      return event;
    },
    event(target, type, fields = {}, defaultAction) {
      const event = new Event(type, fields);
      dispatch(target, event, defaultAction);
      return event;
    } };
}

function installActualShiftKeyboardHandlers(h) {
  const shiftStart = source.indexOf('  // BEGIN SHIFT PRESETS');
  const shiftEnd = source.indexOf('  // END SHIFT PRESETS', shiftStart);
  assert.ok(shiftStart >= 0 && shiftEnd > shiftStart, 'Production Shift preset block is present');
  const shift = source.slice(shiftStart, shiftEnd);
  const localStart = shift.indexOf("      shadow.addEventListener('keydown', event => {");
  const localEnd = shift.indexOf('      current.radial.appendChild(host);', localStart);
  const captureStart = shift.indexOf("    on(window, 'keydown', event => {");
  const captureEnd = shift.indexOf("    on(window, 'pointercancel',", captureStart);
  const inMenu = shift.match(/    const inMenu = event => [^\n]+;/)?.[0];
  assert.ok(localStart >= 0 && localEnd > localStart && captureStart >= 0
    && captureEnd > captureStart && inMenu, 'Extract the real Shift local and capture keyboard handlers');
  const state = { focused: [], scrolled: [], cancellations: 0, escapedNativeMenus: 0, clicks: 0 };
  const current = { host: h.host, shadow: h.root, items: [] };
  current.items = Array.from({ length: 8 }, (_, index) => {
    const item = new Element('BUTTON', h.form, 'preset-' + (index + 1));
    item.disabled = index === 1 || index === 5;
    item.focus = options => { state.focused.push([index, options.preventScroll]); h.focus(item); };
    item.scrollIntoView = options => state.scrolled.push([index, options.block]);
    item.click = () => state.clicks++;
    return item;
  });
  const context = vm.createContext({ window: h.window, shadow: h.root, current,
    flow: current, replaying: false,
    on: (target, type, handler, options) => target.addEventListener(type, handler, options),
    cancel: () => { state.cancellations++; context.flow = null; },
    escapeNativeMenus: () => state.escapedNativeMenus++,
  });
  // These are the production handler registrations, not rewritten equivalents.
  // Menu lifecycle, focus, scrolling and cancellation effects stay local stubs.
  vm.runInContext(inMenu + '\n' + shift.slice(localStart, localEnd)
    + '\n' + shift.slice(captureStart, captureEnd), context);
  return { state, current, context };
}

test('control: native window handler sees DIV instead of INPUT without a shadow boundary', () => {
  const h = harness({ boundary: false }), order = [];
  for (const [node, label] of [[h.window, 'window'], [h.document, 'document'], [h.host, 'host'], [h.root, 'shadow'], [h.input, 'input']]) {
    node.addEventListener('keydown', event => order.push(`${label}:capture:${event.target.tagName || 'root'}:${event.eventPhase}`), true);
    node.addEventListener('keydown', event => order.push(`${label}:bubble:${event.target.tagName || 'root'}:${event.eventPhase}`));
  }
  let defaults = 0;
  const event = h.key(h.input, 'G', {}, () => defaults++);
  assert.deepEqual(order, [
    'window:capture:DIV:1', 'document:capture:DIV:1', 'host:capture:DIV:2',
    'shadow:capture:INPUT:1', 'input:capture:INPUT:2', 'input:bubble:INPUT:2',
    'shadow:bubble:INPUT:3', 'host:bubble:DIV:2', 'document:bubble:DIV:3', 'window:bubble:DIV:3',
  ]);
  assert.equal(h.native.keydowns[0].target, h.host);
  assert.deepEqual(h.native.actions, ['galaxy-map']);
  assert.equal(event.defaultPrevented, true);
  assert.equal(defaults, 0, 'Native G preventDefault blocks the simulated text default');
});

test('typing G in Helper shadow input does not trigger the native galaxy-map shortcut', () => {
  const h = harness();
  let targetCalls = 0;
  h.input.addEventListener('keydown', event => { targetCalls++; assert.equal(event.target, h.input); });
  const event = h.key(h.input, 'G', {}, () => { h.input.value += 'G'; });
  assert.deepEqual(h.native.actions, [], 'Typing G must not open the native galaxy map');
  assert.equal(h.native.keydowns.length, 0);
  assert.equal(targetCalls, 1);
  assert.equal(event.defaultPrevented, false);
  assert.equal(h.input.value, 'G', 'The simulated browser text default remains allowed');
});

test('production wiring installs at all four ShadowRoots and both Helper dialog roots', () => {
  assert.ok(boundaryStart >= 0 && boundaryEnd > boundaryStart, 'Boundary production block is present');
  const sites = [...source.matchAll(/const (\w+) = \w+\.attachShadow\(\{ mode: 'open' \}\);/g)];
  assert.equal(sites.length, 4, 'main panel, Shift menu, fleet editor and mission offer');
  for (const site of sites) {
    assert.match(source.slice(site.index + site[0].length, site.index + site[0].length + 100),
      new RegExp('^\\s*installHelperKeyboardBoundary\\(' + site[1] + '\\);'), site[0]);
  }
  for (const id of ['oldlight-fleet-editor-dialog', 'oldlight-preset-shortage-dialog']) {
    assert.match(source, new RegExp("dialog.id = '" + id + "';\\s*installHelperKeyboardBoundary\\(dialog\\);"));
  }
});

test('all Helper control types contain keydown without suppressing target handlers or defaults', () => {
  const h = harness();
  for (const type of ['INPUT', 'TEXTAREA', 'contenteditable', 'SELECT', 'BUTTON', 'focusable DIV']) {
    const control = new Element(type === 'contenteditable' || type === 'focusable DIV' ? 'DIV' : type, h.form);
    control.isContentEditable = type === 'contenteditable';
    let calls = 0, defaults = 0;
    control.addEventListener('keydown', () => calls++);
    for (const key of ['g', 'G', 'w', 'a', 's', 'd', 'Escape', 'Tab', 'Enter', ' ', 'ArrowDown']) {
      const event = h.key(control, key, {}, () => defaults++);
      assert.equal(event.defaultPrevented, false, `${type}: ${key}`);
    }
    assert.equal(calls, 11, type);
    assert.equal(defaults, 11, type);
  }
  assert.equal(h.native.keydowns.length, 0);
  assert.deepEqual(h.native.actions, []);
  assert.equal(h.native.held.size, 0);
  assert.equal(h.native.escapes, 0);
});

test('boundary works regardless of native bubble listener registration order', () => {
  for (const nativeFirst of [true, false]) {
    const h = harness({ nativeFirst });
    h.key(h.input, 'g');
    assert.equal(h.native.keydowns.length, 0, String(nativeFirst));
  }
});

test('stopPropagation preserves earlier and later same-root handlers and target-to-root order', () => {
  const h = harness({ boundary: false }), order = [];
  h.input.addEventListener('keydown', () => order.push('target capture'), true);
  h.input.addEventListener('keydown', () => order.push('target bubble'));
  h.form.addEventListener('keydown', () => order.push('local form'));
  h.root.addEventListener('keydown', () => order.push('root before'));
  h.installHelperKeyboardBoundary(h.root);
  h.root.addEventListener('keydown', () => order.push('root after'));
  h.document.addEventListener('keydown', () => order.push('document bubble'));
  const event = h.key(h.input, 'g');
  assert.deepEqual(order, ['target capture', 'target bubble', 'local form', 'root before', 'root after']);
  assert.equal(event.stopCalls, 1);
  assert.equal(event.immediateStopCalls, 0);
  assert.equal(event.preventCalls, 0);
});

test('explicit limitation: arbitrary earlier capture handlers still observe Helper keyboard events', () => {
  const h = harness({ boundary: false }), seen = [];
  let earlierCaptureAction = 0;
  h.window.addEventListener('keydown', event => {
    earlierCaptureAction++;
    seen.push(['window', event.target, event.composedPath()[0]]);
  }, true);
  h.document.addEventListener('keydown', event => seen.push(['document', event.target, event.composedPath()[0]]), true);
  h.installHelperKeyboardBoundary(h.root);
  h.key(h.input, 'g');
  assert.equal(earlierCaptureAction, 1, 'A bubble boundary cannot undo arbitrary capture shortcuts');
  assert.deepEqual(seen, [['window', h.host, h.input], ['document', h.host, h.input]]);
  assert.equal(h.native.keydowns.length, 0, 'Only the known native bubble shortcut is contained');
});

test('keypress is contained but keyup and non-keyboard input events remain observable', () => {
  const h = harness(), page = [];
  for (const type of ['keypress', 'keyup', 'beforeinput', 'input', 'change', 'click']) {
    h.window.addEventListener(type, event => page.push(event.type));
    const event = h.event(h.input, type, { key: 'g' });
    assert.equal(event.defaultPrevented, false, type);
  }
  assert.deepEqual(page, ['keyup', 'beforeinput', 'input', 'change', 'click']);
  assert.equal(h.native.keyups[0].target, h.host);
});

test('Ctrl/Cmd editing chords, navigation and selection keep their default callbacks', () => {
  const h = harness(), completed = [];
  h.input.value = 'Unchanged by the boundary';
  for (const modifier of ['ctrlKey', 'metaKey']) for (const key of ['a', 'c', 'x', 'v', 'z', 'y', 'ArrowLeft', 'ArrowRight', 'Backspace']) {
    const event = h.key(h.input, key, { [modifier]: true }, () => completed.push(`${modifier}:${key}`));
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.preventCalls, 0);
  }
  h.key(h.input, 'ArrowLeft', { shiftKey: true }, () => completed.push('selection'));
  assert.equal(completed.length, 19, 'Callbacks represent browser defaults, not a real clipboard implementation');
  assert.equal(h.input.value, 'Unchanged by the boundary');
  assert.equal(h.native.keydowns.length, 0);
});

test('IME composition and input payloads pass unchanged while composing keydowns are contained', () => {
  const h = harness(), target = [], page = [];
  h.input.value = 'before';
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) {
    h.input.addEventListener(type, event => target.push([type, event.data, event.inputType]));
    h.window.addEventListener(type, event => page.push([type, event.data, event.inputType]));
    const event = h.event(h.input, type, { data: '日本語', inputType: 'insertCompositionText', isComposing: true });
    assert.equal(event.defaultPrevented, false);
  }
  for (const key of ['Process', 'Unidentified', 'g']) {
    const event = h.key(h.input, key, { code: 'KeyG', keyCode: 229, isComposing: true });
    assert.equal(event.key, key);
    assert.equal(event.code, 'KeyG');
    assert.equal(event.keyCode, 229);
    assert.equal(event.isComposing, true);
    assert.equal(event.preventCalls, 0);
  }
  assert.deepEqual(target, page);
  assert.equal(h.input.value, 'before', 'Boundary never mutates the control or composition text');
  assert.equal(h.native.keydowns.length, 0);
});

test('local Enter/Escape handlers and Tab/button/select default callbacks remain usable', () => {
  const h = harness(), handled = [];
  h.input.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === 'Escape') { handled.push(event.key); event.preventDefault(); }
  });
  for (const key of ['Enter', 'Escape']) {
    const event = h.key(h.input, key, {}, () => assert.fail('Local cancellation must be respected'));
    assert.equal(event.defaultPrevented, true);
  }
  h.focus(h.input);
  h.key(h.input, 'Tab', {}, () => h.focus(h.button));
  assert.equal(h.document.activeElement, h.host);
  assert.equal(h.root.activeElement, h.button);
  let clicks = 0;
  h.button.addEventListener('click', () => clicks++);
  for (const key of ['Enter', ' ']) h.key(h.button, key, {}, () => h.event(h.button, 'click'));
  const select = new Element('SELECT', h.form);
  select.selectedIndex = 0;
  h.key(select, 'ArrowDown', {}, () => select.selectedIndex++);
  assert.equal(select.selectedIndex, 1);
  assert.equal(clicks, 2, 'Simulated activation defaults still reach local click handlers');
  assert.deepEqual(handled, ['Enter', 'Escape']);
  assert.equal(h.native.keydowns.length, 0);
});

test('actual bindPointerDrag Escape cancellation survives the Helper bubble boundary', () => {
  const h = harness(), finishes = [];
  const drag = new Element('DIV', h.form, 'drag-handle');
  h.bindPointerDrag(drag, { start: () => ({ original: 42 }), move() {},
    end(state, commit) { finishes.push({ original: state.original, commit }); } });
  h.event(drag, 'pointerdown', { pointerId: 7, isPrimary: true, button: 0 });
  assert.equal(drag.hasPointerCapture(7), true);
  const event = h.key(h.input, 'Escape');
  assert.deepEqual(finishes, [{ original: 42, commit: false }]);
  assert.equal(drag.hasPointerCapture(7), false);
  assert.equal(event.defaultPrevented, true, 'The existing drag handler may cancel Escape');
  assert.ok(h.document.listeners.get('keydown').some(listener => listener.capture), 'Drag Escape must run in capture phase');
  assert.equal(h.native.keydowns.length, 0);
  h.key(h.input, 'Escape');
  assert.equal(finishes.length, 1, 'Cancellation is not duplicated');
});

test('native WASD release is preserved when focus moves from game into Helper', () => {
  const h = harness();
  for (const key of ['w', 'a', 's', 'd']) {
    h.focus(h.canvas);
    h.key(h.canvas, key);
    assert.equal(h.native.held.has(key), true, key);
    h.focus(h.input);
    const release = h.event(h.input, 'keyup', { key });
    assert.equal(release.stopCalls, 0, 'Never trap a native held-key release');
    assert.equal(h.native.held.has(key), false, key);
  }
  assert.equal(h.native.keyups.length, 4);
});

test('Helper-held keys cannot start native movement; releasing outside remains harmless', () => {
  const h = harness();
  for (const key of ['w', 'a', 's', 'd']) {
    h.focus(h.input);
    h.key(h.input, key);
    h.key(h.input, key, { repeat: true });
    assert.equal(h.native.held.size, 0);
    h.focus(h.canvas);
    h.event(h.canvas, 'keyup', { key });
    assert.equal(h.native.held.size, 0);
  }
  assert.equal(h.native.keydowns.length, 0);
  assert.equal(h.native.keyups.length, 4);
});

test('window blur still clears native held keys and cancels an active Helper drag', () => {
  const h = harness(), finishes = [];
  h.key(h.canvas, 'w');
  h.bindPointerDrag(h.button, { start: () => ({}), move() {}, end(state, commit) { finishes.push(commit); } });
  h.event(h.button, 'pointerdown', { pointerId: 3, isPrimary: true, button: 0 });
  h.event(h.window, 'blur', { bubbles: false, cancelable: false });
  assert.equal(h.native.held.size, 0);
  assert.deepEqual(finishes, [false]);
});

test('focus and blur events retain capture delivery and focusin/focusout retain bubbling', () => {
  const h = harness(), seen = [];
  for (const type of ['focus', 'blur']) h.document.addEventListener(type, event => seen.push(event.type), true);
  for (const type of ['focusin', 'focusout']) h.document.addEventListener(type, event => seen.push(event.type));
  h.focus(h.input);
  h.focus(h.button);
  h.focus(h.canvas);
  assert.deepEqual(seen, ['focus', 'focusin', 'blur', 'focusout', 'focus', 'focusin', 'blur', 'focusout', 'focus', 'focusin']);
  assert.equal(h.root.activeElement, null);
  assert.equal(h.document.activeElement, h.canvas);
});

test('events outside Helper retain native shortcuts and the native editable-target guard', () => {
  const h = harness();
  h.key(h.canvas, 'g');
  assert.deepEqual(h.native.actions, ['galaxy-map']);
  for (const type of ['INPUT', 'TEXTAREA', 'contenteditable']) {
    const target = new Element(type === 'contenteditable' ? 'DIV' : type, h.document.body);
    target.isContentEditable = type === 'contenteditable';
    const event = h.key(target, 'g');
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(h.native.actions.length, 1);
  h.key(h.canvas, 'g', { repeat: true });
  assert.equal(h.native.actions.length, 1, 'Native discrete repeat suppression is retained');
  h.key(h.canvas, 'Escape');
  assert.equal(h.native.escapes, 1);
});

test('dynamic controls, remounts and duplicate installation retain one boundary per root', () => {
  const h = harness();
  for (let index = 0; index < 3; index++) h.installHelperKeyboardBoundary(h.root);
  assert.equal(h.root.listeners.get('keydown').length, 1);
  assert.equal(h.root.listeners.get('keypress').length, 1);
  assert.equal(h.root.listeners.has('keyup'), false);
  const later = new Element('INPUT', h.form, 'dynamic-input');
  assert.equal(h.key(later, 'g').stopCalls, 1);
  h.host.remove();
  h.document.body.appendChild(h.host);
  assert.equal(h.key(later, 'g').stopCalls, 1);
  const replacement = new Element('DIV', h.document.body, 'replacement-host');
  const replacementRoot = replacement.attachShadow();
  h.installHelperKeyboardBoundary(replacementRoot);
  h.installHelperKeyboardBoundary(replacementRoot);
  const replacementInput = new Element('INPUT', replacementRoot);
  assert.equal(h.key(replacementInput, 'g').stopCalls, 1);
  assert.equal(replacementRoot.listeners.get('keydown').length, 1);
  assert.equal(h.native.keydowns.length, 0);
});

test('independent popup ShadowRoots and light-DOM dialog controls are contained', () => {
  const h = harness();
  for (const name of ['Shift menu', 'fleet editor', 'mission offer']) {
    const host = new Element('DIV', h.document.body, name), root = host.attachShadow();
    h.installHelperKeyboardBoundary(root);
    h.key(new Element('BUTTON', root), 'g');
  }
  for (const name of ['fleet editor dialog', 'preset shortage dialog']) {
    const dialog = new Element('DIALOG', h.document.body, name);
    h.installHelperKeyboardBoundary(dialog);
    h.key(new Element('BUTTON', dialog), 'g');
    h.key(new Element('INPUT', dialog), 'g');
  }
  assert.equal(h.native.keydowns.length, 0);
  assert.equal(h.native.actions.length, 0);
});

test('actual Shift menu navigation handlers still run after the same-root keyboard boundary', () => {
  const h = harness(), { state, current } = installActualShiftKeyboardHandlers(h);
  h.focus(current.items[0]);
  const sequence = [['ArrowDown', 2], ['ArrowUp', 0], ['ArrowUp', 7],
    ['Home', 0], ['End', 7], ['ArrowDown', 0]];
  for (const [key, expected] of sequence) {
    const event = h.key(h.root.activeElement, key, {}, () => assert.fail('Shift navigation must cancel its default'));
    assert.equal(h.root.activeElement, current.items[expected], key);
    assert.equal(event.defaultPrevented, true, key);
    assert.equal(event.immediateStopCalls, 0, 'Navigation uses propagation stop, not an immediate stop');
  }
  assert.deepEqual(state.focused, sequence.map(([, index]) => [index, true]));
  assert.deepEqual(state.scrolled, sequence.map(([, index]) => [index, 'nearest']));
  assert.equal(state.cancellations, 0, 'The actual capture handler recognizes its own menu');
  assert.equal(state.clicks, 0);
  assert.equal(h.native.keydowns.length, 0);
});

test('actual Shift menu slot guards preserve all 1-8 protections after the boundary', () => {
  const h = harness(), { state, current } = installActualShiftKeyboardHandlers(h);
  let targetCalls = 0, laterRootCalls = 0;
  current.items[0].addEventListener('keydown', () => targetCalls++);
  h.root.addEventListener('keydown', () => laterRootCalls++);
  h.focus(current.items[0]);
  for (let slot = 1; slot <= 8; slot++) {
    const event = h.key(current.items[0], String(slot), {}, () => assert.fail('Numeric slot default must stay blocked'));
    assert.equal(event.defaultPrevented, true, String(slot));
    assert.equal(event.immediateStopCalls, 1, 'The real slot guard must still execute after the boundary');
    assert.equal(h.root.activeElement, current.items[0]);
  }
  assert.equal(targetCalls, 8);
  assert.equal(laterRootCalls, 0, 'The slot handler intentionally stops later same-root handlers');
  assert.equal(state.clicks, 0, 'Numeric keys must not dispatch a preset');
  assert.equal(state.cancellations, 0);
  assert.equal(h.native.keydowns.length, 0);
});

test('actual Shift window capture handler cancels Escape before the Helper boundary', () => {
  const h = harness(), { state, current, context } = installActualShiftKeyboardHandlers(h);
  let targetCalls = 0, rootCalls = 0;
  current.items[0].addEventListener('keydown', () => targetCalls++);
  h.root.addEventListener('keydown', () => rootCalls++);
  const event = h.key(current.items[0], 'Escape');
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.immediateStopCalls, 1);
  assert.equal(state.cancellations, 1);
  assert.equal(state.escapedNativeMenus, 1);
  assert.equal(context.flow, null);
  assert.equal(targetCalls, 0, 'The real Escape handler intentionally consumes the event in window capture');
  assert.equal(rootCalls, 0);
  assert.equal(h.native.keydowns.length, 0);
  assert.equal(h.native.escapes, 0);
});

test('actual Shift capture handler preserves ownership and replay checks without leaking Helper keys', () => {
  const h = harness(), { state, current, context } = installActualShiftKeyboardHandlers(h);
  for (const key of ['g', 'w', 'a', 's', 'd']) h.key(current.items[0], key);
  assert.equal(state.cancellations, 0, 'Typing inside the Shift menu retains its flow');
  assert.equal(h.native.keydowns.length, 0);
  const otherHost = new Element('DIV', h.document.body, 'other-helper-host');
  const otherRoot = otherHost.attachShadow();
  h.installHelperKeyboardBoundary(otherRoot);
  const otherInput = new Element('INPUT', otherRoot);
  for (const key of ['Shift', 'Control', 'Alt', 'Meta']) h.key(otherInput, key);
  assert.equal(state.cancellations, 0, 'Modifiers alone do not cancel the Shift menu');
  h.key(otherInput, 'g');
  assert.equal(state.cancellations, 1, 'A key in another Helper control cancels the old menu in capture');
  assert.equal(h.native.keydowns.length, 0, 'That other Helper root still contains the subsequent bubble');
  context.flow = current;
  context.replaying = true;
  const replayed = h.key(current.items[0], 'Escape');
  assert.equal(state.cancellations, 1, 'The real replay guard bypasses its capture cancellation');
  assert.equal(state.escapedNativeMenus, 0);
  assert.equal(replayed.defaultPrevented, false);
  assert.equal(h.native.keydowns.length, 0, 'The Helper boundary still handles the replayed key bubble');
});
