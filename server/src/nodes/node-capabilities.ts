import {
  INBOUND_TYPES,
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
const HYSTERIA2_MIN_XRAY_VERSION = [26, 3, 27] as const;

export function buildNodeCapabilities(
  input: NodeCapabilityInput,
): NodeCapabilities {
  const supportedInboundTypes = INBOUND_TYPES.filter((type) =>
    supportsInboundType(type, input),
  );
  const warnings: string[] = [];

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
  if (type === 'hysteria2-udp') {
    return versionAtLeast(input.xrayVersion, HYSTERIA2_MIN_XRAY_VERSION);
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
