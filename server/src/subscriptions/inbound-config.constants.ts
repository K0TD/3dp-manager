export const INBOUND_TYPES = [
  'vless-tcp-reality',
  'vless-xhttp-reality',
  'vless-grpc-reality',
  'vless-ws',
  'vless-tcp-tls',
  'vless-ws-tls',
  'hysteria2-udp',
  'vmess-tcp',
  'shadowsocks-tcp',
  'trojan-tcp-reality',
  'amneziawg',
  'custom',
] as const;

export type InboundType = (typeof INBOUND_TYPES)[number];

export const VLESS_TLS_TYPES = new Set<InboundType>([
  'vless-tcp-tls',
  'vless-ws-tls',
]);
