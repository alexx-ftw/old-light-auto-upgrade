'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const browser=require('./helpers/native-browser.cjs');
const source=fs.readFileSync(process.env.QA_PROBE_LAYOUT_SOURCE||path.join(__dirname,'../old-light-auto-upgrade.user.js'),'utf8');
function fixture(){
 const start=source.indexOf('<style>',source.indexOf('function installShipCreditToggle(')),end=source.indexOf('</style>',start);
 const fn=source.slice(source.indexOf('  function installShipCreditToggle('),source.indexOf('  function projectShipCredits('));
 const loopStart=source.indexOf('      for (const [id, name] of SHIPS) {',end),loopEnd=source.indexOf('      ui.countAway.addEventListener',loopStart);
 assert.ok(start>0&&end>start&&loopEnd>loopStart);
 return {css:source.slice(start+7,end),js:`let settings={creditProtection:{probe:true,marauder:true,sentinel:true,vanguard:true}};let saves=0;const normalizeSettings=x=>x,saveSettings=()=>{saves++;return true},schedule=()=>{},presentationFailure=()=>{},installPriorityKeys=()=>{},movePriority=()=>{},installNumericInput=()=>{},MAX_SHIP_MINIMUM=50000,SHIPS=[['probe','Probe'],['marauder','Marauder'],['sentinel','Sentinel'],['vanguard','Vanguard']],ui={fleetChoices:layoutRoot.querySelector('.fleet-choices'),shipItems:new Map()};${fn}\n${source.slice(loopStart,loopEnd)}\nlet pos=0;for(const x of ui.shipItems.values()){x.input.value='60';x.position.textContent=String(++pos)+'.';}globalThis.layoutState=()=>({saves,protection:settings.creditProtection});`};
}
test('ship credit protection has its own responsive row without overlapping fleet controls in real Chromium', {timeout:60000},async t=>{
 const f=fixture(),html='<!doctype html><title>Offline fleet credit layout</title><link rel=icon href=data:,><body style="margin:0;background:#071421"><div id=fixture></div>';
 const b=await browser.open(url=>url.href==='https://oldlight.io/offline-layout'?{type:'text/html',body:html}:null);
 try{
 await b.command('Page.navigate',{url:'https://oldlight.io/offline-layout'});
 let ready=false;
 for(let i=0;i<200&&!ready;i++){
  ready=await b.evaluate("location.href==='https://oldlight.io/offline-layout'&&document.title==='Offline fleet credit layout'&&Boolean(document.getElementById('fixture'))").catch(()=>false);
  if(!ready)await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.equal(ready,true,'offline fixture document is loaded before mounting');
 await b.evaluate(`globalThis.layoutRoot=document.querySelector('#fixture').attachShadow({mode:'open'});layoutRoot.innerHTML=${JSON.stringify('<style>'+f.css+'</style><div class=helper-shell><div class=fleet-choices></div></div>')}`);await b.evaluate(f.js);
 const failures=[];
 for(const width of [320,375,665,1000]){
  await b.command('Emulation.setDeviceMetricsOverride',{width:width+24,height:1000,deviceScaleFactor:1,mobile:false});
  await b.evaluate(`layoutRoot.querySelector('.helper-shell').style.setProperty('--helper-width','${width}px')`);
  await b.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const geometry=await b.evaluate(`Array.from(layoutRoot.querySelectorAll('.fleet-row')).map(row=>{const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};const nodes=[...row.children].filter(n=>n.getBoundingClientRect().height>0);return {rect:rect(row),nodes:nodes.map(n=>({tag:n.tagName,cls:n.className,rect:rect(n)})),protection:rect(row.querySelector('[data-credit-protection]').closest('.ship-credit-protection')||row.querySelector('[data-credit-protection]').parentElement),scroll:row.scrollWidth,client:row.clientWidth}})`);
  fs.writeFileSync(path.join(b.artifacts,'layout-'+width+'.json'),JSON.stringify(geometry,null,2));
  fs.writeFileSync(path.join(b.artifacts,'layout-'+width+'.png'),Buffer.from((await b.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  for(const row of geometry){
   assert.ok(Math.abs(row.rect.width-width+2)<3,'actual card follows requested width');
   if(row.scroll>row.client+1)failures.push('horizontal overflow at '+width);
   for(let i=0;i<row.nodes.length;i++)for(let j=i+1;j<row.nodes.length;j++){
    const a=row.nodes[i].rect,c=row.nodes[j].rect;
    if(Math.min(a.right,c.right)-Math.max(a.left,c.left)>.5&&Math.min(a.bottom,c.bottom)-Math.max(a.top,c.top)>.5)failures.push('overlap at '+width+': '+row.nodes[i].cls+'/'+row.nodes[j].cls);
   }
   if(row.protection.top<Math.max(...row.nodes.filter(n=>/priority-|fleet-counts/.test(n.cls)||n.tag==='INPUT'||n.tag==='LABEL').map(n=>n.rect.bottom))-.5)failures.push('protection not separate at '+width);
  }
 }
 await b.evaluate(`layoutRoot.querySelector('[data-credit-protection="probe"]').click()`);
 assert.deepEqual(await b.evaluate('layoutState()'),{saves:1,protection:{probe:false,marauder:true,sentinel:true,vanguard:true}});
 assert.equal(await b.evaluate('document.title'),'Offline fleet credit layout');assert.deepEqual(b.errors,[]);assert.deepEqual(b.denied,[]);
 t.diagnostic('CREDIT_LAYOUT_ARTIFACTS='+b.artifacts);assert.deepEqual(failures,[]);
 }finally{await b.close()}
});
