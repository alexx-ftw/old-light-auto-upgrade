'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),core=require('../docs/metrics-core.js');
const G='00000000-0000-4000-8000-000000000001',NEXT='00000000-0000-4000-8000-000000000002',NOW=Date.parse('2026-10-17T12:00:00Z');
function shared(){let raw,permission={enabled:true,generation:G},writes=0,consentWrites=0,beforeRead=null;
 const clone=x=>x===undefined?x:structuredClone(x);
 const options={now:()=>NOW,performanceNow:()=>1,read:()=>{beforeRead?.();return clone(raw);},write:v=>{writes++;raw=clone(v);},readConsent:()=>clone(permission),writeConsent:v=>{consentWrites++;permission=clone(v);},remove:()=>{raw=undefined;},newGeneration:()=>NEXT};
 return {make:version=>core.create({...options,version}),options,get raw(){return clone(raw);},set raw(v){raw=clone(v);},get permission(){return clone(permission);},get writes(){return writes;},get consentWrites(){return consentWrites;},hook(fn){beforeRead=fn;}};}
test('older cooperative metrics cannot erase a newer release through sequential recording',()=>{
 const h=shared(),old=h.make('1.17.34'),current=h.make('1.17.35');
 current.record('helper.loaded');current.record('automation.failed');const before=h.raw;
 assert.equal(old.record('ui.tab.empire'),false);assert.deepEqual(h.raw,before);assert.equal(h.consentWrites,0);
 assert.equal(current.record('settings.changed'),true);assert.equal(current.getStatus().total,3);
 assert.equal(old.getStatus().storageError,false);assert.equal(old.getStatus().errorCode,'newer-version');assert.deepEqual(old.snapshot().days,[]);
});
test('same release metrics still accumulate sequential events across tabs',()=>{
 const h=shared(),a=h.make('1.17.35'),b=h.make('1.17.35');
 assert.equal(a.record('helper.loaded'),true);assert.equal(b.record('settings.changed'),true);assert.equal(a.record('ui.tab.data'),true);assert.equal(b.getStatus().total,3);
});
test('a newer release resets old counters once while an older cooperative writer cannot reset them back',()=>{
 const h=shared(),a=h.make('1.17.34'),b=h.make('1.17.35');a.record('helper.loaded');a.record('settings.changed');
 assert.equal(b.record('helper.loaded'),true);assert.equal(b.getStatus().total,1);assert.equal(a.record('ui.tab.data'),false);
 assert.equal(b.record('settings.changed'),true);assert.equal(b.getStatus().total,2);assert.equal(h.permission.enabled,true);
});
test('metrics release ordering compares numeric components instead of strings',()=>{
 for(const [oldVersion,newVersion] of [['1.17.9','1.17.10'],['1.9.99','1.10.0'],['9.99.99','10.0.0']]){
  const h=shared(),old=h.make(oldVersion),current=h.make(newVersion);current.record('helper.loaded');assert.equal(old.record('ui.tab.data'),false);assert.equal(current.getStatus().total,1);
 }
});
test('an explicit opt-out from an older cooperative tab still erases newer counters and revokes consent',()=>{
 const h=shared(),a=h.make('1.17.34'),b=h.make('1.17.35');b.record('helper.loaded');assert.equal(a.record('settings.changed'),false);
 assert.equal(a.setEnabled(false),true);assert.equal(h.permission.enabled,false);assert.deepEqual(h.raw.days,[]);assert.deepEqual(b.snapshot().days,[]);
});
test('a stale consent generation is ignored rather than treated as a newer active metrics release',()=>{
 const h=shared(),a=h.make('1.17.34');h.raw={schema:1,version:'99.0.0',generation:NEXT,days:[]};assert.equal(a.record('helper.loaded'),true);assert.equal(a.getStatus().total,1);
});
test('a sampled step from an older release cannot overwrite newer counters when it finishes',()=>{
 const h=shared(),old=h.make('1.17.34'),current=h.make('1.17.35'),token=old.startTiming();assert.ok(token);current.record('helper.loaded');const before=h.raw;
 assert.equal(old.finishTiming(token),false);assert.deepEqual(h.raw,before);
});
