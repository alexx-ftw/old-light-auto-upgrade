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
  let observedId='',arrivedAt=0,pauseUntil=0,interactionUntil=0,move=null,permitNavigation=false,storageError=false,manualHold=false,recoveryDisabled=false;
  const snapshots=new Map(),visited=new Map(),barriers=new Map();
  const orderBoundaries=new WeakMap();
  const key=()=> 'old-light-empire:v1:'+scope;
  const pauseDeadline=()=>Math.max(pauseUntil,interactionUntil);
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
  function baseSnapshot(value,id,currentRoster=roster){
    const s=core.normalizeSnapshot(value);
    if(!s||s.scope!==scope||s.systemId!==id||!s.owned||!currentRoster?.systems.some(x=>x.id===id)||s.observedAt>now()||now()-s.observedAt>maxAgeMs)return null;
    return s;
  }
  function behindOrderBoundary(s,id){
    const barrier=barriers.get(id);
    return !!(barrier&&(s.observedAt<=barrier.at||(barrier.censusId&&(!s.censusId||s.censusId===barrier.censusId))||barrier.censusIds?.includes(s.censusId)));
  }
  function acceptable(value,id,currentRoster=roster){
    const s=baseSnapshot(value,id,currentRoster);return s&&!behindOrderBoundary(s,id)?s:null;
  }
  function readBatch(currentRoster,bundle,bundled=false,diagnostic=null){
    if(!bundled&&typeof adapter.readSnapshots!=='function')return new Map(snapshots);
    let values;try{values=bundled?bundle?.snapshots:adapter.readSnapshots();}catch{return null;}
    if(!Array.isArray(values))return null;
    const ids=new Set(currentRoster.systems.map(x=>x.id)),batch=new Map();let waitingForOrder=false;
    for(const value of values){
      const id=value?.systemId?.toLowerCase();
      if(!ids.has(id)||batch.has(id))return null;
      const snapshot=baseSnapshot(value,id,currentRoster);if(!snapshot)return null;
      if(behindOrderBoundary(snapshot,id))waitingForOrder=true;batch.set(id,snapshot);
    }
    if(batch.size!==ids.size)return null;
    if(waitingForOrder){
      // Diagnose only an otherwise exact, coherent native census. Missing,
      // duplicate, invalid or incomplete data retain the generic rejection.
      if(diagnostic){
        try{
          const transit=bundled?bundle?.transitCensus:adapter.readTransitCensus?.();
          const data=core.aggregate([...batch.values()],{scope,now:now(),maxAgeMs,expectedIds:[...ids],transitCensus:transit});
          diagnostic.waitingForOrder=data.complete&&data.fleetComplete;
        }catch{/* A diagnostic read cannot turn rejected data into authority. */}
      }
      return null;
    }
    return batch;
  }
  function setConfig(value){
    if(!scope||storageError)throw new Error(error||'Falta identificar tu cuenta y galaxia.');
    const next=core.normalizeConfig(value);
    sync(write(key(),next));
    if(manualHold&&!next.enabled)recoveryDisabled=true;
    if(manualHold&&recoveryDisabled&&next.enabled&&!config.enabled&&!move){manualHold=false;recoveryDisabled=false;error='';}
    config=next;epoch++;ready=false;cancelMove();arrivedAt=now();pauseUntil=0;onChange();return copy(config);
  }
  function state(){return copy({scope,config,roster,transitCensus,snapshots:[...snapshots.values()],plan,ready,status,error,moving:!!move,target:move?.id||'',storageError,manualHold,pausedUntil:pauseDeadline(),maxAgeMs});}
  // Bounded display/local-engine policy only. This does not grant authority;
  // every action still requires canAct's fresh source and HUD validation.
  function systemPolicy(systemId){
    const id=typeof systemId==='string'&&UUID.test(systemId)?systemId.toLowerCase():'';
    return copy({role:config.systems[id]?.role||'balanced',
      shipMinimums:plan?.targetsBySystem?.[id]?.shipMinimums||{probe:0,marauder:0,sentinel:0,vanguard:0}});
  }
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
      if(operation.cancelled||move!==operation||operation.token!==epoch||!permitNavigation||!config.enabled||scope!==operation.scope||pauseDeadline()>now())return null;
      const bundled=typeof adapter.readBundle==='function',bundle=bundled?adapter.readBundle():null;
      const freshRoster=validRoster(bundled?bundle?.roster:adapter.readRoster()),active=bundled?bundle?.active:adapter.readActive();
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
    const bundled=typeof adapter.readBundle==='function';let bundle=null;
    if(bundled)try{bundle=adapter.readBundle();}catch{/* Invalid bundle fails closed below. */}
    try{roster=validRoster(bundled?bundle?.roster:adapter.readRoster());}catch{roster=null;}
    if(!roster)return reject(adapter.getStatus?.()||'No se ha podido verificar la lista completa de sistemas propios.');
    const owned=new Set(roster.systems.map(x=>x.id));
    for(const id of snapshots.keys())if(!owned.has(id)){snapshots.delete(id);visited.delete(id);barriers.delete(id);}
    if(bundled||typeof adapter.readSnapshots==='function'){
      const diagnostic={},census=readBatch(roster,bundle,bundled,diagnostic);
      if(!census){snapshots.clear();return reject(diagnostic.waitingForOrder
        ?'Esperando un censo nativo posterior al pedido confirmado; no se enviarán nuevos pedidos.'
        :'El censo imperial no está disponible o es ambiguo.');}
      snapshots.clear();for(const [id,value] of census)snapshots.set(id,value);
    }
    let active;try{active=bundled?bundle?.active:adapter.readActive();}catch{active=null;}
    const id=active?.context?.systemId?.toLowerCase();
    const current=id&&owned.has(id)&&matches(active.context,id)&&acceptable(active.snapshot,id);
    if(current&&(bundled||typeof adapter.readSnapshots==='function')&&JSON.stringify(current)!==JSON.stringify(snapshots.get(id)))return reject('El HUD y el censo imperial no coinciden.');
    if(current){snapshots.set(id,current);if(id!==observedId){observedId=id;arrivedAt=now();visited.set(id,now());}}
    else if(id)snapshots.delete(id);
    let transit;try{transit=bundled?bundle?.transitCensus:adapter.readTransitCensus?.();}catch{transit=null;}
    transitCensus=transit?core.normalizeTransitCensus(transit):null;
    if((bundled||typeof adapter.readTransitCensus==='function')&&!transitCensus)return reject('El censo de flotas en tránsito no está disponible.');
    const expectedIds=roster.systems.map(x=>x.id);
    plan=core.plan(config,[...snapshots.values()],{scope,now:now(),maxAgeMs,expectedIds,activeSystemId:id,transitCensus:transitCensus||undefined});
    if(!config.enabled)return reject('Modo imperio desactivado. Los ajustes habituales siguen vigentes.');
    if(!enabled)return reject('Imperio pausado con el Helper.');
    if(blocked)return reject(blocked);
    if(manualHold)return reject('Recorrido detenido tras una selección sin confirmar. Desactiva y activa el modo para revisar.');
    if(move&&now()-move.at>15000){move.cancelled=true;manualHold=true;return hold(error='El cambio de sistema no respondió. Revisa la selección antes de continuar.');}
    if(move){permitNavigation=!move.cancelled;return hold('Seleccionando el siguiente sistema…');}
    if(pauseUntil>now())return reject('Imperio suspendido. Revisa la pausa antes de continuar.');
    if(interactionUntil>now())return reject('Pausa por interacción: '+Math.ceil((interactionUntil-now())/1000)+' s restantes sin nueva actividad en el juego.');
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
  function checkAction(context,capture=false){
    if(!ready||!config.enabled||move||manualHold||pauseDeadline()>now()||!roster||!plan?.complete)return false;
    try{
      const actionEpoch=epoch;
      if(JSON.stringify(core.normalizeConfig(sync(read(key()))))!==JSON.stringify(config))return false;
      const bundled=typeof adapter.readBundle==='function',bundle=bundled?adapter.readBundle():null;
      const latest=validRoster(bundled?bundle?.roster:adapter.readRoster());
      if(!latest||JSON.stringify(latest.systems.map(x=>x.id).sort())!==JSON.stringify(roster.systems.map(x=>x.id).sort()))return false;
      const id=observedId,active=bundled?bundle?.active:adapter.readActive(),snapshot=acceptable(active?.snapshot,id,latest);
      if(!matches(context,id)||!matches(active?.context,id)||!snapshot||config.systems[id]?.enabled===false||adapter.canNavigate?.()===false)return false;
      const all=readBatch(latest,bundle,bundled);if(!all)return false;
      if((bundled||typeof adapter.readSnapshots==='function')&&JSON.stringify(snapshot)!==JSON.stringify(all.get(id)))return false;
      all.set(id,snapshot);
      const liveTransit=bundled?bundle?.transitCensus:adapter.readTransitCensus?.();
      if((bundled||typeof adapter.readTransitCensus==='function')&&!core.normalizeTransitCensus(liveTransit))return false;
      const fresh=core.plan(config,[...all.values()],{scope,now:now(),maxAgeMs,expectedIds:latest.systems.map(x=>x.id),activeSystemId:id,transitCensus:liveTransit});
      if(!fresh.complete||JSON.stringify(fresh.targetsBySystem)!==JSON.stringify(plan.targetsBySystem))return false;
      if(!capture)return true;
      // Mint only from the SAME freshly validated bundle used by the action
      // preflight, never the possibly older display snapshots. A private token
      // carries the pre-click boundary through confirmation without trusting
      // caller-supplied timestamps or invalidating the confirmation itself.
      const at=now();
      if(actionEpoch!==epoch||!snapshot.censusId||!Number.isSafeInteger(at)||at<0||snapshot.observedAt>at||at-snapshot.observedAt>maxAgeMs)return false;
      const token=Object.freeze(Object.create(null));
      orderBoundaries.set(token,{scope,systemId:id,at,censusId:snapshot.censusId,epoch});
      ready=false;cancelMove();return token;
    }catch{return false;}
  }
  function canAct(context){return checkAction(context)===true;}
  function captureOrderBoundary(context){return checkAction(context,true)||null;}
  function suspend(ms=15000){pauseUntil=now()+Math.max(0,ms);ready=false;epoch++;cancelMove();onChange();}
  // Interaction cannot shorten an independent emergency/explicit suspension.
  // Policy edits retain this deadline so the adapter and runtime stay aligned.
  function suspendInteraction(ms=15000){interactionUntil=Math.max(interactionUntil,now()+Math.max(0,ms));ready=false;epoch++;cancelMove();onChange();}
  function invalidate(systemId,token){
    const boundary=token&&typeof token==='object'?orderBoundaries.get(token):null;
    if(boundary)orderBoundaries.delete(token); // Single use, including invalid targets/scopes.
    if(UUID.test(systemId||'')){
      const id=systemId.toLowerCase(),previous=snapshots.get(id),old=barriers.get(id);
      const valid=boundary&&boundary.scope===scope&&boundary.systemId===id&&boundary.epoch===epoch;
      if(valid){
        // A later barrier already installed for this origin must never move
        // backwards, even if an earlier order confirms after it.
        if(old&&old.at===boundary.at&&old.censusId!==boundary.censusId){
          barriers.set(id,{...old,censusIds:[...new Set([...(old.censusIds||[]),old.censusId,boundary.censusId])].filter(Boolean)});
        }else barriers.set(id,old&&old.at>=boundary.at?old:{at:boundary.at,censusId:boundary.censusId});
      }else{
        // Missing, forged, reused or foreign tokens preserve the conservative
        // existing invalidation behavior, never restoring old authority.
        const at=Math.max(now(),previous?.observedAt||0,old?.at||0);
        barriers.set(id,old&&old.at>=at?old:{...old,at,censusId:previous?.censusId||old?.censusId||null});
      }
      snapshots.delete(id);
    }
    ready=false;cancelMove();
  }
  return {update,state,systemPolicy,setConfig,canAct,captureOrderBoundary,suspend,suspendInteraction,invalidate,importConfig:value=>setConfig({...core.normalizeConfig(value),enabled:false}),exportConfig:()=>copy(config),isEnabled:()=>config.enabled===true,isBusy:()=>!!move};
}
return Object.freeze({create});
});
