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
  'mtproto-faketls',
  'amneziawg',
  'custom',
] as const;

export type InboundType = (typeof INBOUND_TYPES)[number];

export const VLESS_TLS_TYPES = new Set<InboundType>([
  'vless-tcp-tls',
  'vless-ws-tls',
]);

export const CERTIFICATE_INBOUND_TYPES = new Set<InboundType>([
  ...VLESS_TLS_TYPES,
  'hysteria2-udp',
]);

export const CERTIFICATE_MODES = ['node', 'custom'] as const;
export type CertificateMode = (typeof CERTIFICATE_MODES)[number];
