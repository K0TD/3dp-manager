export interface XuiInboundRaw {
  id?: number;
  enable?: boolean;
  listen?: string;
  port: number;
  protocol: string;
  settings: string; // JSON string
  streamSettings: string; // JSON string
  sniffing?: string;
  remark?: string;
  [key: string]: unknown;
}

export interface XuiInboundSettings {
  clients?: Array<{
    id?: string;
    password?: string;
    auth?: string;
    secret?: string;
    email?: string;
    flow?: string;
    security?: string;
    enable?: boolean;
    limitIp?: number;
    totalGB?: number;
    expiryTime?: number;
    tgId?: string | number;
    subId?: string;
    reset?: number;
    privateKey?: string;
    publicKey?: string;
    preSharedKey?: string;
    allowedIPs?: string[];
    keepAlive?: number | string;
  }>;
  accounts?: Array<{ user: string; pass: string }>;
  secretKey?: string;
  dns?: string;
  mtu?: number;
  decryption?: string;
  encryption?: string;
  fallbacks?: unknown[];
  method?: string;
  password?: string;
}

export interface XuiStreamSettings {
  network: string;
  security?: string;
  externalProxy?: unknown[];
  realitySettings?: {
    show: boolean;
    xver: number;
    target: string;
    dest: string;
    serverNames: string[];
    privateKey: string;
    publicKey?: string;
    mldsa65Verify?: string;
    shortIds: string[];
    settings?: {
      publicKey: string;
      fingerprint: string;
      serverName?: string;
      spiderX?: string;
      mldsa65Verify?: string;
    };
  };
  wsSettings?: {
    path: string;
    host?: string;
    headers?: {
      Host?: string;
    };
  };
  grpcSettings?: {
    serviceName: string;
    authority?: string;
    multiMode?: boolean;
  };
  xhttpSettings?: {
    [key: string]: unknown;
    path: string;
    host?: string;
    mode?: string;
  };
  tlsSettings?: {
    serverName?: string;
    alpn?: string[];
    certificates?: Array<{
      certificateFile: string;
      keyFile: string;
    }>;
  };
}
