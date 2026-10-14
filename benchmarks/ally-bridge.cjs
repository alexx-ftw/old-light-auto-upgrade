'use strict';
// Offline bridge/publication boundary benchmark. No network or game action.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),{createRequire}=require('node:module');
const root=path.join(__dirname,'..'),fixturePath=root+'/tests/empire-bridge.test.cjs';
const source=fs.readFileSync(fixturePath,'utf8');const {harness,validSnapshot}=Function('require','__dirname',source.slice(0,source.indexOf("test('early bootstrap"))+'\nreturn {harness,validSnapshot};')(createRequire(fixturePath),path.dirname(fixturePath));
function measure(fn,iterations){for(let i=0;i<8;i++)fn();const samples=[];for(let round=0;round<5;round++){const start=performance.now();for(let i=0;i<iterations;i++)fn();samples.push((performance.now()-start)/iterations)}samples.sort((a,b)=>a-b);return {medianMs:samples[2],minMs:samples[0],maxMs:samples[4]}}
const result={method:'Real bridge h.send(value): scalar stamp, JSON stringify, simulated MessagePort receive, bounded JSON parse and full boundary validation. Then three real economic snapshots. Synthetic owners only, no browser/network/orders/accounts. Eight warmups and median/range of five serial batches.',rows:[]};
for(const owners of [100,1000,10000]){const h=harness(),value=validSnapshot();for(let i=1;i<owners;i++)value.ownership.players.push({id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),name:'Synthetic '+i,owned:[{q:i,r:0}]});
const cycle=()=>{value.revision++;h.send(value);for(let j=0;j<3;j++){const s=h.app.snapshot({includeOwnership:false});assert.ok(s);assert.equal(s.ownership,null);assert.equal(s.revision,value.revision)}};
const row={owners,serializedBytes:Buffer.byteLength(JSON.stringify(value)),sendAndThreeEconomicReads:measure(cycle,owners===10000?8:20)};assert.equal(h.app.snapshot().ownership.players.length,owners);h.app.stop();result.rows.push(row);console.error(JSON.stringify(row));}
console.log(JSON.stringify(result,null,2));
