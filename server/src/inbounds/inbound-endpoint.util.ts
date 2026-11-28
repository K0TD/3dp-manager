import { patchAmneziaVpnEndpoint } from './amnezia-vpn-link';
import { patchConnectionHost } from './connection-profiles';

function stripHostBrackets(host: string): string {
  return host.trim().replace(/^\[|\]$/g, '');
}

function formatUrlHost(host: string): string {
  const stripped = stripHostBrackets(host);
  return stripped.includes(':') ? `[${stripped}]` : stripped;
}

/**
 * Заменяет хост/IP назначения в клиентской ссылке подключения любого поддерживаемого протокола.
 */
export function patchInboundLinkHost(link: string, newHost: string): string {
  const strippedHost = stripHostBrackets(newHost);
  if (!link || !strippedHost) {
    return link;
  }
  const formattedHost = formatUrlHost(strippedHost);

  if (link.startsWith('vmess://')) {
    try {
      const encodedConfig = link.substring(8);
      const vmessConfig = JSON.parse(
        Buffer.from(encodedConfig, 'base64').toString('utf-8'),
      ) as Record<string, unknown>;
      vmessConfig.add = strippedHost;
      return `vmess://${Buffer.from(JSON.stringify(vmessConfig)).toString('base64')}`;
    } catch {
      return link;
    }
  }

  if (
    link.startsWith('vless://') ||
    link.startsWith('trojan://') ||
    link.startsWith('hy2://') ||
    link.startsWith('hysteria2://')
  ) {
    try {
      const url = new URL(link);
      url.hostname = formattedHost;
      return url.toString();
    } catch {
      return link.replace(/@.*?:/, `@${formattedHost}:`);
    }
  }

  if (link.startsWith('ss://')) {
    if (!link.includes('@')) {
      return link;
    }
    try {
      const url = new URL(link);
      url.hostname = formattedHost;
      return url.toString();
    } catch {
      return link.replace(/@.*?:/, `@${formattedHost}:`);
    }
  }

  if (link.startsWith('tg://proxy?')) {
    try {
      const proxyUrl = new URL(link);
      proxyUrl.searchParams.set('server', strippedHost);
      return proxyUrl.toString();
    } catch {
      return link;
    }
  }

  if (link.startsWith('vpn://')) {
    return patchAmneziaVpnEndpoint(link, strippedHost);
  }

  if (/^(wireguard|mixed|http|socks5):\/\//.test(link)) {
    return patchConnectionHost(link, strippedHost);
  }

  return link;
}

/**
 * Обновляет поле address в сохранённом JSON-профиле клиента (`clientProfileJson`).
 */
export function patchClientProfileJsonAddress(
  clientProfileJson: string | null | undefined,
  newHost: string,
): string | null | undefined {
  const strippedHost = stripHostBrackets(newHost);
  if (!clientProfileJson || !strippedHost) {
    return clientProfileJson;
  }

  try {
    const parsed: unknown = JSON.parse(clientProfileJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return clientProfileJson;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.address === 'string' && record.address !== strippedHost) {
      record.address = strippedHost;
      return JSON.stringify(record);
    }
    return clientProfileJson;
  } catch {
    return clientProfileJson;
  }
}
