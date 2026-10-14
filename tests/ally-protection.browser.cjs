'use strict';
// Real Chromium, entirely local simulated native controls. No game/network access.
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'),'utf8');
const block = name => source.slice(source.indexOf('// BEGIN '+name), source.indexOf('// END '+name));
(async()=>{
 const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page = await browser.newPage(); let checks=0; const requests=[],errors=[];
 page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.setContent('<!doctype html><main></main>');
  await page.addScriptTag({content:block('ALLY PROTECTION')+'\n'+block('NATIVE MISSION ADAPTER')});
  await page.evaluate(()=>{
   window.setup = options => {
    window.adapter?.destroy(); document.body.innerHTML='<main></main><dialog class="info-modal" data-content-type="inspect"><div class="info-modal-body"></div></dialog><dialog id="dispatch-dialog" data-mode="dispatch" data-direction="forward"><div data-field="dispatch-route-slot"></div><div data-field="dispatch-quantities"></div><div data-field="dispatch-presets"><button class="dispatch-preset-apply" aria-label="Use 3 Marauder">Use 3 Marauder</button></div><p data-field="dispatch-error" hidden></p><button data-field="dispatch-confirm">Attack</button></dialog>';
    const SELF='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ALLY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',RIVAL='cccccccc-cccc-4ccc-8ccc-cccccccccccc',ORIGIN='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    window.scope='alpha/'+SELF; window.sends=0;window.prepares=0;window.captureChecks=0;window.records=new Map();
    window.world={version:1,scope,selfId:SELF,connected:true,observedAt:Date.now(),epoch:1,generation:1,revision:0,ownership:{version:1,complete:false,players:[{id:SELF,name:'Self',owned:[{q:0,r:0}]},{id:ALLY,name:'Trusted Pilot',owned:[{q:7,r:8}]},{id:RIVAL,name:'Other Pilot',owned:[{q:2,r:3}]}]}};
    window.setAllyOwner=()=>{world.ownership.players[2].owned=[];world.ownership.players[1].owned=[{q:7,r:8},{q:2,r:3}];world.revision++;};
    window.context={scope,originId:ORIGIN,originName:'Origin',selectionCount:1};
    window.guard=createAllyProtection({getContext:()=>context,getWorld:()=>world,storage:{getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v)}});
    if(options.protected!==false)guard.add({id:ALLY,name:'Trusted Pilot'});
    if(options.initialAlly)setAllyOwner();
    if(options.noWorld)world=null;
    const dialog=document.querySelector('#dispatch-dialog'),inspector=document.querySelector('.info-modal');
    const inspect=source=>{
      inspector.dataset.contentType='inspect'; inspector.querySelector('.info-modal-body').replaceChildren(document.createElement('span'));
      inspector.querySelectorAll(':scope > :not(.info-modal-body)').forEach(e=>e.remove());
      const coord=document.createElement('button');coord.className='inspect-copy-coord';coord.setAttribute('aria-label',`Copy coordinates ${source?'0, 0':'2, 3'}`);inspector.append(coord);
      if(!source){const trailing=document.createElement('span');trailing.className='info-modal-trailing';trailing.innerHTML='<button class="info-modal-header-btn">Jump to</button>';inspector.append(trailing);}
      const actions=document.createElement('div');actions.className='inspect-actions';actions.innerHTML='<button class="inspect-action-btn">Attack</button>';inspector.append(actions);
      const name=document.createElement('span');name.className='inspect-system-name-text';name.textContent=source?'Origin':'Destination';inspector.append(name);
      actions.firstChild.addEventListener('click',()=>{
        prepares++;dialog.setAttribute('open','');dialog.querySelector('[data-field="dispatch-route-slot"]').innerHTML='<div class="route-header"><div class="route-header-tile-col"><span class="route-header-tile-name">Origin</span><button class="route-header-hex-clickable">Origin</button></div><div class="route-header-tile-col"><span class="route-header-tile-name">Destination</span><button class="route-header-hex-clickable">Destination</button></div></div>';
        dialog.querySelectorAll('.route-header-hex-clickable').forEach((b,i)=>b.addEventListener('click',()=>inspect(i===0)));
        if(options.duringPrepare)setTimeout(()=>setAllyOwner(),20);
      });
    }; inspect(false);
    const ships=['probe','marauder','sentinel','vanguard'];
    for(const type of ships){const row=document.createElement('div');row.className='dispatch-ship-row';row.innerHTML=`<input type="number" class="dispatch-step-input" aria-label="Number of ${type} to send" min="0" max="20" value="0"><span class="dispatch-ship-avail">20 available</span>`;dialog.querySelector('[data-field="dispatch-quantities"]').append(row);}
    const fill=()=>{dialog.querySelectorAll('input').forEach((n,i)=>{n.value=i===1?'3':'0';});};
    dialog.querySelector('.dispatch-preset-apply').addEventListener('click',fill);
    if(options.duringInput)dialog.addEventListener('input',()=>setAllyOwner(),{once:true});
    const confirm=dialog.querySelector('[data-field="dispatch-confirm"]');
    if(window.race)window.removeEventListener('click',race,true);
    window.race=event=>{if(event.target===confirm){captureChecks++; if(options.atClick)setAllyOwner();if(options.addAtClick){guard.add({id:RIVAL,name:'Other Pilot'});} if(options.disconnectAtClick)world.connected=false;}};
    window.addEventListener('click',race,true);
    confirm.addEventListener('click',()=>{sends++;dialog.close();});
    window.adapter=createNativeMissionAdapter({getContext:()=>context,getFleet:()=>({parked:20,away:0,building:0}),resolveTarget:async()=>({inspector,cleanup:()=>{}}),checkTarget:(job,previous)=>guard.check(job,previous)});
    window.job={id:options.retry?'retry:synthetic-campaign':'pending-synthetic',scope,originId:ORIGIN,originName:'Origin',target:{coordinate:{q:2,r:3},label:'Destination',routeKey:'',presetKey:options.amounts?'':'Use 3 Marauder',...(options.amounts?{mode:'amounts',originCoordinate:{q:0,r:0}}:options.legacy?{}:{mode:'custom',missionAction:'attack'})},quantities:{probe:0,marauder:3,sentinel:0,vanguard:0},claimedAt:1};
    guard.mount(document.querySelector('main'));
   };
  });
  const run=async(name,options,status,sends)=>{
    await page.evaluate(o=>setup(o),options);
    const result=await page.evaluate(async()=>({result:await adapter.dispatch(job),sends,prepares}));
    assert.equal(result.result.status,status,name+': '+JSON.stringify(result));assert.equal(result.sends,sends,name); checks++;console.log('PASS '+name);
  };
  await run('baseline without protection or census',{protected:false,noWorld:true},'sent',1);
  await run('known rival custom composition',{},'sent',1);
  await run('known rival legacy preset',{legacy:true},'sent',1);
  await run('retry amounts native origin checks',{amounts:true,retry:true},'sent',1);
  await run('protected owner at start',{initialAlly:true},'paused',0);
  await run('protected retry at start',{initialAlly:true,amounts:true,retry:true},'paused',0);
  await run('unknown owner/census',{noWorld:true},'paused',0);
  await run('capture during native preparation',{duringPrepare:true},'paused',0);
  await run('capture while amounts applied',{duringInput:true},'paused',0);
  await run('capture in earlier final click listener',{atClick:true},'paused',0);
  await run('new protection in earlier final click listener',{addAtClick:true},'paused',0);
  await run('disconnect in earlier final click listener',{disconnectAtClick:true},'paused',0);
  await page.evaluate(()=>{setup({});guard.mount(document.querySelector('main'));document.querySelector('main details').open=true;});
  await page.getByLabel('Nombre del jugador protegido').fill('Pending Pilot');await page.getByRole('button',{name:'Proteger jugador',exact:true}).click();
  assert.match(await page.locator('main').textContent(),/ID pendiente/);checks++;
  await page.evaluate(()=>{context.scope='beta/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';guard.render();});
  assert.match(await page.locator('main').textContent(),/Galaxia beta/);assert.doesNotMatch(await page.locator('main').textContent(),/Pending Pilot/);checks++;
  await page.evaluate(()=>{context.scope='';guard.render();context.scope=scope;guard.render();});
  assert.equal(await page.getByLabel('Nombre del jugador protegido').count(),1);checks++;
  for(const width of [1200,390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;}
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);checks+=2;
  console.log(JSON.stringify({checks,networkRequests:requests.length,pageErrors:errors.length}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
