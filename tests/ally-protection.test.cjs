'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const block = name => source.slice(source.indexOf('// BEGIN ' + name), source.indexOf('// END ' + name));
const SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ALLY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', RIVAL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const scope = 'alpha/' + SELF, job = { scope, target: { coordinate: { q: 2, r: 3 } } };
function harness() {
  const data = new Map(); let clock = 10000, currentScope = scope, failRead = false;
  const storage = { getItem: k => { if (failRead) throw Error('read'); return data.get(k) ?? null; }, setItem: (k,v) => data.set(k,v) };
  let world = { version:1, scope, selfId:SELF, connected:true, observedAt:10000, epoch:1, revision:0, generation:1,
    ownership:{version:1,complete:false,players:[{id:SELF,name:'Self',owned:[{q:0,r:0}]}, {id:ALLY,name:'Trusted Pilot',owned:[{q:4,r:5}]},{id:RIVAL,name:'Other Pilot',owned:[{q:2,r:3}]}]} };
  const context = vm.createContext({}); vm.runInContext(block('ALLY PROTECTION') + '\nthis.factory=createAllyProtection;',context);
  const guard = context.factory({ getContext:()=>({scope:currentScope}), getWorld:()=>world,storage,now:()=>clock });
  return { guard,data, storage, set clock(v){clock=v;}, set world(v){world=v;},get world(){return world;},set scope(v){currentScope=v;},set failRead(v){failRead=v;},protect(){guard.add({id:ALLY,name:'Trusted Pilot'});} };
}
test('unconfigured guard leaves existing automation unchanged without a native census',()=>{ const h=harness(); h.world=null; assert.equal(h.guard.check(job).allowed,true); assert.equal(h.guard.active(),false); });
test('verified identity blocks protected coordinates, not a known different owner',()=>{const h=harness();h.protect();assert.equal(h.guard.check(job).allowed,true);assert.equal(h.guard.check({...job,target:{coordinate:{q:4,r:5}}}).code,'protected');});
test('rename cannot bypass stable ID, and exact alias remains a conservative extra block',()=>{const h=harness();h.protect();h.world.ownership.players[1].name='New Name';assert.equal(h.guard.check({...job,target:{coordinate:{q:4,r:5}}}).code,'protected');h.world.ownership.players[2].name='TRUSTED  PILOT';assert.equal(h.guard.check(job).code,'protected');});
test('alias without UUID is protection pending and never authorizes attacks',()=>{const h=harness();h.guard.add({name:'Trusted Pilot'});assert.equal(h.guard.check(job).code,'unresolved-alias');assert.equal(h.guard.check({...job,target:{coordinate:{q:4,r:5}}}).code,'protected');h.world.ownership.players[1].name='Renamed';assert.equal(h.guard.check(job).allowed,false);});
for(const [label,mutate] of [
 ['missing snapshot',h=>h.world=null],['disconnect',h=>h.world.connected=false],['foreign account',h=>h.world.scope='alpha/'+ALLY],
 ['stale snapshot',h=>h.clock=130001],['future snapshot',h=>h.world.observedAt=10001],['absent ownership',h=>delete h.world.ownership],
 ['duplicate owner',h=>h.world.ownership.players.push(h.world.ownership.players[1])],['conflicting claims',h=>h.world.ownership.players[1].owned.push({q:2,r:3})],
 ['unknown owner',h=>h.world.ownership.players[2].owned=[]],['invalid epoch',h=>h.world.epoch=0],['invalid revision',h=>h.world.revision=-1],
 ['storage unreadable',h=>h.failRead=true],['storage malformed',h=>h.data.set('old-light-protected-players:v1:'+scope,'bad')],
 ['foreign saved scope',h=>h.data.set('old-light-protected-players:v1:'+scope,JSON.stringify({version:1,scope:'alpha/'+ALLY,players:[]}))],
]) test('fail closed: '+label,()=>{const h=harness();h.protect();mutate(h);assert.equal(h.guard.check(job).allowed,false);});
test('owner changes mid-preparation require review, even to an unprotected owner',()=>{const h=harness();h.protect();const token=h.guard.check(job).token;h.world.ownership.players[2].id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';assert.equal(h.guard.check(job,token).code,'owner-changed');});
test('ownership newly captured by ally blocks an old queued target',()=>{const h=harness();h.protect();const token=h.guard.check(job).token;h.world.ownership.players[2].owned=[];h.world.ownership.players[1].owned.push({q:2,r:3});assert.equal(h.guard.check(job,token).code,'protected');});
for(const field of ['epoch','generation']) test(field+' change invalidates earlier preparation token',()=>{const h=harness();h.protect();const token=h.guard.check(job).token;h.world[field]++;assert.equal(h.guard.check(job,token).code,'owner-changed');});
test('same owner with newer native revision stays permitted',()=>{const h=harness();h.protect();const token=h.guard.check(job).token;h.world.revision++;assert.equal(h.guard.check(job,token).allowed,true);});
test('protection saved by another tab is read at the final check',()=>{const h=harness();const old=h.guard.check(job);h.world.ownership.players[1].owned=[];h.world.ownership.players[2].id=ALLY;h.world.ownership.players.splice(1,1);h.guard.add({id:ALLY,name:'Other Pilot'});assert.equal(h.guard.check(job,old.token).code,'protected');});
test('settings never cross accounts or galaxies',()=>{const h=harness();h.protect();h.scope='beta/'+SELF;assert.equal(h.guard.active(),false);assert.equal(h.guard.check({...job,scope:'beta/'+SELF}).allowed,true);h.scope=scope;assert.equal(h.guard.active(),true);});
test('explicit ID must be observed with matching name; no ID derived from names',()=>{const h=harness();assert.throws(()=>h.guard.add({id:ALLY,name:'Other Pilot'}));assert.throws(()=>h.guard.add({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}));assert.throws(()=>h.guard.add({id:SELF}));h.guard.add({name:'Trusted Pilot'});const saved=JSON.parse([...h.data.values()][0]);assert.equal(saved.players[0].id,'');});
test('stored protection stays outside backup, sync, metrics and defaults',()=>{const integration=source.slice(source.indexOf('  function createBackup('),source.indexOf('  function validateBackup('));assert.equal(/allyProtection|protected-players/.test(integration),false);assert.equal(block('SYNC CORE').includes('protected-players'),false);});
test('all automatic submission boundaries have guards including immediate Shift preset',()=>{const adapter=block('NATIVE MISSION ADAPTER'),shift=block('SHIFT PRESETS');assert.match(adapter,/checkTarget\(job, protection\?\.token \|\| null\)/);assert.match(adapter,/!readError\(dialog\) && protectedTarget\(\)/);assert.match(adapter,/protectedTarget\(\);\s*operation.permitConfirm = true/);assert.match(shift,/!confirm.disabled && protectedPreset\(\)/);assert.match(shift,/if \(!protectedPreset\(\)\)/);});

test('duplicate display names never replace another protected stable ID',()=>{const h=harness();h.world.ownership.players[2].name='Trusted Pilot';h.protect();h.guard.add({id:RIVAL,name:'Trusted Pilot'});h.world.ownership.players[1].name='Renamed';assert.equal(h.guard.check({...job,target:{coordinate:{q:4,r:5}}}).code,'protected');assert.equal(JSON.parse([...h.data.values()][0]).players.length,2);});
test('adding a name alone never degrades a previously bound ID',()=>{const h=harness();h.protect();h.guard.add({name:'Trusted Pilot'});h.world.ownership.players[1].name='Renamed';assert.equal(h.guard.check({...job,target:{coordinate:{q:4,r:5}}}).code,'protected');assert.equal(JSON.parse([...h.data.values()][0]).players[0].id,ALLY);});
test('stale form scope cannot add protection to a different account',()=>{const h=harness();h.scope='beta/'+SELF;assert.throws(()=>h.guard.add({name:'Pilot',expectedScope:scope}));assert.equal(h.data.size,0);});

test('empty protection carries a scope token without requiring a route or census',()=>{const h=harness();h.world=null;const first=h.guard.check(null);assert.equal(first.allowed,true);assert.equal(first.token.scope,scope);assert.equal(h.guard.check(null,first.token).allowed,true);h.scope='beta/'+SELF;assert.equal(h.guard.check(null,first.token).code,'scope');});
test('removing a list does not discard the earlier account boundary',()=>{const h=harness();h.protect();const previous=h.guard.check(job).token;h.data.clear();assert.equal(h.guard.check(job,previous).allowed,true);h.scope='beta/'+SELF;assert.equal(h.guard.check(job,previous).allowed,false);});
test('adding a list after an unconfigured preflight requires a fresh preparation',()=>{const h=harness();const previous=h.guard.check(null).token;h.protect();assert.equal(h.guard.check(job,previous).code,'owner-changed');assert.equal(h.guard.check(job).allowed,true);});

test('unresolved unrelated aliases allow only a route custom send to the fresh verified self owner',()=>{
 const h=harness();h.guard.add({name:'Pending unrelated friend'});
 const own={...job,id:'route:north:1',target:{mode:'custom',missionAction:'send',coordinate:{q:0,r:0}}};
 const first=h.guard.check(own);assert.equal(first.allowed,true);assert.equal(first.enabled,true);assert.equal(first.token.ownerId,SELF);
 for(const patch of [{id:'ordinary'},{id:'retry:campaign:1'},{id:'Route:north:1'},
  {target:{...own.target,missionAction:'attack'}},{target:{...own.target,mode:'amounts'}},
  {target:{...own.target,coordinate:{q:2,r:3}}}]){
  assert.equal(h.guard.check({...own,...patch}).code,'unresolved-alias');
 }
 h.world.revision++;assert.equal(h.guard.check(own,first.token).allowed,true);
 h.world.generation++;assert.equal(h.guard.check(own,first.token).code,'owner-changed');
 assert.equal(JSON.parse([...h.data.values()][0]).players[0].id,'','no alias resolution or setting mutation');
});
for(const [name,change,code] of [
 ['missing census',h=>h.world=null,'ownership'],['stale census',h=>h.clock=130001,'ownership'],
 ['unknown owner',h=>h.world.ownership.players[0].owned=[],'unknown-owner'],
 ['protected self-name match',h=>h.guard.add({name:'Self'}),'protected'],
 ['conflicting ownership',h=>h.world.ownership.players[1].owned.push({q:0,r:0}),'ownership'],
 ['storage error',h=>h.failRead=true,'storage'],
 ['protected destination',h=>{h.world.ownership.players[0].owned=[];h.world.ownership.players[1].owned.push({q:0,r:0});h.protect();},'protected'],
])test('own reinforcement still denies '+name+' with unresolved ally',()=>{
 const h=harness();h.guard.add({name:'Pending unrelated friend'});change(h);
 const own={...job,id:'route:north:1',target:{mode:'custom',missionAction:'send',coordinate:{q:0,r:0}}};
 assert.equal(h.guard.check(own).code,code);
});
