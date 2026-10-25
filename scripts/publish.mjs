import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const availableProducts = ['postedly', 'mentionedon', 'intakra', 'portravo', 'ocolta'];
const args = process.argv.slice(2);
const usage = 'Usage: node scripts/publish.mjs --products postedly,mentionedon,intakra,portravo\nChoose the products explicitly; no packages are published by default.';
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(usage);
  process.exit(0);
}
if (args.length !== 2 || args[0] !== '--products' || !args[1]) {
  console.error(usage);
  process.exit(1);
}
const products = args[1].split(',');
if (new Set(products).size !== products.length || products.some(id => !availableProducts.includes(id))) {
  console.error(`Choose unique product names from: ${availableProducts.join(', ')}.`);
  process.exit(1);
}
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
const release = { checkedAt: new Date().toISOString(), selectedProducts: products, packages: [] };
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
