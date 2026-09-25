/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { RotationService } from 'src/rotation/rotation.service';
import { SubscriptionLockService } from 'src/subscriptions/subscription-lock.service';
import { Inbound, InboundStatus } from 'src/inbounds/entities/inbound.entity';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionsService } from 'src/subscriptions/subscriptions.service';
import { Subscription } from 'src/subscriptions/entities/subscription.entity';
import { XuiService } from 'src/xui/xui.service';
import { CreateSubscriptionDto } from 'src/subscriptions/dto/create-subscription.dto';
import { Node } from 'src/nodes/entities/node.entity';
import { Tunnel } from 'src/tunnels/entities/tunnel.entity';
import { Domain } from 'src/domains/entities/domain.entity';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let subRepo: Repository<Subscription>;
  let xuiService: XuiService;

  const mockEntityManager = {
    save: jest.fn(async (_entity, subscription) => subscription),
    update: jest.fn(),
  };

  const mockSubRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
    manager: {
      transaction: jest.fn(
        async (
          work: (entityManager: typeof mockEntityManager) => Promise<unknown>,
        ) => work(mockEntityManager),
      ),
    },
  };

  const mockNodeRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    })),
  };

  const mockTunnelRepo = {
    findOne: jest.fn(),
  };

  const mockDomainRepo = {
    findOne: jest.fn(),
  };

  const mockXuiService = {
    deleteInbound: jest.fn(),
  };
  const mockRotationService = { provisionAmnezia: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: RotationService, useValue: mockRotationService },
        {
          provide: SubscriptionLockService,
          useValue: { run: jest.fn(async (_id, work) => work()) },
        },
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubRepo,
        },
        {
          provide: getRepositoryToken(Node),
          useValue: mockNodeRepo,
        },
        {
          provide: getRepositoryToken(Tunnel),
          useValue: mockTunnelRepo,
        },
        {
          provide: getRepositoryToken(Domain),
          useValue: mockDomainRepo,
        },
        {
          provide: XuiService,
          useValue: mockXuiService,
        },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    subRepo = module.get<Repository<Subscription>>(
      getRepositoryToken(Subscription),
    );
    xuiService = module.get<XuiService>(XuiService);
    mockXuiService.deleteInbound.mockResolvedValue(true);
    mockRotationService.provisionAmnezia.mockResolvedValue({
      status: 'succeeded',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('AmneziaWG save lifecycle', () => {
    const config = {
      configId: 'awg-config',
      type: 'amneziawg',
      nodeId: 'node-1',
      port: 'random',
    };
    let subscription: Subscription;

    beforeEach(() => {
      subscription = {
        id: 'sub-awg',
        name: 'AWG',
        isAutoRotationEnabled: false,
        inboundsConfig: [{ ...config }],
        inbounds: [
          {
            id: 71,
            configId: config.configId,
            protocol: 'amneziawg',
            nodeId: 'node-1',
            port: 51820,
            status: InboundStatus.Active,
            link: 'vpn://existing',
          },
        ],
      } as Subscription;
      mockSubRepo.findOne.mockResolvedValue(subscription);
      mockSubRepo.save.mockImplementation(async (sub) => sub);
      mockSubRepo.create.mockImplementation((sub) => sub);
      mockEntityManager.save.mockImplementation(async (_entity, sub) => sub);
      mockNodeRepo.findOne.mockResolvedValue({
        id: 'node-1',
        version: '3.7.0',
      });
    });

    it('creates AWG when a new subscription is saved even with automatic rotation disabled', async () => {
      const result = await service.create({
        name: 'AWG',
        isAutoRotationEnabled: false,
        inboundsConfig: [config],
      });
      expect(mockRotationService.provisionAmnezia).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        awgProvisioning: { status: 'succeeded' },
      });
    });

    it('supports deleting the sole AWG, saving an empty list and adding a new identity', async () => {
      const empty = await service.update(subscription.id, {
        inboundsConfig: [],
      });
      expect(empty?.inboundsConfig).toEqual([]);
      expect(empty?.inbounds).toEqual([]);
      expect(mockEntityManager.update).toHaveBeenCalledWith(
        Inbound,
        { id: expect.objectContaining({ _value: [71] }) },
        expect.objectContaining({
          status: InboundStatus.PendingCleanup,
          nextCleanupAt: expect.any(Date),
        }),
      );
      expect(mockRotationService.provisionAmnezia).not.toHaveBeenCalled();
      await service.update(subscription.id, {
        inboundsConfig: [{ ...config, configId: 'new-awg-config' }],
      });
      expect(mockRotationService.provisionAmnezia).toHaveBeenCalledWith(
        expect.objectContaining({
          inboundsConfig: [
            expect.objectContaining({ configId: 'new-awg-config' }),
          ],
          inbounds: [],
        }),
      );
    });

    it.each([
      { port: 51821 },
      { type: 'vless-tcp-tls' },
      { nodeId: 'node-2' },
      { relayServerId: 2 },
    ])(
      'rejects changing active AWG connection settings: %s',
      async (change) => {
        await expect(
          service.update(subscription.id, {
            inboundsConfig: [{ ...config, ...change }],
          }),
        ).rejects.toThrow('удалите инбаунд');
        expect(mockEntityManager.save).not.toHaveBeenCalled();
      },
    );

    it('rejects replacing an active AWG by a new identity in the same save', async () => {
      await expect(
        service.update(subscription.id, {
          inboundsConfig: [{ ...config, configId: 'new' }],
        }),
      ).rejects.toThrow('Сначала сохраните удаление');
    });

    it('protects inherited node and relay settings', async () => {
      subscription.inboundsConfig[0].nodeId = undefined;
      subscription.nodeId = 'node-1';
      await expect(
        service.update(subscription.id, { nodeId: 'node-2' }),
      ).rejects.toThrow('удалите инбаунд');
      await expect(
        service.update(subscription.id, { relayServerId: 10 }),
      ).rejects.toThrow('удалите инбаунд');
    });

    it('allows names, flags and order changes without retiring AWG', async () => {
      await service.update(subscription.id, {
        inboundsConfig: [
          { configId: 'custom', type: 'custom', link: 'vless://example' },
          { ...config, name: 'Новое имя', flag: '🇩🇪' },
        ],
      });
      expect(mockEntityManager.update).toHaveBeenCalledWith(
        Inbound,
        {
          subscriptionId: subscription.id,
          configId: config.configId,
          status: InboundStatus.Active,
        },
        { position: 1 },
      );
      expect(
        mockEntityManager.update.mock.calls.some(
          (call) => call[2].status === InboundStatus.PendingCleanup,
        ),
      ).toBe(false);
    });

    it('returns a provisioning error separately from saved settings', async () => {
      mockRotationService.provisionAmnezia.mockResolvedValueOnce({
        status: 'failed',
        message: 'Panel offline',
      });
      const result = await service.update(subscription.id, {
        inboundsConfig: [config],
      });
      expect(result).toMatchObject({
        awgProvisioning: { status: 'failed', message: 'Panel offline' },
      });
      expect(mockEntityManager.save).toHaveBeenCalled();
    });

    it('preserves legacy AWG when identity is ambiguous', async () => {
      subscription.inbounds[0].configId = undefined;
      await expect(
        service.update(subscription.id, { inboundsConfig: [] }),
      ).rejects.toThrow('однозначно');
      expect(mockEntityManager.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('должен вернуть все подписки с relations и сортировкой', async () => {
      const mockSubs: Subscription[] = [
        {
          id: '1',
          name: 'Sub 1',
          uuid: 'uuid-1',
          isEnabled: true,
          isAutoRotationEnabled: true,
          inboundsConfig: [],
          inbounds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          name: 'Sub 2',
          uuid: 'uuid-2',
          isEnabled: true,
          isAutoRotationEnabled: false,
          inboundsConfig: [],
          inbounds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockSubRepo.find.mockResolvedValue(mockSubs);

      const result = await service.findAll();

      expect(result).toEqual(mockSubs);
      expect(subRepo.find).toHaveBeenCalledWith({
        relations: ['inbounds', 'node', 'relayServer'],
        order: { createdAt: 'DESC' },
      });
    });

    it('должен возвращать количество подписок', async () => {
      mockSubRepo.count.mockResolvedValue(12);

      const result = await service.count();

      expect(result).toEqual({ count: 12 });
      expect(subRepo.count).toHaveBeenCalledTimes(1);
    });

    it('должен вернуть пустой массив, если подписок нет', async () => {
      mockSubRepo.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    const createDto: CreateSubscriptionDto = {
      name: 'Test Subscription',
      inboundsConfig: [
        { type: 'vless-tcp-reality', port: 443, sni: 'example.com' },
      ],
      isAutoRotationEnabled: true,
    };

    it('должен создать подписку с UUID и настройками по умолчанию', async () => {
      const mockSubscription = {
        ...createDto,
        id: 'test-id',
        uuid: 'generated-uuid',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSubRepo.create.mockReturnValue(mockSubscription);
      mockSubRepo.save.mockResolvedValue(mockSubscription);

      const result = await service.create(createDto);

      expect(subRepo.create).toHaveBeenCalledWith({
        id: expect.any(String),
        name: 'Test Subscription',
        uuid: expect.any(String),
        inboundsConfig: [
          expect.objectContaining({
            ...createDto.inboundsConfig?.[0],
            configId: expect.any(String),
          }),
        ],
        isAutoRotationEnabled: true,
        node: null,
        relayServer: null,
      });
      expect(subRepo.save).toHaveBeenCalledWith(mockSubscription);
      expect(result).toEqual(mockSubscription);
    });

    it('должен использовать inboundsConfig по умолчанию [], если не передан', async () => {
      const dtoWithoutConfig: CreateSubscriptionDto = {
        name: 'Test',
        isAutoRotationEnabled: false,
      };

      mockSubRepo.create.mockReturnValue({ ...dtoWithoutConfig, uuid: 'uuid' });
      mockSubRepo.save.mockResolvedValue({ ...dtoWithoutConfig, uuid: 'uuid' });

      await service.create(dtoWithoutConfig);

      expect(subRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          inboundsConfig: [],
        }),
      );
    });

    it('должен использовать isAutoRotationEnabled=true по умолчанию', async () => {
      const dtoWithoutRotation: CreateSubscriptionDto = {
        name: 'Test',
        inboundsConfig: [],
      };

      mockSubRepo.create.mockReturnValue({
        ...dtoWithoutRotation,
        uuid: 'uuid',
      });
      mockSubRepo.save.mockResolvedValue({
        ...dtoWithoutRotation,
        uuid: 'uuid',
      });

      await service.create(dtoWithoutRotation);

      expect(subRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isAutoRotationEnabled: true,
        }),
      );
    });

    it('должен отклонять неизвестный тип inbound', async () => {
      await expect(
        service.create({
          name: 'Invalid',
          inboundsConfig: [{ type: 'unknown' }],
        }),
      ).rejects.toThrow('Unsupported inbound type');
    });

    it('должен требовать сертификат и ключ вместе для VLESS TLS', async () => {
      await expect(
        service.create({
          name: 'Invalid TLS',
          inboundsConfig: [
            {
              type: 'vless-tcp-tls',
              port: 443,
              sni: 'example.com',
              certificateMode: 'custom',
              certificateFile: '/cert/fullchain.pem',
            },
          ],
        }),
      ).rejects.toThrow(
        'Custom TLS mode requires certificate and private key paths',
      );
    });

    it('должен принимать корректный FakeTLS-домен для MTProto', async () => {
      const dto: CreateSubscriptionDto = {
        name: 'Telegram',
        inboundsConfig: [
          {
            type: 'mtproto-faketls',
            port: 8443,
            sni: 'www.cloudflare.com',
          },
        ],
      };
      mockSubRepo.create.mockImplementation((value) => value);
      mockSubRepo.save.mockImplementation((value) => Promise.resolve(value));
      mockDomainRepo.findOne.mockResolvedValue({
        name: 'www.cloudflare.com',
        isEnabled: true,
      });

      await expect(service.create(dto)).resolves.toEqual(
        expect.objectContaining({ name: 'Telegram' }),
      );
      expect(mockDomainRepo.findOne).toHaveBeenCalledWith({
        where: { name: 'www.cloudflare.com', isEnabled: true },
      });
    });

    it('должен принимать random для выбора из списка SNI', async () => {
      mockSubRepo.create.mockImplementation((value) => value);
      mockSubRepo.save.mockImplementation((value) => Promise.resolve(value));
      mockDomainRepo.findOne.mockResolvedValue({
        name: 'vk.com',
        isEnabled: true,
      });

      await expect(
        service.create({
          name: 'Telegram',
          inboundsConfig: [
            { type: 'mtproto-faketls', port: 8443, sni: 'random' },
          ],
        }),
      ).resolves.toEqual(expect.objectContaining({ name: 'Telegram' }));
      expect(mockDomainRepo.findOne).toHaveBeenCalledWith({
        where: { isEnabled: true },
      });
    });

    it('должен отклонять FakeTLS-домен вне списка SNI', async () => {
      mockDomainRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          name: 'Telegram',
          inboundsConfig: [
            {
              type: 'mtproto-faketls',
              port: 8443,
              sni: 'outside.example.com',
            },
          ],
        }),
      ).rejects.toThrow(
        'MTProto FakeTLS domain must be selected from enabled SNI domains',
      );
    });

    it('должен отклонять некорректный FakeTLS-домен для MTProto', async () => {
      await expect(
        service.create({
          name: 'Invalid MTProto',
          inboundsConfig: [
            {
              type: 'mtproto-faketls',
              port: 8443,
              sni: 'https://cloudflare.com/path',
            },
          ],
        }),
      ).rejects.toThrow('MTProto FakeTLS domain must be a valid hostname');
    });
  });

  describe('update', () => {
    const existingSub: Subscription = {
      id: 'test-id',
      name: 'Old Name',
      uuid: 'uuid',
      isEnabled: true,
      isAutoRotationEnabled: true,
      inboundsConfig: [],
      inbounds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('должен обновить имя подписки', async () => {
      mockSubRepo.findOne.mockResolvedValue(existingSub);
      mockSubRepo.save.mockResolvedValue({ ...existingSub, name: 'New Name' });

      const result = await service.update('test-id', { name: 'New Name' });

      expect(subRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id' },
        relations: ['inbounds', 'node', 'relayServer'],
      });
      expect(subRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Name' }),
      );
      expect(result).toEqual({ ...existingSub, name: 'New Name' });
    });

    it('должен обновить isAutoRotationEnabled', async () => {
      mockSubRepo.findOne.mockResolvedValue(existingSub);
      mockSubRepo.save.mockResolvedValue({
        ...existingSub,
        isAutoRotationEnabled: false,
      });

      const result = await service.update('test-id', {
        isAutoRotationEnabled: false,
      });

      expect(subRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isAutoRotationEnabled: false }),
      );
      expect(result).toEqual({ ...existingSub, isAutoRotationEnabled: false });
    });

    it('должен обновить inboundsConfig', async () => {
      const newConfig = [{ type: 'vmess-tcp', port: 8080 }];
      mockSubRepo.findOne.mockResolvedValue(existingSub);

      await service.update('test-id', { inboundsConfig: newConfig });

      expect(mockEntityManager.save).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({
          inboundsConfig: [
            expect.objectContaining({
              type: 'vmess-tcp',
              port: 8080,
              configId: expect.any(String),
            }),
          ],
        }),
      );
      expect(mockEntityManager.update).toHaveBeenCalledTimes(2);
    });

    it('НЕ должен обновлять имя на пустую строку (защита от очистки)', async () => {
      mockSubRepo.findOne.mockResolvedValue(existingSub);
      mockSubRepo.save.mockResolvedValue(existingSub);

      await service.update('test-id', { name: '' });

      expect(subRepo.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: '' }),
      );
      expect(subRepo.save).toHaveBeenCalledWith(existingSub);
    });

    it('НЕ должен обновлять имя с пробелами (защита от очистки)', async () => {
      mockSubRepo.findOne.mockResolvedValue(existingSub);
      mockSubRepo.save.mockResolvedValue(existingSub);

      await service.update('test-id', { name: '   ' });

      expect(subRepo.save).toHaveBeenCalledWith(existingSub);
    });

    it('должен вернуть null, если подписка не найдена', async () => {
      mockSubRepo.findOne.mockResolvedValue(null);

      const result = await service.update('non-existent-id', { name: 'New' });

      expect(result).toBeNull();
      expect(subRepo.save).not.toHaveBeenCalled();
    });

    it('должен обновить только isAutoRotationEnabled, не трогая имя', async () => {
      const freshSub: Subscription = {
        ...existingSub,
        name: 'Old Name',
        inboundsConfig: [],
      };
      mockSubRepo.findOne.mockResolvedValue(freshSub);
      mockSubRepo.save.mockImplementation((sub) => Promise.resolve(sub));

      await service.update('test-id', { isAutoRotationEnabled: false });

      expect(subRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Old Name',
          isAutoRotationEnabled: false,
        }),
      );
    });
  });

  describe('remove', () => {
    const subWithInbounds: Subscription = {
      id: 'test-id',
      name: 'Test',
      uuid: 'uuid',
      isEnabled: true,
      isAutoRotationEnabled: true,
      inboundsConfig: [],
      inbounds: [
        {
          id: '1',
          xuiId: 101,
          port: 443,
          protocol: 'vless',
          remark: 'test',
          link: 'link',
          subscription: null as any,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          xuiId: 102,
          port: 8443,
          protocol: 'vmess',
          remark: 'test2',
          link: 'link2',
          subscription: null as any,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('должен удалить инбаунды из 3x-ui перед удалением подписки', async () => {
      mockSubRepo.findOne.mockResolvedValue(subWithInbounds);
      mockSubRepo.remove.mockResolvedValue(undefined);

      await service.remove('test-id');

      expect(xuiService.deleteInbound).toHaveBeenCalledWith(101, undefined);
      expect(xuiService.deleteInbound).toHaveBeenCalledWith(102, undefined);
      expect(subRepo.remove).toHaveBeenCalledWith(subWithInbounds);
    });

    it('должен удалить подписку без инбаундов', async () => {
      const subWithoutInbounds: Subscription = {
        ...subWithInbounds,
        inbounds: [],
      };

      mockSubRepo.findOne.mockResolvedValue(subWithoutInbounds);
      mockSubRepo.remove.mockResolvedValue(undefined);

      await service.remove('test-id');

      expect(xuiService.deleteInbound).not.toHaveBeenCalled();
      expect(subRepo.remove).toHaveBeenCalledWith(subWithoutInbounds);
    });

    it('должен вернуть undefined, если подписка не найдена', async () => {
      mockSubRepo.findOne.mockResolvedValue(null);

      const result = await service.remove('non-existent-id');

      expect(result).toBeUndefined();
      expect(subRepo.remove).not.toHaveBeenCalled();
      expect(xuiService.deleteInbound).not.toHaveBeenCalled();
    });
  });

  describe('certificateMode handling', () => {
    it('defaults to node certificate and ignores leftover certificate paths', async () => {
      mockSubRepo.create.mockImplementation((data) => data);
      mockSubRepo.save.mockImplementation(async (data) => data);

      const sub = await service.create({
        name: 'Test Sub',
        inboundsConfig: [
          {
            type: 'hysteria2-udp',
            port: 443,
            certificateFile: '/root/cert/old.mooo.com/fullchain.pem',
            keyFile: '/root/cert/old.mooo.com/privkey.pem',
          },
        ],
      });

      expect(sub.inboundsConfig[0].certificateMode).toBe('node');
      expect(sub.inboundsConfig[0].certificateFile).toBeUndefined();
      expect(sub.inboundsConfig[0].keyFile).toBeUndefined();
    });

    it('resets certificateMode to node when nodeId is changed on an inbound', async () => {
      const existingSub = {
        id: 'sub-1',
        name: 'Existing Sub',
        inboundsConfig: [
          {
            configId: 'cfg-1',
            type: 'hysteria2-udp',
            port: 443,
            nodeId: 'node-1',
            certificateMode: 'custom',
            certificateFile: '/root/cert/node-1.mooo.com/fullchain.pem',
            keyFile: '/root/cert/node-1.mooo.com/privkey.pem',
            tlsServerName: 'node-1.mooo.com',
          },
        ],
      } as unknown as Subscription;

      mockSubRepo.findOne.mockResolvedValue(existingSub);
      mockNodeRepo.findOne.mockResolvedValue({
        id: 'node-2',
        version: '3.8.5',
        xrayVersion: '26.9.9',
      } as Node);
      mockEntityManager.save.mockImplementation(async (_cls, data) => data);

      const updated = await service.update('sub-1', {
        inboundsConfig: [
          {
            configId: 'cfg-1',
            type: 'hysteria2-udp',
            port: 443,
            nodeId: 'node-2',
            certificateMode: 'custom',
            certificateFile: '/root/cert/node-1.mooo.com/fullchain.pem',
            keyFile: '/root/cert/node-1.mooo.com/privkey.pem',
            tlsServerName: 'node-1.mooo.com',
          },
        ],
      });

      expect(updated?.inboundsConfig[0].nodeId).toBe('node-2');
      expect(updated?.inboundsConfig[0].certificateMode).toBe('node');
      expect(updated?.inboundsConfig[0].certificateFile).toBeUndefined();
      expect(updated?.inboundsConfig[0].keyFile).toBeUndefined();
    });
  });
});
