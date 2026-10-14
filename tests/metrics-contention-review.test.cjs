'use strict';
// Independent adversarial review of bounded local counter-write recovery.
// All storage, clocks and consent changes are synthetic; no external effects.
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../docs/metrics-core.js');
const clone=x=>structuredClone(x);
const g='00000000-0000-4000-8000-000000000001';
const now=Date.parse('2026-10-14T12:00:00Z');
function fixture(){
 let stored={schema:1,version:'1.16.6',generation:g,days:[{date:'2026-10-14',counts:{'helper.loaded':1}}]};
 let permission={enabled:true,generation:g},seq=1;
 const options={version:'1.16.6',now:()=>now,newGeneration:()=>`00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`,
  readConsent:()=>clone(permission),writeConsent:v=>permission=clone(v),read:()=>clone(stored),write:v=>stored=clone(v),remove:()=>stored=null};
 return {options,other:core.create(options),stored:()=>clone(stored),permission:()=>clone(permission)};
}
function contended(h,hooks={}){
 const before=h.stored(); let reads=0,writes=0; const writeValues=[];
 const a=core.create({...h.options,
  read(){const result=h.options.read();reads++;return hooks.read?.({result,reads,writes})??result;},
  write(value){writes++; writeValues.push(clone(value)); if(hooks.write?.({value,writes,reads})===true)return;
   h.options.write(writes===1?before:value);
  }});
 return {a,reads:()=>reads,writes:()=>writes,writeValues};
}
test('retry an ambiguous valid before-state once, then remain active',()=>{
 const h=fixture(),c=contended(h);
 assert.equal(c.a.record('helper.loaded'),true);
 assert.equal(c.writes(),2);
 assert.equal(c.a.getStatus().enabled,true);
 assert.equal(c.a.getStatus().storageError,false);
 assert.equal(h.stored().days[0].counts['helper.loaded'],2);
});
test('a permanently no-op adapter gets at most two attempts and fails closed',()=>{
 const h=fixture();let writes=0;
 const a=core.create({...h.options,write(){writes++;}});
 assert.equal(a.record('helper.loaded'),false);
 assert.equal(writes,2);
 assert.equal(a.getStatus().errorCode,'write-unverified');
 assert.equal(a.record('helper.loaded'),false);assert.equal(writes,2);
});
for(const action of ['off','off-on'])test(`no old event may enter a changed consent generation: ${action} after verification`,()=>{
 const h=fixture();let fired=false;
 const c=contended(h,{read({result,reads}){
  if(reads===2&&!fired){fired=true;assert.equal(h.other.setEnabled(false),true);if(action==='off-on')assert.equal(h.other.setEnabled(true),true);}
  return result;
 }});
 assert.equal(c.a.record('helper.loaded'),false);
 assert.equal(c.writeValues.filter(value=>value.days.length).length,1,'never retry a nonempty counter after consent changes');
 if(action==='off')assert.deepEqual(h.stored().days,[],'best-effort erasure must remove stale counter bytes');
 assert.deepEqual(c.a.snapshot().days,[]);assert.deepEqual(h.other.snapshot().days,[]);
 if(action==='off-on')assert.notEqual(h.permission().generation,g);
});
test('consent revocation during the fresh retry read prevents the retry write',()=>{
 const h=fixture();let fired=false;
 const c=contended(h,{read({result,reads}){
  if(reads===3&&!fired){fired=true;assert.equal(h.other.setEnabled(false),true);}
  return result;
 }});
 assert.equal(c.a.record('helper.loaded'),false);
 assert.equal(fired,true);assert.equal(c.writes(),1);
 assert.equal(h.permission().enabled,false);assert.deepEqual(c.a.snapshot().days,[]);
});
for(const action of ['off','off-on'])test(`revocation during retry write stays isolated: ${action}`,()=>{
 const h=fixture();let fired=false;
 const c=contended(h,{write({value,writes}){
  if(writes===2){fired=true;assert.equal(h.other.setEnabled(false),true);if(action==='off-on')assert.equal(h.other.setEnabled(true),true);h.options.write(value);return true;}
 }});
 assert.equal(c.a.record('helper.loaded'),false);assert.equal(fired,true);
 assert.deepEqual(c.a.snapshot().days,[]);assert.deepEqual(h.other.snapshot().days,[]);
 if(action==='off'){assert.equal(h.permission().enabled,false);assert.deepEqual(h.stored().days,[]);}
 else{assert.notEqual(h.permission().generation,g);assert.equal(c.a.record('settings.changed'),true);assert.deepEqual(c.a.snapshot().days[0].counts,{'settings.changed':1});}
});
test('retry rereads fresh counters instead of replacing independent concurrent events',()=>{
 const h=fixture();let fired=false;
 const c=contended(h,{read({result,reads}){
  if(reads===2&&!fired){fired=true;assert.equal(h.other.record('settings.changed'),true);}
  return result;
 }});
 assert.equal(c.a.record('helper.loaded'),true);assert.equal(c.writes(),2);
 assert.deepEqual(c.a.snapshot().days[0].counts,{'helper.loaded':2,'settings.changed':1});
});
for(const mode of ['throw','false','malformed'])test(`a real first-write failure (${mode}) never retries`,()=>{
 const h=fixture();let writes=0;
 const a=core.create({...h.options,write(value){writes++;
  if(mode==='throw')throw Error('synthetic');if(mode==='false')return false;
  value.days[0].counts['private.forbidden']=1;h.options.write(value);
 }});
 assert.equal(a.record('helper.loaded'),false);assert.equal(writes,1);
 assert.equal(a.getStatus().enabled,false);assert.equal(a.getStatus().storageError,true);
});
test('a read failure during retry remains fail-closed',()=>{
 const h=fixture();let failed=false;
 const c=contended(h,{read({reads}){if(reads===3){failed=true;throw Error('synthetic');}}});
 assert.equal(c.a.record('helper.loaded'),false);assert.equal(failed,true);assert.equal(c.writes(),1);
 assert.equal(c.a.getStatus().errorCode,'read-failed');assert.equal(c.a.getStatus().enabled,false);
});
test('a newer snapshot restoring the original event must not cause a duplicate retry',()=>{
 const h=fixture();assert.equal(h.other.record('settings.changed'),true);
 // B had prepared settings.changed from a snapshot without that counter.
 // Another writer already completed that same increment, yielding our before
 // state {helper.loaded:1, settings.changed:1}. A then writes helper.loaded:2.
 // C reads A's state and prepares backup.exported. B's old write temporarily
 // restores beforeState; after A verifies B's snapshot, C restores A's count.
 const before=h.stored();let recovered=null,fired=false;
 const c=contended(h,{
  write({value,writes}){if(writes===1){recovered=clone(value);recovered.days[0].counts['backup.exported']=1;h.options.write(before);return true;}},
  read({result,reads}){if(reads===2&&!fired){fired=true;h.options.write(recovered);}return result;}
 });
 c.a.record('helper.loaded');
 assert.equal(c.a.getStatus().enabled,true);
 assert.deepEqual(c.a.snapshot().days[0].counts,{'helper.loaded':2,'settings.changed':1,'backup.exported':1});
 assert.ok(c.writes()<=2,'at most one canonicalizing verification write is allowed');
});
for(const mode of ['throw','false','malformed'])test(`a real second-write failure (${mode}) cannot get a third attempt`,()=>{
 const h=fixture();let writes=0;
 const a=core.create({...h.options,write(value){writes++;
  if(writes===1)return;
  if(mode==='throw')throw Error('synthetic');if(mode==='false')return false;
  value.days[0].counts['private.forbidden']=1;h.options.write(value);
 }});
 assert.equal(a.record('helper.loaded'),false);assert.equal(writes,2);
 assert.equal(a.getStatus().enabled,false);assert.equal(a.getStatus().storageError,true);
});
test('a clock failure before retry cannot record on another day',()=>{
 const h=fixture();let currentTime=now;h.options.now=()=>currentTime;
 const c=contended(h,{read({result,reads}){if(reads===2)currentTime=NaN;return result;}});
 assert.equal(c.a.record('helper.loaded'),false);assert.equal(c.writes(),1);
 currentTime=now;assert.equal(c.a.getStatus().errorCode,'invalid-clock');assert.equal(c.a.getStatus().enabled,false);
});
test('retry dominance respects UTC retention without adding the event on the new day',()=>{
 const h=fixture();let currentTime=now;h.options.now=()=>currentTime;
 const initial=h.stored();initial.days.unshift({date:'2026-09-15',counts:{'backup.exported':4}});h.options.write(initial);
 let recovered=null,fired=false;
 const c=contended(h,{
  write({value,writes}){if(writes===1){recovered=clone(value);h.options.write(initial);return true;}},
  read({result,reads}){if(reads===2&&!fired){fired=true;currentTime=Date.parse('2026-10-15T00:00:00Z');recovered.days=recovered.days.filter(d=>d.date!=='2026-09-15');h.options.write(recovered);}return result;}
 });
 assert.equal(c.a.record('helper.loaded'),true);assert.equal(c.a.getStatus().enabled,true);
 assert.deepEqual(c.a.snapshot().days,[{date:'2026-10-14',counts:{'helper.loaded':2}}]);
 assert.ok(c.writes()<=2);
});
