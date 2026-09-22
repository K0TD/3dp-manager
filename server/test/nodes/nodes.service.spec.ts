import { Repository } from 'typeorm';
import { NodesService } from 'src/nodes/nodes.service';
import { Node } from 'src/nodes/entities/node.entity';
import { Subscription } from 'src/subscriptions/entities/subscription.entity';
import { Tunnel } from 'src/tunnels/entities/tunnel.entity';
import { Inbound } from 'src/inbounds/entities/inbound.entity';
import { XuiService } from 'src/xui/xui.service';

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
      ),
      subscriptionsRepo,
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
      where: { deletedAt: expect.anything() },
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
    subscriptionsRepo.find
      .mockResolvedValueOnce([subscription])
      .mockResolvedValueOnce([subscription]);

    await service.remove('main');

    expect(subscriptionsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, nodeId: undefined }),
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
    expect(subscription.nodeId).toBeUndefined();
    expect(subscription.inboundsConfig[0]).toMatchObject({
      enabled: false,
      disabledReason: 'Нода «Offline» удалена',
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
    expect(subscription.nodeId).toBeUndefined();
    expect(subscription.inboundsConfig[0]).toMatchObject({
      enabled: false,
      disabledReason: 'Нода «Dead Node» удалена',
    });
  });
});
