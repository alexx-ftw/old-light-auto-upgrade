'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{open}=require('./helpers/native-browser.cjs');
const root=path.join(__dirname,'..'),script=fs.readFileSync(path.join(root,'old-light-auto-upgrade.user.js'),'utf8');
const schedule=script.slice(script.indexOf('  function schedule() {'),script.indexOf('  function wakeAt(time) {'));
const stepAt=script.indexOf('  function step() {'),prefix=script.slice(stepAt+'  function step() {'.length,script.indexOf('    const panel = document.querySelector(PANEL);',stepAt));
const observerAt=script.indexOf('  new MutationObserver(records => {',script.indexOf('// END EMPIRE INTEGRATION',script.indexOf('// BEGIN REINFORCEMENT INTEGRATION'))),observer=script.slice(observerAt,script.indexOf("  window.addEventListener('storage'",observerAt));
const source=fs.readFileSync(process.env.QA_REINFORCEMENT_PANEL_SOURCE||path.join(root,'docs/reinforcement-panel.js'),'utf8'),fixture=fs.readFileSync(path.join(__dirname,'reinforcement-observer-loop.fixture.js'),'utf8');
test('production document observer and scheduler keep timers and frames alive without interaction for empty routes invalid camera and visible route markers', {timeout:60000},async t=>{
 assert.ok(schedule.includes('queueMicrotask(run)')&&observer.includes('attributeFilter')&&prefix.includes('reinforcementPanel?.render()'));
 const b=await open(url=>url.pathname==='/offline-observer-loop'?{type:'text/html',body:'<!doctype html><title>Offline observer feedback loop</title><link rel=icon href=data:,><div id=map><canvas id=stage width=800 height=400 style="width:800px;height:400px"></canvas></div><div id=helper></div>'}:null),results=[];
 try{let index=0;for(const empire of [false,true])for(const routes of [false,true])for(const camera of [false,true])for(const control of [false,true]){
  const url='https://oldlight.io/offline-observer-loop?case='+index++;await b.command('Page.navigate',{url});let ready=false;for(let i=0;i<150&&!ready;i++){ready=await b.evaluate(`location.href===${JSON.stringify(url)}&&document.title==='Offline observer feedback loop'&&Boolean(document.querySelector('#helper'))`).catch(()=>false);if(!ready)await new Promise(r=>setTimeout(r,10));}assert.equal(ready,true);
  await b.evaluate(source);await b.evaluate(fixture);const result=await b.evaluate(`runMutationLoop(${JSON.stringify({schedule,prefix,observer,empire,routes,camera,control})})`);results.push(result);
  assert.equal(result.cutoff,false,JSON.stringify(result));assert.ok(result.batches<100,JSON.stringify(result));assert.equal(result.timer,1);assert.ok(result.stepsAfterNative>result.stepsBeforeNative,JSON.stringify(result));assert.ok(result.frames>=2,JSON.stringify(result));
 }
 fs.writeFileSync(path.join(b.artifacts,'mutation-loop.json'),JSON.stringify(results,null,2));assert.deepEqual(b.errors,[]);assert.deepEqual(b.denied,[]);t.diagnostic('MUTATION_LOOP_ARTIFACTS='+b.artifacts);
 }finally{await b.close()}
});
