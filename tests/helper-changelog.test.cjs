'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const version = source.match(/const SCRIPT_VERSION = '([^']+)'/)[1];
const slice = (begin, end) => {
  const start = source.indexOf(begin), stop = source.indexOf(end, start);
  assert.ok(start >= 0 && stop > start, `Missing source boundaries: ${begin}`);
  return source.slice(start, stop);
};
const changelogSource = slice('  function helperChangelogEntries()', '  // END HELPER CHANGELOG');
const tabsSource = slice('      for (const [index, tab] of ui.tabs.entries()) {', '      notifier.mount(');
const syncSource = slice('  function syncSettingsTabs()', '  function presentationFailure(');
const driveSource = slice("    ui.driveShortcut.addEventListener('click'", '    const observer = new MutationObserver(');
const minimizeSource = slice("      ui.minimize.addEventListener('click'", '      installHelperDragging();');

// Run the production changelog, main-tab, Drive-shortcut and minimize handlers.
// The stub models focus, visibility, scrolling and native details toggle events;
// it does not claim to measure CSS layout or replace a browser accessibility test.
function harness(activeTab = 'buildings') {
  const nodes = [], writes = [], effects = [], document = { activeElement: null };
  function element(tag) {
    const listeners = new Map();
    const node = { tagName: tag.toUpperCase(), dataset: {}, attributes: {}, children: [], hidden: false,
      open: false, textContent: '', scrollTop: 0, scrollCalls: [], focusCalls: [],
      append(...items) { for (const child of items) { child.parentElement = this; this.children.push(child); } },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(callback);
      },
      focus(options) { document.activeElement = this; this.focusCalls.push(options); },
      scrollIntoView(options) { this.scrollCalls.push(options); },
      fire(type, values = {}) {
        const event = { key: '', target: this, defaultPrevented: false, propagationStopped: false,
          preventDefault() { this.defaultPrevented = true; },
          stopPropagation() { this.propagationStopped = true; }, ...values };
        for (const listener of listeners.get(type) || []) listener(event);
        return event;
      },
      click() {
        this.fire('click');
        if (this.tagName === 'SUMMARY') {
          this.parentElement.open = !this.parentElement.open;
          this.parentElement.fire('toggle');
        }
      },
    };
    nodes.push(node);
    return node;
  }
  document.createElement = element;
  const settings = { activeTab, enabled: true, minimized: false, conditionsExpanded: true,
    shipMinimums: { marauder: 12 }, excluded: ['trade_hub'], depotFillPercent: 80 };
  const pages = ['empire', 'buildings', 'fleet', 'notifications', 'data'].map(id => {
    const page = element('div'); page.dataset.page = id; return page;
  });
  const tabs = pages.map(page => {
    const tab = element('button'); tab.dataset.settingsTab = page.dataset.page; return tab;
  });
  const shortcut = element('button'); shortcut.dataset.action = 'changelog-shortcut';
  const driveButton = element('button');
  const ui = { tabs, pages, conditionsDetails: element('details'), pageScroll: new Map(), scroll: element('div'),
    driveShortcut: element('button'), driveContainer: { querySelector: () => driveButton }, minimize: element('button'),
    cancelPriorityDrag: () => effects.push('cancelPriorityDrag'),
    cancelResize: () => effects.push('cancelResize'), cancelPanelDrag: () => effects.push('cancelPanelDrag') };
  const shadow = { querySelector(selector) {
    if (selector === '[data-page="data"]') return pages[4];
    if (selector === '[data-action="changelog-shortcut"]') return shortcut;
    throw new Error(`Unexpected selector: ${selector}`);
  } };
  const context = vm.createContext({ SCRIPT_VERSION: version, ui, settings, document,
    saveSettings() { writes.push(JSON.parse(JSON.stringify(settings))); },
    syncPresentationSections() {}, syncHelperWorkspace() {}, layoutHelper() {}, schedule() {},
    localStorage: new Proxy({}, { get() { throw new Error('Changelog must not access storage'); } }),
    metrics: new Proxy({}, { get() { throw new Error('Changelog must not change metrics'); } }),
  });
  vm.runInContext(changelogSource + syncSource + tabsSource + driveSource + minimizeSource
    + '\nthis.install = installHelperChangelog; this.sync = syncSettingsTabs; this.entries = helperChangelogEntries;', context);
  context.install(shadow);
  context.sync();
  const panel = nodes.find(node => node.id === 'oldlight-changelog');
  const summary = panel.children[0];
  const close = nodes.find(node => node.dataset.action === 'changelog-close');
  return { nodes, writes, effects, document, ui, settings, shortcut, panel, summary, close, driveButton,
    entries: () => JSON.parse(JSON.stringify(context.entries())), sync: context.sync,
    tab: id => tabs.find(tab => tab.dataset.settingsTab === id), dataPage: pages[4] };
}

test('Changelog starts with the installed release and lists distinct versions newest first', () => {
  const h = harness(), entries = h.entries();
  assert.equal(entries[0].version, version);
  assert.deepEqual(entries.map(entry => entry.version), ['1.14.1', '1.14.0', '1.13.1', '1.13.0', '1.12.1', '1.12.0', '1.11.0']);
  assert.equal(new Set(entries.map(entry => entry.version)).size, entries.length);
  for (const entry of entries) {
    assert.ok(entry.title.length > 0);
    assert.ok(entry.changes.length >= 2 && entry.changes.length <= 3);
    for (const change of entry.changes) assert.ok(change.length < 200);
  }
});

test('Historical notes are backed by versioned README sections and retain important limits', () => {
  const h = harness(), entries = h.entries();
  for (const entry of entries.slice(1)) assert.ok(readme.includes(`## ${entry.title} (${entry.version})`));
  assert.match(entries.find(entry => entry.version === '1.13.0').changes.join(' '), /desactivadas de inicio.*sin enviar información a servidores/);
  assert.match(entries.find(entry => entry.version === '1.11.0').changes.join(' '), /ventana está abierta y autorizada/);
  assert.match(entries.find(entry => entry.version === '1.11.0').changes.join(' '), /misiones y campañas en curso permanecen locales/);
});

test('Mount is quiet, closed and does not alter focus, settings or storage', () => {
  const h = harness();
  assert.equal(h.panel.open, false);
  assert.equal(h.shortcut.attributes['aria-expanded'], 'false');
  assert.equal(h.document.activeElement, null);
  assert.equal(h.panel.scrollCalls.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.settings.activeTab, 'buildings');
  assert.ok(h.dataPage.children.includes(h.panel));
});

test('Opening Datos alone never displays the changelog automatically', () => {
  const h = harness();
  h.tab('data').click();
  assert.equal(h.dataPage.hidden, false);
  assert.equal(h.panel.open, false);
  assert.equal(h.shortcut.attributes['aria-expanded'], 'false');
});

test('Footer shortcut opens Datos, expands release notes and focuses their native summary', () => {
  const h = harness();
  h.shortcut.click();
  assert.equal(h.settings.activeTab, 'data');
  assert.equal(h.dataPage.hidden, false);
  assert.equal(h.tab('data').attributes['aria-selected'], 'true');
  assert.equal(h.tab('data').tabIndex, 0);
  assert.equal(h.panel.open, true);
  assert.equal(h.shortcut.attributes['aria-expanded'], 'true');
  assert.equal(h.document.activeElement, h.summary);
  assert.equal(h.panel.scrollCalls.at(-1).block, 'start');
});

test('A second shortcut click closes notes and keeps keyboard focus on the shortcut', () => {
  const h = harness();
  h.shortcut.click(); h.shortcut.click();
  assert.equal(h.panel.open, false);
  assert.equal(h.shortcut.attributes['aria-expanded'], 'false');
  assert.equal(h.document.activeElement, h.shortcut);
  assert.equal(h.settings.activeTab, 'data');
});

test('Close button collapses notes and returns focus to the visible summary', () => {
  const h = harness();
  h.shortcut.click(); h.close.click();
  assert.equal(h.panel.open, false);
  assert.equal(h.document.activeElement, h.summary);
  assert.equal(h.summary.scrollCalls.at(-1).block, 'nearest');
  assert.equal(h.shortcut.attributes['aria-expanded'], 'false');
});

test('Escape closes an open changelog and is not forwarded to the game', () => {
  const h = harness();
  h.shortcut.click();
  const event = h.panel.fire('keydown', { key: 'Escape', target: h.close });
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
  assert.equal(h.panel.open, false);
  assert.equal(h.document.activeElement, h.summary);
});

test('Other keys and Escape on a closed changelog are left alone', () => {
  const h = harness();
  assert.equal(h.panel.fire('keydown', { key: 'Escape' }).defaultPrevented, false);
  h.shortcut.click();
  assert.equal(h.panel.fire('keydown', { key: 'ArrowDown' }).defaultPrevented, false);
  assert.equal(h.panel.open, true);
});

test('Native summary toggles keep the permanent shortcut expansion state accurate', () => {
  const h = harness('data');
  h.summary.click();
  assert.equal(h.panel.open, true);
  assert.equal(h.shortcut.attributes['aria-expanded'], 'true');
  h.summary.click();
  assert.equal(h.panel.open, false);
  assert.equal(h.shortcut.attributes['aria-expanded'], 'false');
});

test('Leaving for any main tab closes notes, preserves its scroll and never steals focus', () => {
  for (const destination of ['empire', 'buildings', 'fleet', 'notifications']) {
    const h = harness(destination);
    h.ui.scroll.scrollTop = 147;
    h.shortcut.click();
    h.tab(destination).focus(); h.tab(destination).click();
    assert.equal(h.panel.open, false);
    assert.equal(h.dataPage.hidden, true);
    assert.equal(h.ui.scroll.scrollTop, 147);
    assert.equal(h.document.activeElement, h.tab(destination));
    h.tab('data').click();
    assert.equal(h.panel.open, false);
  }
});

test('Main-tab arrow keys, Home and End still select and focus the correct tab', () => {
  const h = harness();
  h.shortcut.click();
  const left = h.tab('data').fire('keydown', { key: 'ArrowLeft' });
  assert.equal(left.defaultPrevented, true);
  assert.equal(h.settings.activeTab, 'notifications');
  assert.equal(h.document.activeElement, h.tab('notifications'));
  assert.equal(h.panel.open, false);
  h.tab('notifications').fire('keydown', { key: 'Home' });
  assert.equal(h.settings.activeTab, 'empire');
  h.tab('buildings').fire('keydown', { key: 'End' });
  assert.equal(h.settings.activeTab, 'data');
  assert.equal(h.panel.open, false);
  h.tab('data').fire('keydown', { key: 'ArrowRight' });
  assert.equal(h.settings.activeTab, 'empire');
});

test('Repeated clicks and passive refreshes never duplicate or spontaneously reopen notes', () => {
  const h = harness();
  for (let cycle = 0; cycle < 8; cycle += 1) {
    h.shortcut.click(); h.sync(); h.sync();
    assert.equal(h.panel.open, true);
    h.close.click(); h.sync(); h.sync();
    assert.equal(h.panel.open, false);
  }
  assert.equal(h.nodes.filter(node => node.id === 'oldlight-changelog').length, 1);
  assert.equal(h.nodes.filter(node => node.dataset.changelogVersion).length, h.entries().length);
});

test('Drive shortcut continues to show synchronization controls and focus its own button', () => {
  const h = harness();
  h.shortcut.click();
  h.ui.scroll.scrollTop = 900;
  h.ui.driveShortcut.click();
  assert.equal(h.settings.activeTab, 'data');
  assert.equal(h.ui.scroll.scrollTop, 0);
  assert.equal(h.document.activeElement, h.driveButton);
  assert.equal(h.dataPage.hidden, false);
});

test('Minimize and restore do not reopen a dismissed changelog or modify operational settings', () => {
  const h = harness();
  h.shortcut.click(); h.close.click();
  h.ui.minimize.click();
  assert.equal(h.settings.minimized, true);
  h.ui.minimize.click();
  assert.equal(h.settings.minimized, false);
  assert.equal(h.panel.open, false);
  assert.equal(h.settings.enabled, true);
  assert.deepEqual(h.settings.shipMinimums, { marauder: 12 });
  assert.deepEqual(h.settings.excluded, ['trade_hub']);
  assert.equal(h.settings.depotFillPercent, 80);
});

test('Only existing main-tab presentation is saved; release notes add no settings or metrics', () => {
  const h = harness();
  const before = { ...h.settings };
  h.shortcut.click(); h.close.click(); h.summary.click(); h.summary.click();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.settings, { ...before, activeTab: 'data' });
  assert.equal('changelog' in h.settings, false);
});

test('Reloading on Datos starts closed even if the previous instance left notes open', () => {
  const previous = harness('data'); previous.shortcut.click();
  const next = harness(previous.settings.activeTab);
  assert.equal(next.panel.open, false);
  assert.equal(next.document.activeElement, null);
  assert.equal(next.writes.length, 0);
});

test('External main-tab changes close the disclosure without moving focus or saving again', () => {
  const h = harness();
  h.shortcut.click();
  h.document.activeElement = null;
  const writes = h.writes.length;
  h.settings.activeTab = 'fleet'; h.sync();
  assert.equal(h.panel.open, false);
  assert.equal(h.shortcut.attributes['aria-expanded'], 'false');
  assert.equal(h.document.activeElement, null);
  assert.equal(h.writes.length, writes);
});

test('All notes are inline text with exactly one installed-version marker, no external content', () => {
  const h = harness();
  const releases = h.nodes.filter(node => node.dataset.changelogVersion);
  assert.equal(releases.length, h.entries().length);
  assert.equal(h.nodes.filter(node => node.className === 'changelog-current').length, 1);
  for (const tag of ['DIALOG', 'IFRAME', 'SCRIPT', 'IMG']) assert.equal(h.nodes.some(node => node.tagName === tag), false);
  assert.equal(h.nodes.some(node => node.innerHTML !== undefined), false);
});

test('Permanent access is labeled, linked to the disclosure and constrained to helper width', () => {
  assert.match(source, /data-action="changelog-shortcut" aria-controls="oldlight-changelog" aria-expanded="false"[^>]*>Changelog<\/button>/);
  assert.match(source, /\.helper-footer \{ display:grid; grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(source, /\.helper-footer \.helper-drive-shortcut \{[^}]*max-width:min\(180px,45cqw\)/);
  assert.match(source, /\.changelog-release h3 \{ overflow-wrap:anywhere; \}/);
  assert.match(source, /\.changelog-release li \{[^}]*overflow-wrap:anywhere/);
  assert.match(source, /\.helper-changelog-shortcut, \.helper-changelog summary \{ min-height:44px; \}/);
});
