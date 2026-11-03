import { IsNull, Repository } from 'typeorm';
import { NodesService } from 'src/nodes/nodes.service';
import { Node } from 'src/nodes/entities/node.entity';
import { Subscription } from 'src/subscriptions/entities/subscription.entity';
import { Tunnel } from 'src/tunnels/entities/tunnel.entity';
import { Inbound } from 'src/inbounds/entities/inbound.entity';
import { XuiService } from 'src/xui/xui.service';
import { Setting } from 'src/settings/entities/setting.entity';
import { SubscriptionLockService } from 'src/subscriptions/subscription-lock.service';
import { NodeDeletionService } from 'src/nodes/node-deletion.service';

describe('NodesService', () => {
  const createNodeRepo = (getOne: jest.Mock) => ({
    createQueryBuilder: jest.fn(() => ({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne,
    })),
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
      ),
      subscriptionsRepo,
      settingsRepo,
      lock,
      nodeDeletion,
      tunnelsRepo,
      inboundsRepo,
      xuiService,
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
});
