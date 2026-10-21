import { readdir, mkdir, copyFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
const root = new URL('../', import.meta.url);
const products = ['postedly', 'mentionedon', 'intakra', 'portravo', 'ocolta'];
for (const id of products) {
  const dir = new URL(`packages/${id}/`, root);
  const { default: config } = await import(new URL('product.mjs', dir));
  await mkdir(new URL('bin/', dir), { recursive: true });
  await mkdir(new URL('lib/', dir), { recursive: true });
  await copyFile(new URL('shared/runtime.mjs', root), new URL('lib/runtime.mjs', dir));
  await copyFile(new URL('product.mjs', dir), new URL('lib/product.mjs', dir));
  await copyFile(new URL('LICENSE', root), new URL('LICENSE', dir));
  const bin = new URL(`bin/${id}.mjs`, dir);
  await writeFile(bin, `#!/usr/bin/env node\nimport config from '../lib/product.mjs';\nimport { main } from '../lib/runtime.mjs';\nawait main(config);\n`);
  await chmod(bin, 0o755);
  const metadata = {
    name: `${id}-cli`, version: '0.1.0', description: config.description, type: 'module',
    bin: { [id]: `bin/${id}.mjs` }, engines: { node: '>=22' },
    files: ['bin/', 'lib/', 'README.md', 'LICENSE', 'examples/'],
    keywords: config.keywords, homepage: config.homepage,
    repository: { type: 'git', url: 'git+https://github.com/johnarndt/product-clis.git', directory: `packages/${id}` },
    bugs: { url: 'https://github.com/johnarndt/product-clis/issues' },
    author: 'John Arndt', license: 'MIT', publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' }
  };
  await writeFile(new URL('package.json', dir), JSON.stringify(metadata, null, 2) + '\n');
  console.log(`${metadata.name}@${metadata.version}: ${config.commands.length} commands`);
}
