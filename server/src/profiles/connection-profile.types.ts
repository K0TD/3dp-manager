export const MANAGED_PROFILE_KINDS = [
  'xhttp-stable',
  'self-sni',
  'https-fallback',
] as const;

export type ManagedProfileKind = (typeof MANAGED_PROFILE_KINDS)[number];

export const XHTTP_MODES = ['auto', 'stream-one', 'packet-up'] as const;
export type XhttpMode = (typeof XHTTP_MODES)[number];

export const CLIENT_FINGERPRINTS = [
  'chrome',
  'firefox',
  'safari',
  'ios',
  'android',
  'edge',
  '360',
  'qq',
  'random',
  'randomized',
] as const;
export type ClientFingerprint = (typeof CLIENT_FINGERPRINTS)[number];

export const PROFILE_ROTATION_POLICIES = [
  'fixed_domain',
  'preserve_all',
  'standard',
] as const;
export type ProfileRotationPolicy = (typeof PROFILE_ROTATION_POLICIES)[number];

export const REVERSE_PROXY_ENGINES = ['none', 'nginx', 'caddy'] as const;
export type ReverseProxyEngine = (typeof REVERSE_PROXY_ENGINES)[number];

export const PROFILE_CHECK_STATUSES = [
  'unknown',
  'passed',
  'warning',
  'failed',
] as const;
export type ProfileCheckStatus = (typeof PROFILE_CHECK_STATUSES)[number];

/**
 * Client-only XHTTP multiplexing tuning.
 * Never injected into the server inbound config by default.
 */
export interface XhttpXmuxSettings {
  enabled?: boolean;
  maxConcurrency?: string;
  maxConnections?: string;
  cMaxReuseTimes?: string;
  hMaxRequestTimes?: string;
  hMaxReusableSecs?: string;
  hKeepAlivePeriod?: number;
}

export interface XhttpStableProfileSettings {
  mode?: XhttpMode;
  path?: string;
  host?: string;
  fingerprint?: ClientFingerprint;
  spiderX?: string;
  noGRPCHeader?: boolean;
  xmux?: XhttpXmuxSettings;
  rotationPolicy?: ProfileRotationPolicy;
}

export interface SelfSniProfileSettings {
  domain?: string;
  destPort?: number;
  localHttpsPort?: number;
  webServer?: ReverseProxyEngine;
  certificateFile?: string;
  keyFile?: string;
  fingerprint?: ClientFingerprint;
  spiderX?: string;
  xver?: 0 | 1 | 2;
  rotationPolicy?: ProfileRotationPolicy;
}

export interface HttpsFallbackProfileSettings {
  domain?: string;
  path?: string;
  host?: string;
  mode?: XhttpMode;
  fingerprint?: ClientFingerprint;
  reverseProxy?: ReverseProxyEngine;
  publicPort?: number;
  certificateMode?: 'node' | 'custom';
  certificateFile?: string;
  keyFile?: string;
  rotationPolicy?: ProfileRotationPolicy;
}

/**
 * Unified managed profile configuration stored alongside Subscription.inboundsConfig
 * and ConnectionProfile.spec.
 */
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
  // Extension fields for Stages 2 & 3 (Self-SNI & HTTPS Fallback)
  destPort?: number;
  localHttpsPort?: number;
  webServer?: ReverseProxyEngine;
  reverseProxy?: ReverseProxyEngine;
  publicPort?: number;
  xver?: 0 | 1 | 2;
  certificateFile?: string;
  keyFile?: string;
  // Requirement #14 extension hook (reserved for future mihomo + RU->EU routing)
  monitoring?: ProfileMonitoringExtension;
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

export interface ClientConnectionProbeResult {
  success: boolean;
  engine: 'xray-core' | 'tcp-tls-fallback';
  targetAddress: string;
  targetPort: number;
  protocol: 'vless';
  profileKind?: ManagedProfileKind;
  httpStatusCode?: number;
  latencyMs: number;
  probeUrl?: string;
  fallbackReason?: string;
  error?: string;
}

/**
 * Reserved extension slot for future mihomo monitoring and RU -> EU multi-hop routing.
 * Persisted cleanly without executing mihomo/RU->EU logic in Stage 1.
 */
export interface ProfileMonitoringExtension {
  probeEngine?: 'xray' | 'mihomo';
  routingStrategy?: 'direct' | 'ru-eu-relay';
  entryNodeId?: string;
  exitNodeId?: string;
  labels?: Record<string, string>;
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

export interface SeparatedClientProfile {
  kind: ManagedProfileKind;
  protocol: 'vless';
  address: string;
  port: number;
  uuid: string;
  remark: string;
  flow?: string;
  network: 'tcp' | 'xhttp';
  security: 'reality' | 'tls';
  sni: string;
  fingerprint: ClientFingerprint;
  publicKey?: string;
  shortId?: string;
  spiderX?: string;
  alpn?: string[];
  xhttp?: {
    path: string;
    host: string;
    mode: XhttpMode;
    extra?: Record<string, unknown>;
  };
}

export interface XrayClientJsonConfig {
  log: { loglevel: 'warning' | 'error' | 'info' | 'none' };
  inbounds: Array<Record<string, unknown>>;
  outbounds: Array<Record<string, unknown>>;
  routing: Record<string, unknown>;
}

export interface ProfileExportBundle {
  kind: ManagedProfileKind;
  vlessLink: string;
  clientConfig: SeparatedClientProfile;
  xrayClientJson: XrayClientJsonConfig;
}

export function isManagedProfileKind(
  value: string | undefined,
): value is ManagedProfileKind {
  return (
    typeof value === 'string' &&
    (MANAGED_PROFILE_KINDS as readonly string[]).includes(value)
  );
}
