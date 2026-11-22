import {
  buildXhttpStableExportBundle,
  buildXhttpStableServerInbound,
  buildXrayClientJsonFromSubscriptionInbounds,
  sanitizeServerInboundPreview,
} from 'src/profiles/profile-config.builder';

describe('profile-config.builder (XHTTP Stable)', () => {
  const baseServerParams = {
    port: 443,
    uuid: '11111111-2222-4333-8444-555555555555',
    email: 'user@example.com',
    remark: 'xhttp-main',
    sni: 'www.microsoft.com',
    privateKey: 'SUPER_SECRET_REALITY_PRIVATE_KEY',
    publicKey: 'PUBLIC_KEY_BASE64',
    shortIds: ['deadbeef'],
  };

  it('builds a minimal server inbound by default without client XMUX or Vision flow', () => {
    const inbound = buildXhttpStableServerInbound(baseServerParams);
    const settings = JSON.parse(inbound.settings) as {
      clients: Array<{ id: string; flow: string }>;
    };
    const stream = JSON.parse(inbound.streamSettings) as {
      network: string;
      security: string;
      realitySettings: {
        dest: string;
        serverNames: string[];
        privateKey: string;
        settings: { publicKey: string; fingerprint: string; spiderX: string };
      };
      xhttpSettings: Record<string, unknown>;
    };

    expect(inbound.protocol).toBe('vless');
    expect(settings.clients[0]).toMatchObject({
      id: baseServerParams.uuid,
      flow: '',
    });
    expect(stream.network).toBe('xhttp');
    expect(stream.security).toBe('reality');
    expect(stream.realitySettings.dest).toBe('www.microsoft.com:443');
    expect(stream.realitySettings.serverNames).toEqual(['www.microsoft.com']);
    expect(stream.xhttpSettings).toEqual({
      path: '/',
      host: 'www.microsoft.com',
      mode: 'auto',
    });
    expect(stream.xhttpSettings).not.toHaveProperty('xmux');
    expect(stream.xhttpSettings).not.toHaveProperty('scMaxBufferedPosts');
    expect(stream.xhttpSettings).not.toHaveProperty('xPaddingBytes');
  });

  it('keeps XMUX strictly client-only and supports auto, stream-one, and packet-up modes', () => {
    for (const mode of ['auto', 'stream-one', 'packet-up'] as const) {
      const profileSettings = {
        mode,
        path: '/cdn/assets',
        host: 'edge.example.com',
        fingerprint: 'firefox' as const,
        spiderX: '/updates/',
        xmux: {
          enabled: true,
          maxConcurrency: '16-32',
          cMaxReuseTimes: '0',
          hMaxRequestTimes: '600-900',
          hKeepAlivePeriod: 60,
        },
      };

      const serverInbound = buildXhttpStableServerInbound({
        ...baseServerParams,
        settings: profileSettings,
      });
      const serverStream = JSON.parse(serverInbound.streamSettings) as {
        xhttpSettings: Record<string, unknown>;
      };
      expect(serverStream.xhttpSettings).toEqual({
        path: '/cdn/assets',
        host: 'edge.example.com',
        mode,
      });
      expect(serverStream.xhttpSettings).not.toHaveProperty('xmux');

      const bundle = buildXhttpStableExportBundle({
        address: '203.0.113.10',
        port: 443,
        uuid: baseServerParams.uuid,
        remark: 'xhttp-main',
        sni: 'www.microsoft.com',
        publicKey: baseServerParams.publicKey,
        shortId: 'deadbeef',
        settings: profileSettings,
      });

      const parsedUrl = new URL(bundle.vlessLink);
      expect(parsedUrl.searchParams.get('type')).toBe('xhttp');
      expect(parsedUrl.searchParams.get('security')).toBe('reality');
      expect(parsedUrl.searchParams.get('mode')).toBe(mode);
      expect(parsedUrl.searchParams.get('fp')).toBe('firefox');
      expect(parsedUrl.searchParams.get('path')).toBe('/cdn/assets');
      expect(parsedUrl.searchParams.get('host')).toBe('edge.example.com');
      expect(parsedUrl.searchParams.get('flow')).toBeNull();
      expect(JSON.parse(parsedUrl.searchParams.get('extra') || '{}')).toEqual({
        xmux: {
          maxConcurrency: '16-32',
          cMaxReuseTimes: '0',
          hMaxRequestTimes: '600-900',
          hKeepAlivePeriod: 60,
        },
      });

      const jsonText = JSON.stringify(bundle.xrayClientJson);
      expect(jsonText).not.toContain('SUPER_SECRET_REALITY_PRIVATE_KEY');
      expect(jsonText).not.toContain('privateKey');
      const outbound = bundle.xrayClientJson.outbounds[0] as {
        streamSettings: {
          xhttpSettings: { mode: string; extra?: { xmux?: unknown } };
        };
      };
      expect(outbound.streamSettings.xhttpSettings.mode).toBe(mode);
      expect(outbound.streamSettings.xhttpSettings.extra?.xmux).toEqual({
        maxConcurrency: '16-32',
        cMaxReuseTimes: '0',
        hMaxRequestTimes: '600-900',
        hKeepAlivePeriod: 60,
      });
    }
  });

  it('omits extra from VLESS link and Xray JSON when minimal default configuration is used', () => {
    const bundle = buildXhttpStableExportBundle({
      address: '203.0.113.10',
      port: 8443,
      uuid: baseServerParams.uuid,
      remark: 'minimal',
      sni: 'www.microsoft.com',
      publicKey: baseServerParams.publicKey,
      shortId: 'deadbeef',
    });

    const parsedUrl = new URL(bundle.vlessLink);
    expect(parsedUrl.searchParams.get('extra')).toBeNull();
    expect(parsedUrl.searchParams.get('mode')).toBe('auto');
    expect(parsedUrl.searchParams.get('path')).toBe('/');
    const outbound = bundle.xrayClientJson.outbounds[0] as {
      streamSettings: { xhttpSettings: Record<string, unknown> };
    };
    expect(outbound.streamSettings.xhttpSettings).not.toHaveProperty('extra');
  });

  it('redacts server private keys in server preview', () => {
    const inbound = buildXhttpStableServerInbound(baseServerParams);
    const preview = sanitizeServerInboundPreview(inbound);
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain('SUPER_SECRET_REALITY_PRIVATE_KEY');
    expect(serialized).toContain('<server-only:redacted>');
  });

  it('builds a multi-outbound Xray JSON bundle from subscription inbounds with optional relay host override', () => {
    const bundle = buildXhttpStableExportBundle({
      address: '203.0.113.10',
      port: 443,
      uuid: baseServerParams.uuid,
      remark: 'xhttp-main',
      sni: 'www.microsoft.com',
      publicKey: baseServerParams.publicKey,
      shortId: 'deadbeef',
      settings: {
        mode: 'stream-one',
        xmux: { enabled: true, maxConnections: '4-8' },
      },
    });

    const xrayJson = buildXrayClientJsonFromSubscriptionInbounds(
      [
        {
          remark: 'xhttp-main',
          link: bundle.vlessLink,
          clientProfileJson: JSON.stringify(bundle.clientConfig),
        },
        {
          remark: 'legacy-tcp',
          link: 'vless://aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee@203.0.113.10:8443?type=tcp&security=reality&pbk=PUB&fp=chrome&sni=ya.ru&sid=1234&flow=xtls-rprx-vision#legacy',
        },
      ],
      'relay.example.net',
    );

    expect(xrayJson.outbounds).toHaveLength(4); // 2 proxies + direct + block
    const firstVnext = (
      xrayJson.outbounds[0].settings as {
        vnext: Array<{ address: string; port: number }>;
      }
    ).vnext[0];
    expect(firstVnext.address).toBe('relay.example.net');
    const secondVnext = (
      xrayJson.outbounds[1].settings as {
        vnext: Array<{ address: string; port: number }>;
      }
    ).vnext[0];
    expect(secondVnext.address).toBe('relay.example.net');
  });
});
