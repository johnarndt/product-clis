import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
for (const id of ['postedly', 'mentionedon', 'intakra', 'portravo', 'ocolta']) {
  const cwd = new URL(`../packages/${id}/`, import.meta.url);
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd, encoding: 'utf8' }));
  for (const file of pack.files) {
    if (!/^(bin\/|lib\/|examples\/|README\.md$|LICENSE$|package\.json$)/.test(file.path)) throw new Error(`Unexpected published file: ${id}/${file.path}`);
    const text = readFileSync(new URL(file.path, cwd), 'utf8');
    if (/npm_[A-Za-z0-9]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw new Error(`Potential credential in ${id}/${file.path}`);
  }
  console.log(`${pack.name}: ${pack.files.length} allowlisted files, ${pack.size} bytes packed, ${pack.unpackedSize} bytes unpacked`);
}
