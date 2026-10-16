'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require(process.env.QA_CONQUEST_CORE_SOURCE||'../docs/conquest-core.js'),controller=require(process.env.QA_CONQUEST_CONTROLLER_SOURCE||'../docs/conquest-controller.js');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),scope='galaxy/'+uuid(1),fleet=n=>({probe:0,marauder:n,sentinel:0,vanguard:0});
function goal(){return {id:uuid(20000),scope,target:{q:50000,r:0,name:'Synthetic target'},status:'planning',createdAt:1000,fleet:fleet(6),defense:fleet(2),raids:0,maxRaids:3,maxLosses:20,losses:fleet(0)};}
function world(amount){return {scope,complete:true,connected:true,observedAt:1000,systems:Array.from({length:1000},(_,i)=>({id:uuid(i+2),q:i,r:0,name:'Synthetic '+i,fleet:[{type:'marauder',quantity:amount}]})),transits:[]};}
function countedPlan(amount){let sorts=0;const prior=Array.prototype.sort;Array.prototype.sort=function(fn){sorts++;return prior.call(this,fn)};try{return {plan:core.plan([goal()],world(amount),[],scope,1000)[0],get sorts(){return sorts}};}finally{Array.prototype.sort=prior;}}
test('conquest ready fleets do not sort every donor list for a thousand already usable origins',()=>{
 const r=countedPlan(20);assert.equal(r.plan.ready,true);assert.equal(r.plan.origin.id,uuid(1001));assert.equal(r.plan.transfers.length,0);assert.equal(r.plan.reservations[0].quantities.marauder,6);assert.ok(r.sorts<=4,'donor sorts='+r.sorts);
});
test('conquest globally insufficient stock waits without sorting a thousand impossible donor plans',()=>{
 const r=countedPlan(0);assert.equal(r.plan.origin,null);assert.equal(r.plan.ready,false);assert.deepEqual(r.plan.reservations,[]);assert.match(r.plan.message,/Faltan naves/);assert.ok(r.sorts<=2,'donor sorts='+r.sorts);
});
test('an empty conquest configuration never reads a native census or operational context and does not authorize orphan conquest jobs',()=>{
 let contexts=0,snapshots=0,writes=0;const c=controller.create({read:()=>undefined,write:()=>{writes++},getContext:()=>{contexts++;return {scope,canAct:true}},getWorld:()=>{snapshots++;return world(20)},getJobs:()=>[],queue:()=>assert.fail('no intent'),cancel:()=>{},cancelPreparing:()=>{},getTargetOwner:()=>null,isTargetAllowed:()=>false});
 for(let i=0;i<30;i++){assert.deepEqual(c.list(),[]);assert.deepEqual(c.plans(),[]);assert.equal(c.tick(),false);assert.deepEqual(c.dueOrigins(),[]);assert.equal(c.observationSince(),null);assert.equal(c.canUseFleet({scope,originId:uuid(2),quantities:fleet(1)}),true);assert.equal(c.canRunJob({id:'conquest:'+uuid(20000)+':1',campaignId:'conquest:'+uuid(20000)}),false);}assert.equal(snapshots,0);assert.equal(contexts,0);assert.equal(writes,0);
});
test('empty configuration shortcuts still deny missions when conquest storage cannot be read',()=>{
 const c=controller.create({read:()=>{throw Error('fixture unavailable')},write:()=>assert.fail('no write'),getContext:()=>({scope,canAct:true}),getWorld:()=>assert.fail('no census on failed read'),getJobs:()=>[],queue:()=>assert.fail('no queue'),cancel:()=>{},cancelPreparing:()=>{},getTargetOwner:()=>null,isTargetAllowed:()=>false});assert.equal(c.canUseFleet({scope}),false);assert.equal(c.canRunJob({scope}),false);assert.equal(c.tick(),false);
});
