'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {create}=require(process.env.QA_CONQUEST_CONTROLLER_SOURCE||'../docs/conquest-controller.js');
const source=fs.readFileSync(path.join(__dirname,'../old-light-auto-upgrade.user.js'),'utf8');
const start=source.indexOf('// BEGIN FLEET WAIT QUEUE'),end=source.indexOf('// END FLEET WAIT QUEUE',start);
const queueFactory=vm.runInNewContext(source.slice(start,end)+'\ncreateFleetWaitQueue;',{TextEncoder,Date,structuredClone});
const clone=x=>JSON.parse(JSON.stringify(x)),uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),scope='galaxy/'+uuid(1),fleet=n=>({probe:0,marauder:n,sentinel:0,vanguard:0});
function harness(){let clock=1000,objectiveStore,queueStore={},coordinator,queue,failObjectiveWrite=false;
 const context={scope,originId:uuid(2),originName:'Origin',selectionCount:1,active:true,canAct:true},events=[];
 const world={scope,complete:true,connected:true,observedAt:clock,systems:[{id:uuid(2),q:0,r:0,name:'Origin',fleet:Object.entries(fleet(20)).map(([type,quantity])=>({type,quantity}))}],transits:[]};
 const queueDeps={load:()=>clone(queueStore),save:v=>{queueStore=clone(v);return true},now:()=>clock,getContext:()=>({...context,canAct:context.canAct&&(!queue?.list().length||coordinator?.canRunJob(clone(queue.list()[0]))===true)}),
  getFleet:()=>new Map(Object.entries(fleet(20)).map(([id,parked])=>[id,{parked,away:0,building:0}])),
  dispatch:async job=>{events.push({job:clone(job),current:coordinator.canRunJob(clone(job))});return {status:'sent',message:'Offline native acceptance witness'};}};
 queue=queueFactory(queueDeps);
 const deps={read:()=>objectiveStore,write:v=>{if(failObjectiveWrite)return false;objectiveStore=clone(v);return true},getContext:()=>context,getWorld:()=>world,
  getJobs:()=>clone(queue.list()),queue:(spec,options)=>queue.queue(spec,options),cancel:id=>queue.cancel(id),cancelPreparing:()=>false,
  getTargetOwner:()=>({scope,ownerId:uuid(90),ownerName:'Enemy',epoch:1,generation:1,observedAt:world.observedAt}),isTargetAllowed:()=>true,
  now:()=>clock,newId:()=>uuid(10)};
 coordinator=create(deps);
 return {coordinator,get queue(){return queue},events,world,context,add(){return coordinator.add({target:{q:2,r:1,name:'Target'},fleet:fleet(6),defense:fleet(2),maxRaids:3,maxLosses:20})},
  set failObjectiveWrite(v){failObjectiveWrite=v},get stored(){return clone(objectiveStore)},set clock(v){clock=v},
  reloadQueue(){queue.destroy();queue=queueFactory(queueDeps);},corruptJob(job){queueStore={schemaVersion:1,jobs:[job]};queue.refreshConfig();}};
}
test('actual normalized queue target preserves conquest ownership and permits one valid native claim',async()=>{
 const h=harness();h.add();h.coordinator.tick();h.coordinator.tick();const job=clone(h.queue.list()[0]);
 assert.equal(job.campaignId,'conquest:'+uuid(10));assert.equal(h.coordinator.canRunJob(job),true,'target key order is immaterial after production queue normalization');
 await h.queue.tick();assert.equal(h.events.length,1);assert.equal(h.events[0].job.status,'sending');assert.equal(h.events[0].current,true);h.coordinator.tick();assert.equal(h.coordinator.list()[0].status,'awaiting_report');
 for(let i=0;i<4;i++){h.coordinator.tick();await h.queue.tick();}assert.equal(h.events.length,1);
});
test('a queue accepted before objective confirmation cannot dispatch through a false write; reconciliation recovers once',async()=>{
 const h=harness();h.add();h.coordinator.tick();h.failObjectiveWrite=true;h.coordinator.tick();assert.equal(h.queue.list().length,1);assert.equal(h.coordinator.diagnostics().writeBlocked,true);
 await h.queue.tick();assert.equal(h.events.length,0);assert.equal(h.coordinator.canRunJob(clone(h.queue.list()[0])),false);
 h.failObjectiveWrite=false;h.coordinator.tick();assert.equal(h.coordinator.diagnostics().writeBlocked,false);await h.queue.tick();assert.equal(h.events.length,1);
});
test('native queue recovery converts sending to uncertain and conquest never repeats the interrupted send',async()=>{
 const h=harness();h.add();h.coordinator.tick();h.coordinator.tick();const job=clone(h.queue.list()[0]);job.status='sending';job.claimedAt=1000;h.corruptJob(job);h.reloadQueue();
 assert.equal(h.queue.list()[0].status,'uncertain');h.coordinator.tick();assert.equal(h.coordinator.list()[0].status,'uncertain');await h.queue.tick();assert.equal(h.events.length,0);
});
test('pausing a conquest invalidates native activation and cancels only its unsent queue claim',async()=>{
 const h=harness();const o=h.add();h.coordinator.tick();h.coordinator.tick();const old=clone(h.queue.list()[0]);h.coordinator.pause(o.id);assert.equal(h.queue.list().length,0);assert.equal(h.coordinator.canRunJob(old),false);await h.queue.tick();assert.equal(h.events.length,0);
});
test('queue rejects absent mismatched or malformed conquest owners without accepting a mission',()=>{
 const h=harness();h.add();h.coordinator.tick();h.coordinator.tick();const spec=clone(h.queue.list()[0]);h.coordinator.pause(uuid(10));
 for(const options of [{id:'conquest:'+uuid(10)+':2'},{id:'conquest:'+uuid(11)+':2',campaignId:'conquest:'+uuid(10)},{id:'conquest:'+uuid(10)+':0',campaignId:'conquest:'+uuid(10)},{id:'conquest:'+uuid(10)+':1001',campaignId:'conquest:'+uuid(10)}]){
  assert.throws(()=>h.queue.queue(spec,options));assert.equal(h.queue.list().length,0);
 }
});
test('importing an empty production queue after acceptance before reconciliation never dispatches the same conquest claim twice',async()=>{
 const h=harness();h.add();h.coordinator.tick();h.coordinator.tick();await h.queue.tick();assert.equal(h.events.length,1);assert.equal(h.stored.objectives[0].ticket.state,'queued');assert.equal(h.queue.list()[0].status,'sent');h.queue.importConfig({schemaVersion:1,jobs:[]});h.clock=2000;h.world.observedAt=2000;h.coordinator.tick();await h.queue.tick();assert.equal(h.events.length,1);assert.equal(h.coordinator.list()[0].status,'uncertain');for(let i=0;i<4;i++){h.coordinator.tick();await h.queue.tick();}assert.equal(h.events.length,1);
});
test('imported paused conquest jobs without matching local objectives cannot activate',async()=>{
 const h=harness();h.add();h.coordinator.tick();h.coordinator.tick();const exported=clone(h.queue.exportConfig());const other=harness();other.queue.importConfig(exported);assert.equal(other.queue.list()[0].status,'paused');assert.equal(other.coordinator.canRunJob(clone(other.queue.list()[0])),false);await other.queue.tick();assert.equal(other.events.length,0);
});
