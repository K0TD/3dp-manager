import { InboundBuilderService } from 'src/inbounds/inbound-builder.service';
import { amneziaConfigFromLink } from 'src/inbounds/amnezia-vpn-link';
import {
  buildProxyLink, patchConnectionHost, proxyConnectionFromLink, wireguardConfigFromLink,
} from 'src/inbounds/connection-profiles';
import { verifyInboundAccess } from 'src/xui/xui-contract';
import { generateSubscriptionHtmlWithQr } from 'src/client/templates/subscription.template';

describe('manual connection profiles', () => {
  const builder = new InboundBuilderService();

  it('exports the saved WireGuard identity, address and preshared key into a relay-safe profile', () => {
    const inbound = builder.buildWireguardInbound({ port: 51820, uuid: 'wg-client' });
    const settings = JSON.parse(inbound.settings);
    const link = builder.buildInboundLink(inbound, 'example.com', '', '');
    const config = wireguardConfigFromLink(patchConnectionHost(link, '2001:db8::1'));
    expect(config).toContain(`PrivateKey = ${settings.clients[0].privateKey}`);
    expect(config).toContain(`PresharedKey = ${settings.clients[0].preSharedKey}`);
    expect(config).toContain('Address = 10.9.0.2/32, fd42:3d70::2/128');
    expect(config).toContain('Endpoint = [2001:db8::1]:51820');
    expect(config).toContain('AllowedIPs = 0.0.0.0/0, ::/0');
    expect(config).not.toContain(settings.secretKey);
    const malformed = new URL(link);
    malformed.searchParams.set('address', '10.9.0.2/32\nPostUp = arbitrary');
    expect(wireguardConfigFromLink(malformed.toString())).toBeNull();
  });

  it.each(['mixed', 'http', 'socks'] as const)('exports %s credentials with punctuation, default ports and IPv6', (protocol) => {
    const inbound = builder.buildProxyInbound({ port: 80, protocol });
    const account = { user: 'user:@/?', pass: 'password<&"%:' };
    inbound.settings = JSON.stringify({ auth: 'password', accounts: [account] });
    const link = buildProxyLink({ ...inbound, protocol }, '2001:db8::2');
    expect(proxyConnectionFromLink(link)).toEqual({ type: protocol, host: '2001:db8::2', port: 80,
      username: account.user, password: account.pass });
    expect(proxyConnectionFromLink(patchConnectionHost(link, 'relay.example.com'))?.host).toBe('relay.example.com');
    expect(() => verifyInboundAccess(inbound)).not.toThrow();
    inbound.settings = JSON.stringify({ auth: 'noauth', accounts: [] });
    expect(() => verifyInboundAccess(inbound)).toThrow('authenticated accounts');
  });

  it('reserves MTU headroom for both transport and content padding', () => {
    for (let index = 0; index < 25; index++) {
      const inbound = builder.buildAmneziaWgInbound({ port: 51820, uuid: 'awg-client' });
      const { server } = JSON.parse(inbound.settings);
      const padding = Number(server.contentPaddingAddition.split('-').at(-1));
      expect(server.mtu + server.s4 + padding).toBeLessThanOrEqual(1420);
      expect(server.routeThroughXray).toBeUndefined();
      expect(server.awgVersion).toBe('3');
      const config = amneziaConfigFromLink(builder.buildInboundLink(inbound, 'example.com', '', ''));
      expect(config).toContain(`MTU = ${server.mtu}`);
    }
  });

  it('rejects a panel that saves MTProto without a working Xray bridge', () => {
    const inbound = builder.buildMtprotoInbound({ port: 8443, uuid: 'tg-client', fakeTlsDomain: 'www.cloudflare.com' });
    expect(() => verifyInboundAccess(inbound)).toThrow('MTProto bridge');
    const settings = JSON.parse(inbound.settings);
    settings.routeXrayPort = 50000;
    inbound.settings = JSON.stringify(settings);
    expect(() => verifyInboundAccess(inbound)).not.toThrow();
  });

  it('renders escaped proxy credentials and a WireGuard download when no regular subscription exists', () => {
    const wireguard = builder.buildWireguardInbound({ port: 51820, uuid: 'client' });
    const html = generateSubscriptionHtmlWithQr({
      currentUrl: 'https://example.com/bus/private', qrDataUrl: '', subscriptionName: 'Test',
      subscriptionLinks: [], amneziaLinks: [], telegramProxyLinks: [],
      wireguardLinks: [builder.buildInboundLink(wireguard, 'example.com', '', '')],
      proxyConnections: [{ type: 'mixed', host: 'example.com', port: 8080, username: 'user', password: '<script>bad</script>' }],
    });
    expect(html).toContain('format=wireguard');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(html).not.toContain('<script>bad</script>');
    expect(html).not.toContain('Активных подключений пока нет');
  });
});
