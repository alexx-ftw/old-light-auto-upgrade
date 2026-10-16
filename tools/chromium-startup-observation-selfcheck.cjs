'use strict';
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
