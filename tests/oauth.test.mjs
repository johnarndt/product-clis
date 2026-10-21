import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import postedly from '../packages/postedly/product.mjs';
import { buildRequest, oauthLogin, readCredentials, saveCredentials } from '../shared/runtime.mjs';

const account = postedly.commands.find(command => command.name === 'account show');

async function fixture(t, handler) {
  const directory = await mkdtemp(join(tmpdir(), 'product-clis-oauth-'));
  const server = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      await handler(req, res, body);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    directory,
    path: join(directory, 'product-clis', postedly.id, 'credentials.json'),
    env: { XDG_CONFIG_HOME: directory },
  };
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function authorizationFromOutput(text) {
  const line = text.split('\n').find(value => /^https?:\/\//.test(value));
  assert.ok(line, 'Login should print the browser authorization URL.');
  return new URL(line);
}

function callbackFor(authorization, values = {}) {
  const url = new URL(authorization.searchParams.get('redirect_uri'));
  url.search = new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'test-authorization-code', ...values });
  return url;
}

test('Postedly browser login registers a public client and exchanges matching PKCE, resource and callback', async t => {
  let registration;
  let authorization;
  let exchange;
  let callbackTask;
  let output = '';
  const local = await fixture(t, (req, res, body) => {
    if (req.url === '/oauth/register') {
      registration = JSON.parse(body);
      assert.equal(req.method, 'POST');
      assert.equal(registration.token_endpoint_auth_method, 'none');
      assert.deepEqual(registration.grant_types, ['authorization_code', 'refresh_token']);
      assert.equal(registration.redirect_uris.length, 1);
      return json(res, { client_id: 'public-client' }, 201);
    }
    assert.equal(req.url, '/oauth/token');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(req.headers.authorization, undefined);
    exchange = new URLSearchParams(body);
    assert.equal(exchange.get('grant_type'), 'authorization_code');
    assert.equal(exchange.get('client_id'), 'public-client');
    assert.equal(exchange.get('code'), 'test-authorization-code');
    assert.equal(exchange.get('redirect_uri'), registration.redirect_uris[0]);
    assert.equal(exchange.get('resource'), `${local.origin}/mcp/send`);
    assert.match(exchange.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
    assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'));
    return json(res, { token_type: 'Bearer', access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600 });
  });

  await oauthLogin(postedly, local.origin, local.path, true, text => {
    output += text;
    authorization = authorizationFromOutput(text);
    assert.equal(authorization.origin, local.origin);
    assert.equal(authorization.pathname, '/oauth/authorize');
    assert.equal(authorization.searchParams.get('resource'), `${local.origin}/mcp/send`);
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('response_type'), 'code');
    assert.deepEqual(authorization.searchParams.get('scope').split(' '), postedly.auth.oauth.scopes);
    const redirect = new URL(authorization.searchParams.get('redirect_uri'));
    assert.equal(redirect.hostname, '127.0.0.1');
    assert.equal(redirect.pathname, '/callback');
    callbackTask = fetch(callbackFor(authorization, { iss: local.origin })).then(response => assert.equal(response.status, 200));
    callbackTask.catch(() => {});
  });
  await callbackTask;
  const saved = await readCredentials(local.path, local.origin);
  assert.equal(saved.token, 'access-secret');
  assert.equal(saved.refreshToken, 'refresh-secret');
  assert.equal(saved.clientId, 'public-client');
  assert.ok(saved.expiresAt > Date.now() + 3_500_000);
  assert.ok(saved.expiresAt <= Date.now() + 3_600_000);
  assert.equal((await stat(local.path)).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(local.path))).mode & 0o777, 0o700);
  assert.equal(await readCredentials(local.path, 'https://other.example'), null);
  for (const secret of ['access-secret', 'refresh-secret', 'test-authorization-code', exchange.get('code_verifier')]) assert.equal(output.includes(secret), false);
});

test('OAuth callback rejects wrong and multibyte state, then permits the valid callback', async t => {
  let tokenRequests = 0;
  let callbackTask;
  const local = await fixture(t, (req, res) => {
    if (req.url === '/oauth/register') return json(res, { client_id: 'client' }, 201);
    tokenRequests++;
    return json(res, { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
  });
  await oauthLogin(postedly, local.origin, local.path, true, text => {
    const authorization = authorizationFromOutput(text);
    callbackTask = (async () => {
      try {
        for (const state of ['incorrect-state', 'é'.repeat(authorization.searchParams.get('state').length)]) {
          const rejected = await fetch(callbackFor(authorization, { state }), { signal: AbortSignal.timeout(3000) });
          assert.equal(rejected.status, 400);
          assert.equal(tokenRequests, 0);
        }
      } finally {
        const accepted = await fetch(callbackFor(authorization));
        assert.equal(accepted.status, 200);
      }
    })();
    callbackTask.catch(() => {});
  });
  await callbackTask;
  assert.equal(tokenRequests, 1);
});

test('Declined browser consent does not exchange a code or save credentials', async t => {
  let tokenRequests = 0;
  let callbackTask;
  const local = await fixture(t, (req, res) => {
    if (req.url === '/oauth/register') return json(res, { client_id: 'client' }, 201);
    tokenRequests++;
    return json(res, { access_token: 'unexpected' });
  });
  await assert.rejects(oauthLogin(postedly, local.origin, local.path, true, text => {
    const authorization = authorizationFromOutput(text);
    callbackTask = fetch(callbackFor(authorization, { error: 'access_denied' })).then(response => assert.equal(response.status, 400));
    callbackTask.catch(() => {});
  }), /declined/i);
  await callbackTask;
  assert.equal(tokenRequests, 0);
  assert.equal(await readCredentials(local.path, local.origin), null);
});

test('OAuth exchange errors redact authorization code and private PKCE verifier', async t => {
  let exchangedSecrets;
  let callbackTask;
  const local = await fixture(t, (req, res, body) => {
    if (req.url === '/oauth/register') return json(res, { client_id: 'client' }, 201);
    const form = new URLSearchParams(body);
    exchangedSecrets = [form.get('code'), form.get('code_verifier')];
    return json(res, { error: 'invalid_grant', error_description: exchangedSecrets.join(' ') }, 400);
  });
  let failure;
  try {
    await oauthLogin(postedly, local.origin, local.path, true, text => {
      callbackTask = fetch(callbackFor(authorizationFromOutput(text)));
      callbackTask.catch(() => {});
    });
  } catch (error) { failure = error; }
  await callbackTask;
  assert.ok(failure);
  assert.match(failure.message, /HTTP 400/);
  for (const secret of exchangedSecrets) assert.equal(failure.message.includes(secret), false);
  assert.equal(await readCredentials(local.path, local.origin), null);
});

test('Concurrent expired-token requests perform one refresh and atomically retain the new pair', async t => {
  let refreshRequests = 0;
  const local = await fixture(t, async (req, res, body) => {
    assert.equal(req.url, '/oauth/token');
    const form = new URLSearchParams(body);
    refreshRequests++;
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('client_id'), 'client');
    assert.equal(form.get('refresh_token'), 'refresh-old');
    assert.equal(form.get('resource'), `${local.origin}/mcp/send`);
    await delay(75);
    return json(res, { token_type: 'Bearer', access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 3600 });
  });
  await saveCredentials(local.path, { origin: local.origin, token: 'access-old', refreshToken: 'refresh-old', clientId: 'client', expiresAt: Date.now() - 1000 });
  const requests = await Promise.all(Array.from({ length: 4 }, () => buildRequest(postedly, account, {}, local.origin, local.env)));
  assert.equal(refreshRequests, 1);
  for (const request of requests) assert.equal(request.init.headers.Authorization, 'Bearer access-new');
  const saved = JSON.parse(await readFile(local.path, 'utf8'));
  assert.equal(saved.token, 'access-new');
  assert.equal(saved.refreshToken, 'refresh-new');
  assert.equal(saved.refreshRecoveryRequired, false);
  await assert.rejects(stat(local.path + '.lock'), { code: 'ENOENT' });
});

test('An uncertain refresh cannot replay the old refresh token on the next command', async t => {
  let refreshRequests = 0;
  const local = await fixture(t, (req) => {
    assert.equal(req.url, '/oauth/token');
    refreshRequests++;
    // Model a server that rotated the grant but lost the response in transit.
    req.socket.destroy();
  });
  await saveCredentials(local.path, { origin: local.origin, token: 'access-old', refreshToken: 'refresh-old', clientId: 'client', expiresAt: Date.now() - 1000 });
  await assert.rejects(buildRequest(postedly, account, {}, local.origin, local.env));
  const saved = await readCredentials(local.path, local.origin);
  assert.equal(saved.refreshRecoveryRequired, true);
  await assert.rejects(buildRequest(postedly, account, {}, local.origin, local.env), /login|sign in|refresh/i);
  assert.equal(refreshRequests, 1, 'The retired refresh token must never be retried.');
});

test('Environment OAuth tokens take precedence and do not refresh a stored connection', async t => {
  let requests = 0;
  const local = await fixture(t, (req, res) => { requests++; json(res, { error: 'Unexpected network request.' }, 500); });
  await saveCredentials(local.path, { origin: local.origin, token: 'access-old', refreshToken: 'refresh-old', clientId: 'client', expiresAt: Date.now() - 1000 });
  const request = await buildRequest(postedly, account, {}, local.origin, { ...local.env, POSTEDLY_TOKEN: 'environment-token' });
  assert.equal(request.init.headers.Authorization, 'Bearer environment-token');
  assert.equal(requests, 0);
  assert.equal((await readCredentials(local.path, local.origin)).token, 'access-old');
});
