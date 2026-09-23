import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryRunner, Repository } from 'typeorm';
import { AsyncLocalStorage } from 'async_hooks';
import { Node } from '../entities/node.entity';
import type { RoutingPresetState } from './routing-presets';

@Injectable()
export class RoutingStore {
  private readonly session = new AsyncLocalStorage<QueryRunner>();
  constructor(
    @InjectRepository(Node) private readonly nodes: Repository<Node>,
  ) {}

  private repository(): Repository<Node> {
    return this.session.getStore()?.manager.getRepository(Node) || this.nodes;
  }

  async node(id: string): Promise<Node> {
    const node = await this.repository()
      .createQueryBuilder('node')
      .addSelect(['node.password', 'node.token', 'node.routingPresets'])
      .where('node.id = :id', { id })
      .andWhere('node.deletedAt IS NULL')
      .getOne();
    if (!node) throw new NotFoundException('Нода не найдена');
    return node;
  }

  async save(id: string, state: RoutingPresetState): Promise<void> {
    await this.repository().update(id, { routingPresets: state });
  }

  async forgetInbound(nodeId: string, inboundId: number): Promise<void> {
    // Deferred node removal still needs to clean metadata on soft-deleted nodes.
    const node = await this.repository().findOne({
      where: { id: nodeId },
      select: { id: true, routingPresets: true },
    });
    if (!node?.routingPresets?.sniffing[String(inboundId)]) return;
    delete node.routingPresets.sniffing[String(inboundId)];
    if (node.routingPresets.pendingPrevious)
      delete node.routingPresets.pendingPrevious.sniffing[String(inboundId)];
    await this.save(nodeId, node.routingPresets);
  }

  // Session-scoped PostgreSQL lock also serializes separate manager processes.
  // Fail promptly instead of occupying HTTP requests waiting behind a restart.
  async withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const runner = this.nodes.manager.connection.createQueryRunner();
    const key = `3dp:routing:${id}`;
    let locked = false;
    try {
      await runner.connect();
      const rows = (await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [key],
      )) as { locked: boolean }[];
      locked = rows[0].locked === true;
      if (!locked)
        throw new ConflictException(
          'Настройки или подключения этой ноды сейчас изменяются. Повторите позже.',
        );
      return await this.session.run(runner, work);
    } finally {
      try {
        if (locked)
          await runner.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [key],
          );
      } finally {
        await runner.release();
      }
    }
  }
}
