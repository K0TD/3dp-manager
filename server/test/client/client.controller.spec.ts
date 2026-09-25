/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpException } from '@nestjs/common';
import { ClientController } from 'src/client/client.controller';
import { Subscription } from 'src/subscriptions/entities/subscription.entity';
import { Tunnel } from 'src/tunnels/entities/tunnel.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import * as QRCode from 'qrcode';
import { generateSubscriptionHtmlWithQr } from 'src/client/templates/subscription.template';
import { amneziaConfigFromLink } from 'src/inbounds/amnezia-vpn-link';

jest.mock('qrcode', () => ({
  toDataURL: jest.fn(),
}));

jest.mock('src/client/templates/subscription.template', () => ({
  generateSubscriptionHtmlWithQr: jest.fn(
    () => '<html>Subscription Page</html>',
  ),
}));

describe('ClientController', () => {
  let controller: ClientController;
  let _subRepo: Repository<Subscription>;
  let _tunnelRepo: Repository<Tunnel>;
  let cacheManager: any;

  const mockSubRepo = {
    findOne: jest.fn(),
  };

  const mockTunnelRepo = {
    findOne: jest.fn(),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientController],
      providers: [
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubRepo,
        },
        {
          provide: getRepositoryToken(Tunnel),
          useValue: mockTunnelRepo,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    controller = module.get<ClientController>(ClientController);
    _subRepo = module.get<Repository<Subscription>>(
      getRepositoryToken(Subscription),
    );
    _tunnelRepo = module.get<Repository<Tunnel>>(getRepositoryToken(Tunnel));
    cacheManager = module.get(CACHE_MANAGER);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe.each(['direct', 'relay'])('%s browser QR codes', (route) => {
    const request = {
      headers: { 'user-agent': 'Mozilla/5.0' },
      query: {},
      protocol: 'https',
      get: () => 'example.com',
    } as any;
    const response = { setHeader: jest.fn(), send: jest.fn() } as any;
    const subscription = { uuid: 'qr-test', name: 'QR test', isEnabled: true };
    const render = () =>
      route === 'direct'
        ? controller.getSubscription('qr-test', request, response)
        : controller.getRelaySubscription('qr-test', '1', request, response);

    beforeEach(() => {
      mockTunnelRepo.findOne.mockResolvedValue({
        id: 1,
        domain: 'relay.example.com',
      });
      mockCacheManager.get.mockResolvedValue(null);
      (QRCode.toDataURL as jest.Mock).mockResolvedValue(
        'data:image/png;base64,generated',
      );
    });

    it.each([
      { inbounds: [] },
      {
        inbounds: [
          { status: 'error', protocol: 'vless', link: 'vless://inactive' },
        ],
      },
      { inbounds: [{ status: 'active', protocol: 'vless', link: '   ' }] },
      {
        inbounds: [
          {
            status: 'active',
            protocol: 'mtproto',
            link: 'tg://proxy?server=example.com&port=443&secret=eeaa',
          },
        ],
      },
    ])(
      'не генерирует общий QR без активных обычных ссылок (%j)',
      async ({ inbounds }) => {
        mockSubRepo.findOne.mockResolvedValue({ ...subscription, inbounds });
        await render();
        expect(QRCode.toDataURL).not.toHaveBeenCalled();
        expect(mockCacheManager.get).not.toHaveBeenCalled();
        expect(generateSubscriptionHtmlWithQr).toHaveBeenCalledWith(
          expect.objectContaining({ qrDataUrl: '' }),
        );
      },
    );

    it('кодирует в QR именованный ключ Amnezia с правильным endpoint', async () => {
      const config =
        '[Interface]\nPrivateKey = private\n[Peer]\nPublicKey = public\nEndpoint = original.example.com:51820';
      mockSubRepo.findOne.mockResolvedValue({
        ...subscription,
        inbounds: [
          {
            status: 'active',
            protocol: 'amneziawg',
            link: `vpn://${Buffer.from(config).toString('base64url')}`,
          },
        ],
      });
      await render();
      const preview = (generateSubscriptionHtmlWithQr as jest.Mock).mock
        .calls[0][0];
      expect(QRCode.toDataURL).toHaveBeenCalledTimes(2);
      expect(QRCode.toDataURL).toHaveBeenNthCalledWith(
        1,
        preview.amneziaLinks[0],
        {
          width: 480,
          margin: 4,
        },
      );
      expect(QRCode.toDataURL).toHaveBeenNthCalledWith(
        2,
        amneziaConfigFromLink(preview.amneziaLinks[0]),
        {
          width: 480,
          margin: 2,
          errorCorrectionLevel: 'L',
        },
      );
      expect(preview.qrDataUrl).toBe('');
      expect(preview.amneziaQrDataUrls).toEqual([
        'data:image/png;base64,generated',
      ]);
      expect(preview.amneziaWgQrDataUrls).toEqual([
        'data:image/png;base64,generated',
      ]);
      expect(amneziaConfigFromLink(preview.amneziaLinks[0])).toContain(
        route === 'relay'
          ? 'relay.example.com:51820'
          : 'original.example.com:51820',
      );
      expect(mockCacheManager.get).not.toHaveBeenCalled();
    });

    it('сохраняет страницу и ключ, когда QR не помещается', async () => {
      mockSubRepo.findOne.mockResolvedValue({
        ...subscription,
        inbounds: [
          { status: 'active', protocol: 'amneziawg', link: 'vpn://large-key' },
        ],
      });
      (QRCode.toDataURL as jest.Mock).mockRejectedValueOnce(
        new Error('Too much data'),
      );
      await render();
      expect(generateSubscriptionHtmlWithQr).toHaveBeenCalledWith(
        expect.objectContaining({
          qrDataUrl: '',
          amneziaQrDataUrls: [''],
          amneziaLinks: ['vpn://large-key'],
        }),
      );
      expect(response.send).toHaveBeenCalledWith(
        '<html>Subscription Page</html>',
      );
    });
  });

  describe('getSubscription', () => {
    const mockSubscription = {
      uuid: 'test-uuid',
      name: 'Test Subscription',
      isEnabled: true,
      inbounds: [
        {
          id: 1,
          status: 'active',
          link: 'vless://abc123@192.168.1.1:443',
          protocol: 'vless',
        },
        { id: 2, status: 'active', link: 'vmess://xyz789', protocol: 'vmess' },
      ],
    };

    const mockRequest = {
      headers: {},
      query: {},
      protocol: 'https',
      get: jest.fn().mockReturnValue('example.com'),
    } as any;

    const mockResponse = {
      setHeader: jest.fn(),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as any;

    it('должен вернуть base64 подписку для не-браузера', async () => {
      mockRequest.headers['user-agent'] = 'curl/7.68.0';
      mockSubRepo.findOne.mockResolvedValue(mockSubscription);
      (QRCode.toDataURL as jest.Mock).mockResolvedValue(
        'data:image/png;base64,qr',
      );

      await controller.getSubscription('test-uuid', mockRequest, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain; charset=utf-8',
      );
      expect(mockResponse.send).toHaveBeenCalledWith(expect.any(String));
    });

    it('должен вернуть HTML с QR для браузера', async () => {
      mockRequest.headers['user-agent'] = 'Mozilla/5.0 Chrome/120.0';
      mockSubRepo.findOne.mockResolvedValue(mockSubscription);
      (QRCode.toDataURL as jest.Mock).mockResolvedValue(
        'data:image/png;base64,qr',
      );
      mockCacheManager.get.mockResolvedValue(null);

      await controller.getSubscription('test-uuid', mockRequest, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/html',
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        '<html>Subscription Page</html>',
      );
    });

    it('должен загрузить QR из кэша', async () => {
      mockRequest.headers['user-agent'] = 'Mozilla/5.0 Chrome/120.0';
      mockSubRepo.findOne.mockResolvedValue(mockSubscription);
      mockCacheManager.get.mockResolvedValue('data:image/png;base64,cached-qr');

      await controller.getSubscription('test-uuid', mockRequest, mockResponse);

      expect(cacheManager.get).toHaveBeenCalledWith('qr_test-uuid');
      expect(QRCode.toDataURL).not.toHaveBeenCalled();
    });

    it('должен бросить 404, если подписка не найдена', async () => {
      mockSubRepo.findOne.mockResolvedValue(null);

      await expect(
        controller.getSubscription('non-existent', mockRequest, mockResponse),
      ).rejects.toThrow(HttpException);

      await expect(
        controller.getSubscription('non-existent', mockRequest, mockResponse),
      ).rejects.toThrow('Subscription not found');
    });

    it('должен бросить 404, если подписка отключена', async () => {
      const disabledSub = { ...mockSubscription, isEnabled: false };
      mockSubRepo.findOne.mockResolvedValue(disabledSub);

      await expect(
        controller.getSubscription('test-uuid', mockRequest, mockResponse),
      ).rejects.toThrow(HttpException);
    });

    it('должен обработать подписку без инбаундов', async () => {
      const subWithoutInbounds = { ...mockSubscription, inbounds: [] };
      mockRequest.headers['user-agent'] = 'curl/7.68.0';
      mockSubRepo.findOne.mockResolvedValue(subWithoutInbounds);

      await controller.getSubscription('test-uuid', mockRequest, mockResponse);

      expect(mockResponse.send).toHaveBeenCalledWith('');
    });

    it('должен выдавать активные ссылки в сохранённом порядке', async () => {
      mockRequest.headers['user-agent'] = 'curl/7.68.0';
      mockSubRepo.findOne.mockResolvedValue({
        ...mockSubscription,
        inbounds: [
          {
            id: 10,
            position: 1,
            status: 'active',
            link: 'vless://second',
            protocol: 'vless',
          },
          {
            id: 11,
            position: 0,
            status: 'active',
            link: 'vless://first',
            protocol: 'vless',
          },
        ],
      });

      await controller.getSubscription('test-uuid', mockRequest, mockResponse);

      const encodedSubscription = mockResponse.send.mock.calls[0][0] as string;
      expect(Buffer.from(encodedSubscription, 'base64').toString('utf8')).toBe(
        'vless://first\nvless://second',
      );
    });

    it('отделяет AmneziaWG и TGProxy от обычной подписки для превью', async () => {
      const amneziaConfig =
        '[Interface]\nPrivateKey = private\n\n# old name\n[Peer]\nPublicKey = public';
      const amneziaLink = `vpn://${Buffer.from(amneziaConfig).toString('base64url')}`;
      mockRequest.headers['user-agent'] = 'Mozilla/5.0 Chrome/120.0';
      mockSubRepo.findOne.mockResolvedValue({
        ...mockSubscription,
        inbounds: [
          {
            position: 0,
            status: 'active',
            protocol: 'vless',
            link: 'vless://regular',
          },
          {
            position: 1,
            status: 'active',
            protocol: 'amneziawg',
            link: amneziaLink,
          },
          {
            position: 2,
            status: 'active',
            protocol: 'mtproto',
            link: 'tg://proxy?server=example.com&port=443&secret=eeaa',
          },
        ],
      });
      mockCacheManager.get.mockResolvedValue('data:image/png;base64,cached');

      await controller.getSubscription('test-uuid', mockRequest, mockResponse);

      expect(generateSubscriptionHtmlWithQr).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionLinks: ['vless://regular'],
          amneziaLinks: [expect.stringMatching(/^vpn:\/\//)],
          telegramProxyLinks: [
            'tg://proxy?server=example.com&port=443&secret=eeaa',
          ],
        }),
      );
      const preview = (generateSubscriptionHtmlWithQr as jest.Mock).mock
        .calls[0][0] as { amneziaLinks: string[] };
      const namedConfig = amneziaConfigFromLink(preview.amneziaLinks[0]);
      expect(namedConfig).toContain('# Test Subscription\n[Peer]');
    });

    it('не добавляет AmneziaWG и TGProxy в Base64-подписку', async () => {
      mockRequest.headers['user-agent'] = 'curl/8.0';
      mockSubRepo.findOne.mockResolvedValue({
        ...mockSubscription,
        inbounds: [
          {
            position: 0,
            status: 'active',
            protocol: 'vless',
            link: 'vless://regular',
          },
          {
            position: 1,
            status: 'active',
            protocol: 'amneziawg',
            link: 'vpn://amnezia-config',
          },
          {
            position: 2,
            status: 'active',
            protocol: 'mtproto',
            link: 'tg://proxy?server=example.com&port=443&secret=eeaa',
          },
        ],
      });

      await controller.getSubscription('test-uuid', mockRequest, mockResponse);

      const encodedSubscription = mockResponse.send.mock.calls[0][0] as string;
      expect(Buffer.from(encodedSubscription, 'base64').toString('utf8')).toBe(
        'vless://regular',
      );
    });

    it('скачивает валидный conf-профиль AmneziaWG', async () => {
      const config =
        '[Interface]\nPrivateKey = private\nAddress = 10.8.1.2/32\nMTU = 1393\nJc = 4\nJmin = 40\nJmax = 90\nS1 = 15\nS2 = 16\nS3 = 17\nS4 = 18\n\n[Peer]\nPublicKey = public\nEndpoint = example.com:51820';
      mockSubRepo.findOne.mockResolvedValue({
        ...mockSubscription,
        inbounds: [
          {
            position: 0,
            status: 'active',
            protocol: 'amneziawg',
            link: `vpn://${Buffer.from(config).toString('base64url')}`,
          },
        ],
      });

      mockRequest.query = { format: 'amneziawg', index: '0' };

      await controller.getSubscription('test-uuid', mockRequest, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/x-wireguard-profile; charset=utf-8',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="amneziawg.conf"; filename*=UTF-8\'\'Test%20Subscription.conf',
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        config.replace('\n[Peer]', '\n# Test Subscription\n[Peer]'),
      );
    });

    it('отклоняет отсутствующий профиль AmneziaWG', async () => {
      mockSubRepo.findOne.mockResolvedValue({
        ...mockSubscription,
        inbounds: [],
      });

      mockRequest.query = { format: 'amneziawg', index: '4' };

      await controller.getSubscription('test-uuid', mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.send).toHaveBeenCalledWith(
        'AmneziaWG config not found',
      );
    });

    it('отклоняет некорректный индекс профиля AmneziaWG', async () => {
      mockSubRepo.findOne.mockResolvedValue({
        ...mockSubscription,
        inbounds: [],
      });
      mockRequest.query = { format: 'amneziawg', index: '1.5' };

      await controller.getSubscription('test-uuid', mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
    });
  });

  describe('getRelaySubscription', () => {
    const mockTunnel = {
      id: 1,
      ip: '192.168.1.100',
      domain: 'relay.example.com',
    };

    const mockSubscription = {
      uuid: 'test-uuid',
      name: 'Test Subscription',
      isEnabled: true,
      inbounds: [
        {
          id: 1,
          status: 'active',
          link: 'vless://abc123@192.168.1.1:443',
          protocol: 'vless',
        },
        { id: 2, status: 'active', link: 'vmess://xyz789', protocol: 'vmess' },
        { id: 3, status: 'active', link: 'custom-link', protocol: 'custom' },
      ],
    };

    const mockRequest = {
      headers: {},
      query: {},
      protocol: 'https',
      get: jest.fn().mockReturnValue('example.com'),
    } as any;

    const mockResponse = {
      setHeader: jest.fn(),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as any;

    it('должен вернуть 404, если туннель не найден', async () => {
      mockTunnelRepo.findOne.mockResolvedValue(null);

      await controller.getRelaySubscription(
        'test-uuid',
        '999',
        mockRequest,
        mockResponse,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.send).toHaveBeenCalledWith('Relay server not found');
    });

    it('должен вернуть base64 подписку для не-браузера с relay', async () => {
      mockRequest.headers['user-agent'] = 'curl/7.68.0';
      mockTunnelRepo.findOne.mockResolvedValue(mockTunnel);
      mockSubRepo.findOne.mockResolvedValue(mockSubscription);

      await controller.getRelaySubscription(
        'test-uuid',
        '1',
        mockRequest,
        mockResponse,
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain; charset=utf-8',
      );
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('должен вернуть HTML с QR для браузера с relay', async () => {
      mockRequest.headers['user-agent'] = 'Mozilla/5.0 Chrome/120.0';
      mockTunnelRepo.findOne.mockResolvedValue(mockTunnel);
      mockSubRepo.findOne.mockResolvedValue(mockSubscription);
      mockCacheManager.get.mockResolvedValue(null);
      (QRCode.toDataURL as jest.Mock).mockResolvedValue(
        'data:image/png;base64,qr',
      );

      await controller.getRelaySubscription(
        'test-uuid',
        '1',
        mockRequest,
        mockResponse,
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/html',
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        '<html>Subscription Page</html>',
      );
    });

    it('должен бросить 404, если подписка не найдена', async () => {
      mockTunnelRepo.findOne.mockResolvedValue(mockTunnel);
      mockSubRepo.findOne.mockResolvedValue(null);

      await expect(
        controller.getRelaySubscription(
          'non-existent',
          '1',
          mockRequest,
          mockResponse,
        ),
      ).rejects.toThrow(HttpException);
    });

    it('должен использовать IP туннеля, если домен не указан', async () => {
      const tunnelWithoutDomain = { ...mockTunnel, domain: null };
      mockRequest.headers['user-agent'] = 'curl/7.68.0';
      mockTunnelRepo.findOne.mockResolvedValue(tunnelWithoutDomain);
      mockSubRepo.findOne.mockResolvedValue(mockSubscription);

      await controller.getRelaySubscription(
        'test-uuid',
        '1',
        mockRequest,
        mockResponse,
      );

      expect(mockResponse.send).toHaveBeenCalled();
    });
  });

  describe('patchLink', () => {
    it('должен обновить хост в vmess ссылке', () => {
      const vmessLink =
        'vmess://' +
        Buffer.from(
          JSON.stringify({ add: 'old-host.com', port: '443' }),
        ).toString('base64');

      // Приватный метод, тестируем через controller
      const result = (controller as any).patchLink(vmessLink, 'new-host.com');

      expect(result).toContain('vmess://');
    });

    it('должен обновить хост в vless ссылке', () => {
      const vlessLink = 'vless://abc@old-host.com:443';

      const result = (controller as any).patchLink(vlessLink, 'new-host.com');

      expect(result).toBe('vless://abc@new-host.com:443');
    });

    it('должен обновить хост в trojan ссылке', () => {
      const trojanLink = 'trojan://pass@old-host.com:443';

      const result = (controller as any).patchLink(trojanLink, 'new-host.com');

      expect(result).toBe('trojan://pass@new-host.com:443');
    });

    it('должен обновить хост в hy2 ссылке', () => {
      const hy2Link = 'hy2://pass@old-host.com:443';

      const result = (controller as any).patchLink(hy2Link, 'new-host.com');

      expect(result).toBe('hy2://pass@new-host.com:443');
    });

    it('должен вернуть ссылку без изменений для неизвестного протокола', () => {
      const unknownLink = 'unknown://abc@host.com:443';

      const result = (controller as any).patchLink(unknownLink, 'new-host.com');

      expect(result).toBe(unknownLink);
    });

    it('должен вернуть vmess ссылку без изменений при ошибке парсинга', () => {
      const invalidVmssLink = 'vmess://invalid-base64!@#';

      const result = (controller as any).patchLink(
        invalidVmssLink,
        'new-host.com',
      );

      expect(result).toBe(invalidVmssLink);
    });

    it('должен обновить хост в ссылке Telegram Proxy', () => {
      const link = 'tg://proxy?server=old.example.com&port=443&secret=eeaa';

      const result = (controller as any).patchLink(link, 'relay.example.com');

      expect(result).toBe(
        'tg://proxy?server=relay.example.com&port=443&secret=eeaa',
      );
    });

    it('должен обновить Endpoint в конфигурации AmneziaWG', () => {
      const config =
        '[Interface]\nPrivateKey = key\n\n[Peer]\nEndpoint = old.example.com:51820';
      const link = `vpn://${Buffer.from(config).toString('base64url')}`;

      const result = (controller as any).patchLink(link, 'relay.example.com');
      const patchedConfig = amneziaConfigFromLink(result);

      expect(patchedConfig).toContain('Endpoint = relay.example.com:51820');
    });
  });
});
