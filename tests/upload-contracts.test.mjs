import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRequest, run } from '../shared/runtime.mjs';
import portravo from '../packages/portravo/product.mjs';
import ocolta from '../packages/ocolta/product.mjs';

const PDF = Buffer.from('%PDF-1.7\n% synthetic local transport fixture\n%%EOF\n');
const command = (product, name) => {
  const result = product.commands.find(item => item.name === name);
  assert.ok(result, `Command ${name} must exist`);
  return result;
};
async function files(t, fixtures = { 'plan.pdf': PDF }) {
  const dir = await mkdtemp(join(tmpdir(), 'product-cli-upload-contracts-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, bytes] of Object.entries(fixtures)) await writeFile(join(dir, name), bytes);
  return dir;
}
async function mockService(t, reply = { ok: true }) {
  const seen = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks) });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(reply));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { origin: `http://127.0.0.1:${server.address().port}`, seen };
}
function ocoltaFlags(file) {
  return { file, tier: 'deep-review', 'idempotency-key': 'fixture-review-20261021', 'confirm-credit-use': true, 'consent-to-processing': true };
}

test('Ocolta multipart reaches a local server with exact consent, tier, token and credit header', async t => {
  const dir = await files(t);
  const { origin, seen } = await mockService(t, { id: 'job_0123456789abcdef0123456789abcdef', state: 'processing' });
  const output = join(dir, 'response.json');
  await run(ocolta, [
    'reviews', 'submit', '--base-url', origin, '--file', join(dir, 'plan.pdf'),
    '--tier', 'deep-review', '--idempotency-key', 'fixture-review-20261021',
    '--consent-to-processing', '--confirm-credit-use', '--output', output,
  ], { OCOLTA_API_KEY: 'oct_synthetic_contract_token', XDG_CONFIG_HOME: dir });
  assert.equal(seen.length, 1);
  const received = seen[0];
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/api/v1/reviews');
  assert.equal(received.headers.authorization, 'Bearer oct_synthetic_contract_token');
  assert.equal(received.headers['x-ocolta-confirm-credit'], '1');
  assert.equal(received.headers['idempotency-key'], 'fixture-review-20261021');
  assert.match(received.headers['content-type'], /^multipart\/form-data; boundary=/);
  const form = await new Response(received.body, { headers: { 'Content-Type': received.headers['content-type'] } }).formData();
  assert.deepEqual([...form.keys()].sort(), ['analysisMode', 'consent', 'consentVersion', 'file']);
  assert.equal(form.get('consent'), 'true');
  assert.equal(form.get('consentVersion'), '2026-08-30.openrouter-zdr.v2');
  assert.equal(form.get('analysisMode'), 'deep-review');
  assert.equal(form.get('file').name, 'plan.pdf');
  assert.equal(form.get('file').type, 'application/pdf');
  assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()), PDF);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).state, 'processing');
});

test('Ocolta refuses missing or false credit confirmation and processing consent before network access', async t => {
  const dir = await files(t);
  const { origin, seen } = await mockService(t);
  const base = ['reviews', 'submit', '--base-url', origin, '--file', join(dir, 'plan.pdf'), '--tier', 'deep-review', '--idempotency-key', 'fixture-review-20261021'];
  for (const suffix of [['--consent-to-processing'], ['--consent-to-processing', '--confirm-credit-use=false']]) {
    await assert.rejects(run(ocolta, [...base, ...suffix], { OCOLTA_API_KEY: 'oct_synthetic' }), /requires --confirm-credit-use/);
  }
  for (const suffix of [['--confirm-credit-use'], ['--confirm-credit-use', '--consent-to-processing=false']]) {
    await assert.rejects(run(ocolta, [...base, ...suffix], { OCOLTA_API_KEY: 'oct_synthetic' }), /consent-to-processing.*(required|must be true)/);
  }
  assert.equal(seen.length, 0);
});

test('Ocolta accepts its supported image media types and preserves file bytes', async t => {
  // Transport fixtures exercise MIME handling; the live service owns full document validation.
  const fixtures = {
    'scan.png': Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex'),
    'scan.jpg': Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex'),
    'scan.webp': Buffer.from('524946461600000057454250565038200a0000000102030405060708090a', 'hex'),
  };
  const types = { 'scan.png': 'image/png', 'scan.jpg': 'image/jpeg', 'scan.webp': 'image/webp' };
  const dir = await files(t, fixtures);
  for (const [name, bytes] of Object.entries(fixtures)) {
    const request = await buildRequest(ocolta, command(ocolta, 'reviews submit'), ocoltaFlags(join(dir, name)), ocolta.baseUrl, { OCOLTA_API_KEY: 'oct_synthetic' });
    const file = request.init.body.get('file');
    assert.equal(file.type, types[name], name);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes, name);
  }
});

test('Portravo raw upload uses only the grant token and sends exact PDF bytes to the fixed endpoint', async t => {
  const dir = await files(t);
  const { origin, seen } = await mockService(t, { url: 'https://portravo.com/private/synthetic', size: PDF.length });
  await run(portravo, [
    'uploads', 'file', '--base-url', origin, '--id', 'project_123', '--upload-id', 'upload_456',
    '--file', join(dir, 'plan.pdf'), '--output', join(dir, 'upload.json'),
  ], { PORTRAVO_UPLOAD_TOKEN: 'ptrv_up_synthetic_grant', XDG_CONFIG_HOME: dir });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'PUT');
  assert.equal(seen[0].url, '/api/v1/projects/project_123/uploads/upload_456/file');
  assert.equal(seen[0].headers.authorization, 'Bearer ptrv_up_synthetic_grant');
  assert.equal(seen[0].headers['content-type'], 'application/pdf');
  assert.deepEqual(seen[0].body, PDF);

  await assert.rejects(buildRequest(portravo, command(portravo, 'uploads file'), {
    id: 'project_123', 'upload-id': 'upload_456', file: join(dir, 'plan.pdf'),
  }, origin, { PORTRAVO_API_KEY: 'ptrv_main_key_must_not_substitute' }), /PORTRAVO_UPLOAD_TOKEN/);
});

test('Portravo upload rejects non-PDF bytes and oversized PDFs locally', async t => {
  const dir = await files(t, { 'wrong.pdf': Buffer.from('not a PDF'), 'large.pdf': Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]) });
  for (const [name, expected] of [['wrong.pdf', /pdf/i], ['large.pdf', /at most 10485760 bytes/]]) {
    await assert.rejects(buildRequest(portravo, command(portravo, 'uploads file'), {
      id: 'project_123', 'upload-id': 'upload_456', file: join(dir, name),
    }, portravo.baseUrl, { PORTRAVO_UPLOAD_TOKEN: 'ptrv_up_synthetic' }), expected);
  }
});

test('Portravo extraction confirmation cannot be supplied only through JSON or overridden false', async () => {
  const extraction = command(portravo, 'extract start');
  const base = { id: 'project_123', 'idempotency-key': 'fixture-extract-20261021' };
  const env = { PORTRAVO_API_KEY: 'ptrv_synthetic' };
  await assert.rejects(buildRequest(portravo, extraction, { ...base, data: '{"confirmCreditUse":true}' }, portravo.baseUrl, env), /requires --confirm-credit-use/);
  await assert.rejects(buildRequest(portravo, extraction, { ...base, 'confirm-credit-use': false }, portravo.baseUrl, env), /requires --confirm-credit-use/);
  const request = await buildRequest(portravo, extraction, { ...base, data: '{"confirmCreditUse":false}', 'confirm-credit-use': true }, portravo.baseUrl, env);
  assert.deepEqual(JSON.parse(request.init.body), { confirmCreditUse: true });
  assert.equal(request.init.headers['Idempotency-Key'], base['idempotency-key']);
});

test('Portravo JSON contract preserves selected trades and maps completion/advance fields', async () => {
  const env = { PORTRAVO_API_KEY: 'ptrv_synthetic' };
  const project = await buildRequest(portravo, command(portravo, 'projects create'), {
    data: '{"name":"Original","trades":["electrical","plumbing"]}', name: 'Final name', 'metro-code': 'test-market', 'idempotency-key': 'fixture-project-20261021',
  }, portravo.baseUrl, env);
  assert.deepEqual(JSON.parse(project.init.body), { name: 'Final name', trades: ['electrical', 'plumbing'], metroCode: 'test-market' });
  const completion = await buildRequest(portravo, command(portravo, 'uploads complete'), {
    id: 'project_123', 'upload-id': 'upload_456', url: 'https://portravo.com/private/synthetic',
  }, portravo.baseUrl, env);
  assert.equal(completion.url.pathname, '/api/v1/projects/project_123/uploads/upload_456/complete');
  assert.deepEqual(JSON.parse(completion.init.body), { url: 'https://portravo.com/private/synthetic' });
  const advance = await buildRequest(portravo, command(portravo, 'extract advance'), {
    id: 'project_123', 'run-id': 'run_456', 'idempotency-key': 'fixture-advance-0001',
  }, portravo.baseUrl, env);
  assert.deepEqual(JSON.parse(advance.init.body), { runId: 'run_456' });
});

test('Portravo export requires a new output path before any authenticated request', async t => {
  const dir = await files(t);
  const { origin, seen } = await mockService(t);
  const existing = join(dir, 'estimate.xlsx');
  await writeFile(existing, 'existing workbook');
  await assert.rejects(run(portravo, ['projects', 'export', '--id', 'project_123', '--base-url', origin], {}), /requires --output/);
  await assert.rejects(run(portravo, ['projects', 'export', '--id', 'project_123', '--base-url', origin, '--output', existing], {}), /already exists/);
  assert.equal(seen.length, 0);
  assert.equal(await readFile(existing, 'utf8'), 'existing workbook');
});
