import * as crypto from 'crypto';
import type { XuiInboundRaw } from '../inbounds/xui-inbound.types';
import {
  normalizeManagedProfileSettings,
  normalizeXhttpPath,
  normalizeXmuxSettings,
} from './profile-compatibility';
import type {
  ClientFingerprint,
  ManagedProfileSettings,
  ProfileExportBundle,
  SeparatedClientProfile,
  XhttpMode,
  XrayClientJsonConfig,
} from './connection-profile.types';

export interface BuildXhttpStableServerParams {
  port: number;
  uuid: string;
  email?: string;
  remark?: string;
  sni: string;
  privateKey: string;
  publicKey: string;
  shortIds?: string[];
  settings?: ManagedProfileSettings | null;
}

export interface BuildXhttpStableClientParams {
  address: string;
  port: number;
  uuid: string;
  remark: string;
  sni: string;
  publicKey: string;
  shortId: string;
  settings?: ManagedProfileSettings | null;
}

/**
 * Minimal XHTTP Stable server inbound for 3x-ui (VLESS + XHTTP + REALITY).
 * Keeps server configuration strictly minimal: no client XMUX, no Vision flow,
 * no inflated padding/buffer overrides by default.
 */
export function buildXhttpStableServerInbound(
  params: BuildXhttpStableServerParams,
): XuiInboundRaw {
  const normalized = normalizeManagedProfileSettings(
    'xhttp-stable',
    params.settings,
  );
  const path = normalizeXhttpPath(normalized.path);
  const host = normalized.host?.trim() || params.sni;
  const mode: XhttpMode = normalized.mode || 'auto';
  const fingerprint: ClientFingerprint = normalized.fingerprint || 'chrome';
  const spiderX = normalized.spiderX || '/';
  const shortIds =
    params.shortIds && params.shortIds.length > 0
      ? params.shortIds
      : [
          crypto.randomBytes(4).toString('hex'),
          crypto.randomBytes(4).toString('hex'),
        ];

  const xhttpSettings: Record<string, unknown> = {
    path,
    host,
    mode,
  };
  if (normalized.noGRPCHeader === true) {
    xhttpSettings.noGRPCHeader = true;
  }

  return {
    enable: true,
    listen: '0.0.0.0',
    port: params.port,
    protocol: 'vless',
    remark: params.remark?.trim() || 'xhttp-stable',
    settings: JSON.stringify({
      clients: [
        {
          id: params.uuid,
          flow: '',
          email: params.email ?? params.uuid,
          enable: true,
          limitIp: 0,
          totalGB: 0,
          expiryTime: 0,
          subId: '',
          reset: 0,
        },
      ],
      decryption: 'none',
      encryption: 'none',
      fallbacks: [],
    }),
    streamSettings: JSON.stringify({
      network: 'xhttp',
      security: 'reality',
      externalProxy: [],
      realitySettings: {
        show: false,
        xver: 0,
        target: `${params.sni}:443`,
        dest: `${params.sni}:443`,
        serverNames: [params.sni],
        privateKey: params.privateKey,
        shortIds,
        settings: {
          publicKey: params.publicKey,
          fingerprint,
          serverName: '',
          spiderX,
        },
      },
      xhttpSettings,
    }),
    sniffing: JSON.stringify({
      enabled: true,
      destOverride: ['http', 'tls', 'quic'],
      metadataOnly: false,
      routeOnly: true,
    }),
  };
}

/**
 * Strips server private keys before returning server preview JSON via API or logs.
 */
export function sanitizeServerInboundPreview(
  inbound: XuiInboundRaw,
): Record<string, unknown> {
  const parseSafe = (raw?: string): unknown => {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  };

  const stream = parseSafe(inbound.streamSettings) as
    | Record<string, unknown>
    | undefined;
  if (stream && typeof stream === 'object') {
    const reality = stream.realitySettings as
      | Record<string, unknown>
      | undefined;
    if (reality && typeof reality === 'object' && 'privateKey' in reality) {
      reality.privateKey = '<server-only:redacted>';
    }
    const tls = stream.tlsSettings as Record<string, unknown> | undefined;
    if (tls && typeof tls === 'object' && Array.isArray(tls.certificates)) {
      const certificates: unknown[] = tls.certificates;
      tls.certificates = certificates.map((cert: unknown): unknown => {
        if (!cert || typeof cert !== 'object') return cert;
        const copy = { ...(cert as Record<string, unknown>) };
        if ('key' in copy) copy.key = '<server-only:redacted>';
        return copy;
      });
    }
  }

  return {
    enable: inbound.enable ?? true,
    listen: inbound.listen ?? '0.0.0.0',
    port: inbound.port,
    protocol: inbound.protocol,
    remark: inbound.remark,
    settings: parseSafe(inbound.settings),
    streamSettings: stream,
    sniffing: parseSafe(inbound.sniffing),
  };
}

/**
 * Builds client-only XHTTP `extra` payload.
 * Returns undefined when default minimal configuration is active.
 */
export function buildXhttpClientExtra(
  settings?: ManagedProfileSettings | null,
): Record<string, unknown> | undefined {
  const normalized = normalizeManagedProfileSettings('xhttp-stable', settings);
  const extra: Record<string, unknown> = {};

  if (normalized.noGRPCHeader === true) {
    extra.noGRPCHeader = true;
  }

  const xmux = normalizeXmuxSettings(normalized.xmux);
  if (xmux) {
    const xmuxPayload: Record<string, unknown> = {};
    if (xmux.maxConcurrency) xmuxPayload.maxConcurrency = xmux.maxConcurrency;
    if (xmux.maxConnections) xmuxPayload.maxConnections = xmux.maxConnections;
    if (xmux.cMaxReuseTimes) xmuxPayload.cMaxReuseTimes = xmux.cMaxReuseTimes;
    if (xmux.hMaxRequestTimes) {
      xmuxPayload.hMaxRequestTimes = xmux.hMaxRequestTimes;
    }
    if (xmux.hMaxReusableSecs) {
      xmuxPayload.hMaxReusableSecs = xmux.hMaxReusableSecs;
    }
    if (xmux.hKeepAlivePeriod !== undefined) {
      xmuxPayload.hKeepAlivePeriod = xmux.hKeepAlivePeriod;
    }
    if (Object.keys(xmuxPayload).length > 0) {
      extra.xmux = xmuxPayload;
    }
  }

  return Object.keys(extra).length > 0 ? extra : undefined;
}

export function buildXhttpStableClientProfile(
  params: BuildXhttpStableClientParams,
): SeparatedClientProfile {
  const normalized = normalizeManagedProfileSettings(
    'xhttp-stable',
    params.settings,
  );
  const path = normalizeXhttpPath(normalized.path);
  const host = normalized.host?.trim() || params.sni;
  const mode: XhttpMode = normalized.mode || 'auto';
  const extra = buildXhttpClientExtra(normalized);

  return {
    kind: 'xhttp-stable',
    protocol: 'vless',
    address: params.address,
    port: params.port,
    uuid: params.uuid,
    remark: params.remark,
    network: 'xhttp',
    security: 'reality',
    sni: params.sni,
    fingerprint: normalized.fingerprint || 'chrome',
    publicKey: params.publicKey,
    shortId: params.shortId,
    spiderX: normalized.spiderX || '/',
    xhttp: {
      path,
      host,
      mode,
      ...(extra ? { extra } : {}),
    },
  };
}

function formatUrlHost(address: string): string {
  const host = address.replace(/^\[|\]$/g, '');
  return host.includes(':') ? `[${host}]` : host;
}

export function buildVlessUriFromClientProfile(
  client: SeparatedClientProfile,
  flagEmoji = '',
): string {
  const params = new URLSearchParams();
  params.set('type', client.network);
  params.set('encryption', 'none');
  params.set('security', client.security);

  if (client.security === 'reality') {
    params.set('pbk', client.publicKey || '');
    params.set('fp', client.fingerprint || 'chrome');
    params.set('sni', client.sni);
    params.set('sid', client.shortId || '');
    params.set('spx', client.spiderX || '/');
  } else if (client.security === 'tls') {
    params.set('sni', client.sni);
    params.set('fp', client.fingerprint || 'chrome');
    if (client.alpn?.length) {
      params.set('alpn', client.alpn.join(','));
    }
  }

  if (client.network === 'tcp' && client.flow) {
    params.set('flow', client.flow);
  }

  if (client.network === 'xhttp' && client.xhttp) {
    params.set('path', client.xhttp.path || '/');
    params.set('host', client.xhttp.host || client.sni);
    params.set('mode', client.xhttp.mode || 'auto');
    if (client.xhttp.extra && Object.keys(client.xhttp.extra).length > 0) {
      params.set('extra', JSON.stringify(client.xhttp.extra));
    }
  }

  const tagPrefix = flagEmoji ? `${flagEmoji}%20` : '';
  return (
    `vless://${encodeURIComponent(client.uuid)}@${formatUrlHost(client.address)}:${client.port}` +
    `?${params.toString()}` +
    `#${tagPrefix}${encodeURIComponent(client.remark || client.kind)}`
  );
}

export function buildXrayOutboundFromClientProfile(
  client: SeparatedClientProfile,
  tag = 'proxy',
): Record<string, unknown> {
  const streamSettings: Record<string, unknown> = {
    network: client.network,
    security: client.security,
  };

  if (client.security === 'reality') {
    streamSettings.realitySettings = {
      serverName: client.sni,
      fingerprint: client.fingerprint || 'chrome',
      publicKey: client.publicKey || '',
      shortId: client.shortId || '',
      spiderX: client.spiderX || '/',
    };
  } else if (client.security === 'tls') {
    streamSettings.tlsSettings = {
      serverName: client.sni,
      fingerprint: client.fingerprint || 'chrome',
      alpn: client.alpn?.length ? client.alpn : ['h2', 'http/1.1'],
    };
  }

  if (client.network === 'xhttp' && client.xhttp) {
    streamSettings.xhttpSettings = {
      path: client.xhttp.path || '/',
      host: client.xhttp.host || client.sni,
      mode: client.xhttp.mode || 'auto',
      ...(client.xhttp.extra && Object.keys(client.xhttp.extra).length > 0
        ? { extra: client.xhttp.extra }
        : {}),
    };
  }

  return {
    tag,
    protocol: 'vless',
    settings: {
      vnext: [
        {
          address: client.address.replace(/^\[|\]$/g, ''),
          port: client.port,
          users: [
            {
              id: client.uuid,
              encryption: 'none',
              ...(client.network === 'tcp' && client.flow
                ? { flow: client.flow }
                : {}),
            },
          ],
        },
      ],
    },
    streamSettings,
  };
}

export function buildXrayClientJsonFromProfile(
  client: SeparatedClientProfile,
): XrayClientJsonConfig {
  return buildXrayClientJsonFromOutbounds([
    buildXrayOutboundFromClientProfile(client, 'proxy'),
  ]);
}

export function buildXrayClientJsonFromOutbounds(
  proxyOutbounds: Array<Record<string, unknown>>,
): XrayClientJsonConfig {
  return {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        tag: 'socks-in',
        listen: '127.0.0.1',
        port: 10808,
        protocol: 'socks',
        settings: { udp: true },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
      },
      {
        tag: 'http-in',
        listen: '127.0.0.1',
        port: 10809,
        protocol: 'http',
      },
    ],
    outbounds: [
      ...proxyOutbounds,
      { tag: 'direct', protocol: 'freedom' },
      { tag: 'block', protocol: 'blackhole' },
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        {
          type: 'field',
          ip: ['geoip:private'],
          outboundTag: 'direct',
        },
      ],
    },
  };
}

export function buildXhttpStableExportBundle(
  params: BuildXhttpStableClientParams & { flagEmoji?: string },
): ProfileExportBundle {
  const clientConfig = buildXhttpStableClientProfile(params);
  return {
    kind: 'xhttp-stable',
    vlessLink: buildVlessUriFromClientProfile(
      clientConfig,
      params.flagEmoji ?? '',
    ),
    clientConfig,
    xrayClientJson: buildXrayClientJsonFromProfile(clientConfig),
  };
}

/**
 * Parses a standard VLESS URI into an Xray outbound object (used as a fallback
 * when exporting legacy subscription inbounds via ?format=xray-json).
 */
export function parseVlessLinkToXrayOutbound(
  link: string,
  tag: string,
): Record<string, unknown> | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'vless:') return null;
    const uuid = decodeURIComponent(url.username);
    const port = Number(url.port || '443');
    if (!uuid || !url.hostname || !Number.isInteger(port)) return null;

    const p = url.searchParams;
    const network = p.get('type') || 'tcp';
    const security = p.get('security') || 'none';
    const flow = p.get('flow') || undefined;

    const streamSettings: Record<string, unknown> = { network, security };

    if (security === 'reality') {
      streamSettings.realitySettings = {
        serverName: p.get('sni') || '',
        fingerprint: p.get('fp') || 'chrome',
        publicKey: p.get('pbk') || '',
        shortId: p.get('sid') || '',
        spiderX: p.get('spx') || '/',
      };
    } else if (security === 'tls') {
      const alpn = (p.get('alpn') || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      streamSettings.tlsSettings = {
        serverName: p.get('sni') || url.hostname.replace(/^\[|\]$/g, ''),
        fingerprint: p.get('fp') || 'chrome',
        ...(alpn.length ? { alpn } : {}),
      };
    }

    if (network === 'xhttp') {
      let extra: Record<string, unknown> | undefined;
      const rawExtra = p.get('extra');
      if (rawExtra) {
        try {
          const parsed: unknown = JSON.parse(rawExtra);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            extra = parsed as Record<string, unknown>;
          }
        } catch {
          // Ignore malformed extra JSON
        }
      }
      streamSettings.xhttpSettings = {
        path: p.get('path') || '/',
        host: p.get('host') || p.get('sni') || '',
        mode: p.get('mode') || 'auto',
        ...(extra ? { extra } : {}),
      };
    } else if (network === 'ws') {
      streamSettings.wsSettings = {
        path: p.get('path') || '/',
        ...(p.get('host') ? { host: p.get('host') } : {}),
      };
    } else if (network === 'grpc') {
      streamSettings.grpcSettings = {
        serviceName: p.get('serviceName') || 'grpc',
        ...(p.get('authority') ? { authority: p.get('authority') } : {}),
      };
    }

    return {
      tag,
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: url.hostname.replace(/^\[|\]$/g, ''),
            port,
            users: [
              {
                id: uuid,
                encryption: p.get('encryption') || 'none',
                ...(network === 'tcp' && flow ? { flow } : {}),
              },
            ],
          },
        ],
      },
      streamSettings,
    };
  } catch {
    return null;
  }
}

export function buildXrayClientJsonFromSubscriptionInbounds(
  inbounds: Array<{
    remark?: string | null;
    link?: string | null;
    clientProfileJson?: string | null;
  }>,
  overrideHost?: string,
): XrayClientJsonConfig {
  const outbounds: Array<Record<string, unknown>> = [];

  for (const [index, inbound] of inbounds.entries()) {
    const baseTag =
      index === 0
        ? 'proxy'
        : `proxy-${index + 1}-${
            (inbound.remark || 'vless')
              .toLowerCase()
              .replace(/[^a-z0-9-]+/g, '-')
              .replace(/^-+|-+$/g, '') || 'node'
          }`;

    if (inbound.clientProfileJson) {
      try {
        const parsed = JSON.parse(
          inbound.clientProfileJson,
        ) as SeparatedClientProfile;
        if (parsed && parsed.protocol === 'vless' && parsed.uuid) {
          const client: SeparatedClientProfile = overrideHost
            ? { ...parsed, address: overrideHost }
            : parsed;
          outbounds.push(buildXrayOutboundFromClientProfile(client, baseTag));
          continue;
        }
      } catch {
        // Fallback to link parsing
      }
    }

    if (inbound.link?.startsWith('vless://')) {
      const outbound = parseVlessLinkToXrayOutbound(inbound.link, baseTag);
      if (outbound) {
        if (overrideHost) {
          const vnext = (
            outbound.settings as { vnext?: Array<{ address?: string }> }
          )?.vnext?.[0];
          if (vnext) vnext.address = overrideHost.replace(/^\[|\]$/g, '');
        }
        outbounds.push(outbound);
      }
    }
  }

  return buildXrayClientJsonFromOutbounds(outbounds);
}
