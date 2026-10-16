/* Durable conquest objectives. Queueing intent never bypasses native mission confirmation. */
(function(root,factory){const api=factory(root.OldLightConquestCore||(typeof module==='object'&&module.exports?require('./conquest-core.js'):null));
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)Object.defineProperty(root,'OldLightConquestController',{configurable:true,value:api});})(globalThis,function(core){
'use strict';
const {SHIPS}=core,{fail,get,object,integer,string,id,scope,copy,zeros,samePoint,point,fleet}=core.primitives;
const STATES=['planning','paused','awaiting_report','captured','uncertain','limit','cancelled'];
const sync=value=>{if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});fail('El almacenamiento de conquista debe ser síncrono.');}return value;};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function evidence(raw){
 if(raw===null)return null;
 object(raw,['scope','id','takenAt','origin','target','verdict','captured','attackerShips','attackerLost','defenderBefore','defenderLost','defenderRemaining','loyalty','combatDeficit','defenderSectorBonusPct','owner','ownerName','netReplenishment','replenishmentEvidence']);
 const value={scope:scope(get(raw,'scope')),id:id(get(raw,'id')),takenAt:integer(get(raw,'takenAt')),origin:point(get(raw,'origin')),target:point(get(raw,'target')),
  verdict:get(raw,'verdict'),captured:get(raw,'captured')};
 if(!['Victory','Defeat','Draw','Captured'].includes(value.verdict)||typeof value.captured!=='boolean')fail();
 for(const k of ['attackerShips','attackerLost','defenderBefore','defenderLost','defenderRemaining'])value[k]=get(raw,k)===null?null:fleet(get(raw,k),false,core.MAX_OBSERVED);
 const loyalty=get(raw,'loyalty');object(loyalty,['before','after','damage']);value.loyalty={};
 for(const k of ['before','after','damage']){const n=get(loyalty,k);if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)))fail();value.loyalty[k]=n;}
 value.combatDeficit=get(raw,'combatDeficit');if(value.combatDeficit!==null&&typeof value.combatDeficit!=='boolean')fail();
 value.defenderSectorBonusPct=get(raw,'defenderSectorBonusPct');if(value.defenderSectorBonusPct!==null&&(typeof value.defenderSectorBonusPct!=='number'||!Number.isFinite(value.defenderSectorBonusPct)))fail();
 value.owner=get(raw,'owner')===null?null:id(get(raw,'owner'));value.ownerName=get(raw,'ownerName')===null?null:string(get(raw,'ownerName'));value.replenishmentEvidence=get(raw,'replenishmentEvidence');if(!['unavailable','comparable-reports','owner-uncertain','owner-changed'].includes(value.replenishmentEvidence))fail();
 const net=get(raw,'netReplenishment');if(net===null)value.netReplenishment=null;else{object(net,SHIPS);value.netReplenishment=Object.fromEntries(SHIPS.map(t=>[t,integer(get(net,t),core.MAX_OBSERVED,-core.MAX_OBSERVED)]));}
 return value;
}
function ticket(raw,objective){
 if(raw===null)return null;
 object(raw,['id','sequence','kind','originId','originName','origin','destinationId','target','quantities','createdAt','sentAt','state','reservations','proof']);
 const value={id:string(get(raw,'id'),96),sequence:integer(get(raw,'sequence'),1000,1),kind:get(raw,'kind'),originId:id(get(raw,'originId')),
  originName:string(get(raw,'originName'),200),origin:point(get(raw,'origin')),destinationId:get(raw,'destinationId')===null?null:id(get(raw,'destinationId')),
  target:point(get(raw,'target')),quantities:fleet(get(raw,'quantities')),createdAt:integer(get(raw,'createdAt')),sentAt:get(raw,'sentAt')===null?null:integer(get(raw,'sentAt')),state:get(raw,'state')};
 const proof=get(raw,'proof');object(proof,['scope','ownerId','ownerName','epoch','generation','observedAt']);
 value.proof={scope:scope(get(proof,'scope')),ownerId:id(get(proof,'ownerId')),ownerName:string(get(proof,'ownerName')),epoch:integer(get(proof,'epoch')),generation:integer(get(proof,'generation')),observedAt:integer(get(proof,'observedAt'))};if(value.proof.scope!==objective.scope||value.proof.ownerId!==objective.ownerId)fail();
 const reservations=get(raw,'reservations');if(!Array.isArray(reservations)||reservations.length>10000)fail();
 const seen=new Set();value.reservations=reservations.map(r=>{object(r,['originId','quantities']);const originId=id(get(r,'originId'));if(seen.has(originId))fail();seen.add(originId);return {originId,quantities:fleet(get(r,'quantities'))};});
 if(!value.reservations.some(r=>r.originId===value.originId&&SHIPS.every(t=>r.quantities[t]>=value.quantities[t])))fail();
 if(!['attack','transfer'].includes(value.kind)||!['prepared','queued','sent','uncertain'].includes(value.state)||!SHIPS.some(t=>value.quantities[t])||samePoint(value.origin,value.target)||value.id!==`conquest:${objective.id}:${value.sequence}`||value.sequence!==objective.sequence||value.createdAt<objective.createdAt||value.createdAt>objective.updatedAt||value.sentAt!==null&&(value.sentAt<value.createdAt||value.sentAt>objective.updatedAt))fail();
 if(value.kind==='attack'&&(!samePoint(value.target,objective.target)||value.destinationId!==null)||value.kind==='transfer'&&value.destinationId===null)fail();
 return value;
}
function validate(raw){
 object(raw,['schemaVersion','objectives','receipts','tombstones']);if(get(raw,'schemaVersion')!==1)fail('Versión de objetivos de conquista no compatible.');
 const rows=get(raw,'objectives'),receipts=get(raw,'receipts');if(!Array.isArray(rows)||rows.length>core.MAX_OBJECTIVES||!Array.isArray(receipts)||receipts.length>128)fail();
 const ids=new Set(),targets=new Set();
 const objectives=rows.map(raw=>{
  object(raw,['id','scope','target','status','createdAt','updatedAt','fleet','defense','maxRaids','maxLosses','raids','losses','reports','latestReport','sequence','ticket','message','barrierAt','ownerId']);
  const target=get(raw,'target');object(target,['q','r','name']);const value={id:id(get(raw,'id')),scope:scope(get(raw,'scope')),
   target:{...point({q:get(target,'q'),r:get(target,'r')}),name:string(get(target,'name'),200)},status:get(raw,'status'),createdAt:integer(get(raw,'createdAt')),updatedAt:integer(get(raw,'updatedAt')),
   fleet:fleet(get(raw,'fleet'),true),defense:fleet(get(raw,'defense')),maxRaids:integer(get(raw,'maxRaids'),100,1),maxLosses:integer(get(raw,'maxLosses'),200000,1),
   raids:integer(get(raw,'raids'),100),losses:Object.fromEntries(SHIPS.map(t=>[t,integer(get(get(raw,'losses'),t),200000)])),reports:[],latestReport:evidence(get(raw,'latestReport')),sequence:integer(get(raw,'sequence'),1000),message:string(get(raw,'message'),500),barrierAt:integer(get(raw,'barrierAt')??0),ownerId:get(raw,'ownerId')===null?null:id(get(raw,'ownerId'))};
  const key=value.scope+'/'+value.target.q+','+value.target.r;
  if(ids.has(value.id)||targets.has(key)||!STATES.includes(value.status)||value.updatedAt<value.createdAt)fail();ids.add(value.id);targets.add(key);
  const reports=get(raw,'reports');if(!Array.isArray(reports)||reports.length>128)fail();value.reports=reports.map(id);if(new Set(value.reports).size!==value.reports.length)fail();
  if(value.latestReport&&(value.latestReport.scope!==value.scope||!samePoint(value.latestReport.target,value.target)||!value.reports.includes(value.latestReport.id)||value.latestReport.takenAt<value.createdAt||value.latestReport.takenAt>value.updatedAt))fail();
  value.ticket=ticket(get(raw,'ticket'),value);if(value.status==='awaiting_report'&&(!value.ticket||value.ticket.kind!=='attack'||value.ticket.state!=='sent'))fail();
  return value;
 });
 const receiptKeys=new Set();const tombstones=get(raw,'tombstones')??[];if(!Array.isArray(tombstones)||tombstones.length>128)fail();
 const targetsSeen=new Set(),history=tombstones.map(raw=>{object(raw,['scope','target','throughAt']);const value={scope:scope(get(raw,'scope')),target:point(get(raw,'target')),throughAt:integer(get(raw,'throughAt'))};const key=value.scope+'/'+value.target.q+','+value.target.r;if(targetsSeen.has(key))fail();targetsSeen.add(key);return value;});
 return {schemaVersion:1,objectives,tombstones:history,receipts:receipts.map(raw=>{object(raw,['scope','originId','sentAt']);const r={scope:scope(get(raw,'scope')),originId:id(get(raw,'originId')),sentAt:integer(get(raw,'sentAt'))},key=r.scope+'/'+r.originId;if(receiptKeys.has(key))fail();receiptKeys.add(key);return r;})};
}
function create({read,write,getContext,getWorld,getJobs,queue,cancel,cancelPreparing,onChange=()=>{},now=Date.now,newId=()=>crypto.randomUUID(),legacyTargets=()=>[],getTargetOwner,isTargetAllowed}={}){
 if(![read,write,getContext,getWorld,getJobs,queue,cancel,cancelPreparing,onChange,now,newId,legacyTargets,getTargetOwner,isTargetAllowed].every(x=>typeof x==='function'))fail('Faltan adaptadores de conquista.');
 let config={schemaVersion:1,objectives:[],receipts:[]},error='',writeBlocked=false,destroyed=false,running=false;
 const clock=()=>integer(now());
 function load(){if(destroyed)return false;try{const raw=sync(read());config=raw===undefined?{schemaVersion:1,objectives:[],receipts:[]}:validate(raw);if(!writeBlocked&&error.startsWith('No se pueden leer'))error='';return true;}catch{error='No se pueden leer los objetivos de conquista. No se prepararán misiones.';return false;}}
 function save(next){const clean=validate(next);if(JSON.stringify(clean).length>400000)fail('Demasiados datos de conquista.');try{const accepted=sync(write(copy(clean)));if(accepted===false)throw Error('storage rejected write');const observed=validate(sync(read()));if(!equal(observed,clean))throw Error('storage verification failed');config=clean;error='';writeBlocked=false;}catch{writeBlocked=true;error='No se pudo guardar conquista. No se prepararán misiones.';throw Error(error);}onChange();}
 const context=()=>sync(getContext());
 function current(idValue){const s=context()?.scope;return config.objectives.find(o=>o.id===idValue&&o.scope===s);}
 function change(objective,patch){if(Object.keys(patch).every(k=>equal(objective[k],patch[k])))return copy(objective);const at=clock(),next=copy(config);const i=next.objectives.findIndex(o=>o.id===objective.id);if(i<0)fail();next.objectives[i]={...next.objectives[i],...patch,updatedAt:Math.max(at,objective.updatedAt)};save(next);return copy(next.objectives[i]);}
 function jobs(){const value=sync(getJobs());if(!Array.isArray(value)||value.length>32)fail('No se puede verificar la cola actual.');return value;}
 function ownerProof(o){try{const value=sync(getTargetOwner(o.scope,{q:o.target.q,r:o.target.r}));if(!value||value.scope!==o.scope||!value.ownerId||value.ownerId===o.scope.split('/')[1]||clock()-value.observedAt>core.MAX_AGE||value.observedAt>clock()||sync(isTargetAllowed(o))!==true)return null;return copy(value);}catch{return null;}}
 function specFor(o,t){return {scope:o.scope,originId:t.originId,originName:t.originName,
  target:t.kind==='attack'?{mode:'amounts',routeKey:'',presetKey:'',label:o.target.name,coordinate:copy(t.target),originCoordinate:copy(t.origin)}:
   {mode:'custom',missionAction:'send',routeKey:'',presetKey:'conquest-transfer',label:'Reunión de conquista',coordinate:copy(t.target)},
  quantities:copy(t.quantities),produce:false,autoSend:true};}
 function matches(o,t,job){if(!job||job.id!==t.id||job.campaignId!=='conquest:'+o.id)return false;
  const spec=specFor(o,t);
  return ['scope','originId','originName','produce','autoSend'].every(k=>job[k]===spec[k])&&SHIPS.every(type=>job.quantities?.[type]===spec.quantities[type])&&
   ['mode','routeKey','presetKey','label','missionAction'].every(k=>job.target?.[k]===spec.target[k])&&samePoint(job.target?.coordinate,spec.target.coordinate)&&
   (spec.target.originCoordinate?samePoint(job.target?.originCoordinate,spec.target.originCoordinate):job.target?.originCoordinate===undefined);
 }
 function verifiedWorld(s){return core.worldFor(sync(getWorld()),s,clock());}
 function list(){if(!load()||!config.objectives.length)return [];const s=context()?.scope;return copy(config.objectives.filter(o=>o.scope===s));}
 function plans(){if(!load()||!config.objectives.length)return [];const c=context(),s=c?.scope;if(!s||!config.objectives.some(o=>o.scope===s))return [];const raw=sync(getWorld());
  // A receipt survives queue replacement until a strictly later own census.
  const pending=jobs(),w=core.worldFor(raw,s,clock());
  for(const r of config.receipts)if(r.scope===s&&(!w||w.observedAt<=r.sentAt)&&!pending.some(j=>j.scope===s&&j.originId===r.originId))pending.push({scope:s,originId:r.originId,status:'sent',sentAt:r.sentAt});
  return core.plan(config.objectives.filter(o=>o.scope===s),raw,pending,s,clock()).map(p=>{const o=config.objectives.find(o=>o.id===p.id);if(o.status==='planning'&&!o.ticket){const proof=ownerProof(o);if(!proof||o.ownerId&&o.ownerId!==proof.ownerId)return {...p,ready:false,origin:null,transfers:[],reservations:[],message:'Propietario del objetivo no verificable, protegido o cambiado. Revisa el mapa y la campaña.'};}return p;});
 }
 function add(input){if(!load())fail(error);const c=context(),s=scope(c?.scope);object(input,['target','fleet','defense','maxRaids','maxLosses']);
  const t=get(input,'target');object(t,['q','r','name']);const target={...point({q:get(t,'q'),r:get(t,'r')}),name:string(get(t,'name'),200)};if(!target.name.trim())fail('Indica el nombre del objetivo.');
  if(jobs().some(j=>j.scope===s&&j.status!=='sent'&&samePoint(j.target?.coordinate,target)))fail('Ya existe una misión pendiente para ese objetivo. Revísala antes de crear una campaña.');
  if(config.objectives.some(o=>o.scope===s&&samePoint(o.target,target)))fail('Ya existe un objetivo para esas coordenadas, incluso si está detenido.');
  if(sync(legacyTargets()).some(o=>o.scope===s&&samePoint(o.targetCoordinate,target)&&!['completed','cancelled','limit'].includes(o.status)))fail('Cancela primero la campaña de reintentos existente para ese destino.');
  const w=verifiedWorld(s);if(w?.systems.some(x=>samePoint(x,target)))fail('El objetivo ya es propio.');
  const at=clock(),o={id:id(newId()),scope:s,target,status:'planning',createdAt:at,updatedAt:at,fleet:fleet(get(input,'fleet'),true),defense:fleet(get(input,'defense')),
   maxRaids:integer(get(input,'maxRaids'),100,1),maxLosses:integer(get(input,'maxLosses'),200000,1),raids:0,losses:zeros(),reports:[],latestReport:null,sequence:0,ticket:null,barrierAt:0,ownerId:null,message:'Objetivo creado. Revisando disponibilidad y reunión previa.'};
  save({...config,objectives:[...config.objectives,o]});return copy(o);
 }
 function stop(idValue,status,message){if(!load())fail(error);const o=current(idValue);if(!o)fail('No se encuentra el objetivo en esta cuenta.');
  const next=change(o,{status,message,barrierAt:clock()});if(next.ticket&&next.ticket.state!=='sent'){sync(cancelPreparing(next.ticket.id,message));const j=jobs().find(x=>x.id===next.ticket.id);if(matches(next,next.ticket,j)&&['waiting','paused'].includes(j.status)){sync(cancel(j.id));return change(next,{ticket:null});}if(!j&&next.ticket.state==='prepared')return change(next,{ticket:null});}return next;
 }
 const pause=idValue=>stop(idValue,'paused','Conquista pausada. No se retiran flotas ya enviadas.');
 const cancelObjective=idValue=>stop(idValue,'cancelled','Conquista cancelada. No se retiran flotas ya enviadas.');
 function resume(idValue){if(!load())fail(error);let o=current(idValue);if(!o||!['paused','limit'].includes(o.status))fail('Este objetivo no se puede reanudar.');
  if(o.ticket){const j=jobs().find(j=>j.id===o.ticket.id);
   if(j&&!matches(o,o.ticket,j))fail('La misión ya no coincide con el objetivo. Revisión necesaria.');
   if(j?.status==='sent'&&o.ticket.state!=='sent'){
    if(!Number.isSafeInteger(j.sentAt)||j.sentAt<o.ticket.createdAt||j.sentAt>clock())fail('La fecha de envío no se puede verificar.');
    recordSent(o,o.ticket,j.sentAt);o=current(idValue);
   }
   if(!j&&['queued','uncertain'].includes(o.ticket.state)){stop(o.id,'uncertain','La misión guardada desapareció. Comprueba los envíos antes de cerrar la revisión; no se repetirá.');fail('Revisa primero el envío pendiente o incierto.');}
  }
  if(o.ticket?.state==='sent')return change(o,o.ticket.kind==='attack'?{status:'awaiting_report',message:'Esperando el reporte de la incursión ya enviada.'}:{status:'planning',message:'Refuerzo ya enviado. Esperando llegada y censo confirmado antes de continuar.'});
  if(o.ticket){const j=jobs().find(j=>j.id===o.ticket.id);if(j&&['sending','uncertain'].includes(j.status))fail('Revisa primero el envío pendiente o incierto.');}
  return change(o,{status:'planning',ticket:null,barrierAt:clock(),message:'Revisando el plan con datos actuales.'});
 }
 function configure(idValue,patch){
  if(!load())fail(error);const o=current(idValue);if(!o||!['paused','limit'].includes(o.status))fail('Pausa primero el objetivo para editar su plan.');
  if(o.ticket?.state==='sent'||jobs().some(j=>j.id===o.ticket?.id&&['sending','uncertain'].includes(j.status)))fail('Espera al resultado de la misión antes de modificar el plan.');
  object(patch,['fleet','defense','maxRaids','maxLosses']);
  return change(o,{fleet:fleet(get(patch,'fleet'),true),defense:fleet(get(patch,'defense')),maxRaids:integer(get(patch,'maxRaids'),100,1),maxLosses:integer(get(patch,'maxLosses'),200000,1),ticket:null,barrierAt:clock(),message:'Plan modificado. Reanuda para revisarlo con datos actuales.'});
 }
 function acknowledge(idValue){
  if(!load())fail(error);const o=current(idValue);if(!o||!['uncertain','cancelled'].includes(o.status)||!o.ticket)fail('No hay un envío incierto pendiente de revisión.');
  const j=jobs().find(j=>j.id===o.ticket.id);if(o.ticket.kind==='attack'&&(o.ticket.state==='sent'||j?.status==='sent'))fail('Espera el reporte de la incursión enviada antes de cerrar su registro.');if(j?.status==='sending')fail('Espera a que termine la preparación nativa.');
  if(!verifiedWorld(o.scope))fail('Espera un censo propio fresco antes de cerrar la revisión.');
  stop(o.id,'cancelled','Cierre solicitado tras revisión manual. No se reenviará.');
  if(j){if(!matches(o,o.ticket,j))fail('La misión ya no coincide con el objetivo.');sync(cancelPreparing(j.id,'Cierre manual tras revisión.'));sync(cancel(j.id));}
  if(!load())fail(error);const next=copy(config),n=next.objectives.find(x=>x.id===o.id);n.ticket=null;n.updatedAt=clock();
  const r=next.receipts.find(r=>r.scope===o.scope&&r.originId===o.ticket.originId);if(r)r.sentAt=Math.max(r.sentAt,clock());else next.receipts.push({scope:o.scope,originId:o.ticket.originId,sentAt:clock()});
  save(next);return copy(n);
 }
 function remove(idValue){if(!load())fail(error);const o=current(idValue);if(!o||!['cancelled','captured'].includes(o.status)||o.ticket?.state==='uncertain')fail('Cancela o confirma la captura antes de retirar el objetivo.');
  if(o.ticket?.kind==='attack'&&(o.ticket.state==='sent'||jobs().some(j=>j.id===o.ticket.id&&j.status==='sent')))fail('Espera el reporte de la incursión enviada antes de retirar su registro.');
  if(o.ticket&&jobs().some(j=>j.id===o.ticket.id&&['waiting','paused','sending','uncertain'].includes(j.status)))fail('La misión aún necesita revisión.');const tombstones=copy(config.tombstones||[]),old=tombstones.find(t=>t.scope===o.scope&&samePoint(t.target,o.target));if(old)old.throughAt=clock();else tombstones.push({scope:o.scope,target:{q:o.target.q,r:o.target.r},throughAt:clock()});save({...config,tombstones,objectives:config.objectives.filter(x=>x.id!==o.id)});
 }
 function observeReport(value){if(!load())return true;const at=clock(),report=core.parseReport(value,at);
  if(!report){
   const target=get(get(get(value,'detail'),'route'),'to'),s=get(value,'scope');
   const known=s===context()?.scope&&config.objectives.find(o=>o.scope===s&&samePoint(o.target,target));
   if(known){const raw=get(get(value,'item'),'takenAt')??get(get(value,'detail'),'createdAt'),date=typeof raw==='string'?Date.parse(raw):raw;if(Number.isSafeInteger(date)&&date<known.createdAt)return true;}
   if(known){if(!['captured','cancelled'].includes(known.status))stop(known.id,'paused','Un reporte del objetivo no se puede verificar. Revisión necesaria.');return true;}
   return s===context()?.scope&&(config.tombstones||[]).some(t=>t.scope===s&&samePoint(t.target,target));
  }
  if(report.scope!==context()?.scope)return false;
  let o=config.objectives.find(o=>o.scope===report.scope&&samePoint(o.target,report.target));if(!o)return (config.tombstones||[]).some(t=>t.scope===report.scope&&samePoint(t.target,report.target));
  if(o.ticket&&o.ticket.state!=='sent'){
   const queued=jobs().find(j=>j.id===o.ticket.id);
   if(matches(o,o.ticket,queued)&&queued.status==='sent'&&Number.isSafeInteger(queued.sentAt)&&queued.sentAt>=o.ticket.createdAt&&queued.sentAt<=at){recordSent(o,o.ticket,queued.sentAt);o=config.objectives.find(x=>x.id===o.id);}
   else if(queued&&['sending','uncertain'].includes(queued.status)){stop(o.id,'uncertain','Hay un combate nuevo durante un envío sin confirmar. Revisión necesaria.');return true;}
  }
  // Managed targets never seed a second legacy retry, even while paused.
  if(o.reports.includes(report.id)||report.takenAt<o.createdAt)return true;
  if(o.latestReport&&report.takenAt<=o.latestReport.takenAt){stop(o.id,'paused','Informe nuevo fuera de orden o ambiguo. Revisión necesaria.');return true;}
  if(report.captured){
   report.netReplenishment=null;
   const losses=copy(o.losses);if(o.ticket?.kind==='attack'&&o.ticket.state==='sent'&&samePoint(o.ticket.origin,report.origin)&&report.attackerShips&&equal(report.attackerShips,o.ticket.quantities)&&report.attackerLost&&SHIPS.every(t=>report.attackerLost[t]<=report.attackerShips[t]))for(const t of SHIPS)losses[t]=integer(losses[t]+report.attackerLost[t],200000);
   const captured=change(o,{losses,latestReport:report,reports:[...o.reports,report.id],message:'Captura explícita confirmada. Campaña terminada.'});
   const ended=stop(captured.id,'captured','Captura explícita confirmada. Campaña terminada.');if(ended.ticket?.kind==='attack'&&ended.ticket.state==='sent'&&samePoint(ended.ticket.origin,report.origin)&&report.takenAt>=ended.ticket.sentAt)change(ended,{ticket:null});return true;
  }
  if(o.status==='captured'){if(!report.captured&&report.takenAt>(o.latestReport?.takenAt??o.updatedAt))stop(o.id,'paused','Un reporte posterior contradice la captura. Revisa la propiedad.');return true;}
  if(!o.ticket||o.ticket.kind!=='attack'||o.ticket.state!=='sent'||report.takenAt<o.ticket.sentAt||!samePoint(report.origin,o.ticket.origin)){
   if(['planning','awaiting_report'].includes(o.status)&&report.takenAt>=(o.latestReport?.takenAt??o.createdAt))stop(o.id,'paused','Otro combate del objetivo invalida el plan. Revisa sus pérdidas y propietario.');return true;
  }
  if(!report.attackerShips||!equal(report.attackerShips,o.ticket.quantities)||report.attackerLost&&SHIPS.some(t=>report.attackerLost[t]>report.attackerShips[t])){stop(o.id,'paused','La flota del reporte no coincide con la incursión pendiente. Revisión necesaria.');return true;}

  if(o.latestReport&&report.takenAt<=o.latestReport.takenAt){stop(o.id,'paused','Informe fuera de orden. Revisa pérdidas y propiedad antes de continuar.');return true;}
  if(o.reports.length>=128){stop(o.id,'paused','El historial de evidencia está lleno. Revisión necesaria.');return true;}
  const losses=copy(o.losses);if(!report.attackerLost&&!report.captured){stop(o.id,'paused','El reporte no contiene pérdidas exactas. No se estiman para autorizar otra incursión.');return true;}
  if(report.attackerLost)for(const t of SHIPS)losses[t]=integer(losses[t]+report.attackerLost[t],200000);
  if(!report.defenderRemaining){stop(o.id,'paused','El reporte no permite verificar defensores remanentes. Revisión necesaria antes de otra incursión.');return true;}
  const previous=o.latestReport;
  const differentOwners=previous?.owner&&report.owner&&previous.owner!==report.owner;
  report.netReplenishment=previous?.defenderRemaining&&report.defenderBefore&&!differentOwners?
   Object.fromEntries(SHIPS.map(t=>[t,report.defenderBefore[t]-previous.defenderRemaining[t]])):null;
  report.replenishmentEvidence=differentOwners?'owner-changed':report.netReplenishment?
   previous.owner&&report.owner&&previous.owner===report.owner?'comparable-reports':'owner-uncertain':'unavailable';
  let status=report.captured?'captured':['paused','cancelled','uncertain'].includes(o.status)?o.status:'planning';
  let message=report.captured?'Captura explícita confirmada. Campaña terminada.':report.verdict==='Victory'?'Victoria sin captura: el objetivo sigue abierto. Reevaluando otra incursión.':'Combate observado. Reevaluando una sola incursión.';
  const nextFleet=copy(o.fleet);
  // A bounded sizing heuristic, never a claim about the server's combat formula.
  for(const t of ['marauder','sentinel'])nextFleet[t]=Math.max(nextFleet[t],Math.min(core.MAX_FLEET,report.defenderRemaining[t]+Math.max(0,report.netReplenishment?.[t]||0)));
  if(report.verdict==='Defeat')nextFleet.marauder=Math.min(core.MAX_FLEET,nextFleet.marauder+1);
  const remainingBudget=o.maxLosses-SHIPS.reduce((sum,t)=>sum+losses[t],0);
  const ownerChanged=report.owner&&o.ownerId&&report.owner!==o.ownerId||previous?.owner&&report.owner&&previous.owner!==report.owner||!report.owner&&report.ownerName&&o.ticket.proof.ownerName&&report.ownerName.normalize('NFKC').trim()!==o.ticket.proof.ownerName.normalize('NFKC').trim();

  if(status==='planning'&&(o.raids>=o.maxRaids||SHIPS.reduce((sum,t)=>sum+nextFleet[t],0)>remainingBudget||ownerChanged||report.combatDeficit===true)){
   status=report.combatDeficit||ownerChanged?'paused':'limit';message=ownerChanged?'El dueño del objetivo cambió entre reportes. Revisión necesaria.':report.combatDeficit?'El combate indica déficit de créditos. Revisión necesaria.':'La siguiente flota supera el presupuesto de pérdidas o el límite de incursiones.';
  }
  change(o,{status,message,fleet:nextFleet,losses,reports:[...o.reports,report.id],latestReport:report,ticket:null});return true;
 }
 function fleetPermission(job){
  if(!job||!config.objectives.length)return true;
  const c=context(),active=config.objectives.filter(o=>o.scope===c?.scope&&['planning','awaiting_report','uncertain'].includes(o.status));
  if(!active.length)return true;
  if(active.some(o=>samePoint(o.target,job.target?.coordinate)&&job.campaignId!=='conquest:'+o.id))return false;
  if(job.scope!==c.scope)return false;
  const w=verifiedWorld(c.scope),origin=w?.systems.find(s=>s.id===job.originId);if(!origin)return false;
  let requested;try{requested=fleet(job.quantities);}catch{return false;}
  const reserved=zeros(),defense=zeros();
  for(const o of active){for(const t of SHIPS)defense[t]=Math.max(defense[t],o.defense[t]);
   if(job.campaignId==='conquest:'+o.id)continue;
   for(const r of o.ticket?.reservations||[])if(r.originId===origin.id)for(const t of SHIPS)reserved[t]+=r.quantities[t];
  }
  if(config.receipts.some(r=>r.scope===c.scope&&r.originId===origin.id&&w.observedAt<=r.sentAt))return false;
  return SHIPS.every(t=>origin.fleet[t]>=requested[t]+reserved[t]+defense[t]);
 }
 function canUseFleet(job){return load()&&!writeBlocked&&fleetPermission(job);}
 function recoverReports(batch){
  object(batch,['scope','reports']);const s=scope(get(batch,'scope')),rows=get(batch,'reports');
  if(!Array.isArray(rows)||rows.length>20||s!==context()?.scope)fail('Recuperación de conquista no válida.');
  const managed=[];
  const entries=rows.map(entry=>({scope:s,item:get(entry,'item'),detail:get(entry,'detail')}));
  entries.sort((a,b)=>(core.parseReport(a,clock())?.takenAt??0)-(core.parseReport(b,clock())?.takenAt??0));
  for(const entry of entries)if(observeReport(entry))managed.push(get(entry.item,'id'));
  return managed;
 }
 function permitJob(job,prepared=false){if(!load()||!config.objectives.length||writeBlocked&&!prepared)return false;const c=context(),o=config.objectives.find(o=>o.scope===c?.scope&&o.id===job?.campaignId?.slice(9));
  if(!fleetPermission(job)||!o||o.status!=='planning'||!o.ticket||!(prepared?['prepared','queued']:['queued']).includes(o.ticket.state)||!matches(o,o.ticket,job))return false;
  const proof=ownerProof(o);if(!proof||proof.ownerId!==o.ownerId||proof.epoch!==o.ticket.proof.epoch||proof.generation!==o.ticket.proof.generation)return false;
  const w=verifiedWorld(o.scope),t=o.ticket;if(!w||o.barrierAt&&w.observedAt<=o.barrierAt||w.systems.some(x=>samePoint(x,o.target)))return false;
  const origin=w.systems.find(x=>x.id===t.originId);if(!origin||!samePoint(origin,t.origin)||SHIPS.some(type=>origin.fleet[type]-o.defense[type]<t.quantities[type]))return false;
  if(t.kind==='transfer'&&!w.systems.some(x=>x.id===t.destinationId&&samePoint(x,t.target)))return false;
  if(t.kind==='attack'&&(SHIPS.reduce((sum,type)=>sum+t.quantities[type],0)>o.maxLosses-SHIPS.reduce((sum,type)=>sum+o.losses[type],0)||o.raids>=o.maxRaids||SHIPS.reduce((sum,type)=>sum+o.losses[type],0)>=o.maxLosses||w.transits.some(x=>samePoint(x.to,origin)||samePoint(x.to,o.target))))return false;
  return true;
 }
 function canRunJob(job){return permitJob(job);}
 function recordSent(o,t,sentAt){const next=copy(config),n=next.objectives.find(x=>x.id===o.id);n.updatedAt=clock();n.ticket={...t,state:'sent',sentAt};
  n.status=t.kind==='attack'&&o.status==='planning'?'awaiting_report':o.status;n.raids+=t.kind==='attack'?1:0;n.message=t.kind==='attack'?'Incursión enviada. Esperando su reporte antes de otra.':'Refuerzo enviado. Esperando llegada y censo confirmado.';
  const r=next.receipts.find(r=>r.scope===o.scope&&r.originId===t.originId);if(r)r.sentAt=Math.max(r.sentAt,sentAt);else next.receipts.push({scope:o.scope,originId:t.originId,sentAt});save(next);
 }
 function tick(){if(destroyed||running||!load()||!config.objectives.length&&!config.receipts.length)return false;running=true;
  try{
   const c=context(),s=c?.scope,w=s?verifiedWorld(s):null;if(!s)return false;
   if(w){const kept=config.receipts.filter(r=>r.scope!==s||w.observedAt<=r.sentAt);if(kept.length!==config.receipts.length){save({...config,receipts:kept});return true;}}
   for(const o of config.objectives.filter(x=>x.scope===s)){
    if(o.status==='captured'&&w&&w.observedAt>o.updatedAt&&!w.systems.some(x=>samePoint(x,o.target))){stop(o.id,'paused','El censo posterior no confirma la propiedad capturada. Revisión necesaria.');return true;}
    if(w?.systems.some(x=>samePoint(x,o.target))&&!['captured','cancelled'].includes(o.status)){stop(o.id,'captured','El censo propio fresco confirma la captura.');return true;}
    if(['planning','awaiting_report'].includes(o.status)&&o.ownerId){const proof=ownerProof(o);if(!proof||proof.ownerId!==o.ownerId||o.ticket&&['prepared','queued'].includes(o.ticket.state)&&(proof.epoch!==o.ticket.proof.epoch||proof.generation!==o.ticket.proof.generation)){stop(o.id,'paused','Propiedad, protección o sesión del objetivo cambiadas o sin verificar. Revisión necesaria.');return true;}}
    const t=o.ticket;if(!t)continue;
    const job=jobs().find(x=>x.id===t.id);
    if(job&&!matches(o,t,job)){stop(o.id,'uncertain','La misión no coincide con el claim guardado. Revisión necesaria.');return true;}
    if(job?.status==='uncertain'||job?.needsReview){if(o.status==='uncertain')continue;stop(o.id,'uncertain','Envío incierto: comprueba las misiones. No se repetirá automáticamente.');return true;}
    if(job?.status==='sending')return false;
    if(job?.status==='paused'&&o.status==='planning'){stop(o.id,'paused','La misión se ha pausado. Revisa la campaña antes de reanudar.');return true;}
    if(job?.status==='sent'&&t.state!=='sent'){
     if(!Number.isSafeInteger(job.sentAt)||job.sentAt<t.createdAt||job.sentAt>clock()){stop(o.id,'uncertain','La fecha de envío no se puede verificar.');return true;}
     recordSent(o,t,job.sentAt);return true;
    }
    if(t.state==='sent'){
     if(t.kind==='transfer'&&w&&w.observedAt>t.sentAt&&!w.transits.some(x=>samePoint(x.to,t.target))){change(o,{ticket:null,message:'Tránsito finalizado; recalculando solo con flota estacionada observada.'});return true;}
     continue;
    }
    if(o.status!=='planning'){if(job&&['waiting','paused'].includes(job.status)){sync(cancelPreparing(job.id,o.message));sync(cancel(job.id));}continue;}
    if(!c.canAct)continue;
    if(job&&t.state==='prepared'&&permitJob(job,true)){change(o,{ticket:{...t,state:'queued'}});return true;}
    if(!job&&t.state==='queued'){stop(o.id,'uncertain','La misión guardada desapareció de la cola. Comprueba los envíos antes de cerrar la revisión; no se repetirá.');return true;}
    if(!job){if(!permitJob({id:t.id,campaignId:'conquest:'+o.id,...specFor(o,t)},true))continue;sync(queue(specFor(o,t),{id:t.id,campaignId:'conquest:'+o.id}));change(o,{ticket:{...t,state:'queued'}});return true;}
   }
   if(!c.canAct)return false;
   const options=plans();
   for(const o of config.objectives.filter(x=>x.scope===s&&x.status==='planning'&&!x.ticket)){
    const p=options.find(x=>x.id===o.id);if(!p?.origin)continue;
    if(w?.transits.some(x=>samePoint(x.to,p.origin)))continue;
    const transfer=p.transfers[0];if(!p.ready&&!transfer)continue;
    const proof=ownerProof(o);if(!proof)continue;
    const sequence=o.sequence+1,source=transfer?{id:transfer.originId,name:transfer.originName,...transfer.from}:p.origin;
    const ticket={id:`conquest:${o.id}:${sequence}`,sequence,kind:transfer?'transfer':'attack',originId:source.id,originName:source.name,
     origin:{q:source.q,r:source.r},destinationId:transfer?transfer.destinationId:null,target:transfer?copy(transfer.to):{q:o.target.q,r:o.target.r},
     quantities:transfer?copy(transfer.quantities):copy(o.fleet),reservations:copy(p.reservations),proof,createdAt:clock(),sentAt:null,state:'prepared'};
    change(o,{sequence,ticket,ownerId:proof.ownerId,message:transfer?'Reunión previa preparada.':'Una incursión preparada; requiere guardas nativas vigentes.'});
    return true;
   }
   return false;
  }catch(e){error='Conquista detenida: '+String(e.message||'revisión necesaria').slice(0,200);return false;}
  finally{running=false;}
 }
 function dueOrigins(){if(!load()||!config.objectives.length)return [];const c=context();return config.objectives.filter(o=>o.scope===c?.scope&&o.status==='planning'&&o.ticket?.state==='queued').filter(o=>{const j=jobs().find(x=>x.id===o.ticket.id);return j?.status==='waiting'&&canRunJob(j);}).map(o=>o.ticket.originId);}
 return {add,list,plans,tick,observeReport,recoverReports,pause,resume,cancel:cancelObjective,configure,acknowledge,remove,canRunJob,canUseFleet,dueOrigins,
  navigationList:()=>list().map(o=>({...o,originId:o.ticket?.originId,paused:o.status!=='planning'})),
  exportConfig:()=>load()?copy(config):fail(error),validateConfig:validate,
  observationSince:()=>list().filter(o=>!['captured','cancelled'].includes(o.status)).reduce((n,o)=>n===null?o.createdAt:Math.min(n,o.createdAt),null),
  hasObjectives:()=>list().some(o=>['planning','awaiting_report'].includes(o.status)),isBusy:()=>running,
  diagnostics:()=>({error,running,writeBlocked}),destroy:()=>{destroyed=true;}};
}
return {create,validate};
});
