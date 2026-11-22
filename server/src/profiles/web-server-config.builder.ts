import { isValidHostname, normalizeXhttpPath } from './profile-compatibility';
import type { WebServerConfigBundle } from './connection-profile.types';

const SAFE_CERT_PATH_RE = /^\/[A-Za-z0-9._/@+-]+$/;

function sanitizeSafePath(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (
    trimmed &&
    SAFE_CERT_PATH_RE.test(trimmed) &&
    !trimmed.includes('..') &&
    trimmed.length <= 512
  ) {
    return trimmed;
  }
  return fallback;
}

function assertValidDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase();
  if (!isValidHostname(normalized)) {
    throw new Error(`Некорректное доменное имя для веб-сервера: "${domain}"`);
  }
  return normalized;
}

function assertValidPort(port: number, label: string): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Некорректный порт (${label}): ${String(port)}`);
  }
  return port;
}

function nginxInstallCommand(
  config: string,
  filename: string,
  enabledLink: string,
  site?: {
    filename: string;
    html: string;
  },
) {
  const files = [
    { filename, content: config, name: 'config' },
    ...(site
      ? [{ filename: site.filename, content: site.html, name: 'index' }]
      : []),
  ];
  return [
    "sudo sh <<'INSTALL_NGINX'",
    'set -eu',
    'umask 077',
    'mkdir -p /etc/nginx/backups',
    'exec 9>/etc/nginx/backups/3dp-install.lock',
    'flock -x 9',
    'backup=$(mktemp -d /etc/nginx/backups/3dp-XXXXXX)',
    'snapshot() {',
    '  [ ! -d "$1" ]',
    '  if [ -e "$1" ] || [ -L "$1" ]; then cp -a -- "$1" "$backup/$2"; fi',
    '}',
    'restore() {',
    '  rm -f -- "$1"',
    '  if [ -e "$backup/$2" ] || [ -L "$backup/$2" ]; then cp -a -- "$backup/$2" "$1"; fi',
    '}',
    ...files.map((file) => `snapshot '${file.filename}' '${file.name}'`),
    `snapshot '${enabledLink}' enabled`,
    'reload_started=0',
    'rollback() {',
    '  result=$?',
    '  trap - EXIT HUP INT TERM',
    '  if [ "$result" -eq 0 ]; then exit 0; fi',
    '  set +e',
    ...files.map((file) => `  restore '${file.filename}' '${file.name}'`),
    `  restore '${enabledLink}' enabled`,
    '  if [ "$reload_started" -eq 1 ]; then nginx -t && systemctl reload nginx; fi',
    '  echo "Nginx installation failed. Backup: $backup" >&2',
    '  exit "$result"',
    '}',
    'trap rollback EXIT',
    "trap 'exit 1' HUP INT TERM",
    'write_file() {',
    '  mkdir -p -m 0755 -- "$(dirname -- "$1")"',
    '  temp=$(mktemp "$(dirname -- "$1")/.3dp-XXXXXX")',
    '  if cat > "$temp" && chmod 0644 "$temp" && mv -fT -- "$temp" "$1"; then return; fi',
    '  rm -f -- "$temp"',
    '  return 1',
    '}',
    ...files.flatMap((file) => [
      `write_file '${file.filename}' <<'NGINX_FILE'`,
      file.content.trimEnd(),
      'NGINX_FILE',
    ]),
    `mkdir -p -m 0755 -- "$(dirname -- '${enabledLink}')"`,
    `ln -sfnT -- '${filename}' '${enabledLink}'`,
    'nginx -t',
    'reload_started=1',
    'systemctl reload nginx',
    'echo "Nginx configuration applied. Backup: $backup"',
    'INSTALL_NGINX',
  ].join('\n');
}

export interface BuildSelfSniWebServerParams {
  engine: 'nginx' | 'caddy';
  domain: string;
  localHttpsPort?: number;
  xver?: 0 | 1 | 2;
  certificateFile?: string;
  keyFile?: string;
}

/**
 * Generates a hardened, ready-to-validate Nginx or Caddy configuration
 * for the local HTTPS decoy site used behind REALITY Self-SNI.
 *
 * Security guarantees:
 * - Binds strictly to 127.0.0.1:<localHttpsPort> so the local site port
 *   does not need to be exposed on the public firewall.
 * - Never embeds private key contents (references server-local paths only).
 * - Provides explicit backup, dry-run validation, reload, and rollback commands.
 */
export function buildSelfSniWebServerBundle(
  params: BuildSelfSniWebServerParams,
): WebServerConfigBundle {
  const domain = assertValidDomain(params.domain);
  const localHttpsPort = assertValidPort(
    params.localHttpsPort ?? 8443,
    'localHttpsPort',
  );
  const xver = params.xver === 1 || params.xver === 2 ? params.xver : 0;
  const staticSitePath = `/var/www/self-sni/${domain}`;
  const defaultCert = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
  const defaultKey = `/etc/letsencrypt/live/${domain}/privkey.pem`;
  const certFile = sanitizeSafePath(params.certificateFile, defaultCert);
  const keyFile = sanitizeSafePath(params.keyFile, defaultKey);

  const staticSiteHtml = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${domain}</title>`,
    '  <style>',
    '    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; min-height: 100vh;',
    '           display: grid; place-items: center; background: #f8fafc; color: #0f172a; }',
    '    main { max-width: 520px; padding: 2rem; text-align: center; }',
    '    h1 { font-size: 1.5rem; margin-bottom: 0.75rem; }',
    '    p { color: #475569; line-height: 1.6; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main>',
    `    <h1>${domain}</h1>`,
    '    <p>Service online. Static maintenance page.</p>',
    '  </main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  if (params.engine === 'nginx') {
    const filename = `/etc/nginx/sites-available/self-sni-${domain}.conf`;
    const enabledLink = `/etc/nginx/sites-enabled/self-sni-${domain}.conf`;
    const proxyProtoFlag = xver > 0 ? ' proxy_protocol' : '';
    const realIpBlock =
      xver > 0
        ? [
            '    set_real_ip_from 127.0.0.1;',
            '    real_ip_header proxy_protocol;',
          ]
        : [];

    const config = [
      'server {',
      `    listen 127.0.0.1:${localHttpsPort} ssl http2${proxyProtoFlag};`,
      `    server_name ${domain};`,
      '',
      '    server_tokens off;',
      `    ssl_certificate ${certFile};`,
      `    ssl_certificate_key ${keyFile};`,
      '    ssl_protocols TLSv1.3 TLSv1.2;',
      '    ssl_prefer_server_ciphers off;',
      '    ssl_session_timeout 1d;',
      '    ssl_session_cache shared:SELF_SNI:10m;',
      '    ssl_session_tickets off;',
      '',
      ...realIpBlock,
      ...(realIpBlock.length ? [''] : []),
      '    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
      '    add_header X-Content-Type-Options "nosniff" always;',
      '    add_header X-Frame-Options "SAMEORIGIN" always;',
      '    add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
      '',
      `    root ${staticSitePath};`,
      '    index index.html;',
      '',
      '    location / {',
      '        try_files $uri $uri/ =404;',
      '    }',
      '}',
      '',
      'server {',
      '    listen 80;',
      '    listen [::]:80;',
      `    server_name ${domain};`,
      '',
      '    location ^~ /.well-known/acme-challenge/ {',
      `        root ${staticSitePath};`,
      '    }',
      '    location / {',
      '        return 301 https://$host$request_uri;',
      '    }',
      '}',
      '',
    ].join('\n');

    return {
      engine: 'nginx',
      purpose: 'self-sni',
      domain,
      filename,
      config,
      staticSitePath: `${staticSitePath}/index.html`,
      staticSiteHtml,
      installCommand: nginxInstallCommand(config, filename, enabledLink, {
        filename: `${staticSitePath}/index.html`,
        html: staticSiteHtml,
      }),
      backupCommand: `sudo mkdir -p /etc/nginx/backups && sudo cp -a "${filename}" "/etc/nginx/backups/self-sni-${domain}.conf.$(date +%Y%m%d-%H%M%S).bak" 2>/dev/null || true`,
      validateCommand: `sudo ln -sfn "${filename}" "${enabledLink}" && sudo nginx -t`,
      reloadCommand: 'sudo systemctl reload nginx',
      rollbackCommand: `LATEST=$(ls -t /etc/nginx/backups/self-sni-${domain}.conf.*.bak 2>/dev/null | head -n1) && [ -n "$LATEST" ] && sudo cp -a "$LATEST" "${filename}" && sudo nginx -t && sudo systemctl reload nginx`,
      notes: [
        `Nginx слушает строго 127.0.0.1:${localHttpsPort} — не открывайте порт ${localHttpsPort} во внешнем firewall.`,
        'Во внешнем firewall откройте только целевой порт Xray (обычно 443/tcp) и при необходимости 80/tcp для обновления ACME-сертификатов.',
        'Перед reload обязательно выполните резервную копию и проверку синтаксиса `nginx -t`.',
        ...(xver > 0
          ? [
              `Включён PROXY protocol (xver=${xver}): убедитесь, что в Xray REALITY указано xver=${xver}.`,
            ]
          : []),
      ],
    };
  }

  // Caddy configuration
  const filename = `/etc/caddy/conf.d/self-sni-${domain}.caddy`;
  const hasExplicitCert = Boolean(
    params.certificateFile?.trim() && params.keyFile?.trim(),
  );
  const tlsDirective = hasExplicitCert
    ? `    tls ${certFile} ${keyFile} {\n        protocols tls1.2 tls1.3\n    }`
    : '    tls {\n        protocols tls1.2 tls1.3\n    }';

  const config = [
    `# Managed Self-SNI local HTTPS target for ${domain}`,
    `# Xray REALITY listens on public :443 and forwards non-REALITY TLS to 127.0.0.1:${localHttpsPort}`,
    `https://${domain}:${localHttpsPort} {`,
    '    bind 127.0.0.1',
    tlsDirective,
    '',
    '    header {',
    '        Strict-Transport-Security "max-age=31536000; includeSubDomains"',
    '        X-Content-Type-Options "nosniff"',
    '        X-Frame-Options "SAMEORIGIN"',
    '        Referrer-Policy "strict-origin-when-cross-origin"',
    '        -Server',
    '    }',
    '',
    `    root * ${staticSitePath}`,
    '    file_server',
    '}',
    '',
  ].join('\n');

  return {
    engine: 'caddy',
    purpose: 'self-sni',
    domain,
    filename,
    config,
    staticSitePath: `${staticSitePath}/index.html`,
    staticSiteHtml,
    backupCommand: `sudo mkdir -p /etc/caddy/backups && sudo cp -a "${filename}" "/etc/caddy/backups/self-sni-${domain}.caddy.$(date +%Y%m%d-%H%M%S).bak" 2>/dev/null || true`,
    validateCommand:
      'sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile',
    reloadCommand: 'sudo systemctl reload caddy',
    rollbackCommand: `LATEST=$(ls -t /etc/caddy/backups/self-sni-${domain}.caddy.*.bak 2>/dev/null | head -n1) && [ -n "$LATEST" ] && sudo cp -a "$LATEST" "${filename}" && sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && sudo systemctl reload caddy`,
    notes: [
      `Убедитесь, что в основном /etc/caddy/Caddyfile добавлена строка: import /etc/caddy/conf.d/*.caddy`,
      `Caddy привязан к 127.0.0.1:${localHttpsPort} — не открывайте порт ${localHttpsPort} во внешнем firewall.`,
      ...(hasExplicitCert
        ? [
            `Используются указанные файлы сертификата (${certFile}) и ключа (${keyFile}).`,
          ]
        : [
            'Для автоматического выпуска сертификата Caddy без проброса 443 используйте HTTP-01 (порт 80) или DNS-01 challenge, либо укажите существующий сертификат.',
          ]),
      ...(xver > 0
        ? [
            `Внимание: стандартная сборка Caddy без плагина proxy_protocol не поддерживает xver=${xver}. Рекомендуется установить xver=0.`,
          ]
        : []),
    ],
  };
}

export interface BuildHttpsFallbackProxyParams {
  engine: 'nginx' | 'caddy';
  domain: string;
  path: string;
  publicPort?: number;
  upstreamPort: number;
  certificateFile?: string;
  keyFile?: string;
}

/**
 * Generates Nginx or Caddy reverse-proxy configuration for HTTPS Fallback
 * (VLESS + XHTTP + TLS behind reverse proxy). Used in Stage 3.
 */
export function buildHttpsFallbackProxyBundle(
  params: BuildHttpsFallbackProxyParams,
): WebServerConfigBundle {
  const domain = assertValidDomain(params.domain);
  const publicPort = assertValidPort(params.publicPort ?? 443, 'publicPort');
  const upstreamPort = assertValidPort(params.upstreamPort, 'upstreamPort');
  const path = normalizeXhttpPath(params.path || '/api/v2/stream');
  if (!/^\/[A-Za-z0-9._~/%-]+$/.test(path))
    throw new Error('Некорректный путь XHTTP для шаблона reverse proxy');

  const defaultCert = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
  const defaultKey = `/etc/letsencrypt/live/${domain}/privkey.pem`;
  const certFile = sanitizeSafePath(params.certificateFile, defaultCert);
  const keyFile = sanitizeSafePath(params.keyFile, defaultKey);

  if (params.engine === 'nginx') {
    const filename = `/etc/nginx/sites-available/https-fallback-${domain}.conf`;
    const enabledLink = `/etc/nginx/sites-enabled/https-fallback-${domain}.conf`;
    const config = [
      'server {',
      `    listen ${publicPort} ssl http2;`,
      `    listen [::]:${publicPort} ssl http2;`,
      `    server_name ${domain};`,
      '',
      '    server_tokens off;',
      `    ssl_certificate ${certFile};`,
      `    ssl_certificate_key ${keyFile};`,
      '    ssl_protocols TLSv1.3 TLSv1.2;',
      '    ssl_prefer_server_ciphers off;',
      '    ssl_session_timeout 1d;',
      '    ssl_session_cache shared:HTTPS_FALLBACK:10m;',
      '',
      `    location ^~ ${path} {`,
      '        client_max_body_size 0;',
      '        client_body_timeout 3600s;',
      '        grpc_read_timeout 3600s;',
      '        grpc_send_timeout 3600s;',
      '        grpc_set_header Host $host;',
      '        grpc_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      `        grpc_pass grpc://127.0.0.1:${upstreamPort};`,
      '    }',
      '',
      '    location / {',
      '        return 200 "OK\\n";',
      '        add_header Content-Type text/plain;',
      '    }',
      '}',
      '',
    ].join('\n');

    return {
      engine: 'nginx',
      purpose: 'https-fallback',
      domain,
      filename,
      config,
      installCommand: nginxInstallCommand(config, filename, enabledLink),
      backupCommand: `sudo mkdir -p /etc/nginx/backups && sudo cp -a "${filename}" "/etc/nginx/backups/https-fallback-${domain}.conf.$(date +%Y%m%d-%H%M%S).bak" 2>/dev/null || true`,
      validateCommand: `sudo ln -sfn "${filename}" "${enabledLink}" && sudo nginx -t`,
      reloadCommand: 'sudo systemctl reload nginx',
      rollbackCommand: `LATEST=$(ls -t /etc/nginx/backups/https-fallback-${domain}.conf.*.bak 2>/dev/null | head -n1) && [ -n "$LATEST" ] && sudo cp -a "$LATEST" "${filename}" && sudo nginx -t && sudo systemctl reload nginx`,
      notes: [
        `Xray inbound для режима за reverse proxy слушает только 127.0.0.1:${upstreamPort} (без внешнего открытия в firewall).`,
        'Используется grpc_pass (HTTP/2 h2c к Xray) — это рекомендуемый режим Nginx для полнодуплексного XHTTP (auto / stream-one / packet-up). Если вы используете обычный HTTP/1.1 proxy_pass, переключите режим XHTTP в packet-up и укажите proxy_buffering off; proxy_request_buffering off;.',
      ],
    };
  }

  const filename = `/etc/caddy/conf.d/https-fallback-${domain}.caddy`;
  const hasExplicitCert = Boolean(
    params.certificateFile?.trim() && params.keyFile?.trim(),
  );
  const tlsBlock = hasExplicitCert
    ? `    tls ${certFile} ${keyFile} {\n        protocols tls1.2 tls1.3\n    }`
    : '    tls {\n        protocols tls1.2 tls1.3\n    }';

  const config = [
    `# Managed HTTPS Fallback reverse proxy for ${domain}`,
    `https://${domain}:${publicPort} {`,
    tlsBlock,
    '',
    `    handle ${path}* {`,
    `        reverse_proxy 127.0.0.1:${upstreamPort} {`,
    '            flush_interval -1',
    '            transport http {',
    '                versions h2c 1.1',
    '            }',
    '        }',
    '    }',
    '',
    '    handle {',
    '        respond "OK" 200',
    '    }',
    '}',
    '',
  ].join('\n');

  return {
    engine: 'caddy',
    purpose: 'https-fallback',
    domain,
    filename,
    config,
    backupCommand: `sudo mkdir -p /etc/caddy/backups && sudo cp -a "${filename}" "/etc/caddy/backups/https-fallback-${domain}.caddy.$(date +%Y%m%d-%H%M%S).bak" 2>/dev/null || true`,
    validateCommand:
      'sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile',
    reloadCommand: 'sudo systemctl reload caddy',
    rollbackCommand: `LATEST=$(ls -t /etc/caddy/backups/https-fallback-${domain}.caddy.*.bak 2>/dev/null | head -n1) && [ -n "$LATEST" ] && sudo cp -a "$LATEST" "${filename}" && sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && sudo systemctl reload caddy`,
    notes: [
      `flush_interval -1 отключает буферизацию Caddy для XHTTP-потоков на ${path}.`,
      `Не открывайте внутренний порт ${upstreamPort} во внешнем firewall.`,
    ],
  };
}
