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
  // passive observer's static source enters the page, before native boot.
  // Late/CSP-blocked injection never opens another socket or enables actions.
  if (document.readyState !== 'loading') return;
  try {
    const bridge = globalThis.OldLightEmpireBridgeFactory.create({ realm: globalThis, document,
      observer: globalThis.OldLightEmpireObserver, observerSource: ${JSON.stringify(sources.observer)} });
    Object.defineProperty(globalThis, 'OldLightEmpireBridge', { configurable: false, value: bridge });
  } catch (_) { /* The empire adapter stays unavailable; no credentials leave content-world. */ }
})();`;
let source = fs.readFileSync(file, 'utf8');
const metadataEnd = source.indexOf('// ==/UserScript==');
if (metadataEnd < 0) throw new Error('Missing metadata');
const offset = metadataEnd + '// ==/UserScript=='.length;
const first = source.indexOf(begin), last = source.indexOf(end);
const embedded = begin + '\n' + files.map(name => sources[name]).join('\n\n') + '\n\n' + bootstrap + '\n' + end;
if (first < 0 && last < 0) source = source.slice(0, offset) + '\n\n' + embedded + source.slice(offset);
else if (first >= offset && last > first && source.indexOf(begin, first + begin.length) < 0 && source.indexOf(end, last + end.length) < 0) source = source.slice(0, first) + embedded + source.slice(last + end.length);
else throw new Error('Invalid empire embedding markers');
fs.writeFileSync(file, source);
console.log('Embedded empire modules and isolated early bootstrap.');
