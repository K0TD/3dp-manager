import { XuiInboundRaw } from './xui.types';

export class XuiApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'network' | 'api' = 'api',
  ) {
    super(message);
  }
}

export function safePanelMessage(value: unknown): string {
  return (typeof value === 'string' ? value : 'Invalid 3x-ui response')
    .replace(/https?:\/\/\S+/g, '[panel]')
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 300);
}

export function responsePayload(data: unknown): unknown {
  if (
    !data ||
    typeof data !== 'object' ||
    (data as { success?: unknown }).success !== true
  ) {
    const msg = (data as { msg?: unknown })?.msg;
    throw new XuiApiError(safePanelMessage(msg));
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
