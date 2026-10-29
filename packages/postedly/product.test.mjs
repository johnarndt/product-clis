import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postedly from './product.mjs';
import { buildRequest, help, run } from '../../shared/runtime.mjs';

const PDF = Buffer.from('%PDF-1.7\n% Local transport fixture, not a sendable document\n%%EOF\n');
const command = name => postedly.commands.find(item => item.name === name);

async function localService(t, reply) {
  const directory = await mkdtemp(join(tmpdir(), 'postedly-cli-contract-'));
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const record = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
    seen.push(record);
    const result = reply(record);
    res.writeHead(200, { 'Content-Type': result.type || 'application/json' });
    res.end(result.bytes || JSON.stringify(result.json));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, seen, origin: `http://127.0.0.1:${server.address().port}`, env: { POSTEDLY_TOKEN: 'synthetic-oauth-access-token', XDG_CONFIG_HOME: directory } };
}

test('Postedly upload transmits the exact local PDF, service and optional integrity hash', async t => {
  const local = await localService(t, () => ({ json: { id: 'document-fixture' } }));
  const file = join(local.directory, 'finished-letter.pdf');
  await writeFile(file, PDF);
  const digest = createHash('sha256').update(PDF).digest('hex');
  await run(postedly, ['documents', 'upload', '--base-url', local.origin, '--file', file, '--service', 'letter', '--expected-sha256', digest, '--output', join(local.directory, 'upload.json')], local.env);
  assert.equal(local.seen.length, 1);
  const request = local.seen[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/api/documents');
  assert.equal(request.headers.authorization, 'Bearer synthetic-oauth-access-token');
  const form = await new Response(request.body, { headers: { 'Content-Type': request.headers['content-type'] } }).formData();
  assert.deepEqual([...form.keys()].sort(), ['expectedSha256', 'file', 'service']);
  assert.equal(form.get('service'), 'letter');
  assert.equal(form.get('expectedSha256'), digest);
  assert.equal(form.get('file').name, 'finished-letter.pdf');
  assert.equal(form.get('file').type, 'application/pdf');
  assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()), PDF);
});

test('Postedly checkout uses only the MCP private review tool, preserving browser approval', async t => {
  const review = { url: 'https://postedly.com/approve?ticket=synthetic', requiresBrowserApproval: true };
  const local = await localService(t, request => {
    const rpc = JSON.parse(request.body);
    return { json: { jsonrpc: '2.0', id: rpc.id, result: { isError: false, structuredContent: review } } };
  });
  const output = join(local.directory, 'review.json');
  await run(postedly, ['checkout', 'review', '--base-url', local.origin, '--quote-id', 'quote-fixture', '--output', output], local.env);
  assert.equal(local.seen.length, 1);
  assert.equal(local.seen[0].url, '/mcp/send');
  assert.equal(local.seen[0].method, 'POST');
  const rpc = JSON.parse(local.seen[0].body);
  assert.equal(rpc.method, 'tools/call');
  assert.deepEqual(rpc.params, { name: 'postedly_checkout', arguments: { quoteId: 'quote-fixture' } });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), review);
});

test('Postedly saved-contact writes enforce confirmation and carry current-version safeguards', async () => {
  const contact = { key: 'office', label: 'Office', expectedVersion: 0, contact: { role: 'recipient', details: { name: 'Synthetic recipient' } } };
  const flags = { data: JSON.stringify(contact) };
  const env = { POSTEDLY_TOKEN: 'synthetic' };
  await assert.rejects(buildRequest(postedly, command('contacts save'), flags, postedly.baseUrl, env), /requires --confirm/);
  const request = await buildRequest(postedly, command('contacts save'), { ...flags, confirm: true }, postedly.baseUrl, env);
  assert.deepEqual(JSON.parse(request.init.body).params.arguments, { confirmedSave: true, ...contact });
  const deletion = await buildRequest(postedly, command('contacts delete'), { key: 'office', 'expected-version': 3, confirm: true }, postedly.baseUrl, env);
  assert.deepEqual(JSON.parse(deletion.init.body).params.arguments, { confirmedDelete: true, key: 'office', expectedVersion: 3 });
});

test('Postedly proof download requires a new output file and retains the exact PDF', async t => {
  const local = await localService(t, () => ({ type: 'application/pdf', bytes: PDF }));
  await assert.rejects(run(postedly, ['documents', 'download', '--base-url', local.origin, '--id', 'proof-fixture'], local.env), /requires --output/);
  assert.equal(local.seen.length, 0);
  const output = join(local.directory, 'proof.pdf');
  await run(postedly, ['documents', 'download', '--base-url', local.origin, '--id', 'proof-fixture', '--output', output], local.env);
  assert.equal(local.seen[0].url, '/api/documents/proof-fixture');
  assert.deepEqual(await readFile(output), PDF);
  await assert.rejects(run(postedly, ['documents', 'download', '--base-url', local.origin, '--id', 'proof-fixture', '--output', output], local.env), /already exists/);
  assert.equal(local.seen.length, 1);
});


test('Postedly check account discovery uses only the read-only masked-account MCP tool', async t => {
  const result = { available: true, banks: [], setupUrl: 'https://postedly.com/checks' };
  const local = await localService(t, request => ({ json: { jsonrpc: '2.0', id: JSON.parse(request.body).id, result: { structuredContent: result } } }));
  const output = join(local.directory, 'accounts.json');
  await run(postedly, ['checks', 'accounts', '--base-url', local.origin, '--output', output], local.env);
  assert.equal(local.seen.length, 1);
  assert.equal(local.seen[0].url, '/mcp/send');
  assert.deepEqual(JSON.parse(local.seen[0].body).params, { name: 'postedly_bank_accounts', arguments: {} });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), result);
  const status = await buildRequest(postedly, command('checks status'), {}, local.origin, local.env);
  assert.equal(status.init.method, 'GET');
  assert.equal(status.url.pathname, '/api/checks/status');
  assert.equal(status.init.body, undefined);
});

test('Postedly check drafting returns the owner browser review without signing or payment approval', async t => {
  const data = { bankRef: 'bnk_synthetic_ready_masked_reference', payee: { kind: 'person', name: 'Synthetic payee', address1: '123 Synthetic St', city: 'Example', state: 'CA', postalCode: '90001' }, amountCents: 10000, memo: 'Synthetic request' };
  const result = { reviewUrl: 'https://postedly.com/checks?review=synthetic-private', requiresBrowserApproval: true, quote: { id: 'synthetic-check-quote' } };
  const local = await localService(t, request => ({ json: { jsonrpc: '2.0', id: JSON.parse(request.body).id, result: { structuredContent: result } } }));
  const input = join(local.directory, 'check.json'), output = join(local.directory, 'check-result.json');
  await writeFile(input, JSON.stringify(data));
  await run(postedly, ['checks', 'draft', '--base-url', local.origin, '--data', '@' + input, '--output', output], local.env);
  assert.equal(local.seen.length, 1);
  assert.equal(local.seen[0].url, '/mcp/send');
  assert.deepEqual(JSON.parse(local.seen[0].body).params, { name: 'postedly_check_draft', arguments: data });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), result);
  assert.equal(postedly.commands.some(c => /checks (sign|pay|approve|connect|enroll)/.test(c.name)), false);
});

test('Postedly refuses raw bank or approval fields before a check-draft request is transmitted', async t => {
  const local = await localService(t, () => { throw new Error('No request should be sent'); });
  const data = { bankRef: 'bnk_synthetic_ready_masked_reference', payee: { kind: 'person', name: 'Synthetic payee', address1: '123 Synthetic St', city: 'Example', state: 'CA', postalCode: '90001' }, amountCents: 10000 };
  for (const invalid of [
    ...['accountNumber', 'routingNumber', 'signature', 'password', 'passkey', 'approved', 'acceptedTerms'].map(field => ({ ...data, [field]: 'must-not-be-transmitted' })),
    { ...data, payee: { ...data.payee, accountNumber: 'must-not-be-transmitted' } },
    { ...data, payee: null },
    { ...data, payee: { ...data.payee, name: { accountNumber: 'must-not-be-transmitted' } } },
  ]) await assert.rejects(run(postedly, ['checks', 'draft', '--base-url', local.origin, '--data', JSON.stringify(invalid)], local.env), /Check drafts accept only/);
  for (const bankRef of ['123456789', 'bnk_tooshort']) await assert.rejects(run(postedly, ['checks', 'draft', '--base-url', local.origin, '--data', JSON.stringify({ ...data, bankRef })], local.env), /masked bankRef/);
  for (const amountCents of [0, -1, 1.5, '10000']) await assert.rejects(run(postedly, ['checks', 'draft', '--base-url', local.origin, '--data', JSON.stringify({ ...data, amountCents })], local.env), /positive whole number/);
  assert.equal(local.seen.length, 0);
});

test('Postedly package version is consistent while legacy CLI versions and user agents retain their defaults', async () => {
  const metadata = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  assert.equal(metadata.version, '0.2.0');
  assert.equal(postedly.version, metadata.version);
  assert.match(help(postedly), /^Postedly CLI 0\.2\.0/);
  assert.equal(execFileSync(process.execPath, [fileURLToPath(new URL('./bin/postedly.mjs', import.meta.url)), '--version'], { encoding: 'utf8' }), '0.2.0\n');
  const current = await buildRequest(postedly, command('services list'), {}, postedly.baseUrl, {});
  assert.equal(current.init.headers['User-Agent'], 'postedly-cli/0.2.0');
  const legacy = { ...postedly, version: undefined };
  assert.match(help(legacy), /^Postedly CLI 0\.1\.0/);
  const old = await buildRequest(legacy, command('services list'), {}, legacy.baseUrl, {});
  assert.equal(old.init.headers['User-Agent'], 'postedly-cli/0.1.0');
});
