import { inflateSync } from 'zlib';
import {
  amneziaConfigFromLink,
  createAmneziaVpnLink,
  patchAmneziaVpnEndpoint,
  renameAmneziaVpnLink,
} from 'src/inbounds/amnezia-vpn-link';

const config = `[Interface]
PrivateKey = private-key
Address = 10.8.1.2/32
DNS = 8.8.8.8, 8.8.4.4
MTU = 1393
Jc = 4
Jmin = 40
Jmax = 90
S1 = 15
S2 = 16
S3 = 17
S4 = 18
H1 = 1
H2 = 2
H3 = 3
H4 = 4
HeaderProtectionKey = header-key
RandomTrailers = on
DisableCookies = on

# old name
[Peer]
PublicKey = server-key
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = example.com:51820
PersistentKeepalive = 25`;

function decodedRoot(link: string) {
  const compressed = Buffer.from(link.slice('vpn://'.length), 'base64url');
  const jsonBytes = inflateSync(compressed.subarray(4));
  expect(compressed.readUInt32BE(0)).toBe(jsonBytes.length);
  return JSON.parse(jsonBytes.toString('utf8')) as {
    description: string;
    defaultContainer: string;
    containers: Array<{
      container: string;
      awg: { protocol_version: string; last_config: string };
    }>;
  };
}

describe('AmneziaVPN link', () => {
  it('создаёт официальный qCompress vpn payload со всеми AWG-параметрами', () => {
    const link = createAmneziaVpnLink({
      config,
      description: 'Рабочая подписка',
      clientPublicKey: 'client-key',
    });
    const root = decodedRoot(link);
    const protocol = root.containers[0].awg;
    const lastConfig = JSON.parse(protocol.last_config) as Record<
      string,
      unknown
    >;

    expect(root).toMatchObject({
      description: 'Рабочая подписка',
      defaultContainer: 'amnezia-awg2',
    });
    expect(root.containers[0].container).toBe('amnezia-awg2');
    expect(protocol.protocol_version).toBe('3.1');
    expect(lastConfig).toMatchObject({
      Jc: '4',
      S4: '18',
      HeaderProtectionKey: 'header-key',
      client_pub_key: 'client-key',
      hostName: 'example.com',
      port: 51820,
      config,
    });
    expect(amneziaConfigFromLink(link)).toBe(config);
  });

  it('обновляет название и конвертирует старую plain-base64 ссылку', () => {
    const legacyLink = `vpn://${Buffer.from(config).toString('base64url')}`;
    const renamedLink = renameAmneziaVpnLink(legacyLink, 'Личная подписка');

    expect(decodedRoot(renamedLink).description).toBe('Личная подписка');
    expect(amneziaConfigFromLink(renamedLink)).toContain(
      '# Личная подписка\n[Peer]',
    );
  });

  it('обновляет endpoint внутри официальной ссылки', () => {
    const link = createAmneziaVpnLink({ config, description: 'Работа' });
    const patchedLink = patchAmneziaVpnEndpoint(link, '2001:db8::1');

    expect(amneziaConfigFromLink(patchedLink)).toContain(
      'Endpoint = [2001:db8::1]:51820',
    );
  });

  it('отклоняет повреждённый payload', () => {
    expect(amneziaConfigFromLink('vpn://not-a-valid-payload')).toBeNull();
  });
});
