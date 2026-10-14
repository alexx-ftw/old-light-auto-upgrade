'use strict';
// Production protected-player form on a minimal offline DOM. No game/network IO.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','old-light-auto-upgrade.user.js'),'utf8');
const begin=source.indexOf('// BEGIN ALLY PROTECTION'),end=source.indexOf('// END ALLY PROTECTION',begin);
const SELF='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ALLY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
class Element{
 constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attributes=new Map();this.listeners=new Map();this.dataset={};this.style={};this.value='';this.open=false;this._text='';}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join(' ');}
 set innerHTML(_){throw Error('Untrusted HTML forbidden');}append(...v){this.children.push(...v);}replaceChildren(...v){this.ownerDocument.replaces++;this.children=[...v];}
 setAttribute(k,v){this.attributes.set(k,String(v));}getAttribute(k){return this.attributes.get(k)??null;}
 addEventListener(k,f){this.listeners.set(k,f);}emit(k){this.listeners.get(k)?.({preventDefault(){}});}
 querySelector(s){return walk(this).find(n=>n!==this&&n.tagName===s.toUpperCase())||null;}
}
const walk=n=>[n,...n.children.flatMap(walk)];
function harness(){
 const data=new Map(),doc={replaces:0,createElement(tag){return new Element(tag,this);}},container=new Element('main',doc);
 let scope='alpha/'+SELF;const world={version:1,scope,selfId:SELF,connected:true,observedAt:10000,epoch:1,revision:0,generation:1,ownership:{version:1,complete:false,players:[{id:SELF,owned:[{q:0,r:0}]},{id:ALLY,name:'Pilot',owned:[{q:4,r:5}]}]}};
 const context=vm.createContext({});vm.runInContext(source.slice(begin,end)+';this.factory=createAllyProtection;',context);
 const guard=context.factory({getContext:()=>({scope}),getWorld:()=>world,now:()=>10000,storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});guard.mount(container);
 return{guard,container,doc,data,set scope(v){scope=v;},get scope(){return scope;},find:(tag)=>walk(container).find(n=>n.tagName===tag.toUpperCase()),input:(label)=>walk(container).find(n=>n.getAttribute('aria-label')===label),text:()=>container.textContent};
}
test('empty protection is explicitly unconfigured and explains its local/manual/in-flight limits',()=>{
 const h=harness();assert.match(h.find('summary').textContent,/sin configurar/i);assert.match(h.text(),/Protección sin configurar/);
 assert.match(h.text(),/No se incluye en copias ni en Drive/);assert.match(h.text(),/No cancela flotas ya enviadas ni controla clics manuales/);
 assert.equal(h.guard.active(),false);assert.equal(h.data.size,0);
});
test('successful save feedback cannot follow the user into a different account or galaxy',()=>{
 const h=harness();h.input('Nombre del jugador protegido').value='Pilot';h.input('ID del jugador protegido').value=ALLY;h.find('form').emit('submit');
 assert.match(h.text(),/Protección guardada/);assert.equal(h.guard.active(),true);
 h.scope='beta/'+SELF;h.guard.render();assert.doesNotMatch(h.text(),/Protección guardada/);assert.match(h.text(),/sin configurar/i);assert.equal(h.guard.active(),false);
 h.scope='alpha/'+SELF;h.guard.render();assert.equal(h.guard.active(),true);assert.equal(h.data.size,1);
});
test('repeated renders preserve the draft and disclosure, and stale forms cannot write a new scope',()=>{
 const h=harness(),form=h.find('form'),name=h.input('Nombre del jugador protegido');h.find('details').open=true;name.value='Pending pilot';const replaces=h.doc.replaces;
 for(let i=0;i<50;i++)h.guard.render();assert.equal(h.doc.replaces,replaces);assert.equal(h.find('form'),form);assert.equal(name.value,'Pending pilot');
 h.scope='beta/'+SELF;form.emit('submit');assert.equal(h.data.size,0);assert.match(h.text(),/cuenta o la galaxia ha cambiado/);assert.equal(h.find('details').open,true);
});
test('another tab removal clears active status without recording names as HTML',()=>{
 const h=harness();h.guard.add({name:'<img src=x onerror=bad>'});assert.equal(h.guard.active(),true);assert.match(h.text(),/<img/);
 h.data.set('old-light-protected-players:v1:'+h.scope,JSON.stringify({version:1,scope:h.scope,players:[]}));h.guard.render();assert.equal(h.guard.active(),false);assert.match(h.text(),/sin configurar/i);
});
