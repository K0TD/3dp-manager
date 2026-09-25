import { ConflictException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Serializes panel operations and subscription edits across backend processes. */
@Injectable()
export class SubscriptionLockService implements OnModuleDestroy {
  private lockSource?: Promise<DataSource>;

  constructor(private readonly dataSource: DataSource) {}

  private getLockSource() {
    if (this.lockSource === undefined) {
      // Locks use their own pool: holding every application connection while
      // waiting for repository work would deadlock concurrent subscriptions.
      const source = new DataSource({
        ...this.dataSource.options,
        entities: [],
        subscribers: [],
        migrations: [],
        synchronize: false,
        migrationsRun: false,
        dropSchema: false,
      });
      this.lockSource = source.initialize().catch((error: unknown) => {
        this.lockSource = undefined;
        throw error;
      });
    }
    return this.lockSource;
  }

  async onModuleDestroy() {
    if (this.lockSource !== undefined) await (await this.lockSource).destroy();
  }

  async run<T>(subscriptionId: string, work: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 60_000;
    while (true) {
      const result = await this.tryRun(subscriptionId, work);
      if (result.acquired) return result.value;
      if (Date.now() >= deadline) {
        throw new ConflictException(
          'Подписка уже обрабатывается. Повторите попытку позже.',
        );
      }
      // Release waiting connections so the lock owner can still use the pool.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async tryRun<T>(
    subscriptionId: string,
    work: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const runner = (await this.getLockSource()).createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      const rows = (await runner.query(
        'SELECT pg_try_advisory_lock(33701, hashtext($1)) AS locked',
        [subscriptionId],
      )) as Array<{ locked: boolean }>;
      locked = rows[0].locked;
      if (!locked) return { acquired: false };
      return { acquired: true, value: await work() };
    } finally {
      try {
        if (locked) {
          await runner.query('SELECT pg_advisory_unlock(33701, hashtext($1))', [
            subscriptionId,
          ]);
        }
      } finally {
        await runner.release();
      }
    }
  }
}
