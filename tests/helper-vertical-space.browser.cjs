'use strict';
// Render production markup/layout on an isolated page. No game or Drive actions.
const {firefox}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),source=fs.readFileSync(process.env.VERTICAL_QA_SOURCE||path.join(root,'old-light-auto-upgrade.user.js'),'utf8');
function part(a,b,from=0){const i=source.indexOf(a,from),j=source.indexOf(b,i);assert.ok(i>=0&&j>i);return source.slice(i,j);}
const html=part('      shadow.innerHTML = `','`;\n      ui = {',source.indexOf('  function mount()')).slice('      shadow.innerHTML = `'.length).replaceAll('${SCRIPT_VERSION}',source.match(/const SCRIPT_VERSION = '([^']+)'/)[1]);
const layout=part('  function layoutHelper()','  function installHelperResizing()');
const resizeListener=part("  window.addEventListener('resize', () => {","  document.addEventListener('input', event => {",source.indexOf('  function installHelperResizing()'));
const resizeObserver=part("      if (typeof ResizeObserver === 'function') new ResizeObserver(layoutHelper).observe(ui.section);",'      for (const [index, tab] of ui.tabs.entries()) {');
(async()=>{
 assert.ok(process.env.CAMOUFOX_PATH,'Set CAMOUFOX_PATH to the installed Camoufox executable for optional rendered QA.');
 const browser=await firefox.launch({executablePath:process.env.CAMOUFOX_PATH,headless:true});
 const page=await browser.newPage({viewport:{width:1253,height:1038}}),errors=[],measurements=[];let checks=0;
 const check=(v,m)=>{assert.ok(v,m);checks++;};page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.setContent('<html lang="es"><title>Old Light: isolated layout QA</title><body style="margin:0;background:#0b1018"></body></html>');
  await page.evaluate(html=>{const host=document.createElement('div');host.id='helper';document.body.append(host);host.attachShadow({mode:'open'}).innerHTML=html;},html);
  await page.addScriptTag({path:path.join(root,'docs/reinforcement-panel.js')});
  await page.addScriptTag({content:`const host=document.querySelector('#helper'),shadow=host.shadowRoot,q=s=>shadow.querySelector(s);
   const settings={panelWidth:560,panelPosition:{x:415,y:74},minimized:false};
   const ui={section:q('.helper-shell'),panelWidth:q('[data-setting="panel-width"]'),panelWidthValue:q('[data-field="panel-width-value"]'),resize:q('[data-action="helper-resize"]'),minimize:q('[data-action="helper-minimize"]'),header:q('header')};
   const setText=(n,v)=>n.textContent=v,saveSettings=()=>{};${layout}
   for(const n of shadow.querySelectorAll('[data-page]'))n.hidden=n.dataset.page!=='fleet';q('[data-page="fleet"]').open=true;
   for(const n of [...q('[data-page="fleet"]').children])if(n.tagName!=='SUMMARY')n.hidden=true;
   const container=document.createElement('div');q('[data-page="fleet"]').append(container);
   const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
   const world={scope:'fixture/self',systems:[{id:A,name:'Origen',x:0,y:0,owned:true},{id:B,name:'Destino',x:100,y:60,owned:true}]};
   const routes=[{id:'fixture-route',name:'Refuerzo principal',originId:A,destinationId:B,intervalMinutes:10,ships:{marauder:{mode:'fixed',amount:15}},enabled:false}];
   const panel=OldLightReinforcementPanel.create({document,getWorld:()=>world,getScope:()=>world.scope,getRoutes:()=>routes});panel.mount(container);container.querySelector('details').open=true;
   q('[data-field="helper-context"]').textContent='Technocratic Imperium';
   for(let i=0;i<20;i++){const p=document.createElement('p');p.textContent='Contenido adicional de prueba '+i;container.append(p);}
   const schedule=()=>{};installHelperDragging();layoutHelper();${resizeObserver}${resizeListener}
   ui.minimize.addEventListener('click',()=>{settings.minimized=!settings.minimized;layoutHelper();});
   window.fixture={settings,ui,host,shadow,layout:layoutHelper};`});
  const metrics=()=>page.evaluate(()=>{const s=fixture.ui.section.getBoundingClientRect(),scroll=fixture.shadow.querySelector('.helper-scroll'),f=fixture.shadow.querySelector('footer').getBoundingClientRect();return {x:s.x,y:s.y,width:s.width,height:s.height,bottom:s.bottom,viewport:innerHeight,bodyHeight:scroll.clientHeight,footerBottom:f.bottom,horizontalOverflow:scroll.scrollWidth>scroll.clientWidth};});
  measurements.push(await metrics());
  if(process.env.VERTICAL_QA_SCREENSHOT)await page.screenshot({path:process.env.VERTICAL_QA_SCREENSHOT});
  check(Math.abs(measurements[0].bottom-1026)<1,'saved anchor uses viewport bottom instead of 720px cap');
  check(measurements[0].height>900,'tall screen shows more content');
  for(const [width,height] of [[1566,1297],[1920,1440],[390,844],[320,568],[800,400],[800,280]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>fixture.layout());const m=await metrics();measurements.push(m);
   check(m.y>=12&&m.bottom<=height-11,'shell and footer stay inside viewport');
   check(Math.abs(m.bottom-(height-12))<1,'expanded panel fills to bottom');check(m.bodyHeight>0,'scroll content remains accessible');check(!m.horizontalOverflow,'no horizontal content overflow');
  }
  await page.setViewportSize({width:1253,height:1038});await page.evaluate(()=>{fixture.settings.panelPosition={x:415,y:74};fixture.layout();});
  const header=await page.locator('.helper-header').boundingBox();await page.mouse.move(header.x+100,header.y+20);await page.mouse.down();await page.mouse.move(header.x+100,header.y+140);check((await metrics()).y===194,'drag moves top while expanding to bottom');await page.keyboard.press('Escape');await page.mouse.up();check((await metrics()).y===74,'Escape restores drag anchor and height');
  await page.locator('[data-action="helper-minimize"]').click();check((await metrics()).height<100,'minimize remains compact');await page.locator('[data-action="helper-minimize"]').click();check((await metrics()).height>900,'restore returns available height');
  await page.evaluate(()=>{fixture.settings.panelPosition=null;fixture.layout();});check((await metrics()).y===12,'reset uses full viewport margins');
  await page.evaluate(()=>{fixture.shadow.querySelector('.helper-scroll').scrollTop=99999;});check((await metrics()).footerBottom<=1026,'footer remains reachable while scrolled');
  check(await page.evaluate(()=>{const s=fixture.shadow.querySelector('.helper-scroll');return s.scrollTop>0&&s.scrollTop+s.clientHeight>=s.scrollHeight-1;}),'scroll reaches actual bottom of long content');
  check(errors.length===0,'no browser errors');console.log(JSON.stringify({checks,measurements,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
