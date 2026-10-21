import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRequest, parseArgs, parseMcp, saveCredentials, readCredentials, validateBase } from '../shared/runtime.mjs';

const config = { id: 'example', baseUrl: 'https://example.test', mcpPath: '/mcp', auth: { env: 'EXAMPLE_TOKEN' } };

test('parser rejects typos, malformed JSON, duplicate flags and preserves explicit false', () => {
  assert.throws(() => parseArgs(['--typo'], {}), /Unknown option/);
  assert.throws(() => parseArgs(['--value', '{'], { value: { type: 'json' } }), /valid JSON/);
  assert.throws(() => parseArgs(['--active', '--active'], { active: { type: 'boolean' } }), /Duplicate/);
  assert.equal(parseArgs(['--active=false'], { active: { type: 'boolean' } }).flags.active, false);
});

test('URLs reject remote HTTP, userinfo, and credential forwarding to another origin', async () => {
  assert.throws(() => validateBase('http://example.test'), /HTTPS/);
  assert.throws(() => validateBase('https://user:password@example.test'), /credentials/);
  assert.throws(() => validateBase('https://example.test/path'), /origin/);
  assert.equal(validateBase('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  await assert.rejects(buildRequest(config, { path: 'https://attacker.test/', auth: false }, {}, config.baseUrl), /origin/);
});

test('local credentials have private permissions and are bound to an origin', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'product-cli-auth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'nested', 'credentials.json');
  await saveCredentials(path, { origin: config.baseUrl, token: 'fixture-secret' });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, 'nested'))).mode & 0o777, 0o700);
  assert.equal((await readCredentials(path, config.baseUrl)).token, 'fixture-secret');
  assert.equal(await readCredentials(path, 'https://another.test'), null);
});

test('required fields supplied via JSON work; confirmation cannot be smuggled in JSON', async () => {
  const cmd = { mcpTool: 'write', auth: false, body: true, requiresConfirmation: 'confirm-write', options: { name: { in: 'body', type: 'string', required: true } } };
  await assert.rejects(buildRequest(config, cmd, { data: '{"name":"example","confirm-write":true}' }, config.baseUrl), /requires --confirm-write/);
  const result = await buildRequest(config, cmd, { data: '{"name":"example"}', 'confirm-write': true }, config.baseUrl);
  assert.deepEqual(JSON.parse(result.init.body).params.arguments, { name: 'example' });
  await assert.rejects(buildRequest(config, cmd, { data: '{"name":42}', 'confirm-write': true }, config.baseUrl), /string/);
});

test('MCP understands JSON and SSE, and fails on RPC or tool errors', () => {
  const result = { jsonrpc: '2.0', id: '1', result: { structuredContent: { count: 3 } } };
  assert.deepEqual(parseMcp(JSON.stringify(result)), { count: 3 });
  assert.deepEqual(parseMcp(`event: message\ndata: ${JSON.stringify(result)}\n\n`), { count: 3 });
  assert.throws(() => parseMcp('{"error":{"code":-32602,"message":"bad input"}}'), /MCP error/);
  assert.throws(() => parseMcp('{"result":{"isError":true,"content":[{"type":"text","text":"declined"}]}}'), /Tool error/);
});

test('required boolean supports false for opt-out and explicit mustBeTrue guards consent', async () => {
  const cmd = { mcpTool: 'watch', auth: false, options: { active: { in: 'body', type: 'boolean', required: true } } };
  const result = await buildRequest(config, cmd, { active: false }, config.baseUrl);
  assert.equal(JSON.parse(result.init.body).params.arguments.active, false);
  await assert.rejects(buildRequest(config, { ...cmd, options: { active: { ...cmd.options.active, mustBeTrue: true } } }, { active: false }, config.baseUrl), /must be true/);
});

test('path parameters cannot normalize into a different endpoint', async () => {
  const cmd = { path: '/v1/items/{id}', auth: false, options: { id: { in: 'path', type: 'string', required: true } } };
  await assert.rejects(buildRequest(config, cmd, { id: '..' }, config.baseUrl), /Invalid/);
  const request = await buildRequest(config, cmd, { id: 'a/b?c' }, config.baseUrl);
  assert.equal(request.url.pathname, '/v1/items/a%2Fb%3Fc');
});
