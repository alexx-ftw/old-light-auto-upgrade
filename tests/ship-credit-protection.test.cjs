'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.QA_SHIP_CREDIT_SOURCE || path.join(__dirname,'..','old-light-auto-upgrade.user.js'),'utf8');
const rates={probe:12,marauder:120,sentinel:52,vanguard:1800},scope='alpha/player';
function world(net=2000){return {connected:true,complete:true,scope,observedAt:1000,credits:{incomePerDay:10000,upkeepPerDay:10000-net},systems:[{id:'origin',shipyard:{types:Object.entries(rates).map(([type,upkeepPerDay])=>({type,stats:{upkeepPerDay}})),queue:[]}}]};}
function guard(){const start=source.indexOf('  function projectShipCredits(');assert.ok(start>=0,'production credit projection exists');return vm.runInNewContext(source.slice(start,source.indexOf('  function shipCreditPermission(',start))+'\nprojectShipCredits;');}
test('daily credit protection includes complete batches, all-system recruit queues and never credits future scrap',()=>{
 const project=guard(),w=world();
 assert.equal(project(w,scope,'origin','vanguard',1,1000).allowed,true);
 assert.equal(project(w,scope,'origin','vanguard',2,1000).allowed,false);
 w.systems.push({id:'other',shipyard:{types:w.systems[0].shipyard.types,queue:[{type:'marauder',kind:'recruit',quantityRemaining:2,quantityTotal:4},{type:'vanguard',kind:'scrap',quantityRemaining:10,quantityTotal:10}]}});
 assert.equal(project(w,scope,'origin','vanguard',1,1000).allowed,false);
 assert.equal(project(world(1800),scope,'origin','vanguard',1,1000).projected,0);
 assert.equal(project(world(-19400),scope,'origin','probe',1,1000).allowed,false);
});
test('protected production fails closed on unknown stale inconsistent or changed-account economics',()=>{
 const project=guard();
 for(const change of [w=>w.credits=null,w=>w.complete=false,w=>w.connected=false,w=>w.scope='other/player',w=>w.observedAt=-120000,w=>w.observedAt=2000,w=>w.systems[0].shipyard=null,w=>delete w.systems[0].shipyard.types[0].stats.upkeepPerDay,w=>w.systems[0].shipyard.queue.push({type:'probe',kind:'recruit',quantityRemaining:-1,quantityTotal:1}),w=>w.credits.upkeepPerDay=NaN]){
  const w=world();change(w);assert.equal(project(w,scope,'origin','probe',1,1000).allowed,false);
 }
 assert.equal(project(world(),scope,'missing','probe',1,1000).allowed,false);
});
test('production boundary blocks clicks with projected negative credits and permits opt-out or affordable orders',()=>{
 const start=source.indexOf("    if (candidate.kind === 'ship') {\n      const credit = shipCreditPermission");
 assert.ok(start>=0,'actual final production boundary must recheck credits');
 const end=source.indexOf('    // Registra la petición ANTES del clic',start);assert.ok(end>start);
 for(const [allowed,expected]of [[false,0],[true,1]]){
  let clicks=0,notice='';const run=vm.runInNewContext('(function(){'+source.slice(start,end)+';click();})',{candidate:{kind:'ship',id:'probe',quantity:3},shipCreditPermission:()=>({allowed,message:'Créditos: bloqueado'}),show:m=>notice=m,click:()=>clicks++});run();assert.equal(clicks,expected);if(!allowed)assert.match(notice,/Créditos/);
 }
 const a=source.indexOf('  function shipCreditPermission('),b=source.indexOf('  function prepareShip(',a);
 const get=vm.runInNewContext(source.slice(a,b)+'\nshipCreditPermission;',{settings:{creditProtection:{probe:false}},globalThis:{},missionContext:()=>{throw Error('opt-out must not read census');}});
 assert.equal(get('probe',1).allowed,true);
});
test('credit toggles default protected, persist real changes and restore the prior choice on quota failure',()=>{
 let raw=null,fail=false;const nodes=[];
 const ctx=vm.createContext({localStorage:{getItem:()=>raw,setItem:(_key,value)=>{if(fail)throw Error('quota');raw=value;}},
  document:{createElement:()=>{const n={style:{},dataset:{},append(){},addEventListener(_e,f){this.change=f;}};nodes.push(n);return n;},createTextNode:x=>x},schedule(){},presentationFailure(){}});
 const constants=source.slice(source.indexOf('  const KEY ='),source.indexOf('  const upgradeEta ='));
 const helpers=source.slice(source.indexOf('  function normalizeOrder('),source.indexOf('  function text(node)'));
 const a=source.indexOf('  function installShipCreditToggle('),b=source.indexOf('  function projectShipCredits(',a);
 assert.ok(a>=0);
 vm.runInContext(constants+helpers+source.slice(a,b)+`let settings=normalizeSettings({}),importingBackup=true;
 globalThis.input=installShipCreditToggle({append(){}},'probe','Probe'); globalThis.values=()=>settings.creditProtection;`,ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.values())),{probe:true,marauder:true,sentinel:true,vanguard:true});
 ctx.input.checked=false;ctx.input.change();assert.equal(JSON.parse(raw).creditProtection.probe,false);
 fail=true;ctx.input.checked=true;ctx.input.change();assert.equal(ctx.input.checked,false);assert.equal(ctx.values().probe,false);
 fail=false;ctx.input.checked=true;ctx.input.change();assert.equal(JSON.parse(raw).creditProtection.probe,true);
});
test('credit choices remain local during shared journal overlay to preserve older client compatibility',()=>{
 const core=require('../docs/sync-core.js');
 const fixture=fs.readFileSync(path.join(__dirname,'drive-sync-core.test.cjs'),'utf8');
 const part=fixture.slice(fixture.indexOf('const BUILDINGS ='),fixture.indexOf('const maybe ='));
 const backup=JSON.parse(JSON.stringify(vm.runInNewContext(part+'\nbackup();')));
 backup.settings.creditProtection={probe:false,marauder:true,sentinel:true,vanguard:true};
 const flat=core.project(backup);assert.equal(Object.keys(flat).some(key=>key.includes('creditProtection')),false);
 const next=core.overlay(backup,{'settings.countAway':true});assert.equal(next.settings.creditProtection.probe,false);
});
