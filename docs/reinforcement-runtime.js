/* Local navigation owner for reinforcement routes; uses only the verified native selector. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.OldLightReinforcementRuntime=factory();})(globalThis,function(){
'use strict';
function create({core,adapter,getContext,isEmpireEnabled=()=>false,onChange=()=>{},now=Date.now}) {
  let operation=null,epoch=0,until=0,error='';
  function cancel(){epoch++;if(operation)operation.cancelled=true;}
  function enabled(){const c=getContext();return !!(c?.coordinated&&c.canNavigate&&c.scope&&!isEmpireEnabled());}
  function tick(){
    if(operation)return true;
    if(!enabled()||now()<until)return false;
    const c=getContext(),ids=core.dueOrigins();
    if(ids.includes(c.originId))return false;
    const target=ids[0];if(!target||adapter.canNavigate()===false)return false;
    const route=core.list().find(r=>r.originId===target&&!r.paused),signature=JSON.stringify(route);
    if(!route)return false;
    const op={epoch,scope:c.scope,target,cancelled:false};operation=op;error='';
    const isCurrent=()=>operation===op&&!op.cancelled&&epoch===op.epoch&&enabled()
      &&getContext().scope===op.scope&&JSON.stringify(core.list().find(r=>r.id===route.id))===signature
      &&core.dueOrigins().includes(target);
    Promise.resolve().then(()=>isCurrent()?adapter.selectSystem(target,{scope:op.scope,isCurrent}):false)
      .then(result=>{if(result!==true&&isCurrent()){core.pause(route.id);error='No se confirmó el origen. Revisa la ruta antes de reanudarla.';}})
      .catch(()=>{if(isCurrent()){try{core.pause(route.id);}catch{}error='No se pudo confirmar el origen de la ruta.';}})
      .finally(()=>{if(operation===op)operation=null;until=now()+1500;onChange();});
    return true;
  }
  return {tick,cancel,isBusy:()=>!!operation,status:()=>error|| (operation?'Seleccionando origen de refuerzos…':'')};
}
return {create};
});
