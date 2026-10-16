'use strict';
const fs = require('node:fs');
function summarize(d, knownNames) {
  if (d.scope !== 'diagnostic-observation-only' || d.releaseValidation !== false) throw Error('Diagnostic scope mismatch');
  if (!['passed', 'failed'].includes(d.status) || !/^[0-9a-f]{40}$/.test(d.input?.commit || '')) throw Error('Diagnostic metadata mismatch');
  const t = d.stages.tests, progress = t.progress || {};
  const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const duration = value => Number.isFinite(value) && value >= 0 ? value : null;
  const counts = t.counts ? Object.fromEntries(['tests','passed','failed','cancelled','skipped','todo','topLevel','suites'].filter(key => Number.isSafeInteger(t.counts[key]) && t.counts[key] >= 0).map(key => [key,t.counts[key]])) : null;
  const failures = (t.failureEvents || []).slice(0, 8).map(event => {
    const data = event.data || {}, error = data.details?.error || {};
    const message = typeof error.message === 'string' ? error.message : '';
    const kind = /^Native Chromium startup timeout/.test(message) ? 'browser-startup-timeout'
      : /^CDP timeout:/.test(message) ? 'cdp-command-timeout'
      : /test timed out/.test(message) ? 'node-test-timeout'
      : error.code === 'ERR_ASSERTION' ? 'assertion' : 'other';
    return { name: typeof data.name === 'string' && knownNames.has(data.name) ? data.name.slice(0, 240) : 'unlisted-test-name', kind };
  });
  return { releaseValidation: false, status: d.status, commit: d.input.commit, files: integer(t.fileCount),
    counts, elapsedMs: duration(progress.elapsedMs) ?? duration(t.durationMs),
    completedFiles: Array.isArray(progress.completedFiles) ? progress.completedFiles.length : null, remainingFiles: Array.isArray(progress.remainingFiles) ? progress.remainingFiles.length : null, failures };
}
module.exports = { summarize };
if (require.main === module) {
  const d = JSON.parse(fs.readFileSync(process.argv[2]));
  if (d.input?.commit !== process.env.GITHUB_SHA) throw Error('Diagnostic identity mismatch');
  const knownNames = new Set();
  for (const entry of d.stages.tests.files || []) {
    const file = typeof entry === 'string' ? entry : entry?.path;
    if (!/^tests\/[a-z0-9/-]+\.test\.cjs$/.test(file)) throw Error('Unexpected diagnostic source path');
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\btest\s*\(\s*(['"])(.*?)\1/g)) knownNames.add(match[2]);
  }
  console.log('DIAGNOSTIC_ONLY_GATE ' + JSON.stringify(summarize(d, knownNames)));
}
