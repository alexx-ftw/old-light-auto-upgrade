/* Conquest planning is local intent. Only the native mission adapter may execute an order. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)Object.defineProperty(root,'OldLightConquestCore',{configurable:true,value:api});})(globalThis,function(){
'use strict';
const SHIPS=Object.freeze(['probe','marauder','sentinel','vanguard']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE=/^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,96}$/;
const MAX_AGE=120000,MAX_FLEET=50000,MAX_OBJECTIVES=16,MAX_OBSERVED=1000000;
const fail=message=>{throw Error(message||'Datos de conquista no válidos.');};
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const get=(x,k)=>{const d=x&&Object.getOwnPropertyDescriptor(x,k);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const object=(x,keys)=>plain(x)&&Object.keys(x).every(k=>keys.includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value'))?x:fail();
const integer=(x,max=Number.MAX_SAFE_INTEGER,min=0)=>Number.isSafeInteger(x)&&x>=min&&x<=max?x:fail();
const string=(x,max=200)=>typeof x==='string'&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x)?x:fail();
const id=x=>typeof x==='string'&&UUID.test(x)?x.toLowerCase():fail();
const scope=x=>typeof x==='string'&&SCOPE.test(x)?x:fail('Selecciona una cuenta y galaxia verificadas.');
const copy=x=>JSON.parse(JSON.stringify(x));
const zeros=()=>Object.fromEntries(SHIPS.map(t=>[t,0]));
const samePoint=(a,b)=>a&&b&&a.q===b.q&&a.r===b.r;
const distance=(a,b)=>(Math.abs(a.q-b.q)+Math.abs(a.r-b.r)+Math.abs(a.q+a.r-b.q-b.r))/2;
const point=x=>{object(x,['q','r']);return {q:integer(get(x,'q'),10000000,-10000000),r:integer(get(x,'r'),10000000,-10000000)};};
function fleet(x,combat=false,max=MAX_FLEET){object(x,SHIPS);const out=Object.fromEntries(SHIPS.map(t=>[t,integer(get(x,t)??0,max)]));
 if(combat&&!out.marauder&&!out.sentinel)fail('Indica al menos un Marauder o Sentinel para la incursión.');return out;}
function exactShips(rows){
 if(!Array.isArray(rows)||rows.length>SHIPS.length)return null;
 const out=zeros(),seen=new Set();
 for(const row of rows){const type=get(row,'type'),n=get(row,'quantity');
  if(!SHIPS.includes(type)||seen.has(type)||get(row,'approximate')===true||(get(row,'kind')!==undefined&&get(row,'kind')!=='exact')||!Number.isSafeInteger(n)||n<0||n>MAX_OBSERVED)return null;
  seen.add(type);out[type]=n;
 }
 return out;
}
function parseReport(value,at){
 try{
  const s=scope(get(value,'scope')),item=get(value,'item'),detail=get(value,'detail');
  const reportId=id(get(item,'id'));if(reportId!==id(get(detail,'id')))return null;
  const raw=get(item,'takenAt')??get(detail,'createdAt'),takenAt=integer(typeof raw==='string'?Date.parse(raw):raw);
  if(takenAt>at)return null;
  const route=get(detail,'route'),from=get(route,'from'),to=get(route,'to'),sections=get(detail,'sections'),battle=get(sections,'battle');
  if(get(from,'ownerKind')!=='owned'||!['human','npc','dormant'].includes(get(to,'ownerKind'))||!plain(battle)||get(sections,'incoming')!=null||get(sections,'probe')!=null||get(battle,'targetOwnerKind')==='owned')return null;
  const origin=point({q:get(from,'q'),r:get(from,'r')}),target=point({q:get(to,'q'),r:get(to,'r')});if(samePoint(origin,target))return null;
  const loyalty=get(battle,'loyaltyChange'),captured=get(loyalty,'captured')===true||get(get(detail,'variant'),'kind')==='capture_success';
  const verdict=captured?'Captured':get(item,'verdict');if(!['Victory','Defeat','Draw','Captured'].includes(verdict))return null;
  const defenderBefore=exactShips(get(battle,'defenderShips')),defenderLost=exactShips(get(battle,'defenderLost'));
  let defenderRemaining=null;
  if(defenderBefore&&defenderLost&&SHIPS.every(t=>defenderLost[t]<=defenderBefore[t]))defenderRemaining=Object.fromEntries(SHIPS.map(t=>[t,defenderBefore[t]-defenderLost[t]]));
  const number=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
  return {replenishmentEvidence:'unavailable',scope:s,id:reportId,takenAt,origin,target,verdict,captured,attackerShips:exactShips(get(battle,'attackerShips')),
   attackerLost:exactShips(get(battle,'attackerLost')),defenderBefore,defenderLost,defenderRemaining,
   loyalty:{before:number(get(loyalty,'before')),after:number(get(loyalty,'after')),damage:number(get(loyalty,'damageDealt'))},
   combatDeficit:typeof get(battle,'combatDeficit')==='boolean'?get(battle,'combatDeficit'):null,
   defenderSectorBonusPct:number(get(battle,'defenderSectorBonusPct')),
   ownerName:typeof get(to,'ownerName')==='string'?string(get(to,'ownerName')):null,
   owner:typeof get(to,'ownerId')==='string'&&UUID.test(get(to,'ownerId'))?id(get(to,'ownerId')):null};
 }catch{return null;}
}
function worldFor(value,s,at){
 try{
  if(get(value,'scope')!==s||get(value,'connected')!==true||get(value,'complete')!==true)return null;
  const observedAt=integer(get(value,'observedAt'));if(observedAt>at||at-observedAt>MAX_AGE)return null;
  const rows=get(value,'systems'),transits=get(value,'transits');if(!Array.isArray(rows)||!Array.isArray(transits)||rows.length>10000||transits.length>20000)return null;
  const seen=new Set(),coordinates=new Set(),systems=[];
  for(const raw of rows){const systemId=id(get(raw,'id')),coordinate=point({q:get(raw,'q'),r:get(raw,'r')}),key=coordinate.q+','+coordinate.r;
   if(seen.has(systemId)||coordinates.has(key)||get(raw,'owned')===false)return null;
   seen.add(systemId);coordinates.add(key);const ships=exactShips(get(raw,'fleet'));if(!ships)return null;
   systems.push({id:systemId,...coordinate,name:string(get(raw,'name')??systemId),fleet:ships});
  }
  return {observedAt,systems,transits:transits.map(t=>({to:point({q:get(t,'toQ'),r:get(t,'toR')})}))};
 }catch{return null;}
}
function ownerFor(value,s,target,at){
 try{
  if(!worldFor(value,s,at)||get(value,'selfId')!==s.split('/')[1])return null;
  const epoch=integer(get(value,'epoch'),Number.MAX_SAFE_INTEGER,1),generation=integer(get(value,'generation'),Number.MAX_SAFE_INTEGER,1);
  const ownership=get(value,'ownership'),players=get(ownership,'players');
  if(get(ownership,'version')!==1||!Array.isArray(players)||players.length>10000)return null;
  const ids=new Set(),cells=new Set();let found=null,total=0;
  for(const player of players){const ownerId=id(get(player,'id')),owned=get(player,'owned');if(ids.has(ownerId)||!Array.isArray(owned)||owned.length>10000)return null;ids.add(ownerId);
   for(const raw of owned){if(++total>10000)return null;const cell=point({q:get(raw,'q'),r:get(raw,'r')}),key=cell.q+','+cell.r;if(cells.has(key))return null;cells.add(key);
    if(samePoint(cell,target))found={scope:s,ownerId,ownerName:typeof get(player,'name')==='string'?string(get(player,'name')):'',epoch,generation,observedAt:get(value,'observedAt')};
   }
  }
  return found;
 }catch{return null;}
}
function createOwnerReader({getBridge,now=Date.now}){
 let bridge=null,unsubscribe=null,revision=0,snapshot=null;const cache=new Map();
 const invalidate=()=>{revision++;snapshot=null;cache.clear();};
 function read(s,target){try{
  const current=getBridge();if(current!==bridge){unsubscribe?.();bridge=current;invalidate();unsubscribe=bridge?.subscribe(invalidate)||null;}
  const status=bridge?.status?.();if(!status?.connected||!status.complete)return null;
  const at=now(),key=JSON.stringify([s,target.q,target.r]);
  if(cache.has(key)){const value=cache.get(key);return value&&value.observedAt<=at&&at-value.observedAt<=MAX_AGE?copy(value):null;}
  const generation=revision;if(snapshot===null)snapshot=bridge.snapshot();
  const value=ownerFor(snapshot,s,target,at),after=bridge.status();
  if(revision!==generation||!after?.connected||!after.complete){invalidate();return null;}
  cache.set(key,value);return value?copy(value):null;
 }catch{return null;}}
 return {read,destroy(){unsubscribe?.();bridge=null;unsubscribe=null;invalidate();}};
}
function plan(objectives,world,jobs,s,at){
 const verified=worldFor(world,s,at),result=[];
 const blocked=message=>objectives.map(o=>({id:o.id,ready:false,message,origin:null,transfers:[],reservations:[]}));
 if(!verified)return blocked('Esperando censo propio completo y actual.');
 if(!Array.isArray(jobs)||jobs.length>32)return blocked('Esperando una cola de misiones verificable.');
 const available=new Map(verified.systems.map(system=>[system.id,copy(system.fleet)])),busy=new Set();
 try{for(const job of jobs){if(get(job,'scope')!==s)continue;const origin=id(get(job,'originId')),status=get(job,'status');
  if(!['waiting','paused','sending','sent','uncertain'].includes(status))return blocked('La cola contiene una misión sin estado verificable.');
  if(status==='sent'){const sentAt=integer(get(job,'sentAt'));if(verified.observedAt<=sentAt)busy.add(origin);}
  else{fleet(get(job,'quantities'));busy.add(origin);}
 }}catch{return blocked('No se pueden verificar los compromisos de flota.');}
 // Frozen plans reserve both staging ships and future donor transfers while a ticket settles.
 for(const o of objectives)if(o.ticket&&['planning','awaiting_report','uncertain'].includes(o.status)){
  for(const reservation of o.ticket.reservations||[]){const stock=available.get(reservation.originId);if(stock)for(const t of SHIPS)stock[t]=Math.max(0,stock[t]-reservation.quantities[t]);}
  busy.add(o.ticket.originId);
 }
 for(const o of [...objectives].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))){
  const entry={id:o.id,ready:false,message:'',origin:null,transfers:[],reservations:[]};result.push(entry);
  if(o.status!=='planning'||o.ticket){entry.message=o.message||'Objetivo detenido o misión pendiente.';continue;}
  if(o.barrierAt&&verified.observedAt<=o.barrierAt){entry.message='Esperando censo posterior a la pausa o edición del plan.';continue;}
  if(verified.transits.some(x=>samePoint(x.to,o.target))){entry.message='Ya existe una flota en tránsito al objetivo. Esperando su resultado.';continue;}
  if(verified.systems.some(x=>samePoint(x,o.target))){entry.message='El censo actual confirma propiedad propia.';continue;}
  if(o.raids>=o.maxRaids||SHIPS.reduce((sum,t)=>sum+o.losses[t],0)>=o.maxLosses){entry.message='Límite de incursiones o pérdidas alcanzado.';continue;}
  if(SHIPS.reduce((sum,t)=>sum+o.fleet[t],0)>o.maxLosses-SHIPS.reduce((sum,t)=>sum+o.losses[t],0)){entry.message='La flota supera el presupuesto de pérdidas restante. Revisa el plan antes de otra incursión.';continue;}
  const usable=verified.systems.filter(x=>!busy.has(x.id)).map(x=>({...x,free:Object.fromEntries(SHIPS.map(t=>[t,Math.max(0,available.get(x.id)[t]-o.defense[t])]))}));
  const candidates=[];
  for(const origin of usable){
   const missing=Object.fromEntries(SHIPS.map(t=>[t,Math.max(0,o.fleet[t]-origin.free[t])])),transfers=[];
   for(const donor of usable.filter(x=>x.id!==origin.id).sort((a,b)=>distance(a,origin)-distance(b,origin)||a.id.localeCompare(b.id))){
    const amounts=Object.fromEntries(SHIPS.map(t=>[t,Math.min(donor.free[t],missing[t])]));
    if(SHIPS.some(t=>amounts[t])){transfers.push({originId:donor.id,destinationId:origin.id,originName:donor.name,destinationName:origin.name,from:{q:donor.q,r:donor.r},to:{q:origin.q,r:origin.r},quantities:amounts});for(const t of SHIPS)missing[t]-=amounts[t];}
   }
   if(SHIPS.some(t=>missing[t]))continue;
   const assemblyCost=transfers.reduce((sum,x)=>sum+distance(x.from,origin)*SHIPS.reduce((n,t)=>n+x.quantities[t],0),0);
   candidates.push({origin,transfers,score:distance(origin,o.target)+assemblyCost});
  }
  candidates.sort((a,b)=>Number(a.transfers.length>0)-Number(b.transfers.length>0)||a.score-b.score||a.origin.id.localeCompare(b.origin.id));
  const chosen=candidates[0];if(!chosen){entry.message='Faltan naves libres tras defensas y compromisos; revisa la flota prevista.';continue;}
  entry.origin={id:chosen.origin.id,name:chosen.origin.name,q:chosen.origin.q,r:chosen.origin.r};entry.transfers=chosen.transfers;
  const originAmounts=Object.fromEntries(SHIPS.map(t=>[t,Math.min(o.fleet[t],chosen.origin.free[t])]));
  entry.reservations=[{originId:chosen.origin.id,quantities:originAmounts},...chosen.transfers.map(t=>({originId:t.originId,quantities:t.quantities}))];
  for(const reservation of entry.reservations)for(const t of SHIPS)available.get(reservation.originId)[t]-=reservation.quantities[t];
  const incoming=verified.transits.some(t=>samePoint(t.to,chosen.origin));
  entry.ready=!chosen.transfers.length&&!incoming;
  entry.message=incoming?'Esperando llegada confirmada por censo; no se suman naves en tránsito.':chosen.transfers.length?'Reunir refuerzos primero; después una incursión desde el origen elegido.':'Flota reunida y defensa preservada. Una incursión; reevaluar su reporte.';
 }
 return result;
}
return {SHIPS,MAX_AGE,MAX_FLEET,MAX_OBJECTIVES,MAX_OBSERVED,parseReport,worldFor,ownerFor,createOwnerReader,plan,
 // Shared bounded primitives keep controller storage and pure planning on one contract.
 primitives:{fail,plain,get,object,integer,string,id,scope,copy,zeros,samePoint,point,fleet}};
});
