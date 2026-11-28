import { deflateSync } from 'zlib';
import {
  patchClientProfileJsonAddress,
  patchInboundLinkHost,
} from 'src/inbounds/inbound-endpoint.util';

describe('inbound-endpoint.util', () => {
  it('patches VLESS, Trojan, Hysteria2, and Shadowsocks hosts while preserving params and fragment', () => {
    const vless =
      'vless://11111111-1111-4111-8111-111111111111@old.example.com:443?type=xhttp&security=reality&sni=swdist.apple.com#Node%201';
    expect(patchInboundLinkHost(vless, 'new.example.com')).toBe(
      'vless://11111111-1111-4111-8111-111111111111@new.example.com:443?type=xhttp&security=reality&sni=swdist.apple.com#Node%201',
    );
    expect(patchInboundLinkHost(vless, '2001:db8::5')).toBe(
      'vless://11111111-1111-4111-8111-111111111111@[2001:db8::5]:443?type=xhttp&security=reality&sni=swdist.apple.com#Node%201',
    );

    const trojan =
      'trojan://pass%21@old.example.com:8443?security=reality#Trojan';
    expect(patchInboundLinkHost(trojan, '203.0.113.9')).toBe(
      'trojan://pass%21@203.0.113.9:8443?security=reality#Trojan',
    );

    const hy2 = 'hy2://user:pass@old.example.com:443/?sni=old.example.com#Hy2';
    expect(patchInboundLinkHost(hy2, '198.51.100.7')).toBe(
      'hy2://user:pass@198.51.100.7:443/?sni=old.example.com#Hy2',
    );

    const ss = 'ss://YWVzLTI1Ni1nY206c2VjcmV0@old.example.com:8388#SS';
    expect(patchInboundLinkHost(ss, 'new.ss.example')).toBe(
      'ss://YWVzLTI1Ni1nY206c2VjcmV0@new.ss.example:8388#SS',
    );

    const ssCompact = 'ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpwYXNz#Legacy';
    expect(patchInboundLinkHost(ssCompact, 'new.ss.example')).toBe(ssCompact);
  });

  it('patches VMess JSON add field cleanly', () => {
    const payload = {
      v: '2',
      ps: 'VMess',
      add: 'old.host',
      port: '443',
      id: 'uuid',
    };
    const link = `vmess://${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`;

    const patched = patchInboundLinkHost(link, '203.0.113.10');
    expect(patched.startsWith('vmess://')).toBe(true);
    const decoded = JSON.parse(
      Buffer.from(patched.slice('vmess://'.length), 'base64').toString('utf8'),
    ) as { add: string; port: string };
    expect(decoded.add).toBe('203.0.113.10');
    expect(decoded.port).toBe('443');
  });

  it('patches tg://proxy, wireguard/socks5, and vpn:// AmneziaWG links', () => {
    expect(
      patchInboundLinkHost(
        'tg://proxy?server=old.host&port=443&secret=ee12',
        '1.2.3.4',
      ),
    ).toBe('tg://proxy?server=1.2.3.4&port=443&secret=ee12');

    expect(
      patchInboundLinkHost('socks5://user:pass@old.host:1080', '1.2.3.4'),
    ).toBe('socks5://user:pass@1.2.3.4:1080');

    const lastConfig = {
      hostName: 'old.host',
      port: 51820,
      config:
        '[Interface]\nPrivateKey = A\n\n[Peer]\nPublicKey = B\nEndpoint = old.host:51820\n',
    };
    const root = {
      description: 'awg',
      hostName: 'old.host',
      port: 51820,
      containers: [
        {
          container: 'amnezia-awg2',
          awg: { last_config: JSON.stringify(lastConfig) },
        },
      ],
    };
    const src = Buffer.from(JSON.stringify(root), 'utf8');
    const hdr = Buffer.allocUnsafe(4);
    hdr.writeUInt32BE(src.length);
    const vpnLink = `vpn://${Buffer.concat([hdr, deflateSync(src)]).toString('base64url')}`;

    const patchedVpn = patchInboundLinkHost(vpnLink, '9.8.7.6');
    expect(patchedVpn).not.toBe(vpnLink);
    expect(patchedVpn.startsWith('vpn://')).toBe(true);
  });

  it('patches address in clientProfileJson when present', () => {
    const raw = JSON.stringify({
      kind: 'xhttp-stable',
      address: 'old.example.com',
      port: 443,
      sni: 'www.samsung.com',
    });
    const patched = patchClientProfileJsonAddress(raw, '198.51.100.22');
    expect(JSON.parse(patched ?? '{}')).toMatchObject({
      address: '198.51.100.22',
      sni: 'www.samsung.com',
    });
    expect(patchClientProfileJsonAddress(null, '198.51.100.22')).toBeNull();
  });
});
