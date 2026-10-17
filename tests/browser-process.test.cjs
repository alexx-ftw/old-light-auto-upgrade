'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),cp=require('node:child_process');
const root=path.join(__dirname,'..'),sourceFile=process.env.QA_NATIVE_BROWSER_SOURCE||path.join(__dirname,'helpers/native-browser.cjs');
function harness(mode,pidFile){const folders=[],launched=[];
 const fakeFs={...fs,mkdtempSync(prefix){const dir=fs.mkdtempSync(prefix);folders.push(dir);return dir;}};
 const fakeSpawn=(executable,args,options)=>{const child=cp.spawn(process.execPath,[path.join(__dirname,'browser-startup.fixture.cjs'),mode,pidFile||''],options);launched.push(child);return child;};
 function load(file){const module={exports:{}};const localRequire=name=>name==='node:fs'?fakeFs:name==='node:child_process'?{...cp,spawn:fakeSpawn}:name==='./browser-process.cjs'?load(process.env.QA_BROWSER_PROCESS_SOURCE||path.join(__dirname,'helpers/browser-process.cjs')):require(name);vm.runInNewContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',{process,Buffer,WebSocket,setTimeout,clearTimeout})(localRequire,module,module.exports);return module.exports;}
 return {browser:load(sourceFile),folders,launched,async clean(){for(const child of launched){try{process.kill(-child.pid,'SIGKILL')}catch{}try{child.kill('SIGKILL')}catch{}}for(const dir of folders)fs.rmSync(dir,{recursive:true,force:true});}};
}
function running(pid){try{if(process.platform==='linux'){const status=fs.readFileSync('/proc/'+pid+'/stat','utf8');return !/^\d+ \(.*\) Z /.test(status);}return !cp.execFileSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}).trim().startsWith('Z');}catch{return false;}}
test('native browser startup reports an immediate launcher exit with code and sanitized stderr rather than a generic timeout',async()=>{
 const h=harness('exit');try{const start=Date.now();await assert.rejects(h.browser.open(()=>null),error=>{assert.match(error.message,/exited before DevTools: code=42/);assert.match(error.message,/OFFLINE_STARTUP_FIXTURE_FAILURE/);assert.doesNotMatch(error.message,/fixture-not-a-real-secret/);return true;});assert.ok(Date.now()-start<5000);const diagnostic=JSON.parse(fs.readFileSync(path.join(h.folders[0],'browser-startup.json'),'utf8'));assert.equal(diagnostic.exitCode,42);assert.equal(diagnostic.status,'failed');assert.equal(diagnostic.readyAfterMs,null);assert.ok(Number.isFinite(diagnostic.outcomeAtMs));assert.ok(Number.isFinite(diagnostic.firstStderrAfterMs));assert.match(fs.readFileSync(path.join(h.folders[0],'browser-stderr.log'),'utf8'),/token=<redacted>/);}finally{await h.clean();}
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
test('silent browser startup fails at the measured forty second cold deadline and cleans its process', {timeout:55000},async()=>{
 const h=harness('hang');try{const start=Date.now();await assert.rejects(h.browser.open(()=>null),/Native Chromium startup timeout/);assert.ok(Date.now()-start>=39000);assert.ok(Date.now()-start<50000);assert.equal(running(h.launched[0].pid),false);assert.equal(JSON.parse(fs.readFileSync(path.join(h.folders[0],'browser-startup.json'),'utf8')).status,'failed');}finally{await h.clean();}
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
test('browser stderr remains at most sixteen KiB in UTF8 bytes with complete Unicode characters',async()=>{
 const h=harness('unicode');try{await assert.rejects(h.browser.open(()=>null));const bytes=fs.readFileSync(path.join(h.folders[0],'browser-stderr.log'));assert.ok(bytes.length<=16384,'UTF8 bytes='+bytes.length);assert.doesNotMatch(bytes.toString('utf8'),/\uFFFD/);assert.match(bytes.toString('utf8'),/界/);}finally{await h.clean();}
});

test('browser startup timestamps stay immutable after readiness and delayed cleanup and logs omit paths',async()=>{
 const {launch}=require(process.env.QA_BROWSER_PROCESS_SOURCE||'./helpers/browser-process.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'oldlight-browser-timing-proof-')),handle=launch(process.execPath,[path.join(__dirname,'browser-startup.fixture.cjs'),'ready-fragmented'],dir);
 try{await handle.endpoint;const ready=JSON.parse(fs.readFileSync(path.join(dir,'browser-startup.json'),'utf8'));assert.ok(Number.isFinite(ready.readyAfterMs));assert.equal(ready.outcomeAtMs,ready.readyAfterMs);assert.ok(Number.isFinite(ready.firstStderrAfterMs));assert.ok(ready.firstStderrAfterMs<=ready.readyAfterMs);await new Promise(r=>setTimeout(r,100));await handle.close();const closed=JSON.parse(fs.readFileSync(path.join(dir,'browser-startup.json'),'utf8'));assert.equal(closed.readyAfterMs,ready.readyAfterMs);assert.equal(closed.firstStderrAfterMs,ready.firstStderrAfterMs);assert.equal(closed.outcomeAtMs,ready.outcomeAtMs);assert.ok(closed.lifetimeAfterMs>=ready.lifetimeAfterMs+80);assert.equal(closed.cleanup,'closed');}finally{await handle.close();fs.rmSync(dir,{recursive:true,force:true});}
});

function virtualStartup() {
 const {EventEmitter}=require('node:events'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'oldlight-cold-deadline-'));
 let now=0,serial=0,dead=false;const timers=new Map(),child=new EventEmitter(),fakeProcess=new EventEmitter();
 child.pid=2147483000;child.stderr=new EventEmitter();child.stderr.destroy=()=>{};child.unref=()=>{};
 Object.assign(fakeProcess,{version:process.version,platform:process.platform,hrtime:{bigint:()=>BigInt(now)*1000000n},stderr:{write(){}},kill(pid,signal){
  assert.equal(pid,-child.pid,'only the owned process group may be signalled');
  if(dead)throw Object.assign(Error('exited'),{code:'ESRCH'});
  dead=true;child.emit('exit',null,signal);child.emit('close');
 }});
 const module={exports:{}},localRequire=name=>name==='node:child_process'?{spawn(_executable,_args,options){assert.equal(options.detached,true);return child;}}:require(name);
 const source=fs.readFileSync(process.env.QA_BROWSER_PROCESS_SOURCE||path.join(__dirname,'helpers/browser-process.cjs'),'utf8');
 vm.runInNewContext('(function(require,module,exports){'+source+'\n})',{process:fakeProcess,Buffer,WebSocket,setTimeout(callback,ms){const id=++serial;timers.set(id,{at:now+ms,callback});return id;},clearTimeout:id=>timers.delete(id)})(localRequire,module,module.exports);
 const handle=module.exports.launch(process.execPath,[],directory);
 function advance(target){for(;;){const next=[...timers].filter(([,value])=>value.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;timers.delete(next[0]);now=next[1].at;next[1].callback();}now=target;}
 return {handle,advance,ready(){child.stderr.emit('data',Buffer.from('DevTools listening on ws://127.0.0.1:9/virtual-cold\n'));},diagnostic(){return JSON.parse(fs.readFileSync(path.join(directory,'browser-startup.json')));},async close(){try{await handle.close();assert.equal(fakeProcess.listenerCount('exit'),0);assert.equal(timers.size,0);}finally{fs.rmSync(directory,{recursive:true,force:true});}}};
}

test('native cold startup accepts the measured late endpoint without retry and still rejects silence at forty seconds',async()=>{
 const late=virtualStartup();let state='pending';const endpoint=late.handle.endpoint.then(url=>{state='ready';return url;},error=>{state='failed';return error;});
 try{
  late.advance(15001);await Promise.resolve();assert.equal(state,'pending','the old deadline rejects a measured legitimate cold launch');
  late.advance(31704);late.ready();assert.equal(await endpoint,'ws://127.0.0.1:9/virtual-cold');
  assert.equal(late.diagnostic().readyAfterMs,31704);late.advance(40001);assert.equal(state,'ready');assert.equal(late.diagnostic().outcomeAtMs,31704);
 }finally{await late.close();}
 const silent=virtualStartup();let result='pending';const failure=silent.handle.endpoint.then(()=>{result='ready';},error=>{result='failed';return error;});
 try{
  silent.advance(39999);await Promise.resolve();assert.equal(result,'pending');silent.advance(40000);assert.match((await failure).message,/Native Chromium startup timeout/);
  assert.equal(silent.diagnostic().outcomeAtMs,40000);assert.equal(silent.diagnostic().readyAfterMs,null);
 }finally{await silent.close();}
});
