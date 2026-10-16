'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function assessRecords(records){
 const expected={'conquest-panel-browser.test.cjs':1,'native-galaxy-overlay.test.cjs':2,'ship-credit-layout.test.cjs':1,'reinforcement-observer-loop.test.cjs':1};
 const real=records.filter(record=>record.binary==='chromium'),coverage=Object.fromEntries(Object.keys(expected).map(file=>[file,real.filter(record=>record.testFile===file).length]));
 const failed=records.some(record=>record.acceptance!=='PASS'||!record.closed||record.cleanup!=='closed')||real.length!==5||Object.entries(expected).some(([file,count])=>coverage[file]!==count);
 return {failed,realLaunches:real.length,coverage};
}
module.exports={assessRecords};
if(require.main===module){
 const directory=path.join(os.tmpdir(),'oldlight-startup-observation');
 if(!fs.existsSync(directory)){console.error('DIAGNOSTIC_ONLY FAIL: no observation records');process.exitCode=1;}else{
  const records=fs.readdirSync(directory).filter(name=>/^\d+-\d+\.json$/.test(name)).sort().map(name=>JSON.parse(fs.readFileSync(path.join(directory,name))));
  for(const record of records)console.log('DIAGNOSTIC_ONLY '+JSON.stringify(record));
  const log=process.env.RUNNER_TEMP&&path.join(process.env.RUNNER_TEMP,'startup-observation-suite.log');if(log&&fs.existsSync(log)){const fd=fs.openSync(log,'r');try{const size=fs.fstatSync(fd).size,bytes=Buffer.alloc(Math.min(65536,size));fs.readSync(fd,bytes,0,bytes.length,size-bytes.length);const counts={};for(const line of bytes.toString('utf8').split('\n')){const match=/^(?:# |ℹ )?(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([0-9.]+)$/.exec(line.trim());if(match)counts[match[1]]=Number(match[2]);}console.log('DIAGNOSTIC_ONLY_SUITE_SUMMARY '+JSON.stringify(counts));}finally{fs.closeSync(fd);}}
  const result=assessRecords(records);console.log('DIAGNOSTIC_ONLY '+JSON.stringify({...result,status:result.failed?'FAIL':'PASS_OBSERVATION_ONLY',releaseValidation:false,acceptanceDeadlineMs:15000,observationWindowMs:45000}));
  if(result.failed)process.exitCode=1;
 }
}
