'use strict';
// Deterministic copy counts and lifecycle invariants, not a wall-clock threshold.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const observer=require('../docs/empire-observer.js');
const fixturePath=path.join(__dirname,'empire-observer.test.cjs'),input=fs.readFileSync(fixturePath,'utf8');
const fixture=Function('require',input.slice(0,input.indexOf("test('world.init"))+'\nreturn {uuid,SELF,OTHER,NOW,frame,system,player,init,ready};')(createRequire(fixturePath));
const {uuid,SELF,OTHER,NOW,frame,system,player,init,ready}=fixture;
const source=fs.readFileSync(require.resolve('../docs/empire-observer.js'),'utf8');
function consistent(r){const s=r.snapshot(),stamp=r.stamp();assert.deepEqual(Object.keys(stamp).sort(),['connected','epoch','generation','observedAt','revision']);for(const k of Object.keys(stamp))assert.equal(stamp[k],s[k]);assert.equal(r.canDeferPublication(),s.complete&&s.ownership!==null);}
function bigInit(n){return{selfId:SELF,serverNow:NOW,world:{players:[player(SELF,[system(10)]),...Array.from({length:n-1},(_,i)=>({id:uuid(i+2),name:'Synthetic '+i,owned:[{q:i+100,r:0}]}))]}};}
function installed(n){
 const tasks=new Map(),messages=[],pending=[];let seq=0;
 class Socket{constructor(){this.listeners=new Map();}addEventListener(t,f){this.listeners.set(t,f);}removeEventListener(t){this.listeners.delete(t);}emit(data){this.listeners.get('message')?.({data,isTrusted:true});}}
 const sandbox={__copies:0,__ownershipValidations:0,__indexCellVisits:0,URL,Proxy,Reflect,Date,setTimeout(fn){tasks.set(++seq,fn);return seq;},clearTimeout(id){tasks.delete(id);},location:{origin:'https://oldlight.io',pathname:'/game/galaxy/alpha'},WebSocket:Socket};
 vm.createContext(sandbox);vm.runInContext(source.replace('function snapshot() {','function snapshot() { realm.__copies++;').replace('function ownershipPlayers(value) {','function ownershipPlayers(value) { realm.__ownershipValidations++;').replaceAll('for (const key of old.cells.keys()) coordinates.delete(key);','for (const key of old.cells.keys()) { realm.__indexCellVisits++; coordinates.delete(key); }'),sandbox);
 const handle=sandbox.OldLightEmpireObserver.installPageObserver({channel:'bounded-fixture',emit:p=>messages.push(p.snapshot),onPending:p=>pending.push(p)});
 const socket=new sandbox.WebSocket('wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket');
 const flush=()=>{while(tasks.size){const [id,fn]=tasks.entries().next().value;tasks.delete(id);fn();}};
 socket.emit(frame('world.init',bigInit(n)));flush();sandbox.__copies=0;
 return{sandbox,socket,tasks,messages,pending,flush,handle};
}
test('scalar stamp and deferred classification match snapshots across native lifecycle variants',()=>{
 for(const value of [init(),init(player(SELF,[])),init({...player(),transits:undefined}),init({...player(),eliminatedAt:new Date(NOW).toISOString()}),bigInit(1000)]){
  const {reducer:r,token}=ready(value);consistent(r);const stamp=r.stamp();stamp.revision=999;assert.notEqual(r.stamp().revision,999);
  for(const delta of [{},{updated:{players:[]}},{updated:{players:[{id:OTHER,name:'Renamed',owned:[]}]}},{updated:{dirtySectors:[{sq:1,sr:2}]}}]){r.ingest(frame('world.delta',delta),token);consistent(r);}
  r.loseConnection(token);consistent(r);r.beginConnection();consistent(r);r.ingest(frame('world.delta',{}));consistent(r);
 }
});
test('transit overflow and self claim mismatch cannot become deferred valid observations',()=>{
 const p=init(),t=p.world.players[0].transits[0];t.ships=[{type:'probe',quantity:Number.MAX_SAFE_INTEGER}];p.world.players[0].transits.push({...t,id:uuid(99999)});
 const r=ready(p).reducer;consistent(r);assert.equal(r.canDeferPublication(),false);
 const c=ready();c.reducer.ingest(frame('world.delta',{updated:{players:[{id:OTHER,owned:[{q:10,r:-10}]}]}}),c.token);consistent(c.reducer);assert.equal(c.reducer.snapshot().systems.length,0);
});
test('100 native deltas use scalar invalidation each time and only one full snapshot at publication',()=>{
 const h=installed(1000);try{
  for(let i=0;i<100;i++)h.socket.emit(frame('world.delta',{}));
  assert.equal(h.sandbox.__copies,0);assert.equal(h.tasks.size,1);assert.equal(h.pending.at(-1).revision,100);
  assert.deepEqual(Object.keys(h.pending.at(-1)).sort(),['connected','epoch','generation','observedAt','revision']);
  h.flush();assert.equal(h.sandbox.__copies,1);assert.equal(h.messages.at(-1).revision,100);assert.equal(h.messages.at(-1).ownership.players.length,1000);
 }finally{h.handle.stop();}
});
test('ownership lifecycle remains bounded and removals/reset retain no stale public owners',()=>{
 const h=installed(10000);try{
  assert.equal(h.messages.at(-1).ownership.players.length,10000);
  h.socket.emit(frame('world.delta',{removed:{playerIds:Array.from({length:9999},(_,i)=>uuid(i+2))}}));h.flush();assert.equal(h.messages.at(-1).ownership.players.length,1);
  h.socket.emit(frame('world.init',{selfId:SELF,serverNow:NOW,world:{players:[player(SELF,[])]}}));h.flush();assert.equal(h.messages.at(-1).systems.length,0);assert.equal(h.messages.at(-1).ownership.players.length,1);assert.equal(h.messages.at(-1).ownership.players[0].owned.length,0);
  h.socket.emit('42["world.delta",{');assert.equal(h.messages.at(-1).ownership,null);assert.equal(h.messages.at(-1).connected,false);assert.equal(h.tasks.size,0);
 }finally{h.handle.stop();}
});
test('empty delta fast-path never recovers unknown or dirty ownership',()=>{
 const {reducer:r,token}=ready();r.ingest(frame('world.delta',{updated:{dirtySectors:[{sq:0,sr:0}]}}),token);for(let i=0;i<20;i++)r.ingest(frame('world.delta',{}),token);assert.equal(r.snapshot().ownership,null);assert.equal(r.canDeferPublication(),false);
 r.ingest(frame('world.init',init()),token);assert.ok(r.snapshot().ownership);consistent(r);
});
test('economic bridge reads omit third-party projection while retaining identity, copies and pending gate',()=>{
 const p=path.join(__dirname,'empire-bridge.test.cjs'),s=fs.readFileSync(p,'utf8');const {harness,validSnapshot}=Function('require',s.slice(0,s.indexOf("test('early bootstrap"))+'\nreturn{harness,validSnapshot};')(createRequire(p));
 const h=harness(),value=validSnapshot();h.send(value);const full=h.app.snapshot(),economic=h.app.snapshot({includeOwnership:false});assert.ok(full.ownership);assert.equal(economic.ownership,null);assert.equal(economic.scope,full.scope);assert.deepEqual(economic.systems,full.systems);
 economic.systems[0].name='Changed copy';assert.equal(h.app.snapshot({includeOwnership:false}).systems[0].name,'Sede');
 h.pending({...value,revision:1});assert.equal(h.app.snapshot(),null);assert.equal(h.app.snapshot({includeOwnership:false}),null);h.app.stop();assert.equal(h.app.snapshot({includeOwnership:false}),null);
 const helper=fs.readFileSync(path.join(__dirname,'..','old-light-auto-upgrade.user.js'),'utf8');assert.match(helper,/empireAdapter = native.create\(\{ getWorld: \(\) => bridge\?\.snapshot\?\.\(\{ includeOwnership: false \}\)/);assert.match(helper,/getWorld: \(\) => globalThis.OldLightEmpireBridge\?\.snapshot\?\.\(\)/);
});

test('repeated public claims on economic deltas avoid whole-owner reduction without retaining stale names',()=>{
 const h=installed(1000);try{
  h.socket.emit(frame('world.delta',{updated:{players:[{id:uuid(2),name:'Synthetic 0',owned:[]}]}}));h.flush();h.sandbox.__copies=0;h.sandbox.__ownershipValidations=0;
  for(let i=0;i<100;i++)h.socket.emit(frame('world.delta',{updated:{players:[{id:uuid(2),name:'Synthetic 0',owned:[]}]}}));
  assert.equal(h.sandbox.__ownershipValidations,0);assert.equal(h.sandbox.__copies,0);h.flush();assert.equal(h.sandbox.__copies,1);assert.equal(h.sandbox.__ownershipValidations,0);
  h.socket.emit(frame('world.delta',{updated:{players:[{id:uuid(2),name:'Changed identity label',owned:[{q:99999,r:0}]}]}}));h.flush();const p=h.messages.at(-1).ownership.players.find(p=>p.id===uuid(2));assert.equal(p.name,'Changed identity label');assert.equal(p.owned[0].q,99999);
  h.socket.emit(frame('world.delta',{updated:{dirtySectors:[{sq:1,sr:1}]}}));assert.equal(h.messages.at(-1).ownership,null);h.socket.emit(frame('world.delta',{updated:{players:[{id:uuid(2),name:'Synthetic 0',owned:[]}]}}));assert.equal(h.messages.at(-1).ownership,null);
 }finally{h.handle.stop();}
});
test('100 distinct native owner deltas and one bulk delta copy only at publication',()=>{
 const h=installed(10000);try{
  for(let i=0;i<100;i++)h.socket.emit(frame('world.delta',{updated:{players:[{id:uuid(2+i),name:'Distinct '+i,owned:[]}]}}));
  assert.equal(h.sandbox.__copies,0);assert.equal(h.tasks.size,1);h.flush();assert.equal(h.sandbox.__copies,1);assert.equal(h.messages.at(-1).ownership.players.length,10000);
  for(let i=0;i<100;i++)assert.equal(h.messages.at(-1).ownership.players.find(p=>p.id===uuid(2+i)).name,'Distinct '+i);
  h.sandbox.__copies=0;
  const updates=Array.from({length:100},(_,i)=>({id:uuid(i+2),name:'Bulk '+i,owned:[{q:i+30000,r:1}]}));
  h.socket.emit(frame('world.delta',{updated:{players:updates}}));assert.equal(h.sandbox.__copies,0);h.flush();assert.equal(h.sandbox.__copies,1);
  for(const expected of updates){const actual=h.messages.at(-1).ownership.players.find(p=>p.id===expected.id);assert.equal(actual.name,expected.name);assert.equal(actual.owned[0].q,expected.owned[0].q);}
 }finally{h.handle.stop();}
});
test('indexed reciprocal swaps, ignored additions and overflow preserve native final-state semantics',()=>{
 const {reducer:r,token}=ready();
 r.ingest(frame('world.delta',{updated:{players:[{id:SELF,owned:[system(20)],transits:[]},{id:OTHER,owned:[{q:10,r:-10}]}]}}),token);consistent(r);assert.ok(r.snapshot().ownership);assert.equal(r.snapshot().ownership.players.find(p=>p.id===SELF).owned[0].q,20);
 r.ingest(frame('world.delta',{added:{players:[{...player(SELF,[system(10)]),name:'Ignored'}]}}),token);consistent(r);assert.equal(r.snapshot().ownership.players.find(p=>p.id===SELF).name,undefined);assert.equal(r.snapshot().ownership.players.find(p=>p.id===OTHER).owned.length,0);
 const initial=bigInit(10000),large=ready(initial);large.reducer.ingest(frame('world.delta',{added:{players:[{id:uuid(20000),owned:[{q:999999,r:0}]}]}}),large.token);assert.equal(large.reducer.snapshot().ownership,null);assert.equal(large.reducer.canDeferPublication(),false);
 large.reducer.ingest(frame('world.delta',{}),large.token);assert.equal(large.reducer.snapshot().ownership,null);large.reducer.ingest(frame('world.init',init()),large.token);assert.equal(large.reducer.snapshot().ownership.players.length,2);consistent(large.reducer);
});

test('100 name-only changes to one owner of9999cells do not scan its unchanged index per event',()=>{
 const h=installed(2);try{
  const initial=bigInit(2);initial.world.players[1].owned=Array.from({length:9999},(_,i)=>({q:i+100,r:0}));h.socket.emit(frame('world.init',initial));h.flush();h.sandbox.__copies=0;h.sandbox.__indexCellVisits=0;
  for(let i=0;i<100;i++)h.socket.emit(frame('world.delta',{updated:{players:[{id:uuid(2),name:'Large owner '+i,owned:[]}]}}));
  assert.equal(h.sandbox.__indexCellVisits,0);assert.equal(h.sandbox.__copies,0);h.flush();assert.equal(h.sandbox.__copies,1);assert.equal(h.messages.at(-1).ownership.players[1].owned.length,9999);assert.equal(h.messages.at(-1).ownership.players[1].name,'Large owner 99');
 }finally{h.handle.stop();}
});
