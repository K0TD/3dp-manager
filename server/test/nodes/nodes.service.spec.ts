import * as dns from 'dns/promises';
import { IsNull, Repository } from 'typeorm';

jest.mock('dns/promises', () => ({
  __esModule: true,
  lookup: jest.fn(() => Promise.resolve([])),
  resolve4: jest.fn(() => Promise.resolve([])),
}));
import { NodesService } from 'src/nodes/nodes.service';
import { Node, NodeAuthType } from 'src/nodes/entities/node.entity';
import { DomainsService } from 'src/domains/domains.service';
import { Subscription } from 'src/subscriptions/entities/subscription.entity';
import { Tunnel } from 'src/tunnels/entities/tunnel.entity';
import { Inbound } from 'src/inbounds/entities/inbound.entity';
import { XuiService } from 'src/xui/xui.service';
import { Setting } from 'src/settings/entities/setting.entity';
import { SubscriptionLockService } from 'src/subscriptions/subscription-lock.service';
import { NodeDeletionService } from 'src/nodes/node-deletion.service';
import { databaseAvailability } from 'src/database/database-availability';
import { Logger } from '@nestjs/common';

describe('NodesService', () => {
  const createNodeRepo = (getOne: jest.Mock, getMany?: jest.Mock) => ({
    createQueryBuilder: jest.fn(() => ({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getOne,
      getMany: getMany ?? jest.fn().mockResolvedValue([]),
    })),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    count: jest.fn(),
    remove: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  });

  const createService = (nodeRepo: ReturnType<typeof createNodeRepo>) => {
    const subscriptionsRepo = {
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      })),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      findOne: jest.fn(),
    };
    subscriptionsRepo.findOne.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        ((await subscriptionsRepo.find()) as Subscription[]).find(
          (sub) => sub.id === where.id,
        ),
    );
    const settingsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };
    const nodeDeletion = new NodeDeletionService();
    const lock = {
      run: jest.fn((_id: string, work: () => Promise<unknown>) => work()),
    };
    const tunnelsRepo = {
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      })),
      delete: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
    };
    const inboundsRepo = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      save: jest.fn(),
    };
    const xuiService = {
      deleteInbound: jest.fn().mockResolvedValue(true),
      checkNodeConnection: jest.fn().mockResolvedValue({ success: true }),
    };
    const domainsService = {
      addHostDomain: jest.fn().mockResolvedValue(undefined),
    };

    return {
      service: new NodesService(
        nodeRepo as unknown as Repository<Node>,
        subscriptionsRepo as unknown as Repository<Subscription>,
        tunnelsRepo as unknown as Repository<Tunnel>,
        inboundsRepo as unknown as Repository<Inbound>,
        xuiService as unknown as XuiService,
        settingsRepo as unknown as Repository<Setting>,
        lock as unknown as SubscriptionLockService,
        nodeDeletion,
        domainsService as unknown as DomainsService,
      ),
      subscriptionsRepo,
      settingsRepo,
      lock,
      nodeDeletion,
      tunnelsRepo,
      inboundsRepo,
      xuiService,
      domainsService,
    };
  };

  it('deletes the main node and makes the next node main', async () => {
    const mainNode = { id: 'main', isMain: true } as Node;
    const nextNode = { id: 'next', isMain: false } as Node;
    const getOne = jest
      .fn()
      .mockResolvedValueOnce(mainNode)
      .mockResolvedValueOnce(null);
    const nodeRepo = createNodeRepo(getOne);
    nodeRepo.findOne.mockResolvedValue(nextNode);
    nodeRepo.save.mockResolvedValue(nextNode);
    const { service } = createService(nodeRepo);

    const result = await service.remove('main');

    expect(result).toEqual({ success: true });
    expect(nodeRepo.remove).toHaveBeenCalledWith(mainNode);
    expect(nodeRepo.findOne).toHaveBeenCalledWith({
      where: { deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    expect(nextNode.isMain).toBe(true);
    expect(nodeRepo.save).toHaveBeenCalledWith(nextNode);
  });

  it('uses node credentials when deleting node inbounds', async () => {
    const mainNode = { id: 'main', isMain: true } as Node;
    const getOne = jest
      .fn()
      .mockResolvedValueOnce(mainNode)
      .mockResolvedValueOnce(null);
    const nodeRepo = createNodeRepo(getOne);
    nodeRepo.findOne.mockResolvedValue(null);
    const { service, inboundsRepo, xuiService } = createService(nodeRepo);
    inboundsRepo.find.mockResolvedValue([
      { id: 1, xuiId: 101, nodeId: 'main' },
    ]);

    await service.remove('main');

    expect(xuiService.deleteInbound).toHaveBeenCalledWith(101, mainNode);
    expect(inboundsRepo.delete).toHaveBeenCalledWith({ nodeId: 'main' });
  });

  it('preserves subscriptions when deleting the last node', async () => {
    const mainNode = { id: 'main', isMain: true } as Node;
    const subscription = {
      id: 1,
      nodeId: 'main',
      inboundsConfig: [{ protocol: 'vless', nodeId: 'main' }],
    } as unknown as Subscription;
    const getOne = jest
      .fn()
      .mockResolvedValueOnce(mainNode)
      .mockResolvedValueOnce(null);
    const nodeRepo = createNodeRepo(getOne);
    nodeRepo.findOne.mockResolvedValue(null);
    const { service, subscriptionsRepo } = createService(nodeRepo);
    subscriptionsRepo.find.mockResolvedValue([subscription]);

    await service.remove('main');

    expect(subscriptionsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, nodeId: null }),
    );
    expect(subscription.inboundsConfig).toEqual([{ protocol: 'vless' }]);
  });

  it('hides a node immediately and queues its inbounds for deferred cleanup', async () => {
    const node = { id: 'node-1', name: 'Offline', isMain: true } as Node;
    const subscription = {
      id: 1,
      nodeId: 'node-1',
      inboundsConfig: [{ type: 'vless-ws', nodeId: 'node-1', enabled: true }],
    } as unknown as Subscription;
    const inbound = { id: 7, nodeId: 'node-1', status: 'active' } as Inbound;
    const getOne = jest
      .fn()
      .mockResolvedValueOnce(node)
      .mockResolvedValueOnce(null);
    const nodeRepo = createNodeRepo(getOne);
    nodeRepo.findOne.mockResolvedValue(null);
    const { service, subscriptionsRepo, inboundsRepo, xuiService } =
      createService(nodeRepo);
    inboundsRepo.find.mockResolvedValue([inbound]);
    subscriptionsRepo.find.mockResolvedValue([subscription]);

    const result = await service.remove('node-1', 'deferred');

    expect(result).toMatchObject({
      success: true,
      deferred: true,
      pendingCleanup: 1,
    });
    expect(node.deletedAt).toBeInstanceOf(Date);
    expect(inbound.status).toBe('pending_cleanup');
    expect(subscription.nodeId).toBeNull();
    expect(subscription.inboundsConfig[0]).toMatchObject({
      enabled: false,
      disabledReason:
        'Нода «Offline» удалена — подключение переведено на основную ноду',
    });
    expect(xuiService.deleteInbound).not.toHaveBeenCalled();
  });

  it('force purges a node and its inbounds without calling 3x-ui API', async () => {
    const node = { id: 'dead-node', name: 'Dead Node', isMain: true } as Node;
    const subscription = {
      id: 1,
      nodeId: 'dead-node',
      inboundsConfig: [
        { type: 'vless-ws', nodeId: 'dead-node', enabled: true },
      ],
    } as unknown as Subscription;
    const getOne = jest
      .fn()
      .mockResolvedValueOnce(node)
      .mockResolvedValueOnce(null);
    const nodeRepo = createNodeRepo(getOne);
    nodeRepo.findOne.mockResolvedValue(null);
    const {
      service,
      subscriptionsRepo,
      inboundsRepo,
      tunnelsRepo,
      xuiService,
    } = createService(nodeRepo);
    subscriptionsRepo.find.mockResolvedValue([subscription]);

    const result = await service.remove('dead-node', 'force');

    expect(result).toEqual({ success: true, forced: true });
    expect(xuiService.deleteInbound).not.toHaveBeenCalled();
    expect(inboundsRepo.delete).toHaveBeenCalledWith({ nodeId: 'dead-node' });
    expect(tunnelsRepo.delete).toHaveBeenCalledWith({ nodeId: 'dead-node' });
    expect(nodeRepo.remove).toHaveBeenCalledWith(node);
    expect(subscription.nodeId).toBeNull();
    expect(subscription.inboundsConfig[0]).toMatchObject({
      enabled: false,
      disabledReason:
        'Нода «Dead Node» удалена — подключение переведено на основную ноду',
    });
  });
  it.each(['safe', 'deferred', 'force'] as const)(
    'clears node metadata and deleted relays in %s mode',
    async (mode) => {
      const node = { id: 'gone', name: 'Gone' } as Node;
      const repo = createNodeRepo(
        jest.fn().mockResolvedValueOnce(node).mockResolvedValue(null),
      );
      repo.findOne.mockResolvedValue(null);
      const { service, subscriptionsRepo, settingsRepo, tunnelsRepo, lock } =
        createService(repo);
      const subscription = {
        id: 'sub',
        nodeId: 'gone',
        inboundsConfig: [
          { type: 'vless', flag: 'flag', name: 'Gone', relayServerId: 7 },
          {
            type: 'vmess',
            nodeId: 'other',
            flag: 'keep',
            name: 'Keep',
            relayServerId: '7',
          },
        ],
      };
      subscriptionsRepo.find.mockResolvedValue([subscription]);
      tunnelsRepo.find.mockResolvedValue([{ id: 7, nodeId: 'gone' }]);
      const setting = {
        key: 'default_inbounds',
        value: JSON.stringify([
          { nodeId: 'gone', flag: 'flag', name: 'Gone', relayServerId: 7 },
          { nodeId: 'other', flag: 'keep', name: 'Keep', relayServerId: '7' },
        ]),
      };
      settingsRepo.findOne.mockResolvedValue(setting);
      await service.remove('gone', mode);
      expect(lock.run).toHaveBeenCalledWith('sub', expect.any(Function));
      expect(subscription.nodeId).toBeNull();
      expect(subscription.inboundsConfig[0]).toEqual(
        mode === 'safe'
          ? { type: 'vless' }
          : {
              type: 'vless',
              enabled: false,
              disabledReason:
                'Нода «Gone» удалена — подключение переведено на основную ноду',
            },
      );
      expect(subscription.inboundsConfig[1]).toEqual({
        type: 'vmess',
        nodeId: 'other',
        flag: 'keep',
        name: 'Keep',
      });
      expect(JSON.parse(setting.value)).toEqual([
        {},
        { nodeId: 'other', flag: 'keep', name: 'Keep' },
      ]);
      expect(settingsRepo.save).toHaveBeenCalledWith(setting);
    },
  );

  it('selects a subscription linked only through a string relay ID', async () => {
    const node = { id: 'gone', name: 'Gone' } as Node;
    const repo = createNodeRepo(
      jest.fn().mockResolvedValueOnce(node).mockResolvedValue(null),
    );
    const { service, subscriptionsRepo, tunnelsRepo, lock } =
      createService(repo);
    const subscription = {
      id: 'relay-only',
      nodeId: 'other',
      inboundsConfig: [{ nodeId: 'other', relayServerId: '7', name: 'Keep' }],
    };
    subscriptionsRepo.find.mockResolvedValue([subscription]);
    tunnelsRepo.find.mockResolvedValue([{ id: 7, nodeId: 'gone' }]);
    await service.remove('gone', 'force');
    expect(lock.run).toHaveBeenCalledWith('relay-only', expect.any(Function));
    expect(subscription.inboundsConfig).toEqual([
      { nodeId: 'other', name: 'Keep' },
    ]);
    expect(subscriptionsRepo.save).toHaveBeenCalledWith(subscription);
  });

  it('skips malformed default inbounds when deleting a node', async () => {
    const node = { id: 'gone', name: 'Gone' } as Node;
    const repo = createNodeRepo(
      jest.fn().mockResolvedValueOnce(node).mockResolvedValue(null),
    );
    repo.findOne.mockResolvedValue(null);
    const { service, settingsRepo } = createService(repo);
    settingsRepo.findOne.mockResolvedValue({
      key: 'default_inbounds',
      value: '{',
    });
    await expect(service.remove('gone')).resolves.toEqual({ success: true });
    expect(settingsRepo.save).not.toHaveBeenCalled();
  });
  it('does not wait on an unrelated subscription and rechecks affected subscriptions under lock', async () => {
    const node = { id: 'gone', name: 'Gone' } as Node;
    const repo = createNodeRepo(
      jest.fn().mockResolvedValueOnce(node).mockResolvedValue(null),
    );
    const { service, subscriptionsRepo, lock } = createService(repo);
    const stale = { id: 'changed', nodeId: 'gone', inboundsConfig: [] };
    const current = { id: 'changed', nodeId: 'other', inboundsConfig: [] };
    subscriptionsRepo.find.mockResolvedValue([
      { id: 'unrelated', nodeId: 'other', inboundsConfig: [] },
      stale,
    ]);
    subscriptionsRepo.findOne.mockResolvedValue(current);
    lock.run.mockImplementation((id, work) =>
      id === 'unrelated' ? new Promise(() => {}) : work(),
    );
    await expect(service.remove('gone', 'force')).resolves.toEqual({
      success: true,
      forced: true,
    });
    expect(lock.run).toHaveBeenCalledTimes(1);
    expect(lock.run).toHaveBeenCalledWith('changed', expect.any(Function));
    expect(subscriptionsRepo.save).not.toHaveBeenCalled();
  });

  it('waits for implicit main-node provisioning before queuing its new inbound', async () => {
    const node = { id: 'main', name: 'Main', isMain: true } as Node;
    const repo = createNodeRepo(
      jest.fn().mockResolvedValueOnce(node).mockResolvedValue(null),
    );
    repo.findOne.mockResolvedValue(null);
    const { service, subscriptionsRepo, inboundsRepo, lock } =
      createService(repo);
    const subscription = {
      id: 'sub-implicit',
      name: 'Different name',
      nodeId: null,
      inboundsConfig: [
        { type: 'wireguard', nodeId: '', configId: 'wg-config' },
      ],
    };
    subscriptionsRepo.find.mockResolvedValue([subscription]);
    const published: Inbound[] = [];
    inboundsRepo.find.mockImplementation(() => Promise.resolve(published));
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    lock.run.mockImplementation(async (_id, work) => {
      entered();
      await gate;
      published.push({
        id: 12,
        nodeId: node.id,
        status: 'active',
        protocol: 'wireguard',
      } as Inbound);
      return work();
    });
    const removal = service.remove(node.id, 'deferred');
    await waiting;
    expect(inboundsRepo.find).not.toHaveBeenCalled();
    release();
    await expect(removal).resolves.toMatchObject({
      deferred: true,
      pendingCleanup: 1,
    });
    expect(lock.run).toHaveBeenCalledWith('sub-implicit', expect.any(Function));
    expect(published[0].status).toBe('pending_cleanup');
    expect(inboundsRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 12, status: 'pending_cleanup' }),
    ]);
  });

  it('locks implicit name matches on non-main nodes without locking unrelated subscriptions', async () => {
    const node = { id: 'named', name: '  France  ', isMain: false } as Node;
    const repo = createNodeRepo(
      jest.fn().mockResolvedValueOnce(node).mockResolvedValue(null),
    );
    repo.findOne.mockResolvedValue({ id: 'other', isMain: true });
    const { service, subscriptionsRepo, lock } = createService(repo);
    subscriptionsRepo.find.mockResolvedValue([
      {
        id: 'matched',
        name: 'france',
        inboundsConfig: [{ type: 'wireguard' }],
      },
      {
        id: 'unrelated',
        name: 'other',
        inboundsConfig: [{ type: 'wireguard' }],
      },
      {
        id: 'custom',
        name: 'france',
        inboundsConfig: [{ type: 'custom' }, { type: 'happ-routing' }],
      },
      {
        id: 'inherited-other',
        name: 'france',
        nodeId: 'other',
        inboundsConfig: [{ type: 'wireguard' }],
      },
    ]);
    await service.remove('named', 'deferred');
    expect(lock.run).toHaveBeenCalledTimes(1);
    expect(lock.run).toHaveBeenCalledWith('matched', expect.any(Function));
  });

  it('recognizes the earliest fallback node when no main node exists', async () => {
    const node = { id: 'fallback', name: 'Fallback', isMain: false } as Node;
    const repo = createNodeRepo(
      jest.fn().mockResolvedValueOnce(node).mockResolvedValue(null),
    );
    repo.findOne.mockResolvedValue(node);
    const { service, subscriptionsRepo, lock } = createService(repo);
    subscriptionsRepo.find.mockResolvedValue([
      {
        id: 'implicit',
        name: 'Other',
        inboundsConfig: [{ type: 'wireguard' }],
      },
    ]);
    await service.remove('fallback', 'force');
    expect(lock.run).toHaveBeenCalledWith('implicit', expect.any(Function));
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { deletedAt: IsNull() },
      order: { isMain: 'DESC', createdAt: 'ASC' },
    });
  });

  it('holds the deletion marker while waiting for a rotation and clears it after a failed safe removal', async () => {
    const node = { id: 'gone', name: 'Gone' } as Node;
    const repo = createNodeRepo(jest.fn().mockResolvedValueOnce(node));
    const {
      service,
      subscriptionsRepo,
      inboundsRepo,
      xuiService,
      lock,
      nodeDeletion,
    } = createService(repo);
    subscriptionsRepo.find.mockResolvedValue([
      { id: 'sub', nodeId: 'gone', inboundsConfig: [] },
    ]);
    inboundsRepo.find.mockResolvedValue([{ xuiId: 1 }]);
    xuiService.deleteInbound.mockResolvedValue(false);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    lock.run.mockImplementation(async (_id, work) => {
      entered();
      await gate;
      return work();
    });
    const removal = service.remove('gone');
    await waiting;
    expect(nodeDeletion.isDeleting('gone')).toBe(true);
    expect(xuiService.deleteInbound).not.toHaveBeenCalled();
    release();
    await expect(removal).rejects.toThrow();
    expect(nodeDeletion.isDeleting('gone')).toBe(false);
  });

  describe('refreshHealth database resilience', () => {
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

    it('catches PostgreSQL 57P03 without throwing and skips subsequent ticks during backoff', async () => {
      const getMany = jest.fn().mockRejectedValue(
        Object.assign(new Error('the database system is in recovery mode'), {
          code: '57P03',
        }),
      );
      const repo = createNodeRepo(jest.fn());
      const qb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
        getMany,
      };
      repo.createQueryBuilder.mockReturnValue(qb);
      const { service } = createService(repo);

      await expect(service.refreshHealth()).resolves.toBeUndefined();
      expect(databaseAvailability.shouldSkip()).toBe(true);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      await expect(service.refreshHealth()).resolves.toBeUndefined();
      expect(getMany).toHaveBeenCalledTimes(1);
    });

    it('stops remaining batches when nodesRepo.save fails with PostgreSQL 53100 disk_full', async () => {
      const nodes = Array.from({ length: 6 }, (_, idx) => ({
        id: `node-${idx + 1}`,
        name: `Node ${idx + 1}`,
      }));
      const repo = createNodeRepo(jest.fn());
      const qb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
        getMany: jest.fn().mockResolvedValue(nodes),
      };
      repo.createQueryBuilder.mockReturnValue(qb);
      repo.save.mockRejectedValue(
        Object.assign(
          new Error('could not write init file: No space left on device'),
          { code: '53100' },
        ),
      );

      const { service, xuiService } = createService(repo);
      const checkNodeConnection = jest.fn().mockResolvedValue({
        success: true,
        responseTimeMs: 42,
      });
      Object.assign(xuiService, { checkNodeConnection });

      await expect(service.refreshHealth()).resolves.toBeUndefined();

      // Batch size is 4: batch 1 hits 53100 and triggers backoff, so batch 2 (nodes 5-6) is skipped
      expect(checkNodeConnection).toHaveBeenCalledTimes(4);
      expect(databaseAvailability.shouldSkip()).toBe(true);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('SNI domain auto-registration', () => {
    it('adds node domain in transaction on create and update, and skips IP-only nodes', async () => {
      const txRepo = {
        count: jest.fn().mockResolvedValue(0),
        save: jest.fn((entity: Node) => Promise.resolve(entity)),
        createQueryBuilder: jest.fn(() => ({
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({}),
        })),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(txRepo),
      };
      const existingNode = {
        id: 'node-1',
        name: 'Main',
        url: 'https://127.0.0.1:2053',
        ip: '127.0.0.1',
        authType: NodeAuthType.Token,
        token: 'tok',
      } as Node;
      const nodeRepo = {
        ...createNodeRepo(jest.fn().mockResolvedValue(existingNode)),
        create: jest.fn((data: Partial<Node>) => ({ id: 'node-1', ...data })),
        manager: {
          transaction: jest.fn(
            (work: (mgr: typeof manager) => Promise<unknown>) => work(manager),
          ),
        },
      };

      const { service, domainsService } = createService(nodeRepo);

      await service.create({
        name: 'Domain Node',
        url: 'https://127.0.0.1:2053',
        ip: '127.0.0.1',
        domain: 'node.example.com',
        authType: NodeAuthType.Token,
        token: 'tok',
      });
      expect(domainsService.addHostDomain).toHaveBeenCalledWith(
        'node.example.com',
        manager,
      );

      domainsService.addHostDomain.mockClear();
      await service.create({
        name: 'IP Node',
        url: 'https://127.0.0.1:2053',
        ip: '127.0.0.1',
        authType: NodeAuthType.Token,
        token: 'tok',
      });
      expect(domainsService.addHostDomain).toHaveBeenCalledWith(
        undefined,
        manager,
      );

      domainsService.addHostDomain.mockClear();
      await service.update('node-1', { domain: 'updated.example.com' });
      expect(domainsService.addHostDomain).toHaveBeenCalledWith(
        'updated.example.com',
        manager,
      );
    });
  });

  describe('credential preservation, address migration & sanitization', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('findAll returns sanitized nodes with hasToken/hasPassword and omits secrets', async () => {
      const getMany = jest.fn().mockResolvedValue([
        {
          id: 'n1',
          name: 'Token Node',
          authType: NodeAuthType.Token,
          token: 'super-secret-token',
        },
        {
          id: 'n2',
          name: 'Password Node',
          authType: NodeAuthType.Password,
          login: 'admin',
          password: 'super-secret-password',
        },
      ]);
      const repo = createNodeRepo(jest.fn(), getMany);
      const { service } = createService(repo);

      const list = await service.findAll();

      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({
        id: 'n1',
        hasToken: true,
        hasPassword: false,
      });
      expect(list[0]).not.toHaveProperty('token');
      expect(list[0]).not.toHaveProperty('password');
      expect(list[1]).toMatchObject({
        id: 'n2',
        hasToken: false,
        hasPassword: true,
      });
      expect(list[1]).not.toHaveProperty('password');
    });

    it('update preserves saved secrets when omitted or blank, resolves new IP, invalidates agents, and rewrites direct inbound links', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        json: () => Promise.resolve({ status: 'fail', success: false }),
      } as Response);

      const existingNode = {
        id: 'node-1',
        name: 'Main Node',
        url: 'https://old.example.com:2053/panel',
        host: 'old.example.com',
        domain: 'old.example.com',
        ip: '198.51.100.1',
        flag: '🇩🇪',
        authType: NodeAuthType.Token,
        token: 'keep-this-token',
        isMain: true,
      } as Node;

      const repo = createNodeRepo(jest.fn().mockResolvedValue(existingNode));
      repo.save.mockImplementation((entity: Node) => Promise.resolve(entity));
      const { service, inboundsRepo, xuiService } = createService(repo);
      const invalidatePanelAgent = jest.fn();
      Object.assign(xuiService, { invalidatePanelAgent });

      const directVless = {
        id: 1,
        nodeId: 'node-1',
        status: 'active',
        protocol: 'vless',
        link: 'vless://uuid-1@old.example.com:443?type=tcp#sub1',
        clientProfileJson: JSON.stringify({
          kind: 'xhttp-stable',
          address: 'old.example.com',
          port: 443,
        }),
      } as Inbound;
      const customInbound = {
        id: 2,
        nodeId: 'node-1',
        status: 'active',
        protocol: 'custom',
        link: 'vless://uuid-2@custom.example.com:443#custom',
      } as Inbound;
      const relayInbound = {
        id: 3,
        nodeId: 'node-1',
        status: 'active',
        protocol: 'vless',
        relayServerId: 9,
        link: 'vless://uuid-3@relay.example.com:443#relay',
      } as Inbound;
      inboundsRepo.find.mockResolvedValue([
        directVless,
        customInbound,
        relayInbound,
      ]);

      const updated = await service.update('node-1', {
        url: 'https://203.0.113.55:2053/panel',
        domain: '',
        ip: '203.0.113.55',
        token: '   ',
      });

      expect(updated.token).toBeUndefined();
      expect(updated.hasToken).toBe(true);
      expect(existingNode.token).toBe('keep-this-token');
      expect(existingNode.domain).toBeUndefined();
      expect(existingNode.ip).toBe('203.0.113.55');
      expect(invalidatePanelAgent).toHaveBeenCalledWith(
        'https://old.example.com:2053/panel',
      );
      expect(invalidatePanelAgent).toHaveBeenCalledWith(
        'https://203.0.113.55:2053',
      );
      expect(directVless.link).toBe(
        'vless://uuid-1@203.0.113.55:443?type=tcp#sub1',
      );
      expect(JSON.parse(directVless.clientProfileJson ?? '{}')).toMatchObject({
        address: '203.0.113.55',
      });
      expect(customInbound.link).toBe(
        'vless://uuid-2@custom.example.com:443#custom',
      );
      expect(relayInbound.link).toBe(
        'vless://uuid-3@relay.example.com:443#relay',
      );
      expect(inboundsRepo.save).toHaveBeenCalledWith([directVless]);
    });

    it('checkPayload merges stored credentials by nodeId and overrides when new secret provided', async () => {
      const existingNode = {
        id: 'node-1',
        name: 'Stored',
        url: 'https://old.example.com:2053',
        ip: '198.51.100.1',
        authType: NodeAuthType.Password,
        login: 'admin',
        password: 'stored-password',
      } as Node;
      const repo = createNodeRepo(jest.fn().mockResolvedValue(existingNode));
      const { service, xuiService } = createService(repo);
      const checkNodeConnection = jest.fn().mockResolvedValue({
        success: true,
        version: '3.11.0',
        xrayVersion: '26.11.9',
        responseTimeMs: 25,
      });
      Object.assign(xuiService, { checkNodeConnection });

      await service.checkPayload({
        nodeId: 'node-1',
        url: 'https://203.0.113.99:2053',
        authType: NodeAuthType.Password,
        preferDirectIp: true,
      });

      expect(checkNodeConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://203.0.113.99:2053',
          login: 'admin',
          password: 'stored-password',
          ip: '198.51.100.1',
        }),
        { freshConnection: true, preferDirectIp: true },
      );

      await service.checkPayload({
        nodeId: 'node-1',
        url: 'https://203.0.113.99:2053',
        authType: NodeAuthType.Password,
        password: 'override-password',
      });

      expect(checkNodeConnection).toHaveBeenLastCalledWith(
        expect.objectContaining({
          password: 'override-password',
        }),
        { freshConnection: true, preferDirectIp: undefined },
      );
    });

    it('migrateAddress preserves secrets, rewrites inbounds, counts tunnels, and checks fresh connection', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        json: () => Promise.resolve({ status: 'fail', success: false }),
      } as Response);

      const existingNode = {
        id: 'node-1',
        name: 'Blocked Node',
        url: 'https://blocked.example.com:2053',
        host: 'blocked.example.com',
        domain: 'blocked.example.com',
        ip: '198.51.100.1',
        flag: '🇳🇱',
        authType: NodeAuthType.Token,
        token: 'preserved-api-token',
      } as Node;
      const repo = createNodeRepo(jest.fn().mockResolvedValue(existingNode));
      repo.save.mockImplementation((entity: Node) => Promise.resolve(entity));
      const { service, inboundsRepo, tunnelsRepo, xuiService } =
        createService(repo);
      const invalidatePanelAgent = jest.fn();
      const checkNodeConnection = jest.fn().mockResolvedValue({
        success: true,
        version: '3.11.0',
        xrayVersion: '26.11.9',
        responseTimeMs: 38,
      });
      Object.assign(xuiService, { invalidatePanelAgent, checkNodeConnection });

      inboundsRepo.find.mockResolvedValue([
        {
          id: 10,
          nodeId: 'node-1',
          status: 'active',
          protocol: 'vless',
          link: 'vless://u@blocked.example.com:443?type=tcp#n',
          clientProfileJson: JSON.stringify({
            kind: 'self-sni',
            address: 'blocked.example.com',
            port: 443,
          }),
        },
      ]);
      tunnelsRepo.find.mockResolvedValue([{ id: 5, nodeId: 'node-1' }]);

      const result = await service.migrateAddress('node-1', {
        url: 'https://203.0.113.88:2053',
        domain: '',
        ip: '203.0.113.88',
        allowInvalidTls: true,
        syncSubscriptionLinks: true,
        preferDirectIp: true,
      });

      expect(result.node.token).toBeUndefined();
      expect(result.node.hasToken).toBe(true);
      expect(existingNode.token).toBe('preserved-api-token');
      expect(result.updatedInbounds).toBe(1);
      expect(result.affectedTunnels).toBe(1);
      expect(result.previousAddress).toBe('blocked.example.com');
      expect(result.nextAddress).toBe('203.0.113.88');
      expect(invalidatePanelAgent).toHaveBeenCalledTimes(2);
      expect(checkNodeConnection).toHaveBeenCalledWith(existingNode, {
        freshConnection: true,
        preferDirectIp: true,
      });
    });

    it('resolves fresh IP via DNS when changing URL hostname even if old IP is still passed', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        json: () => Promise.resolve({ status: 'fail', success: false }),
      } as Response);
      jest.spyOn(dns, 'resolve4').mockResolvedValue(['203.0.113.250']);
      jest
        .spyOn(dns, 'lookup')
        .mockResolvedValue([{ address: '203.0.113.250', family: 4 }] as never);

      const existingNode = {
        id: 'node-1',
        name: 'DNS Node',
        url: 'https://old-dns.example.com:2053',
        host: 'old-dns.example.com',
        domain: 'old-dns.example.com',
        ip: '198.51.100.1',
        flag: '🇩🇪',
        authType: NodeAuthType.Token,
        token: 'secret',
      } as Node;
      const repo = createNodeRepo(jest.fn().mockResolvedValue(existingNode));
      repo.save.mockImplementation((entity: Node) => Promise.resolve(entity));
      const { service } = createService(repo);

      await service.update('node-1', {
        url: 'https://new-dns.example.com:2053',
        ip: '198.51.100.1',
      });

      expect(existingNode.host).toBe('new-dns.example.com');
      expect(existingNode.domain).toBe('new-dns.example.com');
      expect(existingNode.ip).toBe('203.0.113.250');
    });
  });
});
