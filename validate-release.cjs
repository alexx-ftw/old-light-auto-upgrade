#!/usr/bin/env node
'use strict';

// Offline checks of one clean, committed tree. This is not a security sandbox,
// browser test, network check, reviewer approval, or permission to publish.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');

const BUILDERS = ['build-sync.cjs', 'build-empire.cjs', 'build-drive.cjs', 'build-metrics.cjs'];
const USER_SCRIPT = 'old-light-auto-upgrade.user.js';
const META_SCRIPT = 'old-light-auto-upgrade.meta.js';
const activeGroups = new Map();
const UNSAFE_ENV = /^(?:QA_|OLD_LIGHT_|NODE_OPTIONS$|NODE_PATH$|NODE_TEST_|NODE_V8_COVERAGE$)/;
const hash = (value, algorithm = 'sha256') => crypto.createHash(algorithm).update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const inside = (root, file) => file === root || (!path.relative(root, file).startsWith(`..${path.sep}`)
  && path.relative(root, file) !== '..' && !path.isAbsolute(path.relative(root, file)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

// The same file doubles as the Node test reporter. Test stdout is an event, not
// reporter JSON, so a console.log cannot masquerade as a successful summary.
async function* reporter(events) {
  for await (const event of events) {
    if (event.type === 'test:summary' || event.type === 'test:fail'
      || (event.type === 'test:diagnostic' && event.data.message === "'only' and 'runOnly' require the --test-only command-line option.")) {
      yield JSON.stringify(event, (_, value) => value instanceof Error
        ? { message: value.message, code: value.code, failureType: value.failureType } : value) + '\n';
    }
  }
}
module.exports = reporter;

function child(command, args, cwd, env, timeout = 30000) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout,
    maxBuffer: 64 * 1024 * 1024, killSignal: 'SIGKILL', windowsHide: true });
  return { exitCode: result.status, signal: result.signal, error: result.error?.message || null,
    stdout: result.stdout || '', stderr: result.stderr || '' };
}
// POSIX groups also cover ordinary grandchildren with inherited output pipes.
// Kill the group before awaiting close, including when the leader exits first.
function nodeChild(args, cwd, env, timeout = 30000) {
  return new Promise(resolve => {
    const processChild = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: [], stderr: [] };
    let size = 0, error = null, exitCode = null, signal = null, closed = false, stopped = false, cleaned = false;
    // Test runners can contain fixture gates. Give those gates time to clean
    // their shorter-lived builder groups before force-killing the runner group.
    const grace = args[0] === '--test' ? 3000 : 500;
    const finish = () => {
      if (!closed || !cleaned) return;
      clearTimeout(timer); activeGroups.delete(processChild.pid);
      resolve({ exitCode, signal, error, stdout: Buffer.concat(output.stdout).toString('utf8'),
        stderr: Buffer.concat(output.stderr).toString('utf8') });
    };
    const send = terminationSignal => {
      if (!processChild.pid) return false;
      try { process.kill(-processChild.pid, terminationSignal); return true; }
      catch (failure) {
        if (failure.code !== 'ESRCH') error = `Process-group cleanup failed: ${failure.message}`;
        return false;
      }
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (!send('SIGTERM')) { cleaned = true; finish(); return; }
      setTimeout(() => { send('SIGKILL'); cleaned = true; finish(); }, grace);
    };
    const timer = setTimeout(() => { error = `Timed out after ${timeout}ms`; stop(); }, timeout);
    if (processChild.pid) activeGroups.set(processChild.pid, stop);
    for (const stream of ['stdout', 'stderr']) processChild[stream].on('data', bytes => {
      size += bytes.length;
      if (size <= 64 * 1024 * 1024) output[stream].push(bytes);
      else { error = 'Child output exceeded 64 MiB'; stop(); }
    });
    processChild.on('error', failure => { error = failure.message; stop(); });
    processChild.on('exit', (code, terminationSignal) => { exitCode = code; signal = terminationSignal; stop(); });
    processChild.on('close', () => { closed = true; stop(); finish(); });
  });
}
function requireSuccess(result, label) {
  assert(!result.error && result.signal === null && result.exitCode === 0,
    `${label} failed (exit ${result.exitCode}, signal ${result.signal || 'none'}): ${result.error || result.stderr.slice(-2000)}`);
}
function git(root, args, env) {
  const result = child('git', ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    '-c', 'core.quotePath=false', ...args], root, env);
  requireSuccess(result, `git ${args[0]}`);
  return result.stdout;
}
function safePath(name) {
  assert(name && !path.posix.isAbsolute(name) && !name.includes('\\')
    && !name.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'),
  `Unsafe tracked path: ${JSON.stringify(name)}`);
}
function inventory(root, omitGit = false) {
  const result = [];
  function walk(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      if (omitGit && !relative && name === '.git') {
        assert(!fs.lstatSync(path.join(root, name)).isSymbolicLink(), 'Git metadata must not be a symlink.');
        continue;
      }
      const rel = relative ? `${relative}/${name}` : name;
      safePath(rel);
      const stat = fs.lstatSync(path.join(root, rel));
      assert(!stat.isSymbolicLink(), `Symlink is not an offline validation input: ${rel}`);
      if (stat.isDirectory()) walk(rel);
      else {
        assert(stat.isFile(), `Non-regular input: ${rel}`);
        result.push(rel);
      }
    }
  }
  walk('');
  return result.sort();
}
function readFiles(root, names) {
  return names.map(name => {
    const filename = path.join(root, name);
    // inventory() has already rejected symlinks, including parent directories.
    const stat = fs.lstatSync(filename);
    assert(stat.isFile() && !stat.isSymbolicLink(), `Non-regular input: ${name}`);
    const bytes = fs.readFileSync(filename);
    return { path: name, size: bytes.length, mode: stat.mode & 0o777, sha256: hash(bytes) };
  });
}
function capture(root, env) {
  assert(fs.realpathSync(git(root, ['rev-parse', '--show-toplevel'], env).trim()) === root,
    'Run the gate from the Git repository root.');
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'], env);
  assert(status.length === 0, 'Input must be a clean committed checkout, including no untracked or ignored files.');
  const commit = git(root, ['rev-parse', '--verify', 'HEAD'], env).trim();
  const tree = git(root, ['rev-parse', 'HEAD^{tree}'], env).trim();
  const objectFormat = git(root, ['rev-parse', '--show-object-format'], env).trim();
  assert(['sha1', 'sha256'].includes(objectFormat), 'Unsupported Git object format.');
  const entries = git(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], env).split('\0').filter(Boolean).map(line => {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
    assert(match, 'Malformed Git tree entry.');
    const [, mode, type, blob, name] = match;
    safePath(name);
    assert(type === 'blob' && ['100644', '100755'].includes(mode), `Symlinks/submodules are unsupported: ${name}`);
    return { path: name, gitMode: mode, gitBlob: blob };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const names = entries.map(entry => entry.path);
  assert(names.length > 0 && new Set(names).size === names.length, 'Empty or duplicate Git input inventory.');
  assert(same(inventory(root, true), names), 'Filesystem inventory differs from the committed tree.');
  const files = readFiles(root, names).map((file, index) => {
    const entry = entries[index];
    const bytes = fs.readFileSync(path.join(root, file.path));
    const gitBlob = hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), objectFormat);
    assert(gitBlob === entry.gitBlob && hash(bytes) === file.sha256, `Input differs from HEAD: ${file.path}`);
    if (process.platform !== 'win32') assert(Boolean(file.mode & 0o111) === (entry.gitMode === '100755'),
      `Executable mode differs from HEAD: ${file.path}`);
    return { ...file, ...entry };
  });
  return { commit, tree, objectFormat, manifestSha256: hash(JSON.stringify(files)), files };
}
function checkSnapshot(root, input) {
  const names = input.files.map(file => file.path);
  assert(same(inventory(root), names), 'Snapshot inventory changed during checks.');
  const expected = input.files.map(({ path: name, size, mode, sha256 }) => ({ path: name, size, mode, sha256 }));
  const actual = readFiles(root, names);
  const changed = actual.filter((file, index) => !same(file, expected[index])).map(file => file.path);
  assert(changed.length === 0, `Snapshot changed during checks: ${changed.join(', ')}`);
}
function versionCheck(root) {
  const user = fs.readFileSync(path.join(root, USER_SCRIPT), 'utf8');
  const meta = fs.readFileSync(path.join(root, META_SCRIPT), 'utf8');
  const one = (source, expression, label) => {
    const matches = [...source.matchAll(expression)];
    assert(matches.length === 1, `Expected exactly one ${label}.`);
    return matches[0][1];
  };
  function metadata(source, label) {
    const block = one(source, /(^\/\/ ==UserScript==\r?\n[\s\S]*?^\/\/ ==\/UserScript==\r?$)/gm, `${label} metadata block`);
    assert((source.match(/^\/\/ ==UserScript==\r?$/gm) || []).length === 1
      && (source.match(/^\/\/ ==\/UserScript==\r?$/gm) || []).length === 1, `Ambiguous ${label} metadata boundaries.`);
    return { header: block, version: one(block, /^\/\/\s*@version\s+(\S+)\s*$/gm, `${label} @version`) };
  }
  const userMeta = metadata(user, 'userscript'), metaMeta = metadata(meta, 'meta file');
  const versions = {
    userscript: userMeta.version, metadata: metaMeta.version,
    scriptConstant: one(user, /^\s*const SCRIPT_VERSION\s*=\s*['"]([^'"]+)['"];\s*$/gm, 'SCRIPT_VERSION declaration'),
    changelog: one(user, /function helperChangelogEntries\(\)\s*\{\s*return\s*\[\s*\{\s*version:\s*['"]([^'"]+)['"]/g, 'first integrated changelog version'),
  };
  assert(Object.values(versions).every(value => /^\d+\.\d+\.\d+$/.test(value)), 'Release versions must be numeric major.minor.patch.');
  assert(new Set(Object.values(versions)).size === 1, `Release version mismatch: ${JSON.stringify(versions)}`);
  assert(userMeta.header === metaMeta.header, 'Userscript/meta metadata headers differ.');
  assert(meta.replace(/\r?\n$/, '') === metaMeta.header, 'Meta file must contain only the metadata header and an optional final newline.');
  return versions;
}
function parseTests(stdout, files, snapshot) {
  const records = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert(records.every(record => record && ['test:summary', 'test:fail', 'test:diagnostic'].includes(record.type) && record.data), 'Invalid test reporter record.');
  const summaries = records.filter(record => record.type === 'test:summary').map(record => record.data);
  const globals = summaries.filter(summary => summary.file === undefined);
  assert(globals.length === 1, 'Incomplete test report: expected exactly one global summary.');
  assert(records.at(-1)?.type === 'test:summary' && records.at(-1).data.file === undefined, 'Incomplete test report: global summary must be final.');
  const perFile = summaries.filter(summary => summary.file !== undefined);
  const seen = perFile.map(summary => path.relative(snapshot, summary.file).split(path.sep).join('/')).sort();
  assert(same(seen, files), 'Incomplete test report: every test file must report tests (empty files are rejected).');
  for (const summary of summaries) {
    const counts = summary.counts;
    assert(counts && ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo', 'suites', 'topLevel']
      .every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0), 'Invalid structured test counts.');
    assert(summary.success === true && counts.tests > 0 && counts.passed === counts.tests
      && ['failed', 'cancelled', 'skipped', 'todo'].every(key => counts[key] === 0),
    `Test omissions/failures or zero tests: ${summary.file ? path.relative(snapshot, summary.file) : 'global'} ${JSON.stringify(counts)}`);
  }
  for (const key of ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo', 'suites', 'topLevel']) {
    assert(perFile.reduce((sum, summary) => sum + summary.counts[key], 0) === globals[0].counts[key],
      `Incomplete test report: inconsistent ${key} totals.`);
  }
  assert(!records.some(record => record.type === 'test:diagnostic'), 'Focused test source/options are not allowed.');
  assert(!records.some(record => record.type === 'test:fail'), 'A test failure was reported.');
  return { counts: globals[0].counts, durationMs: globals[0].duration_ms,
    files: perFile.map(summary => ({ path: path.relative(snapshot, summary.file).split(path.sep).join('/'), counts: summary.counts })) };
}
// Export narrow pure checks for malformed-report regressions, without adding
// a CLI escape hatch that can replace the real test command or input files.
module.exports.parseTests = parseTests;

async function main() {
  const started = new Date().toISOString();
  const report = { schemaVersion: 1, scope: 'offline-validation-only', status: 'failed', startedAt: started,
    node: process.version, platform: process.platform, stages: {}, errors: [],
    limitations: ['No real browser, game, OAuth or network validation.',
      'No independent reviewer approval, remote state/lease verification or publication authorization.',
      'Temporary copies isolate normal writes; trusted repository code is executed, not security-sandboxed.',
      'Process groups clean ordinary descendants on failure, timeout, SIGINT and SIGTERM; SIGKILL of this gate cannot be cleaned up.',
      'Asset cache query versions require separate changed-asset review; they need not equal the release version.'] };
  for (const name of ['preflight', 'snapshot', 'versions', 'syntax', 'tests', 'builders', 'finalIntegrity']) report.stages[name] = { status: 'not-run' };
  let root, env, input, temporary, snapshot, reportPath, reportParent, active = 'preflight';
  let interrupted = null;
  const signalHandlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
    interrupted = signal;
    for (const stop of activeGroups.values()) stop();
  }]));
  for (const [signal, handler] of Object.entries(signalHandlers)) process.on(signal, handler);
  async function stage(name, action) {
    assert(!interrupted, `Validation interrupted by ${interrupted}.`);
    active = name;
    report.stages[name] = { status: 'running' };
    const details = await action() || {};
    assert(!interrupted, `Validation interrupted by ${interrupted}.`);
    report.stages[name] = { status: 'passed', ...details };
  }
  function unchanged() {
    checkSnapshot(snapshot, input);
    assert(same(capture(root, env), input), 'Original input tree changed during checks.');
  }
  try {
    await stage('preflight', () => {
      const args = process.argv.slice(2);
      if (args.length === 1 && args[0] === '--help') {
        process.stdout.write('Offline validation only. Requires Node 24+, Git, and Linux/macOS.\nUsage: node validate-release.cjs [--report /absolute/new/outside-repo.json]\nRun from a clean committed repository root. JSON is always written to stdout.\n');
        return { help: true };
      }
      assert(args.length === 0 || (args.length === 2 && args[0] === '--report'), 'Only --report PATH is supported; test selectors and other options are rejected.');
      assert(Number(process.versions.node.split('.')[0]) >= 24, 'Node 24 or newer is required for structured test summaries.');
      assert(['linux', 'darwin'].includes(process.platform), 'Process-group cleanup requires Linux or macOS.');
      assert(process.execArgv.length === 0, 'Node command-line overrides are not allowed.');
      const unsafe = Object.keys(process.env).filter(name => UNSAFE_ENV.test(name)).sort();
      report.environment = { sourceAndNodeOverrides: 'rejected', rejectedNames: unsafe,
        gitEnvironment: 'scrubbed', scrubbedNames: Object.keys(process.env).filter(name => name.startsWith('GIT_')).sort() };
      assert(unsafe.length === 0, `Unsafe inherited environment overrides: ${unsafe.join(', ')}`);
      env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
      root = fs.realpathSync(process.cwd());
      assert(root === fs.realpathSync(__dirname), 'Run the tracked validator from its repository root.');
      if (args.length) {
        assert(path.isAbsolute(args[1]), 'Report path must be absolute.');
        const candidate = path.join(fs.realpathSync(path.dirname(args[1])), path.basename(args[1]));
        assert(!inside(root, candidate), 'Report must be outside the repository; it cannot overwrite source.');
        assert(!fs.existsSync(candidate), 'Report path already exists; reports are never overwritten.');
        const parent = fs.statSync(path.dirname(candidate));
        reportParent = { path: path.dirname(candidate), dev: parent.dev, ino: parent.ino };
        reportPath = candidate;
      }
      return { nodeMinimum: 24, processCleanup: 'POSIX process groups (Linux/macOS)' };
    });
    if (report.stages.preflight.help) return;
    await stage('snapshot', () => {
      input = capture(root, env);
      report.input = input;
      const names = input.files.map(file => file.path);
      assert(!names.some(name => /\.test\.(?:js|mjs|ts|cts|mts|jsx|tsx)$/.test(name)), 'Unsupported test entry format: use *.test.cjs for every offline test.');
      for (const required of [path.basename(__filename), USER_SCRIPT, META_SCRIPT, ...BUILDERS]) {
        assert(names.includes(required), `Required tracked input missing: ${required}`);
      }
      const tempParent = fs.realpathSync(os.tmpdir());
      assert(!inside(root, tempParent), 'Temporary directory must be outside the repository.');
      temporary = fs.mkdtempSync(path.join(tempParent, 'oldlight-offline-gate-'));
      snapshot = path.join(temporary, 'snapshot');
      fs.mkdirSync(snapshot);
      for (const file of input.files) {
        const target = path.join(snapshot, file.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(root, file.path), target, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(target, file.mode);
      }
      unchanged();
      return { files: names.length, manifestSha256: input.manifestSha256 };
    });
    await stage('versions', () => ({ versions: versionCheck(snapshot) }));
    const names = input.files.map(file => file.path);
    const syntaxFiles = names.filter(name => /\.(?:js|cjs)$/.test(name));
    const testFiles = names.filter(name => name.endsWith('.test.cjs'));
    report.notRun = names.filter(name => name.endsWith('.browser.cjs')).map(name => ({ path: name, reason: 'Requires separate real-browser validation.' }));
    await stage('syntax', async () => {
      for (const name of syntaxFiles) requireSuccess(await nodeChild(['--check', path.join(snapshot, name)], snapshot, env), `Syntax ${name}`);
      unchanged();
      return { count: syntaxFiles.length, files: syntaxFiles };
    });
    await stage('tests', async () => {
      assert(testFiles.length > 0, 'No tracked *.test.cjs files were found.');
      const result = await nodeChild(['--test', '--test-concurrency=1', '--test-timeout=120000',
        `--test-reporter=${path.join(snapshot, path.basename(__filename))}`, ...testFiles.map(name => path.join(snapshot, name))], snapshot, env, 300000);
      report.stages.tests = { status: 'running', command: 'node --test --test-concurrency=1 --test-timeout=120000 --test-reporter=<snapshot validator> <all tracked *.test.cjs>',
        fileCount: testFiles.length, files: testFiles, exitCode: result.exitCode, signal: result.signal, stderr: result.stderr.slice(-4000) };
      try {
        const events = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        report.stages.tests.failureEvents = events.filter(event => event.type === 'test:fail').slice(0, 20);
      } catch { report.stages.tests.reporterOutputTail = result.stdout.slice(-4000); }
      unchanged();
      requireSuccess(result, 'Complete test suite');
      const details = parseTests(result.stdout, testFiles, snapshot);
      return { ...report.stages.tests, status: 'passed', ...details };
    });
    await stage('builders', async () => {
      const runs = [];
      report.stages.builders.runs = runs;
      for (let pass = 1; pass <= 2; pass++) {
        for (const builder of BUILDERS) {
          const result = await nodeChild([path.join(snapshot, builder)], snapshot, env);
          runs.push({ builder, pass, exitCode: result.exitCode, signal: result.signal, stdout: result.stdout.slice(-2000), stderr: result.stderr.slice(-2000) });
          requireSuccess(result, `${builder}, pass ${pass}`);
          // Even the first builder may not repair stale generated source. Check
          // every input after every invocation, not just the final userscript.
          unchanged();
        }
      }
      return { runs, byteIdenticalAfterEveryRun: true };
    });
    await stage('finalIntegrity', () => { unchanged(); return { manifestSha256: input.manifestSha256, originalAndSnapshotUnchanged: true }; });
    report.status = 'passed';
  } catch (error) {
    const message = interrupted ? `Validation interrupted by ${interrupted}.` : error.message;
    if (interrupted) report.interruptedBy = interrupted;
    report.errors.push(message);
    report.stages[active] = { ...report.stages[active], status: 'failed', error: message };
  } finally {
    for (const pid of activeGroups.keys()) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
    for (const [signal, handler] of Object.entries(signalHandlers)) process.removeListener(signal, handler);
    if (input && root && env) {
      try {
        assert(same(capture(root, env), input), 'Original input tree changed during checks.');
        if (snapshot) checkSnapshot(snapshot, input);
      } catch (error) {
        report.status = 'failed';
        report.stages.finalIntegrity = { status: 'failed', error: error.message };
        if (!report.errors.includes(error.message)) report.errors.push(error.message);
      }
    }
    if (temporary) {
      try { fs.rmSync(temporary, { recursive: true, force: true }); }
      catch (error) { report.status = 'failed'; report.errors.push(`Temporary snapshot cleanup failed: ${error.message}`); }
    }
  }
  report.completedAt = new Date().toISOString();
  if (reportPath) {
    try {
      const parent = fs.statSync(reportParent.path);
      assert(fs.realpathSync(reportParent.path) === reportParent.path && parent.dev === reportParent.dev
        && parent.ino === reportParent.ino && !inside(root, fs.realpathSync(reportParent.path)),
      'Report parent changed during checks; refusing to write.');
      const fd = fs.openSync(reportPath, 'wx', 0o600);
      try {
        const write = () => {
          const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
          fs.ftruncateSync(fd, 0);
          let offset = 0;
          while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
        };
        write();
        // The report is outside the inputs, but verify that assertion after
        // creation too. A changed path must never produce a green input claim.
        if (input) {
          try { assert(same(capture(root, env), input), 'Original input tree changed while writing the report.'); }
          catch (error) {
            report.status = 'failed'; report.errors.push(error.message);
            report.stages.finalIntegrity = { status: 'failed', error: error.message };
            write();
          }
        }
      } finally { fs.closeSync(fd); }
    } catch (error) { report.status = 'failed'; report.errors.push(`Could not create report: ${error.message}`); }
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
if (require.main === module) main();
