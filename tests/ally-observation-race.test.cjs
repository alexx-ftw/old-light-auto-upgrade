'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const root=require('node:path').join(__dirname,'..');
const test=require('node:test');
test('native capture revokes old owner before queued confirm and delayed MessagePort delivery',()=>{
const Observer=require(root+'/docs/empire-observer.js'),Bridge=require(root+'/docs/empire-bridge.js');
const observerSource=fs.readFileSync(root+'/docs/empire-observer.js','utf8');
const helper=fs.readFileSync(root+'/old-light-auto-upgrade.user.js','utf8');
const s=helper.indexOf('// BEGIN ALLY PROTECTION'),e=helper.indexOf('// END ALLY PROTECTION',s);
const timers=new Map();let timerId=0;
const later=f=>{timers.set(++timerId,f);return timerId};
const flush=()=>{while(timers.size){let [id,f]=timers.entries().next().value;timers.delete(id);f()}};
class Socket { constructor(url){this.url=url;this.handlers=new Map()} addEventListener(t,f){if(!this.handlers.has(t))this.handlers.set(t,new Set());this.handlers.get(t).add(f)} removeEventListener(t,f){this.handlers.get(t)?.delete(f)} dispatch(data){for(const f of this.handlers.get('message')||[])f({data,isTrusted:true})} }
class Port {constructor(){this.handlers=new Set()}addEventListener(t,f){this.handlers.add(f)}removeEventListener(t,f){this.handlers.delete(f)}start(){}close(){this.closed=true}postMessage(data){later(()=>{if(!this.closed&&!this.peer.closed)for(const f of this.peer.handlers)f({data})})}}
class MessageChannel{constructor(){this.port1=new Port;this.port2=new Port;this.port1.peer=this.port2;this.port2.peer=this.port1}}
const parent={appendChild(n){n.isConnected=true}};
const document={readyState:'loading',documentElement:parent,createElement(){return {attrs:new Map,handlers:new Set,isConnected:false,getAttribute(k){return this.attrs.get(k)??null},setAttribute(k,v){this.attrs.set(k,String(v))},removeAttribute(k){this.attrs.delete(k)},addEventListener(t,f){this.handlers.add(f)},removeEventListener(t,f){this.handlers.delete(f)},dispatchEvent(ev){ev.target=this;for(const f of this.handlers)f(ev)},remove(){this.isConnected=false}}}};
const ctx=vm.createContext({URL,Proxy,Reflect,Date,WebSocket:Socket,document,MessageChannel,MessageEvent:class{constructor(type,props){this.type=type;Object.assign(this,props)}},location:{origin:'https://oldlight.io',pathname:'/game/galaxy/alpha'},crypto:{randomUUID:()=> 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},setTimeout:later,clearTimeout:i=>timers.delete(i)});
const bridge=Bridge.create({realm:ctx,document,observer:Observer,observerSource,addElement(target,tag,attrs){document.currentScript={parentNode:target};vm.runInContext(attrs.textContent,ctx);document.currentScript=null}});
vm.runInContext(helper.slice(s,e)+'\nthis.guardFactory=createAllyProtection;',ctx);
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),self=id(1),ally=id(2),rival=id(3),now=Date.now();
const frame=(n,p)=>'42'+JSON.stringify([n,p]);
const socket=new ctx.WebSocket('wss://api.oldlight.io/socket.io/?EIO=4&transport=websocket');
const system={id:id(10),q:0,r:0,name:'Self star',buildings:[{type:'shipyard',level:0}],fleet:[],economy:{resources:{palladium:0,iridium:0,settledAt:new Date(now).toISOString()},paCap:100,irCap:100,paRatePerMin:0,irRatePerMin:0,energyCap:10,energyUsed:0,deficitMultiplier:1,queueSlots:1,queue:[]}};
socket.dispatch(frame('world.init',{selfId:self,serverNow:now,world:{players:[{id:self,owned:[system],transits:[]},{id:ally,name:'Ally',owned:[{q:2,r:2}]},{id:rival,name:'Rival',owned:[{q:1,r:1}]}]}}));flush();assert.equal(bridge.snapshot()?.complete,true);
const scope='alpha/'+self,storage=new Map();
const guard=ctx.guardFactory({getContext:()=>({scope}),getWorld:()=>bridge.snapshot(),storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
guard.add({id:ally,name:'Ally'});let during;
ctx.setTimeout(()=>during=guard.check({scope,target:{coordinate:{q:1,r:1}}}));
socket.dispatch(frame('world.delta',{updated:{players:[{id:ally,name:'Ally',owned:[{q:1,r:1},{q:2,r:2}]}]}}));
assert.equal(bridge.snapshot(),null,'pending stamp must immediately revoke old bridge');flush();

assert.equal(during.allowed,false,'received capture must block previously queued confirmation');
assert.equal(guard.check({scope,target:{coordinate:{q:1,r:1}}}).code,'protected');
bridge.stop();
});
