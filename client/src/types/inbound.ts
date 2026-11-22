export type ManagedProfileKind = 'xhttp-stable' | 'self-sni' | 'https-fallback';
export type XhttpMode = 'auto' | 'stream-one' | 'packet-up';
export type ClientFingerprint =
  | 'chrome'
  | 'firefox'
  | 'safari'
  | 'ios'
  | 'android'
  | 'edge'
  | '360'
  | 'qq'
  | 'random'
  | 'randomized';
export type ProfileRotationPolicy = 'fixed_domain' | 'preserve_all' | 'standard';
export type ReverseProxyEngine = 'none' | 'nginx' | 'caddy';

export interface XhttpXmuxSettings {
  enabled?: boolean;
  maxConcurrency?: string;
  maxConnections?: string;
  cMaxReuseTimes?: string;
  hMaxRequestTimes?: string;
  hMaxReusableSecs?: string;
  hKeepAlivePeriod?: number;
}

export interface ManagedProfileSettings {
  mode?: XhttpMode;
  path?: string;
  host?: string;
  domain?: string;
  fingerprint?: ClientFingerprint;
  spiderX?: string;
  noGRPCHeader?: boolean;
  xmux?: XhttpXmuxSettings;
  rotationPolicy?: ProfileRotationPolicy;
  destPort?: number;
  localHttpsPort?: number;
  webServer?: ReverseProxyEngine;
  reverseProxy?: ReverseProxyEngine;
  publicPort?: number;
  xver?: 0 | 1 | 2;
  certificateFile?: string;
  keyFile?: string;
}

export interface WebServerConfigBundle {
  engine: 'nginx' | 'caddy';
  purpose: 'self-sni' | 'https-fallback';
  domain: string;
  filename: string;
  config: string;
  staticSitePath?: string;
  staticSiteHtml?: string;
  backupCommand: string;
  validateCommand: string;
  reloadCommand: string;
  rollbackCommand: string;
  notes: string[];
}

export interface TlsCertificateProbeInfo {
  subjectCN?: string;
  subjectAltName?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining?: number;
  authorized: boolean;
  authorizationError?: string;
  hostnameMatches?: boolean;
}

export interface TlsSiteProbeResult {
  domain: string;
  port: number;
  reachable: boolean;
  dnsResolvedIps: string[];
  dnsError?: string;
  dnsMatchesNodeIp?: boolean;
  tlsProtocol?: string;
  alpnProtocol?: string;
  certificate?: TlsCertificateProbeInfo;
  httpStatusCode?: number;
  httpServerHeader?: string;
  error?: string;
  durationMs: number;
}

export interface ProfileCompatibilityItem {
  code: string;
  severity: 'ok' | 'warning' | 'error';
  title: string;
  message: string;
}

export interface ProfileCompatibilityReport {
  compatible: boolean;
  status: 'passed' | 'warning' | 'failed';
  checks: ProfileCompatibilityItem[];
}

export interface ProfilePreviewResponse {
  kind: ManagedProfileKind;
  compatibility: ProfileCompatibilityReport;
  serverPreview: Record<string, unknown>;
  clientPreview: {
    kind: ManagedProfileKind;
    vlessLink: string;
    clientConfig: Record<string, unknown>;
    xrayClientJson: Record<string, unknown>;
  };
  webServerConfig?: WebServerConfigBundle;
  tlsProbe?: TlsSiteProbeResult;
}

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
  profileId?: string;
  profileSettings?: ManagedProfileSettings;
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

export const MANAGED_PROFILE_TYPES = new Set<string>([
  'xhttp-stable',
  'self-sni',
  'https-fallback',
]);

export const ACTIVE_MANAGED_PROFILE_TYPES = new Set<string>([
  'xhttp-stable',
  'self-sni',
  'https-fallback',
]);

export const ROUTING_INBOUND_TYPES = new Set<string>([
  'happ-routing',
  'incy-routing',
]);

export const isRoutingProfile = (type: string): boolean =>
  ROUTING_INBOUND_TYPES.has(type);

export const PERSISTENT_INBOUND_TYPES = new Set([
  'amneziawg', 'wireguard', 'mixed', 'http', 'socks',
]);

export const XHTTP_MODE_OPTIONS: readonly XhttpMode[] = [
  'auto',
  'stream-one',
  'packet-up',
];

export const FINGERPRINT_OPTIONS: readonly ClientFingerprint[] = [
  'chrome',
  'firefox',
  'safari',
  'ios',
  'android',
  'edge',
  'random',
  'randomized',
];

export const CERTIFICATE_TYPES = new Set([
  'hysteria2-udp',
  'vless-tcp-tls',
  'vless-ws-tls',
  'vless-xhttp-tls',
  'https-fallback',
]);

export const DEFAULT_INBOUND_TYPES = [
  'hysteria2-udp',
  'vless-xhttp-reality',
  'vless-tcp-tls',
  'vless-tcp-reality',
  'vless-grpc-reality',
];
