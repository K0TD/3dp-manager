import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { Inbound, InboundStatus } from '../inbounds/entities/inbound.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import {
  OperationErrorDetails,
  normalizeOperationError,
} from '../rotation/operation-error';
import {
  RotationOperation,
  RotationOperationStatus,
  RotationTarget,
} from '../rotation/entities/rotation-operation.entity';
import {
  inboundConfigVersion,
  RotationService,
} from '../rotation/rotation.service';
import { sha256 } from './api-token.service';

const errorSummary = (error?: OperationErrorDetails | null) =>
  error && {
    code: error.code,
    stage: error.stage,
    port: error.port,
  };

function filters<T extends Inbound | RotationOperation>(
  query: SelectQueryBuilder<T>,
  input: Record<string, unknown>,
) {
  const { from, to } = input;
  for (const [key, value, operator] of [
    ['from', from, '>='],
    ['to', to, '<='],
  ] as const) {
    if (value === undefined) continue;
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d\d-\d\dT/.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      throw new BadRequestException('Invalid date filter');
    query.andWhere(`${query.alias}.createdAt ${operator} :${key}`, {
      [key]: new Date(value),
    });
  }
  for (const key of ['nodeId', 'subscriptionId']) {
    const value = input[key];
    if (value !== undefined && (typeof value !== 'string' || !isUUID(value)))
      throw new BadRequestException('Invalid ID filter');
  }
  const integer = (
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) => {
    if (value === undefined) return fallback;
    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      Number(value) < min ||
      Number(value) > max
    )
      throw new BadRequestException('Invalid pagination');
    return Number(value);
  };
  const limit = integer(input.limit, 25, 1, 100);
  const offset = integer(input.offset, 0, 0, 10000);
  query
    .orderBy(`${query.alias}.createdAt`, 'DESC')
    .addOrderBy(`${query.alias}.id`, 'DESC')
    .skip(offset)
    .take(limit);
  return { limit, offset };
}

@Injectable()
export class AutomationService {
  constructor(
    @InjectRepository(RotationOperation)
    private readonly operations: Repository<RotationOperation>,
    @InjectRepository(Inbound) private readonly inbounds: Repository<Inbound>,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    private readonly rotation: RotationService,
  ) {}

  private async views(operations: RotationOperation[]) {
    const ids = [
      ...new Set(
        operations.flatMap((op) =>
          (op.results || []).map((result) => result.subscriptionId),
        ),
      ),
    ];
    const versions = new Map<string, string>();
    if (ids.length) {
      const subscriptions = await this.subscriptions.find({
        where: { id: In(ids) },
        select: { id: true, inboundsConfig: true },
      });
      for (const sub of subscriptions)
        for (const config of sub.inboundsConfig || [])
          if (config.configId)
            versions.set(
              `${sub.id}/${config.configId}`,
              inboundConfigVersion(config),
            );
    }
    return operations.map((op) => ({
      id: op.id,
      status: op.status,
      subscriptionIds: op.subscriptionIds,
      createdAt: op.createdAt,
      startedAt: op.startedAt,
      finishedAt: op.finishedAt,
      error: errorSummary(op.errorDetails),
      results: (op.results || []).map((result) => ({
        subscriptionId: result.subscriptionId,
        nodeId: result.nodeId,
        status: result.status,
        created: result.created,
        pendingCleanup: result.pendingCleanup,
        error: errorSummary(result.errorDetails),
        inbounds: result.inboundResults?.map((item) => ({
          configId: item.configId,
          type: item.type,
          status: item.status,
          port: item.port,
          previousActive: item.previousActive,
          cleanupQueued: item.cleanupQueued,
          error: errorSummary(item.error),
          conflict: item.conflict,
          version:
            item.error &&
            versions.get(`${result.subscriptionId}/${item.configId}`),
          canary: item.canary && {
            success: item.canary.success,
            engine: item.canary.engine,
            stage: item.canary.stage,
            tcpReachable: item.canary.tcpReachable,
            latencyMs: item.canary.latencyMs,
            httpStatusCode: item.canary.httpStatusCode,
            sni: item.canary.sni,
            mode: item.canary.mode,
          },
        })),
      })),
    }));
  }

  async listOperations(input: Record<string, unknown>) {
    const query = this.operations.createQueryBuilder('op');
    const pagination = filters(query, input);
    if (input.status !== undefined) {
      if (
        !Object.values(RotationOperationStatus).includes(
          input.status as RotationOperationStatus,
        )
      )
        throw new BadRequestException('Invalid rotation status');
      query.andWhere('op.status = :status', { status: input.status });
    }
    if (input.nodeId)
      query.andWhere(
        `EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(op.results::jsonb, '[]'::jsonb)) AS result
      WHERE result->>'nodeId' = :nodeId
    )`,
        { nodeId: input.nodeId },
      );
    if (input.subscriptionId)
      query.andWhere(
        `(
      jsonb_exists(COALESCE(op."subscriptionIds"::jsonb, '[]'::jsonb), :subscriptionId)
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(op.results::jsonb, '[]'::jsonb)) AS result
        WHERE result->>'subscriptionId' = :subscriptionId
      )
    )`,
        { subscriptionId: input.subscriptionId },
      );
    const [items, total] = await query.getManyAndCount();
    return { items: await this.views(items), total, ...pagination };
  }

  async getOperation(id: string) {
    const [operation] = await this.views([
      await this.rotation.getOperation(id),
    ]);
    return operation;
  }

  async listCleanup(input: Record<string, unknown>) {
    const query = this.inbounds
      .createQueryBuilder('inbound')
      .where('inbound.status = :status', {
        status: InboundStatus.PendingCleanup,
      });
    const pagination = filters(query, input);
    if (
      input.status !== undefined &&
      !['pending', 'failed'].includes(input.status as string)
    )
      throw new BadRequestException('Invalid cleanup status');
    if (input.status === 'failed')
      query.andWhere('inbound.lastCleanupError IS NOT NULL');
    if (input.status === 'pending')
      query.andWhere('inbound.lastCleanupError IS NULL');
    if (input.nodeId)
      query.andWhere('inbound.nodeId = :nodeId', { nodeId: input.nodeId });
    if (input.subscriptionId)
      query.andWhere('inbound.subscriptionId = :subscriptionId', {
        subscriptionId: input.subscriptionId,
      });
    const [items, total] = await query.getManyAndCount();
    return {
      items: items.map((item) => ({
        id: item.id,
        nodeId: item.nodeId,
        subscriptionId: item.subscriptionId,
        configId: item.configId,
        port: item.port,
        xuiId: item.xuiId,
        attempts: item.cleanupAttempts,
        nextCleanupAt: item.nextCleanupAt,
        createdAt: item.createdAt,
        error: item.lastCleanupError
          ? errorSummary(
              normalizeOperationError(item.lastCleanupError, {
                stage: 'cleanup',
              }),
            )
          : undefined,
      })),
      total,
      ...pagination,
    };
  }

  async enqueue(
    tokenId: string,
    key: string | undefined,
    target: RotationTarget,
  ) {
    if (key !== undefined && !/^[A-Za-z0-9._-]{1,128}$/.test(key))
      throw new BadRequestException('Invalid Idempotency-Key');
    const idempotency = key ? sha256(`${tokenId}:${key}`) : undefined;
    const fingerprint = sha256(JSON.stringify(target));
    return this.operations.manager.transaction(async (manager) => {
      const repo = manager.getRepository(RotationOperation);
      if (idempotency) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          idempotency,
        ]);
        const existing = await repo.findOneBy({ idempotency });
        if (existing) {
          if (existing.requestFingerprint !== fingerprint)
            throw new ConflictException(
              'Idempotency-Key already used for another request',
            );
          return { id: existing.id, status: existing.status };
        }
      }
      await this.rotation.validateTarget(target);
      const op = await repo.save(
        repo.create({
          status: RotationOperationStatus.Queued,
          subscriptionIds: [target.subscriptionId],
          results: [],
          target,
          idempotency,
          requestFingerprint: fingerprint,
          apiTokenId: tokenId,
        }),
      );
      return { id: op.id, status: op.status };
    });
  }
}
