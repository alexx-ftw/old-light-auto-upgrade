'use strict';
// Offline preparation only. Does not deploy, rename, use credentials or contact services.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = fs.realpathSync(__dirname);
const files = ['drive.html', 'drive.js', 'drive.css', 'sync-core.js', 'index.html', 'privacy.html'];
const legacyPath = '/old-light-auto-upgrade/drive.html';
const canonicalPath = '/old-light-helper/drive.html';
function prepare(output) {
  if (!output || !path.isAbsolute(output)) throw Error('Use --out con una ruta absoluta nueva fuera del repositorio.');
  const requested = path.resolve(output);
  const destination = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  const relative = path.relative(root, destination);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw Error('La salida debe quedar fuera del repositorio.');
  if (fs.existsSync(destination)) throw Error('La salida ya existe; no se sobrescribe.');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git(['status', '--porcelain'])) throw Error('Se requiere un commit limpio.');
  const sourceCommit = git(['rev-parse', 'HEAD']), sourceTree = git(['rev-parse', 'HEAD^{tree}']);
  const modes = git(['ls-tree', sourceCommit, '--', ...files.map(file => 'docs/' + file)]).split('\n');
  if (modes.length !== files.length || modes.some(line => !/^100644 blob [0-9a-f]+\tdocs\//.test(line))) throw Error('Solo assets regulares del árbol Git; no symlinks ni fuentes externas.');
  const source = new Map(files.map(file => [file, execFileSync('git', ['show', sourceCommit + ':docs/' + file], { cwd: root })]));
  const html = source.get('drive.html').toString('utf8');
  const tags = [...html.matchAll(/<(script|link)\b([^>]*)>/gi)];
  const scripts = tags.filter(tag => tag[1].toLowerCase() === 'script'), links = tags.filter(tag => tag[1].toLowerCase() === 'link');
  const asset = (tag, name) => {
    const matches = [...tag[2].matchAll(new RegExp('\\b' + name + '\\s*=\\s*[\"\']([^\"\']+)[\"\']', 'gi'))];
    return matches.length === 1 ? matches[0][1].split('?')[0].replace(/^\.\//, '') : '';
  };
  const localAssets = [...scripts.map(tag => asset(tag, 'src')), ...links.map(tag => asset(tag, 'href'))];
  if (scripts.length !== 2 || links.length !== 1 || !['drive.js', 'drive.css', 'sync-core.js'].every(file => localAssets.includes(file))) throw Error('Cambió el conjunto de assets; revisar dependencias antes de empaquetar.');
  if (/@import\b|url\s*\(/i.test(source.get('drive.css').toString('utf8'))) throw Error('CSS con dependencias: revisar antes de empaquetar.');
  const js = source.get('drive.js').toString('utf8');
  const original = "const HELPER_PATH = '" + legacyPath + "';", renamed = "const HELPER_PATH = '" + canonicalPath + "';";
  if ((js.match(/const HELPER_PATH = /g) || []).length !== 1 || (!js.includes(original) && !js.includes(renamed))) throw Error('Ruta Drive desconocida; no se amplía la allowlist.');
  const adjusted = js.includes(renamed), deployed = new Map(source);
  if (adjusted) deployed.set('drive.js', Buffer.from(js.replace(renamed, original)));
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const assets = files.map(file => ({ file: 'old-light-auto-upgrade/' + file, bytes: deployed.get(file).length,
    sourceSha256: hash(source.get(file)), sha256: hash(deployed.get(file)), legacyPathAdjusted: file === 'drive.js' && adjusted }));
  const manifest = { schemaVersion: 1, operation: 'offline-preparation-only', sourceCommit, sourceTree,
    requiredServingOrigin: 'https://alexx-ftw.github.io', legacyPath, assets };
  if (git(['rev-parse', 'HEAD']) !== sourceCommit || git(['status', '--porcelain'])) throw Error('El checkout cambió durante la preparación.');
  fs.mkdirSync(destination); fs.mkdirSync(path.join(destination, 'old-light-auto-upgrade'));
  for (const file of files) fs.writeFileSync(path.join(destination, 'old-light-auto-upgrade', file), deployed.get(file), { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--out') throw Error('Uso: node prepare-rename-compat.cjs --out /ruta/absoluta/nueva');
    const result = prepare(process.argv[3]);
    process.stdout.write(JSON.stringify({ status: 'prepared-not-deployed', sourceCommit: result.sourceCommit, assets: result.assets.length }) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = { prepare };
