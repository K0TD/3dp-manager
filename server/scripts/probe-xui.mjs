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

const ARGS = parseArgs(process.argv.slice(2));

if (ARGS.help || ARGS.h) {
  printUsage();
  process.exit(0);
}

const URL_INPUT = ARGS.url || process.env.XUI_URL;
const TOKEN = ARGS.token || process.env.XUI_TOKEN;
const LOGIN = ARGS.login || process.env.XUI_LOGIN;
const PASSWORD = ARGS.password || process.env.XUI_PASSWORD;
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
    inboundAddTgId: false,
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
  if (certFilesRes.json?.success && certFilesRes.json?.obj?.certPath) {
    report.certPaths = certFilesRes.json.obj;
    console.log(`${ok} Сертификат: ${report.certPaths.certPath}`);
  } else {
    console.log(`${info} Авто-сертификат панели не настроен (требуются свои пути для TLS)`);
  }

  // 6. Тестовое создание инбаунда с tgId: 0 (Go struct проверка)
  process.stdout.write(`[6/6] Проверка совместимости типов (tgId: 0, alterId: 0)... `);
  const testPort = ARGS.port ? Number(ARGS.port) : Math.floor(Math.random() * (50000 - 20000)) + 20000;
  const testUuid = crypto.randomUUID();
  const testInboundPayload = {
    enable: true,
    port: testPort,
    protocol: 'vmess',
    remark: `probe-test-${testPort}`,
    settings: JSON.stringify({
      clients: [
        {
          id: testUuid,
          alterId: 0,
          email: testUuid,
          limitIp: 0,
          totalGB: 0,
          expiryTime: 0,
          enable: true,
          tgId: 0,
          subId: '0',
          reset: 0,
        },
      ],
    }),
    streamSettings: JSON.stringify({
      network: 'tcp',
      security: 'none',
      tcpSettings: { acceptProxyProtocol: false, header: { type: 'none' } },
    }),
    sniffing: JSON.stringify({ enabled: false }),
  };

  const addRes = await client.request('POST', 'panel/api/inbounds/add', testInboundPayload);
  let createdId = null;
  if (addRes.json?.success) {
    report.inboundAddTgId = true;
    createdId = typeof addRes.json.obj === 'number'
      ? addRes.json.obj
      : addRes.json.obj?.id;
    console.log(`${ok} Инбаунд принят Go struct без ошибок!`);

    // Немедленная очистка
    if (!createdId) {
      const listRes = await client.request('GET', 'panel/api/inbounds/list');
      const found = (listRes.json?.obj || []).find((i) => i.port === testPort);
      if (found) createdId = found.id;
    }
    if (createdId) {
      await client.request('POST', `panel/api/inbounds/del/${createdId}`);
    }
  } else {
    console.log(`${fail} Отклонено 3x-ui: ${addRes.json?.msg || addRes.error || ''}`);
  }

  // Итоговый отчёт
  console.log(`\n${colors.bold}${colors.cyan}--- Итоговый статус совместимости ---${colors.reset}`);
  console.log(` Сеть и доступность:     ${report.connectivity ? ok : fail}`);
  console.log(` Аутентификация:          ${report.auth ? ok : fail}`);
  console.log(` CSRF-защита (v3.6.0+):   ${report.csrfActive ? colors.green + 'Активна и поддержана' : colors.dim + 'Не требуется или токен'}${colors.reset}`);
  console.log(` Reality (X25519):        ${report.realityKeys ? ok : warn + ' Недоступно'}`);
  console.log(` Десериализация tgId: 0:  ${report.inboundAddTgId ? ok + colors.green + ' Совместимо' : fail + colors.red + ' Ошибка'}${colors.reset}`);

  if (report.connectivity && report.auth && report.inboundAddTgId) {
    console.log(`\n${colors.bold}${colors.green}🚀 Вердикт: Нода полностью совместима с 3dp-manager!${colors.reset}\n`);
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
    for (const endpoint of ['login', '']) {
      try {
        const res = await this.request('GET', endpoint);
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
    return {
      success: Boolean(res.json?.success),
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
  --port <port>          Порт для тестового инбаунда (по умолчанию случайный)
  --help, -h             Справка

Примеры:
  node server/scripts/probe-xui.mjs --url https://node.example.com:2053/path --token secret123
  node server/scripts/probe-xui.mjs --url https://node.example.com:2053 --login admin --password admin --insecure
`);
}

main().catch((err) => {
  console.error('\nФатальная ошибка:', err);
  process.exit(1);
});
