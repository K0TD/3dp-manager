export const INBOUND_TYPES = [
  'vless-tcp-reality',
  'vless-xhttp-reality',
  'vless-xhttp-get',
  'xhttp-stable',
  'self-sni',
  'https-fallback',
  'vless-grpc-reality',
  'vless-ws',
  'vless-tcp-tls',
  'vless-ws-tls',
  'vless-xhttp-tls',
  'hysteria2-udp',
  'vmess-tcp',
  'shadowsocks-tcp',
  'trojan-tcp-reality',
  'mtproto-faketls',
  'amneziawg',
  'wireguard',
  'mixed',
  'http',
  'socks',
  'custom',
  'happ-routing',
  'incy-routing',
] as const;

export type InboundType = (typeof INBOUND_TYPES)[number];

export const MANAGED_PROFILE_TYPES = new Set<string>([
  'xhttp-stable',
  'self-sni',
  'https-fallback',
]);

// Managed profiles enabled for subscription deployment in the current stage.
export const ACTIVE_MANAGED_PROFILE_TYPES = new Set<string>([
  'xhttp-stable',
  'self-sni',
  'https-fallback',
]);

export function requiresPanelTlsCertificate(config: {
  type?: string;
  profileSettings?: { reverseProxy?: string } | null;
}): boolean {
  if (
    !config.type ||
    !CERTIFICATE_INBOUND_TYPES.has(config.type as InboundType)
  )
    return false;
  if (
    config.type === 'https-fallback' &&
    (config.profileSettings?.reverseProxy === 'nginx' ||
      config.profileSettings?.reverseProxy === 'caddy')
  ) {
    return false;
  }
  return true;
}

// These clients import credentials once, rather than refreshing a subscription.
export const PERSISTENT_INBOUND_TYPES = new Set<string>([
  'amneziawg',
  'wireguard',
  'mixed',
  'http',
  'socks',
]);

export function panelInboundProtocol(type: string): string {
  // Modern 3x-ui exposes SOCKS through its combined SOCKS/HTTP listener.
  return type === 'socks' ? 'mixed' : type;
}

export const VLESS_TLS_TYPES = new Set<InboundType>([
  'vless-tcp-tls',
  'vless-ws-tls',
  'vless-xhttp-tls',
]);

export const CERTIFICATE_INBOUND_TYPES = new Set<InboundType>([
  ...VLESS_TLS_TYPES,
  'https-fallback',
  'hysteria2-udp',
]);

export const CERTIFICATE_MODES = ['node', 'custom'] as const;
export type CertificateMode = (typeof CERTIFICATE_MODES)[number];

export const ROUTING_INBOUND_TYPES = new Set<string>([
  'happ-routing',
  'incy-routing',
]);
