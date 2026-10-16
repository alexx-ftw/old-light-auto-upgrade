'use strict';
function installConquestFixture(){
 const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),scope='galaxy/'+uuid(1);
 let clock=Date.now(),stored,queueStored={},controller,queue,confirmation=false,seq=10;const calls=[],listeners=new Set();
 const ships=n=>[{type:'marauder',quantity:n}],context={scope,originId:uuid(2),originName:'Assembly',selectionCount:1,active:true,canAct:true,coordinated:true,canNavigate:true};
 const world={scope,selfId:uuid(1),epoch:1,generation:1,revision:0,complete:true,connected:true,observedAt:clock,
  systems:[{id:uuid(2),q:0,r:0,name:'Assembly',fleet:ships(10)},{id:uuid(3),q:5,r:0,name:'Donor',fleet:ships(4)}],transits:[],
  ownership:{version:1,complete:false,players:[{id:uuid(1),name:'Self',owned:[{q:0,r:0},{q:5,r:0}]},{id:uuid(90),name:'Enemy',owned:[{q:10,r:0}]}]}};
 const clone=x=>JSON.parse(JSON.stringify(x));
 const bridge={status:()=>({connected:world.connected,complete:world.complete}),snapshot:()=>clone(world),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}};
 const owners=OldLightConquestCore.createOwnerReader({getBridge:()=>bridge,now:()=>clock});
 const changed=()=>{clock+=2000;world.observedAt=clock;world.revision++;for(const fn of listeners)fn();panel.render()};
 queue=createFleetWaitQueue({load:()=>clone(queueStored),save:value=>{queueStored=clone(value);return true},now:()=>clock,
  getContext:()=>({...context,canAct:context.canAct&&(!queue?.list().some(j=>j.originId===context.originId)||controller.canRunJob(queue.list().find(j=>j.originId===context.originId)))}),
  getFleet:()=>{const system=world.systems.find(s=>s.id===context.originId),counts=Object.fromEntries(system.fleet.map(s=>[s.type,s.quantity]));return new Map(OldLightConquestCore.SHIPS.map(type=>[type,{parked:counts[type]||0,away:0,building:0}]))},
  dispatch:async job=>{if(!controller.canRunJob(job))return {status:'paused',message:'Offline guard rejection'};
   calls.push(clone(job));const source=world.systems.find(s=>s.id===job.originId);source.fleet[0].quantity-=job.quantities.marauder;
   world.transits.push({fromQ:source.q,fromR:source.r,toQ:job.target.coordinate.q,toR:job.target.coordinate.r});
   return {status:'sent',message:'Synthetic native acceptance; no network or game order'};}});
 controller=OldLightConquestController.create({read:()=>stored,write:value=>{stored=clone(value);return true},getContext:()=>context,getWorld:()=>clone(world),getJobs:()=>queue.list(),
  queue:(spec,options)=>queue.queue(spec,options),cancel:id=>queue.cancel(id),cancelPreparing:()=>false,
  getTargetOwner:(scope,target)=>owners.read(scope,target),isTargetAllowed:()=>true,now:()=>clock,newId:()=>uuid(seq++),onChange:()=>{}});
 const panel=OldLightConquestPanel.create({controller,document,confirm:()=>confirmation});panel.mount(layoutRoot.querySelector('#campaigns'));
 const navigation=OldLightReinforcementRuntime.create({core:{list:controller.navigationList,dueOrigins:controller.dueOrigins,pause:controller.pause},
  adapter:{canNavigate:()=>true,selectSystem:async(id,{isCurrent})=>{if(!isCurrent())return false;context.originId=id;context.originName=world.systems.find(s=>s.id===id).name;return true}},getContext:()=>context,now:()=>clock});
 async function run(){for(let i=0;i<5;i++)controller.tick();navigation.tick();for(let i=0;i<10&&navigation.isBusy();i++)await new Promise(r=>setTimeout(r,0));await queue.tick();for(let i=0;i<3;i++)controller.tick();panel.render();}
 function arrive(){const t=controller.list()[0].ticket;if(t?.kind!=='transfer')throw Error('Expected transfer');world.transits=[];world.systems.find(s=>s.id===t.destinationId).fleet[0].quantity+=t.quantities.marauder;changed();}
 function report(captured=false){const o=controller.list()[0],t=o.ticket;if(t?.kind!=='attack'||t.state!=='sent')throw Error('Expected sent raid');clock+=100;
  const rows=amount=>OldLightConquestCore.SHIPS.map(type=>({type,quantity:type==='marauder'?amount:0}));
  const report={scope,item:{id:uuid(100+o.raids),takenAt:clock,verdict:'Victory'},detail:{id:uuid(100+o.raids),route:{from:{...t.origin,ownerKind:'owned'},to:{q:10,r:0,ownerKind:'human',ownerId:uuid(90),ownerName:'Enemy'}},sections:{battle:{attackerShips:rows(t.quantities.marauder),attackerLost:rows(1),defenderShips:rows(8),defenderLost:rows(8),loyaltyChange:{before:100,after:captured?0:90,damageDealt:captured?100:10,captured}}}}};
  controller.observeReport(report);world.transits=[];
  if(captured){world.systems.push({id:uuid(99),q:10,r:0,name:'Captured target',fleet:[]});world.ownership.players[0].owned.push({q:10,r:0});world.ownership.players[1].owned=[];}
  changed();return report;
 }
 globalThis.conquestFixture={run,arrive,report,setConfirmation:value=>{confirmation=value},restock:()=>{world.systems[0].fleet=ships(12);changed()},
  state:()=>({objectives:controller.list(),plans:controller.plans(),jobs:queue.list(),calls:clone(calls),context:clone(context)}),
  loseProof:()=>{world.connected=false;changed();controller.tick();panel.render()}};
}
