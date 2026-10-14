'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../docs/telemetry-core.js');
const G='00000000-0000-4000-8000-000000000001';
function fixture(extra={}) {
 let raw={schema:1,policy:1,destinationId:'synthetic',enabled:true,generation:G}, now=0, sequence=1, id=0;
 const timers=new Map(),calls=[];
 const options={version:'1.16.7',destination:{verified:true,id:'synthetic'},readConsent:()=>raw,writeConsent:v=>{raw=v},randomUUID:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,AbortController,now:()=>now,setTimeout:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id},clearTimeout:id=>timers.delete(id),transport:(batch,context)=>{calls.push({batch,context});return {accepted:true}},...extra};
 const remote=Core.create(options);
 return {remote,options,calls,timers,get raw(){return raw},set raw(v){raw=v},set now(v){now=v},async advance(ms){const end=now+ms;for(;;){const first=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!first||first[1].at>end)break;now=first[1].at;timers.delete(first[0]);first[1].fn();for(let i=0;i<5;i++)await Promise.resolve()}now=end;}};
}
test('reentrant abort handlers cannot carry previous-generation observations into opt-in',async()=>{
 const f=fixture();let signal;
 f.options.transport=(batch,context)=>{f.calls.push({batch,context});signal=context.signal;signal.addEventListener('abort',()=>{f.remote.record('error.runtime')});return new Promise(()=>{})};
 f.remote.record('helper.loaded');const pending=f.remote.flush();
 assert.equal(f.remote.setEnabled(true),true);assert.equal(await pending,false);
 assert.equal(signal.aborted,true);assert.deepEqual(f.remote.snapshot().counts,{});
});
test('revocation blocks reentrant transmission before abort notification',async()=>{
 const f=fixture();let duringRevoke=false,extraTransmission=false,reentrant;
 f.options.transport=(batch,context)=>{f.calls.push({batch,context});if(duringRevoke)extraTransmission=true;context.signal.addEventListener('abort',()=>{if(f.calls.length===1){f.now=Core.INTERVAL;f.remote.record('error.runtime');reentrant=f.remote.flush()}});return new Promise(()=>{})};
 f.remote.record('helper.loaded');const pending=f.remote.flush();duringRevoke=true;assert.equal(f.remote.setEnabled(false),true);duringRevoke=false;
 await pending;f.remote.destroy();if(reentrant)await reentrant;
 assert.equal(extraTransmission,false,'A second transport started synchronously while revoking');
});
test('pending request is aborted after timeout even if transport success is delayed',async()=>{
 let resolve;const f=fixture({transport:(_,ctx)=>{f.calls.push(ctx);return new Promise(r=>resolve=r)}});
 f.remote.record('helper.loaded');const p=f.remote.flush();await f.advance(Core.TIMEOUT);assert.equal(await p,false);assert.equal(f.calls[0].signal.aborted,true);resolve({accepted:true});await Promise.resolve();assert.equal(f.remote.getStatus().accepted,0);
});
test('remote is inert with hostile active local-shaped consent and no destination',async()=>{
 let accesses=0;const f=fixture({destination:null,readConsent(){accesses++;throw Error('must not access')}});assert.equal(f.remote.record('helper.loaded'),false);assert.equal(f.remote.duration('helper.step',1),false);assert.equal(await f.remote.flush(),false);assert.equal(accesses,0);assert.equal(f.timers.size,0);
});
test('new generation drops queued observations without replay',async()=>{
 const f=fixture();f.remote.record('helper.loaded');f.raw={...f.raw,generation:'00000000-0000-4000-8000-000000000099'};assert.equal(await f.remote.flush(),false);assert.equal(f.calls.length,0);assert.deepEqual(f.remote.snapshot().counts,{});
});
test('onChange reentrancy cannot reopen destroyed adapter',async()=>{
 const f=fixture();f.remote.onChange(()=>{f.remote.setEnabled(true);f.remote.record('helper.loaded')});f.remote.destroy();assert.equal(f.remote.getStatus().enabled,false);assert.equal(await f.remote.flush(),false);assert.equal(f.calls.length,0);
});
test('maximum-size fixed payload stays below byte cap with all fields saturated',async()=>{
 const f=fixture({version:'999999.999999.999999'});
 for(const event of Core.EVENTS)f.remote.record(event);
 for(const value of [0,1,4,16,50,200,1000])f.remote.duration('helper.step',value);
 const snapshot=f.remote.snapshot();for(const key of Object.keys(snapshot.counts))snapshot.counts[key]=Core.MAX_COUNT;for(const key of Object.keys(snapshot.duration_buckets.helper_step))snapshot.duration_buckets.helper_step[key]=Core.MAX_COUNT;
 assert.equal(Object.keys(snapshot.counts).length,36);assert.equal(Object.keys(snapshot.duration_buckets.helper_step).length,7);assert.ok(Buffer.byteLength(JSON.stringify(snapshot))<Core.MAX_BYTES);
 assert.equal(await f.remote.flush(),true);assert.deepEqual(Object.keys(f.calls[0].batch).sort(),['counts','duration_buckets','helper_version','schema']);
});
test('histogram counters saturate and invalid durations never coerce input',()=>{
 const f=fixture();for(let i=0;i<Core.MAX_COUNT+3;i++)f.remote.duration('helper.step',1);assert.equal(f.remote.snapshot().duration_buckets.helper_step['1_4ms'],Core.MAX_COUNT);
 let conversions=0;assert.equal(f.remote.duration('helper.step',{valueOf(){conversions++;return 4}}),false);assert.equal(conversions,0);assert.equal(f.timers.size,1);
});
test('transport accepted accessor is neither evaluated nor counted',async()=>{
 let reads=0;const f=fixture({transport:()=>Object.defineProperty({},'accepted',{get(){reads++;return true}})});f.remote.record('helper.loaded');assert.equal(await f.remote.flush(),false);assert.equal(reads,0);assert.equal(f.remote.getStatus().accepted,0);
});
test('malformed consent disables until explicit activation, even after storage heals',async()=>{
 const f=fixture();f.remote.record('helper.loaded');f.raw={...f.raw,policy:2};assert.equal(await f.remote.flush(),false);f.raw={...f.raw,policy:1};assert.equal(f.remote.record('helper.loaded'),false);assert.equal(f.remote.setEnabled(true),true);assert.equal(f.remote.record('helper.loaded'),true);assert.equal(await f.remote.flush(),true);assert.equal(f.calls[0].batch.counts['helper.loaded'],1);
});
test('new observations during active transport form separate later batch without resending old one',async()=>{
 let done;const f=fixture();f.options.transport=(batch,context)=>{f.calls.push({batch,context});return new Promise(r=>done=r)};f.remote.record('helper.loaded');const p=f.remote.flush();f.remote.record('drive.error');assert.equal(await f.remote.flush(),false);done({accepted:false});assert.equal(await p,false);assert.equal(f.calls.length,1);f.now=Core.INTERVAL;const q=f.remote.flush();done({accepted:true});assert.equal(await q,true);assert.deepEqual(f.calls[1].batch.counts,{'drive.error':1});
});

test('observed generation rotation cannot accept callbacks from the discarded request', async () => {
 const f=fixture();let nestedConsent, nestedRecord, signal;
 f.options.transport=(batch,context)=>{signal=context.signal;signal.addEventListener('abort',()=>{nestedRecord=f.remote.record('error.runtime');nestedConsent=f.remote.setEnabled(true)});return new Promise(()=>{})};
 f.remote.record('helper.loaded');const pending=f.remote.flush();
 f.raw={...f.raw,generation:'00000000-0000-4000-8000-000000000099'};
 f.remote.sync();assert.equal(await pending,false);assert.equal(signal.aborted,true);
 assert.equal(nestedRecord,false);assert.equal(nestedConsent,false);
 assert.equal(f.raw.generation,'00000000-0000-4000-8000-000000000099');
 assert.deepEqual(f.remote.snapshot().counts,{});
 assert.equal(f.remote.record('drive.connected'),true);
});

test('throwing abort cleanup still settles pending operation and leaves consent revoked', async () => {
 const f=fixture({AbortController:class extends AbortController{abort(){super.abort();throw Error('adapter failed')}}});
 f.options.transport=()=>new Promise(()=>{});f.remote.record('helper.loaded');const pending=f.remote.flush();
 assert.equal(f.remote.setEnabled(false),true);assert.equal(await pending,false);
 assert.equal(f.remote.isEnabled(),false);assert.equal(f.timers.size,0);assert.deepEqual(f.remote.snapshot().counts,{});
});


test('throwing timeout abort still settles without acceptance or leftover timers', async () => {
 const f=fixture({AbortController:class extends AbortController{abort(){super.abort();throw Error('adapter failed')}}});
 f.options.transport=()=>new Promise(()=>{});f.remote.record('helper.loaded');const pending=f.remote.flush();
 await f.advance(Core.TIMEOUT);assert.equal(await pending,false);
 assert.equal(f.remote.getStatus().state,'send_failed');assert.equal(f.remote.getStatus().accepted,0);assert.equal(f.timers.size,0);
});
