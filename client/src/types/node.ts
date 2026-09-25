export type NodeAuthType = 'password' | 'token';

export interface RoutingPresetSelection {
  blockRussia: boolean;
  blockIpCheckers: boolean;
  googleIpv4: boolean;
  forceAdopt?: boolean;
  revision: string;
}

export interface RoutingPresetView extends RoutingPresetSelection {
  available: boolean;
  capabilities?: {
    blocking: { available: boolean; reason?: string };
    googleIpv4: { available: boolean; reason?: string };
  };
  needsApply: boolean;
  hasConflict?: boolean;
  warnings: string[];
  result?: 'applied' | 'unchanged' | 'rolled_back' | 'rollback_failed' | 'unknown';
  message?: string;
}
export type NodeProtocol = 'http' | 'https';
export type NodeHealthStatus = 'unknown' | 'online' | 'degraded' | 'offline' | 'auth_error' | 'deleting';

export interface NodeCapabilities {
  supportedInboundTypes: string[];
  autoTlsCertificate: boolean;
  warnings: string[];
}

export interface NodeRecord {
  id: string;
  name: string;
  url: string;
  host?: string;
  domain?: string;
  ip?: string;
  flag?: string;
  port?: number;
  protocol?: NodeProtocol;
  authType: NodeAuthType;
  login?: string;
  isMain: boolean;
  version?: string;
  xrayVersion?: string;
  capabilities?: NodeCapabilities;
  compatibilityCheckedAt?: string;
  webCertificateFile?: string;
  webKeyFile?: string;
  healthStatus?: NodeHealthStatus;
  lastCheckedAt?: string;
  responseTimeMs?: number;
  consecutiveFailures?: number;
  lastError?: string;
  allowInvalidTls?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NodePayload {
  name: string;
  url: string;
  domain?: string;
  ip?: string;
  flag?: string;
  authType: NodeAuthType;
  login?: string;
  password?: string;
  token?: string;
  isMain?: boolean;
  allowInvalidTls?: boolean;
}
