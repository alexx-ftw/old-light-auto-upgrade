'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..'), assets = ['drive.html', 'drive.js', 'drive.css', 'sync-core.js', 'index.html', 'privacy.html'];
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'oldlight-compat-')), repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.copyFileSync(path.join(root, 'prepare-rename-compat.cjs'), path.join(repo, 'prepare-rename-compat.cjs'));
  for (const file of assets) fs.copyFileSync(path.join(root, 'docs', file), path.join(repo, 'docs', file));
  const git = args => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Offline Test', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const run = out => spawnSync(process.execPath, [path.join(repo, 'prepare-rename-compat.cjs'), '--out', out], { encoding: 'utf8' });
  return { base, repo, git, run, commit() { git(['add', '.']); git(['-c', 'user.name=Offline Test', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'change']); } };
}
test('compatibility preparation copies the audited legacy Drive and entry-page assets with deterministic provenance and no deployment', t => {
  const h = fixture(t), out = path.join(h.base, 'package'); assert.equal(h.run(out).status, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json')));
  assert.equal(manifest.operation, 'offline-preparation-only'); assert.equal(manifest.assets.length, 6);
  assert.equal(manifest.sourceCommit, h.git(['rev-parse', 'HEAD']).toString().trim());
  for (const entry of manifest.assets) {
    const bytes = fs.readFileSync(path.join(out, entry.file));
    assert.deepEqual(bytes, fs.readFileSync(path.join(h.repo, 'docs', path.basename(entry.file))));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(entry.sha256, entry.sourceSha256); assert.equal(entry.legacyPathAdjusted, false);
  }
  const second = path.join(h.base, 'second'); assert.equal(h.run(second).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(out, 'manifest.json')), fs.readFileSync(path.join(second, 'manifest.json')));
});
test('future canonical companion is adapted only to the exact legacy path without changing OAuth or data identity', t => {
  const h = fixture(t), file = path.join(h.repo, 'docs/drive.js');
  const canonical = fs.readFileSync(file, 'utf8').replace("const HELPER_PATH = '/old-light-auto-upgrade/drive.html';", "const HELPER_PATH = '/old-light-helper/drive.html';");
  fs.writeFileSync(file, canonical); h.commit(); const out = path.join(h.base, 'package'); assert.equal(h.run(out).status, 0);
  const legacy = fs.readFileSync(path.join(out, 'old-light-auto-upgrade/drive.js'), 'utf8');
  assert.equal(legacy, canonical.replace("const HELPER_PATH = '/old-light-helper/drive.html';", "const HELPER_PATH = '/old-light-auto-upgrade/drive.html';"));
  const entry = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'))).assets.find(x => x.file.endsWith('/drive.js'));
  assert.equal(entry.legacyPathAdjusted, true); assert.notEqual(entry.sourceSha256, entry.sha256);
});
test('compatibility preparation refuses dirty checkout existing output and in-repository output', t => {
  const h = fixture(t); assert.notEqual(h.run(path.join(h.repo, 'output')).status, 0);
  fs.symlinkSync(h.repo, path.join(h.base, 'repo-link'));
  assert.notEqual(h.run(path.join(h.base, 'repo-link', 'hidden-output')).status, 0);
  assert.equal(fs.existsSync(path.join(h.repo, 'hidden-output')), false);
  const out = path.join(h.base, 'existing'); fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'keep'), 'unchanged');
  assert.notEqual(h.run(out).status, 0); assert.equal(fs.readFileSync(path.join(out, 'keep'), 'utf8'), 'unchanged');
  fs.appendFileSync(path.join(h.repo, 'docs/drive.js'), '\n// changed\n');
  const fresh = path.join(h.base, 'fresh'); assert.notEqual(h.run(fresh).status, 0); assert.equal(fs.existsSync(fresh), false);
});
test('compatibility preparation fails closed on unknown companion path or changed asset dependencies', t => {
  for (const kind of ['path', 'dependency']) {
    const h = fixture(t), file = path.join(h.repo, kind === 'path' ? 'docs/drive.js' : 'docs/drive.html');
    const value = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, kind === 'path' ? value.replace('/old-light-auto-upgrade/drive.html', '/unexpected/drive.html') : value.replace('./sync-core.js?', './new-dependency.js?')); h.commit();
    const out = path.join(h.base, 'package'); assert.notEqual(h.run(out).status, 0); assert.equal(fs.existsSync(out), false);
  }
});


test('compatibility preparation rejects committed symlink assets instead of packaging external bytes', t => {
  const h = fixture(t), outside = path.join(h.base, 'outside.css'), file = path.join(h.repo, 'docs/drive.css');
  fs.writeFileSync(outside, 'EXTERNAL_BYTES_NOT_IN_TREE'); fs.unlinkSync(file); fs.symlinkSync(outside, file); h.commit();
  const out = path.join(h.base, 'package'); assert.notEqual(h.run(out).status, 0); assert.equal(fs.existsSync(out), false);
});

test('compatibility preparation detects alternate HTML dependency syntax and CSS imports', t => {
  for (const addition of ['<script src = "./missing.js"></script>', '<SCRIPT SRC="./missing.js"></SCRIPT>', '@import "./missing.css";']) {
    const h = fixture(t), css = addition.startsWith('@'), file = path.join(h.repo, css ? 'docs/drive.css' : 'docs/drive.html');
    fs.appendFileSync(file, addition); h.commit(); const out = path.join(h.base, 'package');
    assert.notEqual(h.run(out).status, 0); assert.equal(fs.existsSync(out), false);
  }
});
