'use strict';

// Offline DOM-event model. It implements the capture/target/bubble behavior used
// below, open-shadow retargeting, listener ordering and independent default
// callbacks. It is NOT a browser or a simulation of the browser editing engine.
class Node {
  constructor(name, parent = null) {
    this.name = name;
    this.parentNode = parent;
    this.listeners = new Map();
    this.activeElement = null;
  }
  addEventListener(type, callback, options = false) {
    const capture = typeof options === 'boolean' ? options : Boolean(options.capture);
    const listeners = this.listeners.get(type) || [];
    if (!listeners.some(item => item.callback === callback && item.capture === capture)) {
      listeners.push({ callback, capture, once: Boolean(options && options.once) });
      this.listeners.set(type, listeners);
    }
  }
  removeEventListener(type, callback, options = false) {
    const capture = typeof options === 'boolean' ? options : Boolean(options.capture);
    this.listeners.set(type, (this.listeners.get(type) || [])
      .filter(item => item.callback !== callback || item.capture !== capture));
  }
  getRootNode() {
    let node = this;
    while (node.parentNode && !node.isShadowRoot && !node.isDocument) node = node.parentNode;
    return node;
  }
  appendChild(child) { child.parentNode = this; return child; }
  remove() { this.parentNode = null; }
  dispatchEvent(event) { return dispatch(this, event); }
}

class Element extends Node {
  constructor(tagName, parent = null, name = tagName) {
    super(name, parent);
    this.tagName = tagName.toUpperCase();
    this.isContentEditable = false;
    this.value = '';
    this.captureIds = new Set();
  }
  attachShadow() {
    const root = new Node(this.name + '#shadow', this);
    root.isShadowRoot = true;
    root.host = this;
    this.shadowRoot = root;
    return root;
  }
  hasPointerCapture(id) { return this.captureIds.has(id); }
  setPointerCapture(id) { this.captureIds.add(id); }
  releasePointerCapture(id) { this.captureIds.delete(id); }
}

class Event {
  constructor(type, fields = {}) {
    Object.assign(this, { type, bubbles: true, composed: true, cancelable: true,
      defaultPrevented: false, key: '', code: '', keyCode: 0, ctrlKey: false,
      metaKey: false, altKey: false, shiftKey: false, repeat: false,
      isComposing: false, eventPhase: 0, currentTarget: null }, fields);
    this.stopCalls = 0;
    this.immediateStopCalls = 0;
    this.preventCalls = 0;
  }
  preventDefault() { this.preventCalls++; if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this.stopCalls++; this.stopped = true; }
  stopImmediatePropagation() { this.immediateStopCalls++; this.stopped = this.immediate = true; }
  composedPath() { return [...this.path]; }
}

function within(node, root) {
  for (let current = node; current; current = current.parentNode) if (current === root) return true;
  return false;
}

function retarget(original, observer) {
  let target = original;
  while (target.getRootNode().isShadowRoot && !within(observer, target.getRootNode())) {
    target = target.getRootNode().host;
  }
  return target;
}

function dispatch(target, event, defaultAction) {
  const path = [];
  for (let node = target; node; node = node.parentNode) {
    path.push(node);
    if (node.isShadowRoot && !event.composed) break;
  }
  event.path = path;
  const invoke = (node, capture, phase) => {
    event.currentTarget = node;
    event.target = retarget(target, node);
    // A composed event treats its shadow host as another AT_TARGET node.
    event.eventPhase = event.target === node ? 2 : phase;
    for (const listener of [...(node.listeners.get(event.type) || [])]) {
      if (listener.capture !== capture) continue;
      if (!(node.listeners.get(event.type) || []).includes(listener)) continue;
      listener.callback.call(node, event);
      if (listener.once) node.removeEventListener(event.type, listener.callback, capture);
      if (event.immediate) break;
    }
  };
  for (const node of path.slice(1).reverse()) {
    invoke(node, true, 1);
    if (event.stopped) break;
  }
  if (!event.stopped) {
    invoke(target, true, 2);
    if (!event.stopped) invoke(target, false, 2);
  }
  if (!event.stopped) {
    for (const node of path.slice(1)) {
      // Composed non-bubbling events still visit their hosts at target.
      if (event.bubbles || retarget(target, node) === node) invoke(node, false, 3);
      if (event.stopped) break;
    }
  }
  event.currentTarget = null;
  event.eventPhase = 0;
  event.target = retarget(target, path.at(-1));
  if (!event.defaultPrevented && defaultAction) defaultAction(event);
  return !event.defaultPrevented;
}

function createDOM() {
  const window = new Node('window'), document = new Node('document', window);
  // A document's root is itself; window is in the event path, not its DOM tree.
  document.isDocument = true;
  document.body = new Element('BODY', document, 'body');
  const classes = new Set();
  document.body.classList = { contains: key => classes.has(key),
    remove: key => classes.delete(key), toggle: key => classes.has(key) ? classes.delete(key) : classes.add(key) };
  document.querySelector = selector => selector === 'dialog[open]' && document.modalOpen ? {} : null;
  const focus = target => {
    const previous = document.focusedElement;
    if (previous === target) return;
    if (previous) {
      dispatch(previous, new Event('blur', { bubbles: false, cancelable: false, relatedTarget: target }));
      dispatch(previous, new Event('focusout', { cancelable: false, relatedTarget: target }));
      const root = previous.getRootNode();
      if (root.isShadowRoot) root.activeElement = null;
    }
    document.focusedElement = target;
    document.activeElement = target ? retarget(target, document) : null;
    if (target) {
      const root = target.getRootNode();
      if (root.isShadowRoot) root.activeElement = target;
      dispatch(target, new Event('focus', { bubbles: false, cancelable: false, relatedTarget: previous }));
      dispatch(target, new Event('focusin', { cancelable: false, relatedTarget: previous }));
    }
  };
  return { window, document, focus };
}

function installNativeShortcuts(window, document) {
  // Observed native bundle galaxy-CqK10P8m.js, cached 2026-10-14.
  // SHA-256: ba9c761ac00e7f513a58014a33574fbcfef1f4942ffc3b337ef606ea4ab0ccdc
  // g identifier is at offset 532076; window bubble registration is at 548212.
  // g/b/w below retain the observed handler bodies. Their game dependencies and
  // binding table are inert local stubs: no DOM clicks, game orders or network.
  const HTMLElement = Element, ct = { locked: false }, d = new Set();
  const p = new Map([
    ['g', { action: 'galaxy-map', phase: 'discrete', preventDefault: true }],
    ...['w', 'a', 's', 'd'].map(key => [key, { action: 'pan-' + key, phase: 'hold' }]),
  ]);
  const m = new Set(['w', 'a', 's', 'd']);
  const result = { actions: [], keydowns: [], keyups: [], held: d, redraws: 0, escapes: 0 };
  const Wt = { isOpen: () => false }, V = () => {}, N = { setSelected() {} }, i = null;
  const c = () => result.redraws++, u = () => result.escapes++, h = action => result.actions.push(action);
  const g = e=>{if(e.target instanceof HTMLElement){let t=e.target.tagName;if(t===`INPUT`||t===`TEXTAREA`||e.target.isContentEditable)return}if(ct.locked||document.querySelector(`dialog[open]`)||!e.key)return;if(e.key===`Escape`){if(document.body.classList.contains(`ui-hidden`)){document.body.classList.remove(`ui-hidden`);return}if(Wt.isOpen()){V(),N.setSelected(null),i?.refresh(),c();return}u();return}if(e.key==="`"){document.body.classList.toggle(`ui-hidden`);return}if(e.ctrlKey||e.metaKey||e.altKey)return;let t=e.key.length===1?e.key.toLowerCase():e.key,n=p.get(t);if(n){if(n.preventDefault&&e.preventDefault(),n.phase===`hold`){d.add(t),c();return}n.phase===`discrete`&&e.repeat||h(n.action)}};
  const b = e=>{if(!e.key)return;let t=e.key.length===1?e.key.toLowerCase():e.key;m.has(t)&&d.delete(t)};
  const w = ()=>d.clear();
  window.addEventListener('keydown', event => {
    result.keydowns.push({ key: event.key, target: event.target, phase: event.eventPhase });
    g(event);
  });
  window.addEventListener('keyup', event => {
    result.keyups.push({ key: event.key, target: event.target });
    b(event);
  });
  window.addEventListener('blur', w);
  return result;
}

module.exports = { Node, Element, Event, dispatch, createDOM, installNativeShortcuts };
