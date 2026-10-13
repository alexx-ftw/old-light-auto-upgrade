/* Empire coordinator with injected adapters only; no game/network API. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.OldLightEmpireRuntime=factory();})(globalThis,function(){
'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE=/^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/;
const copy=x=>JSON.parse(JSON.stringify(x));
const sync=x=>{if(x&&typeof x.then==='function')throw new Error('Storage must confirm synchronously.');return x;};
function create(options){
  const {core,adapter,read,write,onChange=()=>{},now=Date.now}=options;
  const dwellMs=Math.max(2000,options.dwellMs||5000),maxAgeMs=Math.max(15000,options.maxAgeMs||120000);
  let scope='',config=core.normalizeConfig(),roster=null,transitCensus=null,plan=null,ready=false,status='',error='',epoch=0;
  let observedId='',arrivedAt=0,pauseUntil=0,move=null,permitNavigation=false,storageError=false,manualHold=false,recoveryDisabled=false;
  const snapshots=new Map(),visited=new Map(),barriers=new Map();
  const key=()=> 'old-light-empire:v1:'+scope;
  function cancelMove(){permitNavigation=false;if(move){move.cancelled=true;if(!move.started)move=null;}}
  function changeScope(next){
    if(next===scope)return;
    epoch++;cancelMove();scope=SCOPE.test(next||'')?next:'';
    snapshots.clear();visited.clear();barriers.clear();roster=null;transitCensus=null;plan=null;ready=false;observedId='';arrivedAt=now();
    storageError=false;error='';manualHold=false;recoveryDisabled=false;
    try{config=core.normalizeConfig(scope?sync(read(key())):undefined);}catch{config=core.normalizeConfig();storageError=true;error='No se puede leer la configuración imperial. No se enviarán órdenes.';}
  }
  function validRoster(value){
    if(!value||value.scope!==scope||value.complete!==true||!Array.isArray(value.systems)||value.systems.length<1||value.systems.length>10000
      ||!Number.isSafeInteger(value.observedAt)||value.observedAt<0||value.observedAt>now()||now()-value.observedAt>maxAgeMs)return null;
    const seen=new Set(),systems=[];
    for(const item of value.systems){
      if(!item||!UUID.test(item.id||'')||item.owned!==true||seen.has(item.id.toLowerCase()))return null;
      const id=item.id.toLowerCase();seen.add(id);systems.push({id,owned:true,name:String(item.name||'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,400)});
    }
    return {scope,complete:true,observedAt:value.observedAt,systems};
  }
  function matches(context,id){return context?.scope===scope&&UUID.test(context.systemId||'')&&context.systemId.toLowerCase()===id&&context.selectionCount===1&&context.owned===true&&context.settled===true;}
  function acceptable(value,id,currentRoster=roster){
    const s=core.normalizeSnapshot(value),barrier=barriers.get(id);
    if(!s||s.scope!==scope||s.systemId!==id||!s.owned||!currentRoster?.systems.some(x=>x.id===id)||s.observedAt>now()||now()-s.observedAt>maxAgeMs
      ||(barrier&&(s.observedAt<=barrier.at||(barrier.censusId&&(!s.censusId||s.censusId===barrier.censusId)))))return null;
    return s;
  }
  function readBatch(currentRoster){
    if(typeof adapter.readSnapshots!=='function')return new Map(snapshots);
    let values;try{values=adapter.readSnapshots();}catch{return null;}
    if(!Array.isArray(values))return null;
    const ids=new Set(currentRoster.systems.map(x=>x.id)),batch=new Map();
    for(const value of values){
      const id=value?.systemId?.toLowerCase();
      if(!ids.has(id)||batch.has(id))return null;
      const snapshot=acceptable(value,id,currentRoster);if(!snapshot)return null;batch.set(id,snapshot);
    }
    return batch.size===ids.size?batch:null;
  }
  function setConfig(value){
    if(!scope||storageError)throw new Error(error||'Falta identificar tu cuenta y galaxia.');
    const next=core.normalizeConfig(value);
    sync(write(key(),next));
    if(manualHold&&!next.enabled)recoveryDisabled=true;
    if(manualHold&&recoveryDisabled&&next.enabled&&!config.enabled&&!move){manualHold=false;recoveryDisabled=false;error='';}
    config=next;epoch++;ready=false;cancelMove();arrivedAt=now();pauseUntil=0;onChange();return copy(config);
  }
  function state(){return copy({scope,config,roster,transitCensus,snapshots:[...snapshots.values()],plan,ready,status,error,moving:!!move,target:move?.id||'',storageError,manualHold,pausedUntil:pauseUntil,maxAgeMs});}
  function hold(reason){ready=false;status=reason;return state();}
  function reject(reason){cancelMove();return hold(reason);}
  function chooseNext(current){
    const eligible=roster.systems.filter(x=>config.systems[x.id]?.enabled!==false);
    eligible.sort((a,b)=>(visited.get(a.id)??-1)-(visited.get(b.id)??-1)||a.id.localeCompare(b.id));
    return eligible.find(x=>x.id!==current)?.id||current;
  }
  function select(id,fromId){
    const operation={id,scope,token:epoch,at:now(),started:false,cancelled:false};move=operation;
    Promise.resolve().then(()=>{
      if(operation.cancelled||move!==operation||operation.token!==epoch||!permitNavigation||!config.enabled||scope!==operation.scope||pauseUntil>now())return null;
      const freshRoster=validRoster(adapter.readRoster()),active=adapter.readActive();
      if(!freshRoster?.systems.some(x=>x.id===id)||!matches(active?.context,fromId)||!acceptable(active?.snapshot,fromId,freshRoster)||adapter.canNavigate?.()===false){operation.cancelled=true;return null;}
      operation.started=true;return adapter.selectSystem(id,{scope:operation.scope});
    }).then(result=>{
      if(move!==operation)return;move=null;ready=false;permitNavigation=false;
      if(operation.cancelled||operation.token!==epoch||operation.scope!==scope){onChange();return;}
      arrivedAt=now();if(result!==true){manualHold=true;error='No se pudo confirmar el cambio de sistema. Revisa la selección antes de continuar.';}onChange();
    }).catch(()=>{
      if(move!==operation)return;move=null;ready=false;permitNavigation=false;
      if(!operation.cancelled&&operation.token===epoch&&operation.scope===scope){manualHold=true;error='Falló el cambio de sistema. Revisa la selección antes de continuar.';}onChange();
    });
  }
  function update({scope:nextScope,blocked='',enabled=true}={}){
    changeScope(nextScope);ready=false;permitNavigation=false;
    if(!scope)return reject('Selecciona un sistema propio para identificar la cuenta y la galaxia.');
    if(storageError)return reject(error);
    try{const next=core.normalizeConfig(sync(read(key())));if(JSON.stringify(next)!==JSON.stringify(config)){config=next;epoch++;cancelMove();arrivedAt=now();}}
    catch{storageError=true;return reject(error='No se puede leer la configuración imperial. No se enviarán órdenes.');}
    try{roster=validRoster(adapter.readRoster());}catch{roster=null;}
    if(!roster)return reject(adapter.getStatus?.()||'No se ha podido verificar la lista completa de sistemas propios.');
    const owned=new Set(roster.systems.map(x=>x.id));
    for(const id of snapshots.keys())if(!owned.has(id)){snapshots.delete(id);visited.delete(id);barriers.delete(id);}
    if(typeof adapter.readSnapshots==='function'){
      const census=readBatch(roster);
      if(!census){snapshots.clear();return reject('El censo imperial no está disponible o es ambiguo.');}
      snapshots.clear();for(const [id,value] of census)snapshots.set(id,value);
    }
    let active;try{active=adapter.readActive();}catch{active=null;}
    const id=active?.context?.systemId?.toLowerCase();
    const current=id&&owned.has(id)&&matches(active.context,id)&&acceptable(active.snapshot,id);
    if(current&&typeof adapter.readSnapshots==='function'&&JSON.stringify(current)!==JSON.stringify(snapshots.get(id)))return reject('El HUD y el censo imperial no coinciden.');
    if(current){snapshots.set(id,current);if(id!==observedId){observedId=id;arrivedAt=now();visited.set(id,now());}}
    else if(id)snapshots.delete(id);
    let transit;try{transit=adapter.readTransitCensus?.();}catch{transit=null;}
    transitCensus=transit?core.normalizeTransitCensus(transit):null;
    if(typeof adapter.readTransitCensus==='function'&&!transitCensus)return reject('El censo de flotas en tránsito no está disponible.');
    const expectedIds=roster.systems.map(x=>x.id);
    plan=core.plan(config,[...snapshots.values()],{scope,now:now(),maxAgeMs,expectedIds,activeSystemId:id,transitCensus:transitCensus||undefined});
    if(!config.enabled)return reject('Modo imperio desactivado. Los ajustes habituales siguen vigentes.');
    if(!enabled)return reject('Imperio pausado con el Helper.');
    if(blocked)return reject(blocked);
    if(manualHold)return reject('Recorrido detenido tras una selección sin confirmar. Desactiva y activa el modo para revisar.');
    if(move&&now()-move.at>15000){move.cancelled=true;manualHold=true;return hold(error='El cambio de sistema no respondió. Revisa la selección antes de continuar.');}
    if(move){permitNavigation=!move.cancelled;return hold('Seleccionando el siguiente sistema…');}
    if(pauseUntil>now())return reject('Esperando a que termines de usar el juego.');
    if(!current)return reject('Esperando identidad, propiedad y datos actuales del sistema seleccionado.');
    const currentEnabled=config.systems[id]?.enabled!==false,nextId=chooseNext(id);
    if(nextId&&nextId!==id&&(!plan.complete||!currentEnabled||now()-arrivedAt>=dwellMs)){
      if(typeof adapter.selectSystem!=='function')return reject('El selector nativo de sistemas todavía no está verificado.');
      permitNavigation=true;select(nextId,id);return hold('Recorriendo los sistemas del imperio…');
    }
    if(!currentEnabled)return reject('Este sistema está excluido del recorrido imperial.');
    if(!plan.complete)return reject(plan.reason||'Actualizando los sistemas antes de repartir objetivos.');
    ready=true;status='Imperio activo: '+(current.name||id)+'.';error='';return state();
  }
  function canAct(context){
    if(!ready||!config.enabled||move||manualHold||pauseUntil>now()||!roster||!plan?.complete)return false;
    try{
      if(JSON.stringify(core.normalizeConfig(sync(read(key()))))!==JSON.stringify(config))return false;
      const latest=validRoster(adapter.readRoster());
      if(!latest||JSON.stringify(latest.systems.map(x=>x.id).sort())!==JSON.stringify(roster.systems.map(x=>x.id).sort()))return false;
      const id=observedId,active=adapter.readActive(),snapshot=acceptable(active?.snapshot,id,latest);
      if(!matches(context,id)||!matches(active?.context,id)||!snapshot||config.systems[id]?.enabled===false||adapter.canNavigate?.()===false)return false;
      const all=readBatch(latest);if(!all)return false;
      if(typeof adapter.readSnapshots==='function'&&JSON.stringify(snapshot)!==JSON.stringify(all.get(id)))return false;
      all.set(id,snapshot);
      const liveTransit=adapter.readTransitCensus?.();
      if(typeof adapter.readTransitCensus==='function'&&!core.normalizeTransitCensus(liveTransit))return false;
      const fresh=core.plan(config,[...all.values()],{scope,now:now(),maxAgeMs,expectedIds:latest.systems.map(x=>x.id),activeSystemId:id,transitCensus:liveTransit});
      return fresh.complete&&JSON.stringify(fresh.targetsBySystem)===JSON.stringify(plan.targetsBySystem);
    }catch{return false;}
  }
  function suspend(ms=15000){pauseUntil=now()+Math.max(0,ms);ready=false;epoch++;cancelMove();onChange();}
  function invalidate(systemId){
    if(UUID.test(systemId||'')){const id=systemId.toLowerCase(),previous=snapshots.get(id),old=barriers.get(id);barriers.set(id,{at:Math.max(now(),previous?.observedAt||0,old?.at||0),censusId:previous?.censusId||old?.censusId||null});snapshots.delete(id);}
    ready=false;cancelMove();
  }
  return {update,state,setConfig,canAct,suspend,invalidate,importConfig:value=>setConfig({...core.normalizeConfig(value),enabled:false}),exportConfig:()=>copy(config),isEnabled:()=>config.enabled===true,isBusy:()=>!!move};
}
return Object.freeze({create});
});
