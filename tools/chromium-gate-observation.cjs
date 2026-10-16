'use strict';
// Never a supported release gate. Keep snapshot/syntax/builders and every test,
// but instrument the test subprocess through a declared in-memory transform.
const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), validator = path.join(root, 'validate-release.cjs');
function transform(source) {
  if (!source.startsWith('#!/usr/bin/env node\n')) throw Error('Diagnostic gate header changed');
  source = source.slice('#!/usr/bin/env node\n'.length);
  const replacements = [
    ["function nodeChild(args, cwd, env, timeout = 30000) {", "function nodeChild(args, cwd, env, timeout = 30000) {\n  if (args[0] === '--test') args = ['--require', " + JSON.stringify(path.join(__dirname, 'chromium-snapshot-preload.cjs')) + ", ...args];"],
    ["scope: 'offline-validation-only'", "scope: 'diagnostic-observation-only', releaseValidation: false"],
    ["if (require.main === module) main();", "return main();"],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw Error('Diagnostic gate transform boundary changed');
    source = source.replace(before, after);
  }
  return source;
}
module.exports = { transform };
if (require.main === module) {
  console.error('DIAGNOSTIC_ONLY: transformed gate observation; never release validation.');
  const run = new Function('require', 'module', 'exports', '__filename', '__dirname', transform(fs.readFileSync(validator, 'utf8')));
  const virtual = { exports: {} };
  Promise.resolve(run(createRequire(validator), virtual, virtual.exports, validator, root))
    .catch(() => { console.error('Diagnostic gate execution failed'); process.exitCode = 1; });
}
