import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const temporary = await mkdtemp(join(tmpdir(), 'product-cli-install-'));
try {
  const files = [];
  for (const id of ['postedly', 'mentionedon', 'intakra', 'portravo', 'ocolta']) {
    const cwd = new URL(`../packages/${id}/`, import.meta.url);
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd, encoding: 'utf8' }));
    files.push(join(temporary, pack.filename));
  }
  execFileSync('npm', ['install', '--prefix', join(temporary, 'installed'), '--ignore-scripts', '--no-audit', '--no-fund', ...files], { encoding: 'utf8' });
  for (const id of ['postedly', 'mentionedon', 'intakra', 'portravo', 'ocolta']) {
    const executable = join(temporary, 'installed', 'node_modules', '.bin', id);
    const help = execFileSync(executable, ['--help'], { encoding: 'utf8' });
    const version = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
    if (!help.includes(`Usage: ${id}`) || version !== '0.1.0') throw new Error(`Installed ${id} failed smoke test.`);
    console.log(`${id}-cli: tarball installed and executable works (${version})`);
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
