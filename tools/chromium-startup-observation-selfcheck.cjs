'use strict';
const vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createObserver}=require('./chromium-startup-observation.cjs');
(async()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'oldlight-observation-selfcheck-'));const fixture=path.resolve(__dirname,'../tests/browser-startup.fixture.cjs');
 try{for(const [mode,acceptanceMs,observationMs,expected] of [['ready',500,1000,'PASS'],['ready-fragmented',40,1000,'FAIL'],['hang',40,180,'FAIL']]){const folder=fs.mkdtempSync(path.join(directory,'browser-')),observer=createObserver({directory:path.join(directory,'results'),acceptanceMs,observationMs}),handle=observer.launch(process.execPath,[fixture,mode],folder);try{if(mode==='hang')await assert.rejects(handle.endpoint,/startup timeout/);else await handle.endpoint;}finally{await handle.close();}const files=fs.readdirSync(path.join(directory,'results'));const record=JSON.parse(fs.readFileSync(path.join(directory,'results',files.at(-1))));assert.equal(record.acceptance,expected);assert.equal(record.closed,true);assert.equal(record.cleanup,'closed');if(mode==='ready-fragmented'){assert.equal(record.outcome,'ready');assert.ok(record.readyAfterMs>acceptanceMs);assert.ok(record.readyAfterMs<observationMs);}if(mode==='hang'){assert.equal(record.outcome,'failed');assert.equal(record.readyAfterMs,null);}assert.ok(record.samples.length>0&&record.samples.length<=64);assert.ok(record.samplingCostMs>=0);}
 const {assessRecords}=require('./chromium-startup-observation-result.cjs');const ready=file=>({binary:'chromium',testFile:file,acceptance:'PASS',closed:true,cleanup:'closed'});const complete=[ready('conquest-panel-browser.test.cjs'),ready('native-galaxy-overlay.test.cjs'),ready('native-galaxy-overlay.test.cjs'),ready('ship-credit-layout.test.cjs'),ready('reinforcement-observer-loop.test.cjs')];assert.equal(assessRecords(complete).failed,false);assert.equal(assessRecords(complete.slice(1).concat(ready('ship-credit-layout.test.cjs'))).failed,true);assert.equal(assessRecords(complete.map((record,i)=>i===0?{...record,acceptance:'FAIL'}:record)).failed,true);
 console.log('PASS: immediate ready; late ready remains FAIL; no endpoint remains FAIL; owned groups closed.');}finally{fs.rmSync(directory,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1});

// Known stat positions distinguish CPU work from faults and blocked leaders.
{
 const {parseProcessCounters,parseIoReadBytes}=require('./chromium-startup-observation.cjs');
 const fields=Array(50).fill('0');fields[0]='D';for(const [index,value] of [[7,101],[9,7],[11,3],[12,5],[17,9],[21,1234],[39,11]])fields[index]=String(value);
 assert.deepEqual(parseProcessCounters(fields),{cpuTicks:8,rssPages:1234,threads:9,minorFaults:101,majorFaults:7,blockedLeaders:1,blockDelayTicks:11});
 assert.equal(parseIoReadBytes('rchar: 99999\nread_bytes: 4096\n'),4096);
 assert.equal(parseIoReadBytes('read_bytes: 0\n'),0);
 for(const text of ['rchar: 4096','read_bytes: -1','read_bytes: NaN','read_bytes: 999999999999999999999'])assert.equal(parseIoReadBytes(text),null);
 for(const index of [7,9,11,12,17,21,39]){const invalid=[...fields];invalid[index]='NaN';assert.throws(()=>parseProcessCounters(invalid));}
 console.log('PASS: numeric process accounting, zero IO, unavailable IO and malformed counters are distinct.');
}

{
 const {transform}=require('./chromium-gate-observation.cjs');
 const source=fs.readFileSync(path.resolve(__dirname,'../validate-release.cjs'),'utf8');
 const changed=transform(source);
 new Function('require','module','exports','__filename','__dirname',changed);
 assert.match(changed,/scope: 'diagnostic-observation-only', releaseValidation: false/);
 assert.match(changed,/if \(args\[0\] === '--test'\) args = \[args\[0\], '--require'/);
 for(const boundary of ['#!/usr/bin/env node','function nodeChild(args',"scope: 'offline-validation-only'",'if (require.main === module) main();'])assert.throws(()=>transform(source.replace(boundary,'changed-boundary')));
 assert.equal(fs.readFileSync(path.resolve(__dirname,'../validate-release.cjs'),'utf8'),source);
 assert.match(changed,/args = \[args\[0\], '--require',[^\n]+\.slice\(1\)/);
 const child=new (require('node:events').EventEmitter)();child.pid=123456;child.stdout=new (require('node:events').EventEmitter)();child.stderr=new (require('node:events').EventEmitter)();
 const timers=[];let invocation;
 const body=changed.slice(changed.indexOf('function nodeChild('),changed.indexOf('function requireSuccess('));
 const run=vm.runInNewContext('('+body+')',{spawn:(_node,args)=>{invocation=args;return child;},process:{execPath:'node',kill(){}},activeGroups:new Map(),Buffer,setTimeout:(callback,ms)=>{timers.push({callback,ms});return {};},clearTimeout(){}});
 const completion=run(['--test','--test-concurrency=1','example.test.cjs'],'/tmp',{});
 assert.equal(invocation[0],'--test');assert.equal(invocation[1],'--require');
 child.emit('exit',0,null);assert.ok(timers.some(timer=>timer.ms===3000),'test subprocess retains three second cleanup grace');assert.equal(timers.some(timer=>timer.ms===500),false);
 child.emit('close');timers.find(timer=>timer.ms===3000).callback();completion.catch(error=>{console.error(error);process.exitCode=1;});
 console.log('PASS: diagnostic gate transform preserves tracked bytes and actual subprocess cleanup grace.');
}

{
 const {summarize}=require('./chromium-gate-summary.cjs');
 const d={scope:'diagnostic-observation-only',releaseValidation:false,status:'failed',input:{commit:'a'.repeat(40)},stages:{tests:{fileCount:113,counts:{tests:1,passed:0,failed:1,syntheticPrivate:'synthetic-private-marker'},failureEvents:[{data:{name:'public case',details:{error:{message:'Native Chromium startup timeout; secret=synthetic-private-marker'}}}},{data:{name:'synthetic-private-name',details:{error:{message:'synthetic-private-error',code:'ERR_ASSERTION'}}}}]}}};
 const result=summarize(d,new Set(['public case']));
 assert.deepEqual(result.failures,[{name:'public case',kind:'browser-startup-timeout'},{name:'unlisted-test-name',kind:'assertion'}]);
 assert.equal(JSON.stringify(result).includes('synthetic-private'),false);
 assert.throws(()=>summarize({...d,releaseValidation:true},new Set()));
 assert.throws(()=>summarize({...d,scope:'offline-validation-only'},new Set()));
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'oldlight-diagnostic-summary-'));
 try{for(const files of [['tests/metrics-integration.test.cjs'],[{path:'tests/metrics-integration.test.cjs',counts:{passed:16}}]]){
  const fixture=path.join(folder,'report.json');fs.writeFileSync(fixture,JSON.stringify({...d,stages:{tests:{...d.stages.tests,files}}}));
  const child=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,'chromium-gate-summary.cjs'),fixture],{cwd:path.resolve(__dirname,'..'),env:{...process.env,GITHUB_SHA:d.input.commit},encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.includes('synthetic-private'),false);
 }}finally{fs.rmSync(folder,{recursive:true,force:true});}
 console.log('PASS: diagnostic failure summary excludes private payloads and CLI accepts passed-object or failed-string file inventories.');
}
