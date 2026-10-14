'use strict';
// Real Helper policy projection/application handlers. No network or game DOM.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../old-light-auto-upgrade.user.js'),'utf8');
const empireCore=fs.readFileSync(path.join(__dirname,'../docs/empire-core.js'),'utf8');
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const handlers=slice('  function exportEmpirePolicyForBackup(', '  function backupError(')
  +slice('  function applySyncedEmpirePolicy(', '  function createPreferenceSync(');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCOPE='alpha/player';
const copy=v=>JSON.parse(JSON.stringify(v));
function harness(){
 const ctx=vm.createContext({});
 vm.runInContext(empireCore+`\n
 const A=${JSON.stringify(A)},B=${JSON.stringify(B)},SCOPE=${JSON.stringify(SCOPE)};
 const clone=value=>JSON.parse(JSON.stringify(value));
 const SCRIPT_VERSION='candidate',KEY='settings';
 let scope=SCOPE,policyScope=SCOPE,storageError=false,enabled=false,busy=false;
 let flags={},settings={enabled:true,order:['reactor']},raw=JSON.stringify(settings);
 let config=OldLightEmpireCore.normalizeConfig({enabled:false,fleetTargets:{probe:4},systems:{[A]:{name:'Local name',role:'balanced',enabled:true}}});
 let importingBackup=false,pending=null,lastPreferenceEditAt=0,error='',unconfirmed=0;
 let writes=0,settingsWrites=0,suspended=0,scheduled=0,ready=true,notifications={enabled:false},targets={targets:{}},retries={enabled:false},missions={orders:['unchanged']};
 const empireController={
  state:()=>({scope:policyScope,storageError,config:clone(config),ready}),exportConfig:()=>clone(config),isBusy:()=>busy,
  setConfig(value){writes++;if(flags.failEmpireBefore===writes || flags.failEmpireFrom && writes>=flags.failEmpireFrom)throw Error('Write failed');config=clone(value);ready=false;if(flags.failEmpireAfter===writes)throw Error('After write');return clone(config);},
  suspend(){suspended++;ready=false;}
 };
 const missionContext=()=>({scope}),normalizeSettings=clone,validateBackup=clone;
 const missionAdapter={isBusy:()=>flags.missionBusy===true};
 const attackRetry={isBusy:()=>flags.retryBusy===true,backupCheckpoint:()=>clone(retries),exportConfig:()=>clone(retries),
 importPreferences:value=>{retries=clone(value);if(flags.failRetries)throw Error('Retry write failed');},restoreCheckpoint:value=>{retries=clone(value);}};
 const notifier={exportConfig:()=>clone(notifications),importConfig:value=>{notifications=clone(value);}};
 const levelTargets={exportConfig:()=>clone(targets),importConfig:value=>{targets=clone(value);}};
 const fleetWait={exportConfig:()=>clone(missions),backupCheckpoint:()=>clone(missions),restoreCheckpoint:value=>{missions=clone(value);}};
 const driveBackup=null;
 const localStorage={getItem:()=>raw,setItem:(_key,value)=>{settingsWrites++;if(flags.failSettingsFrom && settingsWrites>=flags.failSettingsFrom)throw Error('Store unavailable');raw=value;},removeItem:()=>{raw=null;}};
 const host={shadowRoot:{activeElement:null,querySelector:()=>false}};
 const cancelNumericDraftTimers=()=>{},restoreNumericInputs=()=>{},schedule=()=>{scheduled++;};
 const syncSettingsTabs=()=>{if(flags.failRender)throw Error('Render failed');};
 `+handlers+`\nthis.invoke=(method,json)=>{
 const value=JSON.parse(json);
 if(method==='backup')return JSON.stringify(createBackup());
 if(method==='apply'){try{applySyncedPreferences(value);return JSON.stringify({ok:true});}catch(error){return JSON.stringify({ok:false,code:error.code,message:error.message});}}
 if(method==='flags'){flags=value;return 'null';}
 if(method==='scope'){scope=value;return 'null';}
 if(method==='policyScope'){policyScope=value;return 'null';}
 if(method==='storageError'){storageError=value;return 'null';}
 if(method==='active'){config.enabled=value;return 'null';}
 if(method==='moving'){busy=value;return 'null';}
 if(method==='pending'){pending=value;return 'null';}
 if(method==='importing'){importingBackup=value;return 'null';}
 if(method==='editing'){lastPreferenceEditAt=Date.now();host.shadowRoot.activeElement=value?{matches:()=>true}:null;return 'null';}
 if(method==='view')return JSON.stringify({config,settings,raw,notifications,targets,retries,missions,writes,settingsWrites,suspended,scheduled,ready,importingBackup,error});
 throw Error('Unknown method');
 };`,ctx);
 const run=(method,value=null)=>JSON.parse(ctx.invoke(method,JSON.stringify(value)));
 return {run,backup:()=>run('backup'),view:()=>run('view')};
}
test('export includes only a loaded policy for the exact current game account and galaxy',()=>{
 const h=harness();assert.equal(h.backup().empire.scope,SCOPE);
 h.run('scope','beta/other');const backup=h.backup();assert.equal(backup.profile,'beta/other');assert.equal(backup.empire,undefined);
 h.run('scope',SCOPE);h.run('storageError',true);assert.equal(h.backup().empire,undefined);
 h.run('storageError',false);h.run('policyScope','');assert.equal(h.backup().empire,undefined);
});
test('remote policy updates preserve local global activation and display names',()=>{
 for(const enabled of [false,true]){
  const h=harness();h.run('active',enabled);const next=h.backup();next.empire.config.enabled=!enabled;
  next.empire.config.fleetTargets.probe=9;next.empire.config.systems[A]={name:'Remote name',role:'shipyard',enabled:false};
  next.empire.config.systems[B]={name:'Remote colony name',role:'industry',enabled:true};
  assert.equal(h.run('apply',next).ok,true);const after=h.view();
  assert.equal(after.config.enabled,enabled);assert.equal(after.config.fleetTargets.probe,9);
  assert.equal(after.config.systems[A].name,'Local name');assert.equal(after.config.systems[A].enabled,false);
  assert.equal(after.config.systems[B].name,'');assert.equal(after.ready,false);assert.equal(after.writes,1);
  assert.deepEqual(after.missions,{orders:['unchanged']});
 }
});
test('ordinary remote preferences and repeated identical policies never reset imperial runtime',()=>{
 const h=harness();const before=h.view(),next=h.backup();delete next.empire;
 next.settings.order=['warehouse'];assert.equal(h.run('apply',next).ok,true);
 assert.deepEqual(h.view().config,before.config);assert.equal(h.view().writes,0);assert.equal(h.view().ready,true);
 assert.equal(h.run('apply',h.backup()).ok,true);assert.equal(h.view().writes,0);
});
test('pending orders, navigation, import, missions and active editing defer policy application',()=>{
 for(const [kind,value] of [['pending',{id:'request'}],['moving',true],['importing',true],['editing',true],['flags',{missionBusy:true}],['flags',{retryBusy:true}]]){
  const h=harness();const next=h.backup();next.empire.config.fleetTargets.probe=50;h.run(kind,value);
  assert.equal(h.run('apply',next).code,'busy',kind);assert.equal(h.view().writes,0);assert.equal(h.view().settingsWrites,0);
 }
});
test('wrong, unloaded or unreadable policy scopes reject before changing ordinary settings',()=>{
 for(const [kind,value] of [['scope','beta/other'],['policyScope','beta/other'],['policyScope',''],['storageError',true]]){
  const h=harness(),next=h.backup();next.settings.enabled=false;next.empire.config.fleetTargets.probe=99;h.run(kind,value);
  assert.equal(h.run('apply',next).code,'busy');assert.equal(h.view().settingsWrites,0);assert.equal(h.view().writes,0);
 }
 const h=harness(),next=h.backup();next.empire.scope='beta/other';assert.equal(h.run('apply',next).code,'busy');
});
test('failed imperial persistence rolls back all ordinary preferences and preserves policy',()=>{
 const h=harness(),before=h.view(),next=h.backup();next.settings.order=['shipyard'];next.notifications.enabled=true;
 next.empire.config.fleetTargets.probe=12;h.run('flags',{failEmpireBefore:1});
 assert.equal(h.run('apply',next).code,'storage_error');const after=h.view();
 for(const key of ['settings','raw','notifications','targets','retries','missions','config'])assert.deepEqual(after[key],before[key],key);
 assert.equal(after.importingBackup,false);assert.equal(after.scheduled,1);
});
test('failure after policy persistence restores prior policy and revokes stale planning authority',()=>{
 const h=harness(),before=h.view(),next=h.backup();next.empire.config.fleetTargets.probe=55;h.run('flags',{failRender:true});
 assert.equal(h.run('apply',next).code,'storage_error');const after=h.view();assert.deepEqual(after.config,before.config);
 assert.equal(after.writes,2);assert.equal(after.ready,false);assert.equal(after.importingBackup,false);
});
test('failed rollback pauses ordinary and imperial execution instead of continuing partially applied',()=>{
 const h=harness(),next=h.backup();h.run('active',true);next.empire.config.fleetTargets.probe=23;
 h.run('flags',{failRender:true,failEmpireBefore:2});assert.equal(h.run('apply',next).code,'storage_error');
 const after=h.view();assert.equal(after.settings.enabled,false);assert.equal(after.suspended,1);assert.equal(after.ready,false);
 assert.match(after.error,/Automatización pausada/);assert.equal(after.importingBackup,false);
 assert.equal(JSON.parse(after.raw).enabled,false);assert.equal(after.config.enabled,false);
});
test('failure thrown after a store write is rolled back even before helper receives success',()=>{
 const h=harness(),before=h.view(),next=h.backup();next.empire.config.fleetTargets.probe=18;h.run('flags',{failEmpireAfter:1});
 assert.equal(h.run('apply',next).code,'storage_error');assert.deepEqual(h.view().config,before.config);assert.equal(h.view().writes,2);
});
test('policy UI saves feed normal Drive change detection without making a game order',()=>{
 const start=source.indexOf('  function installEmpirePanel('),end=source.indexOf('\n  try {\n    const core = globalThis.OldLightEmpireCore;',start);
 assert.ok(start>=0&&end>start);const code=source.slice(start,end);const calls=[];let callback;
 const ctx=vm.createContext({document:{},empireController:{state:()=>({}),setConfig:v=>{calls.push('save');return v;}},
  empireAdapter:{isAvailable:()=>false},empirePanel:null,settingsChanged:()=>calls.push('notify'),schedule:()=>calls.push('schedule'),
  OldLightEmpireCore:{},OldLightEmpirePanel:{create:o=>{callback=o.setConfig;return{mount:()=>{}};}}});
 vm.runInContext(code+'\ninstallEmpirePanel({querySelector:()=>({})});',ctx);callback({enabled:true});
 assert.deepEqual(calls,['save','notify','schedule']);
});

test('fully unavailable storage discloses that a session pause cannot be guaranteed after reload',()=>{
 const h=harness();h.run('active',true);const next=h.backup();next.settings.order=['shipyard'];next.empire.config.fleetTargets.probe=55;
 h.run('flags',{failRender:true,failEmpireFrom:2,failSettingsFrom:2});
 assert.equal(h.run('apply',next).code,'storage_error');const after=h.view();
 assert.equal(after.settings.enabled,false);assert.equal(after.suspended,1);assert.equal(after.ready,false);
 assert.match(after.error,/solo en esta sesión/);assert.match(after.error,/antes de recargar/);
});
