'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../docs/reinforcement-core.js');
const source=fs.readFileSync(process.env.QA_REINFORCEMENT_QUEUE_SOURCE || require('node:path').join(__dirname,'../old-light-auto-upgrade.user.js'),'utf8');
const start=source.indexOf('// BEGIN FLEET WAIT QUEUE'),end=source.indexOf('// END FLEET WAIT QUEUE',start);
const realm=vm.createContext({TextEncoder,Date,structuredClone});
vm.runInContext(source.slice(start,end)+'\nthis.factory=createFleetWaitQueue;',realm);
const A='aaaaaaaa-0000-4000-8000-000000000001',B='bbbbbbbb-0000-4000-8000-000000000002',P='dddddddd-0000-4000-8000-000000000004',scope='galaxy/'+P;
const copy=x=>JSON.parse(JSON.stringify(x));
function setup(options={}){let at=1000000,store={},routeStore,engine,queue,dispatches=0,active=true,coordinated=true,outcome='sent',mutate=null,onSave=null;
 const context=()=>({scope,originId:A,canAct:active,coordinated});
 const world={scope,galaxy:'galaxy',selfId:P,connected:true,complete:true,observedAt:at,systems:[{id:A,q:0,r:0,name:'A',fleet:core.SHIPS.map(type=>({type,quantity:type==='probe'?100:0}))},{id:B,q:5,r:0,name:'B',fleet:[]}],transits:[]};
 queue=realm.factory({load:()=>copy(store),save:x=>{store=copy(x);onSave?.(copy(x));},now:()=>at,getContext:()=>{const job=queue?.getJobFor(context());return {...context(),active,canAct:active&&(options.queueGuardsOnly||!job||engine?.canRunJob(job))};},getRouteState:options.omitRouteState ? undefined : options.getRouteState || (job=>engine?.jobState(job)),getFleet:()=>{options.onFleet?.(engine);return new Map(core.SHIPS.map(type=>[type,{parked:type==='probe'?100:0,away:0,building:0}]));},dispatch:async job=>{mutate?.(job);if(!options.queueGuardsOnly&&!engine.canRunJob(job))return {status:'waiting'};dispatches++;return {status:outcome};}});
 engine=core.create({read:()=>routeStore,write:(_scope,state)=>routeStore=copy(state),getContext:context,getWorld:()=>world,getJobs:()=>queue.list(),queue:(s,o)=>queue.queue(s,o),cancel:id=>queue.cancel(id),now:()=>at});
 engine.save({id:'r',originId:A,destinationId:B,intervalMinutes:1,ships:{probe:{mode:'excess',reserve:20}},paused:false});
 return {engine,queue,world,setActive:x=>active=x,setCoordinated:x=>coordinated=x,setOutcome:x=>outcome=x,setMutate:f=>mutate=f,setOnSave:f=>onSave=f,get stored(){return copy(store);},set stored(x){store=copy(x);},advance:ms=>{at+=ms;world.observedAt=at;},get dispatches(){return dispatches;},get routes(){return copy(routeStore);}};
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
  assert.throws(()=>h.queue.resume(id),/ruta|refuerzo/i);assert.equal(h.engine.canRunJob(h.queue.list()[0]),false);
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


// These cases use the real queue and route stores. They do not rely on the
// outer native-dispatch adapter to repair an unsafe or misleading queue state.
test('queue pause followed by route reconciliation cannot be undone by queue resume',async()=>{
  const h=setup({queueGuardsOnly:true});h.engine.tick();const id=h.queue.list()[0].id;
  h.queue.pause(id);h.engine.tick();
  assert.equal(h.engine.list()[0].needsReview,true);
  assert.equal(h.queue.list()[0].needsReview,false,'the original mismatch is in the route, not the queue flag');
  const before=h.stored;
  assert.throws(()=>h.queue.resume(id),/ruta|refuerzo/i);
  assert.deepEqual(h.stored,before,'a queue control cannot erase the owning route review');
  await h.queue.tick();assert.equal(h.dispatches,0);
  h.engine.acknowledgeRoute('r');
  assert.equal(h.queue.list().length,0);assert.equal(h.engine.list()[0].paused,true);
  h.engine.resume('r');h.engine.tick();await h.queue.tick();assert.equal(h.dispatches,0);
  h.advance(60000);h.engine.tick();await h.queue.tick();assert.equal(h.dispatches,1);
});

for(const [name,edit] of [
  ['production', (queue,job)=>queue.update(job.id,{produce:true})],
  ['automatic send', (queue,job)=>queue.update(job.id,{autoSend:false})],
  ['target reconnect', (queue,job)=>queue.reconnect(job.id,{...job.target,routeKey:'changed-native-route'})],
  ['fleet editor', (queue,job)=>queue.beginFleetEdit(job.id)],
  ['fleet quantities', (queue,job)=>queue.setFleetQuantities(job.id,{...job.quantities,probe:1},{expected:job})],
])test('a route-owned queue job rejects independent '+name+' changes without invalidating its ticket',async()=>{
  const h=setup();h.engine.tick();const job=h.queue.list()[0],before=h.stored;
  assert.throws(()=>edit(h.queue,job),/ruta|refuerzo/i);
  assert.deepEqual(h.stored,before);
  assert.equal(h.engine.canRunJob(h.queue.list()[0]),true);
  await h.queue.tick();assert.equal(h.dispatches,1,'the intact original route can still send');
});

test('uncertain route cannot be acknowledged through the ordinary queue retry control',async()=>{
  const h=setup();h.setOutcome('uncertain');h.engine.tick();await h.queue.tick();h.engine.tick();
  const before=h.stored,job=h.queue.list()[0];
  assert.equal(job.needsReview,true);
  assert.throws(()=>h.queue.acknowledge(job.id,{notSent:true}),/ruta|refuerzo/i);
  assert.deepEqual(h.stored,before);assert.equal(h.engine.list()[0].needsReview,true);
});

test('historically resumed waiting job remains blocked by its route review with permissive outer gates',async()=>{
  const h=setup({queueGuardsOnly:true});h.engine.tick();const id=h.queue.list()[0].id;
  h.queue.pause(id);h.engine.tick();
  // Existing installations can already contain the pre-fix pause/tick/resume
  // state. Restore only the saved queue mutation that the former resume made.
  const old=h.stored;old.jobs[0].status='waiting';old.jobs[0].message='';h.stored=old;
  const waiting=h.queue.list()[0];assert.equal(waiting.needsReview,false);
  assert.equal(h.engine.list()[0].needsReview,true);
  await h.queue.tick();assert.equal(h.dispatches,0);
  assert.equal(h.queue.list()[0].claimedAt,null,'a blocked route must never acquire a new send claim');
});

test('legacy produce=true mismatch cannot demand production or send before route reconciliation',async()=>{
  const h=setup({queueGuardsOnly:true});h.engine.tick();
  const old=h.stored;old.jobs[0].produce=true;h.stored=old;
  assert.equal(h.engine.list()[0].needsReview,false,'the owner has not reconciled the legacy queue edit yet');
  const context={scope,originId:A,active:true,canAct:true};
  const emptyFleet=new Map(core.SHIPS.map(type=>[type,{parked:0,away:0,building:0}]));
  assert.equal(h.queue.productionDemand(context,emptyFleet),null);
  await h.queue.tick();assert.equal(h.dispatches,0);
  assert.equal(h.queue.list()[0].claimedAt,null);
  h.engine.tick();assert.equal(h.engine.list()[0].needsReview,true);
  assert.throws(()=>h.engine.acknowledgeRoute('r'),/cambi|cola|misi/i,'a mismatched ticket cannot be silently removed by review');
  h.queue.cancel(old.jobs[0].id);h.engine.acknowledgeRoute('r');
  const reviewed=h.engine.list()[0];
  assert.equal(reviewed.paused,true);assert.equal(reviewed.needsReview,false);assert.equal(reviewed.ticket,null);
  h.engine.resume('r');h.engine.tick();assert.equal(h.queue.list().length,0);
  h.advance(59999);h.engine.tick();assert.equal(h.queue.list().length,0,'the full interval remains required after review');
  h.advance(1);h.world.observedAt=reviewed.lastSentAt;h.engine.tick();
  assert.equal(h.queue.list().length,0,'even an otherwise fresh census must be newer than the review');
  h.world.observedAt=reviewed.nextRunAt;h.engine.tick();await h.queue.tick();
  assert.equal(h.dispatches,1);assert.equal(h.queue.list()[0].produce,false,'a new ticket restores the original route contract');
});

for(const [name,options] of [
  ['missing',{omitRouteState:true}],
  ['throwing',{getRouteState:()=>{throw new Error('route storage unavailable');}}],
  ['malformed',{getRouteState:()=>({blocked:false})}],
])test('route queue authority fails closed when its owner state is '+name,async()=>{
  const h=setup({...options,queueGuardsOnly:true});h.engine.tick();
  await h.queue.tick();assert.equal(h.dispatches,0);
  assert.equal(h.queue.list()[0].claimedAt,null);
});

test('a route review created while saving the send claim is checked again before dispatch',async()=>{
  const h=setup({queueGuardsOnly:true});h.engine.tick();
  h.setOnSave(value=>{
    if(value.jobs[0]?.status==='sending') { h.setOnSave(null);h.engine.pause('r'); }
  });
  await h.queue.tick();
  assert.equal(h.engine.list()[0].needsReview,true);
  assert.equal(h.dispatches,0);
});

test('ordinary queue missions retain editing, production, resume and send without route authority',async()=>{
  const h=setup({queueGuardsOnly:true,omitRouteState:true});h.engine.tick();
  const original=h.queue.list()[0];h.engine.pause('r');h.engine.remove('r');
  const {scope:jobScope,originId,originName,target,quantities}=original;
  const job=h.queue.queue({scope:jobScope,originId,originName,target,quantities,produce:false,autoSend:true},{id:'ordinary-one'});
  h.queue.update(job.id,{produce:true});h.queue.pause(job.id);h.queue.resume(job.id);
  let editing=h.queue.beginFleetEdit(job.id);
  editing=h.queue.setFleetDraft(job.id,'probe','3',{expected:editing});
  h.queue.applyFleetEdit(job.id,{expected:editing});
  const emptyFleet=new Map(core.SHIPS.map(type=>[type,{parked:0,away:0,building:0}]));
  assert.deepEqual(copy(h.queue.productionDemand({scope,originId:A,active:true,canAct:true},emptyFleet)),{probe:3,marauder:0,sentinel:0,vanguard:0});
  await h.queue.tick();assert.equal(h.dispatches,1);
});

for(const queueGuardsOnly of [true,false]) test('independent last-fleet reentrancy, permissive outer='+queueGuardsOnly, async()=>{
  let reads=0;
  const h=setup({queueGuardsOnly,onFleet:engine=>{if(++reads===2)engine.pause('r');}});
  h.engine.tick(); await h.queue.tick();
  assert.equal(h.engine.list()[0].needsReview,true);
  assert.equal(h.dispatches,0);
});
