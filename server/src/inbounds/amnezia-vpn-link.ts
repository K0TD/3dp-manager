import { deflateSync, inflateSync } from 'zlib';

const VPN_PREFIX = 'vpn://';
const AMNEZIA_CONTAINER = 'amnezia-awg2';
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const AWG_FIELDS = [
  'Jc',
  'Jmin',
  'Jmax',
  'S1',
  'S2',
  'S3',
  'S4',
  'H1',
  'H2',
  'H3',
  'H4',
  'I1',
  'I2',
  'I3',
  'I4',
  'I5',
  'HeaderProtectionKey',
  'ContentPaddingAddition',
  'RekeyAfterTime',
  'RekeyTimeout',
  'RejectAfterTime',
  'KeepaliveTimeout',
  'MaxHandshakeAttempts',
  'RandomTrailers',
  'DisableCookies',
] as const;

type JsonObject = Record<string, unknown>;

export interface AmneziaVpnLinkInput {
  config: string;
  description: string;
  clientPublicKey?: string;
}

interface DecodedAmneziaPayload {
  root: JsonObject;
  protocol: JsonObject;
  lastConfig: JsonObject;
}

function configField(config: string, field: string): string {
  const match = new RegExp(`^${field}\\s*=\\s*(.+)$`, 'mi').exec(config);
  return match?.[1].trim() ?? '';
}

function awgFields(config: string): JsonObject {
  return Object.fromEntries(
    AWG_FIELDS.map((field) => [field, configField(config, field)]).filter(
      ([, fieldValue]) => fieldValue.length > 0,
    ),
  ) as JsonObject;
}

function endpointParts(config: string): { host: string; port: number } {
  const endpoint = configField(config, 'Endpoint');
  const match = /^(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(endpoint);
  return {
    host: match?.[1] ?? match?.[2] ?? '',
    port: Number(match?.[3] ?? 0),
  };
}

function qCompress(jsonText: string): Buffer {
  const source = Buffer.from(jsonText, 'utf8');
  const sizeHeader = Buffer.allocUnsafe(4);
  sizeHeader.writeUInt32BE(source.length);
  return Buffer.concat([sizeHeader, deflateSync(source, { level: 8 })]);
}

function encodePayload(root: JsonObject): string {
  return `${VPN_PREFIX}${qCompress(JSON.stringify(root)).toString('base64url')}`;
}

function lastConfigFor(input: AmneziaVpnLinkInput): JsonObject {
  const { host, port } = endpointParts(input.config);
  const allowedIps = configField(input.config, 'AllowedIPs')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  return {
    ...awgFields(input.config),
    config: input.config,
    hostName: host,
    port,
    client_ip: configField(input.config, 'Address'),
    client_priv_key: configField(input.config, 'PrivateKey'),
    client_pub_key: input.clientPublicKey ?? '',
    clientId: input.clientPublicKey ?? '',
    server_pub_key: configField(input.config, 'PublicKey'),
    psk_key: configField(input.config, 'PresharedKey'),
    allowed_ips: allowedIps,
    persistent_keep_alive: configField(input.config, 'PersistentKeepalive'),
    mtu: configField(input.config, 'MTU'),
    transport_proto: 'udp',
  };
}

export function createAmneziaVpnLink(input: AmneziaVpnLinkInput): string {
  const lastConfig = lastConfigFor(input);
  const { host, port } = endpointParts(input.config);
  const protocol = {
    ...awgFields(input.config),
    port: String(port),
    transport_proto: 'udp',
    protocol_version: '3.1',
    isThirdPartyConfig: true,
    last_config: JSON.stringify(lastConfig),
  };
  return encodePayload({
    containers: [{ container: AMNEZIA_CONTAINER, awg: protocol }],
    defaultContainer: AMNEZIA_CONTAINER,
    description: input.description,
    hostName: host,
    dns1: configField(input.config, 'DNS').split(',')[0]?.trim() ?? '',
    dns2: configField(input.config, 'DNS').split(',')[1]?.trim() ?? '',
  });
}

function jsonObject(jsonText: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(jsonText);
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function isZlibDataError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return typeof error.code === 'string' && error.code.startsWith('Z_');
}

/** Returns null when an external vpn:// payload is malformed or unsupported. */
function compressedPayload(encodedPayload: Buffer): JsonObject | null {
  if (encodedPayload.length < 5) return null;
  const declaredSize = encodedPayload.readUInt32BE(0);
  if (declaredSize === 0 || declaredSize > MAX_PAYLOAD_BYTES) return null;
  try {
    const jsonBytes = inflateSync(encodedPayload.subarray(4), {
      maxOutputLength: MAX_PAYLOAD_BYTES,
    });
    if (jsonBytes.length !== declaredSize) return null;
    return jsonObject(jsonBytes.toString('utf8'));
  } catch (error) {
    if (isZlibDataError(error)) return null;
    throw error;
  }
}

function decodedPayload(link: string): DecodedAmneziaPayload | null {
  if (!link.startsWith(VPN_PREFIX)) return null;
  const encodedPayload = Buffer.from(
    link.slice(VPN_PREFIX.length),
    'base64url',
  );
  const root = compressedPayload(encodedPayload);
  const containers = root?.containers;
  if (!Array.isArray(containers)) return null;
  const container: unknown = (containers as unknown[])[0];
  if (!container || typeof container !== 'object') return null;
  const protocol = (container as JsonObject).awg;
  if (!protocol || typeof protocol !== 'object') return null;
  const lastConfigText = (protocol as JsonObject).last_config;
  if (typeof lastConfigText !== 'string') return null;
  const lastConfig = jsonObject(lastConfigText);
  return lastConfig
    ? { root, protocol: protocol as JsonObject, lastConfig }
    : null;
}

function legacyConfig(link: string): string | null {
  if (!link.startsWith(VPN_PREFIX)) return null;
  const config = Buffer.from(
    link.slice(VPN_PREFIX.length),
    'base64url',
  ).toString('utf8');
  return config.startsWith('[Interface]') ? config : null;
}

export function amneziaConfigFromLink(link: string): string | null {
  const officialConfig = decodedPayload(link)?.lastConfig.config;
  return typeof officialConfig === 'string'
    ? officialConfig
    : legacyConfig(link);
}

function configWithName(config: string, description: string): string {
  const safeDescription = description.replace(/[\r\n#]+/g, ' ').trim();
  const name = safeDescription || 'subscription';
  return config.includes('\n# ')
    ? config.replace(/\n# [^\r\n]*\r?\n\[Peer\]/, `\n# ${name}\n[Peer]`)
    : config.replace(/\r?\n\[Peer\]/, `\n# ${name}\n[Peer]`);
}

export function renameAmneziaVpnLink(
  link: string,
  description: string,
): string {
  const decoded = decodedPayload(link);
  if (!decoded) {
    const config = legacyConfig(link);
    return config
      ? createAmneziaVpnLink({
          config: configWithName(config, description),
          description,
        })
      : link;
  }
  decoded.root.description = description;
  const config = decoded.lastConfig.config;
  if (typeof config === 'string') {
    decoded.lastConfig.config = configWithName(config, description);
  }
  decoded.protocol.last_config = JSON.stringify(decoded.lastConfig);
  return encodePayload(decoded.root);
}

export function patchAmneziaVpnEndpoint(link: string, newHost: string): string {
  const config = amneziaConfigFromLink(link);
  if (!config) return link;
  const relayHost = newHost.includes(':') ? `[${newHost}]` : newHost;
  const patchedConfig = config.replace(
    /^(Endpoint\s*=\s*)(?:\[[^\]]+\]|[^:\r\n]+):(\d+)\s*$/m,
    `$1${relayHost}:$2`,
  );
  if (patchedConfig === config) return link;
  const decoded = decodedPayload(link);
  return createAmneziaVpnLink({
    config: patchedConfig,
    description:
      typeof decoded?.root.description === 'string'
        ? decoded.root.description
        : 'AmneziaWG',
    clientPublicKey:
      typeof decoded?.lastConfig.client_pub_key === 'string'
        ? decoded.lastConfig.client_pub_key
        : undefined,
  });
}
