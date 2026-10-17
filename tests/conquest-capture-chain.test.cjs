'use strict';
// Synthetic own-world, passive metadata and queue adapters; no game/network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const core=require('../docs/conquest-core.js'),controller=require('../docs/conquest-controller.js');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),scope='alpha/'+uuid(1),fleet=n=>({probe:0,marauder:n,sentinel:0,vanguard:0}),ships=n=>core.SHIPS.map(type=>({type,quantity:type==='marauder'?n:0}));
const cell=(q,r=0)=>({q,r}),candidate=(q,owner=90)=>({q,r:0,name:'Target '+q,ownerName:'Rival',ownerId:uuid(owner)});
function harness(){
 let at=1000,store,seq=100,writeMode='',allowed=true,paused=false,pending=[],calls=[],eligible=true;
 const world={scope,selfId:uuid(1),epoch:1,generation:1,connected:true,complete:true,observedAt:at,systems:[{id:uuid(2),q:0,r:0,name:'Origin',maxDispatchRange:100,fleet:ships(30)}],transits:[],ownership:{version:1,complete:false,players:[{id:uuid(1),kind:'human',protectedUntil:null,treatyWith:[],owned:[cell(0)]},{id:uuid(90),name:'Rival',kind:'human',protectedUntil:null,owned:[cell(10),cell(11),cell(20),cell(21)]}]}};
 const deps={read:()=>store,write:v=>{if(writeMode==='false')return false;if(writeMode!=='noop')store=structuredClone(v);},getContext:()=>({scope,canAct:!paused,originId:uuid(2)}),getWorld:()=>world,getJobs:()=>structuredClone(pending),now:()=>at,newId:()=>uuid(seq++),
  getTargetOwner:(s,t)=>core.ownerFor(world,s,t,at),isTargetAllowed:()=>allowed,getCandidates:s=>core.candidateOwners(world,s,at),isChainTargetAllowed:o=>eligible&&core.candidateOwners(world,o.scope,at).some(c=>c.q===o.target.q&&c.r===o.target.r),
  queue:(spec,opts)=>{calls.push(structuredClone(spec));pending.push({...structuredClone(spec),...opts,status:'waiting',sentAt:null});},cancel:id=>{pending=pending.filter(j=>j.id!==id);},cancelPreparing:()=>false};
 let app=controller.create(deps);
 const refresh=()=>{at+=50;world.observedAt=at;};
 const own=(q,n=99)=>{world.systems.push({id:uuid(n),q,r:0,name:'Captured '+q,maxDispatchRange:100,fleet:ships(0)});world.ownership.players[0].owned.push(cell(q));world.ownership.players[1].owned=world.ownership.players[1].owned.filter(x=>x.q!==q);};
 return {get app(){return app;},world,calls,get store(){return store;},get pending(){return pending;},set pending(v){pending=v;},refresh,own,set at(v){at=v;},get at(){return at;},set writeMode(v){writeMode=v;},set allowed(v){allowed=v;},set paused(v){paused=v;},set eligible(v){eligible=v;},
  reload(){app=controller.create(deps);},add(extra={}){return app.add({target:{q:10,r:0,name:'First'},fleet:fleet(6),defense:fleet(2),maxRaids:3,maxLosses:20,autoNext:true,...extra});},
  capture(){own(10);refresh();app.tick();},advanceChain(){refresh();return app.tick();},
  send(){const j=pending[0];at+=10;j.status='sent';j.sentAt=at;app.tick();return j;},
  report({q=10,n=900,captured=false,before=8,lost=2,owner=uuid(90),sparse=false}={}){at+=10;const t=app.list().find(o=>o.target.q===q)?.ticket;return {scope,item:{id:uuid(n),takenAt:at,verdict:'Victory'},detail:{id:uuid(n),route:{from:{q:t?.origin.q??0,r:0,ownerKind:'owned'},to:{q,r:0,ownerKind:'human',ownerId:owner}},sections:{battle:{attackerShips:ships(t?.quantities.marauder??6),attackerLost:ships(1),defenderShips:sparse?[{type:'marauder',quantity:before}]:ships(before),defenderLost:sparse?[{type:'marauder',quantity:lost}]:ships(lost),defenderSectorBonusPct:0,loyaltyChange:{captured,before:100,after:captured?0:90,damageDealt:10}}}}};}
 };
}
test('capture continuation waits for a later own census and chooses the nearest observed eligible target once',()=>{
 const h=harness(),first=h.add();h.capture();assert.equal(h.app.list().length,1);assert.equal(h.app.list()[0].status,'captured');
 assert.equal(h.app.tick(),false);h.advanceChain();const rows=h.app.list();assert.equal(rows.length,2);assert.equal(rows[1].target.q,11);assert.equal(rows[0].successorId,rows[1].id);assert.equal(rows[1].autoNext,true);assert.deepEqual(rows[1].defense,first.defense);
 h.reload();for(let n=0;n<5;n++)h.app.tick();assert.equal(h.app.list().length,2);assert.ok(h.calls.length<=1);assert.equal(h.app.list()[1].target.q,11);
});
test('single-target legacy campaigns never silently acquire continuation authorization',()=>{
 const h=harness();h.add({autoNext:false});h.capture();h.advanceChain();assert.equal(h.app.list().length,1);assert.equal(h.calls.length,0);
 h.app.continuation(h.app.list()[0].id,true);h.advanceChain();assert.equal(h.app.list().length,2);
});
test('capture continuation skips own, reserved and already managed targets and waits without inventing candidates',()=>{
 const h=harness();h.add();h.pending=[{scope,originId:uuid(3),status:'waiting',quantities:fleet(1),target:{coordinate:cell(11)}}];h.capture();h.advanceChain();assert.equal(h.app.list()[1].target.q,20);
 const empty=harness();empty.add();empty.capture();empty.world.ownership.players[1].protectedUntil=new Date(999999).toISOString();empty.advanceChain();assert.equal(empty.app.list().length,1);assert.match(empty.app.list()[0].message,/Esperando candidatos/);assert.equal(empty.calls.length,0);
});
test('continuation retains global raid and exact loss budgets instead of renewing them per captured target',()=>{
 const h=harness();h.add();h.app.tick();h.app.tick();h.send();const report=h.report({captured:true});h.app.observeReport(report);h.own(10);h.advanceChain();h.advanceChain();
 const next=h.app.list()[1];assert.equal(next.raids,1);assert.equal(next.losses.marauder,1);assert.equal(next.maxRaids,3);assert.equal(next.maxLosses,20);
 const end=harness();end.add({maxRaids:1});end.app.tick();end.app.tick();end.send();end.app.observeReport(end.report({captured:true}));end.own(10);end.advanceChain();end.advanceChain();assert.equal(end.app.list().length,1);assert.equal(end.app.list()[0].autoNext,false);assert.match(end.app.list()[0].message,/Límite global/);
});
test('unknown attack losses cannot release a captured campaign into a new global budget',()=>{
 const h=harness();h.add();h.app.tick();h.app.tick();h.send();const r=h.report({captured:true});delete r.detail.sections.battle.attackerLost;h.app.observeReport(r);h.own(10);h.advanceChain();
 const old=h.app.list()[0];assert.equal(old.budgetKnown,false);assert.equal(old.autoNext,false);assert.equal(h.app.list().length,1);assert.throws(()=>h.app.continuation(old.id,true));
});
test('continuation persistence rejection and no-op cannot queue an unpersisted successor',()=>{
 for(const mode of ['false','noop']){const h=harness();h.add();h.capture();h.writeMode=mode;h.advanceChain();assert.equal(h.app.list().length,1);assert.equal(h.calls.length,0);assert.equal(h.app.diagnostics().writeBlocked,true);}
});
test('paused permissions and lost ownership suppress continuation and prepared automatic jobs',()=>{
 const h=harness();h.add();h.capture();h.paused=true;h.advanceChain();assert.equal(h.app.list().length,1);h.paused=false;h.advanceChain();assert.equal(h.app.list().length,2);
 h.refresh();h.app.tick();h.app.tick();const job=structuredClone(h.pending[0]);assert.ok(job);h.eligible=false;assert.equal(h.app.canRunJob(job),false);
 h.eligible=true;h.world.systems=h.world.systems.filter(s=>s.q!==10);h.refresh();assert.equal(h.app.canRunJob(job),false,'captured-parent contradiction revokes successor authority');
});
test('fresh exact defenses outrank unknown targets and weaker comparable vectors outrank closeness',()=>{
 const from=cell(10),intel=[{target:cell(20),ownerId:uuid(90),takenAt:1000,remaining:fleet(2),bonus:0},{target:cell(21),ownerId:uuid(90),takenAt:1000,remaining:fleet(1),bonus:0}];
 const ranked=core.rankTargets([candidate(11),candidate(20),candidate(21)],intel,from,1000);assert.deepEqual(ranked.map(x=>x.q),[21,20,11]);assert.equal(ranked[2].known,false);
 assert.throws(()=>core.rankTargets([candidate(11),candidate(11)],intel,from,1000));
 const expired=core.rankTargets([candidate(11),candidate(20)],intel,from,121001);assert.equal(expired[0].q,11);assert.ok(expired.every(x=>!x.known));
});
test('defense vectors with incomparable ship types or unknown bonuses use hex distance without invented strength',()=>{
 const intel=[{target:cell(20),ownerId:uuid(90),takenAt:1000,remaining:{...fleet(0),sentinel:2},bonus:0},{target:cell(11),ownerId:uuid(90),takenAt:1000,remaining:fleet(5),bonus:0}];
 assert.equal(core.rankTargets([candidate(20),candidate(11)],intel,cell(10),1000)[0].q,11);intel[0].remaining=fleet(0);intel[0].bonus=null;assert.equal(core.rankTargets([candidate(20),candidate(11)],intel,cell(10),1000)[0].q,11);
 intel[0].ownerId=uuid(91);assert.equal(core.rankTargets([candidate(20),candidate(11)],intel,cell(10),1000)[0].q,11);
});
test('unmanaged exact report intelligence preserves legacy routing and informs later selection only while fresh',()=>{
 const h=harness();assert.equal(h.app.observeReport(h.report({q:20,before:1,lost:1})),false);h.add();h.capture();h.advanceChain();assert.equal(h.app.list()[1].target.q,20);assert.match(h.app.list()[1].message,/información defensiva exacta/);
 const sparse=harness();assert.equal(sparse.app.observeReport(sparse.report({q:20,before:1,lost:1,sparse:true})),false);sparse.add();sparse.capture();sparse.advanceChain();assert.equal(sparse.app.list()[1].target.q,11,'omitted ship types are not evidence of zero for new ranking');
});
test('positive attackability requires explicit protection and self treaty knowledge and excludes protected rivals',()=>{
 const h=harness(),enemy=h.world.ownership.players[1],self=h.world.ownership.players[0];assert.equal(core.candidateOwners(h.world,scope,1000).length,4);
 delete enemy.protectedUntil;assert.deepEqual(core.candidateOwners(h.world,scope,1000),[]);enemy.protectedUntil=null;delete self.treatyWith;assert.deepEqual(core.candidateOwners(h.world,scope,1000),[]);
 self.treatyWith=[{playerId:uuid(90),until:new Date(2000).toISOString()}];assert.deepEqual(core.candidateOwners(h.world,scope,1000),[]);assert.equal(core.candidateOwners(h.world,scope,2000).length,4);
 self.treatyWith=[{playerId:uuid(91),until:new Date(2000).toISOString()}];assert.equal(core.candidateOwners(h.world,scope,1000).length,4,'a treaty with a third party is not a treaty with this target');
 enemy.protectedUntil=new Date(2000).toISOString();assert.deepEqual(core.candidateOwners(h.world,scope,1000),[]);h.world.connected=false;assert.deepEqual(core.candidateOwners(h.world,scope,3000),[]);
});
test('cached candidate eligibility rechecks live publication, clock rollback and expiring treaties',()=>{
 const h=harness();let notify,settled=true,at=1000,reads=0;h.world.ownership.players[0].treatyWith=[{playerId:uuid(90),until:new Date(1500).toISOString()}];
 const bridge={status:()=>({connected:settled,complete:true}),snapshot:()=>{reads++;return structuredClone(h.world)},subscribe:fn=>{notify=fn;return()=>{};}};
 const reader=core.createOwnerReader({getBridge:()=>bridge,now:()=>at});assert.equal(reader.candidates(scope).length,0);at=1500;assert.equal(reader.candidates(scope).length,4);at=1400;assert.equal(reader.candidates(scope).length,0);assert.equal(reads,1);
 settled=false;assert.equal(reader.candidates(scope).length,0);settled=true;h.world.ownership.players[1].protectedUntil=new Date(5000).toISOString();notify();assert.equal(reader.candidates(scope).length,0);reader.destroy();
});
test('actual passive observer projects only minimal eligibility fields and preserves native per-field delta semantics',()=>{
 const file=path.join(__dirname,'empire-observer.test.cjs'),src=fs.readFileSync(file,'utf8'),prefix=src.slice(0,src.indexOf("test('world.init returns"));
 const f=vm.runInNewContext(prefix+'\n({O,ready,init,frame,SELF,OTHER,NOW,iso});',{require:createRequire(file),__dirname,process,Date});const input=f.init();
 input.world.players[0].owned[0].maxDispatchRange=7.5;input.world.players[0].kind='human';input.world.players[0].protectedUntil=null;input.world.players[0].treatyWith=[];input.world.players[1].kind='human';input.world.players[1].protectedUntil=null;input.world.players[1].treatyWith=[{playerId:f.SELF,until:f.iso(20000)}];input.world.players[1].privateText='DO_NOT_PROJECT';
 const {reducer,token,advance}=f.ready(input);let w=reducer.snapshot();assert.equal(w.systems[0].maxDispatchRange,7.5);assert.equal(f.O.validateSnapshot(JSON.stringify(w)).systems[0].maxDispatchRange,7.5);assert.equal(w.ownership.players[1].protectedUntil,null);assert.ok(!JSON.stringify(w).includes('DO_NOT_PROJECT'));assert.ok(f.O.validateSnapshot(JSON.stringify(w)).ownership.players[1].treatyWith);
 advance();reducer.ingest(f.frame('world.delta',{serverNow:f.NOW+1000,updated:{players:[{id:f.OTHER,owned:[],name:'Updated'}]}}),token);w=reducer.snapshot();assert.equal(w.ownership.players[1].kind,undefined);assert.equal(w.ownership.players[1].protectedUntil,undefined);assert.equal(w.ownership.players[1].treatyWith.length,1);
});

test('candidate reader revocation during its final status check and throwing bridge lookup both fail closed',()=>{
 const h=harness();let count=0,throwLookup=false;
 const bridge={status:()=>({connected:true,complete:++count!==4}),snapshot:()=>structuredClone(h.world),subscribe:()=>()=>{}};
 const reader=core.createOwnerReader({getBridge:()=>{if(throwLookup)throw Error('synthetic unavailable');return bridge;},now:()=>1000});
 assert.deepEqual(reader.candidates(scope),[]);count=10;assert.equal(reader.candidates(scope).length,4);throwLookup=true;assert.deepEqual(reader.candidates(scope),[]);reader.destroy();
});
test('automatic selection and both queue boundaries require the native dispatch range of the real origin',()=>{
 const h=harness();h.world.systems[0].maxDispatchRange=10;h.add();h.capture();delete h.world.systems[1].maxDispatchRange;h.advanceChain();assert.equal(h.app.list().length,1);
 h.world.systems[0].maxDispatchRange=11;h.advanceChain();assert.equal(h.app.list()[1].target.q,11);h.refresh();h.app.tick();h.app.tick();const job=structuredClone(h.pending[0]);assert.ok(job);assert.equal(h.app.canRunJob(job),true);
 h.world.systems[0].maxDispatchRange=10;assert.equal(h.app.canRunJob(job),false);delete h.world.systems[0].maxDispatchRange;assert.equal(h.app.canRunJob(job),false);
});
test('stopped continuation never renews budgets and explicit continuation is blocked with unknown historical losses',()=>{
 const h=harness(),o=h.add();h.capture();h.app.continuation(o.id,false);h.advanceChain();assert.equal(h.app.list().length,1);
 h.app.continuation(o.id,true);h.advanceChain();assert.equal(h.app.list().length,2);assert.throws(()=>h.app.continuation(o.id,true),'a persisted successor cannot be created again');
});

test('waiting messages do not postpone a confirmed capture census when a shield expires without a new quote',()=>{
 const h=harness();h.add();h.capture();h.world.ownership.players[1].protectedUntil=new Date(h.at+100).toISOString();h.advanceChain();assert.equal(h.app.list().length,1);const census=h.world.observedAt;
 h.at+=100;assert.equal(h.world.observedAt,census);h.app.tick();assert.equal(h.app.list().length,2);
});
test('future, stale, changed-owner and same-time conflicting reports never rank an unknown defense as zero',()=>{
 for(const kind of ['future','stale','owner','conflict']){
  const h=harness(),r=h.report({q:20,before:1,lost:1});
  if(kind==='future')r.item.takenAt=h.at+1;if(kind==='stale')h.at+=core.MAX_AGE+1;if(kind==='owner')r.detail.route.to.ownerId=uuid(91);
  assert.equal(h.app.observeReport(r),false);
  if(kind==='conflict'){const other=structuredClone(r);other.item.id=other.detail.id=uuid(901);other.detail.sections.battle.defenderShips=ships(10);h.app.observeReport(other);}
  h.world.observedAt=h.at;h.add();h.capture();h.advanceChain();assert.equal(h.app.list()[1].target.q,11,kind);
 }
});
test('a captured record with missing legacy loss evidence cannot be newly opted into an automatic chain',()=>{
 const h=harness();h.add({autoNext:false});h.app.tick();h.app.tick();h.send();const r=h.report({captured:true});h.app.observeReport(r);
 delete h.store.objectives[0].budgetKnown;h.reload();const old=h.app.list()[0];assert.equal(old.budgetKnown,false);assert.throws(()=>h.app.continuation(old.id,true));
});

test('removing a captured ancestor cannot erase the lineage that revokes its active successor',()=>{
 const h=harness(),first=h.add();h.capture();h.advanceChain();h.refresh();h.app.tick();h.app.tick();const job=structuredClone(h.pending[0]);assert.equal(h.app.canRunJob(job),true);
 assert.throws(()=>h.app.remove(first.id),/historial/);h.world.systems=h.world.systems.filter(s=>s.q!==10);h.refresh();assert.equal(h.app.canRunJob(job),false);
});
test('a reciprocal treaty with self also blocks eligibility but unrelated rival treaties do not',()=>{
 const h=harness(),enemy=h.world.ownership.players[1];enemy.treatyWith=[{playerId:uuid(1),until:new Date(2000).toISOString()}];assert.equal(core.candidateOwners(h.world,scope,1000).length,0);
 enemy.treatyWith=[{playerId:uuid(91),until:new Date(2000).toISOString()}];assert.equal(core.candidateOwners(h.world,scope,1000).length,4);
});

test('the bounded objective history stops automatic succession instead of silently discarding captured records',()=>{
 const h=harness();h.add();h.capture();for(let q=100;q<115;q++)h.add({target:{q,r:0,name:'Other '+q},autoNext:false});h.advanceChain();assert.equal(h.app.list().length,core.MAX_OBJECTIVES);assert.equal(h.app.list()[0].autoNext,false);assert.match(h.app.list()[0].message,/Historial/);assert.equal(h.calls.length,0);
});

test('newer unidentified-owner combat invalidates previous exact zero defense instead of preserving its preference',()=>{
 const h=harness();assert.equal(h.app.observeReport(h.report({q:20,before:1,lost:1})),false);assert.equal(h.app.observeReport(h.report({q:20,before:100,lost:0,owner:null})),false);
 h.add();h.capture();h.advanceChain();assert.equal(h.app.list()[1].target.q,11);assert.match(h.app.list()[1].message,/desconocidas/);
});
test('older combat from another owner cannot evict newer exact defense evidence for the same coordinate',()=>{
 const h=harness(),recent=h.report({q:20,before:1,lost:1});assert.equal(h.app.observeReport(recent),false);const old=h.report({q:20,before:100,lost:0,owner:uuid(91)});old.item.takenAt=recent.item.takenAt-1;assert.equal(h.app.observeReport(old),false);
 h.add();h.capture();h.advanceChain();assert.equal(h.app.list()[1].target.q,20);assert.match(h.app.list()[1].message,/información defensiva exacta/);
});
test('an unidentified-owner invalidation remains newer than a replayed previously known report',()=>{
 const h=harness(),old=h.report({q:20,before:1,lost:1});h.app.observeReport(old);h.app.observeReport(h.report({q:20,before:100,lost:0,owner:null}));h.app.observeReport(old);
 h.add();h.capture();h.advanceChain();assert.equal(h.app.list()[1].target.q,11);
});
