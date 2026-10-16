/* Content-world bridge. No GM/Drive storage or credentials cross this boundary. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else Object.defineProperty(root,'OldLightEmpireBridgeFactory',{configurable:true,value:factory()});})(globalThis,function(){
'use strict';
function create({realm=globalThis,document=realm.document,observer,observerSource,addElement,now=Date.now,onChange=()=>{}}){
  let current=null,stopped=false,failed=false,installed=false,reason='awaiting-native-init',lastEpoch=-1,lastRevision=-1,port=null,container=null,ackTimer=null,watcher=null;
  const subscribers=new Set(),channel='oldlight_empire_'+realm.crypto.randomUUID().replace(/-/g,'');
  const eventName='oldlight-empire-bootstrap';
  const pendingAttribute='data-oldlight-empire-pending';
  const stamp=value=>JSON.stringify([value.generation,value.epoch,value.revision,value.connected,value.observedAt]);
  function settled(){try{return !!current&&container?.getAttribute(pendingAttribute)===stamp(current);}catch{return false;}}
  // Presentation-only signal. Never returns a snapshot or an action permit.
  function visualPending(scope,session=null){try{
    if(stopped||failed||!installed||!current||settled()||current.scope!==scope||!current.connected||!current.complete
      ||current.galaxy!==/^\/game\/galaxy\/([A-Za-z0-9_-]{1,64})(?:\/|$)/.exec(realm.location.pathname)?.[1])return false;
    if(session!==null&&session!==JSON.stringify([current.generation,current.epoch]))return false;
    const raw=container?.getAttribute(pendingAttribute);
    if(typeof raw!=='string'||raw.length>200)return false;
    const value=JSON.parse(raw),at=now();
    return Array.isArray(value)&&value.length===5&&value[0]===current.generation&&value[1]===current.epoch
      &&Number.isSafeInteger(value[2])&&value[2]>current.revision&&value[3]===true
      &&Number.isSafeInteger(value[4])&&value[4]>=current.observedAt&&value[4]<=at+1000
      &&current.observedAt<=at&&at-current.observedAt<=120000;
  }catch{return false;}}
  const notify=()=>{for(const fn of subscribers){try{fn();}catch{}}try{onChange();}catch{}};
  function invalidate(message){current=null;reason=message;notify();}
  function cleanupBootstrap(){
    watcher?.disconnect();
    if(ackTimer!==null){realm.clearTimeout(ackTimer);ackTimer=null;}
    container?.removeEventListener(eventName,handshake);container?.remove();
  }
  function fail(message){failed=true;installed=false;cleanupBootstrap();port?.removeEventListener('message',receive);port?.close();port=null;invalidate(message);}
  function receive(event){
    if(stopped||failed)return;
    if(typeof event.data!=='string'||event.data.length>observer.LIMITS.frame){invalidate('invalid-observation');return;}
    let value;try{value=observer.validateSnapshot(event.data);}catch{invalidate('invalid-observation');return;}
    if(!value||value.galaxy!==/^\/game\/galaxy\/([A-Za-z0-9_-]{1,64})(?:\/|$)/.exec(realm.location.pathname)?.[1]
      ||value.observedAt>now()+1000){invalidate('invalid-observation');return;}
    if(value.epoch<lastEpoch||(value.epoch===lastEpoch&&value.revision<lastRevision)){invalidate('out-of-order-observation');return;}
    lastEpoch=value.epoch;lastRevision=value.revision;current=value;reason=value.reason||'';notify();
  }
  function handshake(event){
    // Event propagation is confined to this detached, pre-listened container.
    // The port is never broadcast on window, put in a DOM property, or logged.
    if(stopped||failed||port||event.target!==container||container.isConnected||event.data!==channel||event.ports?.length!==1)return;
    port=event.ports[0];port.addEventListener('message',receive);port.start();installed=true;cleanupBootstrap();
  }
  function inject(){
    if(stopped||failed||installed||container)return;
    if(!['loading','interactive','complete'].includes(document.readyState)){fail('observer-injection-unavailable');return;}
    const parent=document.documentElement||document.head;if(!parent)return;
    container=document.createElement('div');container.hidden=true;container.addEventListener(eventName,handshake);
    // GM_addElement executes static page code, never a privileged closure. Its
    // synchronous return happens AFTER execution, so the listener must already
    // exist. A bounded ACK also tolerates delayed insertion without guessing.
    const textContent=`(()=>{const target=document.currentScript?.parentNode;if(!target||!target.isConnected||!['loading','interactive','complete'].includes(document.readyState))return;target.remove();${observerSource}\nconst api=globalThis.OldLightEmpireObserver;const channel=${JSON.stringify(channel)};\nconst pipe=new MessageChannel();const send=pipe.port1.postMessage.bind(pipe.port1);pipe.port1.start();let ready=false,pending=null,handle=null;\ntry{handle=api.installPageObserver({channel,onPending:value=>{target.removeAttribute(${JSON.stringify(pendingAttribute)});target.setAttribute(${JSON.stringify(pendingAttribute)},JSON.stringify([value.generation,value.epoch,value.revision,value.connected,value.observedAt]));},emit:value=>{const data=JSON.stringify(value.snapshot);if(ready)send(data);else pending=data;}});\ntarget.dispatchEvent(new MessageEvent(${JSON.stringify(eventName)},{data:channel,ports:[pipe.port2],bubbles:false,composed:false}));ready=true;if(pending!==null)send(pending);\n}catch(_){try{handle?.stop();}catch(_){}pipe.port1.close();pipe.port2.close();}})();`;
    try{
      parent.appendChild(container);
      ackTimer=realm.setTimeout(()=>{ackTimer=null;if(!installed&&!stopped)fail('observer-injection-unavailable');},2000);
      addElement(container,'script',{textContent});
    }catch{fail('observer-injection-unavailable');}
  }
  if(typeof addElement!=='function')fail('observer-permission-unavailable');
  else{
    inject();
    if(!container&&!failed){watcher=new realm.MutationObserver(()=>{inject();if(container||failed)watcher.disconnect();});watcher.observe(document,{childList:true,subtree:true});}
  }
  return Object.freeze({
    snapshot({includeOwnership=true}={}){return settled()?JSON.parse(JSON.stringify(includeOwnership?current:{...current,ownership:null})):null;},
    visualPending,
    subscribe(fn){if(typeof fn!=='function')return()=>{};subscribers.add(fn);return()=>subscribers.delete(fn);},
    status:()=>({installed,reason,observed:!!current,connected:settled()&&current.connected===true,
      connectionObserved:!!current&&current.generation>0,complete:settled()&&current.complete===true}),
    stop(){if(stopped)return;stopped=true;cleanupBootstrap();port?.removeEventListener('message',receive);port?.close();current=null;subscribers.clear();},
  });
}
return Object.freeze({create});
});
