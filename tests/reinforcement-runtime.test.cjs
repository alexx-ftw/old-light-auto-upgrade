'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../docs/reinforcement-runtime.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 let context={scope:'g/p',originId:'a',coordinated:true,canNavigate:true},empire=false,time=1000,route={id:'r',originId:'b',paused:false};
 let resolve,guard,visits=0,paused=0;
 const core={dueOrigins:()=>route.paused?[]:['b'],list:()=>[{...route}],pause:()=>{route.paused=true;paused++;}};
 const runtime=create({core,adapter:{canNavigate:()=>true,selectSystem:(id,options)=>{visits++;guard=options.isCurrent;return new Promise(r=>resolve=r);}},getContext:()=>context,isEmpireEnabled:()=>empire,now:()=>time});
 return {runtime,context,route,core,setEmpire:x=>empire=x,advance:x=>time+=x,finish:async(result=true)=>{resolve(result);await flush();},get guard(){return guard;},get visits(){return visits;},get paused(){return paused;}};
}
test('routes navigation owns a single selector operation and yields on arrival',async()=>{const h=harness();assert.equal(h.runtime.tick(),true);assert.equal(h.runtime.tick(),true);await flush();assert.equal(h.visits,1);assert.equal(h.guard(),true);await h.finish();assert.equal(h.runtime.isBusy(),false);assert.equal(h.runtime.tick(),false);h.advance(1600);h.context.originId='b';assert.equal(h.runtime.tick(),false);});
for(const key of ['coordinated','canNavigate'])test('routes navigation requires '+key,()=>{const h=harness();h.context[key]=false;assert.equal(h.runtime.tick(),false);assert.equal(h.visits,0);});
test('routes navigation leaves enabled empire its exclusive selector',()=>{const h=harness();h.setEmpire(true);assert.equal(h.runtime.tick(),false);});
for(const kind of ['cancel','scope','leadership','pause','edit','empire'])test('route navigation revalidates '+kind+' at each native hop',async()=>{const h=harness();h.runtime.tick();await flush();if(kind==='cancel')h.runtime.cancel();if(kind==='scope')h.context.scope='other/p';if(kind==='leadership')h.context.coordinated=false;if(kind==='pause')h.route.paused=true;if(kind==='edit')h.route.intervalMinutes=30;if(kind==='empire')h.setEmpire(true);assert.equal(h.guard(),false);await h.finish(false);assert.equal(h.paused,0);assert.equal(h.runtime.isBusy(),false);});
test('unconfirmed native origin pauses route instead of repeatedly visiting',async()=>{const h=harness();h.runtime.tick();await flush();await h.finish(false);assert.equal(h.paused,1);h.advance(3000);assert.equal(h.runtime.tick(),false);assert.match(h.runtime.status(),/No se confirmó/);});
test('cancel before the async selector starts causes zero native clicks',async()=>{const h=harness();h.runtime.tick();h.runtime.cancel();await flush();assert.equal(h.visits,0);assert.equal(h.runtime.isBusy(),false);});
