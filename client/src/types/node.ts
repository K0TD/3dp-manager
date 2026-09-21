export type NodeAuthType = 'password' | 'token';
export type NodeProtocol = 'http' | 'https';
export type NodeHealthStatus = 'unknown' | 'online' | 'degraded' | 'offline' | 'auth_error' | 'deleting';

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
  version?: string;
  allowInvalidTls?: boolean;
}
