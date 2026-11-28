/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { Test, TestingModule } from '@nestjs/testing';
import { InboundBuilderService } from 'src/inbounds/inbound-builder.service';
import { amneziaConfigFromLink } from 'src/inbounds/amnezia-vpn-link';

// Mock crypto.randomBytes для детерминированных тестов
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn((size: number) => {
    if (size === 32) return Buffer.alloc(32, 0xab);
    if (size === 16) return Buffer.alloc(16, 0xcd);
    return Buffer.from('abcd1234', 'hex');
  }),
  randomInt: jest.fn((min: number, _max: number) => min),
  randomFillSync: jest.fn((buffer: Buffer) => {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = i;
    }
    return buffer;
  }),
}));

describe('InboundBuilderService', () => {
  let service: InboundBuilderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InboundBuilderService],
    }).compile();

    service = module.get<InboundBuilderService>(InboundBuilderService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('builds XHTTP GET and carries only client-safe extra settings into the link', () => {
    const inbound = service.buildVlessXhttpGet({
      port: 8443,
      uuid: 'client-id',
      email: 'mail',
    });
    const stream = JSON.parse(inbound.streamSettings);
    expect(stream).toMatchObject({
      network: 'xhttp',
      security: 'none',
      xhttpSettings: { mode: 'packet-up', uplinkHTTPMethod: 'GET' },
    });
    expect(JSON.parse(inbound.settings).clients[0]).toMatchObject({
      id: 'client-id',
      email: 'mail',
    });
    expect(JSON.parse(inbound.settings).clients[0]).not.toHaveProperty('tgId');
    const link = new URL(
      service.buildInboundLink(inbound, 'relay.example', '', 'flag'),
    );
    expect(link.hostname).toBe('relay.example');
    expect(link.searchParams.get('mode')).toBe('packet-up');
    expect(link.searchParams.get('path')).toBe(stream.xhttpSettings.path);
    const extra = JSON.parse(link.searchParams.get('extra') || '{}');
    expect(extra).not.toHaveProperty('path');
    expect(extra).not.toHaveProperty('host');
    expect(extra).not.toHaveProperty('mode');
    expect(extra).not.toHaveProperty('noSSEHeader');
    expect(extra).not.toHaveProperty('scMaxBufferedPosts');
    expect(extra).not.toHaveProperty('scStreamUpServerSecs');
    expect(extra).not.toHaveProperty('serverMaxHeaderBytes');
    expect(extra).toMatchObject({
      xPaddingBytes: stream.xhttpSettings.xPaddingBytes,
      uplinkHTTPMethod: 'GET',
      scMaxEachPostBytes: '500000-1000000',
      xmux: stream.xhttpSettings.xmux,
    });
  });

  it('preserves existing XHTTP Reality and TLS parameters and omits server-only extra fields', () => {
    const realityInbound = service.buildVlessRealityXhttp({
      port: 443,
      uuid: 'client-id',
      sni: 'swdist.apple.com',
      privateKey: 'private',
      publicKey: 'public',
    });
    const realityStream = JSON.parse(realityInbound.streamSettings);
    const realityUrl = new URL(
      service.buildInboundLink(realityInbound, 'node.example', '', 'flag'),
    );
    expect(realityUrl.searchParams.get('path')).toBe(
      realityStream.xhttpSettings.path,
    );
    expect(realityUrl.searchParams.get('host')).toBe(
      realityStream.xhttpSettings.host,
    );
    expect(realityUrl.searchParams.get('mode')).toBe(
      realityStream.xhttpSettings.mode,
    );
    const realityExtra = JSON.parse(
      realityUrl.searchParams.get('extra') || '{}',
    );
    expect(realityExtra).toEqual({ xPaddingBytes: '500-1500' });

    const tlsInbound = service.buildVlessTlsXhttp({
      port: 443,
      uuid: 'client-id',
      serverName: 'example.com',
      certificateFile: '/cert',
      keyFile: '/key',
    });
    const tlsStream = JSON.parse(tlsInbound.streamSettings);
    const tlsUrl = new URL(
      service.buildInboundLink(tlsInbound, 'node.example', '', 'flag'),
    );
    expect(tlsUrl.searchParams.get('path')).toBe(tlsStream.xhttpSettings.path);
    expect(tlsUrl.searchParams.get('host')).toBe(tlsStream.xhttpSettings.host);
    expect(tlsUrl.searchParams.get('mode')).toBe(tlsStream.xhttpSettings.mode);
    expect(tlsUrl.searchParams.get('extra')).toBeNull();
  });

  describe('buildVlessRealityTcp', () => {
    const params = {
      port: 443,
      uuid: 'test-uuid-123',
      sni: 'ya.ru',
      privateKey: 'private-key',
      publicKey: 'public-key',
    };

    it('должен создать конфиг vless-tcp-reality', () => {
      const result = service.buildVlessRealityTcp(params);

      expect(result).toMatchObject({
        enable: true,
        port: 443,
        protocol: 'vless',
        remark: 'vless-tcp-reality',
      });

      const settings = JSON.parse(result.settings);
      expect(settings.clients[0].id).toBe('test-uuid-123');
      expect(settings.clients[0].flow).toBe('xtls-rprx-vision');
    });

    it('должен установить Reality настройки', () => {
      const result = service.buildVlessRealityTcp(params);

      const streamSettings = JSON.parse(result.streamSettings);
      expect(streamSettings.security).toBe('reality');
      expect(streamSettings.realitySettings.target).toBe('ya.ru:443');
      expect(streamSettings.realitySettings.serverNames).toContain('ya.ru');
      expect(streamSettings.realitySettings.privateKey).toBe('private-key');
    });

    it('должен сгенерировать shortIds', () => {
      const result = service.buildVlessRealityTcp(params);

      const streamSettings = JSON.parse(result.streamSettings);
      expect(streamSettings.realitySettings.shortIds).toHaveLength(2);
    });

    it('должен применять профиль SNI для известных сервисов (Apple)', () => {
      const result = service.buildVlessRealityTcp({
        ...params,
        sni: 'swdist.apple.com',
      });
      const streamSettings = JSON.parse(result.streamSettings);
      expect(streamSettings.realitySettings.settings.fingerprint).toBe(
        'safari',
      );
      expect(streamSettings.realitySettings.settings.spiderX).toBe(
        '/content/downloads/',
      );
      expect(streamSettings.realitySettings.serverNames).toEqual([
        'swdist.apple.com',
      ]);
    });
  });

  describe('buildAmneziaWgInbound', () => {
    it('создаёт валидный inbound и официальный vpn-конфиг', () => {
      const inbound = service.buildAmneziaWgInbound({
        port: 51820,
        uuid: 'client@example',
      });
      const settings = JSON.parse(inbound.settings);

      expect(inbound.protocol).toBe('amneziawg');
      expect(settings.server.awgVersion).toBe('3');
      expect(settings.server.routeThroughXray).toBeUndefined();
      expect(settings.server.privateKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
      expect(settings.server.publicKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
      expect(settings.clients[0].privateKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
      expect(settings.clients[0].allowedIPs).toEqual(['10.8.1.2/32']);
      expect(settings.server.randomTrailers).toBe(true);
      expect(settings.server.disableCookies).toBe(true);
      expect(settings.server.headerProtectionKey).toMatch(
        /^[A-Za-z0-9+/]{43}=$/,
      );

      const link = service.buildInboundLink(
        inbound,
        'example.com',
        '',
        '%F0%9F%92%AF',
      );
      expect(link.startsWith('vpn://')).toBe(true);
      const config = amneziaConfigFromLink(link);
      expect(config).not.toBeNull();
      if (!config) throw new Error('AmneziaVPN link has no config');
      expect(config).toContain('[Interface]');
      expect(config).toContain(
        `PrivateKey = ${settings.clients[0].privateKey}`,
      );
      expect(config).toContain(`PublicKey = ${settings.server.publicKey}`);
      expect(config).toContain('Endpoint = example.com:51820');
      for (const field of [
        'MTU',
        'Jc',
        'Jmin',
        'Jmax',
        'S1',
        'S2',
        'S3',
        'S4',
      ]) {
        expect(config).toMatch(new RegExp(`^${field} = \\d+$`, 'm'));
      }
      expect(config).not.toMatch(/^(?:MTU|Jc|Jmin|Jmax|S1|S2|S3|S4)\s*=\s*$/m);
    });

    it('генерирует безопасные параметры обфускации без коллизий размеров пакетов и с безопасным MTU', () => {
      for (let i = 0; i < 20; i++) {
        const inbound = service.buildAmneziaWgInbound({
          port: 51820 + i,
          uuid: `client-${i}@example`,
        });
        const settings = JSON.parse(inbound.settings);
        const { s1, s2, jc } = settings.server;
        expect(s1).not.toBe(s2);
        expect(s1 + 56).not.toBe(s2);
        expect(s2 + 56).not.toBe(s1);
        expect(jc).toBeGreaterThanOrEqual(2);
        expect(jc).toBeLessThanOrEqual(5);

        const link = service.buildInboundLink(inbound, 'example.com', '', '');
        const config = amneziaConfigFromLink(link);
        expect(config).not.toBeNull();
        const mtuMatch = config?.match(/^MTU = (\d+)$/m);
        expect(mtuMatch).not.toBeNull();
        const mtu = Number(mtuMatch?.[1]);
        expect(mtu).toBeGreaterThanOrEqual(1280);
        expect(mtu).toBeLessThanOrEqual(1360);
      }
    });

    it('вычисляет EffectiveMTU при нулевом/пустом mtu с учётом S4', () => {
      const base = service.buildAmneziaWgInbound({
        port: 51820,
        uuid: 'client@example',
      });
      const baseSettings = JSON.parse(base.settings);

      const highS4Settings = {
        ...baseSettings,
        server: { ...baseSettings.server, mtu: 0, s4: 24 },
      };
      const highS4Config = amneziaConfigFromLink(
        service.buildInboundLink(
          { ...base, settings: JSON.stringify(highS4Settings) },
          'example.com',
          '',
          '',
        ),
      );
      expect(highS4Config).toMatch(/^MTU = 1416$/m);

      const lowS4Settings = {
        ...baseSettings,
        server: { ...baseSettings.server, mtu: undefined, s4: 10 },
      };
      const lowS4Config = amneziaConfigFromLink(
        service.buildInboundLink(
          { ...base, settings: JSON.stringify(lowS4Settings) },
          'example.com',
          '',
          '',
        ),
      );
      expect(lowS4Config).toMatch(/^MTU = 1420$/m);
    });

    it('поддерживает диапазоны keepAlive, опускает нулевые/невалидные и опциональные S3/S4', () => {
      const base = service.buildAmneziaWgInbound({
        port: 51820,
        uuid: 'client@example',
      });
      const baseSettings = JSON.parse(base.settings);

      const rangeSettings = {
        ...baseSettings,
        server: { ...baseSettings.server, mtu: 0, s3: 0, s4: 0 },
        clients: [{ ...baseSettings.clients[0], keepAlive: '15-25' }],
      };
      const rangeConfig = amneziaConfigFromLink(
        service.buildInboundLink(
          { ...base, settings: JSON.stringify(rangeSettings) },
          'example.com',
          '',
          '',
        ),
      );
      expect(rangeConfig).toMatch(/^MTU = 1420$/m);
      expect(rangeConfig).toMatch(/^PersistentKeepalive = 15-25$/m);
      expect(rangeConfig).not.toMatch(/^S3\s*=/m);
      expect(rangeConfig).not.toMatch(/^S4\s*=/m);

      for (const keepAlive of ['0', 0, '25-15', 'invalid\nPostUp=id']) {
        const disabledSettings = {
          ...baseSettings,
          clients: [{ ...baseSettings.clients[0], keepAlive }],
        };
        const disabledConfig = amneziaConfigFromLink(
          service.buildInboundLink(
            { ...base, settings: JSON.stringify(disabledSettings) },
            'example.com',
            '',
            '',
          ),
        );
        expect(disabledConfig).not.toMatch(/^PersistentKeepalive\s*=/m);
      }
    });

    it('фильтрует routed LAN-подсети из Address по правилам TunnelAddresses', () => {
      const base = service.buildAmneziaWgInbound({
        port: 51820,
        uuid: 'client@example',
      });
      const baseSettings = JSON.parse(base.settings);
      const settings = {
        ...baseSettings,
        clients: [
          {
            ...baseSettings.clients[0],
            allowedIPs: [
              '10.8.1.5/32',
              '192.168.50.0/24',
              'fd86:ea04:1115::5/128',
              'fd86:ea04:1115:1::/64',
            ],
          },
        ],
      };
      const config = amneziaConfigFromLink(
        service.buildInboundLink(
          { ...base, settings: JSON.stringify(settings) },
          'example.com',
          '',
          '',
        ),
      );
      expect(config).toMatch(
        /^Address = 10\.8\.1\.5\/32, fd86:ea04:1115::5\/128$/m,
      );
    });
  });

  describe('buildMtprotoInbound', () => {
    it('создаёт multi-client FakeTLS inbound и ссылку Telegram', () => {
      const inbound = service.buildMtprotoInbound({
        port: 8443,
        uuid: 'client@example',
        fakeTlsDomain: 'WWW.Cloudflare.COM',
      });
      const settings = JSON.parse(inbound.settings);
      const secret = settings.clients[0].secret as string;

      expect(inbound).toMatchObject({
        enable: true,
        listen: '0.0.0.0',
        port: 8443,
        protocol: 'mtproto',
        remark: 'mtproto-faketls',
        streamSettings: '',
      });
      expect(settings.fakeTlsDomain).toBe('www.cloudflare.com');
      expect(settings.clients[0]).toMatchObject({
        email: 'client@example',
        enable: true,
        totalGB: 0,
        expiryTime: 0,
      });
      expect(secret).toMatch(/^ee[0-9a-f]{32}[0-9a-f]+$/);
      expect(
        secret.endsWith(
          Buffer.from('www.cloudflare.com', 'utf8').toString('hex'),
        ),
      ).toBe(true);

      const link = service.buildInboundLink(
        inbound,
        '203.0.113.10',
        secret,
        '%F0%9F%92%AF',
      );
      expect(link).toBe(
        `tg://proxy?server=203.0.113.10&port=8443&secret=${secret}`,
      );
      expect(link).not.toContain('#');
    });

    it('не формирует ссылку с некорректным секретом', () => {
      const inbound = service.buildMtprotoInbound({
        port: 8443,
        uuid: 'client@example',
        fakeTlsDomain: 'www.cloudflare.com',
      });

      inbound.settings = JSON.stringify({
        clients: [{ secret: 'invalid-secret' }],
      });
      expect(
        service.buildInboundLink(inbound, '203.0.113.10', 'invalid-secret', ''),
      ).toBe('');
    });

    it('отклоняет некорректный FakeTLS-домен', () => {
      expect(() =>
        service.buildMtprotoInbound({
          port: 8443,
          uuid: 'client@example',
          fakeTlsDomain: 'https://example.com/path',
        }),
      ).toThrow('Некорректный FakeTLS-домен MTProto');
    });
  });

  describe('buildVlessRealityXhttp', () => {
    const params = {
      port: 8443,
      uuid: 'test-uuid-456',
      sni: 'vk.com',
      privateKey: 'private-key',
      publicKey: 'public-key',
    };

    it('должен создать конфиг vless-xhttp-reality', () => {
      const result = service.buildVlessRealityXhttp(params);

      expect(result).toMatchObject({
        enable: true,
        port: 8443,
        protocol: 'vless',
        remark: 'vless-xhttp-reality',
      });

      const settings = JSON.parse(result.settings);
      expect(settings.clients[0].id).toBe('test-uuid-456');
      expect(settings.clients[0].flow).toBe('');
    });

    it('должен установить xhttp настройки', () => {
      const result = service.buildVlessRealityXhttp(params);

      const streamSettings = JSON.parse(result.streamSettings);
      expect(streamSettings.security).toBe('reality');
      expect(streamSettings.network).toBe('xhttp');
    });

    it('должен применять xhttpPath и padding из профиля SNI для известных сервисов', () => {
      const result = service.buildVlessRealityXhttp({
        ...params,
        sni: 'swdist.apple.com',
      });
      const streamSettings = JSON.parse(result.streamSettings);
      expect(streamSettings.realitySettings.settings.fingerprint).toBe(
        'safari',
      );
      expect(streamSettings.realitySettings.settings.spiderX).toBe(
        '/content/downloads/',
      );
      expect(streamSettings.xhttpSettings.path).toBe('/download/updates/');
      expect(streamSettings.xhttpSettings.xPaddingBytes).toBe('500-1500');
    });
  });

  describe('buildVlessRealityGrpc', () => {
    const params = {
      port: 2053,
      uuid: 'test-uuid-789',
      sni: 'ok.ru',
      privateKey: 'private-key',
      publicKey: 'public-key',
    };

    it('должен создать конфиг vless-grpc-reality', () => {
      const result = service.buildVlessRealityGrpc(params);

      expect(result).toMatchObject({
        enable: true,
        port: 2053,
        protocol: 'vless',
        remark: 'vless-grpc-reality',
      });

      const streamSettings = JSON.parse(result.streamSettings);
      expect(streamSettings.network).toBe('grpc');
      expect(streamSettings.grpcSettings?.serviceName).toBeTruthy();
    });
  });

  describe('buildVlessWs', () => {
    const params = {
      port: 10000,
      uuid: 'test-uuid-ws',
      sni: 'ozon.ru',
    };

    it('должен создать конфиг vless-ws', () => {
      const result = service.buildVlessWs(params);

      expect(result).toMatchObject({
        enable: true,
        port: 10000,
        protocol: 'vless',
        remark: 'vless-ws',
      });

      const streamSettings = JSON.parse(result.streamSettings);
      expect(streamSettings.network).toBe('ws');
    });

    it('должен установить ws настройки', () => {
      const result = service.buildVlessWs(params);

      const streamSettings = JSON.parse(result.streamSettings);
      expect(streamSettings.wsSettings?.path).toBe('/');
    });
  });

  describe('VLESS TLS', () => {
    const params = {
      port: 443,
      uuid: 'test-uuid-tls',
      serverName: 'tls.example.com',
      certificateFile: '/panel/cert/fullchain.pem',
      keyFile: '/panel/cert/privkey.pem',
    };

    it('должен создать TCP TLS inbound с переданным сертификатом ноды', () => {
      const inbound = service.buildVlessTlsTcp(params);
      const settings = JSON.parse(inbound.settings);
      const streamSettings = JSON.parse(inbound.streamSettings);

      expect(inbound.remark).toBe('vless-tcp-tls');
      expect(settings.clients[0].flow).toBe('xtls-rprx-vision');
      expect(streamSettings).toMatchObject({
        network: 'tcp',
        security: 'tls',
        tlsSettings: {
          serverName: 'tls.example.com',
          certificates: [
            {
              certificateFile: '/panel/cert/fullchain.pem',
              keyFile: '/panel/cert/privkey.pem',
            },
          ],
        },
      });
    });

    it('должен создать WebSocket TLS inbound и ссылку', () => {
      const inbound = service.buildVlessTlsWs({
        ...params,
        certificateFile: '/custom/fullchain.pem',
        keyFile: '/custom/privkey.pem',
      });
      const streamSettings = JSON.parse(inbound.streamSettings);
      const link = service.buildInboundLink(
        inbound,
        '203.0.113.10',
        params.uuid,
        '%F0%9F%92%AF',
      );

      expect(streamSettings.wsSettings).toMatchObject({
        path: '/',
        host: 'tls.example.com',
      });
      expect(link).toContain('type=ws');
      expect(link).toContain('security=tls');
      expect(link).toContain('sni=tls.example.com');
      expect(link).toContain('host=tls.example.com');
    });
  });

  describe('buildVmessTcp', () => {
    const params = {
      port: 20000,
      uuid: 'test-uuid-vmess',
    };

    it('должен создать конфиг vmess-tcp', () => {
      const result = service.buildVmessTcp(params);

      expect(result).toMatchObject({
        enable: true,
        port: 20000,
        protocol: 'vmess',
        remark: 'vmess-tcp',
      });

      const settings = JSON.parse(result.settings);
      expect(settings.clients[0].id).toBe('test-uuid-vmess');
      expect(settings.clients[0]).not.toHaveProperty('tgId');
      expect(settings.clients[0].alterId).toBe(0);
      expect(typeof settings.clients[0].alterId).toBe('number');
      expect(settings.clients[0].security).toBe('auto');
    });
  });

  describe('buildShadowsocksTcp', () => {
    const params = {
      port: 30000,
      uuid: 'test-uuid-ss',
    };

    it('должен создать конфиг shadowsocks-tcp', () => {
      const result = service.buildShadowsocksTcp(params);

      expect(result).toMatchObject({
        enable: true,
        port: 30000,
        protocol: 'shadowsocks',
        remark: 'shadowsocks-tcp',
      });

      const settings = JSON.parse(result.settings);
      expect(settings.method).toBe('2022-blake3-aes-256-gcm');
      expect(settings.password).toBeTruthy(); // Генерируется из uuid
    });
  });

  describe('buildTrojanRealityTcp', () => {
    const params = {
      port: 443,
      uuid: 'test-uuid-trojan',
      sni: 'ya.ru',
      privateKey: 'private-key',
      publicKey: 'public-key',
    };

    it('должен создать конфиг trojan-tcp-reality', () => {
      const result = service.buildTrojanRealityTcp(params);

      expect(result).toMatchObject({
        enable: true,
        port: 443,
        protocol: 'trojan',
        remark: 'trojan-tcp-reality',
      });

      const settings = JSON.parse(result.settings);
      expect(settings.clients[0].password).toBeTruthy(); // Генерируется из uuid
    });

    it('должен установить Reality настройки для trojan', () => {
      const result = service.buildTrojanRealityTcp(params);

      const streamSettings = JSON.parse(result.streamSettings);
      expect(streamSettings.security).toBe('reality');
      expect(streamSettings.realitySettings.target).toBe('ya.ru:443');
    });
  });

  describe('buildHysteria2Link', () => {
    beforeEach(() => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('должен создать ссылку hysteria2', () => {
      const result = service.buildHysteria2Link(
        '192.168.1.1',
        'ya.ru',
        '%F0%9F%92%AF%20hysteria2',
      );

      expect(result).toContain('hy2://');
      expect(result).toContain('192.168.1.1');
      // SNI может быть IP, если конфиг не найден
    });

    it('должен создать ссылку hysteria2 с портом по умолчанию', () => {
      const result = service.buildHysteria2Link(
        '192.168.1.1',
        'ya.ru',
        '%F0%9F%92%AF%20hysteria2',
      );

      expect(result).toContain(':443');
    });
  });

  describe('buildHysteria2Inbound', () => {
    it('creates 3x-ui hysteria v2 inbound with certificate paths', () => {
      const result = service.buildHysteria2Inbound({
        port: 34443,
        uuid: 'test-auth',
        serverName: 'oil.3dp-manager.com',
        certificateFile: '/panel/cert/fullchain.pem',
        keyFile: '/panel/cert/privkey.pem',
      });

      expect(result).toMatchObject({
        enable: true,
        listen: '0.0.0.0',
        port: 34443,
        protocol: 'hysteria',
        tag: 'inbound-34443',
      });

      const settings = JSON.parse(result.settings);
      const streamSettings = JSON.parse(result.streamSettings);

      expect(settings.clients[0].auth).toBe('test-auth');
      expect(settings.version).toBe(2);
      expect(streamSettings.network).toBe('hysteria');
      expect(streamSettings.hysteriaSettings.version).toBe(2);
      expect(streamSettings.finalmask.udp[0].type).toBe('salamander');
      expect(streamSettings.tlsSettings.certificates[0].certificateFile).toBe(
        '/panel/cert/fullchain.pem',
      );
      expect(streamSettings.tlsSettings.certificates[0].keyFile).toBe(
        '/panel/cert/privkey.pem',
      );

      const link = service.buildInboundLink(
        result as any,
        'relay.example.com',
        'fallback-auth',
        '%F0%9F%92%AF',
      );
      expect(link).toContain('hy2://test-auth@relay.example.com:34443/');
      expect(link).toContain('sni=oil.3dp-manager.com');
      expect(link).toContain('obfs=salamander');
      expect(link).toContain('obfs-password=abcd1234');
    });
  });

  describe('buildInboundLink', () => {
    const baseInbound = {
      protocol: 'vless',
      port: 443,
      remark: 'vless-tcp-reality',
      settings: JSON.stringify({
        clients: [{ id: 'test-uuid', flow: 'xtls-rprx-vision' }],
      }),
      streamSettings: JSON.stringify({
        network: 'tcp',
        security: 'reality',
        realitySettings: {
          serverNames: ['ya.ru'],
          publicKey: 'public-key',
        },
      }),
    };

    it('должен создать ссылку vless reality', () => {
      const result = service.buildInboundLink(
        baseInbound as any,
        '192.168.1.1',
        'test-uuid',
        '%F0%9F%92%AF',
      );

      expect(result).toContain('vless://');
      expect(result).toContain('192.168.1.1');
      expect(result).toContain('443');
    });

    it('должен создать ссылку vless reality с xhttp', () => {
      const inbound = {
        protocol: 'vless',
        port: 8443,
        remark: 'vless-xhttp-reality',
        settings: JSON.stringify({
          clients: [{ id: 'test-uuid', flow: '' }],
        }),
        streamSettings: JSON.stringify({
          network: 'xhttp',
          security: 'reality',
          realitySettings: {
            serverNames: ['ya.ru'],
            publicKey: 'public-key',
            settings: { publicKey: 'pk', fingerprint: 'random' },
            shortIds: ['abc123'],
          },
          xhttpSettings: {
            path: '/path',
            host: 'ya.ru',
            mode: 'auto',
          },
        }),
      };

      const result = service.buildInboundLink(
        inbound as any,
        '192.168.1.1',
        'test-uuid',
        '%F0%9F%92%AF',
      );

      expect(result).toContain('vless://');
      expect(result).toContain('type=xhttp');
      expect(result).toContain('path=%2Fpath');
    });

    it('должен создать ссылку vless reality с grpc', () => {
      const inbound = {
        protocol: 'vless',
        port: 8443,
        remark: 'vless-grpc-reality',
        settings: JSON.stringify({
          clients: [{ id: 'test-uuid', flow: '' }],
        }),
        streamSettings: JSON.stringify({
          network: 'grpc',
          security: 'reality',
          realitySettings: {
            serverNames: ['ya.ru'],
            publicKey: 'public-key',
            settings: { publicKey: 'pk', fingerprint: 'random' },
            shortIds: ['abc123'],
          },
          grpcSettings: {
            serviceName: 'grpc-service',
            authority: 'ya.ru',
          },
        }),
      };

      const result = service.buildInboundLink(
        inbound as any,
        '192.168.1.1',
        'test-uuid',
        '%F0%9F%92%AF',
      );

      expect(result).toContain('vless://');
      expect(result).toContain('type=grpc');
      expect(result).toContain('serviceName=grpc-service');
    });

    it('должен создать ссылку vless с ws', () => {
      const inbound = {
        protocol: 'vless',
        port: 443,
        remark: 'vless-ws',
        settings: JSON.stringify({
          clients: [{ id: 'test-uuid' }],
        }),
        streamSettings: JSON.stringify({
          network: 'ws',
          security: 'tls',
          wsSettings: {
            path: '/ws',
            headers: { Host: 'example.com' },
          },
        }),
      };

      const result = service.buildInboundLink(
        inbound as any,
        '192.168.1.1',
        'test-uuid',
        '%F0%9F%92%AF',
      );

      expect(result).toContain('vless://');
      expect(result).toContain('type=ws');
      expect(result).toContain('path=%2Fws');
    });

    it('должен создать ссылку vmess', () => {
      const vmessInbound = {
        protocol: 'vmess',
        port: 20000,
        remark: 'vmess-tcp',
        settings: JSON.stringify({
          clients: [{ id: 'test-uuid' }],
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
        }),
      };

      const result = service.buildInboundLink(
        vmessInbound as any,
        '192.168.1.1',
        'test-uuid',
        '%F0%9F%92%AF',
      );

      expect(result).toContain('vmess://');
    });

    it('должен создать ссылку shadowsocks', () => {
      const ssInbound = {
        protocol: 'shadowsocks',
        port: 30000,
        remark: 'shadowsocks-tcp',
        settings: JSON.stringify({
          method: '2022-blake3-aes-256-gcm',
          password: 'test-password',
          clients: [{ password: 'client-pass' }],
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
        }),
      };

      const result = service.buildInboundLink(
        ssInbound as any,
        '192.168.1.1',
        '',
        '%F0%9F%92%AF',
      );

      expect(result).toContain('ss://');
    });

    it('должен создать ссылку trojan', () => {
      const trojanInbound = {
        protocol: 'trojan',
        port: 443,
        remark: 'trojan-reality',
        settings: JSON.stringify({
          clients: [{ password: 'trojan-pass' }],
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            serverNames: ['ya.ru'],
            publicKey: 'public-key',
            settings: { publicKey: 'pk', fingerprint: 'random' },
            shortIds: ['abc123'],
          },
        }),
      };

      const result = service.buildInboundLink(
        trojanInbound as any,
        '192.168.1.1',
        'trojan-pass',
        '%F0%9F%92%AF',
      );

      expect(result).toContain('trojan://');
      expect(result).toContain('security=reality');
    });

    it('должен вернуть пустую строку для trojan без reality', () => {
      const trojanInbound = {
        protocol: 'trojan',
        port: 443,
        remark: 'trojan',
        settings: JSON.stringify({
          clients: [{ password: 'pass' }],
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
          security: 'none',
        }),
      };

      const result = service.buildInboundLink(
        trojanInbound as any,
        '192.168.1.1',
        'pass',
        '%F0%9F%92%AF',
      );

      expect(result).toBe('');
    });

    it('должен вернуть пустую строку для vless без reality settings', () => {
      const vlessInbound = {
        protocol: 'vless',
        port: 443,
        remark: 'vless',
        settings: JSON.stringify({
          clients: [{ id: 'uuid' }],
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
          security: 'reality',
          realitySettings: null,
        }),
      };

      const result = service.buildInboundLink(
        vlessInbound as any,
        '192.168.1.1',
        'uuid',
        '%F0%9F%92%AF',
      );

      expect(result).toBe('');
    });
  });

  describe('generateUuid', () => {
    it('должен сгенерировать UUID', () => {
      const uuid = service.generateUuid();

      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('Совместимость клиентов с 3x-ui', () => {
    const commonParams = {
      port: 443,
      uuid: '11111111-2222-3333-4444-555555555555',
      sni: 'example.com',
      privateKey: 'priv-key',
      publicKey: 'pub-key',
      serverName: 'example.com',
      certificateFile: '/panel/cert/fullchain.pem',
      keyFile: '/panel/cert/privkey.pem',
    };

    it('не должен отправлять tgId для всех поддерживаемых протоколов', () => {
      const inbounds = [
        service.buildVlessRealityTcp(commonParams),
        service.buildVlessRealityXhttp(commonParams),
        service.buildVlessRealityGrpc(commonParams),
        service.buildVlessWs(commonParams),
        service.buildVlessTlsTcp(commonParams),
        service.buildVlessTlsWs(commonParams),
        service.buildVmessTcp({ port: 443, uuid: commonParams.uuid }),
        service.buildShadowsocksTcp({ port: 443, uuid: commonParams.uuid }),
        service.buildTrojanRealityTcp(commonParams),
        service.buildMtprotoInbound({
          port: 443,
          uuid: commonParams.uuid,
          fakeTlsDomain: 'example.com',
        }),
        service.buildAmneziaWgInbound({ port: 51820, uuid: commonParams.uuid }),
      ];

      for (const inbound of inbounds) {
        const settings = JSON.parse(inbound.settings);
        expect(settings.clients).toBeDefined();
        expect(Array.isArray(settings.clients)).toBe(true);
        expect(settings.clients.length).toBeGreaterThan(0);
        for (const client of settings.clients) {
          expect(client).not.toHaveProperty('tgId');
        }
      }
    });

    it('должен генерировать alterId как число 0 для vmess', () => {
      const vmess = service.buildVmessTcp({
        port: 443,
        uuid: commonParams.uuid,
      });
      const settings = JSON.parse(vmess.settings);
      expect(settings.clients[0].alterId).toBe(0);
      expect(typeof settings.clients[0].alterId).toBe('number');
    });
  });

  describe('custom client email parameter', () => {
    const customEmail = 'Sai-0939535c';
    const uuid = '0939535c-1f2c-4ffb-93e6-cb86d20a37b3';

    it('использует переданный email в vless reality tcp', () => {
      const inbound = service.buildVlessRealityTcp({
        port: 443,
        uuid,
        email: customEmail,
        sni: 'ya.ru',
        privateKey: 'pk',
        publicKey: 'pub',
      });
      const settings = JSON.parse(inbound.settings);
      expect(settings.clients[0].email).toBe(customEmail);
      expect(settings.clients[0].id).toBe(uuid);
    });

    it('использует переданный email в hysteria2', () => {
      const inbound = service.buildHysteria2Inbound({
        port: 443,
        uuid,
        email: customEmail,
        serverName: 'example.com',
        certificateFile: '/cert',
        keyFile: '/key',
      });
      const settings = JSON.parse(inbound.settings);
      expect(settings.clients[0].email).toBe(customEmail);
      expect(settings.clients[0].auth).toBe(uuid);
    });

    it('использует переданный email в amneziawg', () => {
      const inbound = service.buildAmneziaWgInbound({
        port: 51820,
        uuid,
        email: customEmail,
      });
      const settings = JSON.parse(inbound.settings);
      expect(settings.clients[0].email).toBe(customEmail);
    });

    it('использует переданный email в mtproto', () => {
      const inbound = service.buildMtprotoInbound({
        port: 8443,
        uuid,
        email: customEmail,
        fakeTlsDomain: 'vk.com',
      });
      const settings = JSON.parse(inbound.settings);
      expect(settings.clients[0].email).toBe(customEmail);
    });
  });
});
