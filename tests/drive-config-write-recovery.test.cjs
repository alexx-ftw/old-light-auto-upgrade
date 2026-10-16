'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const filename = process.env.QA_DRIVE_WRITE_SOURCE || path.join(__dirname, '..', 'old-light-auto-upgrade.user.js');
const source = fs.readFileSync(filename, 'utf8');
const KEY = 'old-light-auto-upgrade:drive:v1';
const clone = value => JSON.parse(JSON.stringify(value));
function node(tag = 'div') {
  const listeners = new Map();
  return { tag, children: [], dataset: {}, value: '', textContent: '', checked: false,
    append(...items) { this.children.push(...items); }, remove() {}, setAttribute() {},
    addEventListener(type, fn) { listeners.set(type, fn); }, emit(type) { listeners.get(type)?.(); } };
}
function harness(initialMode = 'ok') {
  let mode = initialMode;
  const initial = {clientId:'123-test.apps.googleusercontent.com',autoBackup:false,autoSync:true,
    rememberAccount:true,accountHint:'',clientIdDraft:null};
  let stored = clone(initial), readFail = false;
  const writes = [], statuses = [], root = node();
  const ctx = vm.createContext({ TextEncoder, window: {addEventListener() {},removeEventListener() {}},
    document: {createElement:node,createTextNode:text => ({textContent:text}),addEventListener() {},removeEventListener() {}},
    sessionStorage: {getItem:()=>null}, setTimeout,clearTimeout,setInterval,clearInterval,
    get(_key, fallback) { if (readFail) throw Error('synthetic read unavailable'); return _key === KEY ? clone(stored) : fallback; },
    set(key, value) {
      assert.equal(key, KEY); writes.push(clone(value));
      if (mode === 'quota') throw Error('synthetic quota');
      if (mode === 'serialization') throw TypeError('synthetic serialization failure');
      if (mode === 'false') return false;
      if (mode === 'ignore') return undefined;
      if (mode === 'async-reject') return Promise.reject(Error('synthetic manager rejection'));
      if (mode === 'async-resolve') return Promise.resolve();
      if (mode === 'read-denied') { readFail = true; return undefined; }
      stored = clone(value);
    }, onStatus: value => statuses.push(clone(value)),
  });
  const start = source.indexOf('  function createDriveBackup('), end = source.indexOf('  // END DRIVE BACKUP',start);
  vm.runInContext(source.slice(start,end) + '\nglobalThis.api=createDriveBackup({getBackup:()=>({}),applyBackup(){},gmGetValue:get,gmSetValue:set,onStatus});',ctx);
  ctx.api.mount(root);
  const all = [];
  const walk = n => { all.push(n); for (const c of n.children || []) walk(c); }; walk(root);
  const toggles = all.filter(n=>n.tag==='input' && n.type==='checkbox');
  const status = all.find(n=>n.className==='drive-field-status');
  return { api:ctx.api, initial, writes,statuses, mode:value=>{mode=value;readFail=false;},
    recreate:()=>{ctx.api.destroy();vm.runInContext('globalThis.api=createDriveBackup({getBackup:()=>({}),applyBackup(){},gmGetValue:get,gmSetValue:set,onStatus});',ctx);return clone(ctx.api.exportConfig());},
    stored:()=>clone(stored), snapshot:()=>clone(ctx.api.exportConfig()), status:()=>status.textContent,
    toggle() { toggles[1].checked = true; toggles[1].emit('change'); }, checked:()=>toggles[1].checked };
}
for (const mode of ['quota','serialization','false','ignore','async-resolve','read-denied']) {
  test('Drive config '+mode+' does not confirm or activate an unverified save and can retry', () => {
    const h = harness(mode);
    h.toggle();
    assert.deepEqual(h.snapshot(), h.initial);
    assert.equal(h.checked(), false);
    assert.match(h.status(), /No se pudo guardar/);
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.stored(), h.initial);
    h.mode('ok'); h.toggle();
    assert.equal(h.snapshot().autoBackup, true);
    assert.equal(h.stored().autoBackup, true);
    assert.match(h.status(), /guardad/i);
    h.api.destroy();
  });
}
test('Drive config rejected manager promise is consumed without an unhandled rejection or saved confirmation', () => {
  const code = `const fs=require('node:fs'), path=require('node:path');
    const file=${JSON.stringify(__filename)};
    const prefix=fs.readFileSync(file,'utf8').split('\\nfor (const mode of')[0];
    const h=new Function('require','__dirname',prefix+';return harness;')(require('node:module').createRequire(file),path.dirname(file))('async-reject');
    h.toggle(); require('node:assert/strict').match(h.status(),/No se pudo guardar/);
    setImmediate(()=>{require('node:assert/strict').deepEqual(h.snapshot(),h.initial);h.api.destroy();});`;
  const result = spawnSync(process.execPath, ['--unhandled-rejections=strict','-e',code], {encoding:'utf8',env:process.env,timeout:10000});
  assert.equal(result.status,0,result.stderr);
});
test('confirmed synchronous Drive save survives module recreation', () => {
  const h=harness();h.toggle();
  assert.equal(h.checked(),true);assert.equal(h.snapshot().autoBackup,true);
  assert.deepEqual(h.stored(),h.snapshot());assert.match(h.status(),/guardad/i);
  assert.equal(h.recreate().autoBackup,true);
  h.api.destroy();
});
