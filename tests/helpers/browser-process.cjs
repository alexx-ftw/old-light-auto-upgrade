'use strict';
// Own one disposable browser process group. No account profile, retries or fallback.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
function sanitize(value){return String(value).replace(/\b(?:https?|wss?):\/\/[^\s]+/gi,'<url>').replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|ph[ctx]_[A-Za-z0-9_-]+)\b/g,'<redacted>').replace(/\bBearer\s+[^\s]+/gi,'Bearer <redacted>').replace(/(["']?\b(?:token|authorization|password|secret|api[_-]?key)\b["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\r\n]*)/gi,'$1<redacted>');}

function byteBound(value,max){const bytes=Buffer.from(value,'utf8');if(bytes.length<=max)return value;let end=max;while(end>0&&(bytes[end]&192)===128)end--;return bytes.subarray(0,end).toString('utf8');}
let launchOrdinal=0;
function launch(executable,args,artifacts){
 let realpath=null;try{realpath=fs.realpathSync(executable);}catch{}
 const started=process.hrtime.bigint(),elapsed=()=>Number((process.hrtime.bigint()-started)/1000000n),ordinal=++launchOrdinal,child=spawn(executable,args,{detached:true,stdio:['ignore','ignore','pipe']});
 let stderr='',endpointWindow='',stderrTruncated=false,closed=false,stopping=null,done=false,timer,exitCode=null,exitSignal=null;
 const metadata={executable,realpath,node:process.version,platform:process.platform,release:os.release(),pid:child.pid??null,status:'starting',firstStderrAfterMs:null,readyAfterMs:null,outcomeAtMs:null};
 function stderrText(){return byteBound(sanitize(stderr)+(stderrTruncated?'\n[stderr truncated]\n':''),16384);}
 function persist(){try{fs.writeFileSync(path.join(artifacts,'browser-stderr.log'),stderrText());fs.writeFileSync(path.join(artifacts,'browser-startup.json'),JSON.stringify({...metadata,lifetimeAfterMs:elapsed(),exitCode,exitSignal},null,2));}catch{/* Never replace the original browser failure. */}}
 function logSummary(phase){const name=path.basename(executable);const binary=['chromium','chromium-browser','google-chrome','chrome','node'].includes(name)?name:'other';process.stderr.write('OLDLIGHT_BROWSER_STARTUP '+JSON.stringify({phase,ordinal,binary,status:metadata.status,firstStderrAfterMs:metadata.firstStderrAfterMs,readyAfterMs:metadata.readyAfterMs,outcomeAtMs:metadata.outcomeAtMs,lifetimeAfterMs:elapsed(),exitCode,exitSignal,cleanup:metadata.cleanup??null})+'\n');}
 function signal(value){if(!child.pid)return;try{process.kill(-child.pid,value);}catch(e){if(e.code!=='ESRCH')throw e;}}
 const onExit=()=>{try{signal('SIGKILL');}catch{}};
 const onTerm=()=>{onExit();process.removeListener('SIGTERM',onTerm);process.kill(process.pid,'SIGTERM');};
 const onInt=()=>{onExit();process.removeListener('SIGINT',onInt);process.kill(process.pid,'SIGINT');};
 process.once('exit',onExit);process.once('SIGTERM',onTerm);process.once('SIGINT',onInt);
 function unhook(){process.removeListener('exit',onExit);process.removeListener('SIGTERM',onTerm);process.removeListener('SIGINT',onInt);}
 const closeEvent=new Promise(resolve=>child.once('close',()=>{closed=true;resolve();}));
 function waitClose(){return new Promise(resolve=>{const timer=setTimeout(finish,500);function finish(){clearTimeout(timer);resolve();}closeEvent.then(finish);});}
 async function close(){if(stopping)return stopping;stopping=(async()=>{clearTimeout(timer);const failures=[];
  try{signal('SIGTERM');}catch(e){failures.push(sanitize(e.message));}await waitClose();
  try{signal('SIGKILL');}catch(e){failures.push(sanitize(e.message));}await waitClose();
  child.stderr?.destroy();child.unref();unhook();metadata.cleanup=closed&&failures.length===0?'closed':'incomplete';persist();logSummary('closed');
  if(failures.length||!closed)throw Error('Browser process cleanup incomplete: '+failures.join('; '));
 })();return stopping;}
 const endpoint=new Promise((resolve,reject)=>{
  const finish=(error,url)=>{if(done)return;done=true;clearTimeout(timer);metadata.status=error?'failed':'ready';metadata.outcomeAtMs=elapsed();if(!error)metadata.readyAfterMs=metadata.outcomeAtMs;persist();logSummary('settled');error?reject(error):resolve(url);};
  const fail=reason=>finish(Error(reason+'; executable='+executable+'; stderr='+stderrText().slice(-2000)+'; diagnostics='+path.join(artifacts,'browser-startup.json')));
  timer=setTimeout(()=>fail('Native Chromium startup timeout'),15000);
  child.once('error',error=>fail('Native Chromium launch failed: '+sanitize(error.message)));
  child.once('exit',(code,signalValue)=>{exitCode=code;exitSignal=signalValue;if(!done)fail('Native Chromium exited before DevTools: code='+code+' signal='+signalValue);});
  child.stderr.on('data',data=>{if(!done&&metadata.firstStderrAfterMs===null)metadata.firstStderrAfterMs=elapsed();const text=String(data);if(stderr.length+text.length>16000)stderrTruncated=true;stderr=(stderr+text).slice(0,16000);if(!done){endpointWindow=(endpointWindow+text).slice(-4096);const match=/DevTools listening on (ws:\/\/[^\s]+)[\r\n]/.exec(endpointWindow);if(match){finish(null,match[1]);endpointWindow='';}}});
 });
 return {endpoint,close,child};
}
module.exports={launch,sanitize};
