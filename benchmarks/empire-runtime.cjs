'use strict';
const {performance}=require('node:perf_hooks');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const REPO=process.argv[2]||require('node:path').resolve(__dirname, '..');
const core=require(REPO+'/docs/empire-core.js');
const adapterModule=require(REPO+'/docs/empire-adapter.js');
const runtimeModule=require(REPO+'/docs/empire-runtime.js');
const SHIPS=core.DEFAULT_SHIPS, TIME=1000000;
const uuid=i=>'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
const P=uuid(999999),S='alpha/'+P,iso=x=>new Date(x).toISOString();
const counts=n=>Object.fromEntries(SHIPS.map(s=>[s,n]));
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(n,transitsPerSystem=4){
 const systems=Array.from({length:n},(_,i)=>({id:uuid(i+1),q:i,r:0,name:'Synthetic '+i,playerId:P,buildings:[{type:'shipyard',level:1}],fleet:SHIPS.map(type=>({type,quantity:10})),economy:{resources:{palladium:100,iridium:200,settledAt:iso(TIME)},paCap:1000,irCap:2000,paRatePerMin:10,irRatePerMin:5,energyCap:30,energyUsed:10,queue:[]},shipyard:{queue:[]}}));
 const transits=Array.from({length:n*transitsPerSystem},(_,i)=>({id:uuid(10000+i),fromQ:i%n,fromR:0,toQ:n+100+i,toR:9,ships:[{type:'probe',quantity:5}],phase:'outbound',recalledAt:null,arrivesAt:iso(TIME+60000)}));
 const world={version:1,galaxy:'alpha',selfId:P,scope:S,generation:1,epoch:1,revision:0,observedAt:TIME,connected:true,complete:true,systems,transits,transitShips:{...counts(0),probe:transits.length*5}};
 const context={scope:S,systemId:uuid(1),selectionCount:1,settled:true,owned:true};
 const hud={scope:S,systemId:uuid(1),resources:{palladium:{amount:100,cap:1000,rate:10},iridium:{amount:200,cap:2000,rate:5}},fleet:Object.fromEntries(SHIPS.map(type=>[type,{parked:10,away:type==='probe'?transitsPerSystem*5:0,building:0}])),queue:{buildings:0,ships:0},energy:20};
 return {world,context,hud};
}
function harness(n,{transitsPerSystem=4,bridgeClone=true,timing=false}={}){
 const f=fixture(n,transitsPerSystem),stats={worldReads:0,bridgeMs:0,planCalls:0,planMs:0,adapterCalls:{},adapterMs:{}};
 let config=core.normalizeConfig({enabled:true,fleetTargets:counts(n*100),systems:Object.fromEntries(f.world.systems.map(x=>[x.id,{enabled:true,role:'balanced'}]))});
 const doc={hidden:false,activeElement:null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}};
 const adapter=adapterModule.create({getWorld(){stats.worldReads++;const t=timing?performance.now():0;const v=bridgeClone?copy(f.world):f.world;if(timing)stats.bridgeMs+=performance.now()-t;return v;},getContext:()=>f.context,getHudSnapshot:()=>f.hud,document:doc,canNavigate:()=>true,now:()=>TIME});
 const instrumented={};for(const [key,value] of Object.entries(adapter)){instrumented[key]=typeof value!=='function'?value:(...args)=>{stats.adapterCalls[key]=(stats.adapterCalls[key]||0)+1;const t=timing?performance.now():0;const v=value(...args);if(timing)stats.adapterMs[key]=(stats.adapterMs[key]||0)+performance.now()-t;return v;};}
 const coreWrapped={...core,plan(...args){stats.planCalls++;const t=timing?performance.now():0;const v=core.plan(...args);if(timing)stats.planMs+=performance.now()-t;return v;}};
 const runtime=runtimeModule.create({core:coreWrapped,adapter:instrumented,read:()=>copy(config),write:(_,v)=>config=v,now:()=>TIME});
 const update=()=>runtime.update({scope:S});
 assert.equal(update().ready,true);assert.equal(runtime.canAct(f.context),true);
 function reset(){stats.worldReads=stats.bridgeMs=stats.planCalls=stats.planMs=0;stats.adapterCalls={};stats.adapterMs={};}
 reset();
 return {f,stats,adapter:instrumented,runtime,update,reset,
 cycle(){update();update();return runtime.canAct(instrumented.readActive()?.context);},
 advanceRevision(){f.world.revision++;}
 };
}
function measure(fn,iterations){for(let i=0;i<15;i++)fn();const samples=[];for(let k=0;k<5;k++){const t=performance.now();for(let i=0;i<iterations;i++)fn();samples.push((performance.now()-t)/iterations);}samples.sort((a,b)=>a-b);return {medianMs:samples[2],minMs:samples[0],maxMs:samples[4]};}
module.exports={harness,fixture,measure,core,adapterModule,runtimeModule};
if(require.main===module){
const result={node:process.version,platform:process.platform,method:'Synthetic fixed-clock native DTO; 4 external probe transits/system, exact HUD; bridge JSON copy enabled. No browser, network, gameplay, navigation, or DOM rendering.',rows:[]};
for(const n of [2,10,50]){
 const h=harness(n),iterations=n===50?20:60;
 const row={systems:n,transits:n*4,update:measure(h.update,iterations),canAct:measure(()=>h.runtime.canAct(h.f.context),iterations),commonStepEmpireSlice:measure(h.cycle,iterations),stateCopy:measure(()=>h.runtime.state(),iterations),burst20DistinctRevisions:measure(()=>{for(let i=0;i<20;i++){h.advanceRevision();assert.equal(h.cycle(),true);}},Math.max(2,Math.floor(iterations/20)))};
 const p=harness(n,{timing:true});p.reset();const t=performance.now();for(let i=0;i<50;i++)p.cycle();row.profile50Cycles={elapsedMs:performance.now()-t,...copy(p.stats)};
 const direct=harness(n,{bridgeClone:false});row.commonStepWithoutBridgeClone=measure(direct.cycle,iterations);
 result.rows.push(row);
}
console.log(JSON.stringify(result,null,2));

}
