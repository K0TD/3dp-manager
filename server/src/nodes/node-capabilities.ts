import {
  INBOUND_TYPES,
  ROUTING_INBOUND_TYPES,
  InboundType,
} from '../subscriptions/inbound-config.constants';

export interface NodeCapabilities {
  supportedInboundTypes: InboundType[];
  autoTlsCertificate: boolean;
  warnings: string[];
}

interface NodeCapabilityInput {
  panelVersion?: string;
  xrayVersion?: string;
  autoTlsCertificate: boolean;
}

const AMNEZIAWG_MIN_PANEL_VERSION = [3, 7, 0] as const;
const MTPROTO_MULTI_CLIENT_MIN_PANEL_VERSION = [3, 5, 0] as const;
// Conservative client profile: the installed Xray 26.9.9 rejects public
// VLESS outbounds without TLS/REALITY or VLESS encryption.
const ENCRYPTED_VLESS_CLIENT_VERSION = [26, 9, 9] as const;
const HYSTERIA2_MIN_XRAY_VERSION = [26, 3, 27] as const;
const XHTTP_MIN_XRAY_VERSION = [24, 11, 30] as const;
const SELF_SNI_MIN_XRAY_VERSION = [1, 8, 0] as const;
const WIREGUARD_MULTI_CLIENT_MIN_PANEL_VERSION = [3, 5, 0] as const;

export function buildNodeCapabilities(
  input: NodeCapabilityInput,
): NodeCapabilities {
  const supportedInboundTypes = INBOUND_TYPES.filter(
    (type) =>
      !ROUTING_INBOUND_TYPES.has(type) && supportsInboundType(type, input),
  );
  const warnings: string[] = [];

  if (!supportsInboundType('vless-ws', input)) {
    warnings.push(
      'VLESS WS без TLS несовместим с клиентом Xray 26.9.9+; используйте VLESS WS TLS',
    );
  }
  if (!supportsInboundType('vless-xhttp-get', input)) {
    warnings.push(
      'VLESS XHTTP GET без TLS/REALITY несовместим с клиентом Xray 26.9.9+; используйте XHTTP Stable, VLESS XHTTP Reality или VLESS XHTTP TLS',
    );
  }

  if (!input.panelVersion) {
    warnings.push('Версия 3x-ui не определена; новые протоколы отключены');
  }
  if (!input.xrayVersion) {
    warnings.push('Версия Xray не определена; Hysteria2 отключена');
  }
  if (!input.autoTlsCertificate) {
    warnings.push(
      'Нода не предоставила пути TLS-сертификата; используйте свои пути',
    );
  }

  return {
    supportedInboundTypes,
    autoTlsCertificate: input.autoTlsCertificate,
    warnings,
  };
}

export function supportsInboundType(
  type: InboundType,
  input: NodeCapabilityInput,
): boolean {
  if (type === 'vless-ws' || type === 'vless-xhttp-get') {
    return !versionAtLeast(input.xrayVersion, ENCRYPTED_VLESS_CLIENT_VERSION);
  }
  if (type === 'amneziawg') {
    return (
      isDevelopmentVersion(input.panelVersion) ||
      versionAtLeast(input.panelVersion, AMNEZIAWG_MIN_PANEL_VERSION)
    );
  }
  if (type === 'mtproto-faketls') {
    return (
      isDevelopmentVersion(input.panelVersion) ||
      versionAtLeast(input.panelVersion, MTPROTO_MULTI_CLIENT_MIN_PANEL_VERSION)
    );
  }
  if (type === 'wireguard' || type === 'mixed' || type === 'socks') {
    return (
      isDevelopmentVersion(input.panelVersion) ||
      versionAtLeast(
        input.panelVersion,
        WIREGUARD_MULTI_CLIENT_MIN_PANEL_VERSION,
      )
    );
  }
  if (type === 'hysteria2-udp') {
    return versionAtLeast(input.xrayVersion, HYSTERIA2_MIN_XRAY_VERSION);
  }
  if (type === 'xhttp-stable' || type === 'https-fallback') {
    return versionAtLeast(input.xrayVersion, XHTTP_MIN_XRAY_VERSION);
  }
  if (type === 'self-sni') {
    return versionAtLeast(input.xrayVersion, SELF_SNI_MIN_XRAY_VERSION);
  }
  return true;
}

function isDevelopmentVersion(version?: string) {
  return version?.trim().toLowerCase().startsWith('dev+') === true;
}

function versionAtLeast(
  version: string | undefined,
  minimum: readonly [number, number, number],
) {
  const parsed = parseVersion(version);
  if (!parsed) return false;

  for (let index = 0; index < minimum.length; index += 1) {
    if (parsed[index] !== minimum[index]) {
      return parsed[index] > minimum[index];
    }
  }
  return true;
}

function parseVersion(version?: string): [number, number, number] | null {
  const match = version?.trim().match(/v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
