'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
const block = source.split('  // BEGIN PRIVATE UPDATE CHECKER\n')[1]?.split('  // END PRIVATE UPDATE CHECKER')[0];
const factory = vm.runInNewContext(block + ';createUpdateChecker', {});
const currentMeta = fs.readFileSync(path.join(__dirname, '../old-light-auto-upgrade.meta.js'), 'utf8');
const META = 'https://raw.githubusercontent.com/alexx-ftw/old-light-helper/main/old-light-auto-upgrade.meta.js';
const marker = 'old-light-helper:update-installer-offered:v1';
const response = version => ({status:200, finalUrl:META, responseText:currentMeta.replace(/(@version\s+)\S+/, `$1${version}`)});
function harness(extra={}) {
  const states=[], opened=[], store=new Map();
  const options={current:'1.17.4',status:value=>states.push(value),
    request:options=>{queueMicrotask(()=>options.onload(response('1.17.5')));return {abort(){}};},
    read:(key,def)=>store.get(key)??def,
    write:async(key,value)=>{store.set(key,value);},
    open:async(...args)=>{opened.push(args);return {};},
    lock:async(_name,_options,callback)=>callback({}),
    setTimeout:()=>1,clearTimeout(){},...extra};
  return {checker:factory(options),options,states,opened,store};
}

// VM reads from each injected script's local bridge.storages cache. UpdateValue
// acknowledges before setTimeout(commit), and broadcast does not await receivers.
// The real constructor wiring must therefore select synchronous origin storage,
// not a superficially convenient GM getter with stale per-tab snapshots.
// Official sources inspected on 2026-10-15:
// https://github.com/violentmonkey/violentmonkey/blob/master/src/injected/web/gm-api.js
// https://github.com/violentmonkey/violentmonkey/blob/master/src/background/utils/values.js
test('review: production wiring ignores delayed GM cache and offers once across tabs', async()=>{
  const backend=new Map(),caches=[new Map(),new Map()];let held=false,opened=0,gmReads=0,gmWrites=0;
  const lock=async(_name,_opts,callback)=>{
    if(held)return callback(null);
    held=true;try{return await callback({});}finally{held=false;}
  };
  const begin=source.indexOf('  const updateChecker = createUpdateChecker(');
  const end=source.indexOf('  let pending =',begin);
  assert.ok(begin>0&&end>begin);
  const wiring=source.slice(begin,end)+';this.checker=updateChecker;';
  const tabs=caches.map(cache=>{
    const context=vm.createContext({createUpdateChecker:factory,SCRIPT_VERSION:'1.17.4',
      GM_getValue:(key,def)=>{gmReads++;return cache.get(key)??def;},
      GM:{setValue:async(key,value)=>{gmWrites++;cache.set(key,value);}},
      localStorage:{getItem:key=>backend.get(key)??null,setItem:(key,value)=>backend.set(key,value)},
      GM_xmlhttpRequest:options=>{queueMicrotask(()=>options.onload(response('1.17.5')));return {abort(){}};},
      GM_openInTab:()=>{opened++;return {};},navigator:{locks:{request:lock}},
      setTimeout:()=>1,clearTimeout(){},renderUpdateStatus(){}});
    vm.runInContext(wiring,context);return context.checker;
  });
  await tabs[0].start();
  // Tab 2 already exists, but its metadata request finishes after tab 1 has
  // released the lock. Its GM snapshot still has no offer marker.
  await tabs[1].start();
  assert.equal(opened,1,'a stale per-tab cache cannot be the authoritative dedupe ledger');
  assert.equal(backend.get(marker),'1.17.5');
  assert.equal(gmReads,0);assert.equal(gmWrites,0);
});

test('review: manual click during automatic storage write does not open two installers', async()=>{
  let notifyWrite;const entered=new Promise(resolve=>notifyWrite=resolve);
  let release;const writing=new Promise(resolve=>release=resolve);
  const h=harness({write:async()=>{notifyWrite();await writing;}});
  const boot=h.checker.start();await entered;
  const click=h.checker.manual();release();await Promise.all([boot,click]);
  assert.equal(h.opened.length,1);
});

test('review: concurrent double click is single flight while still allowing later explicit retry', async()=>{
  const h=harness({lock:null});await h.checker.start();
  await Promise.all([h.checker.manual(),h.checker.manual()]);
  assert.equal(h.opened.length,1);
  await h.checker.manual();assert.equal(h.opened.length,2);
});

test('review: manual retry from an old tab cannot downgrade a newer offered marker', async()=>{
  const store=new Map();const opts={read:(key,def)=>store.get(key)??def,write:async(key,value)=>{store.set(key,value);}};
  const old=harness({...opts,lock:null});await old.checker.start();
  const latest=harness({...opts,request:options=>queueMicrotask(()=>options.onload(response('1.17.6')))});
  await latest.checker.start();assert.equal(store.get(marker),'1.17.6');
  await old.checker.manual();assert.equal(store.get(marker),'1.17.6');
  const reload=harness({...opts,request:options=>queueMicrotask(()=>options.onload(response('1.17.6')))});
  await reload.checker.start();assert.equal(reload.opened.length,0);
});

test('review: missing manager request, synchronous throw and malformed cached marker fail safely', async()=>{
  for(const extra of [{request:null},{request(){throw Error('denied');}}]){
    const h=harness(extra);await h.checker.start();assert.equal(h.opened.length,0);assert.equal(h.states.at(-1).phase,'unavailable');
  }
  const h=harness({read:()=>({url:'https://evil.invalid'})});await h.checker.start();
  assert.equal(h.opened.length,0);assert.equal(h.states.at(-1).phase,'manual');
  await h.checker.manual();assert.equal(h.opened.length,1);assert.equal(h.opened[0][0],META.replace('.meta.js','.user.js'));
});

test('review: timeout/error followed by success cannot turn failed metadata into an installer',async()=>{
  for(const fail of ['onerror','ontimeout','onabort']){
    const h=harness({request:options=>{options[fail]();options.onload(response('1.17.5'));return {abort(){}};}});
    await h.checker.start();assert.equal(h.opened.length,0);assert.equal(h.states.at(-1).phase,'unavailable');
  }
});

test('review: production status renderer keeps installed label and hides unavailable actions',()=>{
  const begin=source.indexOf('  function renderUpdateStatus()');
  const end=source.indexOf('  const updateChecker =',begin);
  const badge={textContent:'v1.17.5'},button={hidden:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;}};
  const ctx=vm.createContext({SCRIPT_VERSION:'1.17.5',updateState:{phase:'checking',version:null},
    host:{shadowRoot:{querySelector:selector=>selector.includes('script-version')?badge:button}}});
  vm.runInContext(source.slice(begin,end)+';this.render=renderUpdateStatus;',ctx);
  ctx.render();assert.equal(button.hidden,true);
  for(const phase of ['available','offered','confirm','manual']){
    ctx.updateState={phase,version:'1.18.0',busy:true};ctx.render();
    assert.equal(button.disabled,true);ctx.updateState.busy=false;ctx.render();assert.equal(button.disabled,false);
    assert.equal(button.hidden,false);assert.equal(button.textContent,'Instalar 1.18.0');assert.equal(badge.textContent,'v1.17.5');
    assert.match(button.attributes['aria-label'],/Versión en ejecución: 1.17.5/);
  }
  ctx.updateState={phase:'unavailable',version:null};ctx.render();assert.equal(button.hidden,true);
  ctx.host=null;assert.doesNotThrow(()=>ctx.render());
});


test('review: denied storage blocks automatic opening but leaves explicit manual retry usable',async()=>{
  for(const extra of [{read(){throw Error('SecurityError');}},{write(){throw Error('QuotaExceededError');}}]){
    const h=harness(extra);await h.checker.start();
    assert.equal(h.opened.length,0);assert.equal(h.states.at(-1).phase,'manual');assert.equal(h.states.at(-1).busy,false);
    await h.checker.manual();assert.equal(h.opened.length,1);assert.equal(h.states.at(-1).phase,'confirm');assert.equal(h.states.at(-1).busy,false);
  }
});
