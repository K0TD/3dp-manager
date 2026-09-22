#!/usr/bin/env node

/**
 * server/scripts/probe-xui.mjs
 * Автономный пробник совместимости с панелями 3x-ui.
 * Не требует базы данных и контекста NestJS.
 *
 * Использование:
 *   node server/scripts/probe-xui.mjs --url <URL> --token <TOKEN> [--insecure]
 *   node server/scripts/probe-xui.mjs --url <URL> --login <USER> --password <PASS> [--insecure]
 */

import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { buildCases } from './probe-xui-payloads.mjs';

const ARGS = parseArgs(process.argv.slice(2));

if (ARGS.help || ARGS.h) {
  printUsage();
  process.exit(0);
}

const URL_INPUT = ARGS.url || process.env.XUI_URL;
const TOKEN = ARGS.token || process.env.XUI_TOKEN;
const LOGIN = ARGS.login || ARGS.user || process.env.XUI_LOGIN || process.env.XUI_USER;
const PASSWORD = ARGS.password || ARGS.pass || process.env.XUI_PASSWORD || process.env.XUI_PASS;
const SNI = ARGS.sni || 'www.cloudflare.com';
const ALLOW_INSECURE = Boolean(ARGS.insecure || ARGS['allow-insecure'] || process.env.XUI_ALLOW_INSECURE);

if (!URL_INPUT) {
  console.error('\x1b[31mОшибка: укажите URL ноды 3x-ui через --url или переменную XUI_URL\x1b[0m\n');
  printUsage();
  process.exit(1);
}

if (!TOKEN && (!LOGIN || !PASSWORD)) {
  console.error('\x1b[31mОшибка: укажите либо --token, либо пару --login и --password\x1b[0m\n');
  printUsage();
  process.exit(1);
}

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

const ok = `${colors.green}✔${colors.reset}`;
const fail = `${colors.red}✖${colors.reset}`;
const warn = `${colors.yellow}⚠${colors.reset}`;
const info = `${colors.cyan}ℹ${colors.reset}`;

async function main() {
  console.log(`\n${colors.bold}${colors.cyan}=== 3dp-manager: Пробник совместимости 3x-ui ===${colors.reset}\n`);

  const baseUrl = normalizeUrl(URL_INPUT);
  console.log(`${info} Целевой адрес: ${colors.bold}${baseUrl}${colors.reset}`);
  console.log(`${info} Режим SSL:     ${ALLOW_INSECURE ? colors.yellow + 'Проверка сертификатов отключена (--insecure)' : colors.green + 'Строгая проверка'}${colors.reset}`);
  console.log(`${info} Тип авторизации: ${TOKEN ? 'Bearer токен' : `Логин/пароль (${LOGIN})`}\n`);

  const client = new XuiHttpClient(baseUrl, ALLOW_INSECURE);
  const report = {
    connectivity: false,
    auth: false,
    csrfActive: false,
    panelVersion: null,
    xrayVersion: null,
    realityKeys: false,
    certPaths: null,
    inbounds: [],
  };

  // 1. Проверка доступности
  process.stdout.write(`[1/6] Проверка сетевой доступности и базового эндпоинта... `);
  const startTime = Date.now();
  const pingRes = await client.request('GET', '');
  const latency = Date.now() - startTime;
  if (!pingRes.ok && pingRes.status !== 301 && pingRes.status !== 302 && pingRes.status !== 200 && pingRes.status !== 404) {
    console.log(`${fail} Недоступен (HTTP ${pingRes.status || 'ERR'}, ${pingRes.error || ''})`);
    process.exit(1);
  }
  report.connectivity = true;
  console.log(`${ok} Доступен (${latency}ms, HTTP ${pingRes.status})`);

  // 2. Аутентификация
  process.stdout.write(`[2/6] Авторизация на панели... `);
  if (TOKEN) {
    client.setBearerToken(TOKEN);
    const listRes = await client.request('GET', 'panel/api/inbounds/list');
    if (listRes.status === 200 && listRes.json?.success) {
      report.auth = true;
      console.log(`${ok} Токен валиден`);
    } else {
      console.log(`${fail} Токен отвергнут (HTTP ${listRes.status}: ${listRes.json?.msg || listRes.error || ''})`);
      process.exit(1);
    }
  } else {
    // Парольная авторизация: сначала ищем предлогиновый CSRF токен (v3.6.0+)
    const preLoginCsrf = await client.fetchPreLoginCsrf();
    if (preLoginCsrf) {
      report.csrfActive = true;
    }
    const loginRes = await client.login(LOGIN, PASSWORD, preLoginCsrf);
    if (loginRes.success) {
      report.auth = true;
      console.log(`${ok} Вход выполнен успешно${preLoginCsrf ? ' (CSRF токен обнаружен и применён)' : ''}`);
    } else {
      console.log(`${fail} Вход не удался: ${loginRes.msg || loginRes.error || 'Проверьте логин и пароль'}`);
      process.exit(1);
    }
  }

  // 3. Версии панели и Xray
  process.stdout.write(`[3/6] Определение версии панели и Xray-core... `);
  const statusRes = await client.request('GET', 'panel/api/server/status');
  if (statusRes.json?.obj) {
    const s = statusRes.json.obj;
    report.xrayVersion = s.xray?.version || s.xrayVersion || null;
  }
  report.panelVersion = client.lastHeaders['x-ui-version'] || client.lastHeaders['x-3x-ui-version'] || null;
  if (!report.panelVersion) {
    const updateRes = await client.request('GET', 'panel/api/server/checkVersion');
    if (updateRes.json?.obj?.currentVersion) {
      report.panelVersion = updateRes.json.obj.currentVersion;
    }
  }
  console.log(`${ok} 3x-ui: ${colors.bold}${report.panelVersion || 'не определена'}${colors.reset}, Xray: ${colors.bold}${report.xrayVersion || 'не определена'}${colors.reset}`);

  // 4. Reality ключи (X25519)
  process.stdout.write(`[4/6] Проверка генерации ключей Reality (X25519)... `);
  const certRes = await client.request('GET', 'panel/api/server/getNewX25519Cert');
  if (certRes.json?.success && certRes.json?.obj?.publicKey && certRes.json?.obj?.privateKey) {
    report.realityKeys = true;
    console.log(`${ok} Ключи сгенерированы (${certRes.json.obj.publicKey.slice(0, 16)}...)`);
  } else {
    console.log(`${warn} Не поддерживается или ошибка (${certRes.json?.msg || certRes.status})`);
  }

  // 5. TLS-сертификаты панели
  process.stdout.write(`[5/6] Проверка путей TLS-сертификата панели... `);
  const certFilesRes = await client.request('GET', 'panel/api/server/getWebCertFiles');
  if (certFilesRes.json?.success && (certFilesRes.json?.obj?.webCertFile || certFilesRes.json?.obj?.certPath)) {
    report.certPaths = certFilesRes.json.obj;
    console.log(`${ok} Сертификат: ${report.certPaths.webCertFile || report.certPaths.certPath}`);
  } else {
    console.log(`${info} Авто-сертификат панели не настроен (требуются свои пути для TLS)`);
  }

  // 6. Проверяем каждый тип отдельно и сохраняем причину отказа панели.
  console.log('[6/6] Проверка создания восьми типов инбаундов...');
  const certificateFile = ARGS['certificate-file'] || report.certPaths?.webCertFile || report.certPaths?.certPath || `/root/cert/${SNI}/fullchain.pem`;
  const keyFile = ARGS['key-file'] || report.certPaths?.webKeyFile || report.certPaths?.keyPath || `/root/cert/${SNI}/privkey.pem`;
  const usedPorts = new Set();
  for (const testCase of buildCases(certRes.json?.obj || {}, SNI, certificateFile, keyFile)) {
    const testPort = ARGS.port ? Number(ARGS.port) + report.inbounds.length : nextPort(usedPorts);
    if (!Number.isInteger(testPort) || testPort < 1 || testPort > 65535) {
      throw new Error('Порт для тестовых инбаундов должен быть в диапазоне 1–65535');
    }
    const payload = testCase.build(testPort, crypto.randomUUID());
    payload.remark = `probe-${testCase.type}-${crypto.randomUUID()}`;
    const addRes = await client.request('POST', 'panel/api/inbounds/add', payload);
    const accepted = addRes.ok && addRes.json?.success === true;
    const result = {
      type: testCase.type,
      port: testPort,
      status: addRes.status,
      accepted,
      deleted: false,
      message: accepted ? '' : String(addRes.json?.msg || addRes.error || addRes.body.slice(0, 300)),
    };
    report.inbounds.push(result);
    // If the request timed out, it may still have created an inbound. Recover
    // ownership by our unique remark, never by a possibly occupied port.
    let createdId = Number(typeof addRes.json?.obj === 'object' ? addRes.json.obj?.id : addRes.json?.obj);
    if (!accepted || !Number.isInteger(createdId) || createdId <= 0) {
      const listRes = await client.request('GET', 'panel/api/inbounds/list');
      if (!listRes.ok || listRes.json?.success !== true || !Array.isArray(listRes.json.obj)) {
        result.message += ' Не удалось проверить наличие тестового инбаунда; проверьте панель.';
        break;
      }
      createdId = Number(listRes.json.obj.find((item) => item.remark === payload.remark)?.id);
    }
    if (Number.isInteger(createdId) && createdId > 0) {
      const deletion = await client.request('POST', `panel/api/inbounds/del/${createdId}`);
      result.deleted = deletion.ok && deletion.json?.success === true;
      if (!result.deleted) {
        result.message += ` Не удалось удалить тестовый инбаунд ID ${createdId}; проверка остановлена.`;
        break;
      }
    } else if (accepted) {
      result.message = 'Панель не вернула ID созданного инбаунда; проверьте панель.';
      break;
    }
  }
  console.table(report.inbounds);

  // Итоговый отчёт
  console.log(`\n${colors.bold}${colors.cyan}--- Итоговый статус совместимости ---${colors.reset}`);
  console.log(` Сеть и доступность:     ${report.connectivity ? ok : fail}`);
  console.log(` Аутентификация:          ${report.auth ? ok : fail}`);
  console.log(` CSRF-защита (v3.6.0+):   ${report.csrfActive ? colors.green + 'Активна и поддержана' : colors.dim + 'Не требуется или токен'}${colors.reset}`);
  console.log(` Reality (X25519):        ${report.realityKeys ? ok : warn + ' Недоступно'}`);
  const acceptedCount = report.inbounds.filter((item) => item.accepted).length;
  console.log(` Принято типов инбаундов: ${acceptedCount}/8`);

  if (report.connectivity && report.auth && report.inbounds.length === 8 && report.inbounds.every((item) => item.accepted && item.deleted)) {
    console.log(`\n${colors.bold}${colors.green}🚀 Вердикт: Панель приняла все восемь тестовых конфигураций.${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.bold}${colors.yellow}⚠️ Вердикт: Обнаружены проблемы совместимости.${colors.reset}\n`);
    process.exit(1);
  }
}

class XuiHttpClient {
  constructor(baseUrl, allowInsecure) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.allowInsecure = allowInsecure;
    this.cookies = new Map();
    this.csrfToken = null;
    this.bearerToken = null;
    this.lastHeaders = {};
  }

  setBearerToken(token) {
    this.bearerToken = token;
  }

  async fetchPreLoginCsrf() {
    for (const endpoint of ['csrf-token', 'login', '']) {
      try {
        const res = await this.request('GET', endpoint);
        if (res.ok && res.json?.success !== false && typeof res.json?.obj === 'string' && res.json.obj) {
          this.csrfToken = res.json.obj;
          return this.csrfToken;
        }
        if (res.headers['x-csrf-token']) {
          this.csrfToken = res.headers['x-csrf-token'];
          return this.csrfToken;
        }
        if (typeof res.body === 'string') {
          const meta = res.body.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
          if (meta && meta[1]) {
            this.csrfToken = meta[1];
            return this.csrfToken;
          }
          const input = res.body.match(/<input[^>]+name=["'](?:_csrf|csrf_token)["'][^>]+value=["']([^"']+)["']/i);
          if (input && input[1]) {
            this.csrfToken = input[1];
            return this.csrfToken;
          }
        }
        if (this.cookies.has('x-ui-csrf')) {
          this.csrfToken = this.cookies.get('x-ui-csrf');
          return this.csrfToken;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  async login(username, password, csrfToken) {
    const payload = { username, password };
    if (csrfToken) {
      payload._csrf = csrfToken;
      payload.csrf_token = csrfToken;
    }
    const res = await this.request('POST', 'login', payload);
    const success = res.ok && res.json?.success === true;
    if (success) {
      // Login rotates the session: obtain a token bound to the new cookie.
      this.csrfToken = null;
      await this.fetchPreLoginCsrf();
    }
    return {
      success,
      msg: res.json?.msg,
      error: res.error,
    };
  }

  async request(method, relativePath, data = null) {
    const urlStr = new URL(relativePath, this.baseUrl).toString();
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers = {
      Accept: 'application/json, text/plain, */*',
    };

    if (this.bearerToken) {
      headers.Authorization = `Bearer ${this.bearerToken}`;
    }

    if (this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    if (this.cookies.size > 0) {
      headers.Cookie = Array.from(this.cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }

    let postBody = null;
    if (data !== null) {
      postBody = typeof data === 'string' ? data : JSON.stringify(data);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postBody);
    }

    return new Promise((resolve) => {
      const options = {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers,
        rejectUnauthorized: !this.allowInsecure,
        timeout: 10000,
      };

      const req = transport.request(options, (res) => {
        let rawBody = '';
        this.lastHeaders = res.headers;

        if (res.headers['set-cookie']) {
          for (const item of res.headers['set-cookie']) {
            const parts = item.split(';')[0].split('=');
            if (parts.length >= 2) {
              const k = parts[0].trim();
              const v = parts.slice(1).join('=').trim();
              this.cookies.set(k, v);
              if (k.toLowerCase().includes('csrf')) {
                this.csrfToken = v;
              }
            }
          }
        }

        if (res.headers['x-csrf-token']) {
          this.csrfToken = res.headers['x-csrf-token'];
        }

        res.on('data', (chunk) => {
          rawBody += chunk;
        });

        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(rawBody);
          } catch {
            // ignore non-json
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            body: rawBody,
            json,
          });
        });
      });

      req.on('error', (err) => {
        resolve({
          ok: false,
          status: 0,
          headers: {},
          body: '',
          json: null,
          error: err.message,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          ok: false,
          status: 0,
          headers: {},
          body: '',
          json: null,
          error: 'Connection timeout (10s)',
        });
      });

      if (postBody) {
        req.write(postBody);
      }
      req.end();
    });
  }
}

function nextPort(usedPorts) {
  let port;
  do {
    port = crypto.randomInt(20000, 60001);
  } while (usedPorts.has(port));
  usedPorts.add(port);
  return port;
}

function normalizeUrl(url) {
  let u = url.trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = `https://${u}`;
  }
  return u;
}

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.includes('=')) {
        const [k, v] = key.split('=');
        result[k] = v;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        result[key] = args[i + 1];
        i++;
      } else {
        result[key] = true;
      }
    } else if (arg.startsWith('-')) {
      result[arg.slice(1)] = true;
    }
  }
  return result;
}

function printUsage() {
  console.log(`
Использование:
  node server/scripts/probe-xui.mjs [параметры]

Параметры:
  --url <url>            URL панели 3x-ui (например: https://example.com:2053/subpath)
  --token <token>        API токен панели
  --login <username>     Логин администратора
  --password <password>  Пароль администратора
  --insecure             Игнорировать самоподписанные SSL-сертификаты
  --port <port>          Начальный порт для восьми тестовых инбаундов (иначе случайные)
  --sni <domain>         Reality/TLS SNI (по умолчанию www.cloudflare.com)
  --certificate-file    Путь fullchain.pem на ноде (иначе сертификат панели)
  --key-file            Путь privkey.pem на ноде (иначе ключ панели)
  --help, -h             Справка

Скрипт создаёт и удаляет восемь тестовых инбаундов; проверка трафика не выполняется.

Примеры:
  node server/scripts/probe-xui.mjs --url https://node.example.com:2053/path --token secret123
  node server/scripts/probe-xui.mjs --url https://node.example.com:2053 --login admin --password admin --insecure
`);
}

main().catch((err) => {
  console.error('\nФатальная ошибка:', err);
  process.exit(1);
});
