'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
const block = source.split('  // BEGIN PRIVATE UPDATE CHECKER\n')[1]?.split('  // END PRIVATE UPDATE CHECKER')[0];
const factory = vm.runInNewContext(block + ';createUpdateChecker', {});
const meta = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.meta.js'), 'utf8');
const META = 'https://raw.githubusercontent.com/alexx-ftw/old-light-auto-upgrade/main/old-light-auto-upgrade.meta.js';
const INSTALL = META.replace('.meta.js', '.user.js');
function harness(extra = {}) {
  const states = [], opened = [], calls = [], store = new Map(); let timer;
  const opts = { current: '1.17.4', status: s => states.push(s),
    request: o => { calls.push(o); queueMicrotask(() => o.onload({ status: 200, finalUrl: META, responseText: meta })); return { abort() {} }; },
    read: (k, d) => store.get(k) ?? d, write: async (k, v) => store.set(k, v),
    open: async (...args) => { opened.push(args); return {}; },
    lock: async (name, options, action) => action({name}),
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout() {}, ...extra };
  return { checker: factory(opts), opts, states, opened, calls, store, timeout: () => timer() };
}
test('boot checks fixed metadata without credentials then opens fixed installer after durable marker', async () => {
  const h = harness(); await h.checker.start();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, META);
  assert.equal(h.calls[0].anonymous, true); assert.equal(h.calls[0].timeout, 8000);
  assert.equal(h.opened[0][0], INSTALL); assert.equal([...h.store.values()][0], '1.17.5');
  assert.equal(h.states.at(-1).phase, 'confirm'); assert.equal(h.states.at(-1).current, '1.17.4');
  await h.checker.start(); assert.equal(h.calls.length, 1);
});
test('same or older version never opens; numeric ordering handles multi-digit versions', async () => {
  for (const current of ['1.17.5', '1.18.0', '2.0.0']) {
    const h = harness({current}); await h.checker.start(); assert.equal(h.opened.length, 0); assert.equal(h.states.at(-1).phase,'current');
  }
  const {checker} = harness(); assert.equal(checker.newer('1.10.0','1.9.99'), true);
  for(const bad of ['1.2', '01.2.3', '1.2.3-beta', '1.2.3.4', '9999999.0.0', '<b>2.0.0</b>']) assert.equal(checker.newer(bad,'1.0.0'),false);
});
test('rejects foreign identity, URLs, duplicate identity, executable suffix, oversized and invalid metadata', () => {
  const {checker} = harness(); assert.equal(checker.parseMetadata(meta), '1.17.5');
  for(const bad of [meta.replace('Old Light Auto Upgrade','Other'), meta.replace('old-light-auto-upgrade\n','other\n'),
    meta.replace('/main/old-light-auto-upgrade.user.js','/evil.user.js'), meta.replace('/main/old-light-auto-upgrade.meta.js','/evil.meta.js'),
    meta.replace('// @version','// @version      2.0.0\n// @version'),meta+'alert(1)', ' '.repeat(17000), meta.replace('1.17.5','NaN')])
    assert.equal(checker.parseMetadata(bad),null);
});
test('redirects, bad HTTP status and network failure fail closed', async () => {
  for(const response of [{status:404,finalUrl:META,responseText:meta},{status:200,finalUrl:INSTALL,responseText:meta}, {status:200,responseText:meta}]) {
    const h=harness({request:o=>queueMicrotask(()=>o.onload(response))}); await h.checker.start();
    assert.equal(h.opened.length,0);assert.equal(h.states.at(-1).phase,'unavailable');
  }
  const h=harness({request:o=>queueMicrotask(()=>o.onerror())});await h.checker.start();assert.equal(h.states.at(-1).phase,'unavailable');
});
test('timeout aborts request and late successful response cannot open installer', async () => {
  let request, aborted=0; const h=harness({request:o=>{request=o;return{abort(){aborted++;}};}});
  const done=h.checker.start();h.timeout();await done;
  request.onload({status:200,finalUrl:META,responseText:meta}); await Promise.resolve();
  assert.equal(aborted,1); assert.equal(h.opened.length,0);assert.equal(h.states.at(-1).phase,'unavailable');
});
test('persistent marker suppresses future refresh offers even when previous install was declined', async () => {
  const first=harness();await first.checker.start();
  const next=harness({read:first.opts.read,write:first.opts.write});await next.checker.start();
  assert.equal(next.opened.length,0);assert.equal(next.states.at(-1).phase,'offered');
  await next.checker.manual();assert.equal(next.opened.length,1);
});
test('concurrent tabs serialize read/write/open and offer once per version', async () => {
  const store = new Map(); let queue=Promise.resolve(), count=0;
  const opts={read:(k,d)=>store.get(k)??d,write:async(k,v)=>{await Promise.resolve();store.set(k,v);},
    open:async()=>{count++;return{};},lock:(_n,_o,f)=>{const p=queue.then(()=>f({}));queue=p;return p;}};
  await Promise.all(Array.from({length:20},()=>harness(opts).checker.start())); assert.equal(count,1);
});
test('missing lock or unavailable lock never auto opens', async () => {
  for(const lock of [null,async(_n,_o,f)=>f(null),async()=>{throw Error();}]){
    const h=harness({lock});await h.checker.start();assert.equal(h.opened.length,0);
  }
});
test('storage failures prevent opening and are presented as manual fallback', async () => {
  for(const opts of [{read(){throw Error();}}, {write:async()=>{throw Error();}}, {write:null}]) {
    const h=harness(opts);await h.checker.start();assert.equal(h.opened.length,0);assert.equal(h.states.at(-1).phase,'manual');
  }
});
test('opening failure never claims installation and does not repeat automatic attempts', async () => {
  const first=harness({open:()=>{throw Error();}});await first.checker.start();assert.equal(first.states.at(-1).phase,'manual');
  const next=harness({read:first.opts.read});await next.checker.start();assert.equal(next.opened.length,0);
});
test('production wiring uses only minimum new permissions and runs once at helper boot', () => {
  assert.match(source,/\/\/ @grant\s+GM_openInTab/);assert.match(source,/\/\/ @connect\s+raw\.githubusercontent\.com/);
  assert.equal(source.split('void updateChecker.start();').length,2);
  assert.match(source,/read: key => localStorage.getItem\(key\)/);
  assert.match(source,/write: \(key, value\) => localStorage.setItem\(key, value\)/);
  assert.match(source,/data-action="update-installer" hidden/);
  assert.match(source,/Versión en ejecución: \$\{SCRIPT_VERSION\}/);
  assert.doesNotMatch(block,/eval\(|new Function|fetch\(|window.open/);
});
