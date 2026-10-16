'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../docs/conquest-core.js'),controller=require(process.env.QA_CONQUEST_CONTROLLER_SOURCE||'../docs/conquest-controller.js');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),scope='galaxy/'+uuid(1),q=(m=0)=>({probe:0,marauder:m,sentinel:0,vanguard:0});
function system(n,x,m){return {id:uuid(n),q:x,r:0,name:'Own '+n,fleet:Object.entries(q(m)).map(([type,quantity])=>({type,quantity}))};}
function world(rows=[system(2,0,10),system(3,5,20)]){return {scope,connected:true,complete:true,observedAt:1000,systems:rows,transits:[]};}
function objective(n=10,extra={}){return {id:uuid(n),scope,target:{q:10,r:0,name:'Target'},status:'planning',createdAt:1000,fleet:q(6),defense:q(2),raids:0,maxRaids:3,maxLosses:20,losses:q(),...extra};}
function harness(){let at=1000,stored,rows=world(),pending=[],context={scope,originId:uuid(2),canAct:true},seq=10,failWrite=false,writeMode=null,targetOwner=uuid(90),allowed=true,proofPresent=true;
 const calls=[],deps={getTargetOwner:()=>proofPresent?({scope:context.scope,ownerId:targetOwner,ownerName:'Enemy',epoch:1,generation:1,observedAt:rows.observedAt}):null,isTargetAllowed:()=>allowed,read:()=>stored,write:v=>{if(failWrite)throw Error('quota');if(writeMode==='false')return false;if(writeMode==='noop')return;stored=structuredClone(v)},getContext:()=>context,getWorld:()=>rows,getJobs:()=>structuredClone(pending),now:()=>at,newId:()=>uuid(seq++),
 queue:(spec,options)=>{calls.push({spec:structuredClone(spec),options,stored:structuredClone(stored)});if(pending.some(j=>j.id===options.id))return;if(pending.some(j=>j.scope===spec.scope&&j.originId===spec.originId&&j.status!=='sent'))throw Error('occupied');pending=pending.filter(j=>j.scope!==spec.scope||j.originId!==spec.originId);pending.push({...structuredClone(spec),...options,status:'waiting',createdAt:at,updatedAt:at,claimedAt:null,sentAt:null,needsReview:false})},
 cancel:id=>{pending=pending.filter(j=>j.id!==id)},cancelPreparing:id=>calls.push({cancelPreparing:id})};
 let c=controller.create(deps);
 return {get c(){return c},calls,get state(){return stored},get pending(){return pending},set pending(v){pending=v},get world(){return rows},set world(v){rows=v},set at(v){at=v},get at(){return at},set context(v){context={...context,...v}},set failWrite(v){failWrite=v},set writeMode(v){writeMode=v},set targetOwner(v){targetOwner=v},set allowed(v){allowed=v},set proofPresent(v){proofPresent=v},
 add:extra=>c.add({target:{q:10,r:0,name:'Target'},fleet:q(6),defense:q(2),maxRaids:3,maxLosses:20,...extra}),reload(){c=controller.create(deps)},send(){const j=pending.find(j=>j.status==='waiting');j.status='sent';at+=10;j.sentAt=at;j.updatedAt=at;c.tick();return j},
 report(n=100,extra={}){const o=c.list()[0],t=o.ticket;at+=10;return {scope,item:{id:uuid(n),takenAt:at,verdict:'Victory',...extra.item},detail:{id:uuid(n),route:{from:{...t.origin,ownerKind:'owned'},to:{...t.target,ownerKind:'human',ownerId:uuid(90)}},sections:{battle:{attackerShips:Object.entries(t.quantities).map(([type,quantity])=>({type,quantity})),attackerLost:Object.entries(q(1)).map(([type,quantity])=>({type,quantity})),defenderShips:Object.entries(q(20)).map(([type,quantity])=>({type,quantity})),defenderLost:Object.entries(q(8)).map(([type,quantity])=>({type,quantity})),loyaltyChange:{before:100,after:80,damageDealt:20,captured:false},...extra.battle}},...extra.detail}}}
 };
}
test('conquest chooses a ready origin before the geometrically closest but unavailable source',()=>{
 const w=world([system(2,9,2),system(3,0,8)]),p=core.plan([objective()],w,[],scope,1000)[0];assert.equal(p.origin.id,uuid(3));assert.equal(p.ready,true);assert.equal(p.transfers.length,0);
});
test('conquest first assembles donors at one origin and never treats simultaneous arrivals as combined attacks',()=>{
 const p=core.plan([objective(10,{fleet:q(10)})],world([system(2,0,8),system(3,5,8)]),[],scope,1000)[0];assert.equal(p.ready,false);assert.equal(p.transfers.length,1);assert.equal(p.transfers[0].destinationId,p.origin.id);assert.equal(p.transfers[0].quantities.marauder,4);
});
test('conquest plans reserve ships across objectives and preserve configured defenses',()=>{
 const plans=core.plan([objective(),objective(11,{target:{q:9,r:0,name:'Other'}})],world([system(2,0,10)]),[],scope,1000);
 assert.equal(plans[0].ready,true);assert.equal(plans[1].origin,null);assert.equal(plans[0].reservations[0].quantities.marauder,6);
});
for(const change of [w=>w.complete=false,w=>w.connected=false,w=>w.observedAt=1001,w=>w.observedAt=-200000,w=>w.scope='other/player',w=>w.systems[0].fleet=null,w=>w.systems.push(w.systems[0])])test('conquest rejects incomplete stale ambiguous or changed-scope world '+String(change),()=>{
 const w=world();change(w);assert.equal(core.plan([objective()],w,[],scope,1000)[0].origin,null);
});
test('pending and uncertain queue jobs own their source, sent jobs require a post-send census',()=>{
 for(const status of ['waiting','paused','sending','uncertain','sent']){const p=core.plan([objective()],world([system(2,0,10)]),[{scope,originId:uuid(2),status,quantities:q(1),sentAt:1000}],scope,1000)[0];assert.equal(p.origin,null,status);}
 const w=world([system(2,0,10)]);w.observedAt=1001;assert.equal(core.plan([objective()],w,[{scope,originId:uuid(2),status:'sent',sentAt:1000}],scope,1001)[0].ready,true);
});
test('incoming ships are not counted as parked or arrival-confirmed merely by an ETA',()=>{
 const w=world([system(2,0,4)]);w.transits=[{toQ:0,toR:0,arrivesAt:1,ships:[{type:'marauder',quantity:99}]}];assert.equal(core.plan([objective()],w,[],scope,1000)[0].origin,null);
 w.systems[0]=system(2,0,10);assert.equal(core.plan([objective()],w,[],scope,1000)[0].ready,false);
});
test('objective claim is durable before queue insertion and does not dispatch in an inactive context',()=>{
 const h=harness();h.add();h.context={canAct:false};h.c.tick();assert.equal(h.calls.length,0);h.context={canAct:true};h.c.tick();assert.equal(h.state.objectives[0].ticket.state,'prepared');assert.equal(h.calls.length,0);h.c.tick();assert.equal(h.calls[0].stored.objectives[0].ticket.state,'prepared');assert.equal(h.pending.length,1);assert.equal(h.c.canRunJob(h.pending[0]),true);
});
test('Victory without capture remains active, with report evidence and one raid before the next report',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.send();for(let i=0;i<5;i++)h.c.tick();assert.equal(h.calls.filter(x=>x.spec).length,1);assert.equal(h.c.list()[0].status,'awaiting_report');const r=h.report();assert.equal(h.c.observeReport(r),true);const o=h.c.list()[0];assert.equal(o.status,'planning');assert.equal(o.latestReport.loyalty.after,80);assert.equal(o.latestReport.defenderRemaining.marauder,12);assert.equal(o.raids,1);assert.equal(o.losses.marauder,1);assert.equal(h.c.observeReport(r),true);assert.equal(h.c.list()[0].losses.marauder,1);
});
test('explicit capture closes the objective even when casualty data is unavailable',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.send();const r=h.report(100,{battle:{attackerLost:undefined,loyaltyChange:{captured:true}}});h.c.observeReport(r);assert.equal(h.c.list()[0].status,'captured');assert.equal(h.c.list()[0].ticket,null);assert.equal(h.c.canRunJob(h.pending[0]),false);
});
test('fresh own census closes unsent preparations and invalidates their activation guard',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();const j=h.pending[0];h.world.systems.push(system(90,10,1));h.c.tick();assert.equal(h.c.list()[0].status,'captured');assert.equal(h.pending.length,0);assert.equal(h.c.canRunJob(j),false);assert.ok(h.calls.some(x=>x.cancelPreparing===j.id));
});
test('unknown casualties pause rather than authorize a new raid and never seed a legacy retry',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.send();const r=h.report(100,{battle:{attackerLost:[{type:'marauder',quantity:1,approximate:true}]}});assert.equal(h.c.observeReport(r),true);assert.equal(h.c.list()[0].status,'paused');assert.equal(h.c.canRunJob(h.pending[0]),false);
});
test('uncertain sends remain inert after reload and do not repeat queue insertion',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.pending[0].status='uncertain';h.reload();h.c.tick();assert.equal(h.c.list()[0].status,'uncertain');for(let i=0;i<5;i++)h.c.tick();assert.equal(h.calls.filter(x=>x.spec).length,1);assert.equal(h.c.canRunJob(h.pending[0]),false);
});
test('lost storage cannot enqueue or mutate previously stored intent',()=>{
 const h=harness();h.add();h.failWrite=true;h.c.tick();assert.equal(h.state.objectives[0].ticket,null);assert.equal(h.calls.length,0);assert.match(h.c.diagnostics().error,/guardar/);
});
test('different origins still deduplicate one target; changed accounts cannot activate old jobs',()=>{
 const h=harness();h.add();assert.throws(()=>h.add(),/Ya existe/);h.c.tick();h.c.tick();const j=h.pending[0];h.context={scope:'other/'+uuid(1)};assert.equal(h.c.canRunJob(j),false);assert.equal(h.c.list().length,0);
});
test('ordinary helper missions honor frozen conquest reserves and defense until objective pause',()=>{
 const h=harness();h.add();h.c.tick();const t=h.c.list()[0].ticket;const job={scope,originId:t.originId,quantities:q(14)};assert.equal(h.c.canUseFleet(job),false);h.c.pause(h.c.list()[0].id);assert.equal(h.c.canUseFleet(job),true);
});
test('battle evidence distinguishes net replenishment from manufacturing and preserves owner uncertainty',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.send();h.c.observeReport(h.report());
 h.at+=1;h.world.observedAt=h.at;for(let i=0;i<4;i++)h.c.tick();h.send();const r=h.report(101);r.detail.sections.battle.defenderShips=[{type:'marauder',quantity:17}];h.c.observeReport(r);
 const o=h.c.list()[0];assert.equal(o.latestReport.netReplenishment.marauder,5);assert.equal(o.losses.marauder,2);assert.equal(o.latestReport.owner,uuid(90));
});
test('loss and raid limits stop new claims; an explicit paused edit is required to raise a limit',()=>{
 const h=harness();h.add({maxRaids:1});h.c.tick();h.c.tick();h.send();h.c.observeReport(h.report());assert.equal(h.c.list()[0].status,'limit');const o=h.c.list()[0];h.c.configure(o.id,{fleet:q(6),defense:q(2),maxRaids:2,maxLosses:20});h.c.resume(o.id);assert.equal(h.c.list()[0].status,'planning');
});
test('cancellation while native sending does not recall or reopen a later confirmed attack',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.pending[0].status='sending';h.c.cancel(h.c.list()[0].id);assert.equal(h.c.list()[0].status,'cancelled');
 // Simulate a send already accepted before cancellation: it is recorded, never repeated.
 const job={...h.calls[0].spec,...h.calls[0].options,status:'sent',sentAt:1010};h.pending=[job];h.at=1010;h.c.tick();assert.equal(h.c.list()[0].status,'cancelled');assert.equal(h.c.list()[0].raids,1);for(let i=0;i<3;i++)h.c.tick();assert.equal(h.calls.filter(x=>x.spec).length,1);
});
test('prototype accessors in stored intent are rejected without invocation',()=>{
 let calls=0;const x={schemaVersion:1,receipts:[]};Object.defineProperty(x,'objectives',{enumerable:true,get(){calls++;return []}});assert.throws(()=>controller.validate(x));assert.equal(calls,0);
});
for(const mode of ['false','noop'])test('conquest storage '+mode+' cannot acknowledge an unsaved objective',()=>{const h=harness();h.writeMode=mode;assert.throws(()=>h.add(),/guardar/);assert.equal(h.c.list().length,0);assert.equal(h.calls.length,0);});
test('cancelled sent raid cannot be removed before its delayed report is consumed',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.send();const o=h.c.list()[0];h.c.cancel(o.id);assert.throws(()=>h.c.remove(o.id),/reporte/);
 const r=h.report(100,{item:{verdict:'Defeat'}});assert.equal(h.c.observeReport(r),true);assert.equal(h.c.list()[0].status,'cancelled');h.c.remove(o.id);assert.equal(h.c.list().length,0);assert.equal(h.c.observeReport(r),true,'resolved historical report remains suppressed for legacy retries');
});
test('report before controller reconciliation binds the native sent job before processing combat',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.pending[0].status='sent';h.at=1010;h.pending[0].sentAt=1010;h.pending[0].updatedAt=1010;
 const r=h.report();assert.equal(h.c.observeReport(r),true);assert.equal(h.c.list()[0].raids,1);assert.equal(h.c.list()[0].status,'planning');assert.equal(h.c.list()[0].reports.length,1);
});
for(const kind of ['missing','changed','protected'])test('fresh target ownership guard pauses and revokes prepared campaign on '+kind,()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();const job=h.pending[0];if(kind==='missing')h.proofPresent=false;if(kind==='changed')h.targetOwner=uuid(91);if(kind==='protected')h.allowed=false;
 assert.equal(h.c.canRunJob(job),false);h.c.tick();assert.equal(h.c.list()[0].status,'paused');assert.equal(h.pending.length,0);
});
test('large native parked fleets remain usable within the bounded requested amount',()=>{const w=world([system(2,0,100000)]);assert.equal(core.plan([objective()],w,[],scope,1000)[0].ready,true);});
test('exact surviving defenders raise a bounded next-wave estimate and can exceed the remaining loss budget',()=>{
 const h=harness();h.add({maxLosses:10});h.c.tick();h.c.tick();h.send();h.c.observeReport(h.report());const o=h.c.list()[0];assert.equal(o.fleet.marauder,12);assert.equal(o.status,'limit');assert.equal(o.latestReport.defenderRemaining.marauder,12);
});
test('manual uncertain closure preserves a post-review source barrier without replaying the order',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.pending[0].status='uncertain';h.c.tick();const o=h.c.list()[0];h.c.acknowledge(o.id);assert.equal(h.c.list()[0].status,'cancelled');assert.equal(h.c.list()[0].ticket,null);assert.equal(h.pending.length,0);assert.equal(h.state.receipts.length,1);assert.equal(h.c.canUseFleet({scope,originId:uuid(3),quantities:q(1)}),true);h.c.tick();assert.equal(h.calls.filter(c=>c.spec).length,1);
});
test('recovery sorts report chronology and suppresses all managed report identifiers from legacy retries',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.send();const report=h.report();const historical=structuredClone(report);historical.item.id=uuid(99);historical.detail.id=uuid(99);historical.item.takenAt=999;
 const managed=h.c.recoverReports({scope,reports:[{item:report.item,detail:report.detail},{item:historical.item,detail:historical.detail}]});assert.deepEqual(new Set(managed),new Set([uuid(99),uuid(100)]));assert.equal(h.c.list()[0].losses.marauder,1);assert.equal(h.c.list()[0].reports.length,1);
});
test('new out-of-order reports pause the campaign without counting losses twice',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.send();const report=h.report();h.c.observeReport(report);const old=structuredClone(report);old.item.id=uuid(101);old.detail.id=uuid(101);old.item.takenAt-=1;assert.equal(h.c.observeReport(old),true);assert.equal(h.c.list()[0].status,'paused');assert.equal(h.c.list()[0].losses.marauder,1);
});
test('unknown historical owner keeps replenishment explicitly estimated while fresh ownership still guards dispatch',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.send();const first=h.report();delete first.detail.route.to.ownerId;h.c.observeReport(first);h.at++;h.world.observedAt=h.at;for(let i=0;i<4;i++)h.c.tick();h.send();const next=h.report(101);delete next.detail.route.to.ownerId;next.detail.sections.battle.defenderShips=[{type:'marauder',quantity:17}];h.c.observeReport(next);const o=h.c.list()[0];assert.equal(o.latestReport.owner,null);assert.equal(o.latestReport.netReplenishment.marauder,5);assert.equal(o.latestReport.replenishmentEvidence,'owner-uncertain');
});
test('capture evidence from a later fresh own census wins over loss of enemy ownership proof',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.proofPresent=false;h.world.systems.push(system(90,10,1));h.c.tick();assert.equal(h.c.list()[0].status,'captured');assert.equal(h.pending.length,0);
});
test('manual closure cannot erase a confirmed sent raid before its delayed report',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.send();const o=h.c.list()[0];h.c.cancel(o.id);assert.throws(()=>h.c.acknowledge(o.id),/reporte/);assert.throws(()=>h.c.remove(o.id),/reporte/);assert.equal(h.c.observeReport(h.report(100,{item:{verdict:'Defeat'}})),true);
});
test('disappeared queued claim becomes uncertain and never requeues a possibly accepted native send',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();h.pending[0].status='sent';h.pending[0].sentAt=1001;h.pending=[];h.at=1002;h.c.tick();assert.equal(h.c.list()[0].status,'uncertain');for(let i=0;i<4;i++)h.c.tick();assert.equal(h.calls.filter(c=>c.spec).length,1);assert.equal(h.pending.length,0);
});
test('removed manually resolved uncertain objective suppresses future delayed reports from legacy retries',()=>{
 const h=harness();h.add();h.c.tick();h.c.tick();const r=h.report(100,{item:{verdict:'Defeat'}});h.pending[0].status='uncertain';h.c.tick();const o=h.c.list()[0];h.c.acknowledge(o.id);h.c.remove(o.id);h.at+=10000;r.item.takenAt=h.at;assert.equal(h.c.observeReport(r),true);assert.equal(h.c.list().length,0);assert.doesNotThrow(()=>h.add());
});
