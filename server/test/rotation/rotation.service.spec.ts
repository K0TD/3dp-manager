import { Repository } from 'typeorm';
import { SubscriptionLockService } from 'src/subscriptions/subscription-lock.service';
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
  const subRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(async (value) => value),
  };
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
    waitForXray: jest.fn(),
    deleteInbound: jest.fn(),
    getLastInboundError: jest.fn(),
  };
  const inboundBuilder = {
    buildVlessRealityTcp: jest.fn(),
    buildVlessRealityXhttp: jest.fn(),
    buildVlessRealityGrpc: jest.fn(),
    buildVlessWs: jest.fn(),
    buildVlessTlsTcp: jest.fn(),
    buildVlessTlsWs: jest.fn(),
    buildVlessTlsXhttp: jest.fn(),
    buildAmneziaWgInbound: jest.fn(),
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
    {
      run: jest.fn(async (_id, work) => work()),
    } as unknown as SubscriptionLockService,
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    xuiService.waitForXray.mockResolvedValue(undefined);
    settingRepo.findOne.mockResolvedValue(null);
    inboundRepo.findOne.mockResolvedValue(null);
    xuiService.getWebCertificateFiles.mockResolvedValue({
      certificateFile: '/panel/cert/fullchain.pem',
      keyFile: '/panel/cert/privkey.pem',
    });
  });

  describe('persistent AmneziaWG', () => {
    const node = { id: 'awg-node', name: 'AWG', version: '3.7.0' } as Node;
    const config = {
      configId: 'awg-config',
      type: 'amneziawg',
      nodeId: node.id,
      port: 'random',
    };
    const awg = {
      id: 501,
      configId: config.configId,
      protocol: 'amneziawg',
      nodeId: node.id,
      port: 51820,
      status: InboundStatus.Active,
      link: 'vpn://existing',
    } as Inbound;
    const subscription = () =>
      ({
        id: 'awg-sub',
        name: 'AWG',
        isEnabled: true,
        isAutoRotationEnabled: true,
        inboundsConfig: [{ ...config }],
        inbounds: [{ ...awg }],
      }) as Subscription;

    it('treats an AWG-only rotation as successful without touching the panel', async () => {
      const result = await (service as any).rotateSubscription(
        subscription(),
        [],
        node,
      );
      expect(result[0]).toMatchObject({
        status: 'succeeded',
        created: 0,
        pendingCleanup: 0,
      });
      expect(xuiService.addInbound).not.toHaveBeenCalled();
      expect(inboundRepo.update).not.toHaveBeenCalled();
    });

    it('keeps AWG on the same node when replacing regular inbounds', async () => {
      const sub = subscription();
      const old = {
        id: 502,
        nodeId: node.id,
        protocol: 'vless',
        status: InboundStatus.Active,
      };
      sub.inbounds.push(old as Inbound);
      jest
        .spyOn(service as any, 'preflightNodeGroup')
        .mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'createInbound')
        .mockResolvedValue({ id: 503 });
      const result = await (service as any).rotateNodeGroup(
        sub,
        node.id,
        {
          node,
          configs: [{ config: { type: 'vless-tcp-tls' }, position: 1 }],
        },
        [],
      );
      expect(result).toMatchObject({
        status: 'succeeded',
        created: 1,
        pendingCleanup: 1,
      });
      const retired = inboundRepo.manager.transaction.mock.calls;
      expect(retired).toHaveLength(1);
      expect(manager.update).toHaveBeenCalledWith(
        Inbound,
        { id: expect.objectContaining({ _value: [502] }) },
        expect.objectContaining({ status: InboundStatus.PendingCleanup }),
      );
      expect(sub.inbounds[0]).toMatchObject(awg);
    });

    it('excludes AWG on another node from obsolete group cleanup', async () => {
      const sub = subscription();
      sub.inboundsConfig.push({
        type: 'custom',
        configId: 'custom',
        link: 'vless://custom',
      });
      jest
        .spyOn(service as any, 'rotateNodeGroup')
        .mockResolvedValue({ status: 'succeeded' });
      const cleanup = jest
        .spyOn(service as any, 'queueCleanup')
        .mockResolvedValue(undefined);
      await (service as any).rotateSubscription(sub, [], node);
      expect(cleanup).toHaveBeenCalledWith([]);
    });

    it('retires removed regular inbounds when only AWG remains', async () => {
      const sub = subscription();
      const old = {
        id: 502,
        nodeId: node.id,
        protocol: 'vless',
        status: InboundStatus.Active,
      } as Inbound;
      sub.inbounds.push(old);
      const cleanup = jest
        .spyOn(service as any, 'queueCleanup')
        .mockResolvedValue(undefined);
      const result = await (service as any).rotateSubscription(sub, [], node);
      expect(cleanup).toHaveBeenCalledWith([old]);
      expect(result[0]).toMatchObject({
        status: 'succeeded',
        created: 0,
        pendingCleanup: 1,
      });
    });

    it('creates missing AWG once and preserves it on repeated saves', async () => {
      const sub = subscription();
      sub.inbounds = [];
      jest.spyOn(service as any, 'getDefaultNode').mockResolvedValue(node);
      jest.spyOn(service as any, 'resolveNode').mockResolvedValue(node);
      const create = jest
        .spyOn(service as any, 'createInbound')
        .mockResolvedValue({
          ...awg,
          status: InboundStatus.Staged,
          subscription: sub,
          node: { ...node, password: 'panel-secret' },
        });
      expect(await service.provisionAmnezia(sub)).toEqual({
        status: 'succeeded',
      });
      expect(await service.provisionAmnezia(sub)).toEqual({
        status: 'succeeded',
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(inboundRepo.update).toHaveBeenCalledWith(awg.id, {
        status: InboundStatus.Active,
      });
      expect(sub.inbounds[0].port).toBe(51820);
      expect(() => JSON.stringify(sub)).not.toThrow();
      expect(JSON.stringify(sub)).not.toContain('panel-secret');
    });

    it('reports panel failure and retries only the missing configuration', async () => {
      const sub = subscription();
      sub.inboundsConfig.push({ ...config, configId: 'second-awg' });
      jest.spyOn(service as any, 'getDefaultNode').mockResolvedValue(node);
      jest.spyOn(service as any, 'resolveNode').mockResolvedValue(node);
      const create = jest
        .spyOn(service as any, 'createInbound')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...awg,
          id: 504,
          configId: 'second-awg',
          status: InboundStatus.Staged,
        });
      expect(await service.provisionAmnezia(sub)).toMatchObject({
        status: 'failed',
      });
      expect(await service.provisionAmnezia(sub)).toMatchObject({
        status: 'succeeded',
      });
      expect(create).toHaveBeenCalledTimes(2);
      expect(
        create.mock.calls.every(
          ([request]) =>
            (request as any).positionedConfig.config.configId === 'second-awg',
        ),
      ).toBe(true);
      expect(sub.inbounds[0].status).toBe(InboundStatus.Active);
    });

    it('preserves ambiguous legacy AWG without generating a replacement', async () => {
      const sub = subscription();
      sub.inbounds[0].configId = undefined;
      expect(await service.provisionAmnezia(sub)).toMatchObject({
        status: 'failed',
      });
      expect(xuiService.addInbound).not.toHaveBeenCalled();
      expect(inboundRepo.update).not.toHaveBeenCalled();
    });

    it.each([undefined, ['awg-sub']])(
      'reloads the subscription under the lock for scheduled and manual rotation (%s)',
      async (ids) => {
        const sub = subscription();
        subRepo.find.mockResolvedValue([sub]);
        subRepo.findOne.mockResolvedValue(sub);
        domainRepo.find.mockResolvedValue([]);
        jest.spyOn(service as any, 'getDefaultNode').mockResolvedValue(node);
        expect(await service.performRotation(ids)).toMatchObject({
          success: true,
        });
        expect(subRepo.findOne).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: sub.id } }),
        );
        expect(xuiService.addInbound).not.toHaveBeenCalled();
      },
    );
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

  it.each([
    ['tcp', 'node'],
    ['xhttp', 'node'],
    ['xhttp', 'custom'],
  ] as const)(
    'generates VLESS %s TLS (%s certificate) without Reality keys and keeps its position',
    async (network, certificateMode) => {
      const buildTls =
        network === 'tcp'
          ? inboundBuilder.buildVlessTlsTcp
          : inboundBuilder.buildVlessTlsXhttp;
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
        remark: `vless-${network}-tls`,
        settings: JSON.stringify({ clients: [{ id: 'credential' }] }),
        streamSettings: JSON.stringify({ network, security: 'tls' }),
      };
      const subscription = {
        id: 'sub-tls',
        name: 'TLS',
        node,
        inbounds: [],
        inboundsConfig: [
          {
            configId: '11111111-1111-4111-8111-111111111111',
            type: `vless-${network}-tls`,
            nodeId: node.id,
            port: 443,
            sni: 'example.com',
            certificateMode,
            ...(certificateMode === 'custom'
              ? {
                  tlsServerName: 'custom.example.com',
                  certificateFile: '/custom/fullchain.pem',
                  keyFile: '/custom/privkey.pem',
                }
              : {}),
          },
        ],
      } as Subscription;
      nodeRepo.createQueryBuilder.mockReturnValue({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(node),
      });
      xuiService.addInbound.mockResolvedValue({
        id: 101,
        inbound: builtInbound,
      });
      buildTls.mockReturnValue(builtInbound);
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
      if (certificateMode === 'node')
        expect(xuiService.getWebCertificateFiles).toHaveBeenCalledWith(node);
      else expect(xuiService.getWebCertificateFiles).not.toHaveBeenCalled();
      expect(buildTls).toHaveBeenCalledWith({
        port: 443,
        uuid: expect.any(String),
        email: expect.any(String),
        serverName: certificateMode === 'node' ? 'node' : 'custom.example.com',
        certificateFile:
          certificateMode === 'node'
            ? '/panel/cert/fullchain.pem'
            : '/custom/fullchain.pem',
        keyFile:
          certificateMode === 'node'
            ? '/panel/cert/privkey.pem'
            : '/custom/privkey.pem',
      });
      expect(inboundRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          configId: '11111111-1111-4111-8111-111111111111',
          position: 0,
        }),
      );
    },
  );

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

  it('generates MTProto FakeTLS with a domain from the SNI list', async () => {
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
        fakeTlsDomain: 'vk.com',
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
          sni: 'random',
        },
      ],
    } as Subscription;
    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(node),
    });
    xuiService.addInbound.mockResolvedValue({ id: 202, inbound: builtInbound });
    inboundBuilder.buildMtprotoInbound.mockReturnValue(builtInbound);
    inboundBuilder.buildInboundLink.mockReturnValue(
      `tg://proxy?server=203.0.113.10&port=8443&secret=${secret}`,
    );

    const rotationResults = await (service as any).rotateSubscription(
      subscription,
      [{ name: 'vk.com', isEnabled: true }],
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
      email: expect.any(String),
      fakeTlsDomain: 'vk.com',
    });
    expect(inboundBuilder.buildInboundLink).toHaveBeenCalledWith(
      builtInbound,
      '203.0.113.10',
      '',
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

  it('replaces a removed MTProto SNI with a current domain from the list', () => {
    const resolvedSni = (service as any).resolveInboundSni(
      { type: 'mtproto-faketls', sni: 'removed.example.com' },
      [{ name: 'vk.com', isEnabled: true }],
    );

    expect(resolvedSni).toBe('vk.com');
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

    const resolveNodeSpy = jest
      .spyOn(service as any, 'resolveNode')
      .mockResolvedValue(defaultNode);
    const rotateNodeGroupSpy = jest
      .spyOn(service as any, 'rotateNodeGroup')
      .mockResolvedValue({
        subscriptionId: 'sub-1',
        status: 'succeeded',
        created: 1,
      });
    const queueCleanupSpy = jest
      .spyOn(service as any, 'queueCleanup')
      .mockResolvedValue(undefined);

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

    resolveNodeSpy.mockRestore();
    rotateNodeGroupSpy.mockRestore();
    queueCleanupSpy.mockRestore();
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

    const resolveNodeSpy = jest
      .spyOn(service as any, 'resolveNode')
      .mockResolvedValue(undefined);

    const results = await (service as any).rotateSubscription(sub, [], null);

    expect(results[0].status).toBe('failed');
    expect(results[0].message).toContain(
      'Все конфигурации инбаундов (1) отключены: Нода «france» удалена',
    );

    resolveNodeSpy.mockRestore();
  });

  it('preserves the generation when one requested inbound is rejected', async () => {
    const node = {
      id: 'node-partial',
      name: 'Partial node',
      url: 'https://node-partial.example.com',
      healthStatus: 'online',
      consecutiveFailures: 0,
    } as Node;
    const subscription = {
      id: 'sub-partial',
      name: 'Partial Sub',
      node,
      inbounds: [],
      inboundsConfig: [
        { type: 'vless-ws', nodeId: node.id, port: 8080, sni: 'ya.ru' },
        { type: 'vmess-tcp', nodeId: node.id, port: 8081 },
      ],
    } as unknown as Subscription;

    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(node),
    });

    inboundBuilder.buildVlessWs.mockReturnValue({
      remark: 'vless-ws',
      protocol: 'vless',
      settings: JSON.stringify({ clients: [{ id: 'u1' }] }),
    });
    inboundBuilder.buildVmessTcp.mockReturnValue({
      remark: 'vmess-tcp',
      protocol: 'vmess',
      settings: JSON.stringify({ clients: [{ id: 'u2' }] }),
    });
    inboundBuilder.buildInboundLink.mockReturnValue('vless://mock');

    // 1st inbound succeeds, 2nd fails
    xuiService.addInbound
      .mockResolvedValueOnce({
        id: 201,
        inbound: {
          port: 8080,
          protocol: 'vless',
          settings: '{}',
          streamSettings: '{}',
        },
      })
      .mockResolvedValueOnce(null);
    xuiService.getLastInboundError.mockReturnValue('Go struct unmarshal error');

    const loggerWarnSpy = jest.spyOn((service as any).logger, 'warn');

    const results = await (service as any).rotateSubscription(
      subscription,
      [{ name: 'ya.ru' }],
      node,
    );

    expect(results[0]).toMatchObject({
      status: 'preserved',
      created: 0,
    });
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Сводка отклонённых панелью инбаундов'),
    );
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Go struct unmarshal error'),
    );
  });

  it('preserves existing generation when all inbounds in a group are rejected', async () => {
    const node = {
      id: 'node-all-fail',
      name: 'Failing node',
      url: 'https://node-fail.example.com',
      healthStatus: 'online',
      consecutiveFailures: 0,
    } as Node;
    const oldInbound = {
      id: 55,
      nodeId: node.id,
      status: InboundStatus.Active,
      protocol: 'vless',
    } as Inbound;
    const subscription = {
      id: 'sub-all-fail',
      name: 'All Fail Sub',
      node,
      inbounds: [oldInbound],
      inboundsConfig: [
        { type: 'vless-ws', nodeId: node.id, port: 8080, sni: 'ya.ru' },
      ],
    } as unknown as Subscription;

    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(node),
    });

    inboundBuilder.buildVlessWs.mockReturnValue({
      remark: 'vless-ws',
      protocol: 'vless',
      settings: JSON.stringify({ clients: [{ id: 'u1' }] }),
    });
    inboundBuilder.buildInboundLink.mockReturnValue('vless://mock');

    xuiService.addInbound.mockResolvedValue(null);
    xuiService.getLastInboundError.mockReturnValue('Port 8080 already in use');

    const results = await (service as any).rotateSubscription(
      subscription,
      [{ name: 'ya.ru' }],
      node,
    );

    expect(results[0]).toMatchObject({
      status: 'preserved',
      created: 0,
      message: expect.stringContaining('Port 8080 already in use'),
    });
    expect(oldInbound.status).toBe(InboundStatus.Active);
  });
  describe('verified creation and port selection', () => {
    const node = {
      id: 'ports',
      name: 'ports',
      url: 'https://panel.example',
      domain: 'public.example',
    } as Node;
    const built = {
      enable: true,
      protocol: 'vmess',
      port: 20000,
      settings: '{"clients":[{"id":"saved"}]}',
      streamSettings: '{"network":"tcp"}',
    };
    const request = (port: number | string = 'random') => ({
      subscription: { id: 'ports-sub', inbounds: [] },
      node,
      domains: [],
      positionedConfig: { position: 0, config: { type: 'vmess-tcp', port } },
      usedPorts: new Set<number>(),
      generationId: 'gen',
    });
    beforeEach(() => {
      inboundBuilder.buildVmessTcp.mockReturnValue({ ...built });
      inboundBuilder.buildInboundLink.mockReturnValue('vmess://saved');
      xuiService.addInbound.mockReset();
    });
    it('uses the actual saved port in the database and link after a conflict', async () => {
      xuiService.addInbound
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 300, inbound: { ...built, port: 25001 } });
      xuiService.getLastInboundError.mockReturnValue(
        'Port 20000 is already in use',
      );
      const result = await (service as any).createInbound(request());
      expect(result.port).toBe(25001);
      expect(inboundBuilder.buildInboundLink).toHaveBeenCalledWith(
        expect.objectContaining({ port: 25001 }),
        'public.example',
        '',
        expect.any(String),
      );
      expect(xuiService.addInbound).toHaveBeenCalledTimes(2);
    });
    it('does not change an explicitly selected occupied port', async () => {
      xuiService.addInbound.mockResolvedValue(null);
      xuiService.getLastInboundError.mockReturnValue(
        'Port 20000 is already in use',
      );
      expect(await (service as any).createInbound(request(20000))).toBeNull();
      expect(xuiService.addInbound).toHaveBeenCalledTimes(1);
    });
    it('queues ownership for cleanup when detail verification fails', async () => {
      xuiService.addInbound.mockResolvedValue({
        id: 300,
        inbound: built,
        verificationError: 'detail unavailable',
      });
      await expect((service as any).createInbound(request())).rejects.toThrow(
        'detail unavailable',
      );
      expect(inboundRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            xuiId: 300,
            status: InboundStatus.PendingCleanup,
          }),
        ]),
      );
      expect(inboundBuilder.buildInboundLink).not.toHaveBeenCalled();
    });
    it('preserves the old group and cleans up the staged generation when Xray fails', async () => {
      const old = {
        id: 44,
        nodeId: node.id,
        status: InboundStatus.Active,
        protocol: 'vmess',
      };
      xuiService.addInbound.mockResolvedValue({ id: 300, inbound: built });
      xuiService.waitForXray.mockRejectedValue(new Error('Xray stopped'));
      const result = await (service as any).rotateNodeGroup(
        { id: 'sub', inbounds: [old] },
        node.id,
        { node, configs: [request().positionedConfig] },
        [],
      );
      expect(result.status).toBe('preserved');
      expect(result.message).toContain('Xray stopped');
      expect(manager.transaction).not.toHaveBeenCalled();
      expect(old.status).toBe(InboundStatus.Active);
    });
  });

  describe('cleanupZeroTrafficOrphans', () => {
    const testNode = { id: 'node-clean-1', name: 'CleanNode' } as Node;

    it('удаляет устаревший одиночный инбаунд с 0 B расхода, не привязанный к активным подпискам', async () => {
      inboundRepo.find = jest.fn().mockResolvedValue([
        { xuiId: 200, status: InboundStatus.Active },
      ]);
      (xuiService as any).listRoutingInbounds = jest.fn().mockResolvedValue([
        {
          id: 97,
          remark: 'xhttp-reality',
          protocol: 'vless',
          up: 0,
          down: 0,
          clientStats: [{ id: 108, up: 0, down: 0, lastOnline: 0 }],
          settings: JSON.stringify({
            clients: [
              {
                id: 'uuid-1',
                email: 'test-email',
                created_at: Date.now() - 3600 * 1000,
              },
            ],
          }),
        },
      ]);
      xuiService.deleteInbound.mockResolvedValue(true);

      const cleaned = await service.cleanupZeroTrafficOrphans(testNode);

      expect(cleaned).toBe(1);
      expect(xuiService.deleteInbound).toHaveBeenCalledWith(97, testNode);
    });

    it('НЕ удаляет инбаунд, если его xuiId отслеживается в БД как Active/Staged', async () => {
      inboundRepo.find = jest.fn().mockResolvedValue([
        { xuiId: 97, status: InboundStatus.Active },
      ]);
      (xuiService as any).listRoutingInbounds = jest.fn().mockResolvedValue([
        {
          id: 97,
          up: 0,
          down: 0,
          clientStats: [{ up: 0, down: 0, lastOnline: 0 }],
          settings: JSON.stringify({ clients: [{ created_at: 1000 }] }),
        },
      ]);

      const cleaned = await service.cleanupZeroTrafficOrphans(testNode);

      expect(cleaned).toBe(0);
      expect(xuiService.deleteInbound).not.toHaveBeenCalled();
    });

    it('НЕ удаляет инбаунд, если у него есть ненулевой расход трафика', async () => {
      inboundRepo.find = jest.fn().mockResolvedValue([]);
      (xuiService as any).listRoutingInbounds = jest.fn().mockResolvedValue([
        {
          id: 98,
          up: 1024,
          down: 2048,
          clientStats: [{ up: 1024, down: 2048 }],
          settings: JSON.stringify({ clients: [{ created_at: 1000 }] }),
        },
      ]);

      const cleaned = await service.cleanupZeroTrafficOrphans(testNode);

      expect(cleaned).toBe(0);
      expect(xuiService.deleteInbound).not.toHaveBeenCalled();
    });

    it('НЕ удаляет инбаунд с несколькими клиентами (защита персональных инбаундов)', async () => {
      inboundRepo.find = jest.fn().mockResolvedValue([]);
      (xuiService as any).listRoutingInbounds = jest.fn().mockResolvedValue([
        {
          id: 1,
          remark: 'Multi-client',
          up: 0,
          down: 0,
          clientStats: [
            { id: 1, up: 0, down: 0 },
            { id: 2, up: 0, down: 0 },
          ],
          settings: JSON.stringify({
            clients: [{ id: 'c1' }, { id: 'c2' }],
          }),
        },
      ]);

      const cleaned = await service.cleanupZeroTrafficOrphans(testNode);

      expect(cleaned).toBe(0);
      expect(xuiService.deleteInbound).not.toHaveBeenCalled();
    });

    it('НЕ удаляет только что созданный инбаунд (защита по времени создания < 5 минут)', async () => {
      inboundRepo.find = jest.fn().mockResolvedValue([]);
      (xuiService as any).listRoutingInbounds = jest.fn().mockResolvedValue([
        {
          id: 99,
          up: 0,
          down: 0,
          clientStats: [{ up: 0, down: 0, lastOnline: 0 }],
          settings: JSON.stringify({
            clients: [{ created_at: Date.now() - 30 * 1000 }], // 30 sec ago
          }),
        },
      ]);

      const cleaned = await service.cleanupZeroTrafficOrphans(testNode);

      expect(cleaned).toBe(0);
      expect(xuiService.deleteInbound).not.toHaveBeenCalled();
    });
  });
});
