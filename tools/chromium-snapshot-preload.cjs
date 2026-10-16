'use strict';
// Diagnostic only: attach to the actual helper in the gate's immutable snapshot.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createObserver } = require('./chromium-startup-observation.cjs');
const file = process.argv[1] || '';
if (/^[a-z0-9-]+\.test\.cjs$/.test(path.basename(file))) {
  const helper = path.join(path.dirname(file), 'helpers/browser-process.cjs');
  if (!fs.existsSync(helper)) throw Error('Diagnostic snapshot browser helper missing');
  require(helper).launch = createObserver({
    directory: path.join(os.tmpdir(), 'oldlight-startup-observation'),
    source: fs.readFileSync(helper, 'utf8'),
  }).launch;
}
