'use strict';
// Offline end-to-end adapter/shortcut control flow using deterministic DOM doubles.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','old-light-auto-upgrade.user.js'),'utf8');
const block=name=>source.slice(source.indexOf('// BEGIN '+name),source.indexOf('// END '+name));
const SELF='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ALLY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',RIVAL='cccccccc-cccc-4ccc-8ccc-cccccccccccc',ORIGIN='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function harness(options={}){
 const listeners=new Map(),window={addEventListener:(k,f)=>{if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(f);},removeEventListener:(k,f)=>listeners.set(k,(listeners.get(k)||[]).filter(x=>x!==f))};
 class Ev{constructor(type,options={}){Object.assign(this,options);this.type=type;this.isTrusted=false;}preventDefault(){this.prevented=true;}stopImmediatePropagation(){this.stopped=true;}stopPropagation(){}}
 class Element{constructor(){this.attrs=new Map();this.dataset={};this.isConnected=true;this.hidden=false;this.listeners=new Map();this.textContent='';}
 setAttribute(k,v){this.attrs.set(k,String(v));}getAttribute(k){return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}remove(){this.isConnected=false;}closest(){return null;}matches(){return false;}querySelector(){return null;}querySelectorAll(){return [];}focus(){}
 addEventListener(k,f){if(!this.listeners.has(k))this.listeners.set(k,[]);this.listeners.get(k).push(f);}removeEventListener(k,f){this.listeners.set(k,(this.listeners.get(k)||[]).filter(x=>x!==f));}
 dispatchEvent(e){e.target=this;for(const f of [...(this.listeners.get(e.type)||[])]){f(e);if(e.stopped)break;}return !e.prevented;}}
 class Button extends Element{constructor(text='',native=()=>{}){super();this.textContent=text;this.disabled=false;this.native=native;}click(){const e=new Ev('click');e.target=this;for(const f of [...(listeners.get('click')||[])]){f(e);if(e.stopped)break;}if(!e.stopped)this.native(e);}}
 class Dialog extends Element{get open(){return this.attrs.has('open');}close(){this.removeAttribute('open');this.dispatchEvent(new Ev('close'));}}
 class Input extends Element{constructor(type){super();this.type='number';this.min='0';this.max='20';this.value='0';this.disabled=false;this.setAttribute('aria-label','Number of '+type+' to send');}matches(s){return s===':disabled'&&this.disabled;}}
 const store=new Map();let currentScope='alpha/'+SELF,clock=10000,sends=0,prepares=0,inspectSource=false,body={firstChild:{}},route;
 let world={version:1,scope:currentScope,selfId:SELF,connected:true,observedAt:clock,epoch:1,generation:1,revision:0,ownership:{version:1,complete:false,players:[{id:SELF,name:'Self',owned:[{q:0,r:0}]},{id:ALLY,name:'Trusted Pilot',owned:[{q:7,r:8}]},{id:RIVAL,name:'Other Pilot',owned:[{q:2,r:3}]}]}};
 const toAlly=()=>{world.ownership.players[2].owned=[];world.ownership.players[1].owned.push({q:2,r:3});world.revision++;};
 const inspector=new Dialog(),dialog=new Dialog(),error=new Element();error.hidden=true;dialog.dataset={mode:'dispatch',direction:'forward'};
 const quantities={probe:0,marauder:3,sentinel:0,vanguard:0},inputs=Object.keys(quantities).map(t=>new Input(t));
 const inspect=origin=>{inspectSource=origin;body.firstChild={};inspector.dataset.contentType='inspect';};
 const sourceButton=new Button('Origin',()=>inspect(true)),targetButton=new Button('Destination',()=>inspect(false));
 const columns=[sourceButton,targetButton].map((button,i)=>({innerHTML:'route-'+i,querySelector:s=>s.includes('route-header-hex-clickable')?button:s==='.route-header-tile-name'?{textContent:i?'Destination':'Origin'}:null}));
 const newRoute=()=>({isConnected:true,querySelectorAll:s=>s===':scope > .route-header-tile-col'?columns:[]});route=newRoute();
 const action=new Button('Attack',()=>{prepares++;dialog.setAttribute('open','');route=newRoute();if(options.duringPrepare)setTimeout(toAlly,20);});
 const coord=new Element();coord.getAttribute=()=>inspectSource?'Copy coordinates 0, 0':'Copy coordinates 2, 3';
 inspector.matches=s=>s==='.info-modal[data-content-type="inspect"]';
 inspector.querySelector=s=>s==='.inspect-copy-coord'?coord:s==='.info-modal-body'?body:s==='.info-modal-trailing .info-modal-header-btn'?(inspectSource?null:new Button('Jump to')):s==='.inspect-actions > button.inspect-action-btn'?action:s==='.inspect-system-name-text'?{textContent:inspectSource?'Origin':'Destination'}:null;
 const preset=new Button('Use 3 Marauder',()=>inputs.forEach((input,i)=>input.value=String(Object.values(quantities)[i])));preset.setAttribute('aria-label','Use 3 Marauder');
 const confirm=new Button('Attack',()=>{sends++;dialog.close();});
 for(const input of inputs){const row={querySelector:s=>s==='.dispatch-ship-avail'?{textContent:'20 available'}:null};input.closest=s=>s==='.dispatch-ship-row'?row:null;if(options.duringInput)input.addEventListener('input',()=>{if(world.ownership.players[2].owned.length)toAlly();});}
 dialog.querySelector=s=>s==='[data-field="dispatch-route-slot"] .route-header'?route:s==='[data-field="dispatch-confirm"]'?confirm:s==='[data-field="dispatch-error"]'?error:null;
 dialog.querySelectorAll=s=>s==='[data-field="dispatch-quantities"] input.dispatch-step-input'?inputs:s==='[data-field="dispatch-presets"] .dispatch-preset-apply'?[preset]:[];
 const document={head:{append(){},appendChild(){}},createElement:()=>new Element(),activeElement:null,addEventListener(){},removeEventListener(){},
 querySelectorAll:s=>s==='#dispatch-dialog'?[dialog]:s==='dialog.info-modal'?[inspector]:s==='dialog[open]'?[dialog,inspector].filter(x=>x.open):[],querySelector:s=>s==='dialog[open]'?[dialog,inspector].find(x=>x.open)||null:null};
 const sandbox=vm.createContext({window,document,HTMLElement:Element,HTMLDialogElement:Dialog,HTMLButtonElement:Button,HTMLInputElement:Input,Event:Ev,AbortController,performance,Date,setTimeout,clearTimeout,cancelAnimationFrame(){},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)}});
 vm.runInContext(block('ALLY PROTECTION')+'\n'+block('NATIVE MISSION ADAPTER')+'\nthis.guardFactory=createAllyProtection;this.factory=createNativeMissionAdapter;',sandbox);
 const getContext=()=>({scope:currentScope,originId:ORIGIN,originName:'Origin',selectionCount:1});
 const guard=sandbox.guardFactory({getContext,getWorld:()=>world,storage:sandbox.localStorage,now:()=>clock});
 if(options.protected!==false)guard.add({id:ALLY,name:'Trusted Pilot'});
 if(options.initialAlly)toAlly();if(options.noWorld)world=null;
 window.addEventListener('click',e=>{if(e.target===confirm){if(options.atClick)toAlly();if(options.addAtClick)guard.add({id:RIVAL,name:'Other Pilot'});if(options.disconnectAtClick)world.connected=false;if(options.scopeAtClick)currentScope=options.scopeAtClick;if(options.clearAtClick)store.clear();}});
 const adapter=sandbox.factory({getContext,getFleet:()=>({parked:20,away:0,building:0}),resolveTarget:async()=>({inspector,cleanup(){}}),checkTarget:(j,p)=>guard.check(j,p)});
 const job={id:options.retry?'retry:synthetic':'pending-synthetic',scope:currentScope,originId:ORIGIN,originName:'Origin',target:{coordinate:{q:2,r:3},label:'Destination',routeKey:'',presetKey:options.amounts?'':'Use 3 Marauder',...(options.amounts?{mode:'amounts',originCoordinate:{q:0,r:0}}:options.legacy?{}:{mode:'custom',missionAction:'attack'})},quantities,claimedAt:1};
 function shift(){
  sandbox.allyProtection=guard;sandbox.missionAdapter=adapter;
  const begin=source.indexOf('  function checkProtectedPreset('),end=source.indexOf('  function offerPresetMission(',begin);
  vm.runInContext(source.slice(begin,end),sandbox);
  let shiftSource=block('SHIFT PRESETS').replace('return { cancel, destroy() {','return { testSend(current) { flow = current; sendPreset(current); }, cancel, destroy() {');
  vm.runInContext(shiftSource+'\nthis.shiftFactory=createShiftPresetMenu;',sandbox);
  dialog.setAttribute('open','');route=newRoute();
  const current={dialog,route,phase:'ready',selected:{index:0,key:'Use 3 Marauder'},openedRoute:columns.map(x=>x.innerHTML).join('\n'),permitConfirm:false,confirmed:false,maskedDialog:null};
  const menu=sandbox.shiftFactory({checkPreset:sandbox.checkProtectedPreset});
  menu.testSend(current);const value={sends,message:error.textContent,confirmed:current.confirmed};menu.destroy();return value;
 }
 return{adapter,guard,job,shift,get sends(){return sends;},get prepares(){return prepares;},get world(){return world;},destroy:()=>adapter.destroy()};
}
for(const [name,options,status,sends] of [
 ['baseline without list or census',{protected:false,noWorld:true},'sent',1],['known rival custom',{},'sent',1],['legacy preset',{legacy:true},'sent',1],['campaign amounts',{amounts:true,retry:true},'sent',1],
 ['protected owner',{initialAlly:true},'paused',0],['protected campaign',{initialAlly:true,amounts:true,retry:true},'paused',0],['missing ownership',{noWorld:true},'paused',0],
 ['capture during preparation',{duringPrepare:true},'paused',0],['capture while filling amounts',{duringInput:true},'paused',0],['capture at final click',{atClick:true},'paused',0],['protection added at final click',{addAtClick:true},'paused',0],['disconnect at final click',{disconnectAtClick:true},'paused',0],
]) test('native end-to-end: '+name,async()=>{const h=harness(options);try{const result=await h.adapter.dispatch(h.job);assert.equal(result.status,status,JSON.stringify(result));assert.equal(h.sends,sends);if(options.initialAlly)assert.equal(h.prepares,0);}finally{h.destroy();}});
for(const [name,options,sends] of [
 ['baseline',{protected:false,noWorld:true},1],['known rival',{},1],
 ['protected to empty new galaxy',{scopeAtClick:'beta/'+SELF},0],['protected to empty new account',{scopeAtClick:'alpha/'+RIVAL},0],
 ['empty to empty new galaxy',{protected:false,noWorld:true,scopeAtClick:'beta/'+SELF},0],['empty to empty new account',{protected:false,noWorld:true,scopeAtClick:'alpha/'+RIVAL},0],
 ['explicit removal in same scope',{clearAtClick:true},1],['protected owner',{initialAlly:true},0],['unknown owner',{noWorld:true},0],['capture at final click',{atClick:true},0],['added at final click',{addAtClick:true},0],['disconnect at final click',{disconnectAtClick:true},0],
]) test('Shift immediate preset end-to-end: '+name,()=>{const h=harness(options);try{const result=h.shift();assert.equal(result.sends,sends,JSON.stringify(result));if(!sends)assert.equal(result.confirmed,false);}finally{h.destroy();}});
