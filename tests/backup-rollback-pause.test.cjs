'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','old-light-auto-upgrade.user.js'),'utf8');
function slice(a,b){const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start);return source.slice(start,end);}
function fixture(faults={}){
 const ctx=vm.createContext({faults});
 vm.runInContext(slice('  const KEY =','  const upgradeEta =')+slice('  function normalizeOrder(','  function text(node)')+`
 let settings=normalizeSettings({enabled:true,excluded:['reactor'],shipMinimums:{marauder:9},countAway:true});
 let raw=faults.missing?null:JSON.stringify({...settings,...(faults.futureFields?{futurePolicy:{schemaVersion:99,mode:'synthetic-preserve'}}:{})}),importingBackup=false,error='',unconfirmed=0;
 let notificationCalls=0,scheduled=0,suspended=0,changed=0,reads=0,cancelled=0;
 const writes=[],copy=v=>JSON.parse(JSON.stringify(v));
 const notifier={validateConfig:copy,exportConfig:()=>({enabled:false}),importConfig(){notificationCalls++;if(faults.notify==='always'||faults.notify==='once'&&notificationCalls===1)throw Error('synthetic notification failure');}};
 const levelTargets={validateConfig:copy,exportConfig:()=>({}),importConfig(){}};
 const fleetWait={validateConfig:copy,backupCheckpoint:()=>({}),importConfig(){},restoreCheckpoint(){}};
 const attackRetry={validateConfig:copy,isBusy:()=>false,backupCheckpoint:()=>({}),importConfig(){},restoreCheckpoint(){},cleanupCancelledJobs(){}};
 const driveBackup=null,conquestNavigation=null,missionAdapter={isBusy:()=>false};
 const empireController=faults.empire?{isBusy:()=>false,exportConfig:()=>({enabled:true}),setConfig(){},suspend(){suspended++;if(faults.suspendThrows)throw Error('synthetic suspend failure');}}:null;
 const localStorage={getItem(){reads++;if(faults.verifyRead&&reads===2)throw Error('synthetic read failure');return raw;},setItem(_key,value){writes.push(value);if(writes.length===3&&faults.pauseWrite==='throw')throw Error('synthetic write failure');if(writes.length===3&&faults.pauseWrite==='ignore')return;raw=value;},removeItem(){raw=null;}};
 const shiftPresets={cancel(){cancelled++;}},ui=null;
 function cancelNumericDraftTimers(){}function restoreNumericInputs(){if(faults.render)throw Error('synthetic render failure');}
 function syncSettingsTabs(){}function layoutHelper(){}function schedule(){scheduled++;}function settingsChanged(){changed++;}
 `+slice('  function backupError(','  // BEGIN SHARED PREFERENCES INTEGRATION')+`
 const original=copy(settings),incoming={format:'old-light-auto-upgrade-backup',schemaVersion:1,settings:normalizeSettings({...settings,enabled:false,shipMinimums:{marauder:17}}),notifications:{enabled:false}};
 globalThis.api={run(patch={}){let message='';try{applyBackup({...copy(incoming),...patch});}catch(cause){message=cause.message;}return {message,state:copy(settings),raw,writes:[...writes],notificationCalls,scheduled,suspended,changed,cancelled,error,importingBackup};},original:()=>copy(original),reload:()=>readSettings().enabled};
 `,ctx);return ctx.api;
}
test('incomplete backup rollback durably pauses before reload while preserving prior preferences',()=>{
 const h=fixture({notify:'always'}),r=h.run();assert.equal(r.state.enabled,false);assert.equal(JSON.parse(r.raw).enabled,false);assert.equal(h.reload(),false);
 assert.deepEqual(JSON.parse(JSON.stringify({...r.state,enabled:true})),JSON.parse(JSON.stringify(h.original())));assert.equal(r.notificationCalls,2);assert.equal(r.changed,0);assert.equal(r.importingBackup,false);assert.match(r.message,/Automatización pausada/);
});
test('a complete backup rollback retains the exact previous bytes and original enabled choice',()=>{
 const h=fixture({notify:'once'}),r=h.run();assert.equal(r.raw,JSON.stringify(h.original()));assert.equal(r.state.enabled,true);assert.equal(h.reload(),true);assert.equal(r.writes.length,2);assert.match(r.message,/conservado los ajustes anteriores/);
});
test('a successful backup import still applies the requested preferences and reports its change',()=>{
 const h=fixture(),r=h.run();assert.equal(r.message,'');assert.equal(r.state.enabled,false);assert.equal(r.state.shipMinimums.marauder,17);assert.equal(h.reload(),false);assert.equal(r.changed,1);assert.equal(r.writes.length,1);
});
for(const mode of ['ignore','throw'])test('an unconfirmed durable pause warns session only when its write will '+mode,()=>{
 const h=fixture({notify:'always',pauseWrite:mode}),r=h.run();assert.equal(r.state.enabled,false);assert.equal(h.reload(),true);assert.match(r.message,/solo en esta sesión/);assert.match(r.message,/recargar/);assert.match(r.error,/solo en esta sesión/);
});
test('rollback rendering failure cannot prevent the durable pause or leave import exclusion active',()=>{
 const h=fixture({notify:'always',render:true}),r=h.run();assert.equal(r.state.enabled,false);assert.equal(h.reload(),false);assert.equal(r.importingBackup,false);assert.equal(r.scheduled,1);
});
test('a failing imperial suspend cannot prevent a durable Helper pause',()=>{
 const h=fixture({notify:'always',empire:true,suspendThrows:true}),r=h.run();assert.equal(r.state.enabled,false);assert.equal(h.reload(),false);assert.equal(r.suspended,1);assert.match(r.message,/Automatización pausada/);
});
test('future backup schema is rejected before writes, cancellation or configuration application',()=>{
 const h=fixture(),r=h.run({schemaVersion:2});assert.match(r.message,/compatible/);assert.equal(r.writes.length,0);assert.equal(r.cancelled,0);assert.equal(r.notificationCalls,0);assert.equal(r.state.enabled,true);
});
test('malformed imported activation cannot apply a backup or overwrite prior preferences',()=>{
 const h=fixture(),r=h.run({settings:{...h.original(),enabled:'false'}});assert.match(r.message,/inválidos/);assert.equal(r.writes.length,0);assert.equal(r.notificationCalls,0);assert.deepEqual(r.state,h.original());
});
test('incomplete rollback from absent settings still creates a durable paused configuration',()=>{
 const h=fixture({notify:'always',missing:true}),r=h.run();assert.equal(r.state.enabled,false);assert.equal(h.reload(),false);assert.equal(JSON.parse(r.raw).shipMinimums.marauder,9);
});
test('failed pause readback never claims a durable stop even when the write may have succeeded',()=>{
 const h=fixture({notify:'always',verifyRead:true}),r=h.run();assert.equal(r.state.enabled,false);assert.match(r.message,/solo en esta sesión/);assert.match(r.message,/recargar/);
});

test('durable rollback pause preserves unknown stored preference fields for future versions',()=>{
 const h=fixture({notify:'always',futureFields:true}),r=h.run();assert.equal(h.reload(),false);assert.deepEqual(JSON.parse(r.raw).futurePolicy,{schemaVersion:99,mode:'synthetic-preserve'});assert.equal(JSON.parse(r.raw).enabled,false);
});
