import { readFile, writeFile, mkdir, rename, chmod, lstat, rm, stat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const DEFAULT_VERSION = '0.1.0';
const productVersion = config => config.version || DEFAULT_VERSION;
const globalOptions = { 'base-url': { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' }, json: { type: 'boolean' } };
export function parseArgs(argv, definitions = {}) {
  const flags = {}, positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') { flags.help = true; continue; }
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const equal = arg.indexOf('=');
    const key = arg.slice(2, equal < 0 ? undefined : equal);
    const def = definitions[key];
    if (!def) throw new Error(`Unknown option --${key}. Use --help for supported options.`);
    if (Object.hasOwn(flags, key)) throw new Error(`Duplicate option --${key}.`);
    let value = equal < 0 ? undefined : arg.slice(equal + 1);
    if (def.type === 'boolean') {
      if (value === undefined) value = true;
      else if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else throw new Error(`--${key} must be true or false.`);
    } else {
      if (value === undefined) value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${key} requires a value.`);
      if (def.type === 'number' || def.type === 'integer') {
        value = Number(value);
        if (!Number.isFinite(value) || (def.type === 'integer' && !Number.isInteger(value))) throw new Error(`--${key} must be a valid ${def.type}.`);
      } else if (def.type === 'json') {
        try { value = JSON.parse(value); } catch { throw new Error(`--${key} requires valid JSON.`); }
      }
    }
    if (def.enum && !def.enum.includes(value)) throw new Error(`--${key} must be one of: ${def.enum.join(', ')}.`);
    flags[key] = value;
  }
  return { flags, positional };
}

export function validateBase(raw) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('--base-url must be an origin without credentials, path, query, or fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) throw new Error('Use HTTPS (HTTP is allowed only on loopback for local testing).');
  return url.origin;
}
function configPath(config, env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'product-clis', config.id, 'credentials.json');
}
async function secureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Credential directory must not be a symbolic link.');
  await chmod(path, 0o700);
}
export async function readCredentials(path, origin) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Credential file must not be a symbolic link.');
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (data.origin !== origin) return null;
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
export async function saveCredentials(path, data) {
  await secureDirectory(dirname(path));
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(data) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally { await rm(temporary, { force: true }); }
}
function endpoint(origin, path) {
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error('Endpoint must remain on the configured service origin.');
  return url;
}
async function boundedText(response, maxBytes = 20 * 1024 * 1024) {
  if (!response.body) return '';
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('Response exceeded the allowed size.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
function redact(message, secrets = []) {
  let value = String(message);
  for (const secret of secrets.filter(Boolean)) value = value.split(secret).join('[REDACTED]');
  return value.replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [REDACTED]').slice(0, 1500);
}
async function requestJSON(url, init = {}, secrets = []) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(60_000) });
  const text = await boundedText(response);
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 600) }; }
  if (!response.ok) throw new Error(redact(`HTTP ${response.status}: ${JSON.stringify(data)}`, secrets));
  return data;
}
function oauthForm(config, origin, values) {
  return { ...values, ...(config.auth.oauth.resource ? { resource: config.auth.oauth.resource.replace(config.baseUrl, origin) } : {}) };
}
async function refreshCredentials(config, origin, path, current) {
  if (!current.refreshToken || !config.auth.oauth) return current;
  const lock = path + '.lock';
  let locked = false;
  for (let attempts = 0; attempts < 300; attempts++) {
    try { await mkdir(lock, { mode: 0o700 }); locked = true; break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; await new Promise(r => setTimeout(r, 100)); }
  }
  if (!locked) throw new Error('Another CLI is refreshing credentials. Retry shortly; if a previous process crashed, remove the credentials.json.lock directory.');
  try {
    const latest = await readCredentials(path, origin);
    if (latest?.refreshRecoveryRequired) throw new Error('A previous token refresh was not confirmed. Run login again; the old refresh token will not be reused.');
    if (latest?.expiresAt > Date.now() + 30_000) return latest;
    if (!latest?.refreshToken) throw new Error('Sign in again with login.');
    await saveCredentials(path, { ...latest, refreshRecoveryRequired: true });
    const data = await requestJSON(endpoint(origin, config.auth.oauth.token), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(oauthForm(config, origin, { grant_type: 'refresh_token', client_id: latest.clientId, refresh_token: latest.refreshToken }))
    }, [latest.refreshToken, latest.token]);
    if (!data.access_token || !data.refresh_token) throw new Error('Token refresh did not return the rotated token pair; sign in again.');
    const next = { ...latest, refreshRecoveryRequired: false, token: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    await saveCredentials(path, next);
    return next;
  } finally { await rm(lock, { recursive: true, force: true }); }
}
async function getToken(config, origin, env) {
  if (env[config.auth.env]) return env[config.auth.env].trim();
  const path = configPath(config, env);
  let credential = await readCredentials(path, origin);
  if (!credential?.token) throw new Error(`Run ${config.id} login or set ${config.auth.env}. ${config.auth.help || ''}`);
  if (credential.refreshRecoveryRequired) throw new Error('A previous token refresh was not confirmed. Run login again.');
  if (credential.expiresAt && credential.expiresAt < Date.now() + 30_000) {
    if (!credential.refreshToken) throw new Error('Saved access token has expired. Run login again.');
    credential = await refreshCredentials(config, origin, path, credential);
  }
  return credential.token;
}
function openBrowser(url) {
  const executable = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(executable, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}
export async function oauthLogin(config, origin, path, noBrowser = false, write = s => process.stderr.write(s)) {
  const oauth = config.auth.oauth;
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  let resolveCode, rejectCode;
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  codePromise.catch(() => {});
  const server = createServer((req, res) => {
    const incoming = new URL(req.url, 'http://127.0.0.1');
    if (incoming.pathname !== '/callback') { res.writeHead(404).end(); return; }
    const supplied = incoming.searchParams.get('state') || '';
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(state))) { res.writeHead(400).end('Invalid login state.'); return; }
    if (incoming.searchParams.has('iss') && incoming.searchParams.get('iss') !== origin) { res.writeHead(400).end('Invalid authorization issuer.'); return; }
    if (incoming.searchParams.has('error')) { res.writeHead(400).end('Sign-in was declined.'); rejectCode(new Error('OAuth sign-in was declined.')); return; }
    const code = incoming.searchParams.get('code');
    if (!code) { res.writeHead(400).end('Missing authorization code.'); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Signed in. You can close this tab and return to your terminal.');
    resolveCode(code);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  const timeout = setTimeout(() => rejectCode(new Error('Sign-in timed out. Run login to try again.')), 5 * 60_000);
  try {
    const registration = await requestJSON(endpoint(origin, oauth.register), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: `${config.displayName} CLI`, redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' })
    });
    if (!registration.client_id) throw new Error('OAuth registration returned no client ID.');
    const url = endpoint(origin, oauth.authorize);
    const params = oauthForm(config, origin, { response_type: 'code', client_id: registration.client_id, redirect_uri: redirect, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state, scope: oauth.scopes.join(' ') });
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    write(`Finish sign-in in your browser:\n${url}\n`);
    if (!noBrowser) openBrowser(url.toString());
    const code = await codePromise;
    const token = await requestJSON(endpoint(origin, oauth.token), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(oauthForm(config, origin, { grant_type: 'authorization_code', client_id: registration.client_id, redirect_uri: redirect, code_verifier: verifier, code }))
    }, [code, verifier]);
    if (!token.access_token) throw new Error('OAuth response did not contain an access token.');
    await saveCredentials(path, { origin, token: token.access_token, refreshToken: token.refresh_token, clientId: registration.client_id, expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000 });
  } finally { clearTimeout(timeout); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
async function readSecret() {
  if (!process.stdin.isTTY) throw new Error('Use login --token-stdin with piped input, or run login in an interactive terminal.');
  // Read raw TTY input so credentials never echo to the screen.
  process.stderr.write('API key / access token (hidden): ');
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let token = '';
    const done = (error) => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stderr.write('\n'); error ? reject(error) : resolve(token); };
    const onData = chunk => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') { done(); return; }
        if (char === '\u0003' || char === '\u0004') { done(new Error('Login cancelled.')); return; }
        if (char === '\u007f' || char === '\b') token = token.slice(0, -1);
        else if (char >= ' ') token += char;
      }
    };
    process.stdin.on('data', onData);
  });
}
async function stdinText() {
  let text = '';
  for await (const chunk of process.stdin) { text += chunk; if (text.length > 1024 * 1024) throw new Error('Input is too large.'); }
  return text;
}
export function help(config, command) {
  const lines = [`${config.displayName} CLI ${productVersion(config)}`, config.description, '', `Usage: ${config.id} ${command?.name || '<command>'} [options]`, ''];
  if (command) {
    lines.push(command.description, '');
    for (const [key, option] of Object.entries(command.options || {})) lines.push(`  --${key}${option.type === 'boolean' ? '' : ' <value>'}${option.required ? ' (required)' : ''}${option.description ? '  ' + option.description : ''}${option.enum ? ' [' + option.enum.join('|') + ']' : ''}`);
    if (command.body) lines.push('  --data <JSON|@file>  Supply a JSON object; named flags override fields');
    if (command.requiresConfirmation) lines.push(`  --${command.requiresConfirmation}  Required explicit confirmation for this action`);
  } else {
    lines.push('  login                 Sign in with OAuth or a securely entered API key/token', '  logout                Remove this service’s saved local credentials', '  auth status           Show local credential status without revealing secrets');
    for (const item of config.commands) lines.push(`  ${item.name.padEnd(25)} ${item.description}`);
    lines.push('', 'Login options: --token-stdin, --no-browser (OAuth), --base-url <origin>');
  }
  lines.push('', 'Options: --help, --json, --output <new-file>, --base-url <https-origin>', 'Output is JSON by default. Errors go to stderr with a nonzero exit status.', `Credentials: ${config.auth.env} or a private local credentials file.`, `Website: ${config.homepage}`);
  return lines.join('\n') + '\n';
}
async function dataObject(value) {
  if (!value) return {};
  const text = value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value;
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('--data requires a JSON object or @path/to/file.json.'); }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('--data must be a JSON object.');
  return data;
}
async function fileBytes(path, maxBytes, contentTypes = ['application/pdf']) {
  if (!path) throw new Error('--file is required.');
  const info = await stat(path);
  if (!info.isFile() || info.size === 0 || info.size > maxBytes) throw new Error(`File must be nonempty and at most ${maxBytes} bytes.`);
  const bytes = await readFile(path);
  if (bytes.length > maxBytes) throw new Error('File grew beyond the maximum size.');
  let contentType;
  if (bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) contentType = 'application/pdf';
  else if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) contentType = 'image/png';
  else if (bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))) contentType = 'image/jpeg';
  else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') contentType = 'image/webp';
  if (!contentTypes.includes(contentType)) throw new Error(`Unsupported file format. Accepted: ${contentTypes.join(', ')}.`);
  return { bytes, contentType };
}
export async function buildRequest(config, command, flags, origin, env = process.env) {
  const body = { ...(command.bodyDefaults || {}), ...await dataObject(flags.data) };
  const headers = { Accept: command.mcpTool ? 'application/json, text/event-stream' : 'application/json', 'User-Agent': `${config.id}-cli/${productVersion(config)}` };
  let path = command.path || config.mcpPath;
  const query = {};
  if (command.requiresConfirmation && flags[command.requiresConfirmation] !== true) throw new Error(`This action requires --${command.requiresConfirmation}.`);
  for (const [name, option] of Object.entries(command.options || {})) {
    const key = option.key || name;
    let value = flags[name] ?? option.default;
    if (value === undefined && option.in === 'body') value = body[key];
    if (option.required && (value === undefined || value === '')) throw new Error(`--${name} is required.`);
    if (value === undefined) continue;
    if (option.mustBeTrue && value !== true) throw new Error(`--${name} must be true.`);
    if (option.type === 'boolean' && typeof value !== 'boolean') throw new Error(`--${name} must be a boolean.`);
    if (option.type === 'string' && typeof value !== 'string') throw new Error(`--${name} must be a string.`);
    if (option.enum && !option.enum.includes(value)) throw new Error(`--${name} must be one of: ${option.enum.join(', ')}.`);
    if (option.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`--${name} must be a number.`);
    if (option.in === 'path' && ['.', '..'].includes(String(value))) throw new Error(`Invalid --${name}.`);
    if (option.in === 'path') path = path.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
    else if (option.in === 'query') query[key] = value;
    else if (option.in === 'header') headers[key] = String(value === true && option.trueValue !== undefined ? option.trueValue : value);
    else if (option.in === 'body') body[key] = value;
  }
  if (/{[^}]+}/.test(path)) throw new Error('Missing required path argument.');
  if (command.validateBody) command.validateBody(body);
  const url = endpoint(origin, path);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  let token;
  if (command.rawFile?.tokenEnv) { token = env[command.rawFile.tokenEnv]?.trim(); if (!token) throw new Error(`Set ${command.rawFile.tokenEnv} to the upload-grant clientToken.`); }
  else if (command.auth !== false) token = await getToken(config, origin, env);
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (command.multipart) {
    const { fileOption = 'file', fileField = 'file', maxBytes = 10 * 1024 * 1024, fields = {} } = command.multipart;
    const { bytes, contentType } = await fileBytes(flags[fileOption], maxBytes, command.multipart.contentTypes);
    payload = new FormData();
    for (const [key, value] of Object.entries({ ...fields, ...body })) if (value !== undefined && value !== null) payload.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    payload.append(fileField, new Blob([bytes], { type: contentType }), basename(flags[fileOption]));
  } else if (command.rawFile) {
    payload = (await fileBytes(flags[command.rawFile.fileOption || 'file'], command.rawFile.maxBytes)).bytes;
    headers['Content-Type'] = command.rawFile.contentType;
  } else if (command.mcpTool) {
    headers['Content-Type'] = 'application/json';
    headers['MCP-Protocol-Version'] = '2025-03-26';
    payload = JSON.stringify({ jsonrpc: '2.0', id: randomBytes(8).toString('hex'), method: 'tools/call', params: { name: command.mcpTool, arguments: body } });
  } else if (command.body || Object.keys(body).length) {
    headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body);
  }
  return { url, init: { method: command.method || (command.mcpTool ? 'POST' : 'GET'), headers, ...(payload === undefined ? {} : { body: payload }) }, token };
}
export function parseMcp(text) {
  let data;
  try { data = JSON.parse(text); } catch {
    const events = text.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean);
    for (const event of events) { try { const candidate = JSON.parse(event); if (candidate.result || candidate.error) data = candidate; } catch {} }
  }
  if (!data) throw new Error('Service returned an invalid MCP response.');
  if (data.error) throw new Error(`MCP error: ${JSON.stringify(data.error)}`);
  if (data.result?.isError) throw new Error(`Tool error: ${JSON.stringify(data.result.structuredContent || data.result.content)}`);
  if (!data.result) throw new Error('MCP response contained no result.');
  if (data.result.structuredContent) return data.result.structuredContent;
  const content = data.result.content;
  if (content?.length === 1 && content[0].type === 'text') { try { return JSON.parse(content[0].text); } catch { return { text: content[0].text }; } }
  return data.result;
}
async function writeNewFile(path, data) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(data); } finally { await handle.close(); }
}
export async function run(config, argv = process.argv.slice(2), env = process.env) {
  if (argv.includes('--version')) { process.stdout.write(productVersion(config) + '\n'); return; }
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') { process.stdout.write(help(config)); return; }
  const command = config.commands.find(c => c.name.split(' ').every((part, i) => argv[i] === part));
  const builtin = argv[0] === 'login' || argv[0] === 'logout' || (argv[0] === 'auth' && argv[1] === 'status');
  if (!command && !builtin) throw new Error(`Unknown command. Run ${config.id} --help.`);
  const definition = { ...globalOptions, ...(command?.options || {}), ...(command?.body ? { data: { type: 'string' } } : {}), ...(command?.requiresConfirmation ? { [command.requiresConfirmation]: { type: 'boolean' } } : {}), ...(argv[0] === 'login' ? { 'token-stdin': { type: 'boolean' }, 'no-browser': { type: 'boolean' } } : {}) };
  const count = command ? command.name.split(' ').length : argv[0] === 'auth' ? 2 : 1;
  const { flags, positional } = parseArgs(argv.slice(count), definition);
  if (positional.length) throw new Error(`Unexpected arguments: ${positional.join(' ')}. Use named options; see --help.`);
  if (flags.help) { process.stdout.write(help(config, command)); return; }
  const origin = validateBase(flags['base-url'] || config.baseUrl);
  const path = configPath(config, env);
  if (argv[0] === 'login') {
    if (flags['token-stdin']) {
      const token = (await stdinText()).trim();
      if (!token || /\s/.test(token)) throw new Error('Provide one nonempty API key or access token on stdin.');
      await saveCredentials(path, { origin, token });
    } else if (config.auth.oauth) await oauthLogin(config, origin, path, flags['no-browser']);
    else {
      const token = (env[config.auth.env] || await readSecret()).trim();
      if (!token || /\s/.test(token)) throw new Error('Provide one nonempty API key or access token.');
      await saveCredentials(path, { origin, token });
    }
    process.stdout.write(JSON.stringify({ signedIn: true, origin, note: 'Credentials saved locally; server access is verified when you run a command.' }, null, 2) + '\n'); return;
  }
  if (argv[0] === 'logout') {
    await rm(path, { force: true });
    process.stdout.write(JSON.stringify({ signedOut: true, note: `Local credentials removed. Unset ${config.auth.env} separately if present; revoke keys or grants in the product to invalidate them remotely.` }, null, 2) + '\n'); return;
  }
  if (argv[0] === 'auth') {
    const saved = await readCredentials(path, origin);
    process.stdout.write(JSON.stringify({ origin, configured: Boolean(env[config.auth.env] || saved?.token), source: env[config.auth.env] ? 'environment' : saved?.token ? 'file' : null, expiresAt: saved?.expiresAt ? new Date(saved.expiresAt).toISOString() : null }, null, 2) + '\n'); return;
  }
  if (command.response === 'binary' && !flags.output) throw new Error('This download requires --output <new-file>.');
  if (flags.output) {
    try { await lstat(flags.output); throw new Error('--output already exists; choose a new file.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const request = await buildRequest(config, command, flags, origin, env);
  try {
    const response = await fetch(request.url, { ...request.init, redirect: 'error', signal: AbortSignal.timeout(command.timeoutMs || 120_000) });
    if (response.ok && command.response === 'binary') {
      const bytes = Buffer.from(await response.arrayBuffer());
      await writeNewFile(flags.output, bytes);
      process.stdout.write(JSON.stringify({ saved: flags.output, bytes: bytes.length }) + '\n'); return;
    }
    const text = await boundedText(response);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 1200)}`);
    let data;
    if (command.mcpTool) data = parseMcp(text);
    else { try { data = text ? JSON.parse(text) : { ok: true }; } catch { data = { text }; } }
    const output = JSON.stringify(data, null, 2) + '\n';
    if (flags.output) await writeNewFile(flags.output, output);
    else process.stdout.write(output);
  } catch (error) { throw new Error(redact(error.message, [request.token])); }
}
export async function main(config) {
  try { await run(config); }
  catch (error) { process.stderr.write(`${config.id}: ${error.message}\n`); process.exitCode = 1; }
}
