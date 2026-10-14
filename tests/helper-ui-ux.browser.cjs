'use strict';
// Optional real-browser QA on an isolated synthetic page. No game, Drive or network.
// The release gate checks this file's syntax; it does not execute browser tests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), source = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');
function part(start, end, from = 0) { const a = source.indexOf(start, from), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a); return source.slice(a, b); }
const mount = source.indexOf('  function mount()');
const html = part('      shadow.innerHTML = `', '`;\n      ui = {', mount).slice('      shadow.innerHTML = `'.length)
  .replaceAll('${SCRIPT_VERSION}', source.match(/const SCRIPT_VERSION = '([^']+)'/)[1]);
const boundary = part('  // BEGIN HELPER KEYBOARD BOUNDARY', '  // END HELPER KEYBOARD BOUNDARY');
const workspace = part('  function normalizeHelperWorkspace(', '  // END HELPER WORKSPACE\n');
const tabs = part('      for (const [index, tab] of ui.tabs.entries()) {', '      notifier.mount(');
const sync = part('  function syncSettingsTabs()', '  function presentationFailure(');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  let checks = 0; const check = (value, message) => { assert.ok(value, message); checks++; };
  const page = await browser.newPage({ viewport: { width: 1200, height: 920 } }), requests = [], errors = [];
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Helper: QA local aislada</title><body style="margin:0;background:#080f17"></body></html>');
    await page.evaluate(markup => { const host = document.createElement('div'); host.id = 'fixture-helper'; document.body.append(host); host.attachShadow({ mode: 'open' }).innerHTML = markup; }, html);
    await page.addScriptTag({ path: path.join(root, 'docs/empire-core.js') });
    await page.addScriptTag({ path: path.join(root, 'docs/empire-panel.js') });
    await page.addScriptTag({ content: `
      const host = document.querySelector('#fixture-helper'), shadow = host.shadowRoot;
      const q = selector => shadow.querySelector(selector), settings = {activeTab:'fleet',enabled:false,minimized:false,conditionsExpanded:true};
      const ui = {section:q('.helper-shell'),scroll:q('.helper-scroll'),fleetDetails:q('[data-page="fleet"]'),
        allyProtectionContainer:q('[data-field="ally-protection"]'),attackRetryContainer:q('[data-field="attack-retry"]'),fleetWaitContainer:q('[data-field="fleet-wait"]'),
        tabs:[...shadow.querySelectorAll('[data-settings-tab]')],pages:[...shadow.querySelectorAll('[data-page]')],conditionsDetails:q('.conditions-details'),
        panelWidth:q('[data-setting="panel-width"]'),driveContainer:q('[data-field="drive-backup"]'),driveShortcut:q('[data-action="drive-shortcut"]'),
        eta:q('[data-field="upgrade-eta"]'),contextLabel:q('[data-field="helper-context"]'),pageScroll:new Map()};
      const localStorage={getItem:()=>null,setItem:()=>{}},driveBackup={getStatus:()=>({code:'disconnected'})};
      const setText=(node,value)=>{if(node.textContent!==value)node.textContent=value;},text=node=>node?.textContent||'';
      const presentationFailure=message=>{throw Error(message);},syncPresentationSections=()=>{},layoutHelper=()=>{},saveSettings=()=>{};
      ${boundary}\n${workspace}\n${sync}\n${tabs}
      let nativeKeys=0;window.addEventListener('keydown',()=>nativeKeys++);installHelperKeyboardBoundary(shadow);
      installHelperWorkspace(shadow);
      for(let i=0;i<16;i++){const label=document.createElement('label');label.textContent='Campo sintético '+i;const input=document.createElement('input');input.setAttribute('aria-label','Campo sintético '+i);label.append(input);ui.workspace.views.get('minimums').append(label);}
      const core=OldLightEmpireCore;let scope='alpha/player',config=core.normalizeConfig({fleetTargets:{marauder:20}}),writes=0,fail=false;
      const empirePanel=OldLightEmpirePanel.create({document,core,getState:()=>({scope,config,ready:false,roster:{systems:[]},snapshots:[]}),
        setConfig:value=>{writes++;if(fail)throw Error('Fallo sintético');config=core.normalizeConfig(value);},canEnable:()=>false,
        isVisible:()=>settings.activeTab==='empire'&&!settings.minimized});
      empirePanel.mount(q('[data-page="empire"]')); syncSettingsTabs();
      window.fixture={ui,settings,host,shadow,empirePanel,setScope:value=>{scope=value;empirePanel.observeScope(scope);},
        setFail:value=>{fail=value;},remoteGoal:value=>{config.fleetTargets.marauder=value;empirePanel.render();},
        counts:()=>({writes,goal:config.fleetTargets.marauder,nativeKeys}),sync:syncSettingsTabs};
    ` });
    const subnav = page.locator('.fleet-workspace-tabs');
    for (const [viewport, panelWidth] of [[1200,300],[1200,360],[1200,560],[390,360],[320,300]]) {
      await page.setViewportSize({width:viewport,height:920});
      await page.evaluate(width => fixture.host.style.setProperty('--helper-width',width+'px'),panelWidth);
      await page.getByRole('tab',{name:'Flota',exact:true}).click();
      const before = await subnav.boundingBox();
      await page.evaluate(()=>{fixture.ui.scroll.scrollTop=99999;});
      const after = await subnav.boundingBox(); check(before.y===after.y,`subnav stays visible at ${viewport}/${panelWidth}`);
      await page.getByRole('tab',{name:'Imperio',exact:true}).click();
      check(await subnav.isHidden(),`subnav hidden outside fleet ${viewport}/${panelWidth}`);
      check(await page.evaluate(()=>{const shell=fixture.ui.section,empire=fixture.shadow.querySelector('.oldlight-empire');return document.documentElement.scrollWidth<=innerWidth&&shell.scrollWidth<=shell.clientWidth&&empire.scrollWidth<=empire.clientWidth;}),`no horizontal overflow ${viewport}/${panelWidth}`);
      const cols = await page.locator('.empire-goals').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);
      if(panelWidth<=360)check(cols===1,`goals follow panel width on a ${viewport}px screen`);
    }
    const goal=page.getByRole('spinbutton',{name:'Objetivo imperial de Marauder'});
    await goal.fill('-1'); await goal.press('Tab'); await page.evaluate(()=>fixture.empirePanel.render());
    check(await goal.inputValue()==='-1','invalid draft survives blur and render');
    check(await goal.getAttribute('aria-invalid')==='true','invalid field identified');
    await goal.fill('40'); await goal.press('Tab');check((await page.evaluate(()=>fixture.counts())).goal===40,'valid correction saved');
    await goal.focus();await goal.fill('41');await goal.fill('40');await goal.press('Tab');
    await page.evaluate(()=>fixture.remoteGoal(67));check(await goal.inputValue()==='67','no-op releases draft for later remote update');
    await page.evaluate(()=>fixture.setFail(true));await goal.fill('43');await goal.press('Tab');
    check(await goal.inputValue()==='43','save failure preserves attempted value');
    await page.evaluate(()=>fixture.setFail(false));await goal.fill('44');await goal.fill('43');await goal.press('Tab');
    check((await page.evaluate(()=>fixture.counts())).goal===43,'same failed value can be retried');
    await goal.fill('-2');await goal.press('Tab');
    await page.getByRole('tab',{name:'Datos',exact:true}).click();
    await page.evaluate(()=>{fixture.setScope('beta/other');fixture.setScope('alpha/player');});
    await page.getByRole('tab',{name:'Imperio',exact:true}).click();check(await goal.inputValue()==='43','hidden scope round-trip clears draft');
    const disclosure=page.locator('.empire-help');check(await disclosure.evaluate(node=>!node.open),'long help starts closed');
    await disclosure.locator('summary').focus();await page.keyboard.press('Enter');check(await disclosure.evaluate(node=>node.open),'help opens by keyboard');
    await page.getByRole('tab',{name:'Flota',exact:true}).click();await page.getByRole('tab',{name:'Mínimos',exact:true}).focus();
    await page.keyboard.press('ArrowRight');check(await page.getByRole('tab',{name:/Campañas:/}).getAttribute('aria-selected')==='true','subnav arrows select campaigns');
    await page.keyboard.press('End');check(await page.getByRole('tab',{name:/Misiones:/}).getAttribute('aria-selected')==='true','End selects missions');
    await page.keyboard.press('Home');check(await page.getByRole('tab',{name:'Mínimos',exact:true}).getAttribute('aria-selected')==='true','Home returns to minimums');
    check((await page.evaluate(()=>fixture.counts())).nativeKeys===0,'Helper keyboard does not reach global bubble listener');
    const out=process.env.UI_QA_DIR;
    if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'helper-fleet-narrow.png')});await page.getByRole('tab',{name:'Imperio',exact:true}).click();await page.screenshot({path:path.join(out,'helper-empire-narrow.png')});}
    check(requests.length===0,'zero external requests');check(errors.length===0,'zero browser runtime errors: '+errors.join(';'));
    console.log(JSON.stringify({checks,requests:requests.length,pageErrors:errors.length}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
