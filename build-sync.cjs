'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'old-light-auto-upgrade.user.js');
const begin = '// BEGIN EMBEDDED SYNC CORE';
const end = '// END EMBEDDED SYNC CORE';
const core = fs.readFileSync(path.join(__dirname, 'docs/sync-core.js'), 'utf8').trim();
let source = fs.readFileSync(file, 'utf8');
const embedded = begin + '\n' + core + '\n' + end;
if (source.includes(begin)) {
  const start = source.indexOf(begin);
  const finish = source.indexOf(end, start) + end.length;
  source = source.slice(0, start) + embedded + source.slice(finish);
} else {
  const marker = '// ==/UserScript==';
  const offset = source.indexOf(marker) + marker.length;
  if (offset < marker.length) throw new Error('Userscript metadata not found');
  source = source.slice(0, offset) + '\n\n' + embedded + source.slice(offset);
}
fs.writeFileSync(file, source);
console.log('Embedded shared sync core into the userscript.');
