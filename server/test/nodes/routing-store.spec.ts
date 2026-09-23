import { Repository } from 'typeorm';
import { Node } from '../../src/nodes/entities/node.entity';
import { RoutingStore } from '../../src/nodes/routing/routing-store.service';
import { emptyRoutingState } from '../../src/nodes/routing/routing-presets';

describe('routing operation locking', () => {
  function fixture(acquired: boolean) {
    const lockedRepository = {
      update: jest.fn(async () => undefined),
      findOne: jest.fn(),
    };
    const runner = {
      connect: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined),
      query: jest.fn(async () => [{ locked: acquired }]),
      manager: { getRepository: jest.fn(() => lockedRepository) },
    };
    const repository = {
      manager: { connection: { createQueryRunner: jest.fn(() => runner) } },
    };
    return {
      store: new RoutingStore(repository as unknown as Repository<Node>),
      runner,
      lockedRepository,
    };
  }

  it('uses the locked connection for DB writes, without requesting another pool connection', async () => {
    const { store, runner, lockedRepository } = fixture(true);
    await store.withLock('node-id', () =>
      store.save('node-id', emptyRoutingState()),
    );
    expect(lockedRepository.update).toHaveBeenCalledWith('node-id', {
      routingPresets: emptyRoutingState(),
    });
    expect(runner.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('pg_try_advisory_lock'),
      ['3dp:routing:node-id'],
    );
    expect(runner.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('pg_advisory_unlock'),
      ['3dp:routing:node-id'],
    );
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('rejects simultaneous mutation without entering its callback', async () => {
    const { store, runner } = fixture(false);
    const work = jest.fn();
    await expect(store.withLock('node-id', work)).rejects.toThrow(
      'сейчас изменяются',
    );
    expect(work).not.toHaveBeenCalled();
    expect(runner.query).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalled();
  });

  it('releases the lock and connection when remote work fails', async () => {
    const { store, runner } = fixture(true);
    await expect(
      store.withLock('node-id', async () => {
        throw new Error('panel failed');
      }),
    ).rejects.toThrow('panel failed');
    expect(runner.query).toHaveBeenLastCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      ['3dp:routing:node-id'],
    );
    expect(runner.release).toHaveBeenCalled();
  });

  it('removes restoration metadata for a deleted inbound without changing another inbound', async () => {
    const { store, lockedRepository } = fixture(true);
    const state = {
      ...emptyRoutingState(),
      sniffing: {
        '7': { identity: 'deleted', fields: {} },
        '8': { identity: 'keep', fields: {} },
      },
    };
    lockedRepository.findOne.mockResolvedValue({
      id: 'node-id',
      routingPresets: state,
    });
    await store.withLock('node-id', () => store.forgetInbound('node-id', 7));
    expect(lockedRepository.update).toHaveBeenCalledWith('node-id', {
      routingPresets: {
        ...emptyRoutingState(),
        sniffing: { '8': { identity: 'keep', fields: {} } },
      },
    });
  });
});
