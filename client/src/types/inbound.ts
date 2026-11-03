export interface InboundConfigUI {
  id: string;
  configId: string;
  type: string;
  port: string;
  sni: string;
  link?: string;
  routingProfile?: string;
  nodeId?: string;
  relayServerId?: string;
  flag?: string;
  name?: string;
  certificateMode?: 'node' | 'custom';
  tlsServerName?: string;
  certificateFile?: string;
  keyFile?: string;
  enabled?: boolean;
  disabledReason?: string;
  awgLocked?: boolean;
  persistentLocked?: boolean;
}

export interface Tunnel {
  id: number;
  name: string;
  ip: string;
  domain: string;
  isInstalled: boolean;
  nodeId?: string;
}

export interface Domain {
  id: number;
  name: string;
  isEnabled?: boolean;
}

export interface CountryOption {
  name: string;
  code: string;
  emoji: string;
}

export const CONNECTION_OPTIONS = [
  'vless-tcp-reality',
  'vless-xhttp-reality',
  'vless-xhttp-get',
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

export const ROUTING_INBOUND_TYPES = new Set<string>([
  'happ-routing',
  'incy-routing',
]);

export const isRoutingProfile = (type: string): boolean =>
  ROUTING_INBOUND_TYPES.has(type);

export const PERSISTENT_INBOUND_TYPES = new Set([
  'amneziawg', 'wireguard', 'mixed', 'http', 'socks',
]);

export const CERTIFICATE_TYPES = new Set([
  'hysteria2-udp',
  'vless-tcp-tls',
  'vless-ws-tls',
  'vless-xhttp-tls',
]);

export const DEFAULT_INBOUND_TYPES = [
  'hysteria2-udp',
  'vless-xhttp-reality',
  'vless-tcp-tls',
  'vless-tcp-reality',
  'vless-grpc-reality',
];
