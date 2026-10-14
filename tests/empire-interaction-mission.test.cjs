'use strict';
// Release regression promoted from independent review. Synthetic DOM/buttons/timers only.
// The production empire reader/adapter/runtime and actual native mission
// adapter run through final confirmation. No browser, network, or game IO.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const fixturePath = path.join(root, 'tests/empire-interaction.test.cjs');
const input = fs.readFileSync(fixturePath, 'utf8');
const fixture = Function('require', '__dirname', input.slice(0, input.indexOf('const canAct = h =>')) + '\nreturn {harness, A, B, SCOPE, START};')(createRequire(fixturePath), path.dirname(fixturePath));
const source = fs.readFileSync(root+'/old-light-auto-upgrade.user.js','utf8');
function section(src, begin, end) {const a=src.indexOf(begin),b=src.indexOf(end,a);assert.ok(a>=0&&b>a);return src.slice(a,b);}
const nativeCode=section(source,'// BEGIN NATIVE MISSION ADAPTER','// END NATIVE MISSION ADAPTER');
class Element {
  constructor(){this.attributes=new Map();this.listeners=new Map();this.isConnected=true;this.hidden=false;this.disabled=false;this.textContent='';this.dataset={};}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  removeAttribute(k){this.attributes.delete(k);}
  getAttribute(k){return this.attributes.get(k)??null;}
  closest(){return null;}
  remove(){this.isConnected=false;}
  addEventListener(type,fn){const a=this.listeners.get(type)||[];a.push(fn);this.listeners.set(type,a);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
  dispatchEvent(e){for(const fn of this.listeners.get(e.type)||[])fn(e);return true;}
  matches(){return false;}
}
class Dialog extends Element {get open(){return this.attributes.has('open');}}
class Button extends Element{}
class Input extends Element {constructor(){super();this.type='number';this.value='0';this.min='0';this.max='100';}}
async function scenario({at='none',eventType='touchstart',trusted=true}) {
  const cleanup=[];
  const h=fixture.harness({after:fn=>cleanup.push(fn)});
  let commits=0,guardCalls=0,eventObserved=false,resolveTarget;
  const windowListeners=new Map(),inspector=new Dialog(),dialog=new Dialog(),action=new Button(),confirm=new Button(),endpoint=new Button(),marker=new Button();
  action.textContent='Send fleet';confirm.textContent='Send';
  inspector.dataset.contentType='inspect';let body={firstChild:{}};
  const coord=new Element();coord.setAttribute('aria-label','Copy coordinates 2, 1');
  inspector.matches=s=>s==='.info-modal[data-content-type="inspect"]';
  inspector.querySelector=s=>s==='.inspect-copy-coord'?coord:s==='.info-modal-body'?body:s==='.inspect-actions > button.inspect-action-btn'?action:s==='.info-modal-trailing .info-modal-header-btn'?marker:s==='.inspect-system-name-text'?{textContent:'Destination'}:null;
  inspector.querySelectorAll=()=>[];
  let route={querySelectorAll:()=>[]};
  const columns=[{innerHTML:'origin',querySelector:s=>s==='.route-header-tile-name'?{textContent:'Origin'}:null},{innerHTML:'destination',querySelector:s=>s==='button.route-header-hex-clickable'?endpoint:null}];
  action.click=()=>{dialog.dataset.mode='dispatch';dialog.dataset.direction='forward';route={querySelectorAll:()=>columns};};
  endpoint.click=()=>{inspector.dataset.contentType='inspect';body={firstChild:{}};};
  const quantities={probe:1,marauder:0,sentinel:0,vanguard:0};
  const inputs=Object.keys(quantities).map(ship=>{const i=new Input();i.setAttribute('aria-label','Number of '+ship+' to send');return i;});
  dialog.querySelector=s=>s==='[data-field="dispatch-route-slot"] .route-header'?route:s==='[data-field="dispatch-confirm"]'?confirm:null;
  dialog.querySelectorAll=s=>s==='[data-field="dispatch-quantities"] input.dispatch-step-input'?inputs:[];
  const oldQuery=h.document.querySelector,oldQueryAll=h.document.querySelectorAll;
  h.document.createElement=()=>new Element();h.document.head={append(){}};
  h.document.querySelector=s=>s==='dialog[open]'?([dialog,inspector].find(d=>d.open)||null):oldQuery(s);
  h.document.querySelectorAll=s=>s==='dialog.info-modal'?[inspector]:s==='dialog[open]'?[dialog,inspector].filter(d=>d.open):s==='#dispatch-dialog'?[dialog]:oldQueryAll(s);
  function event(){eventObserved=true;for(const fn of windowListeners.get(eventType)||[])fn({type:eventType,isTrusted:trusted});h.event(eventType,'game',trusted);}
  confirm.click=()=>{
    if(at==='commit')event();
    let prevented=false;const e={type:'click',target:confirm,preventDefault(){prevented=true;},stopImmediatePropagation(){}};
    for(const fn of windowListeners.get('click')||[]){guardCalls++;fn(e);}
    if(!prevented){commits++;dialog.removeAttribute('open');dialog.dispatchEvent(new Event('close'));}
  };
  const globals={AbortController,Event,HTMLElement:Element,HTMLDialogElement:Dialog,HTMLButtonElement:Button,HTMLInputElement:Input,
    document:h.document,performance:{now:()=>h.clock},setTimeout:h.ctx.setTimeout,clearTimeout:h.ctx.clearTimeout,
    window:{addEventListener(type,fn){const a=windowListeners.get(type)||[];a.push(fn);windowListeners.set(type,a);},removeEventListener(type,fn){windowListeners.set(type,(windowListeners.get(type)||[]).filter(x=>x!==fn));}}};
  vm.createContext(globals);vm.runInContext(nativeCode+';this.factory=createNativeMissionAdapter;',globals);
  vm.runInContext(section(source,'  function empireMissionPermission()', '\n  function canNavigateEmpire()'),h.ctx);
  const mission=globals.factory({getContext:()=>({scope:fixture.SCOPE,originId:fixture.A,originName:'Origin',selectionCount:1}),
    getFleet:ship=>({parked:ship==='probe'?2:0,away:0,building:0}),canAct:()=>h.ctx.empireMissionPermission(),
    resolveTarget:(_job,{signal})=>new Promise((resolve,reject)=>{resolveTarget=()=>resolve({inspector,cleanup(){}});signal.addEventListener('abort',()=>reject(signal.reason));})});
  h.ctx.missionAdapter=mission;
  const job={id:'independent-commit',scope:fixture.SCOPE,originId:fixture.A,originName:'Origin',target:{mode:'custom',routeKey:'',presetKey:'Use 1 Probe',coordinate:{q:2,r:1},missionAction:'send'},quantities,claimedAt:fixture.START};
  let settled=false,result;const promise=mission.dispatch(job).then(x=>{settled=true;result=x;});
  assert.equal(mission.isBusy(),true,'Fixture enters the real mission preparation');
  if(at==='resolve')event();
  resolveTarget();await h.advance(300);
  assert.equal(settled,true,'Fixture must complete real mission preparation/confirmation');await promise;
  const record={at,eventType,trusted,commits,guardCalls,eventObserved,status:result.status,pausedUntil:h.controller.state().pausedUntil};
  mission.destroy();cleanup.forEach(fn=>fn());return record;
}
test('native mission commits normally without interaction and ignores synthetic touch events', async () => {
  for (const options of [{at:'none'}, {at:'commit',trusted:false}]) {
    const row=await scenario(options);
    assert.equal(row.commits,1,JSON.stringify(row)); assert.equal(row.status,'sent');
    assert.ok(row.guardCalls>0,'The real final-click guard must execute');
  }
});
test('touch-only interaction prevents native mission commit at resolver and final click boundaries', async () => {
  for (const at of ['resolve','commit']) {
    const row=await scenario({at});
    assert.equal(row.eventObserved,true); assert.equal(row.commits,0,JSON.stringify(row));
    assert.equal(row.status,'waiting'); assert.ok(row.pausedUntil>fixture.START);
  }
});
test('pointer, key and wheel interruptions still prevent the final native mission commit', async () => {
  for (const eventType of ['pointerdown','keydown','wheel']) {
    const row=await scenario({at:'commit',eventType});
    assert.equal(row.eventObserved,true); assert.equal(row.commits,0,JSON.stringify(row));
    assert.equal(row.status,'waiting');
  }
});
