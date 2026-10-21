import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const products = ['postedly', 'mentionedon', 'intakra', 'portravo', 'ocolta'];
const registry = 'https://registry.npmjs.org';
function run(cmd, args, cwd = root) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${cmd} failed (${result.status ?? result.error?.message}).`);
}
async function metadata(name, version) {
  const response = await fetch(`${registry}/${name}/${version}`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Registry returned HTTP ${response.status} for ${name}.`);
  return response.json();
}
const release = { checkedAt: new Date().toISOString(), packages: [] };
let temporary;
try {
  run('npm', ['run', 'build']);
  run('npm', ['test']);
  run('npm', ['run', 'pack:check']);
  run('npm', ['whoami', '--registry', registry]);
  temporary = await mkdtemp(join(tmpdir(), 'product-cli-release-'));
  for (const id of products) {
    const dir = join(root, 'packages', id);
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd: dir, encoding: 'utf8' }));
    let published = await metadata(pkg.name, pkg.version);
    if (published && published.dist?.integrity !== pack.integrity) throw new Error(`${pkg.name}@${pkg.version} already exists with different contents. Bump the package version before continuing.`);
    if (!published) {
      run('npm', ['publish', join(temporary, pack.filename), '--access', 'public', '--registry', registry]);
      published = await metadata(pkg.name, pkg.version);
    }
    if (!published || published.dist?.integrity !== pack.integrity) throw new Error(`Could not verify published integrity for ${pkg.name}.`);
    const item = { name: pkg.name, version: pkg.version, integrity: pack.integrity, url: `https://www.npmjs.com/package/${pkg.name}`, verified: true };
    release.packages.push(item);
    await writeFile(join(root, 'release-status.json'), JSON.stringify(release, null, 2) + '\n');
    console.log(`Verified ${item.url} @ ${item.version}`);
  }
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
} finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
