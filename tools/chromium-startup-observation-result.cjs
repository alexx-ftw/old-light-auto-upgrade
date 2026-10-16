'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const directory=path.join(os.tmpdir(),'oldlight-startup-observation');
let failed=false,real=0;
if(!fs.existsSync(directory)){console.error('DIAGNOSTIC_ONLY FAIL: no observation records');process.exitCode=1;}else{
 for(const name of fs.readdirSync(directory).filter(name=>/^\d+-\d+\.json$/.test(name)).sort()){const record=JSON.parse(fs.readFileSync(path.join(directory,name)));if(record.acceptance!=='PASS'||!record.closed||record.cleanup!=='closed')failed=true;if(record.binary==='chromium')real++;console.log('DIAGNOSTIC_ONLY '+JSON.stringify(record));}
 if(real<3){failed=true;console.error('DIAGNOSTIC_ONLY FAIL: incomplete real browser observations');}
 console.log('DIAGNOSTIC_ONLY '+JSON.stringify({status:failed?'FAIL':'PASS_OBSERVATION_ONLY',realLaunches:real,releaseValidation:false,acceptanceDeadlineMs:15000,observationWindowMs:45000}));
 if(failed)process.exitCode=1;
}
