'use strict';
// Real navigation handlers over a small DOM fixture. This does not measure layout.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Event, dispatch } = require('./helper-keyboard.fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
function part(start, end) { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a > 0 && b > a); return source.slice(a, b); }
const workspaceSource = part('  function normalizeHelperWorkspace(', '  // END HELPER WORKSPACE\n');
const syncSource = part('  function syncSettingsTabs()', '  function presentationFailure(');
const tabSource = part('      for (const [index, tab] of ui.tabs.entries()) {', '      notifier.mount(');
function harness(activeTab = 'fleet') {
  const writes = [], outsideKeys = [], document = { activeElement: null, isDocument: true, listeners: new Map(), getRootNode() { return this; } };
  document.listeners.set('keydown', [{ callback: event => outsideKeys.push(event.key), capture: false }]);
  const dataKey = key => key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const match = (node, selector) => {
    if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
    const attribute = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (attribute) { const value = attribute[1].startsWith('data-') ? node.dataset[dataKey(attribute[1].slice(5))] : node.attributes[attribute[1]];
      return attribute[2] === undefined ? value !== undefined : value === attribute[2]; }
    return node.tagName.toLowerCase() === selector;
  };
  function el(tag) {
    const listeners = new Map();
    return { listeners, tagName: tag.toUpperCase(), className: '', children: [], parentNode: null, dataset: {}, attributes: {}, hidden: false, textContent: '', scrollTop: 0,
      append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } },
      prepend(node) { this.insertBefore(node, this.children[0]); },
      insertBefore(node, reference) { node.remove(); node.parentNode = this; const at = this.children.indexOf(reference); this.children.splice(at < 0 ? this.children.length : at, 0, node); },
      remove() { if (this.parentNode) { const nodes = this.parentNode.children; nodes.splice(nodes.indexOf(this), 1); this.parentNode = null; } },
      querySelectorAll(selector) { return this.children.flatMap(child => [...(match(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      closest(selector) { return match(this, selector) ? this : this.parentNode?.closest(selector); },
      getRootNode() { let node = this; while (node.parentNode && !node.isShadowRoot && !node.isDocument) node = node.parentNode; return node; },
      contains(node) { return node === this || this.children.some(child => child.contains(node)); },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      addEventListener(type, fn, capture = false) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push({callback:fn,capture}); },
      fire(type, values = {}, defaultAction) { const event = new Event(type, values); dispatch(this, event, defaultAction); return event; },
      click() { this.fire('click'); }, focus(options) { this.focusOptions = options; document.activeElement = this; },
    };
  }
  document.createElement = el; document.querySelector = () => null;
  const shell = el('section'), shadow = el('shadow'), scroll = el('div'); const host = el('div'); host.parentNode = document; shadow.parentNode = host; shadow.isShadowRoot = true; shadow.host = host; shadow.append(shell); shell.append(scroll);
  const pages = ['empire', 'buildings', 'fleet', 'notifications', 'data'].map(id => { const page = el(id === 'fleet' ? 'details' : 'div'); page.dataset.page = id; scroll.append(page); return page; });
  const mainNav = el('nav'); shell.insertBefore(mainNav, scroll);
  const tabs = pages.map(page => { const tab = el('button'); tab.dataset.settingsTab = page.dataset.page; mainNav.append(tab); return tab; });
  const goalsAction = el('button'); goalsAction.dataset.action = 'empire-goals'; pages[2].append(goalsAction);
  const goal = el('input'); goal.className = 'fixture-goal'; pages[0].append(goal);
  const originalQuery = shadow.querySelector; shadow.querySelector = selector => selector === '.oldlight-empire input' ? goal : originalQuery.call(shadow, selector);
  const fleetDetails = pages[2], allyProtectionContainer = el('div'), attackRetryContainer = el('div'), fleetWaitContainer = el('div');
  fleetDetails.append(el('summary'), el('p'), allyProtectionContainer, attackRetryContainer, fleetWaitContainer);
  const backup = el('div'); backup.className = 'backup-card'; const widthLabel = el('label'); widthLabel.className = 'panel-width-label';
  const panelWidth = el('input'); backup.append(widthLabel, panelWidth); pages[4].append(backup);
  const driveContainer = el('div'); driveContainer.append(el('button')); pages[4].append(driveContainer);
  const ui = { section: shell, scroll, fleetDetails, allyProtectionContainer, attackRetryContainer, fleetWaitContainer,
    tabs, pages, conditionsDetails: el('details'), panelWidth, driveContainer, driveShortcut: el('button'), eta: el('div'), contextLabel: el('span'), pageScroll: new Map() };
  const settings = { activeTab, enabled: false, conditionsExpanded: true, shipMinimums: { probe: 7 } };
  const storage = new Map();
  const context = vm.createContext({ conquestPanel: null, document, ui, settings, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => { storage.set(key, value); writes.push([key, value]); } },
    MutationObserver: class { observe() {} }, driveBackup: { getStatus: () => ({ code: 'disconnected' }) },
    presentationFailure: message => { throw Error(message); }, text: node => node?.textContent || '',
    setText: (node, value) => { if (node.textContent !== value) node.textContent = value; },
    syncPresentationSections() {}, layoutHelper() {}, saveSettings() {} });
  const boundary = part('  // BEGIN HELPER KEYBOARD BOUNDARY', '  // END HELPER KEYBOARD BOUNDARY');
  vm.runInContext(boundary + workspaceSource + syncSource + tabSource + '\nthis.install = installHelperWorkspace; this.sync = syncSettingsTabs; this.boundary = installHelperKeyboardBoundary;', context);
  context.boundary(shadow); context.install(shadow); context.sync();
  return { ui, document, settings, writes, shell, scroll, mainNav, outsideKeys, goalsAction, goal, sync: context.sync, nav: ui.workspace.nav,
    subtab: id => ui.workspace.controls.get(id).button, tab: id => tabs.find(tab => tab.dataset.settingsTab === id) };
}

test('fleet task navigation remains outside scrolling content and follows main-tab visibility', () => {
  const h = harness();
  assert.ok(h.nav, 'workspace exposes its persistent navigation');
  assert.equal(h.nav.parentNode, h.shell); assert.equal(h.scroll.contains(h.nav), false);
  assert.equal(h.shell.children.indexOf(h.nav) + 1, h.shell.children.indexOf(h.scroll));
  h.scroll.scrollTop = 900; h.sync(); assert.equal(h.nav.hidden, false);
  for (const id of ['empire', 'buildings', 'notifications', 'data']) { h.tab(id).click(); assert.equal(h.nav.hidden, true); }
  h.tab('fleet').click(); assert.equal(h.nav.hidden, false); assert.equal(h.scroll.scrollTop, 900);
});

test('fleet keyboard navigation preserves subview scroll and exactly one keyboard tab stop', () => {
  const h = harness(); h.scroll.scrollTop = 190;
  assert.equal(h.subtab('minimums').fire('keydown', { key: 'ArrowRight' }).defaultPrevented, true);
  assert.equal(h.document.activeElement, h.subtab('campaigns')); assert.equal(h.scroll.scrollTop, 0);
  h.scroll.scrollTop = 85; h.subtab('campaigns').fire('keydown', { key: 'End' });
  assert.equal(h.ui.workspace.state.fleetView, 'missions'); assert.equal(h.document.activeElement, h.subtab('missions'));
  h.subtab('missions').fire('keydown', { key: 'Home' }); assert.equal(h.scroll.scrollTop, 190);
  h.subtab('minimums').fire('keydown', { key: 'ArrowLeft' }); assert.equal(h.ui.workspace.state.fleetView, 'missions');
  h.subtab('missions').fire('keydown', { key: 'ArrowLeft' }); assert.equal(h.scroll.scrollTop, 85);
  assert.equal([...h.ui.workspace.controls.values()].filter(({ button }) => button.tabIndex === 0).length, 1);
  assert.equal(h.ui.workspace.views.get('campaigns').hidden, false);
  assert.equal(h.ui.workspace.views.get('minimums').hidden, true);
});

test('passive workspace refresh keeps focused editing, navigation identity and operational settings', () => {
  const h = harness(), field = h.document.createElement('input'); h.ui.workspace.views.get('minimums').append(field); field.focus();
  const before = JSON.stringify(h.settings), writes = h.writes.length;
  for (let i = 0; i < 20; i++) h.sync();
  assert.equal(h.document.activeElement, field); assert.equal(JSON.stringify(h.settings), before); assert.equal(h.writes.length, writes);
  assert.equal(h.shell.querySelectorAll('.fleet-workspace-tabs').length, 1);
  assert.equal(h.ui.eta.hidden, false);
  h.subtab('campaigns').click(); assert.equal(h.ui.eta.hidden, true);
  assert.equal(h.settings.enabled, false); assert.equal(h.settings.shipMinimums.probe, 7);
});

test('navigation CSS uses normal flow and container-aware narrow controls', () => {
  assert.match(source, /\.fleet-workspace-tabs \{[^}]*flex-shrink:0[^}]*margin:0 12px 10px/);
  assert.match(source, /\.settings-tabs, \.fleet-workspace-tabs \{ margin-left:9px; margin-right:9px; \}/);
  assert.match(source, /@container empire-panel \(max-width:340px\)/);
  assert.match(source, /select:focus-visible, textarea:focus-visible/);
});

test('the runtime forwards its current identity before rendering even when the dashboard is hidden', () => {
  const calls = [], context = { scope: 'beta/other-player' };
  const updateSource = part('  function updateEmpireState()', '  function installEmpirePanel(');
  const sandbox = vm.createContext({ conquestPanel: null, missionContext: () => context, leader: true, canNavigateEmpire: () => true,
    settings: { enabled: false }, document: { hidden: true },
    empireController: { update: input => calls.push(['update', input.scope, input.enabled]) },
    empirePanel: { observeScope: scope => calls.push(['scope', scope]), render: () => calls.push(['render']) } });
  vm.runInContext(updateSource + '\nupdateEmpireState();', sandbox);
  assert.deepEqual(calls, [['update', 'beta/other-player', false], ['scope', 'beta/other-player'], ['render']]);
});


test('mounted fleet navigation and goal shortcut preserve keyboard isolation, defaults and policy', () => {
  const h = harness(), before = JSON.stringify(h.settings); let defaults = 0;
  h.subtab('minimums').fire('keydown', {key:'ArrowRight'}, () => defaults++);
  assert.equal(h.ui.workspace.state.fleetView, 'campaigns'); assert.equal(defaults, 0);
  h.subtab('campaigns').fire('keydown', {key:'Home'}, () => defaults++);
  for (const key of ['Tab', 'Escape', 'g']) h.subtab('minimums').fire('keydown', {key}, () => defaults++);
  assert.equal(defaults, 3); assert.deepEqual(h.outsideKeys, []);
  h.scroll.scrollTop = 120;
  h.goalsAction.fire('keydown', {key:'Enter'}, () => h.goalsAction.click());
  assert.equal(h.settings.activeTab, 'empire'); assert.equal(h.document.activeElement, h.goal); assert.equal(h.scroll.scrollTop, 0);
  assert.equal(h.nav.hidden, true); assert.deepEqual(h.outsideKeys, []);
  assert.notEqual(h.goal.focusOptions?.preventScroll, true, 'The browser must be allowed to reveal the focused goal');
  const after = {...h.settings,activeTab:'fleet'}; assert.equal(JSON.stringify(after), before);
  h.tab('fleet').click(); assert.equal(h.scroll.scrollTop, 120); assert.equal(h.nav.hidden, false);
});
