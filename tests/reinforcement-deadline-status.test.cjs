'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),vm=require('node:vm');
function fixture(file,names){const name=path.join(__dirname,file),req=createRequire(name),prefix=fs.readFileSync(name,'utf8').split('\ntest(')[0];return new Function('require','__dirname',prefix+'\nreturn {'+names+'};')(req,__dirname);}
const panel=fixture('reinforcement-panel.test.cjs','harness,create,all,byButton');
const engine=fixture('reinforcement-core.test.cjs','harness,route,SCOPE,A');
test('expired deadline includes the observed blocking reason in the countdown itself without actions or control replacement',()=>{
 let diagnostic={id:'route-1',code:'leadership',message:'Esperando control exclusivo: comprueba si otra pestaña lo tiene.',checkedAt:1000,nextRunAt:0,lastSentAt:null};
 const h=panel.harness({getDiagnostics:()=>({routes:[diagnostic]})});panel.create(h);
 const eta=panel.all(h.container).find(n=>n.dataset.routeEta==='route-1'),edit=panel.byButton(h.container,'Editar'),calls=h.calls.length;
 assert.ok(eta);
 for(const [code,message]of [['leadership','Esperando control exclusivo: comprueba si otra pestaña lo tiene.'],['stale-census','Censo caducado: espera datos nativos actuales.'],['hud','Abre Structures o Shipyard para continuar.'],['ready','Preparada para la siguiente comprobación del planificador. Aún no es un envío confirmado.']]){
  diagnostic={...diagnostic,code,message};h.app.render();assert.match(eta.textContent,/Intervalo vencido/);assert.ok(eta.textContent.includes(message));assert.equal(panel.byButton(h.container,'Editar'),edit);assert.equal(h.calls.length,calls);
 }
 h.app.destroy();
});
test('expired deadline with unavailable diagnostics reports uncertainty instead of claiming scheduler activity',()=>{
 const h=panel.harness({getDiagnostics:()=>{throw Error('synthetic');}});panel.create(h);h.routes[0].nextRunAt=0;h.app.render();
 const eta=panel.all(h.container).find(n=>n.dataset.routeEta==='route-1');
 assert.match(eta.textContent,/No se puede comprobar el estado actual/);assert.doesNotMatch(eta.textContent,/próxima comprobación pendiente/);assert.equal(h.calls.length,1);h.app.destroy();
});
test('due scheduler rechecks coordination pause and missing census and queues exactly once after valid recovery',()=>{
 for(const kind of ['coordination','paused','census','inactive']){
  const h=engine.harness();h.engine.save(engine.route());h.storage.get(engine.SCOPE).routes[0].nextRunAt=h.at+1000;
  h.advance(1001);
  if(kind==='coordination')h.context.coordinated=false;
  if(kind==='paused')h.engine.pause('north');
  if(kind==='census')h.world.complete=false;
  if(kind==='inactive')h.context.canAct=false;
  const before=JSON.stringify([...h.storage]);const diagnostic=h.engine.diagnostics().routes[0];assert.notEqual(diagnostic.code,'ready');assert.equal(JSON.stringify([...h.storage]),before,'diagnostics are read-only');
  for(let n=0;n<3;n++)h.engine.tick();assert.equal(h.calls.length,0,kind);
  h.context.coordinated=true;h.context.canAct=true;h.world.complete=true;
  if(kind==='paused'){h.engine.resume('north');h.advance(300001);}
  assert.equal(h.engine.tick().queued.length,1,kind);h.engine.tick();assert.equal(h.calls.length,1,kind);
 }
});
test('actual scheduler coalesces due checks and reacquires valid core eligibility without duplicate queueing',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','old-light-auto-upgrade.user.js'),'utf8');
 const a=source.indexOf('  function schedule() {',source.indexOf('  function startOldLightHelper()')),b=source.indexOf('  function wakeAt(',a);assert.ok(a>0&&b>a);
 const h=engine.harness(),tasks=[];h.engine.save(engine.route());h.storage.get(engine.SCOPE).routes[0].nextRunAt=h.at+1000;
 const ctx=vm.createContext({settings:{enabled:true},document:{hidden:false},empireController:null,Date:{now:()=>h.at},metrics:{},step:()=>h.engine.tick(),queueMicrotask:fn=>tasks.push(fn)});
 vm.runInContext('let scheduled=false,lastEmpireStepAt=0;'+source.slice(a,b)+';globalThis.run=schedule;',ctx);
 function check(){ctx.run();ctx.run();assert.equal(tasks.length,1);tasks.shift()();}
 check();assert.equal(h.calls.length,0);h.advance(1001);h.context.coordinated=false;check();assert.equal(h.calls.length,0);
 h.context.coordinated=true;check();check();assert.equal(h.calls.length,1);
});
