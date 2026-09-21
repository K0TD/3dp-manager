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
  const subRepo = { find: jest.fn() };
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
    expect(inboundRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configId: '11111111-1111-4111-8111-111111111111',
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
        { id: 102, cleanupAttempts: 0, status: InboundStatus.PendingCleanup, node: { healthStatus: 'offline' } },
      ]),
    });
    inboundRepo.delete.mockResolvedValue({ affected: 1 });

    const result = await service.purgeFailedCleanup();
    expect(result).toEqual({ success: true, purgedCount: 2 });
    expect(inboundRepo.delete).toHaveBeenCalledWith(101);
    expect(inboundRepo.delete).toHaveBeenCalledWith(102);
  });
});
