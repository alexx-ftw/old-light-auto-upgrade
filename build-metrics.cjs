'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'old-light-auto-upgrade.user.js');
const begin = '// BEGIN EMBEDDED METRICS CORE';
const end = '// END EMBEDDED METRICS CORE';
const metadataBegin = '// ==UserScript==';
const metadataEnd = '// ==/UserScript==';
const core = fs.readFileSync(path.join(__dirname, 'docs/metrics-core.js'), 'utf8').trim();
let source = fs.readFileSync(file, 'utf8');
const occurrences = marker => [...source.matchAll(new RegExp('^' + marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\r?$', 'gm'))];
const starts = occurrences(metadataBegin);
const finishes = occurrences(metadataEnd);
if (starts.length !== 1 || finishes.length !== 1 || starts[0].index >= finishes[0].index) {
  throw new Error('Userscript metadata must have one complete block.');
}
const offset = finishes[0].index + finishes[0][0].length;
const begins = occurrences(begin);
const ends = occurrences(end);
const embedded = begin + '\n' + core + '\n' + end;
if (begins.length === 1 && ends.length === 1 && begins[0].index >= offset && ends[0].index > begins[0].index) {
  const start = begins[0].index;
  const finish = ends[0].index + ends[0][0].length;
  source = source.slice(0, start) + embedded + source.slice(finish);
} else if (begins.length === 0 && ends.length === 0) {
  source = source.slice(0, offset) + '\n\n' + embedded + source.slice(offset);
} else {
  throw new Error('Embedded metrics markers are incomplete, duplicated, reversed, or inside metadata.');
}
fs.writeFileSync(file, source);
console.log('Embedded local metrics core into the userscript.');
