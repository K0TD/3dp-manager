import { Repository } from 'typeorm';
import { RotationService } from 'src/rotation/rotation.service';
import { Subscription } from 'src/subscriptions/entities/subscription.entity';
import { Inbound, InboundStatus } from 'src/inbounds/entities/inbound.entity';
import { Domain } from 'src/domains/entities/domain.entity';
import { Setting } from 'src/settings/entities/setting.entity';
import { Node } from 'src/nodes/entities/node.entity';
import { Tunnel } from 'src/tunnels/entities/tunnel.entity';
import { RotationOperation } from 'src/rotation/entities/rotation-operation.entity';
import { XuiService } from 'src/xui/xui.service';
import { InboundBuilderService } from 'src/inbounds/inbound-builder.service';

describe('RotationService resilient generations', () => {
  const manager = {
    update: jest.fn().mockResolvedValue({}),
    transaction: jest.fn(
      async (work: (value: typeof manager) => Promise<void>) => work(manager),
    ),
  };
  const subRepo = { find: jest.fn(), save: jest.fn(async (value) => value) };
  const inboundRepo = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: value.id || 500, ...value })),
    update: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    manager,
    createQueryBuilder: jest.fn(),
  };
  const domainRepo = { find: jest.fn() };
  const settingRepo = {
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(),
  };
  const nodeRepo = { createQueryBuilder: jest.fn(), remove: jest.fn() };
  const tunnelRepo = { findOne: jest.fn() };
  const operationRepo = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: 'operation-1', ...value })),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const xuiService = {
    getNewX25519Cert: jest.fn(),
    getWebCertificateFiles: jest.fn(),
    addInbound: jest.fn(),
    deleteInbound: jest.fn(),
  };
  const inboundBuilder = {
    buildVlessRealityTcp: jest.fn(),
    buildVlessRealityXhttp: jest.fn(),
    buildVlessRealityGrpc: jest.fn(),
    buildVlessWs: jest.fn(),
    buildVlessTlsTcp: jest.fn(),
    buildVlessTlsWs: jest.fn(),
    buildVmessTcp: jest.fn(),
    buildShadowsocksTcp: jest.fn(),
    buildTrojanRealityTcp: jest.fn(),
    buildHysteria2Inbound: jest.fn(),
    buildMtprotoInbound: jest.fn(),
    buildInboundLink: jest.fn(),
  };

  const service = new RotationService(
    subRepo as unknown as Repository<Subscription>,
    inboundRepo as unknown as Repository<Inbound>,
    domainRepo as unknown as Repository<Domain>,
    settingRepo as unknown as Repository<Setting>,
    nodeRepo as unknown as Repository<Node>,
    tunnelRepo as unknown as Repository<Tunnel>,
    operationRepo as unknown as Repository<RotationOperation>,
    xuiService as unknown as XuiService,
    inboundBuilder as unknown as InboundBuilderService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    settingRepo.findOne.mockResolvedValue(null);
    inboundRepo.findOne.mockResolvedValue(null);
    xuiService.getWebCertificateFiles.mockResolvedValue({
      certificateFile: '/panel/cert/fullchain.pem',
      keyFile: '/panel/cert/privkey.pem',
    });
  });

  it('keeps the active generation when an unavailable node cannot create keys', async () => {
    const node = { id: 'node-1', name: 'offline', url: 'https://node' } as Node;
    const old = {
      id: 10,
      nodeId: node.id,
      status: InboundStatus.Active,
      protocol: 'vless',
    } as Inbound;
    const subscription = {
      id: 'sub-1',
      name: 'Primary',
      node,
      inbounds: [old],
      inboundsConfig: [
        {
          type: 'vless-tcp-reality',
          nodeId: node.id,
          port: 443,
          sni: 'example.com',
        },
      ],
    } as Subscription;
    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(node),
    });
    xuiService.getNewX25519Cert.mockResolvedValue(null);

    const results = await (service as any).rotateSubscription(
      subscription,
      [{ name: 'example.com' }],
      node,
    );

    expect(results[0]).toMatchObject({ status: 'preserved', nodeId: node.id });
    expect(manager.update).not.toHaveBeenCalled();
    expect(old.status).toBe(InboundStatus.Active);
  });

  it('publishes a complete local generation and retires the old one atomically', async () => {
    const old = {
      id: 11,
      status: InboundStatus.Active,
      protocol: 'custom',
    } as Inbound;
    const subscription = {
      id: 'sub-2',
      name: 'Custom',
      inbounds: [old],
      inboundsConfig: [{ type: 'custom', link: 'vless://new' }],
    } as Subscription;

    const results = await (service as any).rotateSubscription(
      subscription,
      [],
      null,
    );

    expect(results[0]).toMatchObject({
      status: 'succeeded',
      created: 1,
      pendingCleanup: 1,
    });
    expect(manager.transaction).toHaveBeenCalled();
    expect(manager.update).toHaveBeenCalledWith(
      Inbound,
      expect.anything(),
      expect.objectContaining({ status: InboundStatus.PendingCleanup }),
    );
    expect(manager.update).toHaveBeenCalledWith(Inbound, expect.anything(), {
      status: InboundStatus.Active,
    });
  });

  it('generates VLESS TLS without requesting Reality keys and keeps its position', async () => {
    const node = {
      id: 'node-tls',
      name: 'TLS node',
      url: 'https://node',
      healthStatus: 'online',
      consecutiveFailures: 0,
    } as Node;
    const builtInbound = {
      port: 443,
      protocol: 'vless',
      remark: 'vless-tcp-tls',
      settings: JSON.stringify({ clients: [{ id: 'credential' }] }),
      streamSettings: JSON.stringify({ network: 'tcp', security: 'tls' }),
    };
    const subscription = {
      id: 'sub-tls',
      name: 'TLS',
      node,
      inbounds: [],
      inboundsConfig: [
        {
          configId: '11111111-1111-4111-8111-111111111111',
          type: 'vless-tcp-tls',
          nodeId: node.id,
          port: 443,
          sni: 'example.com',
        },
      ],
    } as Subscription;
    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(node),
    });
    xuiService.addInbound.mockResolvedValue(101);
    inboundBuilder.buildVlessTlsTcp.mockReturnValue(builtInbound);
    inboundBuilder.buildInboundLink.mockReturnValue('vless://tls');

    const rotationResults = await (service as any).rotateSubscription(
      subscription,
      [{ name: 'example.com' }],
      node,
    );

    expect(rotationResults[0]).toMatchObject({
      status: 'succeeded',
      created: 1,
    });
    expect(xuiService.getNewX25519Cert).not.toHaveBeenCalled();
    expect(xuiService.getWebCertificateFiles).toHaveBeenCalledWith(node);
    expect(inboundBuilder.buildVlessTlsTcp).toHaveBeenCalledWith({
      port: 443,
      uuid: expect.any(String),
      serverName: 'node',
      certificateFile: '/panel/cert/fullchain.pem',
      keyFile: '/panel/cert/privkey.pem',
    });
    expect(inboundRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configId: '11111111-1111-4111-8111-111111111111',
        position: 0,
      }),
    );
  });

  it('preserves active TLS generation when the node certificate is unavailable', async () => {
    const node = {
      id: 'node-without-cert',
      name: 'TLS node',
      url: 'https://node.example.com',
      healthStatus: 'online',
      consecutiveFailures: 0,
    } as Node;
    const old = {
      id: 12,
      nodeId: node.id,
      status: InboundStatus.Active,
      protocol: 'vless',
    } as Inbound;
    const subscription = {
      id: 'sub-without-cert',
      name: 'TLS without certificate',
      node,
      inbounds: [old],
      inboundsConfig: [
        {
          type: 'vless-tcp-tls',
          nodeId: node.id,
          port: 443,
          certificateMode: 'node',
          sni: 'ok.ru',
        },
      ],
    } as Subscription;
    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(node),
    });
    xuiService.getWebCertificateFiles.mockResolvedValue(null);

    const rotationResults = await (service as any).rotateSubscription(
      subscription,
      [{ name: 'ok.ru' }],
      node,
    );

    expect(rotationResults[0]).toMatchObject({
      status: 'preserved',
      created: 0,
      message: expect.stringContaining('getWebCertFiles'),
    });
    expect(xuiService.addInbound).not.toHaveBeenCalled();
    expect(inboundBuilder.buildVlessTlsTcp).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(old.status).toBe(InboundStatus.Active);
  });

  it('generates MTProto FakeTLS without Reality keys', async () => {
    const node = {
      id: 'node-mtproto',
      name: 'MTProto node',
      url: 'https://node',
      ip: '203.0.113.10',
      version: 'v3.5.0',
      healthStatus: 'online',
      consecutiveFailures: 0,
    } as Node;
    const secret =
      'ee0123456789abcdef0123456789abcdef7777772e636c6f7564666c6172652e636f6d';
    const builtInbound = {
      port: 8443,
      protocol: 'mtproto',
      remark: 'mtproto-faketls',
      settings: JSON.stringify({
        fakeTlsDomain: 'www.cloudflare.com',
        clients: [{ email: 'client', secret }],
      }),
      streamSettings: '',
    };
    const subscription = {
      id: 'sub-mtproto',
      name: 'Telegram',
      node,
      inbounds: [],
      inboundsConfig: [
        {
          configId: '22222222-2222-4222-8222-222222222222',
          type: 'mtproto-faketls',
          nodeId: node.id,
          port: 8443,
          sni: 'www.cloudflare.com',
        },
      ],
    } as Subscription;
    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(node),
    });
    xuiService.addInbound.mockResolvedValue(202);
    inboundBuilder.buildMtprotoInbound.mockReturnValue(builtInbound);
    inboundBuilder.buildInboundLink.mockReturnValue(
      `tg://proxy?server=203.0.113.10&port=8443&secret=${secret}`,
    );

    const rotationResults = await (service as any).rotateSubscription(
      subscription,
      [],
      node,
    );

    expect(rotationResults[0]).toMatchObject({
      status: 'succeeded',
      created: 1,
    });
    expect(xuiService.getNewX25519Cert).not.toHaveBeenCalled();
    expect(inboundBuilder.buildMtprotoInbound).toHaveBeenCalledWith({
      port: 8443,
      uuid: expect.any(String),
      fakeTlsDomain: 'www.cloudflare.com',
    });
    expect(inboundBuilder.buildInboundLink).toHaveBeenCalledWith(
      builtInbound,
      '203.0.113.10',
      secret,
      expect.any(String),
    );
    expect(inboundRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'mtproto',
        configId: '22222222-2222-4222-8222-222222222222',
        position: 0,
      }),
    );
  });

  it('returns an operation id immediately when rotation is queued', async () => {
    const operation = await service.enqueueRotation(['sub-1', 'sub-1']);
    expect(operation).toMatchObject({
      id: 'operation-1',
      subscriptionIds: ['sub-1'],
    });
  });

  it('deletes a cleanup item by id', async () => {
    inboundRepo.findOne.mockResolvedValue({
      id: 55,
      status: InboundStatus.PendingCleanup,
    });
    inboundRepo.delete.mockResolvedValue({ affected: 1 });

    const result = await service.deleteCleanup(55);
    expect(result).toEqual({ success: true });
    expect(inboundRepo.delete).toHaveBeenCalledWith(55);
  });

  it('purges failed cleanup items', async () => {
    inboundRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        { id: 101, cleanupAttempts: 2, status: InboundStatus.PendingCleanup },
        {
          id: 102,
          cleanupAttempts: 0,
          status: InboundStatus.PendingCleanup,
          node: { healthStatus: 'offline' },
        },
      ]),
    });
    inboundRepo.delete.mockResolvedValue({ affected: 1 });

    const result = await service.purgeFailedCleanup();
    expect(result).toEqual({ success: true, purgedCount: 2 });
    expect(inboundRepo.delete).toHaveBeenCalledWith(101);
    expect(inboundRepo.delete).toHaveBeenCalledWith(102);
  });

  it('falls back to default node when the configured nodeId is deleted or not found', async () => {
    const defaultNode = {
      id: 'default-node-id',
      name: 'Default Node',
      isMain: true,
    } as Node;

    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    });

    const resolved = await (service as any).resolveNode(
      'deleted-node-id',
      undefined,
      defaultNode,
    );
    expect(resolved).toBe(defaultNode);
  });

  it('falls back to first available node in getDefaultNode when no node has isMain: true', async () => {
    const fallbackNode = {
      id: 'first-node-id',
      name: 'First Node',
      isMain: false,
    } as Node;

    nodeRepo.createQueryBuilder
      .mockReturnValueOnce({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      })
      .mockReturnValueOnce({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(fallbackNode),
      });

    const node = await (service as any).getDefaultNode();
    expect(node).toBe(fallbackNode);
  });

  it('matches active node by subscription name when nodeId is absent or deleted', async () => {
    const franceNode = {
      id: 'france-node-id',
      name: 'France',
      isMain: false,
    } as Node;

    nodeRepo.createQueryBuilder
      .mockReturnValueOnce({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      })
      .mockReturnValueOnce({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(franceNode),
      });

    const resolved = await (service as any).resolveNode(
      'deleted-node-id',
      { name: 'France' } as Subscription,
      null,
    );
    expect(resolved).toBe(franceNode);
  });

  it('auto-recovers disabled inbound config when an active node is resolved', async () => {
    const defaultNode = {
      id: 'active-node-id',
      name: 'Active Node',
    } as Node;
    const sub = {
      id: 'sub-1',
      name: 'France',
      inboundsConfig: [
        {
          type: 'vless-ws',
          enabled: false,
          disabledReason: 'Нода «france» удалена',
        },
      ],
      inbounds: [],
    } as unknown as Subscription;

    jest.spyOn(service as any, 'resolveNode').mockResolvedValue(defaultNode);
    jest.spyOn(service as any, 'rotateNodeGroup').mockResolvedValue({
      subscriptionId: 'sub-1',
      status: 'succeeded',
      created: 1,
    });
    jest.spyOn(service as any, 'queueCleanup').mockResolvedValue(undefined);

    const results = await (service as any).rotateSubscription(
      sub,
      [],
      defaultNode,
    );

    expect(sub.inboundsConfig[0].enabled).toBe(true);
    expect(sub.inboundsConfig[0].disabledReason).toBeUndefined();
    expect(sub.inboundsConfig[0].nodeId).toBe('active-node-id');
    expect(subRepo.save).toHaveBeenCalledWith(sub);
    expect(results[0].status).toBe('succeeded');
  });

  it('returns descriptive failure when all configs are disabled and no nodes are available', async () => {
    const sub = {
      id: 'sub-1',
      name: 'France',
      inboundsConfig: [
        {
          type: 'vless-ws',
          enabled: false,
          disabledReason: 'Нода «france» удалена',
        },
      ],
      inbounds: [],
    } as unknown as Subscription;

    jest.spyOn(service as any, 'resolveNode').mockResolvedValue(undefined);

    const results = await (service as any).rotateSubscription(sub, [], null);

    expect(results[0].status).toBe('failed');
    expect(results[0].message).toContain(
      'Все конфигурации инбаундов (1) отключены: Нода «france» удалена',
    );
  });
});
