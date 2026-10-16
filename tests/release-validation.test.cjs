'use strict';

// These fixtures invoke the actual CLI against tiny committed repositories.
// None copies the project's test suite, so the full gate does not recurse.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { parseTests, parseFeedback } = require('../validate-release.cjs');
const gateSource = fs.readFileSync(path.join(__dirname, '..', 'validate-release.cjs'));
const builders = ['sync', 'empire', 'drive', 'metrics'].map(name => `build-${name}.cjs`);
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(?:QA_|OLD_LIGHT_|GIT_|NODE_OPTIONS$|NODE_PATH$|NODE_TEST_|NODE_V8_COVERAGE$)/.test(name)));

function run(command, args, cwd, env = cleanEnv) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
}
function git(root, ...args) {
  const result = run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], root);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixtureFeedback(name = 'fixture passes') {
  const regression = { file: 'tests/nested/sample.test.cjs', name };
  return { schemaVersion: 1, entries: [{ id: 'fixture-feedback', feedback: 'Fixture for the required review record.',
    beforeFail: { revision: 'a'.repeat(40), command: 'node --test tests/nested/sample.test.cjs',
      observedFailure: 'Recorded fixture failure before its correction.', evidence: 'docs/release-evidence.md' },
    regressions: [regression],
    boundaries: [{ scenario: 'Fixture boundary condition', expected: 'The asserted condition holds.', regression }],
    qaGaps: [{ scope: 'Real browser', reason: 'This fixture executes only Node tests.' }],
    independentReviewCriteria: ['Check the recorded failure and the behavior outside the corrected condition.'],
  }] };
}
function fixture(t, edits = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'oldlight-gate-fixture-'));
  const root = path.join(parent, 'repo');
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const files = {
    'validate-release.cjs': gateSource,
    'docs/review-feedback.json': JSON.stringify(fixtureFeedback()),
    'docs/release-evidence.md': 'Synthetic fixture record. Not evidence for a real release.\n',
    'old-light-auto-upgrade.user.js': '// ==UserScript==\n// @version 1.15.1\n// ==/UserScript==\nconst SCRIPT_VERSION = \'1.15.1\';\nfunction helperChangelogEntries() { return [{ version: \'1.15.1\' }]; }\n',
    'old-light-auto-upgrade.meta.js': '// ==UserScript==\n// @version 1.15.1\n// ==/UserScript==\n',
    'tests/nested/sample.test.cjs': "const test = require('node:test'); test('fixture passes', () => {});\n",
    'tests/separate.browser.cjs': "throw new Error('Browser-only fixture must not execute');\n",
    'docs/asset.js': "'use strict';\n",
    'docs/index.html': '<script src="asset.js?v=1.11.0"></script>\n',
    ...Object.fromEntries(builders.map(name => [name, "'use strict';\n"])), ...edits,
  };
  for (const [name, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    if (contents !== null) fs.writeFileSync(path.join(root, name), contents);
  }
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'Offline gate fixture');
  git(root, 'config', 'user.email', 'offline-fixture@example.invalid');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'Fixture');
  return { root, parent };
}
function invoke(root, args = [], extraEnv = {}) {
  const result = run(process.execPath, [path.join(root, 'validate-release.cjs'), ...args], root, { ...cleanEnv, ...extraEnv });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  let report;
  try { report = JSON.parse(result.stdout); } catch { assert.fail(`CLI did not emit JSON: ${result.stdout}\n${result.stderr}`); }
  return { result, report };
}
function fails(root, pattern, args = [], env = {}) {
  const { result, report } = invoke(root, args, env);
  assert.equal(result.status, 1, JSON.stringify(report));
  assert.equal(report.status, 'failed');
  assert.match(report.errors.join('\n'), pattern);
  return report;
}

test('CLI validates a recursive committed fixture and records all offline evidence', t => {
  const { root, parent } = fixture(t);
  const target = path.join(parent, 'result.json');
  const { result, report } = invoke(root, ['--report', target]);
  assert.equal(result.status, 0, JSON.stringify(report));
  assert.equal(report.status, 'passed');
  assert.equal(report.scope, 'offline-validation-only');
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), report);
  assert.equal(report.input.commit, git(root, 'rev-parse', 'HEAD'));
  assert.equal(report.input.tree, git(root, 'rev-parse', 'HEAD^{tree}'));
  assert.match(report.input.manifestSha256, /^[a-f0-9]{64}$/);
  assert.ok(report.input.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.deepEqual(report.stages.tests.files.map(file => file.path), ['tests/nested/sample.test.cjs']);
  assert.equal(report.stages.tests.counts.tests, 1);
  assert.equal(report.stages.tests.progress.timeoutMs, 420000);
  assert.equal(report.stages.tests.execution.fileConcurrency, 1);
  assert.ok(report.stages.tests.execution.start.logicalCpuCount > 0);
  assert.equal(report.stages.tests.execution.start.hostLoadAverage.length, 3);
  assert.equal(report.stages.tests.execution.end.hostLoadAverage.length, 3);
  assert.match(report.stages.tests.command, /--test-timeout=120000/);
  assert.deepEqual(report.stages.tests.progress.completedFiles.map(file => file.path), ['tests/nested/sample.test.cjs']);
  assert.equal(report.stages.tests.progress.lastPasses.at(-1).name, 'fixture passes');
  assert.equal(report.stages.feedbackManifest.scope, 'schema-and-tracked-links-only');
  assert.equal(report.stages.feedbackManifest.independentReview, 'required-separately');
  assert.deepEqual(report.stages.tests.regressionPasses, [{ file: 'tests/nested/sample.test.cjs', name: 'fixture passes', status: 'passed' }]);
  assert.equal(report.stages.syntax.count, 10);
  assert.equal(report.stages.builders.runs.length, 8);
  assert.deepEqual(report.stages.builders.runs.map(run => run.builder), [...builders, ...builders]);
  assert.equal(report.stages.finalIntegrity.originalAndSnapshotUnchanged, true);
  assert.deepEqual(report.notRun.map(item => item.path), ['tests/separate.browser.cjs']);
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('exact release versions reject mismatch and duplicate metadata', t => {
  for (const text of ['// ==UserScript==\n// @version 1.15.0\n// ==/UserScript==\n',
    '// ==UserScript==\n// @version 1.15.1\n// @version 1.15.1\n// ==/UserScript==\n']) {
    const { root } = fixture(t, { 'old-light-auto-upgrade.meta.js': text });
    fails(root, /version mismatch|exactly one meta file @version/);
  }
});


test('equal release versions still require identical complete metadata headers', t => {
  const { root } = fixture(t, { 'old-light-auto-upgrade.meta.js': '// ==UserScript==\n// @version 1.15.1\n// @grant GM_setValue\n// ==/UserScript==\n' });
  fails(root, /metadata headers differ/);
});

test('unsupported test extensions and zero-file test inventories are rejected', t => {
  for (const extension of ['js', 'mjs']) {
    const { root } = fixture(t, { [`tests/forgotten.test.${extension}`]: "throw Error('must not silently omit');" });
    fails(root, /Unsupported test entry format/);
  }
  const { root } = fixture(t, { 'tests/nested/sample.test.cjs': null });
  fails(root, /No tracked \*.test.cjs/);
});

test('TypeScript and JSX test entries cannot silently disappear from a green suite', t => {
  // Node 24 can execute TS/CTS/MTS entries, while this repository gate only
  // supports CJS. Reject unsupported executable test formats before syntax or
  // suite execution rather than counting a smaller CJS-only suite as complete.
  for (const extension of ['ts', 'cts', 'mts', 'jsx', 'tsx']) {
    const { root } = fixture(t, { [`tests/nested/forgotten.test.${extension}`]: "throw Error('must not silently omit');" });
    const report = fails(root, /Unsupported test entry format/);
    assert.equal(report.stages.snapshot.status, 'failed');
    assert.equal(report.stages.tests.status, 'not-run');
    assert.equal(git(root, 'status', '--porcelain'), '');
  }
});

test('builder unsuccessful exits and signals fail the gate', t => {
  for (const source of ['process.exit(2);', "process.kill(process.pid, 'SIGTERM');"]) {
    const { root } = fixture(t, { 'build-sync.cjs': source });
    const report = fails(root, /build-sync.cjs, pass 1 failed/);
    assert.equal(report.stages.builders.runs.length, 1);
  }
});

test('syntax gate includes nested JS outside tests and the separate browser file', t => {
  const { root } = fixture(t, { 'docs/nested/broken.js': 'const = ;' });
  const report = fails(root, /Syntax docs\/nested\/broken.js failed/);
  assert.equal(report.stages.tests.status, 'not-run');
});

test('runtime omissions, focused sources, zero tests and premature successful exit cannot pass', t => {
  const cases = [
    ["const t=require('node:test'); t.skip('omitted',()=>{});", /omissions/],
    ["const t=require('node:test'); t.todo('unfinished');", /omissions/],
    ["const t=require('node:test'); t.only('focused',()=>{}); t('ordinary',()=>{});", /Focused/],
    ["const t=require('node:test'); t('focused',{only:true},()=>{});", /Focused/],
    ["const t=require('node:test'); t('unfinished',{timeout:20},()=>new Promise(()=>{}));", /Complete test suite failed/],
    ["const t=require('node:test'); t('completed before failure',()=>{}); t('failure',()=>{throw Error('fixture');});", /Complete test suite failed/],
    ["const t=require('node:test'); t.describe('empty',()=>{});", /zero tests/],
    ['// no tests', /Incomplete test report/],
    ['process.exit(0);', /Incomplete test report/],
    ["console.log(JSON.stringify({type:'test:summary',data:{success:true}}));process.exit(0);", /Incomplete test report/],
  ];
  for (const [source, expected] of cases) {
    const { root } = fixture(t, { 'tests/nested/sample.test.cjs': source });
    const report = fails(root, expected);
    if (source.includes("throw Error('fixture')")) {
      assert.ok(report.stages.tests.failureEvents.length > 0);
      assert.equal(report.stages.tests.progress.lastPasses.at(-1).name, 'completed before failure');
      assert.deepEqual(report.stages.tests.progress.completedFiles.map(file => file.path), ['tests/nested/sample.test.cjs']);
    }
  }
});

test('every builder must preserve every input on its first pass', t => {
  for (const builder of builders) {
    const { root } = fixture(t, { [builder]: "require('node:fs').appendFileSync('old-light-auto-upgrade.user.js','\\n// stale output repaired');" });
    const original = fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8');
    const report = fails(root, /Snapshot changed during checks/);
    assert.equal(report.stages.builders.runs.at(-1).builder, builder);
    assert.equal(report.stages.builders.runs.at(-1).pass, 1);
    assert.equal(fs.readFileSync(path.join(root, 'old-light-auto-upgrade.user.js'), 'utf8'), original);
    assert.equal(git(root, 'status', '--porcelain'), '');
  }
});

test('second-pass drift and builder-created files are rejected', t => {
  const counterRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oldlight-gate-counter-'));
  t.after(() => fs.rmSync(counterRoot, { recursive: true, force: true }));
  const counter = path.join(counterRoot, 'count');
  const { root } = fixture(t, { 'build-metrics.cjs': `const fs=require('node:fs');const p=${JSON.stringify(counter)};
    if(fs.existsSync(p)) fs.appendFileSync('docs/asset.js','// second-pass drift'); else fs.writeFileSync(p,'first');` });
  const report = fails(root, /Snapshot changed during checks/);
  assert.equal(report.stages.builders.runs.at(-1).pass, 2);
  const other = fixture(t, { 'build-sync.cjs': "require('node:fs').writeFileSync('extra.txt','unexpected');" });
  fails(other.root, /Snapshot inventory changed/);
});

test('tests cannot mutate the snapshot or original source without a failed gate', t => {
  const { root } = fixture(t, { 'tests/nested/sample.test.cjs': "const t=require('node:test');t('mutates',()=>require('node:fs').appendFileSync('docs/asset.js','\\n// changed'));" });
  fails(root, /Snapshot changed/);
  assert.equal(fs.readFileSync(path.join(root, 'docs/asset.js'), 'utf8'), "'use strict';\n");
  const other = fixture(t);
  const target = path.join(other.root, 'docs/asset.js');
  fs.writeFileSync(path.join(other.root, 'tests/nested/sample.test.cjs'),
    `const t=require('node:test');t('mutates original',()=>require('node:fs').appendFileSync(${JSON.stringify(target)},'changed'));`);
  git(other.root, 'add', '.'); git(other.root, 'commit', '--quiet', '-m', 'Mutation fixture');
  const report = fails(other.root, /clean committed checkout|Original input tree changed/);
  assert.equal(report.stages.finalIntegrity.status, 'failed');
});

test('dirty, untracked, ignored and hidden tracked-byte changes are rejected', t => {
  const cases = [
    root => fs.appendFileSync(path.join(root, 'docs/asset.js'), '// dirty'),
    root => fs.writeFileSync(path.join(root, 'extra.test.cjs'), '// untracked'),
    root => { fs.writeFileSync(path.join(root, '.git/info/exclude'), 'ignored.txt\n'); fs.writeFileSync(path.join(root, 'ignored.txt'), 'ignored'); },
    root => { git(root, 'update-index', '--assume-unchanged', 'docs/asset.js'); fs.appendFileSync(path.join(root, 'docs/asset.js'), '// hidden'); },
    root => { git(root, 'update-index', '--skip-worktree', 'docs/asset.js'); fs.appendFileSync(path.join(root, 'docs/asset.js'), '// hidden'); },
  ];
  for (const change of cases) {
    const { root } = fixture(t); change(root);
    fails(root, /clean committed checkout|differs from HEAD/);
  }
});

test('tracked symlinks and replacement directory symlinks are rejected', t => {
  const { root, parent } = fixture(t);
  fs.symlinkSync(path.join(parent, 'outside'), path.join(root, 'linked'));
  git(root, 'add', 'linked'); git(root, 'commit', '--quiet', '-m', 'Symlink fixture');
  fails(root, /Symlinks\/submodules/);
  const other = fixture(t);
  fs.renameSync(path.join(other.root, 'docs'), path.join(other.parent, 'docs'));
  fs.symlinkSync(path.join(other.parent, 'docs'), path.join(other.root, 'docs'));
  fails(other.root, /clean committed checkout|Symlink/);
});

test('source and Node environment overrides and focused CLI arguments are refused', t => {
  const { root } = fixture(t);
  for (const name of ['QA_ATTACK_RETRY_SOURCE', 'QA_HELPER_KEYBOARD_SOURCE', 'OLD_LIGHT_PIPELINE_RUNTIME', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_TEST_CONTEXT']) {
    const report = fails(root, /Unsafe inherited environment/, [], { [name]: name === 'NODE_OPTIONS' ? '--no-warnings' : 'unsafe-source' });
    assert.deepEqual(report.environment.rejectedNames, [name]);
    assert.equal(JSON.stringify(report).includes('unsafe-source'), false, 'Rejected source values must not leak into the report');
  }
  for (const args of [['--test-only'], ['--test-name-pattern=one'], ['tests/nested/sample.test.cjs'], ['--report', '/tmp/example.json', '--test-only']]) {
    fails(root, /Only --report PATH/, args);
  }
  const { result, report } = invoke(root, [], { GIT_WORK_TREE: '/does/not/exist', GIT_INDEX_FILE: '/does/not/exist' });
  assert.equal(result.status, 0, JSON.stringify(report));
  assert.deepEqual(report.environment.scrubbedNames, ['GIT_INDEX_FILE', 'GIT_WORK_TREE']);
});

test('report paths cannot overwrite files, write into source or follow a parent symlink into source', t => {
  const { root, parent } = fixture(t);
  const existing = path.join(parent, 'existing.json'); fs.writeFileSync(existing, 'keep me');
  fails(root, /already exists/, ['--report', existing]);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'keep me');
  for (const filename of [path.join(root, 'old-light-auto-upgrade.user.js'), path.join(root, 'new.json')]) {
    fails(root, /outside the repository/, ['--report', filename]);
  }
  assert.equal(fs.existsSync(path.join(root, 'new.json')), false);
  fs.symlinkSync(root, path.join(parent, 'source-link'));
  fails(root, /outside the repository/, ['--report', path.join(parent, 'source-link', 'new.json')]);
  fails(root, /must be absolute/, ['--report', 'relative.json']);
  assert.equal(git(root, 'status', '--porcelain'), '');
});


test('report parent replacement during checks cannot write into the input tree or pass', t => {
  const { root, parent } = fixture(t);
  const reportDirectory = path.join(parent, 'reports');
  fs.mkdirSync(reportDirectory);
  fs.writeFileSync(path.join(root, 'tests/nested/sample.test.cjs'), `
    const test=require('node:test'), fs=require('node:fs');
    test('changes report parent',()=>{
      fs.renameSync(${JSON.stringify(reportDirectory)}, ${JSON.stringify(reportDirectory + '-original')});
      fs.symlinkSync(${JSON.stringify(root)}, ${JSON.stringify(reportDirectory)});
    });`);
  git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'Report path mutation fixture');
  fails(root, /Report parent changed/, ['--report', path.join(reportDirectory, 'result.json')]);
  assert.equal(fs.existsSync(path.join(root, 'result.json')), false);
  assert.equal(git(root, 'status', '--porcelain'), '');
});


test('benign diagnostic prose is allowed and executable metadata tails are refused', t => {
  const { root } = fixture(t, { 'tests/nested/sample.test.cjs':
    "const t=require('node:test');t('diagnostic',context=>context.diagnostic('This fixture supports only one user.'));",
    'docs/review-feedback.json': JSON.stringify(fixtureFeedback('diagnostic')) });
  const { result, report } = invoke(root);
  assert.equal(result.status, 0, JSON.stringify(report));
  const other = fixture(t, { 'old-light-auto-upgrade.meta.js':
    '// ==UserScript==\n// @version 1.15.1\n// ==/UserScript==\nthrow Error("extra executable code");\n' });
  fails(other.root, /Meta file must contain only/);
});

test('snapshot creation rejects a temporary directory inside the checkout', t => {
  const { root } = fixture(t);
  fails(root, /Temporary directory must be outside/, [], { TMPDIR: root, TEMP: root, TMP: root });
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('a timed-out builder leaves no running ordinary descendant with inherited pipes', t => {
  const { root, parent } = fixture(t);
  const pidFile = path.join(parent, 'descendant.pid');
  let pid;
  t.after(() => { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} } });
  fs.writeFileSync(path.join(root, 'build-sync.cjs'), `
    const {spawn}=require('node:child_process'),fs=require('node:fs');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
    fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));
    process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
  git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'Timeout descendant fixture');
  let report;
  try { report = fails(root, /Timed out after 30000ms/); }
  finally { if (fs.existsSync(pidFile)) pid = Number(fs.readFileSync(pidFile, 'utf8')); }
  assert.equal(report.stages.builders.runs[0].signal, 'SIGKILL');
  assert.ok(Number.isInteger(pid) && pid > 0);
  let alive = false;
  try {
    process.kill(pid, 0);
    // A killed child can briefly remain an inert zombie until its new parent
    // reaps it. It is no longer a running process or holder of output pipes.
    alive = process.platform !== 'linux' || !/\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch (error) { assert.ok(['ESRCH', 'ENOENT'].includes(error.code), error.message); }
  assert.equal(alive, false, `descendant ${pid} is still running`);
  assert.equal(git(root, 'status', '--porcelain'), '');
});


test('SIGTERM cancellation cleans the active process group and emits a failed report', async t => {
  const { root, parent } = fixture(t);
  const pidFile = path.join(parent, 'builder.pid');
  fs.writeFileSync(path.join(root, 'build-sync.cjs'), `
    const {spawn}=require('node:child_process'),fs=require('node:fs');
    spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
    fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
  git(root, 'add', '.'); git(root, 'commit', '--quiet', '-m', 'Cancellation fixture');
  const processChild = spawn(process.execPath, [path.join(root, 'validate-release.cjs')], { cwd: root, env: cleanEnv });
  let group, stdout = '', stderr = '';
  processChild.stdout.on('data', bytes => { stdout += bytes; });
  processChild.stderr.on('data', bytes => { stderr += bytes; });
  const completion = new Promise(resolve => processChild.on('close', (code, signal) => resolve({ code, signal })));
  const timer = setTimeout(() => {
    processChild.kill('SIGKILL');
    if (group) { try { process.kill(-group, 'SIGKILL'); } catch {} }
  }, 15000);
  try {
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(fs.existsSync(pidFile), 'Builder did not start before cancellation deadline.');
    group = Number(fs.readFileSync(pidFile, 'utf8'));
    processChild.kill('SIGTERM');
    const { code, signal } = await completion;
    assert.equal(code, 1, stderr); assert.equal(signal, null);
    const report = JSON.parse(stdout);
    assert.equal(report.status, 'failed'); assert.equal(report.interruptedBy, 'SIGTERM');
    assert.equal(git(root, 'status', '--porcelain'), '');
  } finally {
    clearTimeout(timer); processChild.kill('SIGKILL');
    if (group) { try { process.kill(-group, 'SIGKILL'); } catch {} }
  }
});


test('SIGINT and SIGTERM during a nested fixture gate also clean its detached builder group', async t => {
  for (const terminationSignal of ['SIGINT', 'SIGTERM']) {
    const inner = fixture(t), outer = fixture(t);
    const pidFile = path.join(inner.parent, 'nested-processes.json');
    fs.writeFileSync(path.join(inner.root, 'build-sync.cjs'), `
      const {spawn}=require('node:child_process'),fs=require('node:fs');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
      fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({group:process.pid,child:child.pid}));
      process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
    git(inner.root, 'add', '.'); git(inner.root, 'commit', '--quiet', '-m', 'Nested hanging builder');
    fs.writeFileSync(path.join(outer.root, 'tests/nested/sample.test.cjs'), `
      const test=require('node:test'),{spawnSync}=require('node:child_process');
      test('runs a tiny nested fixture gate',()=>{
        const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('NODE_TEST_'))delete env[key];
        spawnSync(process.execPath,[${JSON.stringify(path.join(inner.root, 'validate-release.cjs'))}],
          {cwd:${JSON.stringify(inner.root)},env,encoding:'utf8'});
      });`);
    git(outer.root, 'add', '.'); git(outer.root, 'commit', '--quiet', '-m', 'Outer nested fixture');
    const processChild = spawn(process.execPath, [path.join(outer.root, 'validate-release.cjs')], { cwd: outer.root, env: cleanEnv });
    let processes, stdout = '';
    processChild.stdout.on('data', bytes => { stdout += bytes; }); processChild.stderr.resume();
    const completion = new Promise(resolve => processChild.on('close', (code, signal) => resolve({code, signal})));
    const cleanup = () => {
      processChild.kill('SIGKILL');
      if (processes) { try { process.kill(-processes.group, 'SIGKILL'); } catch {} }
    };
    const timer = setTimeout(cleanup, 15000);
    try {
      const deadline = Date.now() + 10000;
      while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(fs.existsSync(pidFile), 'Nested builder did not start.');
      processes = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
      processChild.kill(terminationSignal);
      const {code, signal} = await completion;
      assert.equal(code, 1); assert.equal(signal, null);
      const report = JSON.parse(stdout);
      assert.equal(report.status, 'failed'); assert.equal(report.interruptedBy, terminationSignal);
      for (const pid of [processes.group, processes.child]) {
        let running = false;
        try {
          process.kill(pid, 0);
          running = process.platform !== 'linux' || !/\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
        } catch (error) { assert.ok(['ESRCH','ENOENT'].includes(error.code), error.message); }
        assert.equal(running, false, `Nested process ${pid} survived ${terminationSignal}`);
      }
      assert.equal(git(inner.root, 'status', '--porcelain'), '');
      assert.equal(git(outer.root, 'status', '--porcelain'), '');
    } finally { clearTimeout(timer); cleanup(); }
  }
});

test('structured report validation rejects duplicates, inconsistent totals and missing summaries', () => {
  const counts = { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0, topLevel: 1 };
  const file = { type: 'test:summary', data: { success: true, counts, file: '/snapshot/tests/one.test.cjs' } };
  const total = { type: 'test:summary', data: { success: true, counts } };
  const encode = events => events.map(event => JSON.stringify(event)).join('\n');
  const parse = events => parseTests(encode(events), ['tests/one.test.cjs'], '/snapshot');
  assert.equal(parse([file, total]).counts.tests, 1);
  for (const records of [[file], [total], [file, total, total], [file, file, total],
    [file, { ...total, data: { ...total.data, counts: { ...counts, tests: 2, passed: 2 } } }]]) {
    assert.throws(() => parse(records), /Incomplete test report/);
  }
  assert.throws(() => parseTests('not JSON', [], '/snapshot'), SyntaxError);
});


test('feedback manifest rejects missing records, unknown fields and untracked regression or evidence links', () => {
  const names = ['tests/nested/sample.test.cjs', 'docs/release-evidence.md'];
  const parse = value => parseFeedback(value, names, ['tests/nested/sample.test.cjs']);
  assert.equal(parse(fixtureFeedback()).regressions.length, 1);
  const changes = [
    value => { value.schemaVersion = 2; },
    value => { value.entries = []; },
    value => { value.extra = 'unknown schema field'; },
    value => { value.entries.push(structuredClone(value.entries[0])); },
    value => { value.entries[0].feedback = ' '; },
    value => { value.entries[0].beforeFail.revision = 'short-hash'; },
    value => { value.entries[0].beforeFail.command = ''; },
    value => { value.entries[0].beforeFail.observedFailure = ''; },
    value => { value.entries[0].beforeFail.evidence = 'missing.md'; },
    value => { value.entries[0].beforeFail.evidence = '../outside.md'; },
    value => { value.entries[0].regressions = []; },
    value => { value.entries[0].regressions[0].file = 'tests/missing.test.cjs'; },
    value => { value.entries[0].regressions[0].file = 'docs/release-evidence.md'; },
    value => { value.entries[0].regressions[0].name = ''; },
    value => { value.entries[0].regressions.push({ ...value.entries[0].regressions[0] }); },
    value => { value.entries[0].boundaries = []; },
    value => { value.entries[0].boundaries[0].scenario = ''; },
    value => { value.entries[0].boundaries[0].expected = ''; },
    value => { value.entries[0].boundaries[0].regression = { file: names[0], name: 'unlinked case' }; },
    value => { delete value.entries[0].qaGaps; },
    value => { value.entries[0].qaGaps = [{ scope: 'browser', reason: '' }]; },
    value => { value.entries[0].independentReviewCriteria = []; },
    value => { value.entries[0].independentReviewCriteria = ['']; },
  ];
  for (const change of changes) {
    const value = fixtureFeedback(); change(value);
    assert.throws(() => parse(value), /feedback|Feedback|tracked path/);
  }
  const noKnownGaps = fixtureFeedback(); noKnownGaps.entries[0].qaGaps = [];
  assert.equal(parse(noKnownGaps).manifest.entries[0].qaGaps.length, 0);
});

test('CLI fails closed on missing or malformed feedback and regressions that did not execute', t => {
  for (const [contents, pattern] of [[null, /Required tracked feedback manifest missing/],
    ['{malformed', /JSON|property name/],
    [JSON.stringify(fixtureFeedback('never registered')), /Feedback regression must execute exactly once and pass/]]) {
    const { root } = fixture(t, { 'docs/review-feedback.json': contents });
    const report = fails(root, pattern);
    assert.equal(report.stages.builders.status, 'not-run');
    assert.equal(git(root, 'status', '--porcelain'), '');
  }
});

test('feedback after-pass evidence requires an exact executed test, not a suite, duplicate, or printed claim', t => {
  const counts = { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0, topLevel: 1 };
  const regression = { file: 'tests/nested/sample.test.cjs', name: 'fixture passes' };
  const event = { type: 'test:pass', data: { name: regression.name, file: '/snapshot/' + regression.file,
    details: { type: 'test' } } };
  const summary = { type: 'test:summary', data: { success: true, counts, file: event.data.file } };
  const global = { type: 'test:summary', data: { success: true, counts } };
  const parse = events => parseTests([...events, summary, global].map(value => JSON.stringify(value)).join('\n'),
    [regression.file], '/snapshot', [regression]);
  assert.equal(parse([event]).regressionPasses[0].status, 'passed');
  for (const events of [[], [event, event],
    [{ ...event, data: { ...event.data, name: 'different test' } }],
    [{ ...event, data: { ...event.data, file: '/snapshot/other.test.cjs' } }],
    [{ ...event, data: { ...event.data, details: { type: 'suite' } } }],
    [{ ...event, data: { ...event.data, skip: true } }]]) {
    assert.throws(() => parse(events), /Feedback regression must execute exactly once and pass/);
  }
  const printed = `const t=require('node:test');t('other test',()=>{console.log(${JSON.stringify(JSON.stringify(event))});});`;
  const { root } = fixture(t, { 'tests/nested/sample.test.cjs': printed });
  fails(root, /Feedback regression must execute exactly once and pass/);
});

test('gate retains fixed browser startup summaries without arbitrary stderr paths credentials or false success',t=>{
 const value={phase:'settled',ordinal:1,binary:'chromium',status:'ready',cleanup:null,exitSignal:null,firstStderrAfterMs:12,readyAfterMs:30,outcomeAtMs:30,lifetimeAfterMs:31,exitCode:null,extra:'SYNTHETIC_SECRET_VALUE /private/profile ws://private'};
 const line='OLDLIGHT_BROWSER_STARTUP '+JSON.stringify(value)+'\n';
 const {root}=fixture(t,{'tests/nested/sample.test.cjs':"process.stderr.write("+JSON.stringify(line)+");const t=require('node:test');t('fixture passes',()=>{});"});
 const {result,report}=invoke(root);assert.equal(result.status,0,JSON.stringify(report));
 const output=report.stages.tests.stderr;assert.match(output,/OLDLIGHT_BROWSER_STARTUP/);assert.doesNotMatch(output,/SYNTHETIC|private|extra/);
 const summary=JSON.parse(output.trim().slice('OLDLIGHT_BROWSER_STARTUP '.length));assert.equal(summary.readyAfterMs,30);assert.equal(summary.firstStderrAfterMs,12);assert.equal(summary.ordinal,1);
 const parse=require('../validate-release.cjs').browserStartupSummary;
 assert.equal(parse('arbitrary SYNTHETIC_SECRET_VALUE'),null);assert.equal(parse('OLDLIGHT_BROWSER_STARTUP '+JSON.stringify({...value,binary:'/private/profile'})),null);assert.equal(parse('OLDLIGHT_BROWSER_STARTUP '+JSON.stringify({...value,readyAfterMs:'SYNTHETIC_SECRET_VALUE'})),null);
});
