/* Content-world bridge. No GM/Drive storage or credentials cross this boundary. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else Object.defineProperty(root,'OldLightEmpireBridgeFactory',{configurable:true,value:factory()});})(globalThis,function(){
'use strict';
function create({realm=globalThis,document=realm.document,observer,observerSource,now=Date.now,onChange=()=>{}}){
  let current=null,stopped=false,installed=false,reason='awaiting-native-init',lastEpoch=-1,lastRevision=-1,port=null,script=null;
  const subscribers=new Set(),channel='oldlight_empire_'+realm.crypto.randomUUID().replace(/-/g,'');
  const eventName='oldlight-empire-bootstrap';
  const notify=()=>{for(const fn of subscribers){try{fn();}catch{}}try{onChange();}catch{}};
  function invalidate(message){current=null;reason=message;notify();}
  function receive(event){
    if(stopped)return;
    if(typeof event.data!=='string'||event.data.length>observer.LIMITS.frame){invalidate('invalid-observation');return;}
    let value;try{value=observer.validateSnapshot(event.data);}catch{invalidate('invalid-observation');return;}
    if(!value||value.galaxy!==/^\/game\/galaxy\/([A-Za-z0-9_-]{1,64})(?:\/|$)/.exec(realm.location.pathname)?.[1]
      ||value.observedAt>now()+1000){invalidate('invalid-observation');return;}
    if(value.epoch<lastEpoch||(value.epoch===lastEpoch&&value.revision<lastRevision)){invalidate('out-of-order-observation');return;}
    lastEpoch=value.epoch;lastRevision=value.revision;current=value;reason=value.reason||'';notify();
  }
  function handshake(event){
    // Event propagation is confined to this detached bootstrap element. The
    // port is never broadcast on window, placed in a DOM property, or logged.
    if(stopped||port||event.target!==script||script.isConnected||event.data!==channel||event.ports?.length!==1)return;
    port=event.ports[0];script.removeEventListener(eventName,handshake);port.addEventListener('message',receive);port.start();installed=true;
  }
  function inject(){
    if(stopped||installed||script)return;
    const parent=document.documentElement||document.head;if(!parent)return;
    script=document.createElement('script');script.addEventListener(eventName,handshake);
    // Static observer source has no access to the privileged Helper closure.
    // Capture native port sending before ordinary page scripts can replace it.
    script.textContent=`(()=>{const target=document.currentScript;target.remove();${observerSource}\nconst api=globalThis.OldLightEmpireObserver;const channel=${JSON.stringify(channel)};\nconst pipe=new MessageChannel();const send=pipe.port1.postMessage.bind(pipe.port1);pipe.port1.start();\ntarget.dispatchEvent(new MessageEvent(${JSON.stringify(eventName)},{data:channel,ports:[pipe.port2],bubbles:false,composed:false}));\napi.installPageObserver({channel,emit:value=>send(JSON.stringify(value.snapshot))});})();`;
    try{parent.appendChild(script);script.remove();if(!installed)invalidate('observer-injection-unavailable');}
    catch{script.remove();script.removeEventListener(eventName,handshake);invalidate('observer-injection-unavailable');}
  }
  inject();
  let watcher=null;
  if(!script){watcher=new realm.MutationObserver(()=>{inject();if(script)watcher.disconnect();});watcher.observe(document,{childList:true,subtree:true});}
  return Object.freeze({
    snapshot(){return current?JSON.parse(JSON.stringify(current)):null;},
    subscribe(fn){if(typeof fn!=='function')return()=>{};subscribers.add(fn);return()=>subscribers.delete(fn);},
    status:()=>({installed,reason,observed:!!current,connected:current?.connected===true}),
    stop(){if(stopped)return;stopped=true;watcher?.disconnect();script?.removeEventListener(eventName,handshake);port?.removeEventListener('message',receive);port?.close();current=null;subscribers.clear();},
  });
}
return Object.freeze({create});
});
