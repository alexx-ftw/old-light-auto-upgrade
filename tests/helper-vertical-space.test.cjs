'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'old-light-auto-upgrade.user.js'), 'utf8');
const start = source.indexOf('  function layoutHelper()');
const layout = source.slice(start, source.indexOf('  function bindPointerDrag(', start));
function harness(height = 1038, position = { x: 415, y: 74 }) {
  const style = () => { const data = new Map(); return {getPropertyValue:k=>data.get(k)||'',setProperty:(k,v)=>data.set(k,v),removeProperty:k=>data.delete(k)}; };
  const node = () => ({style:style(),setAttribute(){},classList:{toggle(){}},value:'',textContent:''});
  const settings = {panelWidth:560,panelPosition:position,minimized:false};
  const ui = {section:node(),panelWidth:node(),panelWidthValue:node(),resize:node(),minimize:node()};
  const host = {isConnected:true,style:style()};
  const context = vm.createContext({settings,ui,host,innerWidth:1253,innerHeight:height,setText:(n,v)=>n.textContent=v});
  ui.section.getBoundingClientRect = () => ({width:Math.min(560,context.innerWidth-24),height:settings.minimized?54:context.innerHeight-Number.parseFloat(ui.section.style.getPropertyValue('--helper-top')||'12')-12});
  vm.runInContext(layout+';this.layout=layoutHelper;',context);
  return {settings,ui,host,context,run:()=>context.layout()};
}
test('expanded shell uses available viewport height instead of the fixed 720px ceiling', () => {
  const css=source.slice(source.indexOf('.helper-shell {'),source.indexOf('.helper-header {'));
  assert.match(css,/height:calc\(100dvh - var\(--helper-top,12px\) - 12px\)/);
  assert.doesNotMatch(css,/720px/);
});
test('saved top anchor fills the tall viewport down to its bottom margin', () => {
  const h=harness();h.run();assert.equal(h.ui.section.style.getPropertyValue('--helper-top'),'74px');
  assert.equal(h.host.style.getPropertyValue('top'),'74px');assert.equal(h.ui.section.getBoundingClientRect().height,952);
});
test('default bottom anchored panel clears an old top offset after reset', () => {
  const h=harness();h.run();h.settings.panelPosition=null;h.run();
  assert.equal(h.ui.section.style.getPropertyValue('--helper-top'),'12px');
  for(const key of ['left','top','right','bottom'])assert.equal(h.host.style.getPropertyValue(key),'');
});
test('low windows clamp the anchor to retain an accessible expanded body', () => {
  const h=harness(400,{x:415,y:900});h.run();
  assert.equal(h.host.style.getPropertyValue('top'),'28px');assert.equal(h.ui.section.getBoundingClientRect().height,360);
  h.context.innerHeight=280;h.run();assert.equal(h.host.style.getPropertyValue('top'),'12px');
  assert.equal(h.ui.section.getBoundingClientRect().height,256);
});
test('minimized panel remains movable near bottom and restores with usable content', () => {
  const h=harness(1038,{x:415,y:950});h.settings.minimized=true;h.run();
  assert.equal(h.host.style.getPropertyValue('top'),'950px');
  h.settings.minimized=false;h.run();assert.equal(h.host.style.getPropertyValue('top'),'666px');
  assert.equal(h.ui.section.getBoundingClientRect().height,360);
});
test('moving the top anchor recomputes remaining height and repeated layout is stable', () => {
  const h=harness();h.run();h.settings.panelPosition.y=200;h.run();
  assert.equal(h.ui.section.style.getPropertyValue('--helper-top'),'200px');
  assert.equal(h.ui.section.getBoundingClientRect().height,826);
  for(let i=0;i<20;i++)h.run();assert.equal(h.settings.panelPosition.y,200);
});
test('viewport growth expands content without changing the saved top anchor', () => {
  const h=harness();h.run();h.context.innerHeight=1440;h.run();
  assert.equal(h.settings.panelPosition.y,74);assert.equal(h.ui.section.getBoundingClientRect().height,1354);
});
