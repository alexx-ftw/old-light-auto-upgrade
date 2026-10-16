'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),cp=require('node:child_process');
const root=path.join(__dirname,'..'),sourceFile=process.env.QA_NATIVE_BROWSER_SOURCE||path.join(__dirname,'helpers/native-browser.cjs');
function harness(mode,pidFile){const folders=[],launched=[];
 const fakeFs={...fs,mkdtempSync(prefix){const dir=fs.mkdtempSync(prefix);folders.push(dir);return dir;}};
 const fakeSpawn=(executable,args,options)=>{const child=cp.spawn(process.execPath,[path.join(__dirname,'browser-startup.fixture.cjs'),mode,pidFile||''],options);launched.push(child);return child;};
 function load(file){const module={exports:{}};const localRequire=name=>name==='node:fs'?fakeFs:name==='node:child_process'?{...cp,spawn:fakeSpawn}:name==='./browser-process.cjs'?load(path.join(__dirname,'helpers/browser-process.cjs')):require(name);vm.runInNewContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',{process,Buffer,WebSocket,setTimeout,clearTimeout})(localRequire,module,module.exports);return module.exports;}
 return {browser:load(sourceFile),folders,launched,async clean(){for(const child of launched){try{process.kill(-child.pid,'SIGKILL')}catch{}try{child.kill('SIGKILL')}catch{}}for(const dir of folders)fs.rmSync(dir,{recursive:true,force:true});}};
}
function running(pid){try{if(process.platform==='linux'){const status=fs.readFileSync('/proc/'+pid+'/stat','utf8');return !/^\d+ \(.*\) Z /.test(status);}return !cp.execFileSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}).trim().startsWith('Z');}catch{return false;}}
test('native browser startup reports an immediate launcher exit with code and sanitized stderr rather than a generic timeout',async()=>{
 const h=harness('exit');try{const start=Date.now();await assert.rejects(h.browser.open(()=>null),error=>{assert.match(error.message,/exited before DevTools: code=42/);assert.match(error.message,/OFFLINE_STARTUP_FIXTURE_FAILURE/);assert.doesNotMatch(error.message,/fixture-not-a-real-secret/);return true;});assert.ok(Date.now()-start<5000);const diagnostic=JSON.parse(fs.readFileSync(path.join(h.folders[0],'browser-startup.json'),'utf8'));assert.equal(diagnostic.exitCode,42);assert.equal(diagnostic.status,'failed');assert.match(fs.readFileSync(path.join(h.folders[0],'browser-stderr.log'),'utf8'),/token=<redacted>/);}finally{await h.clean();}
});
test('native browser startup failure terminates its launcher descendants even after the launcher exits and retains stderr',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oldlight-browser-child-proof-')),pidFile=path.join(dir,'pid'),h=harness('descendant',pidFile);let pid;
 try{await assert.rejects(h.browser.open(()=>null));pid=Number(fs.readFileSync(pidFile,'utf8'));for(let i=0;i<30&&running(pid);i++)await new Promise(r=>setTimeout(r,25));assert.equal(running(pid),false,'own launcher descendant must not outlive failed startup');}finally{if(!pid&&fs.existsSync(pidFile))pid=Number(fs.readFileSync(pidFile,'utf8'));if(pid&&running(pid))try{process.kill(pid,'SIGKILL')}catch{}await h.clean();fs.rmSync(dir,{recursive:true,force:true});}
});
test('browser process accepts a complete endpoint announcement once and closes its own process group without retries',async()=>{
 const {launch,sanitize}=require(process.env.QA_BROWSER_PROCESS_SOURCE||'./helpers/browser-process.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'oldlight-browser-endpoint-proof-')),handle=launch(process.execPath,[path.join(__dirname,'browser-startup.fixture.cjs'),'ready'],dir);
 try{assert.match(await handle.endpoint,/^ws:\/\/127\.0\.0\.1:9\/offline-fixture$/);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'browser-startup.json'),'utf8')).status,'ready');assert.equal(sanitize('Bearer fixturevalue https://example.test/path ghp_fixtureonly'), 'Bearer <redacted> <url> <redacted>');await handle.close();assert.equal(running(handle.child.pid),false);}finally{await handle.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('terminating the browser harness kills its detached browser group and preserves the termination signal',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oldlight-browser-signal-proof-')),child=cp.spawn(process.execPath,[path.join(__dirname,'browser-process-signal.fixture.cjs'),dir],{stdio:['ignore','ignore','pipe']}),closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));let pid;
 try{const ready=path.join(dir,'signal-ready.json');for(let i=0;i<100&&!fs.existsSync(ready);i++)await new Promise(r=>setTimeout(r,20));assert.ok(fs.existsSync(ready));pid=JSON.parse(fs.readFileSync(ready,'utf8')).pid;assert.equal(running(pid),true);child.kill('SIGTERM');const result=await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('signal cleanup stalled')),2000))]);assert.equal(result.signal,'SIGTERM');for(let i=0;i<30&&running(pid);i++)await new Promise(r=>setTimeout(r,25));assert.equal(running(pid),false);}finally{child.kill('SIGKILL');if(pid&&running(pid))try{process.kill(pid,'SIGKILL')}catch{}fs.rmSync(dir,{recursive:true,force:true});}
});
test('silent browser startup still fails at the unchanged fifteen second deadline and cleans its process', {timeout:25000},async()=>{
 const h=harness('hang');try{const start=Date.now();await assert.rejects(h.browser.open(()=>null),/Native Chromium startup timeout/);assert.ok(Date.now()-start>=14000);assert.equal(running(h.launched[0].pid),false);assert.equal(JSON.parse(fs.readFileSync(path.join(h.folders[0],'browser-startup.json'),'utf8')).status,'failed');}finally{await h.clean();}
});
test('browser startup diagnostics redact quoted JSON credentials spaced passwords and entire authorization values',()=>{
 const {sanitize}=require(process.env.QA_BROWSER_PROCESS_SOURCE||'./helpers/browser-process.cjs');
 for(const raw of ['{"token":"SYNTHETIC_TOKEN_VALUE"}','password="SYNTHETIC PASSWORD VALUE"','Authorization: Basic SYNTHETIC_BASE64_VALUE',"{'api_key':'SYNTHETIC KEY VALUE'}",'secret=SYNTHETIC SECRET VALUE','{"authorization":"Basic SYNTHETIC_AUTH_VALUE"}']){const clean=sanitize(raw);assert.doesNotMatch(clean,/SYNTHETIC|PASSWORD VALUE|SECRET VALUE|KEY VALUE/);assert.match(clean,/<redacted>/);}
 assert.equal(sanitize('Browser initialization failed: exit=42'),'Browser initialization failed: exit=42');
});
test('oversized browser credential lines retain their key before redaction rather than leaking an unlabelled tail',async()=>{
 const h=harness('long-secret');try{await assert.rejects(h.browser.open(()=>null),error=>{assert.match(error.message,/code=42/);assert.doesNotMatch(error.message,/SYNTHETIC_LONG_VALUE/);return true;});const file=fs.readFileSync(path.join(h.folders[0],'browser-stderr.log'),'utf8');assert.doesNotMatch(file,/SYNTHETIC_LONG_VALUE/);assert.match(file,/<redacted>/);assert.ok(Buffer.byteLength(file)<=16384);}finally{await h.clean();}
});
test('browser endpoint readiness waits for a complete announcement across stderr chunks instead of connecting to a partial URL',async()=>{
 const {launch}=require(process.env.QA_BROWSER_PROCESS_SOURCE||'./helpers/browser-process.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'oldlight-browser-fragment-proof-')),handle=launch(process.execPath,[path.join(__dirname,'browser-startup.fixture.cjs'),'ready-fragmented'],dir);
 try{assert.equal(await handle.endpoint,'ws://127.0.0.1:9/offline-fixture');assert.doesNotMatch(fs.readFileSync(path.join(dir,'browser-stderr.log'),'utf8'),/ws:\/\//);}finally{await handle.close();fs.rmSync(dir,{recursive:true,force:true});}
});
