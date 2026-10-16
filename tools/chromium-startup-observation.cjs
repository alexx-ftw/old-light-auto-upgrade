'use strict';
// Diagnostic only. Never loaded by validate-release or by the distributed Helper.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),cp=require('node:child_process');
const helper=path.resolve(__dirname,'../tests/helpers/browser-process.cjs');
// stat fields are numbered from state (field3) after the final comm delimiter.
// Read only numeric accounting for owned process group members, never cmdline/env.
function parseProcessCounters(fields){
 const number=index=>{const value=fields[index];if(!/^\d+$/.test(value||'')||!Number.isSafeInteger(Number(value)))throw Error('Invalid process counter');return Number(value);};
 return {cpuTicks:number(11)+number(12),rssPages:number(21),threads:number(17),minorFaults:number(7),majorFaults:number(9),blockedLeaders:fields[0]==='D'?1:0,blockDelayTicks:fields.length>39?number(39):0};
}
function parseIoReadBytes(text){const match=/^read_bytes: (\d+)$/m.exec(text);if(!match)return null;const value=Number(match[1]);return Number.isSafeInteger(value)?value:null;}
function resources(group){
 let processes=0,cpuTicks=0,rssPages=0,threads=0,minorFaults=0,majorFaults=0,blockedLeaders=0,blockDelayTicks=0,ioReadBytes=0,ioReadableProcesses=0;
 for(const name of fs.readdirSync('/proc'))if(/^\d+$/.test(name))try{const raw=fs.readFileSync('/proc/'+name+'/stat','utf8'),fields=raw.slice(raw.lastIndexOf(') ')+2).trim().split(/\s+/);if(Number(fields[2])===group){const counters=parseProcessCounters(fields);processes++;cpuTicks+=counters.cpuTicks;rssPages+=counters.rssPages;threads+=counters.threads;minorFaults+=counters.minorFaults;majorFaults+=counters.majorFaults;blockedLeaders+=counters.blockedLeaders;blockDelayTicks+=counters.blockDelayTicks;
 try{const bytes=parseIoReadBytes(fs.readFileSync('/proc/'+name+'/io','utf8'));if(bytes!==null){ioReadBytes+=bytes;ioReadableProcesses++;}}catch{}}}catch{}
 let memAvailableKiB=null,cgroup=null;try{memAvailableKiB=Number(/^MemAvailable:\s+(\d+)/m.exec(fs.readFileSync('/proc/meminfo','utf8'))?.[1])||null;}catch{}
 try{const text=fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8');cgroup=Object.fromEntries(['usage_usec','nr_throttled','throttled_usec'].map(key=>[key,Number(new RegExp('^'+key+' (\\d+)','m').exec(text)?.[1])||0]));}catch{}
 return {processes,cpuTicks,rssPages,threads,minorFaults,majorFaults,blockedLeaders,blockDelayTicks,ioReadBytes:ioReadableProcesses?ioReadBytes:null,ioReadableProcesses,memAvailableKiB,cgroup,hostLoadAverage:os.loadavg(),availableParallelism:os.availableParallelism()};
}
function createObserver({directory,acceptanceMs=15000,observationMs=45000,source=fs.readFileSync(helper,'utf8')}={}){
 if(!directory||!(observationMs>acceptanceMs&&observationMs<=60000))throw Error('Invalid diagnostic observation bounds');
 fs.mkdirSync(directory,{recursive:true});let ordinal=0;
 const clkTck=Number(cp.execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim());
 function launch(executable,args,artifacts){
  const id=process.pid+'-'+(++ordinal),start=process.hrtime.bigint(),elapsed=()=>Number((process.hrtime.bigint()-start)/1000000n),samples=[];
  let samplingCostMs=0,acceptanceFailed=false,outcome='pending',readyAfterMs=null,firstStderrAfterMs=null,closed=false,handle,acceptanceTimer,samplingTimer;
  const name=path.basename(executable),binary=['chromium','chromium-browser','google-chrome','chrome','node'].includes(name)?name:'other';
  const file=path.basename(process.argv[1]||''),testFile=/^[a-z0-9-]+\.test\.cjs$/.test(file)?file:null;
  const launcherBytes=fs.statSync(executable).size;
  function sample(){if(!handle?.child.pid||samples.length>=64)return;const before=process.hrtime.bigint();samples.push({atMs:elapsed(),...resources(handle.child.pid)});samplingCostMs+=Number(process.hrtime.bigint()-before)/1e6;}
  function record(phase){let cleanup=null,stderrTail=null;if(phase==='closed'){try{const value=JSON.parse(fs.readFileSync(path.join(artifacts,'browser-startup.json'))).cleanup;cleanup=['closed','incomplete'].includes(value)?value:null;}catch{}try{stderrTail=compiled.exports.sanitize(fs.readFileSync(path.join(artifacts,'browser-stderr.log'),'utf8')).slice(-2000);}catch{}}const record={cleanup,stderrTail,diagnosticOnly:true,id,testFile,ordinal,binary,launcherBytes,acceptanceMs,observationMs,acceptance:acceptanceFailed?'FAIL':outcome==='ready'?'PASS':'PENDING',phase,outcome,readyAfterMs,firstStderrAfterMs,atMs:elapsed(),closed,clkTck,samplingCostMs,samples};fs.writeFileSync(path.join(directory,id+'.json'),JSON.stringify(record)+'\n');process.stderr.write('OLDLIGHT_OBSERVATION '+JSON.stringify(record)+'\n');}
  const compiled={exports:{}},sandbox={process,Buffer,WebSocket,setTimeout:(callback,ms,...rest)=>setTimeout(callback,ms===15000?observationMs:ms,...rest),clearTimeout};
  vm.runInNewContext('(function(require,module,exports){'+source+'\n})',sandbox)(require,compiled,compiled.exports);
  handle=compiled.exports.launch(executable,args,artifacts);
  handle.child.stderr.once('data',()=>{firstStderrAfterMs=elapsed();});
  sample();samplingTimer=setInterval(sample,1000);
  acceptanceTimer=setTimeout(()=>{acceptanceFailed=true;sample();record('acceptance-deadline');},acceptanceMs);
  const endpoint=handle.endpoint.then(url=>{outcome='ready';readyAfterMs=elapsed();if(readyAfterMs>acceptanceMs)acceptanceFailed=true;clearTimeout(acceptanceTimer);sample();record('outcome');return url;},error=>{outcome='failed';acceptanceFailed=true;clearTimeout(acceptanceTimer);sample();record('outcome');throw error;});
  const close=async()=>{try{return await handle.close();}finally{closed=true;clearTimeout(acceptanceTimer);clearInterval(samplingTimer);sample();record('closed');}};
  return {...handle,endpoint,close};
 }
 return {launch};
}
function install(){const actual=require(helper),observer=createObserver({directory:path.join(os.tmpdir(),'oldlight-startup-observation')});actual.launch=observer.launch;}
module.exports={createObserver,install,parseProcessCounters,parseIoReadBytes};
