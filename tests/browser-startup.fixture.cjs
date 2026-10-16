'use strict';
const fs=require('node:fs'),{spawn}=require('node:child_process');
const [mode,file]=process.argv.slice(2);
if(mode==='descendant'){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','ignore','inherit']});fs.writeFileSync(file,String(child.pid));}
if(mode==='long-secret'){process.stderr.write('token="'+('SYNTHETIC_LONG_VALUE_'.repeat(2000))+'"\n',()=>process.exit(42));}
else if(mode==='hang'){setInterval(()=>{},1000);}
else if(mode==='ready-fragmented'){process.stderr.write('DevTools listening on ws://127.0.');setTimeout(()=>process.stderr.write('0.1:9/offline-fixture\n'),100);setInterval(()=>{},1000);}
else if(mode==='ready'){process.stderr.write('DevTools listening on ws://127.0.0.1:9/offline-fixture\n');setInterval(()=>{},1000);}
else {process.stderr.write('OFFLINE_STARTUP_FIXTURE_FAILURE token=fixture-not-a-real-secret\n',()=>process.exit(42));}
