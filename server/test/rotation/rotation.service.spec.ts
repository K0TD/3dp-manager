import { In, Repository } from 'typeorm';
import { SubscriptionLockService } from 'src/subscriptions/subscription-lock.service';
import { NodeDeletionService } from 'src/nodes/node-deletion.service';
import { ClientProbeService } from 'src/profiles/client-probe.service';
import { RotationService, inboundConfigVersion } from 'src/rotation/rotation.service';
import { Subscription } from 'src/subscriptions/entities/subscription.entity';
import { Inbound, InboundStatus } from 'src/inbounds/entities/inbound.entity';
import { Domain } from 'src/domains/entities/domain.entity';
import { Setting } from 'src/settings/entities/setting.entity';
import { Node } from 'src/nodes/entities/node.entity';
import { Tunnel } from 'src/tunnels/entities/tunnel.entity';
import { RotationOperation } from 'src/rotation/entities/rotation-operation.entity';
import { XuiService } from 'src/xui/xui.service';
import { InboundBuilderService } from 'src/inbounds/inbound-builder.service';
import { databaseAvailability } from 'src/database/database-availability';
import { Logger } from '@nestjs/common';

describe('RotationService resilient generations', () => {
  const manager = {
    update: jest.fn().mockResolvedValue({}),
    findOneBy: jest.fn().mockResolvedValue({ flag: null }),
    findOne: jest.fn().mockResolvedValue(null),
    transaction: jest.fn(
      async (work: (value: { update: jest.Mock }) => Promise<void>) =>
        work(manager),
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
    find: jest.fn(),
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
    assertXrayHealthy: jest.fn(),
    getNewX25519Cert: jest.fn(),
    getWebCertificateFiles: jest.fn(),
    addInbound: jest.fn(),
    waitForXray: jest.fn(),
    deleteInbound: jest.fn(),
    getLastInboundError: jest.fn(),
    getInbound: jest.fn(),
  };
  const inboundBuilder = {
    buildVlessRealityTcp: jest.fn(),
    buildVlessRealityXhttp: jest.fn(),
    buildVlessXhttpGet: jest.fn(),
    buildXhttpStableInbound: jest.fn(),
    buildXhttpStableClientBundle: jest.fn(),
    buildSelfSniInbound: jest.fn(),
    buildSelfSniClientBundle: jest.fn(),
    buildHttpsFallbackInbound: jest.fn(),
    buildHttpsFallbackClientBundle: jest.fn(),
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

  const nodeDeletion = new NodeDeletionService();
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
    nodeDeletion,
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    databaseAvailability.reset();
    xuiService.waitForXray.mockResolvedValue(undefined);
    settingRepo.findOne.mockResolvedValue(null);
    inboundRepo.findOne.mockResolvedValue(null);
    xuiService.getWebCertificateFiles.mockResolvedValue({
      certificateFile: '/panel/cert/fullchain.pem',
      keyFile: '/panel/cert/privkey.pem',
    });
  });

  it('persists normalized details next to the legacy operation and node messages', async () => {
    const operation = { id: 'operation', status: 'queued', results: [] };
    operationRepo.findOne.mockResolvedValue(operation);
    jest.spyOn(service, 'performRotation').mockResolvedValue({
      success: false,
      message: 'Node is unreachable (ECONNREFUSED)',
      results: [
        {
          subscriptionId: 'sub',
          subscriptionName: 'Sub',
          nodeName: 'Node',
          status: 'preserved',
          created: 0,
          pendingCleanup: 0,
          message: 'Node is unreachable (ECONNREFUSED)',
        },
      ],
    });
    await service.processQueuedOperation();
    expect(operationRepo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: 'Node is unreachable (ECONNREFUSED)',
        errorDetails: expect.objectContaining({
          code: 'ECONNREFUSED',
          node: 'Node',
        }),
        results: [
          expect.objectContaining({
            message: 'Node is unreachable (ECONNREFUSED)',
            errorDetails: expect.objectContaining({ code: 'ECONNREFUSED' }),
          }),
        ],
      }),
    );
    await expect(service.getOperation('operation')).resolves.toBe(operation);
  });

  it('normalizes unexpected operation failures without saving credentials', async () => {
    const operation = { id: 'operation', status: 'queued', results: [] };
    operationRepo.findOne.mockResolvedValue(operation);
    jest
      .spyOn(service, 'performRotation')
      .mockRejectedValue(new Error('password=shortsecret connect ECONNRESET'));
    await service.processQueuedOperation();
    expect(operationRepo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: expect.not.stringContaining('shortsecret'),
        errorDetails: expect.objectContaining({
          code: 'ECONNRESET',
          raw: expect.not.stringContaining('shortsecret'),
        }),
      }),
    );
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
        configId: 'regular',
        nodeId: node.id,
        protocol: 'vless',
        status: InboundStatus.Active,
      };
      sub.inbounds.push(old as Inbound);
      jest
        .spyOn(service as any, 'createInbound')
        .mockResolvedValue({ id: 503 });
      const result = await (service as any).rotateNodeGroup(
        sub,
        node.id,
        {
          node,
          configs: [{ config: { configId: 'regular', type: 'vless-tcp-tls', certificateMode: 'custom' }, position: 1 }],
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
        configId: 'regular',
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
      expect(await service.provisionPersistentInbounds(sub)).toEqual({
        status: 'succeeded',
      });
      expect(await service.provisionPersistentInbounds(sub)).toEqual({
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
      expect(await service.provisionPersistentInbounds(sub)).toMatchObject({
        status: 'failed',
      });
      expect(await service.provisionPersistentInbounds(sub)).toMatchObject({
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
      expect(await service.provisionPersistentInbounds(sub)).toMatchObject({
        status: 'failed',
      });
      expect(xuiService.addInbound).not.toHaveBeenCalled();
      expect(inboundRepo.update).not.toHaveBeenCalled();
    });

    it.each<[string[] | undefined]>([[undefined], [['awg-sub']]])(
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
      configId: 'old-reality',
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
          configId: 'old-reality', type: 'vless-tcp-reality',
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

  it('queues obsolete ordinary inbounds when only routing profiles remain', async () => {
    const old = {
      id: 11,
      status: InboundStatus.Active,
      protocol: 'vless',
      configId: 'removed',
      link: 'vless://old',
    };
    const persistent = {
      id: 12,
      status: InboundStatus.Active,
      protocol: 'amneziawg',
    };
    const alreadyPending = {
      id: 13,
      status: InboundStatus.PendingCleanup,
      protocol: 'vless',
    };
    const subscription = {
      id: 'routing',
      name: 'Routing',
      inbounds: [old, persistent, alreadyPending],
      inboundsConfig: [
        { type: 'happ-routing', configId: 'route', routingProfile: '{}' },
      ],
    } as Subscription;
    const result = await (service as any).rotateSubscription(
      subscription,
      [],
      null,
    );
    expect(result).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        created: 0,
        pendingCleanup: 1,
      }),
    ]);
    expect(old.status).toBe(InboundStatus.PendingCleanup);
    expect(old).toHaveProperty('nextCleanupAt', expect.any(Date));
    expect(inboundRepo.update).toHaveBeenCalledWith(
      { id: In([old.id]) },
      { status: InboundStatus.PendingCleanup, nextCleanupAt: expect.any(Date) },
    );
    expect(persistent.status).toBe(InboundStatus.Active);
    expect(manager.transaction).not.toHaveBeenCalled();
    expect(xuiService.addInbound).not.toHaveBeenCalled();
  });

  it('keeps original positions when routing profiles are interleaved', async () => {
    const sub = {
      id: 'mixed',
      name: 'Mixed',
      inbounds: [],
      inboundsConfig: [
        { type: 'happ-routing', configId: 'route', routingProfile: '{}' },
        { type: 'custom', configId: 'connection', link: 'vless://test' },
        { type: 'incy-routing', routingProfile: '{}' },
      ],
    } as Subscription;
    const result = await (service as any).rotateSubscription(sub, [], null);
    expect(result).toEqual([
      expect.objectContaining({ status: 'succeeded', created: 1 }),
    ]);
    expect(inboundRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ configId: 'connection', position: 1 }),
    );
    expect(xuiService.addInbound).not.toHaveBeenCalled();
  });

  it('rotates XHTTP GET without SNI or Reality keys using the relay and configured position', async () => {
    const node = {
      id: 'node-get',
      name: 'GET',
      flag: 'flag',
      host: 'node.example',
      healthStatus: 'online',
    } as Node;
    const sub = {
      id: 'get-sub',
      name: 'GET',
      node,
      inbounds: [],
      inboundsConfig: [
        { type: 'happ-routing', routingProfile: '{}' },
        {
          type: 'vless-xhttp-get',
          nodeId: node.id,
          relayServerId: 7,
          port: 8080,
          sni: 'random',
          configId: 'get-config',
        },
      ],
    } as Subscription;
    const built = {
      port: 8080,
      protocol: 'vless',
      settings: JSON.stringify({ clients: [{ id: 'id' }] }),
      streamSettings: JSON.stringify({ network: 'xhttp', security: 'none' }),
    };
    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(node),
    });
    tunnelRepo.findOne.mockResolvedValue({
      id: 7,
      nodeId: node.id,
      domain: 'relay.example',
    });
    inboundBuilder.buildVlessXhttpGet.mockReturnValue(built);
    inboundBuilder.buildInboundLink.mockReturnValue('vless://link');
    xuiService.addInbound.mockResolvedValue({ id: 101, inbound: built });
    const results = await (service as any).rotateSubscription(sub, [], node);
    expect(results[0]).toMatchObject({ status: 'succeeded', created: 1 });
    expect(inboundBuilder.buildVlessXhttpGet).toHaveBeenCalledWith({
      port: 8080,
      uuid: expect.any(String),
      email: expect.any(String),
    });
    expect(inboundBuilder.buildInboundLink).toHaveBeenCalledWith(
      built,
      'relay.example',
      '',
      'flag',
      'vless-xhttp-get',
    );
    expect(inboundRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ configId: 'get-config', position: 1 }),
    );
    expect(xuiService.getNewX25519Cert).not.toHaveBeenCalled();
  });

  it('publishes a complete local generation and retires the old one atomically', async () => {
    const old = {
      id: 11,
      status: InboundStatus.Active,
      configId: 'custom-1',
      protocol: 'custom',
    } as Inbound;
    const subscription = {
      id: 'sub-2',
      name: 'Custom',
      inbounds: [old],
      inboundsConfig: [{ configId: 'custom-1', type: 'custom', link: 'vless://new' }],
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
      configId: 'old-tls',
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
          configId: 'old-tls', type: 'vless-tcp-tls',
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
      'mtproto-faketls',
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

  it('rotates explicit subscriptions in the requested order even with automatic rotation disabled', async () => {
    const first = { id: 'first', name: 'First', isEnabled: true, isAutoRotationEnabled: false };
    const second = { id: 'second', name: 'Second', isEnabled: true };
    subRepo.find.mockResolvedValueOnce([first, second]);
    subRepo.findOne.mockResolvedValueOnce(second).mockResolvedValueOnce(first);
    domainRepo.find.mockResolvedValueOnce([]);
    jest.spyOn(service as any, 'getDefaultNode').mockResolvedValue(null);
    const rotate = jest.spyOn(service as any, 'rotateSubscription').mockImplementation(async (sub: any) => [
      { subscriptionId: sub.id, status: 'succeeded', created: 1 },
    ]);

    const result = await service.performRotation(['second', 'FIRST']);

    expect(rotate.mock.calls.map(([sub]: any) => sub.id)).toEqual(['second', 'first']);
    expect(result.success).toBe(true);
    expect(result.results.map(item => item.subscriptionId)).toEqual(['second', 'first']);
  });

  it('pauses between subscriptions according to ROTATION_SUBSCRIPTION_PAUSE_MS and not after the last one', async () => {
    const prev = process.env.ROTATION_SUBSCRIPTION_PAUSE_MS;
    process.env.ROTATION_SUBSCRIPTION_PAUSE_MS = '120';
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    try {
      const first = { id: 'first', name: 'First', isEnabled: true };
      const second = { id: 'second', name: 'Second', isEnabled: true };
      subRepo.find.mockResolvedValueOnce([first, second]);
      subRepo.findOne.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      domainRepo.find.mockResolvedValueOnce([]);
      jest.spyOn(service as any, 'getDefaultNode').mockResolvedValue(null);
      jest.spyOn(service as any, 'rotateSubscription').mockImplementation(async (sub: any) => [
        { subscriptionId: sub.id, status: 'succeeded', created: 1 },
      ]);

      await service.performRotation(['first', 'second']);

      const pauseCalls = setTimeoutSpy.mock.calls.filter(([, ms]) => ms === 120);
      expect(pauseCalls).toHaveLength(1);
    } finally {
      setTimeoutSpy.mockRestore();
      if (prev === undefined) delete process.env.ROTATION_SUBSCRIPTION_PAUSE_MS;
      else process.env.ROTATION_SUBSCRIPTION_PAUSE_MS = prev;
    }
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
      addSelect: jest.fn().mockReturnThis(),
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

  it('skips a deleting node during resolution and before panel creation', async () => {
    const node = { id: 'being-deleted', name: 'Being deleted' } as Node;
    const fallback = { id: 'fallback', name: 'Fallback' } as Node;
    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(node),
    });
    nodeDeletion.begin(node.id);
    try {
      await expect(
        (service as any).resolveNode(node.id, { name: node.name }, fallback),
      ).resolves.toBe(fallback);
      await expect(
        (service as any).resolveNode(undefined, undefined, node),
      ).resolves.toBeUndefined();
      await expect((service as any).createInbound({ node })).rejects.toThrow(
        'удаляется',
      );
      expect(xuiService.addInbound).not.toHaveBeenCalled();
    } finally {
      nodeDeletion.end(node.id, false);
    }
  });

  it('does not use a node when removal begins while resolution is in progress', async () => {
    const node = { id: 'racing-node', name: 'Racing' } as Node;
    let finishLookup!: (node: Node) => void;
    const lookup = new Promise<Node>((resolve) => {
      finishLookup = resolve;
    });
    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockReturnValue(lookup),
    });
    const resolution = (service as any).resolveNode(
      node.id,
      undefined,
      node,
    ) as Promise<Node | undefined>;
    nodeDeletion.begin(node.id);
    try {
      finishLookup(node);
      await expect(resolution).resolves.toBeUndefined();
    } finally {
      nodeDeletion.end(node.id, false);
    }
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

  it('activates the successful inbound and preserves the old one when another port is occupied', async () => {
    const node = {
      id: 'node-partial',
      name: 'Partial node',
      version: '3.8.5',
      xrayVersion: '26.7.11',
      url: 'https://node-partial.example.com',
      healthStatus: 'online',
      consecutiveFailures: 0,
    } as Node;
    const subscription = {
      id: 'sub-partial',
      name: 'Partial Sub',
      node,
      inbounds: [{
        id: 42, configId: 'fallback', nodeId: node.id, protocol: 'vless',
        status: InboundStatus.Active, port: 20443,
      }],
      inboundsConfig: [
        { type: 'vless-ws', nodeId: node.id, port: 8080, sni: 'ya.ru' },
        { configId: 'fallback', type: 'https-fallback', nodeId: node.id, port: 20443, profileSettings: { domain: 'fallback.example.com', reverseProxy: 'nginx' } },
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
    inboundBuilder.buildHttpsFallbackInbound.mockReturnValue({
      remark: 'https-fallback',
      port: 20443,
      protocol: 'vless',
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
    xuiService.getLastInboundError.mockReturnValue("port 20443 (tcp) already used by inbound 'https-fallback' (#24) on 127.0.0.1 )");
    inboundRepo.findOne.mockResolvedValue({ subscriptionId: 'other-subscription' });

    const results = await (service as any).rotateSubscription(
      subscription,
      [{ name: 'ya.ru' }],
      node,
    );

    expect(results[0]).toMatchObject({
      status: 'partial',
      created: 1,
      inboundResults: [
        { status: 'activated' },
        {
          status: 'preserved', configId: 'fallback',
          error: { code: 'PORT_CONFLICT', stage: 'create', port: 20443 },
          conflict: { xuiId: 24, listen: '127.0.0.1', subscriptionId: 'other-subscription' },
        },
      ],
    });
    expect(manager.update).not.toHaveBeenCalledWith(
      Inbound, { id: expect.objectContaining({ _value: [42] }) },
      expect.objectContaining({ status: InboundStatus.PendingCleanup }),
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
      configId: 'old-ws',
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
        { configId: 'old-ws', type: 'vless-ws', nodeId: node.id, port: 8080, sni: 'ya.ru' },
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
      positionedConfig: { position: 0, config: { configId: 'vmess-1', type: 'vmess-tcp', port } },
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
        'vmess-tcp',
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
      expect(inboundRepo.update).toHaveBeenCalledWith(
        { id: In([500]) },
        { status: InboundStatus.PendingCleanup, nextCleanupAt: expect.any(Date) },
      );
      expect(inboundBuilder.buildInboundLink).not.toHaveBeenCalled();
    });
    it('preserves the old group and cleans up the staged generation when Xray fails', async () => {
      const old = {
        id: 44,
        configId: 'vmess-1',
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

  it('keeps exhausted cleanup tasks available for explicit retry and leaves unmanaged panel inbounds alone', async () => {
    const andWhere = jest.fn().mockReturnThis();
    const panelList = jest.fn().mockResolvedValue([{ id: 97, up: 0, down: 0 }]);
    (xuiService as Record<string, unknown>).listRoutingInbounds = panelList;
    inboundRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere,
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    });
    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    });
    await service.processCleanupQueue();
    expect(andWhere).toHaveBeenCalledWith(expect.stringContaining('inbound.cleanupAttempts < :max'), { max: 5 });
    expect(inboundRepo.delete).not.toHaveBeenCalled();
    expect(panelList).not.toHaveBeenCalled();

    inboundRepo.findOne.mockResolvedValue({ id: 97, status: InboundStatus.PendingCleanup, cleanupAttempts: 5 });
    await service.retryCleanup(97);
    expect(inboundRepo.update).toHaveBeenCalledWith(
      { id: 97, status: InboundStatus.PendingCleanup },
      expect.objectContaining({ cleanupAttempts: 0, nextCleanupAt: expect.any(Date) }),
    );
  });

  describe('database outage resilience and operation retention', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      databaseAvailability.reset();
      errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
      databaseAvailability.reset();
    });

    it('catches PostgreSQL 57P03 across all cron jobs and pauses DB polling during backoff', async () => {
      const recoveryErr = Object.assign(
        new Error('the database system is not yet accepting connections'),
        {
          code: '57P03',
          detail: 'Consistent recovery state has not been yet reached.',
        },
      );
      operationRepo.findOne.mockRejectedValueOnce(recoveryErr);

      await expect(service.processQueuedOperation()).resolves.toBeUndefined();
      expect(databaseAvailability.shouldSkip()).toBe(true);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      // Subsequent ticks of all 3 crons skip DB queries completely during backoff
      await expect(service.processQueuedOperation()).resolves.toBeUndefined();
      await expect(service.handleTicker()).resolves.toBeUndefined();
      await expect(service.processCleanupQueue()).resolves.toBeUndefined();

      expect(operationRepo.findOne).toHaveBeenCalledTimes(1);
      expect(settingRepo.findOne).not.toHaveBeenCalled();
      expect(inboundRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('releases processingOperation lock and retries final save after a 53100 disk_full error', async () => {
      const operation = {
        id: 'op-disk-full',
        status: 'queued',
        results: [],
      };
      const diskFullErr = Object.assign(
        new Error('could not write init file: No space left on device'),
        { code: '53100' },
      );

      operationRepo.findOne.mockResolvedValueOnce(operation);
      operationRepo.save
        .mockResolvedValueOnce(operation) // save Running
        .mockRejectedValueOnce(diskFullErr); // save finishedAt fails with 53100

      jest.spyOn(service, 'performRotation').mockResolvedValue({
        success: true,
        message: 'Ротация успешно выполнена',
        results: [],
      });

      await expect(service.processQueuedOperation()).resolves.toBeUndefined();
      expect(databaseAvailability.isDegraded()).toBe(true);
      expect(
        (service as unknown as { processingOperation: boolean })
          .processingOperation,
      ).toBe(false);

      // Once DB recovers, the next tick flushes the unsaved finished operation first
      databaseAvailability.reset();
      operationRepo.save.mockResolvedValueOnce(operation);
      operationRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.processQueuedOperation()).resolves.toBeUndefined();
      expect(operationRepo.save).toHaveBeenCalledTimes(3);
      expect(operationRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'op-disk-full',
          status: 'succeeded',
        }),
      );
      expect((operation as { finishedAt?: unknown }).finishedAt).toBeInstanceOf(
        Date,
      );
    });

    it('prunes terminal RotationOperation rows beyond the retention cap during cleanup', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      inboundRepo.createQueryBuilder.mockReturnValue(qb);
      nodeRepo.createQueryBuilder.mockReturnValue({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      const deleteMock = jest.fn().mockResolvedValue({ affected: 2 });
      const opRepoWithDelete = operationRepo as typeof operationRepo & {
        delete?: jest.Mock;
      };
      opRepoWithDelete.delete = deleteMock;
      operationRepo.find.mockResolvedValueOnce([
        { id: 'old-op-1' },
        { id: 'old-op-2' },
      ]);
      (
        service as unknown as { lastOperationPruneAt: number }
      ).lastOperationPruneAt = 0;

      await service.processCleanupQueue();

      expect(operationRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 200,
          take: 500,
        }),
      );
      expect(deleteMock).toHaveBeenCalledWith(['old-op-1', 'old-op-2']);
      delete opRepoWithDelete.delete;
    });
  });

  describe('xhttp-stable managed profile rotation', () => {
    const node = {
      id: 'xhttp-node',
      name: 'EU-XHTTP',
      domain: 'eu.example.com',
      version: '3.8.5',
      xrayVersion: '26.7.11',
    } as Node;

    it('shares the established SNI for a fixed-port XHTTP profile with automatic SNI', async () => {
      const config = {
        type: 'xhttp-stable',
        port: 12443,
        sni: 'random',
        profileId: 'stable-profile',
        profileSettings: { mode: 'auto' },
      };
      const existing = {
        xuiId: 10,
        port: 12443,
        configId: 'owner-config',
        profileId: config.profileId,
        subscription: { inboundsConfig: [{ ...config, configId: 'owner-config' }] },
        clientProfileJson: JSON.stringify({
          sni: 'www.samsung.com',
          fingerprint: 'android',
          spiderX: '/assets/',
          xhttp: { host: 'www.samsung.com', path: '/sec/assets/', mode: 'auto' },
        }),
      };
      inboundRepo.find.mockResolvedValueOnce([existing]);
      const selected = await (service as any).findSharedManagedInbound(
        config, node.id, 'other.example.com', {}, node,
        [{ name: 'www.samsung.com', isEnabled: true }],
      );
      expect(selected).toEqual({ inbound: existing, sni: 'www.samsung.com' });
    });

    it('retires the stale entry only after activating its unique replacement', async () => {
      const config = {
        configId: 'old-config',
        profileId: 'old-profile',
        name: 'Stable',
        type: 'xhttp-stable',
        port: 'random',
        sni: 'random',
        nodeId: node.id,
      };
      const replacement = { ...config, configId: 'replacement', profileId: 'new-profile', port: '12443' };
      const previous = {
        id: 700, configId: config.configId, nodeId: node.id, protocol: 'vless',
        status: InboundStatus.Active,
      };
      const subscription = {
        id: 'sub-xhttp', name: 'SubXhttp',
        inboundsConfig: [config, replacement],
        inbounds: [previous],
      } as Subscription;
      xuiService.assertXrayHealthy.mockResolvedValue(undefined);
      xuiService.getNewX25519Cert.mockResolvedValue({ privateKey: 'private', publicKey: 'public' });
      const group = { node, configs: subscription.inboundsConfig.map((entry, position) => ({ config: entry, position })) };
      const create = jest.spyOn(service as any, 'createInbound');
      manager.findOneBy.mockResolvedValueOnce(null);
      create.mockResolvedValueOnce(null);
      const failed = await (service as any).rotateNodeGroup(subscription, node.id, group, []);
      expect(failed.inboundResults[0].status).toBe('preserved');
      expect(manager.transaction).not.toHaveBeenCalled();
      expect(subscription.inboundsConfig).toEqual([config, replacement]);

      manager.findOneBy.mockResolvedValueOnce(null);
      create.mockResolvedValueOnce({ id: 501, port: 12443, xuiId: 10 });
      const activated = await (service as any).rotateNodeGroup(subscription, node.id, group, []);
      expect(activated.inboundResults.map((item) => item.status))
        .toEqual(['superseded', 'activated']);
      expect(manager.update).toHaveBeenCalledWith(Inbound, { id: In([previous.id]) },
        expect.objectContaining({ status: InboundStatus.PendingCleanup }));
      expect(manager.update).toHaveBeenCalledWith(Subscription,
        { id: subscription.id }, { inboundsConfig: [replacement] });
    });

    it('queues cleanup without saving a rejected profile reference again', async () => {
      const config = {
        configId: '33333333-3333-4333-8333-333333333333',
        profileId: '44444444-4444-4444-8444-444444444444',
        type: 'xhttp-stable',
        port: 'random',
        sni: 'random',
        nodeId: node.id,
      };
      const previous = {
        id: 700,
        configId: config.configId,
        nodeId: node.id,
        protocol: 'vless',
        status: InboundStatus.Active,
      };
      const subscription = {
        id: 'sub-xhttp',
        name: 'SubXhttp',
        inboundsConfig: [config],
        inbounds: [previous],
      } as Subscription;
      const staged = {
        id: 500,
        xuiId: 71,
        profileId: config.profileId,
        status: InboundStatus.Staged,
      } as Inbound;
      xuiService.assertXrayHealthy.mockResolvedValueOnce(undefined);
      xuiService.getNewX25519Cert.mockResolvedValueOnce({
        privateKey: 'private',
        publicKey: 'public',
      });
      xuiService.deleteInbound.mockResolvedValueOnce(true);
      jest.spyOn(service as any, 'createInbound').mockImplementationOnce(
        async ({ onStaged }) => {
          onStaged(staged);
          throw new Error(
            'insert or update on table "inbound" violates foreign key constraint "FK_inbound_connection_profile"',
          );
        },
      );

      const result = await (service as any).rotateNodeGroup(
        subscription,
        node.id,
        { node, configs: [{ config, position: 0 }] },
        [],
      );
      expect(result).toMatchObject({
        status: 'preserved',
        inboundResults: [{
          status: 'preserved',
          previousActive: true,
          error: { code: 'CONNECTION_PROFILE_NOT_FOUND' },
        }],
      });
      expect(inboundRepo.update).toHaveBeenCalledWith(
        { id: In([staged.id]) },
        { status: InboundStatus.PendingCleanup, nextCleanupAt: expect.any(Date) },
      );
      expect(inboundRepo.save).not.toHaveBeenCalled();
      expect(previous.status).toBe(InboundStatus.Active);

      manager.findOneBy.mockResolvedValueOnce(null);
      xuiService.addInbound.mockClear();
      const staleResult = await (service as any).rotateNodeGroup(
        subscription,
        node.id,
        { node, configs: [{ config, position: 0 }] },
        [],
      );
      expect(staleResult).toMatchObject({
        status: 'preserved',
        inboundResults: [{
          status: 'preserved',
          error: { code: 'CONNECTION_PROFILE_NOT_FOUND', stage: 'preflight' },
        }],
      });
      expect(xuiService.addInbound).not.toHaveBeenCalled();
    });

    it('creates minimal server inbound, saves separated clientProfileJson, and preserves fixed SNI on rotation', async () => {
      const configId = '33333333-3333-4333-8333-333333333333';
      const sub = {
        id: 'sub-xhttp',
        name: 'SubXhttp',
        isEnabled: true,
        isAutoRotationEnabled: true,
        inboundsConfig: [
          {
            configId,
            type: 'xhttp-stable',
            port: 443,
            sni: 'random',
            nodeId: node.id,
            name: 'Stable XHTTP',
            profileSettings: {
              mode: 'stream-one',
              fingerprint: 'firefox',
              rotationPolicy: 'fixed_domain',
              xmux: { enabled: true, maxConcurrency: '16-32' },
            },
          },
        ],
        inbounds: [
          {
            id: 700,
            xuiId: 70,
            configId,
            nodeId: node.id,
            protocol: 'vless',
            status: InboundStatus.Active,
            link: 'vless://old@eu.example.com:443?type=xhttp&sni=pinned.example.com#old',
            clientProfileJson: JSON.stringify({
              kind: 'xhttp-stable',
              sni: 'pinned.example.com',
            }),
          } as Inbound,
        ],
      } as Subscription;

      const builtInbound = {
        enable: true,
        port: 443,
        protocol: 'vless',
        remark: 'Stable XHTTP',
        settings: JSON.stringify({ clients: [{ id: 'u1', flow: '' }] }),
        streamSettings: JSON.stringify({
          network: 'xhttp',
          security: 'reality',
          realitySettings: {
            serverNames: ['pinned.example.com'],
            shortIds: ['deadbeef'],
            settings: { publicKey: 'PUB_KEY', fingerprint: 'firefox' },
          },
          xhttpSettings: {
            path: '/',
            host: 'pinned.example.com',
            mode: 'stream-one',
          },
        }),
      };

      xuiService.assertXrayHealthy.mockResolvedValue(undefined);
      xuiService.getNewX25519Cert.mockResolvedValue({
        privateKey: 'SECRET_PRIV_KEY',
        publicKey: 'PUB_KEY',
      });
      inboundBuilder.buildXhttpStableInbound.mockReturnValue(builtInbound);
      xuiService.addInbound.mockResolvedValue({
        id: 71,
        inbound: { ...builtInbound, id: 71 },
      });
      inboundBuilder.buildXhttpStableClientBundle.mockReturnValue({
        kind: 'xhttp-stable',
        vlessLink:
          'vless://u1@eu.example.com:443?type=xhttp&security=reality&sni=pinned.example.com&mode=stream-one#Stable',
        clientConfig: {
          kind: 'xhttp-stable',
          protocol: 'vless',
          address: 'eu.example.com',
          port: 443,
          uuid: 'u1',
          remark: 'Stable XHTTP',
          network: 'xhttp',
          security: 'reality',
          sni: 'pinned.example.com',
          fingerprint: 'firefox',
          publicKey: 'PUB_KEY',
          shortId: 'deadbeef',
          xhttp: {
            path: '/',
            host: 'pinned.example.com',
            mode: 'stream-one',
            extra: { xmux: { maxConcurrency: '16-32' } },
          },
        },
        xrayClientJson: {
          log: { loglevel: 'warning' },
          inbounds: [],
          outbounds: [],
          routing: {},
        },
      });

      const result = await (
        service as unknown as {
          rotateNodeGroup: (
            s: Subscription,
            k: string,
            g: {
              node?: Node;
              configs: Array<{ config: unknown; position: number }>;
            },
            d: Domain[],
          ) => Promise<{
            status: string;
            created: number;
            pendingCleanup: number;
          }>;
        }
      ).rotateNodeGroup(
        sub,
        node.id,
        { node, configs: [{ config: sub.inboundsConfig[0], position: 0 }] },
        [
          { id: 1, name: 'other-random.com', isEnabled: true },
          { id: 2, name: 'pinned.example.com', isEnabled: true },
        ],
      );

      expect(result).toMatchObject({
        status: 'succeeded',
        created: 1,
        pendingCleanup: 1,
      });
      // Fixed domain from active generation was preserved instead of picking other-random.com
      expect(inboundBuilder.buildXhttpStableInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          sni: 'pinned.example.com',
        }),
      );
      const lastSaved = inboundRepo.save.mock.calls.at(-1)?.[0] as {
        profileKind?: string;
        clientProfileJson?: string;
      };
      expect(lastSaved.profileKind).toBe('xhttp-stable');
      expect(lastSaved.clientProfileJson).toContain('"maxConcurrency":"16-32"');
      expect(lastSaved.clientProfileJson).not.toContain('SECRET_PRIV_KEY');
    });

    it('blocks xhttp-stable XMUX rotation on incompatible Xray version and preserves existing working inbound', async () => {
      const oldNode = {
        ...node,
        id: 'old-node',
        xrayVersion: '24.11.30',
      } as Node;
      const sub = {
        id: 'sub-xhttp-old',
        name: 'SubOld',
        isEnabled: true,
        inboundsConfig: [
          {
            configId: '44444444-4444-4444-8444-444444444444',
            type: 'xhttp-stable',
            port: 443,
            sni: 'www.microsoft.com',
            nodeId: oldNode.id,
            profileSettings: {
              mode: 'stream-one',
              xmux: { enabled: true, maxConcurrency: '16-32' },
            },
          },
        ],
        inbounds: [
          {
            id: 800,
            configId: '44444444-4444-4444-8444-444444444444',
            nodeId: oldNode.id,
            protocol: 'vless',
            status: InboundStatus.Active,
          } as Inbound,
        ],
      } as Subscription;

      const result = await (
        service as unknown as {
          rotateNodeGroup: (
            s: Subscription,
            k: string,
            g: {
              node?: Node;
              configs: Array<{ config: unknown; position: number }>;
            },
            d: Domain[],
          ) => Promise<{ status: string; created: number; message?: string }>;
        }
      ).rotateNodeGroup(
        sub,
        oldNode.id,
        {
          node: oldNode,
          configs: [{ config: sub.inboundsConfig[0], position: 0 }],
        },
        [],
      );

      expect(result.status).toBe('preserved');
      expect(result.created).toBe(0);
      expect(result.message).toContain('25.1.30');
      expect(xuiService.addInbound).not.toHaveBeenCalled();
      expect(inboundRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('rotates self-sni keeping its own domain, saving Vision clientProfileJson without privateKey', async () => {
      const configId = '55555555-5555-4555-8555-555555555555';
      const sub = {
        id: 'sub-self-sni',
        name: 'SubSelfSni',
        isEnabled: true,
        isAutoRotationEnabled: true,
        inboundsConfig: [
          {
            configId,
            type: 'self-sni',
            port: 443,
            sni: 'portal.example.com',
            nodeId: node.id,
            name: 'SelfSNI Portal',
            profileSettings: {
              domain: 'portal.example.com',
              webServer: 'nginx',
              localHttpsPort: 8443,
              fingerprint: 'chrome',
              xver: 0,
              rotationPolicy: 'fixed_domain',
            },
          },
        ],
        inbounds: [
          {
            id: 900,
            xuiId: 90,
            configId,
            nodeId: node.id,
            protocol: 'vless',
            status: InboundStatus.Active,
          } as Inbound,
        ],
      } as Subscription;

      const builtInbound = {
        enable: true,
        port: 443,
        protocol: 'vless',
        remark: 'SelfSNI Portal',
        settings: JSON.stringify({
          clients: [{ id: 'u-self', flow: 'xtls-rprx-vision' }],
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            target: '127.0.0.1:8443',
            serverNames: ['portal.example.com'],
            shortIds: ['11223344'],
            settings: { publicKey: 'SELF_PUB_KEY', fingerprint: 'chrome' },
          },
        }),
      };

      xuiService.assertXrayHealthy.mockResolvedValue(undefined);
      xuiService.getNewX25519Cert.mockResolvedValue({
        privateKey: 'SELF_SECRET_PRIV',
        publicKey: 'SELF_PUB_KEY',
      });
      inboundBuilder.buildSelfSniInbound.mockReturnValue(builtInbound);
      xuiService.addInbound.mockResolvedValue({
        id: 91,
        inbound: { ...builtInbound, id: 91 },
      });
      inboundBuilder.buildSelfSniClientBundle.mockReturnValue({
        kind: 'self-sni',
        vlessLink:
          'vless://u-self@eu.example.com:443?type=tcp&security=reality&flow=xtls-rprx-vision&sni=portal.example.com#SelfSNI',
        clientConfig: {
          kind: 'self-sni',
          protocol: 'vless',
          address: 'eu.example.com',
          port: 443,
          uuid: 'u-self',
          remark: 'SelfSNI Portal',
          flow: 'xtls-rprx-vision',
          network: 'tcp',
          security: 'reality',
          sni: 'portal.example.com',
          fingerprint: 'chrome',
          publicKey: 'SELF_PUB_KEY',
          shortId: '11223344',
        },
        xrayClientJson: {
          log: { loglevel: 'warning' },
          inbounds: [],
          outbounds: [],
          routing: {},
        },
      });

      const result = await (
        service as unknown as {
          rotateNodeGroup: (
            s: Subscription,
            k: string,
            g: {
              node?: Node;
              configs: Array<{ config: unknown; position: number }>;
            },
            d: Domain[],
          ) => Promise<{
            status: string;
            created: number;
            pendingCleanup: number;
          }>;
        }
      ).rotateNodeGroup(
        sub,
        node.id,
        { node, configs: [{ config: sub.inboundsConfig[0], position: 0 }] },
        [{ id: 1, name: 'random-foreign.com', isEnabled: true } as Domain],
      );

      expect(result).toMatchObject({
        status: 'succeeded',
        created: 1,
        pendingCleanup: 1,
      });
      expect(inboundBuilder.buildSelfSniInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'portal.example.com',
        }),
      );
      const lastSaved = inboundRepo.save.mock.calls.at(-1)?.[0] as {
        profileKind?: string;
        clientProfileJson?: string;
      };
      expect(lastSaved.profileKind).toBe('self-sni');
      expect(lastSaved.clientProfileJson).toContain('xtls-rprx-vision');
      expect(lastSaved.clientProfileJson).not.toContain('SELF_SECRET_PRIV');
    });

    it('blocks self-sni rotation when own domain is missing and preserves working generation', async () => {
      const sub = {
        id: 'sub-self-sni-bad',
        name: 'SubSelfSniBad',
        isEnabled: true,
        inboundsConfig: [
          {
            configId: '66666666-6666-4666-8666-666666666666',
            type: 'self-sni',
            port: 443,
            sni: 'random',
            nodeId: node.id,
            profileSettings: { webServer: 'nginx', localHttpsPort: 8443 },
          },
        ],
        inbounds: [
          {
            id: 950,
            configId: '66666666-6666-4666-8666-666666666666',
            nodeId: node.id,
            protocol: 'vless',
            status: InboundStatus.Active,
          } as Inbound,
        ],
      } as Subscription;

      const result = await (
        service as unknown as {
          rotateNodeGroup: (
            s: Subscription,
            k: string,
            g: {
              node?: Node;
              configs: Array<{ config: unknown; position: number }>;
            },
            d: Domain[],
          ) => Promise<{ status: string; created: number; message?: string }>;
        }
      ).rotateNodeGroup(
        sub,
        node.id,
        { node, configs: [{ config: sub.inboundsConfig[0], position: 0 }] },
        [
          {
            id: 1,
            name: 'should-never-be-picked.com',
            isEnabled: true,
          } as Domain,
        ],
      );

      expect(result.status).toBe('preserved');
      expect(result.created).toBe(0);
      expect(xuiService.addInbound).not.toHaveBeenCalled();
    });

    it('rotates independent https-fallback behind nginx reverse proxy without requiring panel cert or REALITY keys', async () => {
      const configId = '77777777-7777-4777-8777-777777777777';
      const sub = {
        id: 'sub-fallback',
        name: 'SubFallback',
        isEnabled: true,
        isAutoRotationEnabled: true,
        inboundsConfig: [
          {
            configId,
            type: 'https-fallback',
            port: 20443,
            nodeId: node.id,
            name: 'Fallback Proxy',
            profileSettings: {
              domain: 'fb.example.com',
              path: '/api/v2/stream',
              mode: 'auto',
              reverseProxy: 'nginx',
              publicPort: 443,
              rotationPolicy: 'fixed_domain',
            },
          },
        ],
        inbounds: [
          {
            id: 960,
            xuiId: 96,
            configId,
            nodeId: node.id,
            protocol: 'vless',
            status: InboundStatus.Active,
          } as Inbound,
        ],
      } as Subscription;

      const builtInbound = {
        enable: true,
        listen: '127.0.0.1',
        port: 20443,
        protocol: 'vless',
        remark: 'Fallback Proxy',
        settings: JSON.stringify({ clients: [{ id: 'u-fb', flow: '' }] }),
        streamSettings: JSON.stringify({
          network: 'xhttp',
          security: 'none',
          xhttpSettings: {
            path: '/api/v2/stream',
            host: 'fb.example.com',
            mode: 'auto',
          },
        }),
      };

      xuiService.assertXrayHealthy.mockResolvedValue(undefined);
      inboundBuilder.buildHttpsFallbackInbound.mockReturnValue(builtInbound);
      xuiService.addInbound.mockResolvedValue({
        id: 97,
        inbound: { ...builtInbound, id: 97 },
      });
      inboundBuilder.buildHttpsFallbackClientBundle.mockReturnValue({
        kind: 'https-fallback',
        vlessLink:
          'vless://u-fb@fb.example.com:443?type=xhttp&security=tls&sni=fb.example.com&path=%2Fapi%2Fv2%2Fstream#Fallback',
        clientConfig: {
          kind: 'https-fallback',
          protocol: 'vless',
          address: 'fb.example.com',
          port: 443,
          uuid: 'u-fb',
          remark: 'Fallback Proxy',
          network: 'xhttp',
          security: 'tls',
          sni: 'fb.example.com',
          fingerprint: 'chrome',
          alpn: ['h2', 'http/1.1'],
          xhttp: {
            path: '/api/v2/stream',
            host: 'fb.example.com',
            mode: 'auto',
          },
        },
        xrayClientJson: {
          log: { loglevel: 'warning' },
          inbounds: [],
          outbounds: [],
          routing: {},
        },
      });

      const result = await (
        service as unknown as {
          rotateNodeGroup: (
            s: Subscription,
            k: string,
            g: {
              node?: Node;
              configs: Array<{ config: unknown; position: number }>;
            },
            d: Domain[],
          ) => Promise<{
            status: string;
            created: number;
            pendingCleanup: number;
          }>;
        }
      ).rotateNodeGroup(
        sub,
        node.id,
        { node, configs: [{ config: sub.inboundsConfig[0], position: 0 }] },
        [],
      );

      expect(result).toMatchObject({
        status: 'succeeded',
        created: 1,
        pendingCleanup: 1,
      });
      expect(xuiService.getNewX25519Cert).not.toHaveBeenCalled();
      expect(xuiService.getWebCertificateFiles).not.toHaveBeenCalled();
      expect(inboundBuilder.buildHttpsFallbackInbound).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'fb.example.com',
          port: 20443,
        }),
      );
      const lastSaved = inboundRepo.save.mock.calls.at(-1)?.[0] as {
        profileKind?: string;
        clientProfileJson?: string;
      };
      expect(lastSaved.profileKind).toBe('https-fallback');
      expect(lastSaved.clientProfileJson).toContain('/api/v2/stream');
    });

    it.each([true, false])('uses the live compatible Fallback listener when the panel accepts or rejects adding a client (%s)', async (accepted) => {
      const builder = new InboundBuilderService();
      const live = builder.buildHttpsFallbackInbound({
        port: 20443, uuid: 'existing-uuid', remark: 'Legacy fallback',
        domain: 'fallback.example.com', settings: { reverseProxy: 'nginx' },
      });
      inboundRepo.find.mockResolvedValue([{
        id: 18, xuiId: 24, port: 20443, profileId: 'legacy-profile',
        subscription: { inboundsConfig: [{ type: 'https-fallback', profileSettings: { mode: 'auto' } }] },
        clientProfileJson: JSON.stringify({ kind: 'https-fallback', port: 443, sni: 'fallback.example.com' }),
      }]);
      xuiService.getInbound.mockResolvedValue(live);
      inboundBuilder.buildHttpsFallbackInbound.mockImplementation(builder.buildHttpsFallbackInbound.bind(builder));
      inboundBuilder.buildHttpsFallbackClientBundle.mockImplementation(builder.buildHttpsFallbackClientBundle.bind(builder));
      const addClient = jest.fn(async (_id, client, _node, matches) => {
        expect(matches(live)).toBe(true);
        expect(matches({ ...live, enable: false })).toBe(false);
        if (!accepted) return null;
        const settings = JSON.parse(live.settings);
        settings.clients.push(client);
        return { id: 24, inbound: { ...live, settings: JSON.stringify(settings) } };
      });
      (xuiService as Record<string, unknown>).addInboundClient = addClient;
      xuiService.getLastInboundError.mockReturnValue('shared client rejected');
      xuiService.waitForXray.mockResolvedValue(undefined);
      const config = {
        configId: 'new-fallback', profileId: 'new-profile', type: 'https-fallback', port: 'random',
        nodeId: node.id, profileSettings: { domain: 'fallback.example.com', reverseProxy: 'nginx', mode: 'auto' },
      };
      const sub = {
        id: 'another-subscription', name: 'Additional subscriber', inbounds: [], inboundsConfig: [config],
      } as Subscription;
      const result = await (service as any).rotateNodeGroup(
        sub, node.id, { node, configs: [{ config, position: 0 }] }, [],
      );
      expect(addClient).toHaveBeenCalledWith(24, expect.objectContaining({ id: expect.any(String) }), node, expect.any(Function));
      expect(xuiService.addInbound).not.toHaveBeenCalled();
      expect(result.status).toBe(accepted ? 'succeeded' : 'failed');
      if (accepted) {
        const uuid = addClient.mock.calls[0][1].id;
        expect(uuid).not.toBe('existing-uuid');
        expect(inboundRepo.save).toHaveBeenCalledWith(expect.objectContaining({
          xuiId: 24, port: 20443, clientId: uuid,
          clientProfileJson: expect.stringContaining(uuid),
        }));
      }
      delete (xuiService as Record<string, unknown>).addInboundClient;
    });

    it('runs canary real-client probe before switching generation and automatically rolls back on probe failure', async () => {
      const mockClientProbe = {
        probeClientProfile: jest.fn(),
      };
      const canaryService = new RotationService(
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
          run: jest.fn((_id: string, work: () => Promise<unknown>) => work()),
        } as unknown as SubscriptionLockService,
        nodeDeletion,
        mockClientProbe as unknown as ClientProbeService,
      );

      const configId = '88888888-8888-4888-8888-888888888888';
      const sub = {
        id: 'sub-canary',
        name: 'SubCanary',
        isEnabled: true,
        isAutoRotationEnabled: true,
        inboundsConfig: [
          {
            configId,
            type: 'xhttp-stable',
            port: 443,
            sni: 'www.microsoft.com',
            nodeId: node.id,
            name: 'Canary XHTTP',
            profileSettings: { mode: 'auto', fingerprint: 'chrome' },
          },
        ],
        inbounds: [
          {
            id: 980,
            xuiId: 98,
            configId,
            nodeId: node.id,
            protocol: 'vless',
            status: InboundStatus.Active,
          } as Inbound,
        ],
      } as Subscription;

      const builtInbound = {
        enable: true,
        port: 443,
        protocol: 'vless',
        remark: 'Canary XHTTP',
        settings: JSON.stringify({ clients: [{ id: 'u-can', flow: '' }] }),
        streamSettings: JSON.stringify({
          network: 'xhttp',
          security: 'reality',
          realitySettings: {
            serverNames: ['www.microsoft.com'],
            shortIds: ['cafebabe'],
            settings: { publicKey: 'CAN_PUB', fingerprint: 'chrome' },
          },
          xhttpSettings: { path: '/', host: 'www.microsoft.com', mode: 'auto' },
        }),
      };

      xuiService.assertXrayHealthy.mockResolvedValue(undefined);
      xuiService.getNewX25519Cert.mockResolvedValue({
        privateKey: 'CAN_PRIV',
        publicKey: 'CAN_PUB',
      });
      inboundBuilder.buildXhttpStableInbound.mockReturnValue(builtInbound);
      xuiService.addInbound.mockResolvedValue({
        id: 99,
        inbound: { ...builtInbound, id: 99 },
      });
      inboundBuilder.buildXhttpStableClientBundle.mockReturnValue({
        kind: 'xhttp-stable',
        vlessLink:
          'vless://u-can@eu.example.com:443?type=xhttp&security=reality#Canary',
        clientConfig: {
          kind: 'xhttp-stable',
          protocol: 'vless',
          address: 'eu.example.com',
          port: 443,
          uuid: 'u-can',
          remark: 'Canary XHTTP',
          network: 'xhttp',
          security: 'reality',
          sni: 'www.microsoft.com',
          fingerprint: 'chrome',
          publicKey: 'CAN_PUB',
          shortId: 'cafebabe',
          xhttp: { path: '/', host: 'www.microsoft.com', mode: 'auto' },
        },
        xrayClientJson: {
          log: { loglevel: 'warning' },
          inbounds: [],
          outbounds: [],
          routing: {},
        },
      });

      // 1) Canary probe FAILS -> automatic rollback, active generation preserved
      mockClientProbe.probeClientProfile.mockResolvedValueOnce({
        success: false,
        engine: 'xray-core',
        targetAddress: 'eu.example.com',
        targetPort: 443,
        protocol: 'vless',
        profileKind: 'xhttp-stable',
        latencyMs: 512,
        error: 'SOCKS5 handshake timeout',
      });
      xuiService.deleteInbound.mockResolvedValueOnce(true);

      const failedResult = await (
        canaryService as unknown as {
          rotateNodeGroup: (
            s: Subscription,
            k: string,
            g: {
              node?: Node;
              configs: Array<{ config: unknown; position: number }>;
            },
            d: Domain[],
          ) => Promise<{
            status: string;
            created: number;
            rolledBack?: boolean;
            message?: string;
            canaryResults?: Array<{ success: boolean }>;
          }>;
        }
      ).rotateNodeGroup(
        sub,
        node.id,
        { node, configs: [{ config: sub.inboundsConfig[0], position: 0 }] },
        [],
      );

      expect(failedResult.status).toBe('preserved');
      expect(failedResult.created).toBe(0);
      expect(failedResult.rolledBack).toBe(true);
      expect(failedResult.message).toContain('Canary-проверка');
      expect(failedResult.canaryResults?.[0]?.success).toBe(false);
      // Working generation was NEVER deactivated
      expect(inboundRepo.manager.transaction).not.toHaveBeenCalled();
      // Staged panel inbound was immediately rolled back
      expect(xuiService.deleteInbound).toHaveBeenCalledWith(99, node, 'u-can');

      // 2) Canary probe SUCCEEDS -> generation switches cleanly
      mockClientProbe.probeClientProfile.mockResolvedValueOnce({
        success: true,
        engine: 'xray-core',
        targetAddress: 'eu.example.com',
        targetPort: 443,
        protocol: 'vless',
        profileKind: 'xhttp-stable',
        httpStatusCode: 204,
        latencyMs: 74,
      });

      const okResult = await (
        canaryService as unknown as {
          rotateNodeGroup: (
            s: Subscription,
            k: string,
            g: {
              node?: Node;
              configs: Array<{ config: unknown; position: number }>;
            },
            d: Domain[],
          ) => Promise<{
            status: string;
            created: number;
            pendingCleanup: number;
            canaryResults?: Array<{
              success: boolean;
              httpStatusCode?: number;
            }>;
          }>;
        }
      ).rotateNodeGroup(
        sub,
        node.id,
        { node, configs: [{ config: sub.inboundsConfig[0], position: 0 }] },
        [],
      );

      expect(okResult.status).toBe('succeeded');
      expect(okResult.created).toBe(1);
      expect(okResult.pendingCleanup).toBe(1);
      expect(okResult.canaryResults?.[0]).toMatchObject({
        success: true,
        httpStatusCode: 204,
      });
      expect(inboundRepo.manager.transaction).toHaveBeenCalledTimes(1);
    });

    it('preserves unchanged fixed-port managed profile (self-sni :443) without port collision while rotating sibling inbounds', async () => {
      const selfSniConfigId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const tcpConfigId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const profileId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const selfSniLink = 'vless://u-existing@portal.example.com:443?flow=xtls-rprx-vision&type=tcp';
      manager.findOneBy.mockResolvedValueOnce({ flag: '%F0%9F%87%AB%F0%9F%87%B7' });
      const sub = {
        id: 'sub-mixed-fixed',
        name: 'SubMixedFixed',
        isEnabled: true,
        isAutoRotationEnabled: true,
        inboundsConfig: [
          {
            configId: selfSniConfigId,
            profileId,
            type: 'self-sni',
            port: 443,
            sni: 'portal.example.com',
            nodeId: node.id,
            name: 'SelfSNI 443',
            profileSettings: {
              domain: 'portal.example.com',
              webServer: 'nginx',
              localHttpsPort: 8443,
              fingerprint: 'chrome',
              xver: 0,
              rotationPolicy: 'fixed_domain',
            },
          },
          {
            configId: tcpConfigId,
            type: 'vless-tcp-reality',
            port: 'random',
            sni: 'www.microsoft.com',
            nodeId: node.id,
            name: 'Rotating TCP',
          },
        ],
        inbounds: [
          {
            id: 1001,
            xuiId: 101,
            configId: selfSniConfigId,
            profileId,
            nodeId: node.id,
            port: 443,
            position: 0,
            protocol: 'vless',
            profileKind: 'self-sni',
            status: InboundStatus.Active,
            link: `${selfSniLink}#%F0%9F%87%A9%F0%9F%87%AA%20SelfSNI%20443`,
            clientProfileJson: JSON.stringify({
              kind: 'self-sni',
              protocol: 'vless',
              address: 'portal.example.com',
              port: 443,
              uuid: 'u-existing',
              remark: 'SelfSNI 443',
              flow: 'xtls-rprx-vision',
              network: 'tcp',
              security: 'reality',
              sni: 'portal.example.com',
              fingerprint: 'chrome',
            }),
          } as Inbound,
          {
            id: 1002,
            xuiId: 102,
            configId: tcpConfigId,
            nodeId: node.id,
            port: 31234,
            position: 1,
            protocol: 'vless',
            status: InboundStatus.Active,
          } as Inbound,
        ],
      } as Subscription;

      xuiService.assertXrayHealthy.mockResolvedValue(undefined);
      xuiService.getNewX25519Cert.mockResolvedValue({
        privateKey: 'TCP_PRIV',
        publicKey: 'TCP_PUB',
      });
      const builtTcp = {
        enable: true,
        port: 45123,
        protocol: 'vless',
        remark: 'Rotating TCP',
        settings: JSON.stringify({ clients: [{ id: 'u-new' }] }),
        streamSettings: JSON.stringify({ network: 'tcp', security: 'reality' }),
      };
      inboundBuilder.buildVlessRealityTcp.mockReturnValue(builtTcp);
      xuiService.addInbound.mockResolvedValue({
        id: 103,
        inbound: { ...builtTcp, id: 103 },
      });
      inboundBuilder.buildInboundLink.mockReturnValue(
        'vless://u-new@eu.example.com:45123#Rotating',
      );

      const result = await (
        service as unknown as {
          rotateNodeGroup: (
            s: Subscription,
            k: string,
            g: {
              node?: Node;
              configs: Array<{ config: unknown; position: number }>;
            },
            d: Domain[],
          ) => Promise<{
            status: string;
            created: number;
            preserved?: number;
            pendingCleanup: number;
          }>;
        }
      ).rotateNodeGroup(
        sub,
        node.id,
        {
          node,
          configs: [
            { config: sub.inboundsConfig[0], position: 0 },
            { config: sub.inboundsConfig[1], position: 1 },
          ],
        },
        [],
      );

      expect(result).toMatchObject({
        status: 'succeeded',
        created: 1,
        preserved: 1,
        pendingCleanup: 1,
      });
      // Self-SNI was NOT recreated, avoiding port 443 collision
      expect(inboundBuilder.buildSelfSniInbound).not.toHaveBeenCalled();
      expect(xuiService.addInbound).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(Inbound, { id: 1001 }, {
        position: 0,
        link: `${selfSniLink}#%F0%9F%87%AB%F0%9F%87%B7%20SelfSNI%20443`,
      });
      // Only the old sibling TCP inbound (id 1002) was sent to PendingCleanup, NOT 1001
      const updateCalls = inboundRepo.manager.transaction.mock.calls;
      expect(updateCalls).toHaveLength(1);
    });

    it('activates Self-SNI independently when the XHTTP canary reaches TCP but returns HTTP EOF', async () => {
      const sub = {
        id: 'mixed',
        name: 'Mixed canary results',
        inboundsConfig: [
          { configId: 'xhttp', type: 'xhttp-stable', sni: 'www.microsoft.com' },
          { configId: 'self', type: 'self-sni', sni: 'portal.example.com' },
        ],
        inbounds: [
          { id: 810, configId: 'xhttp', nodeId: node.id, protocol: 'vless', status: InboundStatus.Active },
          { id: 811, configId: 'self', nodeId: node.id, protocol: 'vless', status: InboundStatus.Active },
        ],
      } as Subscription;
      const probe = {
        probeClientProfile: jest.fn()
          .mockResolvedValueOnce({ success: false, stage: 'http', tcpReachable: true, engine: 'xray-core', error: 'EOF' })
          .mockResolvedValueOnce({ success: true, stage: 'http', tcpReachable: true, engine: 'xray-core', httpStatusCode: 204 }),
      };
      const worker = new RotationService(
        subRepo as unknown as Repository<Subscription>,
        inboundRepo as unknown as Repository<Inbound>,
        domainRepo as unknown as Repository<Domain>,
        settingRepo as unknown as Repository<Setting>,
        nodeRepo as unknown as Repository<Node>,
        tunnelRepo as unknown as Repository<Tunnel>,
        operationRepo as unknown as Repository<RotationOperation>,
        xuiService as unknown as XuiService,
        inboundBuilder as unknown as InboundBuilderService,
        { run: jest.fn(async (_id, work) => work()) } as unknown as SubscriptionLockService,
        nodeDeletion,
        probe as unknown as ClientProbeService,
      );
      jest.spyOn(worker as any, 'createInbound')
        .mockResolvedValueOnce({ id: 820, xuiId: 82, port: 14138, profileKind: 'xhttp-stable',
          clientProfileJson: JSON.stringify({ sni: 'www.microsoft.com' }) })
        .mockResolvedValueOnce({ id: 821, xuiId: 83, port: 12328, profileKind: 'self-sni',
          clientProfileJson: JSON.stringify({ sni: 'portal.example.com' }) });
      xuiService.getNewX25519Cert.mockResolvedValue({ privateKey: 'private', publicKey: 'public' });
      inboundRepo.count.mockResolvedValue(0);
      xuiService.deleteInbound.mockResolvedValue(true);
      const result = await (worker as any).rotateNodeGroup(sub, node.id, {
        node, configs: sub.inboundsConfig.map((config, position) => ({ config, position })),
      }, []);
      expect(result).toMatchObject({
        status: 'partial', created: 1,
        inboundResults: [
          { configId: 'xhttp', status: 'preserved', error: { code: 'CANARY_PROBE_FAILED' },
            canary: { stage: 'http', tcpReachable: true } },
          { configId: 'self', status: 'activated', canary: { httpStatusCode: 204 } },
        ],
      });
      expect(xuiService.deleteInbound).toHaveBeenCalledWith(82, node);
      expect(xuiService.deleteInbound).not.toHaveBeenCalledWith(83, node);
      expect(manager.update).toHaveBeenCalledWith(
        Inbound, { id: expect.objectContaining({ _value: [811] }) },
        expect.objectContaining({ status: InboundStatus.PendingCleanup }),
      );
    });

    it.each([true, false])('commits a targeted repair with its candidate only when verification succeeds (%s)', async (success) => {
      const config = { configId: 'repair-target', type: 'xhttp-stable', port: 14138, sni: 'www.microsoft.com' };
      const sub = {
        id: 'repair-sub', name: 'Repair fixture', isEnabled: true,
        inboundsConfig: [config, { configId: 'sibling', type: 'self-sni' }],
        inbounds: [{ id: 831, configId: config.configId, nodeId: node.id, protocol: 'vless', status: InboundStatus.Active }],
      } as Subscription;
      const operation = {
        id: 'repair-operation', results: [],
        target: { operationId: 'failed-operation', subscriptionId: sub.id, configId: config.configId,
          version: inboundConfigVersion(config), patch: { port: 'random' } },
      } as RotationOperation;
      const probe = { probeClientProfile: jest.fn().mockResolvedValue({ success, engine: 'xray-core', error: 'EOF' }) };
      const worker = new RotationService(
        subRepo as unknown as Repository<Subscription>,
        inboundRepo as unknown as Repository<Inbound>,
        domainRepo as unknown as Repository<Domain>,
        settingRepo as unknown as Repository<Setting>,
        nodeRepo as unknown as Repository<Node>,
        tunnelRepo as unknown as Repository<Tunnel>,
        operationRepo as unknown as Repository<RotationOperation>,
        xuiService as unknown as XuiService,
        inboundBuilder as unknown as InboundBuilderService,
        { run: jest.fn(async (_id, work) => work()) } as unknown as SubscriptionLockService,
        nodeDeletion,
        probe as unknown as ClientProbeService,
      );
      subRepo.findOne.mockResolvedValue(sub);
      domainRepo.find.mockResolvedValue([]);
      jest.spyOn(worker as any, 'getDefaultNode').mockResolvedValue(node);
      jest.spyOn(worker as any, 'resolveNode').mockResolvedValue(node);
      const create = jest.spyOn(worker as any, 'createInbound').mockResolvedValue({
        id: 832, xuiId: 83, port: 14500, profileKind: 'xhttp-stable',
        clientProfileJson: JSON.stringify({ sni: config.sni }),
      });
      xuiService.getNewX25519Cert.mockResolvedValue({ privateKey: 'private', publicKey: 'public' });
      const result = await (worker as any).performTargetedRotation(operation);
      expect(result.success).toBe(success);
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        positionedConfig: { config: expect.objectContaining({ configId: config.configId, port: 'random' }), position: 0 },
      }));
      if (success) {
        expect(manager.update).toHaveBeenCalledWith(Subscription, { id: sub.id }, {
          inboundsConfig: [expect.objectContaining({ port: 'random' }), sub.inboundsConfig[1]],
        });
        expect(manager.update).toHaveBeenCalledWith(RotationOperation, { id: operation.id }, {
          results: [expect.objectContaining({ status: 'succeeded' })],
        });
        expect(manager.transaction).toHaveBeenCalledTimes(1);
      } else {
        expect(manager.transaction).not.toHaveBeenCalled();
        expect(manager.update).not.toHaveBeenCalled();
      }
    });

    it('isolates an inbound conflicting with the Self-SNI local port', async () => {
      const sub = {
        id: 'sub-port-collision',
        name: 'SubCollision',
        isEnabled: true,
        inboundsConfig: [
          {
            configId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            type: 'self-sni',
            port: 443,
            sni: 'portal.example.com',
            nodeId: node.id,
            profileSettings: {
              domain: 'portal.example.com',
              webServer: 'nginx',
              localHttpsPort: 8443,
            },
          },
          {
            configId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            type: 'xhttp-stable',
            port: 8443,
            sni: 'www.microsoft.com',
            nodeId: node.id,
          },
        ],
        inbounds: [],
      } as Subscription;

      const result = await (
        service as unknown as {
          rotateNodeGroup: (
            s: Subscription,
            k: string,
            g: {
              node?: Node;
              configs: Array<{ config: unknown; position: number }>;
            },
            d: Domain[],
          ) => Promise<{ status: string; created: number; message?: string }>;
        }
      ).rotateNodeGroup(
        sub,
        node.id,
        {
          node,
          configs: [
            { config: sub.inboundsConfig[0], position: 0 },
            { config: sub.inboundsConfig[1], position: 1 },
          ],
        },
        [],
      );

      expect(result.status).toBe('partial');
      expect(result.created).toBe(1);
      expect(result.message).toContain('Конфликт порта 8443');
      expect(xuiService.addInbound).toHaveBeenCalledTimes(1);
    });

    it('shares one 3x-ui inbound across subscriptions by attaching a separate client UUID and detaching only that client on rollback', async () => {
      const sharedProfileId = '99999999-9999-4999-8999-999999999999';
      const existingSharedRow = {
        id: 2001,
        xuiId: 82,
        nodeId: node.id,
        port: 24443,
        protocol: 'vless',
        profileId: sharedProfileId,
        profileKind: 'self-sni',
        status: InboundStatus.Active,
        subscriptionId: 'sub-owner-a',
        configId: 'owner-config',
        subscription: {
          inboundsConfig: [{
            configId: 'owner-config', type: 'self-sni',
            profileSettings: { domain: 'portal.example.com', webServer: 'nginx', localHttpsPort: 8443 },
          }],
        } as Subscription,
        clientProfileJson: JSON.stringify({
          kind: 'self-sni',
          protocol: 'vless',
          address: 'portal.example.com',
          port: 24443,
          uuid: 'uuid-sub-a',
          remark: 'self-sni-mscone',
          flow: 'xtls-rprx-vision',
          network: 'tcp',
          security: 'reality',
          sni: 'portal.example.com',
          fingerprint: 'chrome',
        }),
      } as Inbound;

      inboundRepo.find.mockResolvedValue([existingSharedRow]);
      inboundRepo.count.mockResolvedValue(1);
      xuiService.assertXrayHealthy.mockResolvedValue(undefined);
      xuiService.getNewX25519Cert.mockResolvedValue({
        privateKey: 'PRIV',
        publicKey: 'PUB_KEY_1234567890123456789012345678901234',
      });
      let attachedUuid = '';
      (xuiService as Record<string, unknown>).addInboundClient = jest.fn(
        (xuiId: number, clientEntry: { id: string }) => {
          attachedUuid = clientEntry.id;
          return Promise.resolve({
            id: xuiId,
            inbound: {
              id: xuiId,
              enable: true,
              port: 24443,
              protocol: 'vless',
              remark: 'self-sni-mscone',
              settings: JSON.stringify({
                clients: [{ id: 'uuid-sub-a' }, clientEntry],
              }),
              streamSettings: JSON.stringify({
                network: 'tcp',
                security: 'reality',
                realitySettings: {
                  serverNames: ['portal.example.com'],
                  shortIds: ['abcd1234'],
                  settings: {
                    publicKey: 'PUB_KEY_1234567890123456789012345678901234',
                    fingerprint: 'chrome',
                    spiderX: '/',
                  },
                },
              }),
            },
          });
        },
      );
      (xuiService as Record<string, unknown>).deleteInboundClient = jest
        .fn()
        .mockResolvedValue(true);

      inboundBuilder.buildSelfSniInbound.mockReturnValue({
        enable: true,
        port: 24443,
        protocol: 'vless',
        remark: 'self-sni-mscone',
        settings: '{}',
        streamSettings: '{}',
      });
      inboundBuilder.buildSelfSniClientBundle.mockImplementation(
        (_saved: unknown, _addr: string, _flag: string, _s: unknown, cid?: string) => ({
          kind: 'self-sni',
          vlessLink: `vless://${cid || 'fallback'}@portal.example.com:24443#self-sni`,
          clientConfig: {
            kind: 'self-sni',
            protocol: 'vless',
            address: 'portal.example.com',
            port: 24443,
            uuid: cid || 'fallback',
            remark: 'self-sni-mscone',
            flow: 'xtls-rprx-vision',
            network: 'tcp',
            security: 'reality',
            sni: 'portal.example.com',
            fingerprint: 'chrome',
          },
          xrayClientJson: {},
        }),
      );

      const mockClientProbe = {
        probeClientProfile: jest.fn().mockResolvedValue({
          success: true,
          engine: 'xray-core',
          targetAddress: 'portal.example.com',
          targetPort: 24443,
          protocol: 'vless',
          profileKind: 'self-sni',
          httpStatusCode: 204,
          latencyMs: 55,
        }),
      };
      (service as unknown as { clientProbe: unknown }).clientProbe =
        mockClientProbe;

      const subB = {
        id: 'sub-b',
        name: 'SubB',
        isEnabled: true,
        inboundsConfig: [
          {
            configId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            type: 'self-sni',
            port: 24443,
            sni: 'portal.example.com',
            nodeId: node.id,
            name: 'self-sni-mscone',
            profileId: sharedProfileId,
            flag: '%F0%9F%87%A9%F0%9F%87%AA',
            profileSettings: {
              domain: 'portal.example.com',
              webServer: 'nginx',
              localHttpsPort: 8443,
              rotationPolicy: 'fixed_domain',
            },
          },
        ],
        inbounds: [],
      } as Subscription;

      manager.findOneBy.mockResolvedValueOnce({ flag: '%F0%9F%87%AB%F0%9F%87%B7' });
      const rotateOk = await (
        service as unknown as {
          rotateNodeGroup: (
            s: Subscription,
            k: string,
            g: {
              node?: Node;
              configs: Array<{ config: unknown; position: number }>;
            },
            d: Domain[],
          ) => Promise<{ status: string; created: number }>;
        }
      ).rotateNodeGroup(
        subB,
        node.id,
        { node, configs: [{ config: subB.inboundsConfig[0], position: 0 }] },
        [],
      );

      expect(rotateOk.status).toBe('succeeded');
      expect(rotateOk.created).toBe(1);
      expect(xuiService.addInbound).not.toHaveBeenCalled();
      expect(
        (xuiService as Record<string, jest.Mock>).addInboundClient,
      ).toHaveBeenCalledWith(
        82,
        expect.objectContaining({
          id: attachedUuid,
          flow: 'xtls-rprx-vision',
        }),
        node,
        expect.any(Function),
      );
      expect(inboundRepo.save.mock.invocationCallOrder[0]).toBeLessThan(
        (xuiService as Record<string, jest.Mock>).addInboundClient.mock.invocationCallOrder[0],
      );
      expect(inboundBuilder.buildSelfSniClientBundle).toHaveBeenCalledWith(
        expect.objectContaining({ id: 82 }),
        expect.any(String),
        '%F0%9F%87%A9%F0%9F%87%AA',
        expect.any(Object),
        attachedUuid,
      );

      // Now simulate canary failure on a 3rd sub sharing xuiId=82:
      // rollback MUST detach only its client, NOT delete shared inbound 82!
      mockClientProbe.probeClientProfile.mockResolvedValueOnce({
        success: false,
        engine: 'xray-core',
        targetAddress: 'portal.example.com',
        targetPort: 24443,
        protocol: 'vless',
        profileKind: 'self-sni',
        latencyMs: 500,
        error: 'simulated canary failure',
      });
      const rotateFail = await (
        service as unknown as {
          rotateNodeGroup: (
            s: Subscription,
            k: string,
            g: {
              node?: Node;
              configs: Array<{ config: unknown; position: number }>;
            },
            d: Domain[],
          ) => Promise<{ status: string; rolledBack?: boolean }>;
        }
      ).rotateNodeGroup(
        subB,
        node.id,
        { node, configs: [{ config: subB.inboundsConfig[0], position: 0 }] },
        [],
      );

      expect(rotateFail.status).toBe('failed');
      expect(rotateFail.rolledBack).toBe(true);
      expect(
        (xuiService as Record<string, jest.Mock>).deleteInboundClient,
      ).toHaveBeenCalledWith(82, attachedUuid, node);
      expect(xuiService.deleteInbound).not.toHaveBeenCalled();
    });
  });
});
