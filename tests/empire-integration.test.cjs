'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../docs/empire-core.js');
const runtime = require('../docs/empire-runtime.js');
const adapterModule = require('../docs/empire-adapter.js');
const observer = require('../docs/empire-observer.js');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');

test('early observation retains content isolation and only the specifically approved extra grant', () => {
  const meta = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.meta.js'), 'utf8');
  for (const text of [source, meta]) {
    assert.match(text, /@run-at\s+document-start/); assert.match(text, /@inject-into\s+content/);
    assert.deepEqual([...text.matchAll(/^\/\/ @grant\s+(\S+)/gm)].map(x=>x[1]), ['GM_xmlhttpRequest','GM_getValue','GM_setValue','GM.setValue','GM_addElement']);
    assert.doesNotMatch(text, /@grant\s+unsafeWindow/);
  }
});
test('all six source modules are embedded byte-for-byte', () => {
  const begin=source.indexOf('// BEGIN EMBEDDED EMPIRE MODULES'), end=source.indexOf('// END EMBEDDED EMPIRE MODULES');
  assert.ok(begin>0 && end>begin);
  for(const name of ['core','runtime','panel','observer','adapter','bridge']) {
    const content=fs.readFileSync(path.join(root,`docs/empire-${name}.js`),'utf8').trim();
    assert.ok(source.slice(begin,end).includes(content),`embedded ${name} source differs`);
  }
});
test('document-start loads only passive modules and defers the legacy Helper until DOM ready',()=>{
  const events=[], queries=[]; let watches=0;
  const win={};win.top=win;win.self=win;
  const context={window:win,location:{origin:'https://oldlight.io',pathname:'/game/galaxy/alpha'},
    document:{readyState:'loading',documentElement:null,head:null,addEventListener:(type,fn,options)=>events.push({type,fn,options}),
      querySelector:selector=>{queries.push(selector);throw new Error('Legacy UI ran before DOM ready');}},
    GM_addElement(){ throw new Error('No root should defer insertion'); },
    crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    MutationObserver:class{observe(){watches++;}disconnect(){}},
  };
  for(const name of ['GM_getValue','GM_setValue','GM_xmlhttpRequest','localStorage'])Object.defineProperty(context,name,{get(){throw new Error('Early code touched privileged storage '+name);}});
  vm.runInNewContext(source,context);
  assert.deepEqual(queries,[]);assert.equal(events.length,1);assert.equal(events[0].type,'DOMContentLoaded');assert.equal(events[0].options.once,true);
  assert.equal(typeof events[0].fn,'function');assert.equal(watches,1);
  assert.equal(context.OldLightEmpireBridge.status().observed,false);
});
test('late observer bootstrap leaves the imperial bridge absent rather than opening a socket',()=>{
  const marker=source.indexOf('// Privileged Helper and Drive stay');
  const start=source.lastIndexOf('(() => {',marker), end=source.indexOf('})();',marker)+5;
  const win={};win.top=win;win.self=win;
  const context={window:win,location:{pathname:'/game/galaxy/alpha'},document:{readyState:'complete'},
    OldLightEmpireBridgeFactory:{create(){throw new Error('Late injection must not run');}}};
  vm.runInNewContext(source.slice(start,end),context);assert.equal(context.OldLightEmpireBridge,undefined);
});
test('in-flight mission permission is independent of its own modal/busy navigation guard',()=>{
  const start=source.indexOf('  function empireMissionPermission('),end=source.indexOf('  function canNavigateEmpire(',start);
  let current={context:{scope:'alpha/me',owned:true,settled:true,selectionCount:1,systemId:'star'},snapshot:{scope:'alpha/me',systemId:'star',owned:true,observedAt:1000}};
  const ctx={Date:{now:()=>1000},systemId:()=> 'star',missionAdapter:{isBusy:()=>true},attackRetry:{isBusy:()=>false},
    empireController:{isEnabled:()=>true,canAct:()=>false,state:()=>({scope:'alpha/me',config:{systems:{}},maxAgeMs:120000})},empireAdapter:{readActive:()=>current}};
  vm.createContext(ctx);vm.runInContext(source.slice(start,end)+';this.allowed=empireMissionPermission;',ctx);
  assert.equal(ctx.allowed(),true);current.context.owned=false;assert.equal(ctx.allowed(),false);current.context.owned=true;current.context.scope='other/me';assert.equal(ctx.allowed(),false);
});
test('native source observer, adapter and coordinator share one transit census and visit both systems',async()=>{
  const P='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',A='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',B='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  let clock=1000000,active=A,clicks=0;
  const own=(id,q)=>({id,q,r:0,name:id,buildings:[{type:'shipyard',level:0}],fleet:[{type:'probe',quantity:2}],
    economy:{resources:{palladium:100,iridium:100,settledAt:new Date(clock).toISOString()},paCap:1000,irCap:1000,paRatePerMin:0,irRatePerMin:0,energyCap:10,energyUsed:0,deficitMultiplier:1,queueSlots:2,queue:[]}});
  const reducer=observer.createReducer({galaxy:'alpha',now:()=>clock});const generation=reducer.beginConnection();
  reducer.ingest('42'+JSON.stringify(['world.init',{selfId:P,serverNow:clock,world:{players:[{id:P,owned:[own(A,0),own(B,1)],transits:[],credits:null}]}}]),generation);
  assert.equal(reducer.snapshot().complete,true);
  const next={disabled:false,hidden:false,isConnected:true,classList:{contains:()=>false},getAttribute:()=>null,getClientRects:()=>[{}],closest:()=>null,click(){active=active===A?B:A;clicks++;}};
  const document={defaultView:{getComputedStyle:()=>({visibility:'visible',display:'block'})},hidden:false,activeElement:null,querySelector:()=>null,querySelectorAll:s=>s==='[data-field="nameplate-next"]'?[next]:[],addEventListener(){},removeEventListener(){}};
  const timers=new Map();let timer=0;
  const adapter=adapterModule.create({getWorld:()=>reducer.snapshot(),getContext:()=>({scope:'alpha/'+P,systemId:active,selectionCount:1,settled:true}),
    getHudSnapshot:()=>({resources:{palladium:{amount:100,cap:1000,rate:0},iridium:{amount:100,cap:1000,rate:0}},
      fleet:Object.fromEntries(core.DEFAULT_SHIPS.map(id=>[id,{parked:id==='probe'?2:0,away:0,building:0}])),queue:{buildings:0,ships:0},energy:10}),document,canNavigate:()=>true,now:()=>clock,settleMs:40,pollMs:20,
    setTimeout(fn,ms){const id=++timer;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id)});
  let saved=core.normalizeConfig({enabled:true,fleetTargets:{probe:10}});
  const controller=runtime.create({core,adapter,read:()=>saved,write:(_k,v)=>saved=v,now:()=>clock});
  const tick=()=>controller.update({scope:'alpha/'+P});
  let state=tick();assert.equal(state.ready,true);assert.equal(state.plan.summary.totals.fleet.probe.total,4);
  assert.equal(state.plan.summary.allocationsBySystem[A].probe,3);assert.equal(state.plan.summary.allocationsBySystem[B].probe,3);
  assert.equal(controller.canAct(adapter.readActive().context),true);
  clock+=5001;tick();
  for(let i=0;i<20&&controller.isBusy();i++){clock+=20;for(const [id,t]of[...timers])if(t.at<=clock){timers.delete(id);t.fn();}await Promise.resolve();await Promise.resolve();}
  assert.equal(active,B);assert.equal(clicks,1);state=tick();assert.equal(state.ready,true);assert.equal(controller.canAct(adapter.readActive().context),true);
  reducer.loseConnection(generation);assert.equal(controller.canAct(adapter.readActive()?.context),false);assert.equal(tick().ready,false);adapter.dispose();
});
