'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const core=require('../docs/conquest-core.js');
// Reuse native wire fixtures, not a copy of the ownership reducer or planner.
const file=path.join(__dirname,'empire-observer.test.cjs'),source=fs.readFileSync(file,'utf8'),prefix=source.slice(0,source.indexOf("test('world.init returns"));
const fixtures=vm.runInNewContext(prefix+'\n({ready,init,player,system,SELF,OTHER,NOW});',{require:createRequire(file),__dirname:__dirname,process,Date});
const s='alpha/'+fixtures.SELF,target={q:20,r:-20};
test('conquest ownership proof comes from the actual native observer positive coordinate claims',()=>{
 const {reducer}=fixtures.ready();const w=reducer.snapshot(),proof=core.ownerFor(w,s,target,fixtures.NOW);
 assert.equal(w.ownership.complete,false,'positive claims are not a complete galaxy census');assert.equal(proof.ownerId,fixtures.OTHER);assert.equal(proof.epoch,1);assert.equal(proof.generation,1);
 assert.equal(core.ownerFor(w,s,{q:999,r:999},fixtures.NOW),null,'missing rivals are unknown, not dormant or safe');
});
test('ownership proof is revoked by native disconnect stale data changed account or ambiguous coordinates',()=>{
 const {reducer,token}=fixtures.ready();const w=reducer.snapshot();assert.equal(core.ownerFor(w,s,target,fixtures.NOW+core.MAX_AGE+1),null);assert.equal(core.ownerFor(w,'other/account',target,fixtures.NOW),null);
 w.ownership.players.push({...w.ownership.players[1],id:fixtures.SELF});assert.equal(core.ownerFor(w,s,target,fixtures.NOW),null);
 reducer.loseConnection(token);assert.equal(core.ownerFor(reducer.snapshot(),s,target,fixtures.NOW),null);
});
test('cached ownership requires the live bridge to remain settled and is invalidated by each accepted update',()=>{
 const {reducer}=fixtures.ready();let w=reducer.snapshot(),settled=true,reads=0,at=fixtures.NOW,notify;
 const bridge={status:()=>({connected:settled,complete:true}),snapshot:()=>{reads++;return structuredClone(w)},subscribe:fn=>{notify=fn;return()=>{notify=null}}};
 const reader=core.createOwnerReader({getBridge:()=>bridge,now:()=>at});assert.equal(reader.read(s,target).ownerId,fixtures.OTHER);assert.equal(reader.read(s,target).ownerId,fixtures.OTHER);assert.equal(reads,1);
 settled=false;assert.equal(reader.read(s,target),null,'pending private bridge publication revokes authority before the callback');
 settled=true;w.ownership.players[1].id='00000000-0000-4000-8000-000000000099';w.revision++;notify();assert.equal(reader.read(s,target).ownerId,w.ownership.players[1].id);assert.equal(reads,2);
 at+=core.MAX_AGE+1;assert.equal(reader.read(s,target),null,'cache cannot renew the source freshness timestamp');reader.destroy();
});
test('reentrant accepted update during snapshot read cannot cache old authority',()=>{
 const {reducer}=fixtures.ready();const w=reducer.snapshot();let notify;
 const bridge={status:()=>({connected:true,complete:true}),snapshot:()=>{notify();return structuredClone(w)},subscribe:fn=>{notify=fn;return()=>{}}};
 const reader=core.createOwnerReader({getBridge:()=>bridge,now:()=>fixtures.NOW});assert.equal(reader.read(s,target),null);
});
