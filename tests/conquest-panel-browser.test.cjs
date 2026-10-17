'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const browser=require('./helpers/native-browser.cjs');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'old-light-auto-upgrade.user.js'),'utf8');
const a=source.indexOf('<style>',source.indexOf('  function installShipCreditToggle(')),b=source.indexOf('</style>',a),css=source.slice(a+7,b);
const qStart=source.indexOf('// BEGIN FLEET WAIT QUEUE'),qEnd=source.indexOf('// END FLEET WAIT QUEUE',qStart),queueSource=source.slice(qStart,qEnd);
const modules=['conquest-core','conquest-controller','conquest-panel','reinforcement-runtime'].map(name=>({name,source:fs.readFileSync(path.join(root,'docs/'+name+'.js'),'utf8')}));
const fixture=fs.readFileSync(path.join(__dirname,'conquest-panel.fixture.js'),'utf8');
test('conquest UI and real queue assemble before a single raid reevaluate Victory and stop on explicit capture offline', {timeout:60000},async t=>{
 const b=await browser.open(url=>url.href==='https://oldlight.io/offline-conquest'?{type:'text/html',body:'<!doctype html><title>Offline conquest campaign QA</title><link rel=icon href=data:,><body style="margin:0;background:#071421"><div id=fixture></div>'}:null);
 try{
  await b.command('Page.navigate',{url:'https://oldlight.io/offline-conquest'});let ready=false;
  for(let i=0;i<200&&!ready;i++){ready=await b.evaluate("location.href==='https://oldlight.io/offline-conquest'&&document.title==='Offline conquest campaign QA'&&Boolean(document.getElementById('fixture'))").catch(()=>false);if(!ready)await new Promise(r=>setTimeout(r,10));}assert.equal(ready,true);
  await b.evaluate(`globalThis.layoutRoot=document.querySelector('#fixture').attachShadow({mode:'open'});layoutRoot.innerHTML=${JSON.stringify('<style>'+css+'</style><div class=helper-shell><div class=helper-scroll><div id=campaigns></div></div></div>')}`);
  for(const module of modules)await b.evaluate(module.source);await b.evaluate(queueSource);await b.evaluate(fixture+'\ninstallConquestFixture()');
  await b.evaluate(`layoutRoot.querySelector('details').open=true;const form=layoutRoot.querySelector('form');form.querySelector('input[name="Nombre del objetivo"]').value='Synthetic target';form.querySelector('input[name="Coordenada q"]').value='10';form.querySelector('input[name="Coordenada r"]').value='0';form.querySelector('input[name="Flota por incursión marauder"]').value='10';form.requestSubmit()`);
  assert.equal((await b.evaluate('conquestFixture.state()')).objectives.length,0,'authorization is required');
  await b.evaluate(`layoutRoot.querySelector('.cq-authorize input').click();layoutRoot.querySelector('form').requestSubmit()`);
  assert.equal((await b.evaluate('conquestFixture.state()')).objectives.length,0,'declined native confirmation does not create a campaign');
  for(const width of [320,665]){
   await b.command('Emulation.setDeviceMetricsOverride',{width:width+24,height:1000,deviceScaleFactor:1,mobile:false});
   await b.evaluate(`layoutRoot.querySelector('.helper-shell').style.setProperty('--helper-width','${width}px')`);await b.evaluate('new Promise(r=>requestAnimationFrame(r))');
   const geometry=await b.evaluate(`Array.from(layoutRoot.querySelectorAll('.cq-root input,.cq-root button,.cq-root fieldset')).map(n=>{const r=n.getBoundingClientRect(),p=layoutRoot.querySelector('.helper-shell').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,containerLeft:p.left,containerRight:p.right}})`);
   assert.ok(geometry.every(r=>r.width>0&&r.left>=r.containerLeft-.5&&r.right<=r.containerRight+.5),'form controls stay within helper at '+width);
   fs.writeFileSync(path.join(b.artifacts,'conquest-form-'+width+'.png'),Buffer.from((await b.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  }
  await b.evaluate(`conquestFixture.setConfirmation(true);layoutRoot.querySelector('form').requestSubmit();layoutRoot.querySelector('details').open=false;conquestFixture.run()`);
  let state=await b.evaluate('conquestFixture.state()');assert.equal(state.calls.length,1);assert.equal(state.calls[0].target.missionAction,'send');assert.equal(state.objectives[0].ticket.kind,'transfer');
  await b.evaluate(`layoutRoot.querySelector('[data-conquest-action="pause"]').click()`);assert.equal((await b.evaluate('conquestFixture.state()')).objectives[0].status,'paused');
  await b.evaluate(`layoutRoot.querySelector('[data-conquest-action="resume"]').click()`);state=await b.evaluate('conquestFixture.state()');assert.equal(state.objectives[0].status,'planning');assert.equal(state.objectives[0].ticket.state,'sent');assert.equal(state.calls.length,1);assert.match(await b.evaluate("layoutRoot.querySelector('.cq-card').textContent"),/Esperando llegada y censo/);
  fs.writeFileSync(path.join(b.artifacts,'conquest-resumed-transfer.png'),Buffer.from((await b.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  const visibleWorldReads=await b.evaluate('conquestFixture.censusReads()');
  await b.evaluate(`layoutRoot.querySelector('#campaigns').hidden=true;for(let i=0;i<20;i++)conquestFixture.render()`);
  assert.equal(await b.evaluate('conquestFixture.censusReads()'),visibleWorldReads,'hidden presentation never reads census or replans');
  await b.evaluate(`layoutRoot.querySelector('#campaigns').hidden=false;conquestFixture.render()`);
  assert.ok((await b.evaluate('conquestFixture.censusReads()'))>visibleWorldReads,'visible presentation recovers with fresh census');
  await b.evaluate('conquestFixture.run()');assert.equal((await b.evaluate('conquestFixture.state()')).calls.length,1,'no attack while reinforcement is in transit');
  await b.evaluate('conquestFixture.arrive();conquestFixture.run()');state=await b.evaluate('conquestFixture.state()');assert.equal(state.calls.length,2);assert.equal(state.calls[1].target.mode,'amounts');assert.equal(state.calls[1].originId,state.calls[0].target.coordinate.q===0?'00000000-0000-4000-8000-000000000002':'');
  await b.evaluate('conquestFixture.run()');assert.equal((await b.evaluate('conquestFixture.state()')).calls.length,2,'one raid before report');
  await b.evaluate('conquestFixture.report(false);conquestFixture.run()');state=await b.evaluate('conquestFixture.state()');assert.equal(state.objectives[0].status,'planning');assert.equal(state.calls.length,2,'Victory without capture does not finish or invent new parked ships');
  await b.evaluate('conquestFixture.restock();conquestFixture.run()');state=await b.evaluate('conquestFixture.state()');assert.equal(state.calls.length,3);assert.equal(state.objectives[0].raids,2);
  await b.evaluate('conquestFixture.report(true);conquestFixture.run()');state=await b.evaluate('conquestFixture.state()');assert.equal(state.objectives[0].status,'captured');assert.equal(state.objectives[0].ticket,null);assert.equal(state.objectives[0].losses.marauder,2);
  await b.evaluate('conquestFixture.run()');assert.equal((await b.evaluate('conquestFixture.state()')).calls.length,3);
  await b.evaluate(`layoutRoot.querySelector('.cq-card').scrollIntoView({block:'start'})`);
  fs.writeFileSync(path.join(b.artifacts,'conquest-captured.png'),Buffer.from((await b.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  fs.writeFileSync(path.join(b.artifacts,'conquest-state.json'),JSON.stringify({state,sourceHashes:Object.fromEntries([...modules,{name:'queue',source:queueSource},{name:'css',source:css},{name:'fixture',source:fixture}].map(m=>[m.name,crypto.createHash('sha256').update(m.source).digest('hex')]))},null,2));
  await b.evaluate(`conquestFixture.addEligibleTarget(11);conquestFixture.setConfirmation(false);layoutRoot.querySelector('[data-conquest-action="continue-chain"]').click();conquestFixture.run()`);
  state=await b.evaluate('conquestFixture.state()');assert.equal(state.objectives.length,1);assert.equal(state.objectives[0].autoNext,false,'declining continuation preserves single-target authorization');
  await b.evaluate(`conquestFixture.setConfirmation(true);layoutRoot.querySelector('[data-conquest-action="continue-chain"]').click();conquestFixture.restock();conquestFixture.run()`);
  state=await b.evaluate('conquestFixture.state()');assert.equal(state.objectives.length,2);assert.equal(state.objectives[1].target.q,11);assert.equal(state.objectives[1].raids,2);assert.equal(state.objectives[1].losses.marauder,2);assert.equal(state.calls.length,3,'selection is not evidence of fresh stock after creating the successor');
  await b.evaluate('conquestFixture.restock();conquestFixture.run()');state=await b.evaluate('conquestFixture.state()');assert.equal(state.calls.length,4);assert.equal(state.calls[3].target.coordinate.q,11);assert.equal(state.objectives[1].raids,3);assert.equal(state.objectives[0].status,'captured');
  await b.evaluate('conquestFixture.run();conquestFixture.run()');assert.equal((await b.evaluate('conquestFixture.state()')).calls.length,4,'a successor still permits only one raid before its report');
  assert.equal(await b.evaluate(`layoutRoot.querySelector('.cq-card [data-conquest-action="remove"]').disabled`),true,'the captured ancestor remains guarded while its successor is registered');
  fs.writeFileSync(path.join(b.artifacts,'conquest-chain-state.json'),JSON.stringify(state,null,2));
  fs.writeFileSync(path.join(b.artifacts,'conquest-chain.png'),Buffer.from((await b.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  assert.deepEqual(b.errors,[]);assert.deepEqual(b.denied,[]);assert.equal(await b.evaluate('document.title'),'Offline conquest campaign QA');
  t.diagnostic('CONQUEST_BROWSER_ARTIFACTS='+b.artifacts);
 }finally{await b.close()}
});
