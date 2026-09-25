import { DataSource, QueryRunner } from 'typeorm';
import { SubscriptionLockService } from 'src/subscriptions/subscription-lock.service';

describe('SubscriptionLockService', () => {
  beforeEach(() => {
    jest.spyOn(DataSource.prototype, 'initialize').mockImplementation(function (
      this: DataSource,
    ) {
      return Promise.resolve(this);
    });
  });
  afterEach(() => jest.restoreAllMocks());
  const runner = () => ({
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([{ locked: true }]),
    release: jest.fn().mockResolvedValue(undefined),
  });

  it('holds the database lock until the operation finishes and releases it on error', async () => {
    const connection = runner();
    const primary = new DataSource({ type: 'postgres' });
    const primaryQuery = jest.spyOn(primary, 'createQueryRunner');
    jest
      .spyOn(DataSource.prototype, 'createQueryRunner')
      .mockReturnValue(connection as unknown as QueryRunner);
    const service = new SubscriptionLockService(primary);
    await expect(
      service.run('sub-1', async () => {
        expect(connection.query).toHaveBeenCalledWith(
          expect.stringContaining('pg_try_advisory_lock'),
          ['sub-1'],
        );
        expect(connection.release).not.toHaveBeenCalled();
        throw new Error('panel failed');
      }),
    ).rejects.toThrow('panel failed');
    expect(connection.query).toHaveBeenLastCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      ['sub-1'],
    );
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(primaryQuery).not.toHaveBeenCalled();
  });

  it('returns occupied connections to the pool before waiting and runs work only after acquiring the lock', async () => {
    const occupied = runner();
    occupied.query.mockResolvedValue([{ locked: false }]);
    const acquired = runner();
    jest
      .spyOn(DataSource.prototype, 'createQueryRunner')
      .mockReturnValueOnce(occupied as unknown as QueryRunner)
      .mockReturnValueOnce(acquired as unknown as QueryRunner);
    const service = new SubscriptionLockService(
      new DataSource({ type: 'postgres' }),
    );
    const work = jest.fn(async () => {
      expect(occupied.release).toHaveBeenCalledTimes(1);
      return 'saved';
    });
    expect(await service.run('sub-1', work)).toBe('saved');
    expect(work).toHaveBeenCalledTimes(1);
    expect(occupied.query).toHaveBeenCalledTimes(1);
    expect(acquired.release).toHaveBeenCalledTimes(1);
  });
});
