import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mentionedon from '../packages/mentionedon/product.mjs';
import intakra from '../packages/intakra/product.mjs';
import { buildRequest, parseArgs, parseMcp } from '../shared/runtime.mjs';

const command = (product, name) => {
  const found = product.commands.find(item => item.name === name);
  assert.ok(found, `${product.id} command ${name} exists`);
  return found;
};
const request = (product, name, flags = {}, env = {}) => buildRequest(product, command(product, name), flags, product.baseUrl, env);
const argsOf = result => JSON.parse(result.init.body).params.arguments;

// The fixtures are public tools/list snapshots taken on 2026-10-21, not invented API schemas.
// Native Intakra's additional three actions are checked against live GET /api/mcp metadata
// and src/app/api/mcp/tools.ts at 1c3299106515b8cef1572b3991508672f3f4343e.
for (const product of [mentionedon, intakra]) {
  test(`${product.id} named options match the live advertised tool input fields`, async () => {
    const snapshot = JSON.parse(await readFile(new URL(`../packages/${product.id}/contracts/mcp-tools.json`, import.meta.url)));
    for (const tool of snapshot.tools) {
      const entry = product.commands.find(item => item.mcpTool === tool.name);
      assert.ok(entry, `descriptor exists for ${tool.name}`);
      const fields = Object.keys(tool.inputSchema.properties || {});
      for (const [flag, option] of Object.entries(entry.options || {})) {
        assert.ok(fields.includes(option.key || flag), `${tool.name}: --${flag} maps to a live input field`);
      }
      for (const key of Object.keys(entry.bodyDefaults || {})) assert.ok(fields.includes(key), `${tool.name}: default ${key} is a live field`);
      for (const required of tool.inputSchema.required || []) {
        const option = Object.entries(entry.options || {}).find(([flag, item]) => (item.key || flag) === required);
        assert.ok(Object.hasOwn(entry.bodyDefaults || {}, required) || option?.[1].required, `${tool.name}: required ${required} is enforced`);
      }
    }
  });
}

test('MentionedOn public evidence accepts @file and never attaches a configured token', async () => {
  const file = fileURLToPath(new URL('../packages/mentionedon/examples/readiness.json', import.meta.url));
  const result = await request(mentionedon, 'evidence readiness', { data: `@${file}` }, { MENTIONEDON_ACCESS_TOKEN: 'secret-should-not-be-used' });
  assert.equal(result.url.href, 'https://mentioned-on.com/mcp');
  assert.equal(result.init.method, 'POST');
  assert.equal(result.init.headers.Authorization, undefined);
  assert.equal(JSON.parse(result.init.body).params.name, 'analyze_discovery_readiness');
  assert.equal(argsOf(result).businessName, 'Example Business');
  assert.equal(argsOf(result).signals.length, 3);
});

test('Intakra public review overrides the native MCP path and does not read credentials', async () => {
  const file = fileURLToPath(new URL('../packages/intakra/examples/evidence.json', import.meta.url));
  const result = await request(intakra, 'evidence review', { data: `@${file}` }, { INTAKRA_API_KEY: 'secret-should-not-be-used' });
  assert.equal(result.url.pathname, '/mcp');
  assert.equal(result.init.headers.Authorization, undefined);
  assert.equal(JSON.parse(result.init.body).params.name, 'prepare_why_now_review');
  assert.equal(argsOf(result).asOfDate, '2026-10-21');
});

test('Intakra named flags preserve JSON arrays and API field spelling', async () => {
  const entry = command(intakra, 'accounts list');
  const { flags } = parseArgs(['--domains', '["example.com","example.org"]', '--offset', '50'], entry.options);
  const result = await request(intakra, entry.name, flags, { INTAKRA_API_KEY: 'ik_live_synthetic' });
  assert.equal(result.url.pathname, '/api/mcp');
  assert.equal(result.init.headers.Authorization, 'Bearer ik_live_synthetic');
  assert.deepEqual(argsOf(result), { domains: ['example.com', 'example.org'], offset: 50 });
  const contact = await request(intakra, 'leads contact', { 'opportunity-id': 'eop_synthetic' }, { INTAKRA_API_KEY: 'ik_live_synthetic' });
  assert.deepEqual(argsOf(contact), { opportunity_id: 'eop_synthetic' });
});

test('MentionedOn website operations require explicit confirmation before credential lookup', async () => {
  await assert.rejects(request(mentionedon, 'website inspect', { 'business-id': 'synthetic', revision: 0 }), /--confirm-write/);
  await assert.rejects(request(mentionedon, 'website draft', { data: '{"confirmed":true}' }), /--confirm-facts/);
  const result = await request(mentionedon, 'website inspect', { 'business-id': 'synthetic', revision: 0, 'confirm-write': true }, { MENTIONEDON_ACCESS_TOKEN: 'mo_oat_synthetic' });
  assert.deepEqual(argsOf(result), { businessId: 'synthetic', revision: 0, authorizationAcknowledged: true });
});

test('MentionedOn named revision overrides @data while confirmed facts remain explicit', async () => {
  const result = await request(mentionedon, 'website draft', {
    data: JSON.stringify({ businessId: 'synthetic', revision: 1, businessType: 'LocalBusiness', facts: { name: 'Synthetic Business' } }),
    revision: 2, 'confirm-facts': true,
  }, { MENTIONEDON_ACCESS_TOKEN: 'mo_oat_synthetic' });
  assert.deepEqual(argsOf(result), { confirmed: true, businessId: 'synthetic', revision: 2, businessType: 'LocalBusiness', facts: { name: 'Synthetic Business' } });
});

test('Intakra stopping a watch preserves explicit false and rejects an omitted active choice', async () => {
  const entry = command(intakra, 'projects watch');
  const { flags } = parseArgs(['--opportunity-id', 'eop_synthetic', '--active=false'], entry.options);
  const result = await request(intakra, entry.name, { ...flags, 'confirm-write': true }, { INTAKRA_API_KEY: 'ik_live_synthetic' });
  assert.deepEqual(argsOf(result), { opportunity_id: 'eop_synthetic', active: false });
  await assert.rejects(request(intakra, entry.name, { 'opportunity-id': 'eop_synthetic', 'confirm-write': true }, { INTAKRA_API_KEY: 'ik_live_synthetic' }), /--active/);
});

test('Intakra consequences cannot be authorized inside --data alone', async () => {
  await assert.rejects(request(intakra, 'crm push', { data: '{"opportunity_id":"eop_synthetic","confirm-crm":true}' }), /--confirm-crm/);
  await assert.rejects(request(intakra, 'accounts request', { description: 'Synthetic companies' }), /--confirm-research/);
  await assert.rejects(request(intakra, 'offering set', { offering: 'Synthetic offering' }), /--confirm-write/);
});

test('MCP extraction supports live structured results and surfaces service validation errors', () => {
  const body = { jsonrpc: '2.0', id: 1, result: { structuredContent: { businesses: [] }, content: [{ type: 'text', text: '{"businesses":[]}' }] } };
  assert.deepEqual(parseMcp(JSON.stringify(body)), { businesses: [] });
  assert.deepEqual(parseMcp(`event: message\ndata: ${JSON.stringify(body)}\n\n`), { businesses: [] });
  assert.throws(() => parseMcp(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'Revision changed. Read saved facts again.' }] } })), /Revision changed/);
});
