'use strict';
const fs=require('node:fs'),vm=require('node:vm'),{performance}=require('node:perf_hooks'),{createRequire}=require('node:module');
const repo=process.argv[2]||require('node:path').resolve(__dirname, '..');
let source=fs.readFileSync(repo+'/tests/empire-panel.test.cjs','utf8').split("test('panel renders")[0];
if (!source.includes("this.ownerDocument.textWrites =")) source=source.replace("set textContent(value) {", "set textContent(value) { if(this.ownerDocument)this.ownerDocument.textWrites=(this.ownerDocument.textWrites||0)+1;");
source+='\nglobalThis.harness=harness;';
const sandbox={require:createRequire(repo+'/tests/empire-panel.test.cjs'),console};vm.runInNewContext(source,sandbox);
const uuid=i=>'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
const rows=[];
for(const n of [2,10,50]){
 const h=sandbox.harness({ids:Array.from({length:n},(_,i)=>uuid(i+1))});h.data.config.enabled=true;h.app.render();
 for(let i=0;i<5;i++)h.app.render();h.document.textWrites=0;
 const samples=[];const iterations=20;
 for(let k=0;k<5;k++){let t=performance.now();for(let i=0;i<iterations;i++)h.app.render();samples.push((performance.now()-t)/iterations);}
 samples.sort((a,b)=>a-b);
 rows.push({systems:n,medianMs:samples[2],minMs:samples[0],maxMs:samples[4],unchangedTextWritesPerRender:h.document.textWrites/(iterations*5)});
}
console.log(JSON.stringify({method:'Synthetic DOM, fixed native state, active mode; panel render includes core.plan in fixture getState; no browser, game, navigation or network.',repo,rows},null,2));
