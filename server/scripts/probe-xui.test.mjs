import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('./probe-xui.mjs', import.meta.url));

async function runProbe({ legacy = false, bearer = false, rejectType, failCleanup = false, omitId = false } = {}) {
  const requests = [];
  const created = [];
  const deleted = [];
  let loggedIn = false;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ path: req.url, headers: req.headers, body });
    const reply = (status, payload, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    };
    if (req.url === '/base/') return reply(200, {});
    if (req.url === '/base/csrf-token' && !bearer && !legacy) {
      return reply(200, { success: true, obj: loggedIn ? 'after' : 'before' }, {
        'set-cookie': [`session=${loggedIn ? 'authenticated' : 'anonymous'}; Path=/base; HttpOnly`],
      });
    }
    if (req.url === '/base/login' && req.method === 'POST') {
      if (!legacy && (req.headers['x-csrf-token'] !== 'before' || req.headers.cookie !== 'session=anonymous')) {
        return reply(403, { success: false, msg: 'Login CSRF rejected' });
      }
      loggedIn = true;
      return reply(200, { success: true }, { 'set-cookie': ['session=authenticated; Path=/base; HttpOnly'] });
    }
    if (!req.url.startsWith('/base/panel/api/')) return reply(404, {});
    const authorized = bearer
      ? req.headers.authorization === 'Bearer test-token'
      : loggedIn && req.headers.cookie === 'session=authenticated' && (legacy || req.headers['x-csrf-token'] === 'after');
    if (!authorized) return reply(403, { success: false, msg: 'Session CSRF rejected' });
    if (req.url.endsWith('/status')) return reply(200, { success: true, obj: { panelVersion: '3.6.0' } });
    if (req.url.endsWith('/getNewX25519Cert')) return reply(200, { success: true, obj: { privateKey: 'private', publicKey: 'public' } });
    if (req.url.endsWith('/getWebCertFiles')) return reply(200, { success: true, obj: { webCertFile: '/cert/fullchain.pem', webKeyFile: '/cert/privkey.pem' } });
    if (req.url.endsWith('/inbounds/list')) return reply(200, { success: true, obj: [{ id: 999, port: created[0]?.port, remark: 'existing-user-inbound' }, ...created] });
    if (req.url.endsWith('/inbounds/add')) {
      if (body.protocol === rejectType) return reply(200, { success: false, msg: 'Unsupported protocol fixture' });
      const saved = { ...body, id: created.length + 1 };
      created.push(saved);
      return reply(200, { success: true, obj: omitId ? {} : { id: saved.id } });
    }
    if (req.url.includes('/inbounds/del/')) {
      if (failCleanup) return reply(500, { success: false, msg: 'Cleanup fixture' });
      deleted.push(Number(req.url.split('/').at(-1)));
      return reply(200, { success: true });
    }
    return reply(404, {});
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const args = [script, '--url', `http://127.0.0.1:${server.address().port}/base`, '--sni', 'cover.example'];
    args.push(...(bearer ? ['--token', 'test-token'] : ['--user', 'admin', '--pass', 'password']));
    let exitCode = 0;
    let output;
    try {
      output = await execute(process.execPath, args, { timeout: 10000, env: { PATH: process.env.PATH } });
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      exitCode = error.code;
      output = error;
    }
    return { exitCode, output: output.stdout + output.stderr, requests, created, deleted };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('refreshes CSRF after login and diagnoses all eight types with cleanup', async () => {
  const result = await runProbe();
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(result.created.length, 8);
  assert.equal(result.deleted.length, 8);
  assert.equal(result.requests.filter((r) => r.path.endsWith('/csrf-token')).length, 2);
  assert.equal(new Set(result.created.map((r) => r.port)).size, 8);
  assert.deepEqual(result.created.map((r) => r.protocol), ['vless', 'vless', 'vless', 'vless', 'vmess', 'shadowsocks', 'trojan', 'hysteria']);
  for (const inbound of result.created) {
    for (const client of JSON.parse(inbound.settings).clients) {
      if (inbound.protocol !== 'hysteria') assert.equal(client.tgId, 0);
      if (inbound.protocol === 'vmess') assert.equal(client.alterId, 0);
    }
  }
  const tls = JSON.parse(result.created.at(-1).streamSettings).tlsSettings;
  assert.equal(tls.certificates[0].certificateFile, '/cert/fullchain.pem');
});

test('supports legacy panels without a CSRF endpoint', async () => {
  const result = await runProbe({ legacy: true });
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(result.deleted.length, 8);
});

test('uses Bearer authentication without requesting CSRF or login', async () => {
  const result = await runProbe({ bearer: true });
  assert.equal(result.exitCode, 0, result.output);
  assert.ok(result.requests.every((r) => !/csrf-token|login/.test(r.path)));
});

test('reports panel rejection and continues diagnosing the remaining types', async () => {
  const result = await runProbe({ rejectType: 'vmess' });
  assert.equal(result.exitCode, 1);
  assert.equal(result.created.length, 7);
  assert.equal(result.deleted.length, 7);
  assert.match(result.output, /Unsupported protocol fixture/);
});

test('stops if a temporary inbound cannot be removed', async () => {
  const result = await runProbe({ failCleanup: true });
  assert.equal(result.exitCode, 1);
  assert.equal(result.created.length, 1);
  assert.match(result.output, /ID 1/);
});

test('recovers missing IDs by unique remark without deleting an existing inbound', async () => {
  const result = await runProbe({ omitId: true });
  assert.equal(result.exitCode, 0, result.output);
  assert.deepEqual(result.deleted, [1, 2, 3, 4, 5, 6, 7, 8]);
});
