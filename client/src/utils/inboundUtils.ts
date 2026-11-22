import type { NodeRecord } from '../types/node';
import {
  ACTIVE_MANAGED_PROFILE_TYPES,
  CERTIFICATE_TYPES,
  DEFAULT_INBOUND_TYPES,
  MANAGED_PROFILE_TYPES,
  ROUTING_INBOUND_TYPES,
  type CountryOption,
  type Domain,
  type InboundConfigUI,
  type ManagedProfileSettings,
  type Tunnel,
} from '../types/inbound';

export const getDefaultNodeId = (nodes: NodeRecord[]): string =>
  nodes.find((node) => node.isMain)?.id || nodes[0]?.id || '';

export const getNodeAddress = (
  nodeId: string | undefined,
  nodes: NodeRecord[],
): string => {
  const node = nodes.find(
    (item) => item.id === (nodeId || getDefaultNodeId(nodes)),
  );
  if (!node) return '';
  if (node.domain) return node.domain;
  if (node.ip) return node.ip;
  if (node.host) return node.host;
  try {
    return new URL(node.url).hostname;
  } catch {
    return node.url;
  }
};

export const getNodeFlag = (
  nodeId: string | undefined,
  nodes: NodeRecord[],
): string =>
  nodes.find((node) => node.id === (nodeId || getDefaultNodeId(nodes)))?.flag ||
  '';

export const getRelayOptions = (
  nodeId: string | undefined,
  tunnels: Tunnel[],
  nodes: NodeRecord[],
): Tunnel[] =>
  tunnels.filter(
    (tunnel) => tunnel.nodeId === (nodeId || getDefaultNodeId(nodes)),
  );

export const hasSni = (type: string): boolean =>
  !CERTIFICATE_TYPES.has(type) &&
  !ROUTING_INBOUND_TYPES.has(type) &&
  ![
    'amneziawg',
    'wireguard',
    'mixed',
    'http',
    'socks',
    'custom',
    'vless-xhttp-get',
    'self-sni',
  ].includes(type);

export const isListedSni = (sni: string, domains: Domain[]): boolean => {
  const normalizedSni = sni.trim().toLowerCase();
  return (
    normalizedSni === 'random' ||
    domains.some((domain) => domain.name.toLowerCase() === normalizedSni)
  );
};

export const inboundSni = (
  type: string,
  domains: Domain[],
  savedSni?: string,
): string => {
  if (!hasSni(type)) return '';
  const configuredSni = savedSni?.trim() || 'random';
  return type === 'mtproto-faketls' && !isListedSni(configuredSni, domains)
    ? 'random'
    : configuredSni;
};

export const getSelectedNode = (
  nodeId: string | undefined,
  nodes: NodeRecord[],
): NodeRecord | undefined =>
  nodes.find((node) => node.id === (nodeId || getDefaultNodeId(nodes)));

export const isInboundSupported = (
  type: string,
  nodeId: string | undefined,
  nodes: NodeRecord[],
): boolean => {
  if (type === 'custom' || ROUTING_INBOUND_TYPES.has(type)) return true;
  if (MANAGED_PROFILE_TYPES.has(type) && !ACTIVE_MANAGED_PROFILE_TYPES.has(type)) {
    return false;
  }
  const capabilities = getSelectedNode(nodeId, nodes)?.capabilities;
  return !capabilities || capabilities.supportedInboundTypes.includes(type);
};

export const createDefaultXhttpStableSettings = (): ManagedProfileSettings => ({
  mode: 'auto',
  rotationPolicy: 'fixed_domain',
  xmux: { enabled: false },
});

export const createDefaultSelfSniSettings = (
  domain?: string,
): ManagedProfileSettings => ({
  domain: domain?.trim() || '',
  webServer: 'nginx',
  localHttpsPort: 8443,
  destPort: 443,
  fingerprint: 'chrome',
  spiderX: '/',
  xver: 0,
  rotationPolicy: 'fixed_domain',
});

const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export const validateSelfSniSettings = (
  settings?: ManagedProfileSettings,
  port?: string,
): string | null => {
  const domain = settings?.domain?.trim() || '';
  if (!domain) {
    return 'Self-SNI требует указать собственный домен (случайный SNI не допускается)';
  }
  if (!HOSTNAME_RE.test(domain)) {
    return 'Self-SNI: укажите корректное доменное имя (например site.example.com)';
  }
  const webServer = settings?.webServer ?? 'nginx';
  const localHttpsPort = settings?.localHttpsPort ?? 8443;
  if (
    !Number.isInteger(localHttpsPort) ||
    localHttpsPort < 1 ||
    localHttpsPort > 65535
  ) {
    return 'Self-SNI: локальный HTTPS-порт должен быть от 1 до 65535';
  }
  if (
    webServer !== 'none' &&
    port &&
    port !== 'random' &&
    /^\d+$/.test(port) &&
    Number(port) === localHttpsPort
  ) {
    return `Порт Xray (${port}) не должен совпадать с локальным HTTPS-портом веб-сервера (${localHttpsPort})`;
  }
  return null;
};

const XMUX_RANGE_RE = /^(\d+)(?:-(\d+))?$/;

const isValidXmuxRange = (value?: string, allowZero = false): boolean => {
  if (!value || !value.trim()) return true;
  const match = XMUX_RANGE_RE.exec(value.trim());
  if (!match) return false;
  const min = Number(match[1]);
  const max = match[2] !== undefined ? Number(match[2]) : min;
  if (!allowZero && (min < 1 || max < 1)) return false;
  return min <= max && max <= 1_000_000;
};

export const validateXhttpStableSettings = (
  settings?: ManagedProfileSettings,
): string | null => {
  if (!settings) return null;
  if (settings.xmux?.enabled) {
    const x = settings.xmux;
    if (x.maxConcurrency?.trim() && x.maxConnections?.trim()) {
      return 'XMUX: укажите либо maxConcurrency, либо maxConnections (в Xray они взаимоисключающие)';
    }
    if (!isValidXmuxRange(x.maxConcurrency, false)) {
      return 'XMUX: некорректный диапазон maxConcurrency (например 16-32)';
    }
    if (!isValidXmuxRange(x.maxConnections, false)) {
      return 'XMUX: некорректный диапазон maxConnections (например 4-8)';
    }
    if (!isValidXmuxRange(x.cMaxReuseTimes, true)) {
      return 'XMUX: некорректный диапазон cMaxReuseTimes (например 0 или 16-32)';
    }
    if (!isValidXmuxRange(x.hMaxRequestTimes, false)) {
      return 'XMUX: некорректный диапазон hMaxRequestTimes (например 600-900)';
    }
    if (!isValidXmuxRange(x.hMaxReusableSecs, false)) {
      return 'XMUX: некорректный диапазон hMaxReusableSecs (например 1800-3000)';
    }
  }
  return null;
};

export const requiresPanelTlsCertificate = (inbound: {
  type: string;
  profileSettings?: ManagedProfileSettings;
}): boolean => {
  if (!CERTIFICATE_TYPES.has(inbound.type)) return false;
  if (
    inbound.type === 'https-fallback' &&
    (inbound.profileSettings?.reverseProxy === 'nginx' ||
      inbound.profileSettings?.reverseProxy === 'caddy')
  ) {
    return false;
  }
  return true;
};

export const createDefaultHttpsFallbackSettings = (
  domain?: string,
): ManagedProfileSettings => ({
  domain: domain?.trim() || '',
  mode: 'auto',
  path: '/api/v2/stream',
  fingerprint: 'chrome',
  reverseProxy: 'none',
  publicPort: 443,
  rotationPolicy: 'fixed_domain',
});

export const validateHttpsFallbackSettings = (
  settings?: ManagedProfileSettings,
  port?: string,
  fallbackDomain?: string,
): string | null => {
  const domain = settings?.domain?.trim() || fallbackDomain?.trim() || '';
  if (!domain) {
    return 'HTTPS Fallback требует указать домен с действующим TLS-сертификатом';
  }
  if (!HOSTNAME_RE.test(domain)) {
    return 'HTTPS Fallback: укажите корректный домен (например fallback.example.com)';
  }
  if (settings?.path && /[\s?#]/.test(settings.path.trim())) {
    return 'HTTPS Fallback: endpoint path не должен содержать пробелы, ? или #';
  }
  const reverseProxy = settings?.reverseProxy ?? 'none';
  const publicPort = settings?.publicPort ?? 443;
  if (
    !Number.isInteger(publicPort) ||
    publicPort < 1 ||
    publicPort > 65535
  ) {
    return 'HTTPS Fallback: публичный HTTPS-порт должен быть от 1 до 65535';
  }
  if (
    reverseProxy !== 'none' &&
    port &&
    port !== 'random' &&
    /^\d+$/.test(port) &&
    Number(port) === publicPort
  ) {
    return `Внутренний порт Xray (${port}) не должен совпадать с публичным портом ${reverseProxy} (${publicPort})`;
  }
  return null;
};

export const isValidPort = (value: string): boolean =>
  value === 'random' ||
  (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535);

export const createInboundTemplate = (
  type = 'vless-tcp-reality',
  nodes: NodeRecord[],
  domains: Domain[],
  partial?: Partial<InboundConfigUI>,
): InboundConfigUI => {
  const isRouting = ROUTING_INBOUND_TYPES.has(type);
  const isCustom = type === 'custom';
  const defaultNode = getDefaultNodeId(nodes);
  const nodeId = isRouting || isCustom
    ? ''
    : partial?.nodeId !== undefined
      ? partial.nodeId
      : defaultNode;
  const configId = crypto.randomUUID();
  const isCert = CERTIFICATE_TYPES.has(type);
  const certMode = isCert
    ? partial?.certificateMode === 'custom'
      ? 'custom'
      : 'node'
    : undefined;
  return {
    id: configId,
    configId,
    type,
    port: isRouting || isCustom ? '' : (partial?.port ?? 'random'),
    sni: isRouting || isCustom ? '' : (partial?.sni ?? inboundSni(type, domains)),
    link: partial?.link ?? '',
    routingProfile: partial?.routingProfile ?? '',
    nodeId,
    relayServerId: isRouting || isCustom ? '' : (partial?.relayServerId ?? ''),
    flag: isRouting || isCustom
      ? ''
      : partial?.flag !== undefined
        ? partial.flag
        : getNodeFlag(nodeId, nodes),
    name: isRouting || isCustom ? '' : (partial?.name ?? ''),
    certificateMode: certMode,
    tlsServerName: isCert
      ? partial?.tlsServerName || getNodeAddress(nodeId, nodes)
      : undefined,
    certificateFile:
      isCert && certMode === 'custom' ? partial?.certificateFile || '' : '',
    keyFile: isCert && certMode === 'custom' ? partial?.keyFile || '' : '',
    profileId: MANAGED_PROFILE_TYPES.has(type) ? partial?.profileId : undefined,
    profileSettings:
      type === 'xhttp-stable'
        ? { ...createDefaultXhttpStableSettings(), ...partial?.profileSettings }
        : type === 'self-sni'
          ? {
              ...createDefaultSelfSniSettings(
                partial?.profileSettings?.domain ||
                  (partial?.sni && partial.sni !== 'random' ? partial.sni : '') ||
                  (HOSTNAME_RE.test(getNodeAddress(nodeId, nodes))
                    ? getNodeAddress(nodeId, nodes)
                    : ''),
              ),
              ...partial?.profileSettings,
            }
          : type === 'https-fallback'
            ? {
                ...createDefaultHttpsFallbackSettings(
                  partial?.profileSettings?.domain ||
                    partial?.tlsServerName ||
                    (HOSTNAME_RE.test(getNodeAddress(nodeId, nodes))
                      ? getNodeAddress(nodeId, nodes)
                      : ''),
                ),
                ...partial?.profileSettings,
              }
            : undefined,
    enabled: partial?.enabled,
    disabledReason: partial?.disabledReason,
  };
};

export const createBuiltinDefaultInbounds = (
  nodes: NodeRecord[],
  domains: Domain[],
): InboundConfigUI[] =>
  DEFAULT_INBOUND_TYPES.map((type) =>
    createInboundTemplate(type, nodes, domains),
  );

export const parseDefaultInboundsSetting = (
  raw: string | undefined,
  nodes: NodeRecord[],
  domains: Domain[],
): InboundConfigUI[] | null => {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((item: Partial<InboundConfigUI>) => {
      const type = item.type || 'vless-tcp-reality';
      const nodeExists = item.nodeId
        ? nodes.some((n) => n.id === item.nodeId)
        : true;
      const targetNodeId = nodeExists ? item.nodeId || '' : '';
      const flag = nodeExists ? item.flag : '';
      const name = nodeExists ? item.name : '';
      const relayServerId = nodeExists ? item.relayServerId : '';
      return createInboundTemplate(type, nodes, domains, {
        ...item,
        nodeId: targetNodeId,
        flag,
        name,
        relayServerId,
      });
    });
  } catch {
    return null;
  }
};

export const sanitizeInboundForStorage = (
  inbound: InboundConfigUI,
): Partial<InboundConfigUI> => {
  if (ROUTING_INBOUND_TYPES.has(inbound.type)) {
    return {
      type: inbound.type,
      routingProfile: inbound.routingProfile || '',
    };
  }
  const isCustom = inbound.type === 'custom';
  const isCert = CERTIFICATE_TYPES.has(inbound.type);
  return {
    type: inbound.type,
    nodeId: isCustom ? '' : inbound.nodeId || '',
    relayServerId: isCustom ? '' : inbound.relayServerId || '',
    flag: isCustom ? '' : inbound.flag || '',
    name: isCustom ? '' : inbound.name || '',
    port: isCustom ? '' : inbound.port || 'random',
    sni:
      inbound.type === 'self-sni'
        ? inbound.profileSettings?.domain?.trim() || ''
        : isCustom || !hasSni(inbound.type)
          ? ''
          : inbound.sni || 'random',
    link: isCustom ? inbound.link || '' : '',
    certificateMode: isCert ? inbound.certificateMode || 'node' : undefined,
    tlsServerName: isCert ? inbound.tlsServerName || '' : undefined,
    certificateFile:
      isCert && inbound.certificateMode === 'custom'
        ? inbound.certificateFile || ''
        : undefined,
    keyFile:
      isCert && inbound.certificateMode === 'custom'
        ? inbound.keyFile || ''
        : undefined,
    profileSettings:
      inbound.type === 'xhttp-stable'
        ? inbound.profileSettings || createDefaultXhttpStableSettings()
        : inbound.type === 'self-sni'
          ? inbound.profileSettings || createDefaultSelfSniSettings()
          : inbound.type === 'https-fallback'
            ? inbound.profileSettings || createDefaultHttpsFallbackSettings()
            : undefined,
  };
};

export function validateRoutingProfile(
  type: string,
  profile?: string,
): string | null {
  const value = profile?.trim() || '';
  if (!value) {
    return 'Укажите профиль маршрутизации';
  }
  if (type === 'happ-routing') {
    if (value === 'happ://routing/off') return null;
    const match = /^happ:\/\/routing\/(add|onadd)\/([^\s]+)$/.exec(value);
    const payload = match?.[2] || value;
    try {
      if (!payload.startsWith('{') && !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
        return 'Неверный профиль Happ: ожидается JSON-объект, base64 или happ://routing ссылка';
      }
      const decoded = payload.startsWith('{')
        ? payload
        : atob(payload);
      const parsed = JSON.parse(decoded);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return 'Неверный профиль Happ: ожидается JSON-объект';
      }
      return null;
    } catch {
      return 'Неверный профиль Happ: ожидается JSON-объект, base64 или happ://routing ссылка';
    }
  }
  if (type === 'incy-routing') {
    const match =
      /^(?:incy)?:\/\/(routing|autorouting)\/(add|onadd)\/([^\s]+)$/.exec(value);
    const payload = match?.[3] || value;
    if (match?.[1] === 'autorouting' || /^https?:\/\//.test(payload)) {
      if (/\s/.test(payload)) return 'Неверный URL автомаршрутизации INCY';
      try {
        const url = new URL(payload);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
          return 'Неверный URL автомаршрутизации INCY';
        }
        return null;
      } catch {
        return 'Неверный URL автомаршрутизации INCY';
      }
    }
    return validateRoutingProfile(
      'happ-routing',
      value.replace(/^(?:incy)?:\/\/routing\//, 'happ://routing/'),
    );
  }
  return null;
}

// validator.js isURL also caps URL length at 2084 UTF-16 code units.
const MAX_VALIDATOR_URL_CODE_UNITS = 2084;

const hasInvalidUrlCharacters = (url: string): boolean =>
  /[\s<>]/u.test(url) ||
  Array.from(url).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });

export function validateSubscriptionMetadata(metadata: {
  note?: string;
  supportUrl?: string;
  websiteUrl?: string;
}): { note?: string; supportUrl?: string; websiteUrl?: string } {
  const errors: { note?: string; supportUrl?: string; websiteUrl?: string } = {};

  if (metadata.note && [...metadata.note].length > 200) {
    errors.note = 'Примечание не должно превышать 200 символов';
  }

  if (metadata.supportUrl && metadata.supportUrl.trim()) {
    const url = metadata.supportUrl.trim();
    if ([...url].length > 2048) {
      errors.supportUrl = 'Ссылка поддержки не должна превышать 2048 символов';
    } else {
      try {
        if (url.length > MAX_VALIDATOR_URL_CODE_UNITS || hasInvalidUrlCharacters(url)) {
          throw new Error('Invalid URL');
        }
        const parsed = new URL(url);
        if (!['http:', 'https:', 'tg:'].includes(parsed.protocol)) {
          errors.supportUrl =
            'Ссылка поддержки должна начинаться с http://, https:// или tg://';
        }
      } catch {
        errors.supportUrl = 'Некорректный формат ссылки поддержки';
      }
    }
  }

  if (metadata.websiteUrl && metadata.websiteUrl.trim()) {
    const url = metadata.websiteUrl.trim();
    if ([...url].length > 2048) {
      errors.websiteUrl = 'Ссылка на сайт не должна превышать 2048 символов';
    } else {
      try {
        if (url.length > MAX_VALIDATOR_URL_CODE_UNITS || hasInvalidUrlCharacters(url)) {
          throw new Error('Invalid URL');
        }
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          errors.websiteUrl =
            'Ссылка на сайт должна начинаться с http:// или https://';
        }
      } catch {
        errors.websiteUrl = 'Некорректный формат ссылки на сайт';
      }
    }
  }

  return errors;
}

export type { CountryOption, Domain, InboundConfigUI, Tunnel };
