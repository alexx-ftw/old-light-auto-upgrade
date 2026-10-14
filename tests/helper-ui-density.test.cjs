'use strict';
// Text-density budgets use mounted production panel nodes and a small parser of
// the actual Fleet template. Counts model closed native details, not layout.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');
const panelFixturePath = path.join(__dirname, 'empire-panel.test.cjs');
const prefix = fs.readFileSync(panelFixturePath, 'utf8').split("test('panel renders complete")[0];
const fixture = vm.createContext({ require: createRequire(panelFixturePath), structuredClone });
vm.runInContext(prefix + '\nthis.make = harness;', fixture);
const all = node => [node, ...(node.children || []).flatMap(all)];
const has = (node, cls) => (node.className || '').split(/\s+/).includes(cls);
const words = text => text.trim().split(/\s+/).filter(Boolean).length;
function visible(node) {
  if (node.hidden) return false;
  for (let child = node, parent = node.parentNode; parent; child = parent, parent = parent.parentNode) {
    if (parent.hidden || parent.tagName === 'DETAILS' && !parent.open && child.tagName !== 'SUMMARY') return false;
  }
  return true;
}
function templateTree(markup) {
  const root = { tagName: 'ROOT', children: [], _text: '', get textContent() { return this._text + this.children.map(n => n.textContent).join(' '); } }, stack = [root];
  for (const token of markup.match(/<[^>]*>|[^<]+/g) || []) {
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (!token.startsWith('<')) { stack.at(-1)._text += token + ' '; continue; }
    const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
    const attrs = Object.fromEntries([...token.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    const node = { tagName: tag.toUpperCase(), children: [], _text: '', attributes: attrs, className: attrs.class || '',
      hidden: /\shidden(?:\s|>)/.test(token), open: /\sopen(?:\s|>)/.test(token), parentNode: stack.at(-1),
      get textContent() { return this._text + this.children.map(n => n.textContent).join(' '); } };
    stack.at(-1).children.push(node);
    if (!['input', 'br', 'hr', 'img', 'meta', 'link'].includes(tag)) stack.push(node);
  }
  return root;
}
function fleet() {
  const start = source.indexOf('<details class="settings-page fleet-details"'), end = source.indexOf('<div class="settings-page" data-page="notifications"', start);
  assert.ok(start > 0 && end > start); const tree = templateTree(source.slice(start, end));
  tree.children[0].hidden = false; // Selected Fleet page, independent of current settings.
  return tree;
}

test('imperial default help stays concise while full explanations and critical state remain reachable', t => {
  const h = fixture.make();
  const help = all(h.container).filter(node => node.tagName === 'P' && (has(node, 'empire-scope-help') || has(node, 'empire-role-help')
    || /^(Los objetivos cuentan|Equilibrado y Astillero|El reparto requiere|Con la sincronización|Los recursos permanecen)/.test(node.textContent))
    || node.tagName === 'SUMMARY' && (has(node.parentNode, 'empire-help') || has(node.parentNode, 'empire-role-details')));
  const count = words(help.filter(visible).map(n => n.textContent).join(' '));
  t.diagnostic(`Imperio: ${count} visible default-help words for two synthetic systems; excludes dynamic warnings, counts and labels.`);
  assert.ok(count <= 50, `Expected <=50 default-help words, got ${count}`);
  assert.match(h.container.textContent, /Drive.*Atender|Atender.*Drive/s);
  assert.match(h.container.textContent, /No organizan patrullas, ataques ni transportes/);
  assert.match(h.container.textContent, /recursos permanecen en cada sistema/);
  assert.ok(all(h.container).filter(n => ['INPUT', 'SELECT', 'BUTTON'].includes(n.tagName)).every(visible));
  assert.ok(all(h.container).filter(n => has(n, 'empire-status') || has(n, 'empire-production-summary') || has(n, 'empire-goal-status') || has(n, 'empire-error')).every(visible));
  assert.equal(h.writes, 0);
});

test('fleet default help is brief without collapsing controls or the active imperial notice', t => {
  const tree = fleet(), help = all(tree).filter(node => node.tagName === 'P' && (has(node, 'page-intro') || has(node, 'hint')) && !node.attributes?.['data-field']
    || node.tagName === 'SUMMARY' && has(node.parentNode, 'helper-help'));
  const count = words(help.filter(visible).map(n => n.textContent).join(' '));
  t.diagnostic(`Flota: ${count} visible default-help words; excludes dynamic imperial notice, counters and control labels.`);
  assert.ok(count <= 25, `Expected <=25 default-help words, got ${count}`);
  const details = all(tree).filter(n => has(n, 'helper-help'));
  assert.equal(details.length, 2); assert.ok(details.every(n => !n.open));
  assert.ok(all(tree).filter(n => ['INPUT', 'SELECT', 'BUTTON'].includes(n.tagName) && n.attributes?.['data-action'] !== 'empire-goals').every(visible));
  const notice = all(tree).find(n => n.attributes?.['data-field'] === 'fleet-policy-notice'); notice.hidden = false;
  const action = all(notice).find(n => n.attributes?.['data-action'] === 'empire-goals'); assert.ok(action && visible(action));
  assert.match(notice.textContent, /mínimos locales no se aplican/);
  assert.match(tree.textContent, /base, misiones, traslados y construcción una sola vez/);
  assert.match(tree.textContent, /Depot necesario y su Reactor/);
});
