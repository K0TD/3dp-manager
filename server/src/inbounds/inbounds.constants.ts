export const CONNECTION_TYPES = [
  'vless-tcp-reality',
  'vless-xhttp-reality',
  'vless-grpc-reality',
  'vless-ws',
  'vmess-tcp',
  'shadowsocks-tcp',
  'trojan-tcp-reality',
  'hysteria2-udp',
  'mtproto-faketls',
  'amneziawg',
  'custom',
] as const;

export type ConnectionType = (typeof CONNECTION_TYPES)[number];
