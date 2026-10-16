'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../old-light-auto-upgrade.user.js'), 'utf8');
function harness() {
  const hud = {available:true};
  const h = {settings:{enabled:true},document:{hidden:false,querySelector:s=>s==='#structures'||s==='#fleet'?hud:null},
    navigator:{locks:{request(){}}},importingBackup:false,pending:null,leader:true,releaseLock:()=>{},lockError:false,
    PANEL:'#structures',FLEET_PANEL:'#fleet',hudPanelAvailable:p=>p?.available===true,
    reports:{isRecovering:()=>false},reinforcementNavigation:{isBusy:()=>false},missionAdapter:{isBusy:()=>false},attackRetry:{isBusy:()=>false},
    missionContext:()=>({scope:'g/p',originId:'own',selectionCount:1}),empireController:{isEnabled:()=>false},
    empireAdapter:{readActive:()=>({context:{}})},host:{shadowRoot:{activeElement:null}}};
  const start = source.indexOf('  function reinforcementDispatchBlock() {'), end = source.indexOf('  function installReinforcementPanel', start);
  assert.ok(start>0 && end>start, 'production diagnostic boundary exists');
  vm.createContext(h); vm.runInContext(source.slice(start,end)+'\nthis.inspect = reinforcementDispatchBlock;',h);
  return {h,hud,check:()=>h.inspect()};
}
test('production route diagnosis explains native HUD gate and recovers without changing permissions', () => {
 const {h,hud,check}=harness(); assert.equal(check(),null);
 hud.available=false;
 assert.equal(check().code,'hud'); assert.match(check().message,/Structures o Shipyard/);
 assert.match(check().message,/Helper no sustituye/);
 assert.equal(h.settings.enabled,true); assert.equal(h.leader,true);
 hud.available=true; assert.equal(check(),null);
 assert.match(source,/getDiagnostics: \(\) => reinforcementRoutes\.diagnostics\(reinforcementDispatchBlock\(\)\)/);
});
for(const [code,change] of [
 ['helper-paused',h=>h.settings.enabled=false],['hidden',h=>h.document.hidden=true],
 ['import',h=>h.importingBackup=true],['pending-order',h=>h.pending={}],
 ['web-locks',h=>h.navigator.locks=null],['leadership',h=>h.leader=false],
 ['reports',h=>h.reports.isRecovering=()=>true],['navigation',h=>h.reinforcementNavigation.isBusy=()=>true],
 ['mission-busy',h=>h.missionAdapter.isBusy=()=>true],['mission-busy',h=>h.attackRetry.isBusy=()=>true],
 ['dialog',h=>{const prior=h.document.querySelector;h.document.querySelector=s=>s==='dialog[open]'?{}:prior(s);}],
 ['loading',h=>{const prior=h.document.querySelector;h.document.querySelector=s=>s.includes('.b-loading')?{}:prior(s);}],
 ['selection',h=>h.missionContext=()=>({scope:'g/p',originId:'own',selectionCount:null})],
 ['empire',h=>h.empireController={isEnabled:()=>true,canAct:()=>false,state:()=>({status:'Pausa por interacción: 9 s restantes.'})}],
 ['editing',h=>h.host.shadowRoot.activeElement={matches:()=>true}],
]) test('production route diagnosis exposes '+code+' without acting',()=>{
 const {h,check}=harness(); change(h); const d=check(); assert.equal(d.code,code); assert.ok(d.message.length>10);
 assert.equal(check().code,code);
});
test('diagnosis does not report permanent locks failure when another tab owns the lease',()=>{
 const {h,check}=harness();h.releaseLock=null;assert.equal(check().code,'leadership');assert.match(check().message,/otra pestaña/);
 h.lockError=true;assert.match(check().message,/Recarga/);
});
