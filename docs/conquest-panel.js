/* Local conquest UI; never calls game APIs or the mission adapter. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)Object.defineProperty(root,'OldLightConquestPanel',{configurable:true,value:api});})(globalThis,function(){
'use strict';
const SHIPS=['probe','marauder','sentinel','vanguard'];
const LABELS={probe:'Probe',marauder:'Marauder',sentinel:'Sentinel',vanguard:'Vanguard'};
function create({controller,document:doc,onChange=()=>{},confirm=message=>doc.defaultView.confirm(message)}={}){
 let root,form,cards,status,key='',error='',fields,authorized;
 const el=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
 const counts=value=>SHIPS.filter(t=>value?.[t]).map(t=>`${value[t]} ${LABELS[t]}`).join(' · ')||'0';
 function field(parent,caption,value,{min=0,max=50000,type='number',name}={}){
  const label=el('label',undefined,'cq-field'),input=el('input');input.type=type;input.value=String(value);input.name=name||caption;
  if(type==='number'){input.min=String(min);input.max=String(max);input.step='1';input.inputMode='numeric';}
  else input.maxLength=200;
  label.append(el('span',caption),input);parent.append(label);return input;
 }
 function fleetFields(parent,title,initial){const fs=el('fieldset'),legend=el('legend',title),grid=el('div',undefined,'cq-grid'),inputs={};fs.append(legend,grid);parent.append(fs);
  for(const t of SHIPS)inputs[t]=field(grid,LABELS[t],initial[t]||0,{name:title+' '+t});return inputs;}
 function integer(input,min,max){if(!/^-?\d{1,9}$/.test(input.value)||!Number.isSafeInteger(Number(input.value))||Number(input.value)<min||Number(input.value)>max)throw Error('Revisa '+input.name+': escribe un entero entre '+min+' y '+max+'.');return Number(input.value);}
 const values=inputs=>Object.fromEntries(SHIPS.map(t=>[t,integer(inputs[t],0,50000)]));
 function settings(parent,o={}){
  const initial=o.fleet||{marauder:6},defense=o.defense||{marauder:2};
  const fleet=fleetFields(parent,'Flota por incursión',initial),reserve=fleetFields(parent,'Defensa mínima por sistema propio',defense),limits=el('div',undefined,'cq-grid');parent.append(limits);
  const raids=field(limits,'Máximo de incursiones',o.maxRaids||3,{min:1,max:100}),losses=field(limits,'Máximo de naves perdidas',o.maxLosses||20,{min:1,max:200000});
  return ()=>({fleet:values(fleet),defense:values(reserve),maxRaids:integer(raids,1,100),maxLosses:integer(losses,1,200000)});
 }
 function attempt(fn){try{fn();error='';onChange();render();}catch(e){error=String(e.message||'No se pudo actualizar conquista.');if(status){status.textContent=error;status.focus();}}}
 function button(parent,text,action,fn){const node=el('button',text);node.type='button';node.dataset.conquestAction=action;node.addEventListener('click',()=>attempt(fn));parent.append(node);return node;}
 function render(){if(!root)return;
  let objectives=[],plans=[];try{objectives=controller.list();plans=doc.hidden||root.closest('[hidden]')?[]:controller.plans();}catch(e){error=String(e.message);}
  status.textContent=error||controller.diagnostics().error||'Campañas locales a esta cuenta y galaxia. El Helper debe estar activo para preparar misiones.';
  const signature=JSON.stringify([objectives,plans]);if(signature===key)return;
  // Do not replace the authoring form or a paused plan draft during passive refresh.
  if(cards.contains(root.getRootNode().activeElement)&&root.getRootNode().activeElement?.matches('input'))return;key=signature;
  const focused=root.getRootNode().activeElement,focusedId=focused?.closest('[data-conquest-objective]')?.dataset.conquestObjective,action=focused?.dataset.conquestAction;
  cards.replaceChildren();
  for(const o of objectives){
   const card=el('article',undefined,'cq-card');card.dataset.conquestObjective=o.id;
   card.dataset.operationStatus={planning:'waiting',awaiting_report:'waiting',captured:'completed',cancelled:'cancelled',limit:'paused',uncertain:'uncertain',paused:'paused'}[o.status];
   card.dataset.operationAttention=String(['paused','uncertain','limit'].includes(o.status));
   const heading=el('h4',`${o.target.name} (${o.target.q}, ${o.target.r})`);heading.tabIndex=-1;card.append(heading);
   const plan=plans.find(p=>p.id===o.id);card.append(el('p',o.message||plan?.message),el('p',`Incursiones ${o.raids}/${o.maxRaids} · Pérdidas ${SHIPS.reduce((n,t)=>n+o.losses[t],0)}/${o.maxLosses}`));
   card.append(el('p','Flota prevista: '+counts(o.fleet)),el('p','Defensa por sistema: '+counts(o.defense)));
   if(plan?.origin){card.append(el('p','Origen propuesto: '+plan.origin.name+' · '+plan.message));for(const t of plan.transfers)card.append(el('p',`Reunión: ${t.originName} → ${t.destinationName}: ${counts(t.quantities)}`));}
   else if(o.status==='planning'&&plan)card.append(el('p',plan.message));
   if(o.ticket){card.append(el('p',o.ticket.kind==='attack'?'Una incursión pendiente; no se prepara otra hasta su reporte.':'Un refuerzo pendiente; se espera llegada y censo antes de atacar.'));
    card.append(el('p','Reservas de esta reunión: '+o.ticket.reservations.map(r=>counts(r.quantities)).join(' + ')));}
   const report=o.latestReport;if(report){
    const evidence=el('details'),summary=el('summary','Evidencia del último combate');evidence.append(summary);
    evidence.append(el('p',`Resultado observado: ${report.verdict}. ${report.captured?'Captura explícita.':'Una victoria no equivale a captura.'}`));
    evidence.append(el('p','Defensores observados: '+(report.defenderBefore?counts(report.defenderBefore):'desconocidos')),
     el('p','Defensores remanentes calculados del reporte: '+(report.defenderRemaining?counts(report.defenderRemaining):'desconocidos')),
     el('p',report.netReplenishment?(report.replenishmentEvidence==='comparable-reports'?'Cambio neto entre reportes del mismo dueño: ':'Cambio neto estimado; dueño histórico no verificado: ')+SHIPS.map(t=>`${LABELS[t]} ${report.netReplenishment[t]>=0?'+':''}${report.netReplenishment[t]}`).join(' · ')+'. No demuestra fabricación.':'Reposición enemiga: no verificable con dueño o cantidades desconocidos. No se presenta como fabricación observada.'),
     el('p',`Lealtad observada: ${report.loyalty.before??'?'} → ${report.loyalty.after??'?'} · daño ${report.loyalty.damage??'?'}`),
     el('p',`Déficit de combate: ${report.combatDeficit===null?'desconocido':report.combatDeficit?'sí':'no'} · bonificación defensora ${report.defenderSectorBonusPct??'?'}%.`));card.append(evidence);
   }
   const actions=el('div',undefined,'cq-actions');card.append(actions);
   if(['planning','awaiting_report'].includes(o.status))button(actions,'Pausar','pause',()=>controller.pause(o.id));
   if(['paused','limit'].includes(o.status))button(actions,'Reanudar','resume',()=>controller.resume(o.id));
   if(!['captured','cancelled'].includes(o.status))button(actions,'Cancelar','cancel',()=>controller.cancel(o.id));
   if(o.ticket&&['uncertain','cancelled'].includes(o.status))button(actions,'Cerrar tras revisión manual','acknowledge',()=>{if(confirm('Confirma que has comprobado las misiones del juego. Se cerrará este objetivo sin reenviar ni retirar flotas enviadas.'))controller.acknowledge(o.id);});
   if(['captured','cancelled'].includes(o.status))button(actions,'Retirar registro','remove',()=>controller.remove(o.id));
   if(['paused','limit'].includes(o.status)&&!o.ticket){const editor=el('details'),summary=el('summary','Editar plan detenido');editor.append(summary);const read=settings(editor,o);button(editor,'Guardar plan','save-plan',()=>controller.configure(o.id,read()));card.append(editor);}
   cards.append(card);
  }
  if(focusedId){const card=[...cards.children].find(n=>n.dataset.conquestObjective===focusedId);(card?.querySelector(`[data-conquest-action="${action}"]`)||card?.querySelector('h4')||status)?.focus({preventScroll:true});}
 }
 function mount(container){if(root)return;root=el('section',undefined,'cq-root');root.dataset.conquestPlanner='';
  const style=el('style');style.textContent=`.cq-root{margin:12px 0;padding:10px;border:1px solid #456177;border-radius:9px;font-size:12px}.cq-root *{box-sizing:border-box}.cq-root h3,.cq-root h4{margin:4px 0 8px}.cq-root p{line-height:1.5;overflow-wrap:anywhere}.cq-root fieldset{margin:10px 0;padding:8px;min-width:0;border:1px solid #2b4053}.cq-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(120px,100%),1fr));gap:8px}.cq-field{display:grid;gap:4px;min-width:0}.cq-field input{width:100%;min-width:0;padding:6px;min-height:34px;color:var(--ol-text,#e5eef6);background:var(--ol-bg,#0c141d);border:1px solid var(--ol-border-strong,#456177);border-radius:6px}.cq-actions{display:flex;flex-wrap:wrap;gap:6px}.cq-card{padding:10px;margin-top:10px;border:1px solid #2b4053;border-radius:8px}.cq-root button{white-space:normal;max-width:100%;min-height:34px}.cq-authorize{display:flex;align-items:flex-start;gap:6px;margin:10px 0}.cq-authorize input{flex:0 0 auto;margin:3px 0}.cq-root summary{cursor:pointer}.cq-status{outline-offset:3px}`;
  root.append(style,el('h3','Conquista por objetivos'),el('p','Reúne refuerzos en un origen y realiza una incursión por objetivo. Tras cada reporte reevalúa. No se coordinan ataques separados como combate conjunto.'));
  root.append(el('p','Elige la flota inicial: no existe aquí una fórmula verificada que garantice vencer. La flota se ajusta con defensores remanentes exactos y reposición neta comparable; tras derrota añade un Marauder. Es una estimación limitada, no una fórmula de victoria. No se presupone fabricación ni llegada de flotas.'));
  root.append(el('p','Solo se prepara una campaña con propietario ajeno confirmado en el censo nativo actual. Los destinos sin propietario verificable permanecen en espera. Los objetivos y sus autorizaciones se guardan solo en este navegador; no se transfieren mediante Drive ni copias de preferencias.'));
  const details=el('details'),summary=el('summary','Marcar sistema como objetivo');details.append(summary);form=el('form');const target=el('div',undefined,'cq-grid');form.append(target);
  const name=field(target,'Nombre del objetivo','',{type:'text'}),q=field(target,'Coordenada q','',{min:-10000000,max:10000000}),r=field(target,'Coordenada r','',{min:-10000000,max:10000000});fields=settings(form);
  const authorization=el('label',undefined,'cq-authorize');authorized=el('input');authorized.type='checkbox';authorization.append(authorized,el('span','Autorizar las incursiones y refuerzos de esta campaña dentro de estos límites, cuando el Helper esté activo.'));form.append(authorization);
  const submit=el('button','Crear campaña limitada');submit.type='submit';form.append(submit);form.addEventListener('submit',event=>{event.preventDefault();attempt(()=>{if(!authorized.checked)throw Error('Marca la autorización de esta campaña antes de crearla.');if(!confirm('¿Crear esta campaña con la flota, defensas y límites indicados? El Helper podrá preparar sus misiones nativas cuando esté activo.'))return;
   controller.add({target:{q:integer(q,-10000000,10000000),r:integer(r,-10000000,10000000),name:name.value.trim()},...fields()});authorized.checked=false;});});details.append(form);root.append(details);
  status=el('p',undefined,'cq-status');status.tabIndex=-1;status.setAttribute('role','status');cards=el('div');root.append(status,cards);container.prepend(root);render();
 }
 return {mount,render,destroy(){root?.remove();root=null;}};
}
return {create};
});
