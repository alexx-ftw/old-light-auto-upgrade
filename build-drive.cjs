'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'old-light-auto-upgrade.user.js');
const begin = '  // BEGIN EMBEDDED PRIVATE DRIVE RUNTIME';
const end = '  // END EMBEDDED PRIVATE DRIVE RUNTIME';
const runtime = fs.readFileSync(path.join(__dirname, 'docs/drive.js'), 'utf8').trim();
if (!runtime.startsWith('(function createDriveRuntime(runtimeOptions) {') || !runtime.endsWith('})();')) {
  throw new Error('Drive runtime factory boundaries changed. Review the embedding before release.');
}
const body = '  const createLocalDriveRuntime = ' + runtime.slice(0, -5) + '});';
let source = fs.readFileSync(file, 'utf8');
const start = source.indexOf(begin), finish = source.indexOf(end);
const embedded = begin + '\n' + body + '\n' + end;
if (start >= 0 && finish > start && source.indexOf(begin, start + begin.length) < 0 && source.indexOf(end, finish + end.length) < 0) {
  source = source.slice(0, start) + embedded + source.slice(finish + end.length);
} else if (start < 0 && finish < 0) {
  const anchor = '  // BEGIN DRIVE BACKUP';
  if (source.indexOf(anchor) < 0 || source.indexOf(anchor) !== source.lastIndexOf(anchor)) throw new Error('Drive integration anchor missing or duplicated.');
  source = source.replace(anchor, embedded + '\n\n' + anchor);
} else throw new Error('Embedded Drive runtime markers are incomplete or duplicated.');
fs.writeFileSync(file, source);
console.log('Embedded exact Drive runtime as a private userscript factory.');
