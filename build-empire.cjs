'use strict';
const fs = require('node:fs');
const path = require('node:path');
const files = ['core', 'runtime', 'panel', 'observer', 'adapter', 'bridge'];
const file = path.join(__dirname, 'old-light-auto-upgrade.user.js');
const begin = '// BEGIN EMBEDDED EMPIRE MODULES';
const end = '// END EMBEDDED EMPIRE MODULES';
const sources = Object.fromEntries(files.map(name => [name, fs.readFileSync(path.join(__dirname, `docs/empire-${name}.js`), 'utf8').trim()]));
const bootstrap = `(() => {
  'use strict';
  if (window.top !== window.self || !/^\\/game\\/galaxy\\/[A-Za-z0-9_-]{1,64}(?:\\/|$)/.test(location.pathname)) return;
  // Privileged Helper and Drive stay in the isolated content realm. Only the
  // passive observer's static source enters the page. Document readiness is
  // not socket readiness: deferred modules run after the HTML is parsed.
  // A complete validated native census, never timing, authorizes the adapter.
  const observedReadyState = document.readyState;
  const readyState = ['loading', 'interactive', 'complete'].includes(observedReadyState) ? observedReadyState : 'unknown';
  let phase = readyState === 'unknown' ? 'unavailable' : 'attempted';
  let error = readyState === 'unknown' ? 'ready-state-unavailable' : '';
  // This reader stays in the isolated realm. Only fixed diagnostic categories
  // are retained, never exception text, URLs, page objects or credentials.
  try {
    Object.defineProperty(globalThis, 'OldLightEmpireBootstrapStatus', { configurable: false,
      value: () => Object.freeze({ readyState, phase, error }) });
  } catch (_) { /* A diagnostic registration failure must not break the Helper. */ }
  if (readyState === 'unknown') return;
  try {
    const bridge = globalThis.OldLightEmpireBridgeFactory.create({ realm: globalThis, document,
      observer: globalThis.OldLightEmpireObserver, addElement: typeof GM_addElement === 'function' ? GM_addElement : null, observerSource: ${JSON.stringify(sources.observer)} });
    Object.defineProperty(globalThis, 'OldLightEmpireBridge', { configurable: false, value: bridge });
  } catch (_) { phase = 'unavailable'; error = 'bridge-create-failed'; }
})();`;
let source = fs.readFileSync(file, 'utf8');
const metadataEnd = source.indexOf('// ==/UserScript==');
if (metadataEnd < 0) throw new Error('Missing metadata');
const offset = metadataEnd + '// ==/UserScript=='.length;
const first = source.indexOf(begin), last = source.indexOf(end);
const reinforcement = ['core', 'runtime', 'map', 'panel'].map(name => fs.readFileSync(path.join(__dirname, `docs/reinforcement-${name}.js`), 'utf8').trim()).join('\n\n');
const conquest = ['core', 'controller', 'panel'].map(name => fs.readFileSync(path.join(__dirname, `docs/conquest-${name}.js`), 'utf8').trim()).join('\n\n');
const embedded = begin + '\n' + reinforcement + '\n\n' + conquest + '\n\n' + files.map(name => sources[name]).join('\n\n') + '\n\n' + bootstrap + '\n' + end;
if (first < 0 && last < 0) source = source.slice(0, offset) + '\n\n' + embedded + source.slice(offset);
else if (first >= offset && last > first && source.indexOf(begin, first + begin.length) < 0 && source.indexOf(end, last + end.length) < 0) source = source.slice(0, first) + embedded + source.slice(last + end.length);
else throw new Error('Invalid empire embedding markers');
fs.writeFileSync(file, source);
console.log('Embedded empire modules and isolated early bootstrap.');
