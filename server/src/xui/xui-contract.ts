import { XuiInboundRaw } from './xui.types';
import { isProxyProtocol } from '../inbounds/connection-profiles';

export class XuiApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'network' | 'api' = 'api',
  ) {
    super(message);
  }
}

export interface XuiInboundDiagnostic {
  xuiId?: number;
  tag?: string;
  port?: number;
  protocol: string;
  serverName?: string;
  certificates?: Array<{ certificateFile?: string; keyFile?: string }>;
}

export class XuiRuntimeError extends XuiApiError {
  constructor(
    message: string,
    readonly inbound?: XuiInboundDiagnostic,
  ) {
    super(message);
  }
}

export function inboundDiagnostic(
  inbound: XuiInboundRaw,
): XuiInboundDiagnostic {
  const stream = jsonObject(inbound.streamSettings, 'streamSettings', true);
  const tls = asRecord(stream.tlsSettings);
  return {
    xuiId: inbound.id,
    tag: typeof inbound.tag === 'string' ? inbound.tag : undefined,
    port: inbound.port,
    protocol: inbound.protocol,
    serverName:
      typeof tls?.serverName === 'string' ? tls.serverName : undefined,
    certificates: Array.isArray(tls?.certificates)
      ? tls.certificates.map((value) => {
          const cert = asRecord(value);
          return {
            certificateFile:
              typeof cert?.certificateFile === 'string'
                ? cert.certificateFile
                : undefined,
            keyFile:
              typeof cert?.keyFile === 'string' ? cert.keyFile : undefined,
          };
        })
      : undefined,
  };
}

export function verifyTlsIdentity(
  expected: XuiInboundRaw,
  saved: XuiInboundRaw,
): void {
  const stream = jsonObject(expected.streamSettings, 'streamSettings', true);
  const savedStream = jsonObject(saved.streamSettings, 'streamSettings', true);
  if (stream.security !== 'tls' && savedStream.security !== 'tls') return;
  const original = inboundDiagnostic(expected);
  const actual = inboundDiagnostic(saved);
  if (
    stream.security !== savedStream.security ||
    original.serverName !== actual.serverName ||
    JSON.stringify(original.certificates) !==
      JSON.stringify(actual.certificates)
  ) {
    throw new XuiApiError(
      'Панель изменила TLS-имя или пути сертификата; подключение не опубликовано',
    );
  }
}

export function safePanelMessage(value: unknown, maxLength = 300): string {
  return (typeof value === 'string' ? value : 'Invalid 3x-ui response')
    .replace(/https?:\/\/\S+/g, '[panel]')
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, (token) =>
      /^\/(?:etc|root|var|usr|opt|run|home|tmp)\//.test(token)
        ? token
        : '[redacted]',
    )
    .replace(/[\r\n]+/g, ' ')
    .slice(0, maxLength);
}

export function responsePayload(data: unknown): unknown {
  if (
    !data ||
    typeof data !== 'object' ||
    (data as { success?: unknown }).success !== true
  ) {
    const msg = (data as { msg?: unknown })?.msg;
    throw new XuiApiError(safePanelMessage(msg, 16384));
  }
  return (data as { obj?: unknown }).obj;
}

export function jsonObject(
  value: unknown,
  field: string,
  optional = false,
): Record<string, unknown> {
  if (optional && (value == null || value === '')) return {};
  try {
    const parsed: unknown =
      typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* Report the field, never its credentials. */
  }
  throw new XuiApiError(`Invalid inbound ${field}`);
}

export function normalizeInbound(value: unknown): XuiInboundRaw {
  const raw = jsonObject(value, 'object');
  if (
    !Number.isInteger(raw.port) ||
    Number(raw.port) < 1 ||
    Number(raw.port) > 65535 ||
    typeof raw.protocol !== 'string'
  ) {
    throw new XuiApiError('Invalid inbound port or protocol');
  }
  return {
    ...raw,
    port: Number(raw.port),
    protocol: raw.protocol,
    settings: JSON.stringify(jsonObject(raw.settings, 'settings')),
    streamSettings: JSON.stringify(
      jsonObject(raw.streamSettings, 'streamSettings', true),
    ),
    sniffing: JSON.stringify(jsonObject(raw.sniffing, 'sniffing', true)),
  };
}

export function verifyInboundAccess(inbound: XuiInboundRaw): void {
  const settings = jsonObject(inbound.settings, 'settings');
  if (isProxyProtocol(inbound.protocol)) {
    const accounts = settings.accounts;
    if (
      (inbound.protocol !== 'http' && settings.auth !== 'password') ||
      !Array.isArray(accounts) ||
      !accounts.length ||
      accounts.some((account) => {
        const entry = asRecord(account);
        return (
          typeof entry?.user !== 'string' ||
          !entry.user ||
          typeof entry?.pass !== 'string' ||
          !entry.pass
        );
      })
    )
      throw new XuiApiError('Saved proxy has no authenticated accounts');
    return;
  }
  const clients = settings.clients;
  if (
    !Array.isArray(clients) ||
    !clients.length ||
    clients.some(
      (client) => !asRecord(client) || asRecord(client)?.enable === false,
    )
  )
    throw new XuiApiError('Saved inbound has no enabled clients');
  if (
    inbound.protocol === 'mtproto' &&
    (settings.routeThroughXray !== true ||
      !Number.isInteger(settings.routeXrayPort) ||
      Number(settings.routeXrayPort) <= 0)
  )
    throw new XuiApiError('Panel did not configure the MTProto bridge to Xray');
}

// Set-Cookie attributes must never become request cookies. A renewed session
// replaces the old value even when it arrives from GET /csrf-token.
export function mergeCookies(
  current: string | undefined,
  headers: unknown,
): string {
  const cookies = new Map<string, string>();
  for (const pair of (current || '').split(';')) {
    const index = pair.indexOf('=');
    if (index > 0)
      cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  for (const header of Array.isArray(headers)
    ? headers
    : typeof headers === 'string'
      ? [headers]
      : []) {
    const pair = String(header).split(';')[0];
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    if (/;\s*max-age=0(?:;|$)/i.test(String(header)) || !pair.slice(index + 1))
      cookies.delete(name);
    else cookies.set(name, pair.slice(index + 1));
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

export function isPortConflict(message?: string): boolean {
  return /port.*(?:exists|in use|occupied|conflict|overlap)|порт.*(?:занят|использ|существ)/i.test(
    message || '',
  );
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
