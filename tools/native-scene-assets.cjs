'use strict';
// Explicit read-only provisioning, never called by the offline release gate.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const manifestFile = path.join(__dirname, '../tests/fixtures/native-galaxy-assets.json');
const manifestBytes = fs.readFileSync(manifestFile), manifest = JSON.parse(manifestBytes);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const directory = path.join(os.tmpdir(), 'oldlight-native-scene-' + digest(manifestBytes).slice(0, 16));
function readAsset(name) {
  if (!Object.hasOwn(manifest, name) || !/^[A-Za-z0-9_-]+\.js$/.test(name)) throw Error('Asset outside pinned native graph');
  const data = fs.readFileSync(path.join(directory, name)), expected = manifest[name];
  if (data.length !== expected.bytes || digest(data) !== expected.sha256) throw Error('Native asset integrity mismatch: ' + name);
  return data;
}
function verify() {
  try { for (const name of Object.keys(manifest)) readAsset(name); }
  catch (error) { throw Error('Native asset cache unavailable or changed; provision explicitly with node tools/native-scene-assets.cjs before the offline gate. ' + error.message); }
  return directory;
}
function offlineGalaxy() {
  const source = readAsset('galaxy-CqK10P8m.js').toString('utf8');
  const marker = '}Oy().catch(e=>{';
  const index = source.lastIndexOf(marker);
  if (index < 0 || source.indexOf(marker) !== index) throw Error('Native boot boundary changed');
  // Keep every native declaration/method, remove only automatic authenticated
  // boot invocation, append exports used by the synthetic scene entrypoint.
  return source.slice(0, index + 1) + '\nexport {An as World,pt as Controller,ee as App,te as Container,re as Graphics,E as Sprite,_e as Grid,Ce as Transits,Sg as Selection,nn as Sectors,Ev as SectorCache,Sl as Hover,Rd as Actions,Ty as vignette,ne as priority,Ee as setConfig,F as palette,P as axial,N as camera};\n';
}
async function provision() {
  fs.mkdirSync(directory, { recursive: true });
  const names = Object.keys(manifest);
  for (let start = 0; start < names.length; start += 6) await Promise.all(names.slice(start, start + 6).map(async name => {
    const file = path.join(directory, name);
    if (fs.existsSync(file)) { readAsset(name); return; }
    const response = await fetch('https://oldlight.io/assets/' + name, { redirect: 'error' });
    if (!response.ok) throw Error('Public native asset unavailable: ' + name + ' HTTP' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer()), expected = manifest[name];
    if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) throw Error('Downloaded native asset mismatch: ' + name);
    const temporary = file + '.tmp-' + process.pid;
    try { fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, file); } finally { fs.rmSync(temporary, { force: true }); }
  }));
  return verify();
}
if (require.main === module) provision().then(dir => console.log('Verified ' + Object.keys(manifest).length + ' public native modules at ' + dir)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { manifest, directory, digest, readAsset, verify, offlineGalaxy };
