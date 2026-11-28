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
    query: jest.fn(),
    find: jest.fn(),
  };

  const mockSubRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
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
    prepareSubscriptionClient: jest.fn(),
    getSubscriptionUsage: jest.fn(),
  };
  const mockRotationService = { provisionPersistentInbounds: jest.fn() };

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
    mockRotationService.provisionPersistentInbounds.mockResolvedValue({
      status: 'succeeded',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('validates routing profiles on create and update while preserving config IDs', async () => {
    mockSubRepo.create.mockImplementation((value) => value);
    mockSubRepo.save.mockImplementation(async (value) => value);
    const config = {
      type: 'happ-routing',
      configId: 'd1c3d3c1-dac0-453f-9284-297ad877ab12',
      routingProfile: '{}',
    };
    const created = await service.create({
      name: 'Routing',
      inboundsConfig: [config],
    });
    expect(created.inboundsConfig[0]).toMatchObject(config);
    await expect(
      service.create({
        name: 'Invalid',
        inboundsConfig: [{ type: 'incy-routing', routingProfile: '[]' }],
      }),
    ).rejects.toThrow();
    mockSubRepo.findOne.mockResolvedValue({ ...created, inbounds: [] });
    await expect(
      service.update(created.id, {
        inboundsConfig: [{ ...config, routingProfile: 'bad' }],
      }),
    ).rejects.toThrow();
  });

  it('persists and clears subscription metadata', async () => {
    mockSubRepo.create.mockImplementation((value) => value);
    mockSubRepo.save.mockImplementation(async (value) => value);
    const created = await service.create({
      name: 'Test',
      note: 'Note',
      supportUrl: 'https://support.test',
      websiteUrl: 'https://site.test',
    });
    expect(created).toMatchObject({
      note: 'Note',
      supportUrl: 'https://support.test',
      websiteUrl: 'https://site.test',
    });
    mockSubRepo.findOne.mockResolvedValue({ ...created, inbounds: [] });
    const updated = await service.update(created.id, {
      note: '',
      supportUrl: '',
      websiteUrl: '',
    });
    expect(updated).toMatchObject({ note: '', supportUrl: '', websiteUrl: '' });
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
      expect(
        mockRotationService.provisionPersistentInbounds,
      ).toHaveBeenCalledTimes(1);
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
      expect(
        mockRotationService.provisionPersistentInbounds,
      ).not.toHaveBeenCalled();
      await service.update(subscription.id, {
        inboundsConfig: [{ ...config, configId: 'new-awg-config' }],
      });
      expect(
        mockRotationService.provisionPersistentInbounds,
      ).toHaveBeenCalledWith(
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
      mockRotationService.provisionPersistentInbounds.mockResolvedValueOnce({
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
        order: {
          displayOrder: { direction: 'ASC', nulls: 'FIRST' },
          createdAt: 'DESC',
          id: 'DESC',
        },
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

  describe('move', () => {
    it('writes a single ordered list with the selected subscription and its neighbor swapped', async () => {
      mockEntityManager.find.mockResolvedValue([{ id: 'first' }, { id: 'second' }, { id: 'third' }]);

      await expect(service.move({ subscriptionId: 'third', neighborId: 'second', direction: 'up' }))
        .resolves.toEqual({ subscriptionIds: ['first', 'third', 'second'] });
      expect(mockEntityManager.query).toHaveBeenNthCalledWith(1, expect.stringContaining('LOCK TABLE'));
      expect(mockEntityManager.query).toHaveBeenNthCalledWith(
        2, expect.stringContaining('UPDATE "subscription"'), [['first', 'third', 'second']],
      );
    });

    it('rejects a stale neighbor without updating the order', async () => {
      mockEntityManager.find.mockResolvedValue([{ id: 'first' }, { id: 'second' }, { id: 'third' }]);

      await expect(service.move({ subscriptionId: 'third', neighborId: 'first', direction: 'up' }))
        .rejects.toMatchObject({ status: 409 });
      expect(mockEntityManager.query).toHaveBeenCalledTimes(1);
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
          id: 1,
          xuiId: 101,
          port: 443,
          protocol: 'vless',
          remark: 'test',
          link: 'link',
          position: 0,
          status: InboundStatus.Active,
          cleanupAttempts: 0,
          subscription: null as any,
          createdAt: new Date(),
        },
        {
          id: 2,
          xuiId: 102,
          port: 8443,
          protocol: 'vmess',
          remark: 'test2',
          link: 'link2',
          position: 0,
          status: InboundStatus.Active,
          cleanupAttempts: 0,
          subscription: null as any,
          createdAt: new Date(),
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

    it.each(['false', 'throw', 'resolve'])(
      'handles %s panel failure with and without force',
      async (failure) => {
        mockSubRepo.findOne.mockResolvedValue(subWithInbounds);
        if (failure === 'false')
          mockXuiService.deleteInbound.mockResolvedValue(false);
        if (failure === 'throw')
          mockXuiService.deleteInbound.mockRejectedValue(new Error('offline'));
        if (failure === 'resolve')
          jest
            .spyOn(service as any, 'resolveInboundNode')
            .mockRejectedValue(new Error('offline'));
        await expect(service.remove('test-id')).rejects.toMatchObject({
          response: expect.objectContaining({
            code: 'INBOUND_DELETE_FAILED',
            message: expect.stringContaining('101'),
          }),
        });
        expect(mockSubRepo.remove).not.toHaveBeenCalled();
        await service.remove('test-id', true);
        expect(mockSubRepo.remove).toHaveBeenCalledWith(subWithInbounds);
        jest.restoreAllMocks();
      },
    );

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

    it('rejects duplicate fixed ports and Self-SNI localHttpsPort collisions on the same node', async () => {
      mockNodeRepo.findOne.mockResolvedValue({
        id: 'node-1',
        name: 'EU-1',
        version: '3.8.5',
        xrayVersion: '26.7.11',
      } as Node);

      await expect(
        service.create({
          name: 'Port Conflict Sub',
          inboundsConfig: [
            {
              type: 'self-sni',
              port: 443,
              nodeId: 'node-1',
              profileSettings: {
                domain: 'portal.example.com',
                webServer: 'nginx',
                localHttpsPort: 8443,
              },
            },
            {
              type: 'xhttp-stable',
              port: 443,
              sni: 'www.microsoft.com',
              nodeId: 'node-1',
            },
          ],
        }),
      ).rejects.toThrow(/Конфликт порта 443/);

      await expect(
        service.create({
          name: 'Local HTTPS Port Conflict Sub',
          inboundsConfig: [
            {
              type: 'self-sni',
              port: 443,
              nodeId: 'node-1',
              profileSettings: {
                domain: 'portal.example.com',
                webServer: 'nginx',
                localHttpsPort: 8443,
              },
            },
            {
              type: 'xhttp-stable',
              port: 8443,
              sni: 'www.microsoft.com',
              nodeId: 'node-1',
            },
          ],
        }),
      ).rejects.toThrow(/Конфликт порта 8443/);
    });
  });

  describe('3x-ui client binding and usage sync', () => {
    it('keeps default creation backwards-compatible without calling panel client APIs', async () => {
      mockSubRepo.create.mockImplementation((value) => value);
      mockSubRepo.save.mockImplementation(async (value) => value);

      const created = await service.create({ name: 'Standard Sub' });

      expect(created.clientId).toBeUndefined();
      expect(created.clientAutoCreate).toBeUndefined();
      expect(mockXuiService.prepareSubscriptionClient).not.toHaveBeenCalled();
      expect(mockXuiService.getSubscriptionUsage).not.toHaveBeenCalled();
    });

    it('creates and updates subscription with explicit clientId and aggregates usage across nodes', async () => {
      mockSubRepo.create.mockImplementation((value) => value);
      mockSubRepo.save.mockImplementation(async (value) => value);
      const node1 = {
        id: 'node-1',
        name: 'N1',
        version: '3.8.5',
        xrayVersion: '26.7.11',
        webCertificateFile: '/cert/fullchain.pem',
        webKeyFile: '/cert/privkey.pem',
      } as Node;
      const node2 = {
        id: 'node-2',
        name: 'N2',
        version: '3.8.5',
        xrayVersion: '26.7.11',
        webCertificateFile: '/cert/fullchain.pem',
        webKeyFile: '/cert/privkey.pem',
      } as Node;
      const nodesById = new Map([
        ['node-1', node1],
        ['node-2', node2],
      ]);
      mockNodeRepo.findOne.mockImplementation(
        async ({ where }: { where: { id: string } }) => nodesById.get(where.id) || null,
      );
      mockNodeRepo.createQueryBuilder
        .mockReturnValueOnce({
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(node1),
        })
        .mockReturnValueOnce({
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(node2),
        });
      mockXuiService.prepareSubscriptionClient.mockResolvedValue({
        id: 'uuid-alice',
        email: 'alice',
      });
      mockXuiService.getSubscriptionUsage
        .mockResolvedValueOnce({
          upload: 100,
          download: 200,
          total: 5000,
          expire: 1900000000,
        })
        .mockResolvedValueOnce({
          upload: 50,
          download: 150,
          total: 3000,
          expire: 1800000000,
        });

      const created = await service.create({
        name: 'Client Sub',
        clientId: ' alice ',
        inboundsConfig: [
          { type: 'vless-tcp-reality', nodeId: 'node-1', port: 'random', sni: 'ya.ru' },
          { type: 'hysteria2-udp', nodeId: 'node-2', port: 'random' },
        ],
      });

      expect(created.clientId).toBe('alice');
      expect(created.clientAutoCreate).toBe(false);
      expect(created.clientUsage).toEqual({
        upload: 150,
        download: 350,
        total: 8000,
        expire: 1800000000,
      });

      // Clearing clientId resets clientAutoCreate and clientUsage
      mockSubRepo.findOne.mockResolvedValue({ ...created, inbounds: [] });
      const updated = await service.update(created.id, { clientId: '' });
      expect(updated?.clientId).toBeNull();
      expect(updated?.clientAutoCreate).toBe(false);
      expect(updated?.clientUsage).toBeNull();
    });

    it('generates 3dp-* clientId when clientAutoCreate is true and syncs usage on demand', async () => {
      mockSubRepo.create.mockImplementation((value) => value);
      mockSubRepo.save.mockImplementation(async (value) => value);
      const mainNode = { id: 'main', isMain: true, version: '3.8.5' } as Node;
      mockNodeRepo.createQueryBuilder.mockReturnValue({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mainNode),
      });
      mockXuiService.prepareSubscriptionClient.mockImplementation(
        async (email: string) => ({ id: 'uuid-gen', email }),
      );
      mockXuiService.getSubscriptionUsage.mockResolvedValue({
        upload: 10,
        download: 20,
        total: 0,
        expire: 0,
      });

      const created = await service.create({
        name: 'Auto Client',
        clientAutoCreate: true,
      });

      expect(created.clientId).toMatch(/^3dp-/);
      expect(created.clientAutoCreate).toBe(true);
      expect(mockXuiService.prepareSubscriptionClient).toHaveBeenCalledWith(
        created.clientId,
        true,
        mainNode,
      );

      // Runtime syncClientUsage updates stored usage without auto-creating again
      await service.syncClientUsage(created, false);
      expect(mockXuiService.prepareSubscriptionClient).toHaveBeenLastCalledWith(
        created.clientId,
        false,
        mainNode,
      );
      expect(mockSubRepo.update).toHaveBeenCalledWith(
        { id: created.id, clientId: created.clientId },
        { clientUsage: { upload: 10, download: 20, total: 0, expire: 0 } },
      );
    });
  });
});
