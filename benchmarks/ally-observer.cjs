'use strict';
// Offline observer benchmark. Optional argument: another observer source file.
// No browser, websocket connection, network request or game action is used.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const source=fs.readFileSync(process.argv[2]||path.join(__dirname,'../docs/empire-observer.js'),'utf8');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ownSystem={id:uuid(100001),q:0,r:0,name:'Synthetic system',buildings:[{type:'shipyard',level:0}],fleet:[],economy:{resources:{palladium:0,iridium:0,settledAt:new Date(10000).toISOString()},paCap:100,irCap:100,paRatePerMin:0,irRatePerMin:0,energyCap:10,energyUsed:0,deficitMultiplier:1,queueSlots:1,queue:[]}};
function setup(owners,kind,concentrated=false){
 const timers=new Map();let timerId=0,last,revision=0;
 const flush=()=>{while(timers.size){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}};
 class Socket{constructor(){this.handlers=new Map();}addEventListener(t,fn){this.handlers.set(t,fn);}removeEventListener(t){this.handlers.delete(t);}dispatch(data){this.handlers.get('message')?.({data,isTrusted:true});}}
 const context=vm.createContext({__snapshotCalls:0,URL,Date,Proxy,Reflect,location:{origin:'https://oldlight.io',pathname:'/game/galaxy/alpha'},WebSocket:Socket,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(source.replace('function snapshot() {','function snapshot() { realm.__snapshotCalls++;'),context);
 const handle=context.OldLightEmpireObserver.installPageObserver({channel:'offline-benchmark',onPending:value=>JSON.stringify([value.generation,value.epoch,value.revision,value.connected,value.observedAt]),emit:record=>{last=record.snapshot;JSON.stringify(last);}});
 const socket=new context.WebSocket('wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket');
 const players=[{id:uuid(1),name:'Self',owned:[ownSystem],transits:[]},...Array.from({length:owners-1},(_,i)=>({id:uuid(i+2),name:'Synthetic '+i,owned:[{q:i+1,r:0}]}))];
 if(concentrated)players[1].owned=Array.from({length:9999},(_,i)=>({q:i+1,r:0}));
 socket.dispatch('42'+JSON.stringify(['world.init',{selfId:uuid(1),serverNow:10000,world:{players}}]));flush();assert.equal(last.complete,true);
 if(source.includes('validatedOwnership'))assert.equal(last.ownership.players.length,owners);
 function dispatch(){const payload=kind==='no-ownership-change'?{updated:{dirtySectors:[]}}:{updated:{players:[{id:uuid(2),name:kind==='distinct-owner-name'?'Changed '+(++revision):'Repeated name',owned:[]}]}};socket.dispatch('42'+JSON.stringify(['world.delta',payload]));}
 const cycle=()=>{dispatch();flush();};
 function burst(){context.__snapshotCalls=0;for(let i=0;i<100;i++)dispatch();const before=context.__snapshotCalls;flush();return{before,after:context.__snapshotCalls};}
 for(let i=0;i<8;i++)cycle();context.__snapshotCalls=0;cycle();const calls=context.__snapshotCalls;
 function bulk(){const updated=Array.from({length:Math.min(100,owners-1)},(_,i)=>({id:uuid(i+2),name:'Bulk '+(++revision),owned:[]}));socket.dispatch('42'+JSON.stringify(['world.delta',{updated:{players:updated}}]));flush();}
 return{cycle,burst,bulk,calls,stop:()=>handle.stop()};
}
function measure(fn,iterations,rounds=5){const samples=[];for(let r=0;r<rounds;r++){const start=performance.now();for(let i=0;i<iterations;i++)fn();samples.push((performance.now()-start)/iterations);}samples.sort((a,b)=>a-b);return{medianMs:samples[Math.floor(samples.length/2)],minMs:samples[0],maxMs:samples.at(-1)};}
const result={node:process.version,method:'Real observer/reducer over synthetic native events; JSON serialization included. 8 warmups, 5 batches for one delta+timer, 3 batches for bursts of100 before one timer. Owners each have one coordinate. Distinct-name really changes each event; repeated-name intentionally repeats public identity as economy updates do. No browser/network.',rows:[]};
for(const owners of [100,1000,10000])for(const kind of ['no-ownership-change','repeated-owner-name','distinct-owner-name']){
 const h=setup(owners,kind),row={owners,kind,snapshotCallsPerPublishedDelta:h.calls,snapshotCallsPerBurst100:h.burst(),deltaWithFlush:measure(h.cycle,owners===10000?8:20),burst100:measure(h.burst,1,3),singleBulk:measure(h.bulk,owners===10000?8:20)};h.stop();result.rows.push(row);console.error(JSON.stringify(row));
}
{const h=setup(2,'distinct-owner-name',true);const row={owners:2,cellsOfLargestOwner:9999,kind:'concentrated-distinct-name',snapshotCallsPerPublishedDelta:h.calls,snapshotCallsPerBurst100:h.burst(),deltaWithFlush:measure(h.cycle,8),burst100:measure(h.burst,1,3)};h.stop();result.rows.push(row);console.error(JSON.stringify(row));}
console.log(JSON.stringify(result,null,2));
