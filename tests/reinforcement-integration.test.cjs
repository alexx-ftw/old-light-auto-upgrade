'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../docs/reinforcement-core.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../old-light-auto-upgrade.user.js'),'utf8');
const start=source.indexOf('// BEGIN FLEET WAIT QUEUE'),end=source.indexOf('// END FLEET WAIT QUEUE',start);
const realm=vm.createContext({TextEncoder,Date,structuredClone});
vm.runInContext(source.slice(start,end)+'\nthis.factory=createFleetWaitQueue;',realm);
const A='aaaaaaaa-0000-4000-8000-000000000001',B='bbbbbbbb-0000-4000-8000-000000000002',P='dddddddd-0000-4000-8000-000000000004',scope='galaxy/'+P;
const copy=x=>JSON.parse(JSON.stringify(x));
function setup(){let at=1000000,store={},routeStore,engine,queue,dispatches=0,active=true,coordinated=true,outcome='sent',mutate=null;
 const context=()=>({scope,originId:A,canAct:active,coordinated});
 const world={scope,galaxy:'galaxy',selfId:P,connected:true,complete:true,observedAt:at,systems:[{id:A,q:0,r:0,name:'A',fleet:core.SHIPS.map(type=>({type,quantity:type==='probe'?100:0}))},{id:B,q:5,r:0,name:'B',fleet:[]}],transits:[]};
 queue=realm.factory({load:()=>copy(store),save:x=>{store=copy(x);},now:()=>at,getContext:()=>{const job=queue?.getJobFor(context());return {...context(),active,canAct:active&&(!job||engine?.canRunJob(job))};},getFleet:()=>new Map(core.SHIPS.map(type=>[type,{parked:type==='probe'?100:0,away:0,building:0}])),dispatch:async job=>{mutate?.(job);if(!engine.canRunJob(job))return {status:'waiting'};dispatches++;return {status:outcome};}});
 engine=core.create({read:()=>routeStore,write:(_scope,state)=>routeStore=copy(state),getContext:context,getWorld:()=>world,getJobs:()=>queue.list(),queue:(s,o)=>queue.queue(s,o),cancel:id=>queue.cancel(id),now:()=>at});
 engine.save({id:'r',originId:A,destinationId:B,intervalMinutes:1,ships:{probe:{mode:'excess',reserve:20}},paused:false});
 return {engine,queue,world,setActive:x=>active=x,setCoordinated:x=>coordinated=x,setOutcome:x=>outcome=x,setMutate:f=>mutate=f,advance:ms=>{at+=ms;world.observedAt=at;},get dispatches(){return dispatches;},get routes(){return copy(routeStore);}};
}
test('real fleet queue accepts route specification and durable claim guard through send and interval',async()=>{const h=setup();assert.equal(h.engine.tick().queued.length,1);assert.equal(h.queue.list()[0].target.missionAction,'send');assert.equal(h.queue.list()[0].produce,false);assert.equal(h.engine.canRunJob(h.queue.list()[0]),true);await h.queue.tick();assert.equal(h.dispatches,1);assert.equal(h.queue.list()[0].status,'sent');h.engine.tick();assert.equal(h.engine.list()[0].nextRunAt,1060000);h.advance(59999);assert.equal(h.engine.tick().queued.length,0);h.advance(1);assert.equal(h.engine.tick().queued.length,1);await h.queue.tick();assert.equal(h.dispatches,2);});
test('real queue uncertain outcome stops recurring route and cannot dispatch again',async()=>{const h=setup();h.setOutcome('uncertain');h.engine.tick();await h.queue.tick();h.engine.tick();assert.equal(h.engine.list()[0].needsReview,true);h.advance(600000);h.engine.tick();await h.queue.tick();assert.equal(h.dispatches,1);assert.equal(h.engine.canRunJob(h.queue.list()[0]),false);});
for(const mutation of ['pause','remove','ownership','reserve','leadership'])test('real queue rechecks route '+mutation+' after claim before dispatch',async()=>{const h=setup();h.engine.tick();h.setMutate(()=>{if(mutation==='pause')h.engine.pause('r');if(mutation==='remove')h.engine.remove('r');if(mutation==='ownership')h.world.systems=h.world.systems.filter(s=>s.id!==B);if(mutation==='reserve')h.world.systems[0].fleet[0].quantity=79;if(mutation==='leadership')h.setCoordinated(false);});await h.queue.tick();assert.equal(h.dispatches,0);});
test('source wiring guards both queue selection and native final-click adapter',()=>{assert.match(source,/isCurrentMissionClaim\(job\) && isRetryMissionAllowed\(job\) && isReinforcementAllowed\(job\)/);assert.match(source,/isRetryMissionAllowed\(job\) && isReinforcementAllowed\(job\)/);assert.match(source,/coordinated: Boolean\(leader && releaseLock && navigator\.locks\?\.request\)/);assert.match(source,/for \(const id of \(typeof reinforcementRoutes[^\n]+dueOrigins/);});

test('general mission backup cannot restore a route or its dispatch authority on another installation', async()=>{
  const h=setup();h.engine.tick();const backup=h.queue.exportConfig(),id=backup.jobs[0].id;
  h.engine.remove('r');h.queue.importConfig(backup);
  assert.equal(h.engine.list().length,0);assert.equal(h.queue.list()[0].status,'paused');
  assert.equal(h.engine.canRunJob(h.queue.list()[0]),false);
  h.queue.resume(id);assert.equal(h.engine.canRunJob(h.queue.list()[0]),false);
  await h.queue.tick();assert.equal(h.dispatches,0);
});
test('restoring general mission backup on the same installation pauses its linked route for review',async()=>{
  const h=setup();h.engine.tick();h.queue.importConfig(h.queue.exportConfig());
  h.engine.tick();assert.equal(h.engine.list()[0].needsReview,true);assert.equal(h.engine.list()[0].paused,true);
  await h.queue.tick();assert.equal(h.dispatches,0);
});

test('real queue accepted send cannot repeat when paused and resumed before route reconciliation',async()=>{
  const h=setup();h.engine.tick();await h.queue.tick();assert.equal(h.dispatches,1);
  h.engine.pause('r');h.engine.resume('r');h.engine.tick();await h.queue.tick();
  assert.equal(h.dispatches,1);assert.equal(h.engine.list()[0].lastSentAt,1000000);assert.equal(h.engine.list()[0].nextRunAt,1060000);
  h.advance(1);h.engine.tick();await h.queue.tick();assert.equal(h.dispatches,1);
  h.advance(59999);h.engine.tick();await h.queue.tick();assert.equal(h.dispatches,2);
});
test('explicit review of a real uncertain queue preserves pause and prevents immediate replay',async()=>{
  const h=setup();h.setOutcome('uncertain');h.engine.tick();await h.queue.tick();h.engine.tick();
  assert.throws(()=>h.engine.remove('r'),/revis|pausad/i);assert.equal(h.engine.list().length,1);
  h.engine.acknowledgeRoute('r');assert.equal(h.engine.list()[0].paused,true);assert.equal(h.queue.list().length,0);
  h.engine.resume('r');h.engine.tick();await h.queue.tick();assert.equal(h.dispatches,1);
  h.advance(60000);h.setOutcome('sent');h.engine.tick();await h.queue.tick();assert.equal(h.dispatches,2);
});
