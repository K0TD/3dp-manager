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

export interface NodeConnectionDiagnostics {
  targetHost?: string;
  targetPort?: number;
  resolvedIps?: string[];
  configuredIp?: string;
  usedDirectIp?: boolean;
  errorCode?: string;
  hint?: string;
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
  hasPassword?: boolean;
  hasToken?: boolean;
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
  syncSubscriptionLinks?: boolean;
}

export interface NodeCheckPayload {
  nodeId?: string;
  name?: string;
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
  preferDirectIp?: boolean;
}

export interface NodeCheckResult {
  success: boolean;
  version?: string;
  xrayVersion?: string;
  capabilities?: NodeCapabilities;
  responseTimeMs?: number;
  diagnostics?: NodeConnectionDiagnostics;
  message?: string;
}

export interface MigrateNodeAddressPayload {
  url: string;
  domain?: string;
  ip?: string;
  flag?: string;
  allowInvalidTls?: boolean;
  syncSubscriptionLinks?: boolean;
  preferDirectIp?: boolean;
}

export interface MigrateNodeAddressResult {
  node: NodeRecord;
  connection: NodeCheckResult;
  updatedInbounds: number;
  affectedTunnels: number;
  previousAddress?: string;
  nextAddress?: string;
}
