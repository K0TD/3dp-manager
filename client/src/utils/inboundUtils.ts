import type { NodeRecord } from '../types/node';
import {
  CERTIFICATE_TYPES,
  DEFAULT_INBOUND_TYPES,
  type CountryOption,
  type Domain,
  type InboundConfigUI,
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
  !CERTIFICATE_TYPES.has(type) && type !== 'amneziawg';

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
  if (type === 'custom') return true;
  const capabilities = getSelectedNode(nodeId, nodes)?.capabilities;
  return !capabilities || capabilities.supportedInboundTypes.includes(type);
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
  const defaultNode = getDefaultNodeId(nodes);
  const nodeId = partial?.nodeId !== undefined ? partial.nodeId : defaultNode;
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
    port: partial?.port ?? 'random',
    sni: partial?.sni ?? inboundSni(type, domains),
    link: partial?.link ?? '',
    nodeId,
    relayServerId: partial?.relayServerId ?? '',
    flag:
      partial?.flag !== undefined ? partial.flag : getNodeFlag(nodeId, nodes),
    name: partial?.name ?? '',
    certificateMode: certMode,
    tlsServerName: isCert
      ? partial?.tlsServerName || getNodeAddress(nodeId, nodes)
      : undefined,
    certificateFile:
      isCert && certMode === 'custom' ? partial?.certificateFile || '' : '',
    keyFile: isCert && certMode === 'custom' ? partial?.keyFile || '' : '',
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
      const targetNodeId = nodeExists
        ? item.nodeId || ''
        : getDefaultNodeId(nodes);
      return createInboundTemplate(type, nodes, domains, {
        ...item,
        nodeId: targetNodeId,
      });
    });
  } catch {
    return null;
  }
};

export const sanitizeInboundForStorage = (
  inbound: InboundConfigUI,
): Partial<InboundConfigUI> => {
  const isCustom = inbound.type === 'custom';
  const isCert = CERTIFICATE_TYPES.has(inbound.type);
  return {
    type: inbound.type,
    nodeId: isCustom ? '' : inbound.nodeId || '',
    relayServerId: isCustom ? '' : inbound.relayServerId || '',
    flag: isCustom ? '' : inbound.flag || '',
    name: isCustom ? '' : inbound.name || '',
    port: isCustom ? '' : inbound.port || 'random',
    sni: isCustom || !hasSni(inbound.type) ? '' : inbound.sni || 'random',
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
  };
};

export type { CountryOption, Domain, InboundConfigUI, Tunnel };
