import api from '../api';

export interface DomainPingProbe {
  reachable: boolean;
  latencyMs: number;
  protocol?: string;
  error?: string;
}

export interface CombinedDomainPingResult {
  domain: string;
  browser: DomainPingProbe;
  vps: DomainPingProbe;
}

/**
 * Checks domain availability directly from the client's browser (e.g. within Russia).
 * If TSPU/ISP drops the TLS handshake or resets connection, fetch() rejects.
 */
export async function pingDomainFromBrowser(
  domain: string,
  timeoutMs = 3500,
): Promise<DomainPingProbe> {
  const clean = (domain || '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//i, '')
    .split('/')[0]
    .split(':')[0];

  if (!clean) {
    return { reachable: false, latencyMs: 0, error: 'Некорректный домен' };
  }

  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // mode: 'no-cors' allows cross-origin requests.
    // Completes TLS handshake even if the website has no CORS headers.
    await fetch(`https://${clean}/?__3dp_probe=${Date.now()}`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latency = Math.round(performance.now() - start);
    return { reachable: true, latencyMs: latency };
  } catch (err: unknown) {
    clearTimeout(timer);
    const latency = Math.round(performance.now() - start);
    const isTimeout =
      err instanceof DOMException && err.name === 'AbortError';
    return {
      reachable: false,
      latencyMs: latency,
      error: isTimeout
        ? 'Таймаут (блокировка ТСПУ/DPI)'
        : 'Сброс соединения / Заблокирован в РФ',
    };
  }
}

/**
 * Checks domain availability from the VPS server (via TCP/TLS 443).
 */
export async function pingDomainFromVps(
  domain: string,
): Promise<DomainPingProbe> {
  const clean = (domain || '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//i, '')
    .split('/')[0]
    .split(':')[0];

  if (!clean) {
    return { reachable: false, latencyMs: 0, error: 'Некорректный домен' };
  }

  try {
    const res = await api.post('/domains/ping', { domain: clean });
    return {
      reachable: Boolean(res.data?.reachable),
      latencyMs: typeof res.data?.latencyMs === 'number' ? res.data.latencyMs : 0,
      protocol: res.data?.protocol,
      error: res.data?.error,
    };
  } catch {
    return {
      reachable: false,
      latencyMs: 0,
      error: 'Ошибка запроса к VPS',
    };
  }
}

/**
 * Performs dual probe (Browser from client location + VPS from server location).
 */
export async function pingDomainCombined(
  domain: string,
): Promise<CombinedDomainPingResult> {
  const [browserRes, vpsRes] = await Promise.allSettled([
    pingDomainFromBrowser(domain),
    pingDomainFromVps(domain),
  ]);

  const browser: DomainPingProbe =
    browserRes.status === 'fulfilled'
      ? browserRes.value
      : { reachable: false, latencyMs: 0, error: 'Сбой браузерного пинга' };

  const vps: DomainPingProbe =
    vpsRes.status === 'fulfilled'
      ? vpsRes.value
      : { reachable: false, latencyMs: 0, error: 'Сбой пинга с VPS' };

  return {
    domain,
    browser,
    vps,
  };
}
