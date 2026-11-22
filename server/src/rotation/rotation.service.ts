import {
  Injectable,
  ConflictException,
  BadRequestException,
  OnModuleInit,
  NotFoundException,
  Logger,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';

import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Inbound, InboundStatus } from '../inbounds/entities/inbound.entity';
import { extractInboundClientId } from '../inbounds/inbound-client.util';
import { isExcludedSniDomain } from '../domains/sni-exclusions';
import { Domain } from '../domains/entities/domain.entity';
import { Setting } from '../settings/entities/setting.entity';
import { Node, NodeHealthStatus } from '../nodes/entities/node.entity';
import { Tunnel } from '../tunnels/entities/tunnel.entity';
import { XuiCertificateFiles, XuiService } from '../xui/xui.service';
import { InboundBuilderService } from '../inbounds/inbound-builder.service';
import {
  XuiInboundRaw,
  XuiStreamSettings,
} from '../inbounds/xui-inbound.types';
import {
  isSafeAbsoluteRemotePath,
  assertManagedCertificateHost,
} from '../inbounds/tls-config';
import { normalizeFakeTlsDomain } from '../inbounds/mtproto-faketls';
import { formatClientEmail } from '../inbounds/client-email';
import {
  CERTIFICATE_INBOUND_TYPES,
  InboundType,
  PERSISTENT_INBOUND_TYPES,
  ROUTING_INBOUND_TYPES,
  panelInboundProtocol,
  requiresPanelTlsCertificate,
} from '../subscriptions/inbound-config.constants';
import {
  isPortConflict,
  XuiRuntimeError,
  inboundDiagnostic,
  verifyTlsIdentity,
} from '../xui/xui-contract';
import { supportsInboundType } from '../nodes/node-capabilities';
import { SubscriptionLockService } from '../subscriptions/subscription-lock.service';
import { NodeDeletionService } from '../nodes/node-deletion.service';
import { renameAmneziaVpnLink } from '../inbounds/amnezia-vpn-link';
import {
  MissingConnectionProfileError,
  normalizeOperationError,
  redactOperationError,
  OperationErrorStage,
} from './operation-error';
import {
  RotationNodeResult,
  RotationOperation,
  RotationOperationStatus,
  RotationInboundDiagnostic,
  RotationConfigResult,
  RotationTarget,
} from './entities/rotation-operation.entity';
import {
  classifyDatabaseError,
  databaseAvailability,
} from '../database/database-availability';
import {
  isManagedProfileKind,
  type ClientConnectionProbeResult,
  type SeparatedClientProfile,
} from '../profiles/connection-profile.types';
import { evaluateProfileCompatibility } from '../profiles/profile-compatibility';
import {
  explicitXhttpStableSni,
  xhttpStableSniSettings,
} from '../profiles/profile-config.builder';
import { ClientProbeService } from '../profiles/client-probe.service';
import { ConnectionProfile } from '../profiles/entities/connection-profile.entity';

type InboundConfig = NonNullable<Subscription['inboundsConfig']>[number];

export function inboundConfigVersion(config: InboundConfig) {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

interface PositionedInboundConfig {
  config: InboundConfig;
  position: number;
}

interface CreateInboundRequest {
  subscription: Subscription;
  positionedConfig: PositionedInboundConfig;
  node?: Node;
  domains: Domain[];
  usedPorts: Set<number>;
  generationId: string;
  realityKeys?: { privateKey: string; publicKey: string } | null;
  nodeCertificate?: XuiCertificateFiles;
  diagnostics?: RotationInboundDiagnostic[];
  onStaged?: (inbound: Inbound) => void;
}

interface ResolvedTlsConfig extends XuiCertificateFiles {
  serverName: string;
}

interface SaveStagedInboundRequest {
  subscription: Subscription;
  config: InboundConfig;
  position: number;
  node: Node;
  relayServer?: Tunnel;
  generationId: string;
  xuiId: number;
  port: number;
  protocol: string;
  remark?: string;
  link: string;
  clientId?: string;
}

@Injectable()
export class RotationService implements OnModuleInit {
  private static readonly MAX_STORED_OPERATIONS = 200;
  private static readonly OPERATION_PRUNE_BATCH = 500;
  private static readonly OPERATION_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

  private readonly logger = new Logger(RotationService.name);
  private readonly dbAvailability = databaseAvailability;
  private readonly maxCleanupAttempts = 5;
  private processingOperation = false;
  private runningTicker = false;
  private processingCleanup = false;
  private unsavedFinishedOperation: RotationOperation | null = null;
  private lastOperationPruneAt = 0;

  constructor(
    @InjectRepository(Subscription) private subRepo: Repository<Subscription>,
    @InjectRepository(Inbound) private inboundRepo: Repository<Inbound>,
    @InjectRepository(Domain) private domainRepo: Repository<Domain>,
    @InjectRepository(Setting) private settingRepo: Repository<Setting>,
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
    @InjectRepository(Tunnel) private tunnelRepo: Repository<Tunnel>,
    @InjectRepository(RotationOperation)
    private operationRepo: Repository<RotationOperation>,
    private xuiService: XuiService,
    private inboundBuilder: InboundBuilderService,
    private subscriptionLock: SubscriptionLockService,
    private nodeDeletion: NodeDeletionService,
    @Optional() private readonly clientProbe?: ClientProbeService,
  ) {}

  async onModuleInit() {
    await this.initDefaultSettings();
    await this.inboundRepo.update(
      { status: InboundStatus.Staged },
      {
        status: InboundStatus.PendingCleanup,
        nextCleanupAt: new Date(),
        lastCleanupError: 'Незавершённое поколение после перезапуска backend',
      },
    );
    await this.operationRepo.update(
      { status: RotationOperationStatus.Running },
      {
        status: RotationOperationStatus.Queued,
        error: 'Backend restarted; operation was queued again',
      },
    );
  }

  private async initDefaultSettings() {
    const defaults: Record<string, string> = {
      rotation_status: 'active',
      rotation_interval: '30',
      last_rotation_timestamp: Date.now().toString(),
    };
    for (const [key, value] of Object.entries(defaults)) {
      const existing = await this.settingRepo.findOne({ where: { key } });
      if (!existing)
        await this.settingRepo.save(this.settingRepo.create({ key, value }));
    }
  }

  async enqueueRotation(subscriptionIds?: string[]) {
    const uniqueIds = subscriptionIds?.length
      ? [...new Set(subscriptionIds)]
      : undefined;
    const operation = await this.operationRepo.save(
      this.operationRepo.create({
        status: RotationOperationStatus.Queued,
        subscriptionIds: uniqueIds,
        results: [],
      }),
    );
    this.logger.log(
      `[RotationService] Операция ротации ${operation.id} поставлена в очередь (цели: ${uniqueIds?.join(', ') || 'все с авторотацией'})`,
    );
    return operation;
  }

  async getOperation(id: string) {
    const operation = await this.operationRepo.findOne({ where: { id } });
    if (!operation) throw new NotFoundException('Operation not found');
    return operation;
  }

  listOperations() {
    return this.operationRepo.find({ order: { createdAt: 'DESC' }, take: 50 });
  }

  @Cron('*/5 * * * * *')
  async processQueuedOperation() {
    if (
      this.processingOperation ||
      this.processingCleanup ||
      this.dbAvailability.shouldSkip()
    )
      return;

    this.processingOperation = true;
    try {
      if (this.unsavedFinishedOperation) {
        await this.operationRepo.save(this.unsavedFinishedOperation);
        this.unsavedFinishedOperation = null;
        this.dbAvailability.recordSuccess(this.logger, 'RotationService');
      }

      const operation = await this.operationRepo.findOne({
        where: { status: RotationOperationStatus.Queued },
        order: { createdAt: 'ASC' },
      });
      this.dbAvailability.recordSuccess(this.logger, 'RotationService');
      if (!operation) return;

      operation.status = RotationOperationStatus.Running;
      operation.startedAt = new Date();
      operation.error = undefined;
      operation.errorDetails = null;
      await this.operationRepo.save(operation);

      this.logger.log(
        `[RotationService] Начало обработки операции ${operation.id} (подписки: ${operation.subscriptionIds?.join(', ') || 'все с авторотацией'})...`,
      );

      const startedAt = Date.now();
      try {
        const result = operation.target
          ? await this.performTargetedRotation(operation)
          : await this.performRotation(operation.subscriptionIds);
        operation.results = result.results.map((item) => ({
          ...item,
          ...(item.message
            ? { message: redactOperationError(item.message, 16384) }
            : {}),
          ...(item.status !== 'succeeded' && item.message && !item.errorDetails
            ? {
                errorDetails: normalizeOperationError(item.message, {
                  node: item.nodeName,
                  stage: 'rotation',
                }),
              }
            : {}),
        }));
        operation.status = result.success
          ? RotationOperationStatus.Succeeded
          : result.results.some(
                (item) => item.status === 'partial' || item.created > 0,
              )
            ? RotationOperationStatus.Partial
            : RotationOperationStatus.Failed;
        operation.error = result.success
          ? undefined
          : redactOperationError(result.message, 16384);
        operation.errorDetails = result.success
          ? null
          : operation.results.find(
              (item) => item.status !== 'succeeded' && item.errorDetails,
            )?.errorDetails ||
            normalizeOperationError(result.message, { stage: 'rotation' });

        const durationMs = Date.now() - startedAt;
        if (result.success) {
          this.logger.log(
            `[RotationService] Операция ${operation.id} успешно завершена за ${durationMs}ms`,
          );
        } else {
          this.logger.warn(
            `[RotationService] Операция ${operation.id} завершена со статусом ${operation.status} за ${durationMs}ms: ${operation.error}`,
          );
        }
      } catch (error) {
        operation.status = RotationOperationStatus.Failed;
        operation.error = this.safeMessage(error);
        operation.errorDetails = normalizeOperationError(error, {
          stage: 'rotation',
        });
        const isStrictDbError = Boolean(
          classifyDatabaseError(error, { strict: true }),
        );
        this.logger.error(
          `[RotationService] Сбой обработки операции ${operation.id}: ${this.safeMessage(error)}`,
          !isStrictDbError && error instanceof Error && error.stack
            ? redactOperationError(error.stack, 16384)
            : undefined,
        );
      }

      operation.finishedAt = new Date();
      try {
        await this.operationRepo.save(operation);
        this.dbAvailability.recordSuccess(this.logger, 'RotationService');
      } catch (saveError) {
        this.unsavedFinishedOperation = operation;
        if (
          !this.dbAvailability.recordFailure(
            saveError,
            this.logger,
            `RotationOperation ${operation.id}`,
          )
        ) {
          this.logger.error(
            `[RotationService] Не удалось сохранить итог операции ${operation.id}: ${this.safeMessage(saveError)}`,
          );
        }
        return;
      }

      await this.pruneOldOperationsSafely();
    } catch (error) {
      if (
        !this.dbAvailability.recordFailure(
          error,
          this.logger,
          'processQueuedOperation',
        )
      ) {
        this.logger.error(
          `[RotationService] Сбой очереди ротаций: ${this.safeMessage(error)}`,
          error instanceof Error && error.stack
            ? redactOperationError(error.stack, 16384)
            : undefined,
        );
      }
    } finally {
      this.processingOperation = false;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTicker() {
    if (this.runningTicker || this.dbAvailability.shouldSkip()) return;
    this.runningTicker = true;
    try {
      const [intervalSetting, lastRunSetting, statusSetting] =
        await Promise.all([
          this.settingRepo.findOne({ where: { key: 'rotation_interval' } }),
          this.settingRepo.findOne({
            where: { key: 'last_rotation_timestamp' },
          }),
          this.settingRepo.findOne({ where: { key: 'rotation_status' } }),
        ]);
      this.dbAvailability.recordSuccess(this.logger, 'RotationService');
      const intervalMinutes = Number.parseInt(
        intervalSetting?.value || '30',
        10,
      );
      const lastRun = Number.parseInt(lastRunSetting?.value || '0', 10);
      if (statusSetting?.value === 'stopped') return;
      if ((Date.now() - lastRun) / 60000 < intervalMinutes) return;

      const activeOperation = await this.operationRepo.findOne({
        where: {
          status: In([
            RotationOperationStatus.Queued,
            RotationOperationStatus.Running,
          ]),
        },
      });
      if (!activeOperation) await this.enqueueRotation();
      await this.saveSetting('last_rotation_timestamp', Date.now().toString());
    } catch (error) {
      if (
        !this.dbAvailability.recordFailure(error, this.logger, 'handleTicker')
      ) {
        this.logger.error(
          `[RotationService] Сбой планировщика авторотации: ${this.safeMessage(error)}`,
        );
      }
    } finally {
      this.runningTicker = false;
    }
  }

  async performRotation(subscriptionIds?: string[]) {
    const where = subscriptionIds?.length
      ? { id: In(subscriptionIds), isEnabled: true }
      : { isEnabled: true, isAutoRotationEnabled: true };
    const subscriptions = await this.subRepo.find({
      where,
      relations: ['inbounds', 'inbounds.node', 'node', 'relayServer'],
    });
    if (!subscriptions.length) {
      const msg = subscriptionIds?.length
        ? `Подписки [${subscriptionIds.join(', ')}] не найдены или отключены`
        : 'Нет активных подписок для ротации';
      this.logger.warn(`[RotationService] ${msg}`);
      return {
        success: false,
        message: msg,
        results: [] as RotationNodeResult[],
      };
    }

    this.logger.log(
      `[RotationService] Найдено подписок для обработки: ${subscriptions.length} (${subscriptions.map((s) => `«${s.name}» [${s.id}]`).join(', ')})`,
    );

    const domains = await this.domainRepo.find({ where: { isEnabled: true } });
    const defaultNode = await this.getDefaultNode();
    if (defaultNode) {
      this.logger.log(
        `[RotationService] Основная нода по умолчанию: «${defaultNode.name}» [${defaultNode.id}] (url: ${defaultNode.url || `${defaultNode.protocol}://${defaultNode.host}:${defaultNode.port}`})`,
      );
    } else {
      this.logger.warn(
        '[RotationService] В системе нет ни одной активной ноды!',
      );
    }

    const results: RotationNodeResult[] = [];
    const subscriptionsById = new Map(
      subscriptions.map((sub) => [sub.id, sub]),
    );
    const orderedSubscriptions = subscriptionIds?.length
      ? [...new Set(subscriptionIds.map((id) => id.toLowerCase()))]
          .map((id) => subscriptionsById.get(id))
          .filter((sub) => sub !== undefined)
      : subscriptions;
    for (const subscription of orderedSubscriptions) {
      const subscriptionResults = await this.subscriptionLock.run(
        subscription.id,
        async () => {
          // The queued operation may have waited behind an edit or deletion.
          const current = await this.subRepo.findOne({
            where: { id: subscription.id },
            relations: ['inbounds', 'inbounds.node', 'node', 'relayServer'],
          });
          if (
            !current?.isEnabled ||
            (!subscriptionIds?.length && !current.isAutoRotationEnabled)
          )
            return [];
          return this.rotateSubscription(current, domains, defaultNode);
        },
      );
      results.push(...subscriptionResults);
    }
    const allSucceeded =
      results.length > 0 &&
      results.every((item) => item.status === 'succeeded');
    const noneSucceeded = results.every((item) => item.created === 0);

    let message = 'Ротация успешно выполнена';
    if (!allSucceeded) {
      if (noneSucceeded) {
        const firstError = results.find((r) => r.message)?.message;
        message = firstError || 'Сбой выполнения ротации';
      } else {
        message = 'Ротация завершена частично';
      }
    }
    return {
      success: allSucceeded,
      message,
      results,
    };
  }

  async rotateSingleSubscription(subscriptionId: string) {
    return this.performRotation([subscriptionId]);
  }

  /** Called after saving settings, while holding the subscription lock. */
  async provisionPersistentInbounds(subscription: Subscription) {
    const errors: string[] = [];
    const configs = subscription.inboundsConfig || [];
    const active = (subscription.inbounds || []).filter(
      (inbound) =>
        PERSISTENT_INBOUND_TYPES.has(inbound.protocol) &&
        inbound.status === InboundStatus.Active,
    );
    if (
      active.some(
        (inbound) =>
          !inbound.configId ||
          configs.filter(
            (config) =>
              config.configId === inbound.configId &&
              panelInboundProtocol(config.type) === inbound.protocol,
          ).length !== 1 ||
          active.filter((other) => other.configId === inbound.configId)
            .length !== 1,
      )
    ) {
      return {
        status: 'failed' as const,
        message:
          'Инбаунд не связан однозначно с конфигурацией. Существующее подключение сохранено; исправьте связь configId.',
      };
    }
    const usedPorts = new Set(
      (subscription.inbounds || []).map((inbound) => inbound.port),
    );
    const defaultNode = await this.getDefaultNode();
    for (const [position, config] of configs.entries()) {
      if (
        !PERSISTENT_INBOUND_TYPES.has(config.type) ||
        config.enabled === false
      )
        continue;
      const existing = active.find(
        (inbound) => inbound.configId === config.configId,
      );
      if (existing) {
        const remark = config.name?.trim() || config.type;
        const description = [config.flag, remark].filter(Boolean).join(' ');
        await this.inboundRepo.update(existing.id, {
          position,
          remark,
          link:
            existing.protocol === 'amneziawg'
              ? renameAmneziaVpnLink(existing.link, description)
              : existing.link,
        });
        continue;
      }
      let staged: Inbound | null = null;
      try {
        const node = await this.resolveNode(
          config.nodeId,
          subscription,
          defaultNode,
        );
        if (!node)
          throw new Error('Для подключения не назначена доступная нода');
        this.assertNodeCompatibility(config, node);
        await this.xuiService.assertXrayHealthy(node);
        staged = await this.createInbound({
          subscription,
          positionedConfig: { config, position },
          node,
          domains: [],
          usedPorts,
          generationId: uuidv4(),
        });
        if (!staged)
          throw new Error(
            this.xuiService.getLastInboundError(node) ||
              'Панель отклонила создание подключения',
          );
        if (config.type !== 'amneziawg')
          await this.xuiService.waitForXray(node);
        await this.inboundRepo.update(staged.id, {
          status: InboundStatus.Active,
        });
        staged.status = InboundStatus.Active;
        // Panel creation retains entity relations, including the parent itself.
        // Publish only the inbound fields, without cycles or node credentials.
        subscription.inbounds = [
          ...(subscription.inbounds || []),
          {
            ...staged,
            subscription: undefined,
            node: undefined,
            relayServer: undefined,
          },
        ];
      } catch (error) {
        if (staged) await this.queueCleanup([staged]);
        errors.push(
          `${config.name || config.type}: ${this.safeMessage(error)}`,
        );
      }
    }
    return errors.length
      ? { status: 'failed' as const, message: errors.join('; ') }
      : { status: 'succeeded' as const };
  }

  private async rotateSubscription(
    subscription: Subscription,
    domains: Domain[],
    defaultNode: Node | null,
  ) {
    const configured = subscription.inboundsConfig || [];
    const allConfigs = configured.filter(
      (config) => !ROUTING_INBOUND_TYPES.has(config.type),
    );
    this.logger.log(
      `[RotationService] Обработка подписки «${subscription.name}» (${subscription.id}), конфигураций инбаундов: ${allConfigs.length}`,
    );

    if (allConfigs.length === 0) {
      const obsolete = (subscription.inbounds || []).filter(
        (inbound) =>
          inbound.status === InboundStatus.Active &&
          !PERSISTENT_INBOUND_TYPES.has(inbound.protocol) &&
          Boolean(inbound.configId),
      );
      await this.queueCleanup(obsolete);
      if (!configured.length) {
        this.logger.warn(
          `[RotationService] У подписки «${subscription.name}» (${subscription.id}) нет конфигураций инбаундов.`,
        );
      }
      return [
        {
          subscriptionId: subscription.id,
          subscriptionName: subscription.name,
          nodeId: subscription.nodeId || 'none',
          nodeName:
            subscription.node?.name ||
            (configured.length ? 'Маршрутизация' : 'Без конфигураций'),
          status: 'succeeded' as const,
          created: 0,
          pendingCleanup: obsolete.length,
          message: configured.length
            ? 'В подписке остались только профили маршрутизации'
            : 'У подписки нет конфигураций инбаундов',
        },
      ];
    }

    let configsChanged = false;
    for (const config of allConfigs) {
      if (PERSISTENT_INBOUND_TYPES.has(config.type)) continue;
      if (config.enabled === false) {
        const resolved =
          config.type === 'custom'
            ? undefined
            : await this.resolveNode(config.nodeId, subscription, defaultNode);
        if (resolved || config.type === 'custom') {
          this.logger.log(
            `[RotationService] Автоматически активирована ранее отключенная конфигурация «${config.name || config.type}» для подписки «${subscription.name}» на ноде «${resolved?.name || 'Локальные'}» (была отключена: ${config.disabledReason || 'неизвестно'})`,
          );
          config.enabled = true;
          config.disabledReason = undefined;
          if (resolved && !config.nodeId) {
            config.nodeId = resolved.id;
          }
          configsChanged = true;
        }
      }
    }

    if (configsChanged) {
      subscription.inboundsConfig = configured;
      await this.subRepo.save(subscription);
    }

    const enabledConfigs = configured
      .map((config, position) => ({ config, position }))
      .filter(({ config }) => !ROUTING_INBOUND_TYPES.has(config.type))
      .filter(
        ({ config }) =>
          config.enabled !== false &&
          !PERSISTENT_INBOUND_TYPES.has(config.type),
      );

    if (
      allConfigs.every((config) => PERSISTENT_INBOUND_TYPES.has(config.type))
    ) {
      const obsolete = (subscription.inbounds || []).filter(
        (inbound) =>
          inbound.status === InboundStatus.Active &&
          !PERSISTENT_INBOUND_TYPES.has(inbound.protocol) &&
          Boolean(inbound.configId),
      );
      await this.queueCleanup(obsolete);
      return [
        {
          subscriptionId: subscription.id,
          subscriptionName: subscription.name,
          nodeId: subscription.nodeId,
          nodeName: 'Постоянные подключения',
          status: 'succeeded' as const,
          created: 0,
          pendingCleanup: obsolete.length,
          message:
            'Постоянные подключения сохраняются; создание выполняется при сохранении подписки',
        },
      ];
    }

    if (enabledConfigs.length === 0) {
      const reasons = Array.from(
        new Set(allConfigs.map((c) => c.disabledReason).filter(Boolean)),
      ).join('; ');
      const reasonText = reasons ? `: ${reasons}` : '';
      const message = `Все конфигурации инбаундов (${allConfigs.length}) отключены${reasonText}. Нет доступных нод для выполнения ротации.`;
      this.logger.warn(
        `[RotationService] Подписка «${subscription.name}» (${subscription.id}): ${message}`,
      );
      return [
        {
          subscriptionId: subscription.id,
          subscriptionName: subscription.name,
          nodeId: subscription.nodeId || 'none',
          nodeName: subscription.node?.name || 'Отключены',
          status: 'failed' as const,
          created: 0,
          pendingCleanup: 0,
          message,
        },
      ];
    }

    const groups = new Map<
      string,
      { node?: Node; configs: PositionedInboundConfig[] }
    >();
    for (const positionedConfig of enabledConfigs) {
      const { config } = positionedConfig;
      const node =
        config.type === 'custom'
          ? undefined
          : await this.resolveNode(config.nodeId, subscription, defaultNode);
      const key =
        config.type === 'custom' ? '__custom' : node?.id || '__missing';
      const group = groups.get(key) || { node, configs: [] };
      group.configs.push(positionedConfig);
      groups.set(key, group);

      this.logger.log(
        `[RotationService] Инбаунд «${config.name || config.type}» (порт: ${config.port || 'random'}) -> нода «${node?.name || (key === '__custom' ? 'Локальные' : 'Отсутствует')}» (${node?.id || key})`,
      );
    }

    const results: RotationNodeResult[] = [];
    for (const [key, group] of groups) {
      results.push(
        await this.rotateNodeGroup(subscription, key, group, domains),
      );
    }

    const desiredIds = new Set(configured.map((config) => config.configId));
    const obsolete = (subscription.inbounds || []).filter(
      (inbound) =>
        inbound.status === InboundStatus.Active &&
        !PERSISTENT_INBOUND_TYPES.has(inbound.protocol) &&
        inbound.configId &&
        !desiredIds.has(inbound.configId),
    );
    if (results.every((result) => result.status === 'succeeded'))
      await this.queueCleanup(obsolete);
    return results;
  }

  async validateTarget(target: RotationTarget) {
    const source = await this.getOperation(target.operationId);
    const failed = source.results?.some(
      (result) =>
        result.subscriptionId === target.subscriptionId &&
        result.inboundResults?.some(
          (item) => item.configId === target.configId && item.error,
        ),
    );
    if (!failed) throw new NotFoundException('Failed inbound result not found');
    const subscription = await this.subRepo.findOneBy({
      id: target.subscriptionId,
    });
    return this.resolveTargetConfig(subscription, target);
  }

  async enqueueTargetedRotation(target: RotationTarget) {
    await this.validateTarget(target);
    const operation = await this.operationRepo.save(
      this.operationRepo.create({
        status: RotationOperationStatus.Queued,
        subscriptionIds: [target.subscriptionId],
        results: [],
        target,
      }),
    );
    return { id: operation.id, status: operation.status };
  }

  private async resolveTargetConfig(
    subscription: Subscription | null,
    target: RotationTarget,
  ) {
    const matches = subscription?.inboundsConfig?.filter(
      (config) => config.configId === target.configId,
    );
    const config = matches?.[0];
    if (
      !subscription?.isEnabled ||
      matches?.length !== 1 ||
      !config ||
      config.enabled === false ||
      PERSISTENT_INBOUND_TYPES.has(config.type) ||
      ROUTING_INBOUND_TYPES.has(config.type) ||
      config.type === 'custom'
    ) {
      throw new ConflictException(
        'Inbound is unavailable for targeted rotation',
      );
    }
    if (!target.patch) return config;
    if (inboundConfigVersion(config) !== target.version)
      throw new ConflictException('Inbound configuration has changed');
    const { port, sni, mode, path } = target.patch;
    if (path && config.type === 'xhttp-stable')
      throw new BadRequestException(
        'XHTTP Stable path is derived from its SNI domain',
      );
    if (
      (mode || path) &&
      config.type !== 'xhttp-stable' &&
      config.type !== 'https-fallback'
    )
      throw new BadRequestException(
        'XHTTP settings are unavailable for this inbound',
      );
    if (
      sni &&
      !['xhttp-stable', 'vless-xhttp-reality', 'vless-tcp-reality'].includes(
        config.type || '',
      )
    )
      throw new BadRequestException(
        'SNI repair is unavailable for this inbound',
      );
    if (
      sni &&
      (isExcludedSniDomain(sni) ||
        !(await this.domainRepo.findOneBy({ name: sni, isEnabled: true })))
    )
      throw new BadRequestException('SNI must be an enabled domain');
    if (
      config.type === 'https-fallback' &&
      ['nginx', 'caddy'].includes(config.profileSettings?.reverseProxy || '') &&
      ((port !== undefined && String(port) !== String(config.port)) ||
        path ||
        mode)
    ) {
      throw new ConflictException(
        'Update the reverse proxy and profile manually before rotating this inbound',
      );
    }
    return {
      ...config,
      ...(port !== undefined ? { port } : {}),
      ...(sni !== undefined ? { sni } : {}),
      ...(isManagedProfileKind(config.type)
        ? {
            profileSettings: {
              ...config.profileSettings,
              ...(sni ? { domain: sni } : {}),
              ...(mode ? { mode } : {}),
              ...(path ? { path } : {}),
            },
          }
        : {}),
    };
  }

  private async performTargetedRotation(operation: RotationOperation) {
    const target = operation.target!;
    return this.subscriptionLock.run(target.subscriptionId, async () => {
      // Activation and the successful result are committed together.
      const completed = operation.results?.[0];
      if (completed?.status === 'succeeded')
        return { success: true, message: '', results: [completed] };
      const subscription = await this.subRepo.findOne({
        where: { id: target.subscriptionId },
        relations: ['inbounds', 'inbounds.node', 'node', 'relayServer'],
      });
      const config = await this.resolveTargetConfig(subscription, target);
      if (!subscription) throw new NotFoundException('Subscription not found');
      const defaultNode = await this.getDefaultNode();
      const node = await this.resolveNode(
        config.nodeId,
        subscription,
        defaultNode,
      );
      const position = subscription.inboundsConfig.findIndex(
        (item) => item.configId === target.configId,
      );
      const domains = await this.domainRepo.find({
        where: { isEnabled: true },
      });
      const result = await this.rotateNodeGroup(
        subscription,
        node?.id || '__missing',
        {
          node: node ?? undefined,
          configs: [{ config, position }],
        },
        domains,
        operation,
      );
      return {
        success: result.status === 'succeeded',
        message: result.message,
        results: [result],
      };
    });
  }

  private async rotateNodeGroup(
    subscription: Subscription,
    key: string,
    group: { node?: Node; configs: PositionedInboundConfig[] },
    domains: Domain[],
    operation?: RotationOperation,
  ): Promise<RotationNodeResult> {
    const { node, configs } = group;
    const active = (subscription.inbounds || []).filter(
      (item) =>
        item.status === InboundStatus.Active &&
        !PERSISTENT_INBOUND_TYPES.has(item.protocol),
    );
    const desired = subscription.inboundsConfig || [];
    const usedPorts = new Set(
      active
        .filter((item) => item.nodeId === node?.id)
        .map((item) => item.port),
    );
    const occupied = new Map<number, InboundConfig[]>();
    const reserved = new Set<number>();
    for (const { config } of configs) {
      const port = this.fixedInboundPort(config);
      if (port !== null && config.type !== 'custom') {
        usedPorts.add(port);
        occupied.set(port, [...(occupied.get(port) || []), config]);
      }
      if (
        config.type === 'self-sni' &&
        (config.profileSettings?.webServer ?? 'nginx') !== 'none'
      )
        reserved.add(config.profileSettings?.localHttpsPort ?? 8443);
      if (
        config.type === 'https-fallback' &&
        ['nginx', 'caddy'].includes(config.profileSettings?.reverseProxy || '')
      )
        reserved.add(config.profileSettings?.publicPort ?? 443);
    }
    for (const port of reserved) usedPorts.add(port);

    const diagnostics: RotationInboundDiagnostic[] = [];
    const inboundResults: RotationConfigResult[] = [];
    const replacements: Array<{
      candidate: Inbound;
      previous?: Inbound;
      result: RotationConfigResult;
    }> = [];
    const preservedPositions: Array<{ id: number; position: number }> = [];
    let nodeCheck: Promise<unknown> | undefined;
    let runtimeUnhealthy = false;
    let rolledBack = false;
    let certificate: Promise<XuiCertificateFiles | null> | undefined;
    let keys: ReturnType<XuiService['getNewX25519Cert']> | undefined;
    const generationId = uuidv4();

    for (const positionedConfig of configs) {
      const { config, position } = positionedConfig;
      const previous = active.filter(
        (item) => config.configId && item.configId === config.configId,
      );
      const result: RotationConfigResult = {
        configId: config.configId,
        type: config.type,
        name: config.name,
        status: 'failed',
        previousActive: previous.length > 0,
      };
      inboundResults.push(result);
      let stage: OperationErrorStage = 'preflight';
      let candidate: Inbound | null = null;
      const diagnosticStart = diagnostics.length;
      try {
        if (key === '__missing')
          throw new Error('Для конфигурации не назначена нода');
        if (
          previous.length > 1 ||
          (config.configId &&
            desired.filter((item) => item.configId === config.configId).length >
              1) ||
          active.some(
            (item) =>
              !item.configId &&
              (key === '__custom'
                ? item.protocol === 'custom'
                : item.nodeId === node?.id &&
                  (item.protocol === panelInboundProtocol(config.type) ||
                    config.type?.startsWith(`${item.protocol}-`) ||
                    (item.protocol === 'vless' &&
                      isManagedProfileKind(config.type)))),
          )
        ) {
          result.previousActive = true;
          throw new Error('Неоднозначная связь инбаунда с configId');
        }
        const port = this.fixedInboundPort(config);
        result.port = port ?? undefined;
        if (
          port !== null &&
          config.type !== 'custom' &&
          ((occupied.get(port)?.length ?? 0) > 1 || reserved.has(port))
        )
          throw new Error(
            `Конфликт порта ${port}: порт уже используется конфигурацией или веб-сервером`,
          );
        if (
          node &&
          node.consecutiveFailures >= 3 &&
          [NodeHealthStatus.Offline, NodeHealthStatus.AuthError].includes(
            node.healthStatus,
          ) &&
          node.lastCheckedAt &&
          Date.now() - new Date(node.lastCheckedAt).getTime() < 120_000
        )
          throw new Error(`Нода ${node.name} временно недоступна`);
        this.assertNodeCompatibility(config, node);
        if (
          isManagedProfileKind(config.type) &&
          config.profileId &&
          !(await this.inboundRepo.manager.existsBy(ConnectionProfile, {
            id: config.profileId,
            kind: config.type,
          }))
        ) {
          throw new MissingConnectionProfileError();
        }
        if (runtimeUnhealthy)
          throw new Error('Xray недоступен после создания инбаунда');
        if (node)
          await (nodeCheck ??= Promise.resolve(
            this.xuiService.assertXrayHealthy(node),
          ));
        const preservable =
          !operation?.target?.patch &&
          this.findPreservableManagedInbound(
            config,
            subscription,
            node?.id,
            domains,
          );
        if (preservable) {
          preservedPositions.push({ id: preservable.id, position });
          result.status = 'unchanged';
          result.port = preservable.port;
          continue;
        }
        let nodeCertificate: XuiCertificateFiles | undefined;
        if (
          node &&
          requiresPanelTlsCertificate(config) &&
          this.getCertificateMode(config) === 'node'
        ) {
          nodeCertificate =
            (await (certificate ??=
              this.xuiService.getWebCertificateFiles(node))) ?? undefined;
          if (!nodeCertificate)
            throw new Error(
              'Нода не предоставила сертификат панели через getWebCertFiles',
            );
        }
        stage = 'create';
        let realityKeys:
          | Awaited<ReturnType<XuiService['getNewX25519Cert']>>
          | undefined;
        if (
          config.type?.includes('reality') ||
          config.type === 'xhttp-stable' ||
          config.type === 'self-sni'
        ) {
          realityKeys = await (keys ??= this.xuiService.getNewX25519Cert(node));
          if (!realityKeys) throw new Error('Нода не выдала Reality-ключи');
        }
        candidate = await this.createInbound({
          subscription,
          positionedConfig,
          node,
          domains,
          usedPorts,
          generationId,
          realityKeys,
          nodeCertificate,
          diagnostics,
          onStaged: (inbound) => {
            candidate = inbound;
          },
        });
        if (!candidate)
          throw new Error(
            this.xuiService.getLastInboundError(node) ||
              '3x-ui отклонил создание инбаунда',
          );
        result.port = candidate.port;
        result.xuiId = candidate.xuiId || undefined;

        stage = 'verify';
        if (
          node &&
          !['custom', 'amneziawg', 'mtproto-faketls'].includes(
            config.type || '',
          )
        ) {
          runtimeUnhealthy = true;
          await this.xuiService.waitForXray(node);
          runtimeUnhealthy = false;
        }
        if (
          operation?.target?.patch &&
          candidate.profileKind &&
          (!this.clientProbe || process.env.DISABLE_CANARY_PROBE === 'true')
        )
          throw new Error('Canary-проверка профиля недоступна');
        if (
          candidate.profileKind &&
          this.clientProbe &&
          process.env.DISABLE_CANARY_PROBE !== 'true'
        ) {
          const client = JSON.parse(
            candidate.clientProfileJson || 'null',
          ) as SeparatedClientProfile | null;
          if (!client) throw new Error('Клиентская конфигурация отсутствует');
          const check = await this.clientProbe.probeClientProfile(client, {
            waitForPortMs: 3000,
          });
          result.canary = {
            ...check,
            error: check.error ? redactOperationError(check.error) : undefined,
            sni: client.sni,
            host: client.xhttp?.host,
            path: client.xhttp?.path,
            mode: client.xhttp?.mode,
          };
          if (
            !check.success ||
            (operation?.target?.patch && check.engine !== 'xray-core')
          )
            throw new Error(
              `Canary-проверка профиля (${candidate.profileKind}) не пройдена: ${check.error || 'соединение не установлено'}`,
            );
        }
        replacements.push({ candidate, previous: previous[0], result });
        result.status = 'activated';
      } catch (error) {
        if (candidate) {
          rolledBack = true;
          result.cleanupQueued = await this.discardStagedInbound(
            candidate,
            node,
          );
          if (runtimeUnhealthy && node && !result.cleanupQueued) {
            try {
              await this.xuiService.waitForXray(node);
              runtimeUnhealthy = false;
            } catch {
              // Keep the group's staged replacements out of subscription feeds.
            }
          }
        }
        result.status = result.previousActive ? 'preserved' : 'failed';
        if (!candidate && diagnostics.length > diagnosticStart)
          result.port = diagnostics.at(-1)?.port;
        const raw = error instanceof Error ? error.message : String(error);
        result.error = normalizeOperationError(error, {
          node: node?.name,
          inboundType: config.type,
          port: result.port,
          stage,
          panelRejected:
            stage === 'create' && diagnostics.length > diagnosticStart,
        });
        this.logger.warn(
          `Ротация ${subscription.id}/${config.configId || position}: ${result.error.raw}`,
        );
        if (
          node &&
          (result.error.code === 'PORT_CONFLICT' ||
            error instanceof XuiRuntimeError)
        ) {
          const xuiId =
            (error instanceof XuiRuntimeError
              ? error.inbound?.xuiId
              : undefined) ||
            Number(/\(#(\d+)\)/.exec(raw)?.[1]) ||
            undefined;
          const listen = /\bon\s+([\d.:a-f\[\]]+)\s*\)/i.exec(raw)?.[1];
          const owner = xuiId
            ? await this.inboundRepo
                .findOne({
                  where: {
                    xuiId,
                    nodeId: node.id,
                    status: InboundStatus.Active,
                  },
                })
                .catch(() => null)
            : undefined;
          result.conflict = {
            xuiId,
            listen,
            subscriptionId: owner?.subscriptionId,
          };
        }
      }
    }

    if (runtimeUnhealthy) {
      for (const { candidate, result } of replacements.splice(0)) {
        rolledBack = true;
        result.cleanupQueued = await this.discardStagedInbound(candidate, node);
        result.status = result.previousActive ? 'preserved' : 'failed';
        result.error = normalizeOperationError('Xray недоступен на ноде', {
          node: node?.name,
          stage: 'verify',
          inboundType: result.type,
          port: result.port,
        });
      }
    }
    const old = replacements.flatMap((item) =>
      item.previous ? [item.previous] : [],
    );
    const failures = inboundResults.filter((item) => item.error);
    const firstError = failures[0]?.error;
    const pendingCleanup =
      old.length + inboundResults.filter((item) => item.cleanupQueued).length;
    const result: RotationNodeResult = {
      subscriptionId: subscription.id,
      subscriptionName: subscription.name,
      nodeId: node?.id,
      nodeName:
        node?.name || (key === '__custom' ? 'Локальные ссылки' : 'Без ноды'),
      panelVersion: node?.version,
      xrayVersion: node?.xrayVersion,
      status: !failures.length
        ? 'succeeded'
        : replacements.length
          ? 'partial'
          : failures.some((item) => item.previousActive)
            ? 'preserved'
            : 'failed',
      created: replacements.length,
      pendingCleanup,
      inboundResults,
      ...(preservedPositions.length
        ? { preserved: preservedPositions.length }
        : {}),
      ...(firstError
        ? { errorDetails: firstError, message: firstError.raw }
        : {}),
      ...(rolledBack ? { rolledBack: true } : {}),
      canaryResults: inboundResults.flatMap((item) =>
        item.canary ? [item.canary] : [],
      ),
      details: {
        phase: firstError?.stage || 'Активация',
        inbounds: diagnostics,
      },
    };
    if (replacements.length || preservedPositions.length) {
      try {
        await this.inboundRepo.manager.transaction(async (manager) => {
          if (old.length)
            await manager.update(
              Inbound,
              { id: In(old.map((item) => item.id)) },
              {
                status: InboundStatus.PendingCleanup,
                nextCleanupAt: new Date(),
              },
            );
          if (replacements.length)
            await manager.update(
              Inbound,
              {
                id: In(replacements.map((item) => item.candidate.id)),
              },
              { status: InboundStatus.Active },
            );
          for (const item of preservedPositions)
            await manager.update(
              Inbound,
              { id: item.id },
              { position: item.position },
            );
          if (operation?.target?.patch && result.status === 'succeeded') {
            const configured = [...subscription.inboundsConfig];
            configured[configs[0].position] = configs[0].config;
            await manager.update(
              Subscription,
              { id: subscription.id },
              { inboundsConfig: configured },
            );
          }
          if (operation && result.status === 'succeeded')
            await manager.update(
              RotationOperation,
              { id: operation.id },
              { results: [result] },
            );
        });
      } catch (error) {
        const ids = replacements.map((item) => item.candidate.id);
        if (ids.length) {
          // Keep rows that were activated if the commit acknowledgement was lost.
          await this.inboundRepo
            .update(
              { id: In(ids), status: InboundStatus.Staged },
              {
                status: InboundStatus.PendingCleanup,
                nextCleanupAt: new Date(),
              },
            )
            .catch(() => undefined);
        }
        throw error;
      }
    }
    return result;
  }

  private async discardStagedInbound(candidate: Inbound, node?: Node) {
    await this.queueCleanup([candidate]);
    if (!node || !candidate.xuiId) return true;
    try {
      const removed = await this.removeOrDetachInboundFromPanel(
        candidate,
        node,
      );
      if (!removed) return true;
      await this.inboundRepo.delete(candidate.id);
      return false;
    } catch {
      return true;
    }
  }

  private usesFallbackProxy(config: InboundConfig) {
    return (
      config.type === 'https-fallback' &&
      ['nginx', 'caddy'].includes(config.profileSettings?.reverseProxy || '')
    );
  }

  private fixedInboundPort(config: InboundConfig) {
    return (
      this.parseFixedPort(config.port) ??
      (this.usesFallbackProxy(config) ? 20443 : null)
    );
  }

  private parseFixedPort(port?: number | string): number | null {
    const value = Number(port);
    return Number.isInteger(value) && value >= 1 && value <= 65535
      ? value
      : null;
  }

  /**
   * Preserves an already active managed profile inbound when rotating a node group
   * if its rotation policy is `preserve_all` OR it binds a fixed numeric port
   * (e.g. 443) with non-standard rotation policy and its key parameters are unchanged.
   * This avoids self-inflicted port collisions in 3x-ui during routine rotation.
   */
  private findPreservableManagedInbound(
    config: InboundConfig,
    subscription: Subscription,
    nodeId: string | undefined,
    domains: Domain[],
  ): Inbound | null {
    if (!isManagedProfileKind(config.type) || !config.configId || !nodeId) {
      return null;
    }
    const rotationPolicy =
      config.profileSettings?.rotationPolicy || 'fixed_domain';
    if (rotationPolicy === 'standard') return null;

    const fixedPort = this.fixedInboundPort(config);
    if (rotationPolicy !== 'preserve_all' && fixedPort === null) {
      return null;
    }

    const active = (subscription.inbounds || []).find(
      (inbound) =>
        inbound.status === InboundStatus.Active &&
        inbound.configId === config.configId &&
        inbound.nodeId === nodeId &&
        inbound.profileKind === config.type &&
        inbound.port > 0 &&
        Boolean(inbound.clientProfileJson),
    );
    if (!active || !active.clientProfileJson) return null;
    if ((active.profileId ?? null) !== (config.profileId ?? null)) return null;
    if (fixedPort !== null && active.port !== fixedPort) return null;

    let parsed: SeparatedClientProfile;
    try {
      parsed = JSON.parse(active.clientProfileJson) as SeparatedClientProfile;
    } catch {
      return null;
    }
    if (parsed.kind !== config.type) return null;

    const desiredDomain =
      config.type === 'xhttp-stable'
        ? explicitXhttpStableSni(config.sni, config.profileSettings?.domain)
        : config.profileSettings?.domain?.trim().toLowerCase() ||
          config.tlsServerName?.trim().toLowerCase() ||
          (config.sni && config.sni.trim() !== 'random'
            ? config.sni.trim().toLowerCase()
            : '');
    if (desiredDomain && parsed.sni?.trim().toLowerCase() !== desiredDomain)
      return null;

    if (
      config.type === 'xhttp-stable' &&
      !desiredDomain &&
      !domains.some(
        (domain) =>
          domain.name.toLowerCase() === parsed.sni?.toLowerCase() &&
          !isExcludedSniDomain(domain.name),
      )
    )
      return null;

    const automatic =
      config.type === 'xhttp-stable'
        ? xhttpStableSniSettings(desiredDomain || parsed.sni)
        : undefined;
    if (
      automatic &&
      (parsed.xhttp?.host !== automatic.host ||
        parsed.spiderX !== automatic.spiderX)
    )
      return null;
    const desiredFp =
      automatic?.fingerprint || config.profileSettings?.fingerprint?.trim();
    if (desiredFp && parsed.fingerprint !== desiredFp) return null;

    if (config.type === 'xhttp-stable' || config.type === 'https-fallback') {
      const desiredPath = (
        automatic?.path ||
        config.profileSettings?.path?.trim() ||
        (config.type === 'https-fallback' ? '/api/v2/stream' : '/')
      ).replace(/^(?!\/)/, '/');
      if (parsed.xhttp?.path && parsed.xhttp.path !== desiredPath) {
        return null;
      }
      const desiredMode = config.profileSettings?.mode || 'auto';
      if (parsed.xhttp?.mode && parsed.xhttp.mode !== desiredMode) {
        return null;
      }
      if (config.type === 'https-fallback') {
        const proxy = config.profileSettings?.reverseProxy ?? 'none';
        const expectedClientPort =
          proxy === 'nginx' || proxy === 'caddy'
            ? (config.profileSettings?.publicPort ?? 443)
            : active.port;
        if (parsed.port !== expectedClientPort) return null;
      }
    }

    return active;
  }

  /**
   * Finds an existing active managed inbound on the same node so multiple
   * subscriptions can share one 3x-ui inbound (one port) with separate per-subscription
   * VLESS clients (UUIDs) instead of colliding on the same port.
   */
  private matchesFallbackListener(
    expected: XuiInboundRaw,
    actual: XuiInboundRaw,
  ) {
    try {
      if (
        !actual.enable ||
        actual.protocol !== expected.protocol ||
        actual.port !== expected.port ||
        (actual.listen || '0.0.0.0') !== (expected.listen || '0.0.0.0')
      )
        return false;
      const desired = JSON.parse(expected.streamSettings) as XuiStreamSettings;
      const current = JSON.parse(actual.streamSettings) as XuiStreamSettings;
      const xhttp = current.xhttpSettings;
      if (
        current.network !== desired.network ||
        (current.security || 'none') !== desired.security ||
        !xhttp ||
        xhttp.host?.toLowerCase() !==
          desired.xhttpSettings?.host?.toLowerCase() ||
        xhttp.path !== desired.xhttpSettings?.path ||
        (xhttp.mode || 'auto') !== desired.xhttpSettings?.mode ||
        Boolean(xhttp.noGRPCHeader) !==
          Boolean(desired.xhttpSettings?.noGRPCHeader)
      ) {
        return false;
      }
      verifyTlsIdentity(expected, actual);
      return true;
    } catch {
      return false;
    }
  }

  private async findSharedManagedInbound(
    config: InboundConfig,
    nodeId: string,
    sni: string,
    expected: XuiInboundRaw,
    node: Node,
  ): Promise<Inbound | null> {
    if (
      !isManagedProfileKind(config.type) ||
      typeof this.inboundRepo.find !== 'function'
    ) {
      return null;
    }
    const fallbackProxy = this.usesFallbackProxy(config);
    const fixedPort = this.fixedInboundPort(config);
    if (!config.profileId && fixedPort === null) {
      return null;
    }

    const candidates = await this.inboundRepo.find({
      where: {
        nodeId,
        status: InboundStatus.Active,
        profileKind: config.type,
        ...(fixedPort === null
          ? { profileId: config.profileId }
          : { port: fixedPort }),
      },
      order: { createdAt: 'DESC' },
      ...(config.type === 'https-fallback'
        ? {}
        : { relations: ['subscription'] }),
    });
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    const normalize = (value: string | undefined) =>
      value?.trim().toLowerCase() || '';
    const checkedFallbackListeners = new Set<number>();
    for (const candidate of candidates) {
      if (!candidate.xuiId || !candidate.clientProfileJson) continue;
      if (fixedPort !== null && candidate.port !== fixedPort) continue;
      if (fixedPort === null && candidate.profileId !== config.profileId)
        continue;
      if (config.type === 'https-fallback') {
        // For a profile on a random direct port, compare the live listener at its assigned port.
        const expectedAtPort = { ...expected, port: candidate.port };
        try {
          const client = JSON.parse(
            candidate.clientProfileJson,
          ) as SeparatedClientProfile;
          if (
            client.kind !== 'https-fallback' ||
            client.port !==
              (fallbackProxy
                ? (config.profileSettings?.publicPort ?? 443)
                : candidate.port) ||
            (sni && normalize(client.sni) !== normalize(sni))
          )
            continue;
          if (checkedFallbackListeners.has(candidate.xuiId)) continue;
          checkedFallbackListeners.add(candidate.xuiId);
          const current = await this.xuiService.getInbound(
            candidate.xuiId,
            node,
          );
          if (this.matchesFallbackListener(expectedAtPort, current))
            return candidate;
        } catch {
          // A missing or stale panel record is not a safe target for attaching a client.
        }
        continue;
      }
      const owner = candidate.subscription?.inboundsConfig?.find(
        (item) => item.configId === candidate.configId,
      );
      if (!owner || owner.type !== config.type) continue;
      const settings = (item: InboundConfig) => {
        const ignored =
          item.type === 'xhttp-stable'
            ? [
                'rotationPolicy',
                'domain',
                'path',
                'host',
                'spiderX',
                'fingerprint',
              ]
            : ['rotationPolicy'];
        return Object.entries(item.profileSettings || {})
          .filter(([key]) => !ignored.includes(key))
          .sort(([left], [right]) => left.localeCompare(right));
      };
      if (
        JSON.stringify(settings(owner)) !== JSON.stringify(settings(config)) ||
        owner.certificateMode !== config.certificateMode ||
        owner.certificateFile !== config.certificateFile ||
        owner.keyFile !== config.keyFile ||
        normalize(owner.tlsServerName) !== normalize(config.tlsServerName)
      )
        continue;
      try {
        const parsed = JSON.parse(
          candidate.clientProfileJson,
        ) as SeparatedClientProfile;
        if (sni && normalize(parsed.sni) !== normalize(sni)) continue;
        if (config.type === 'xhttp-stable') {
          const auto = xhttpStableSniSettings(sni);
          if (
            parsed.xhttp?.path !== auto.path ||
            parsed.xhttp?.host !== auto.host ||
            parsed.fingerprint !== auto.fingerprint ||
            parsed.spiderX !== auto.spiderX
          )
            continue;
        }
        if (
          config.profileSettings?.mode &&
          parsed.xhttp?.mode !== config.profileSettings.mode
        )
          continue;
        return candidate;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Deletes only this subscription's client from a shared 3x-ui inbound when
   * other active/staged subscriptions still reference the same (nodeId, xuiId);
   * deletes the whole 3x-ui inbound only once the last reference is gone.
   */
  private async removeOrDetachInboundFromPanel(
    inbound: Inbound,
    node?: Node,
    excludeIds?: number[],
  ): Promise<boolean> {
    if (!inbound.xuiId || inbound.xuiId <= 0) return true;
    const ignored = excludeIds?.length ? excludeIds : [inbound.id];
    const targetNodeId = inbound.nodeId || inbound.node?.id || node?.id;
    let otherRefs = 0;
    if (targetNodeId && typeof this.inboundRepo.count === 'function') {
      try {
        otherRefs = await this.inboundRepo.count({
          where: {
            nodeId: targetNodeId,
            xuiId: inbound.xuiId,
            id: Not(In(ignored)),
            status: In([InboundStatus.Active, InboundStatus.Staged]),
          },
        });
      } catch {
        return false;
      }
    }

    if (otherRefs > 0 || inbound.clientId) {
      const clientId = inbound.clientId || extractInboundClientId(inbound);
      if (
        clientId &&
        typeof this.xuiService.deleteInboundClient === 'function'
      ) {
        return this.xuiService.deleteInboundClient(
          inbound.xuiId,
          clientId,
          node,
        );
      }
      this.logger.warn(
        `[RotationService] Пропущено удаление общего inbound ${inbound.xuiId} (используется ещё ${otherRefs} подписками; UUID клиента не извлечён)`,
      );
      return false;
    }

    return this.xuiService.deleteInbound(inbound.xuiId, node);
  }

  private assertNodeCompatibility(config: InboundConfig, node?: Node) {
    if (config.type === 'custom') return;
    if (!node) throw new Error('Для конфигурации не назначена нода');
    const supported = supportsInboundType(config.type as InboundType, {
      panelVersion: node.version,
      xrayVersion: node.xrayVersion,
      autoTlsCertificate: Boolean(node.webCertificateFile && node.webKeyFile),
    });
    if (!supported) {
      if (config.type === 'vless-ws')
        throw new Error(
          'VLESS WS без TLS несовместим с клиентом Xray 26.9.9+; выберите VLESS WS TLS',
        );
      throw new Error(
        `Конфигурация ${config.type} несовместима с профилем ноды «${node.name}» ` +
          `(3x-ui: ${node.version || 'не определена'}, Xray: ${node.xrayVersion || 'не определена'})`,
      );
    }
    if (isManagedProfileKind(config.type)) {
      const compat = evaluateProfileCompatibility({
        kind: config.type,
        port: config.port,
        sni: config.tlsServerName || config.sni,
        settings: config.profileSettings,
        node: {
          name: node.name,
          version: node.version,
          xrayVersion: node.xrayVersion,
          autoTlsCertificate: Boolean(
            node.webCertificateFile && node.webKeyFile,
          ),
        },
      });
      if (!compat.compatible) {
        const reasons = compat.checks
          .filter((item) => item.severity === 'error')
          .map((item) => item.message)
          .join('; ');
        throw new Error(
          reasons ||
            `Профиль ${config.type} несовместим с нодой «${node.name}»`,
        );
      }
    }
  }

  private getCertificateMode(config: InboundConfig) {
    return config.certificateMode === 'custom'
      ? ('custom' as const)
      : ('node' as const);
  }

  private resolveTlsConfig(
    config: InboundConfig,
    node: Node,
    nodeCertificate?: XuiCertificateFiles,
  ): ResolvedTlsConfig {
    if (this.getCertificateMode(config) === 'custom') {
      return this.resolveCustomTlsConfig(config, node);
    }
    if (!nodeCertificate) {
      throw new Error(`TLS-сертификат ноды «${node.name}» не получен`);
    }
    const serverName = this.getNodeTlsServerName(node);
    assertManagedCertificateHost(nodeCertificate.certificateFile, serverName);
    assertManagedCertificateHost(nodeCertificate.keyFile, serverName);
    return {
      ...nodeCertificate,
      serverName,
    };
  }

  private resolveCustomTlsConfig(
    config: InboundConfig,
    node: Node,
  ): ResolvedTlsConfig {
    const certificateFile =
      config.certificateFile?.trim() ||
      config.profileSettings?.certificateFile?.trim();
    const keyFile =
      config.keyFile?.trim() || config.profileSettings?.keyFile?.trim();
    const serverName =
      config.tlsServerName?.trim() ||
      config.profileSettings?.domain?.trim() ||
      (config.sni !== 'random' ? config.sni?.trim() : undefined) ||
      (config.certificateMode ? undefined : this.getNodeTlsServerName(node));
    if (
      !certificateFile ||
      !keyFile ||
      !serverName ||
      !isSafeAbsoluteRemotePath(certificateFile) ||
      !isSafeAbsoluteRemotePath(keyFile)
    ) {
      throw new Error(
        'Для собственного TLS нужны корректные абсолютные пути и имя сервера',
      );
    }
    assertManagedCertificateHost(certificateFile, serverName);
    assertManagedCertificateHost(keyFile, serverName);
    return { certificateFile, keyFile, serverName };
  }

  private getNodeTlsServerName(node: Node) {
    const domain = node.domain?.trim();
    if (domain) return domain;
    try {
      const hostname = new URL(node.url).hostname;
      if (hostname) return hostname;
    } catch {
      // Ошибка ниже явно объясняет, какое поле требуется заполнить.
    }
    throw new Error(
      `Для TLS на ноде «${node.name}» укажите домен ноды или URL с hostname`,
    );
  }

  private resolveInboundSni(
    config: InboundConfig,
    domains: Domain[],
    subscription?: Subscription,
  ) {
    if (
      (CERTIFICATE_INBOUND_TYPES.has(config.type as InboundType) &&
        config.type !== 'https-fallback') ||
      PERSISTENT_INBOUND_TYPES.has(config.type) ||
      config.type === 'vless-xhttp-get'
    )
      return '';
    if (isManagedProfileKind(config.type)) {
      const explicitDomain =
        config.type === 'xhttp-stable'
          ? explicitXhttpStableSni(config.sni, config.profileSettings?.domain)
          : config.profileSettings?.domain?.trim() ||
            config.tlsServerName?.trim() ||
            (config.sni && config.sni.trim() !== 'random'
              ? config.sni.trim()
              : '');
      if (explicitDomain) return explicitDomain;
      const rotationPolicy =
        config.profileSettings?.rotationPolicy || 'fixed_domain';
      if (rotationPolicy !== 'standard' && config.configId && subscription) {
        const previousSni = this.findActiveProfileSni(
          subscription,
          config.configId,
        );
        if (
          previousSni &&
          (config.type !== 'xhttp-stable' ||
            domains.some(
              (domain) =>
                domain.name.toLowerCase() === previousSni.toLowerCase() &&
                !isExcludedSniDomain(domain.name),
            ))
        )
          return previousSni;
      }
      if (config.type === 'self-sni') {
        throw new Error(
          'Профиль Self-SNI требует явного указания собственного домена и не может использовать случайный SNI',
        );
      }
      if (config.type === 'https-fallback') {
        return '';
      }
      return this.pickDomain(domains);
    }
    const configuredSni = config.sni?.trim() || '';
    if (configuredSni === 'random') return this.pickDomain(domains);
    if (config.type !== 'mtproto-faketls') return configuredSni;
    const normalizedSni = normalizeFakeTlsDomain(configuredSni);
    const listedDomain = domains.find(
      (domain) => normalizeFakeTlsDomain(domain.name) === normalizedSni,
    );
    return listedDomain?.name ?? this.pickDomain(domains);
  }

  private findActiveProfileSni(
    subscription: Subscription,
    configId: string,
  ): string | undefined {
    const active = (subscription.inbounds || []).find(
      (inbound) =>
        inbound.status === InboundStatus.Active &&
        inbound.configId === configId,
    );
    if (!active) return undefined;
    if (active.clientProfileJson) {
      try {
        const parsed = JSON.parse(
          active.clientProfileJson,
        ) as Partial<SeparatedClientProfile>;
        if (parsed.sni && parsed.sni.trim()) return parsed.sni.trim();
      } catch {
        // Fallback to URL parsing
      }
    }
    if (active.link) {
      try {
        const parsedSni = new URL(active.link).searchParams.get('sni')?.trim();
        if (parsedSni) return parsedSni;
      } catch {
        // Ignore malformed links
      }
    }
    return undefined;
  }

  private async createInbound(request: CreateInboundRequest) {
    if (request.node && this.nodeDeletion.isDeleting(request.node.id)) {
      throw new Error(`Нода «${request.node.name}» удаляется`);
    }
    const {
      subscription,
      positionedConfig: { config, position },
      node,
      domains,
      usedPorts,
      generationId,
      realityKeys,
      nodeCertificate,
    } = request;
    if (config.type === 'custom') {
      return this.inboundRepo.save(
        this.inboundRepo.create({
          xuiId: 0,
          port: 0,
          protocol: 'custom',
          remark: config.name?.trim() || 'custom-link',
          link: config.link || '',
          configId: config.configId,
          position,
          subscription,
          status: InboundStatus.Staged,
          generationId,
        }),
      );
    }
    if (!node) return null;
    const relay = await this.resolveRelay(
      config.relayServerId,
      subscription.relayServer,
    );
    const relayServer =
      relay && this.isRelayAvailableForNode(relay, node) ? relay : undefined;
    const hostSetting = await this.settingRepo.findOne({
      where: { key: 'xui_host' },
    });
    const targetAddress =
      relayServer?.domain ||
      relayServer?.ip ||
      this.getNodeAddress(node) ||
      hostSetting?.value ||
      'localhost';
    const flagSetting = await this.settingRepo.findOne({
      where: { key: 'xui_geo_flag' },
    });
    const flag =
      config.flag || node.flag || flagSetting?.value || '%F0%9F%92%AF';
    const fixedPort = this.fixedInboundPort(config);
    const port = fixedPort ?? (await this.getFreePort(usedPorts));
    usedPorts.add(port);
    const uuid = uuidv4();
    const email = formatClientEmail(subscription.name, uuid);
    const sni = this.resolveInboundSni(config, domains, subscription);

    const resolvedTls = requiresPanelTlsCertificate(config)
      ? this.resolveTlsConfig(config, node, nodeCertificate)
      : undefined;
    const built =
      config.type === 'hysteria2-udp'
        ? this.inboundBuilder.buildHysteria2Inbound({
            port,
            uuid,
            email,
            ...resolvedTls!,
          })
        : config.type === 'amneziawg'
          ? this.inboundBuilder.buildAmneziaWgInbound({ port, uuid, email })
          : this.buildPanelInbound({
              config,
              port,
              uuid,
              email,
              sni,
              realityKeys,
              tls: resolvedTls,
            });
    if (!built) throw new Error(`Неизвестный тип inbound: ${config.type}`);
    if (config.name?.trim()) built.remark = config.name.trim();
    const diagnostic = {
      ...inboundDiagnostic(built),
      configId: config.configId,
      name: config.name,
    };
    request.diagnostics?.push(diagnostic);

    const randomPort = fixedPort === null;
    if (this.nodeDeletion.isDeleting(node.id)) {
      throw new Error(`Нода «${node.name}» удаляется`);
    }
    let result: Awaited<ReturnType<XuiService['addInbound']>> = null;
    let attachedToShared = false;
    if (
      isManagedProfileKind(config.type) &&
      typeof this.xuiService.addInboundClient === 'function'
    ) {
      const shared = await this.findSharedManagedInbound(
        config,
        node.id,
        sni,
        built,
        node,
      );
      if (shared) {
        const clientEntry = {
          id: uuid,
          flow: config.type === 'self-sni' ? 'xtls-rprx-vision' : '',
          email,
          enable: true,
          limitIp: 0,
          totalGB: 0,
          expiryTime: 0,
          subId: '',
          reset: 0,
        };
        const attached =
          config.type === 'https-fallback'
            ? await this.xuiService.addInboundClient(
                shared.xuiId,
                clientEntry,
                node,
                (current) =>
                  this.matchesFallbackListener(
                    { ...built, port: shared.port },
                    current,
                  ),
              )
            : await this.xuiService.addInboundClient(
                shared.xuiId,
                clientEntry,
                node,
              );
        if (!attached && config.type === 'https-fallback') {
          throw new Error(
            this.xuiService.getLastInboundError(node) ||
              '3x-ui отклонила добавление клиента в общий HTTPS Fallback',
          );
        }
        if (attached) {
          result = attached;
          attachedToShared = true;
          diagnostic.port = attached.inbound.port;
          this.logger.log(
            `[RotationService] Подписка «${subscription.name}» добавлена клиентом в общий inbound ${shared.xuiId} (порт ${attached.inbound.port}, профиль «${config.name || config.type}») на ноде «${node.name}»`,
          );
        }
      }
    }
    if (!result) {
      result = await this.xuiService.addInbound(built, node);
      for (let attempt = 1; !result && randomPort && attempt < 3; attempt++) {
        if (!isPortConflict(this.xuiService.getLastInboundError(node))) break;
        built.port = await this.getFreePort(usedPorts);
        diagnostic.port = built.port;
        usedPorts.add(built.port);
        if (this.nodeDeletion.isDeleting(node.id)) {
          throw new Error(`Нода «${node.name}» удаляется`);
        }
        result = await this.xuiService.addInbound(built, node);
      }
    }
    if (!result) return null;
    const saved = result.inbound;
    Object.assign(diagnostic, inboundDiagnostic(saved));
    usedPorts.add(saved.port);
    let staged: Inbound;
    try {
      // Persist ownership before building the link, so failures can be cleaned
      // up by the existing durable cleanup queue.
      staged = await this.saveStagedInbound({
        subscription,
        config,
        position,
        node,
        relayServer,
        generationId,
        xuiId: result.id,
        port: saved.port,
        protocol: saved.protocol === 'hysteria' ? 'hysteria2' : saved.protocol,
        remark: saved.remark,
        link: '',
        clientId: attachedToShared ? uuid : undefined,
      });
    } catch (error) {
      const deleted = attachedToShared
        ? await this.xuiService.deleteInboundClient(result.id, uuid, node)
        : await this.xuiService.deleteInbound(result.id, node);
      if (!deleted)
        this.logger.error(
          `Не удалось сохранить или удалить новый инбаунд ${result.id} на ноде «${node.name}»; требуется очистка на панели`,
        );
      throw error;
    }
    request.onStaged?.(staged);
    try {
      if (result.verificationError) throw new Error(result.verificationError);
      if (config.type === 'xhttp-stable') {
        const expected = JSON.parse(built.streamSettings) as XuiStreamSettings;
        const actual = JSON.parse(saved.streamSettings) as XuiStreamSettings;
        const xhttp = expected.xhttpSettings;
        if (
          xhttp &&
          (actual.network !== expected.network ||
            actual.security !== expected.security ||
            actual.xhttpSettings?.path !== xhttp.path ||
            (actual.xhttpSettings?.mode || 'auto') !== xhttp.mode ||
            actual.xhttpSettings?.host !== xhttp.host ||
            !actual.realitySettings?.serverNames?.includes(xhttp.host || sni))
        ) {
          throw new Error(
            '3x-ui не сохранила SNI, Host, Path или режим XHTTP по запрошенной конфигурации',
          );
        }
      }
      if (
        config.type === 'xhttp-stable' ||
        config.type === 'self-sni' ||
        config.type === 'https-fallback'
      ) {
        const bundle =
          config.type === 'xhttp-stable'
            ? this.inboundBuilder.buildXhttpStableClientBundle(
                saved,
                targetAddress,
                flag,
                config.profileSettings,
                attachedToShared ? uuid : undefined,
              )
            : config.type === 'self-sni'
              ? this.inboundBuilder.buildSelfSniClientBundle(
                  saved,
                  targetAddress,
                  flag,
                  config.profileSettings,
                  attachedToShared ? uuid : undefined,
                )
              : this.inboundBuilder.buildHttpsFallbackClientBundle(
                  saved,
                  relayServer?.domain ||
                    relayServer?.ip ||
                    sni ||
                    resolvedTls?.serverName ||
                    targetAddress,
                  flag,
                  config.profileSettings,
                  sni || resolvedTls?.serverName,
                  attachedToShared ? uuid : undefined,
                );
        if (!bundle) {
          throw new Error(
            `Не удалось сформировать клиентский профиль ${config.type}`,
          );
        }
        staged.link = bundle.vlessLink;
        staged.profileId = config.profileId ?? null;
        staged.profileKind = config.type;
        staged.clientProfileJson = JSON.stringify(bundle.clientConfig);
        return await this.inboundRepo.save(staged);
      }
      // The builder chooses the credential according to the protocol from the
      // panel's saved client, not from the originally requested UUID.
      const link = this.inboundBuilder.buildInboundLink(
        saved,
        targetAddress,
        '',
        flag,
        config.type,
      );
      if (!link)
        throw new Error(`Не удалось сформировать ссылку ${config.type}`);
      staged.link = link;
      return await this.inboundRepo.save(staged);
    } catch (error) {
      if (!request.onStaged) await this.queueCleanup([staged]);
      throw error;
    }
  }

  private buildPanelInbound(request: {
    config: InboundConfig;
    port: number;
    uuid: string;
    email?: string;
    sni: string;
    realityKeys?: { privateKey: string; publicKey: string } | null;
    tls?: ResolvedTlsConfig;
  }): XuiInboundRaw | null {
    const { config, port, uuid, email, sni, realityKeys, tls } = request;
    const realityParams = realityKeys
      ? { port, uuid, email, sni, ...realityKeys }
      : null;
    const builders: Record<string, () => XuiInboundRaw | null> = {
      'vless-tcp-reality': () =>
        realityParams
          ? this.inboundBuilder.buildVlessRealityTcp(realityParams)
          : null,
      'vless-xhttp-get': () =>
        this.inboundBuilder.buildVlessXhttpGet({ port, uuid, email }),
      'vless-xhttp-reality': () =>
        realityParams
          ? this.inboundBuilder.buildVlessRealityXhttp(realityParams)
          : null,
      'xhttp-stable': () =>
        realityParams
          ? this.inboundBuilder.buildXhttpStableInbound({
              ...realityParams,
              remark: config.name?.trim() || 'xhttp-stable',
              settings: config.profileSettings,
            })
          : null,
      'self-sni': () =>
        realityParams
          ? this.inboundBuilder.buildSelfSniInbound({
              port,
              uuid,
              email,
              domain: sni,
              privateKey: realityParams.privateKey,
              publicKey: realityParams.publicKey,
              remark: config.name?.trim() || 'self-sni',
              settings: config.profileSettings,
            })
          : null,
      'https-fallback': () => {
        const fallbackDomain =
          sni ||
          tls?.serverName ||
          config.profileSettings?.domain?.trim() ||
          '';
        if (!fallbackDomain) return null;
        return this.inboundBuilder.buildHttpsFallbackInbound({
          port,
          uuid,
          email,
          domain: fallbackDomain,
          certificateFile: tls?.certificateFile,
          keyFile: tls?.keyFile,
          remark: config.name?.trim() || 'https-fallback',
          settings: config.profileSettings,
        });
      },
      'vless-grpc-reality': () =>
        realityParams
          ? this.inboundBuilder.buildVlessRealityGrpc(realityParams)
          : null,
      'trojan-tcp-reality': () =>
        realityParams
          ? this.inboundBuilder.buildTrojanRealityTcp(realityParams)
          : null,
      'vless-ws': () =>
        this.inboundBuilder.buildVlessWs({ port, uuid, email, sni }),
      'vless-tcp-tls': () =>
        tls
          ? this.inboundBuilder.buildVlessTlsTcp({ port, uuid, email, ...tls })
          : null,
      'vless-ws-tls': () =>
        tls
          ? this.inboundBuilder.buildVlessTlsWs({ port, uuid, email, ...tls })
          : null,
      'vless-xhttp-tls': () =>
        tls
          ? this.inboundBuilder.buildVlessTlsXhttp({
              port,
              uuid,
              email,
              ...tls,
            })
          : null,
      'vmess-tcp': () =>
        this.inboundBuilder.buildVmessTcp({ port, uuid, email }),
      'shadowsocks-tcp': () =>
        this.inboundBuilder.buildShadowsocksTcp({ port, uuid, email }),
      wireguard: () =>
        this.inboundBuilder.buildWireguardInbound({ port, uuid, email }),
      mixed: () =>
        this.inboundBuilder.buildProxyInbound({ port, protocol: 'mixed' }),
      http: () =>
        this.inboundBuilder.buildProxyInbound({ port, protocol: 'http' }),
      socks: () =>
        this.inboundBuilder.buildProxyInbound({ port, protocol: 'socks' }),
      'mtproto-faketls': () =>
        this.inboundBuilder.buildMtprotoInbound({
          port,
          uuid,
          email,
          fakeTlsDomain: sni,
        }),
    };
    return builders[config.type || '']?.() ?? null;
  }

  private saveStagedInbound(request: SaveStagedInboundRequest) {
    const {
      subscription,
      config,
      position,
      node,
      relayServer,
      generationId,
      xuiId,
      port,
      protocol,
      remark,
      link,
    } = request;
    return this.inboundRepo.save(
      this.inboundRepo.create({
        xuiId,
        port,
        protocol,
        remark,
        link,
        clientId: request.clientId,
        configId: config.configId,
        position,
        subscription,
        node,
        nodeId: node.id,
        relayServer,
        status: InboundStatus.Staged,
        generationId,
      }),
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processCleanupQueue() {
    if (
      this.processingCleanup ||
      this.processingOperation ||
      this.dbAvailability.shouldSkip()
    )
      return;
    this.processingCleanup = true;
    try {
      const items = await this.inboundRepo
        .createQueryBuilder('inbound')
        .leftJoinAndSelect('inbound.node', 'node')
        .addSelect('inbound.clientId')
        .where('inbound.status = :status', {
          status: InboundStatus.PendingCleanup,
        })
        .andWhere(
          '(inbound.nextCleanupAt IS NULL OR inbound.nextCleanupAt <= :now)',
          {
            now: new Date(),
          },
        )
        .andWhere(
          '(inbound.cleanupAttempts < :max OR node.deletedAt IS NOT NULL)',
          {
            max: this.maxCleanupAttempts,
          },
        )
        .orderBy('inbound.createdAt', 'ASC')
        .take(50)
        .getMany();
      this.dbAvailability.recordSuccess(this.logger, 'RotationService');

      const failedNodeIdsInBatch = new Set<string>();

      for (const inbound of items) {
        const attempts = inbound.cleanupAttempts || 0;
        const node = await this.resolveInboundNode(inbound);

        // 2. If inbound has nodeId but node does not exist, purge from DB
        if (inbound.nodeId && !node) {
          this.logger.warn(
            `Инбаунд ${inbound.id} привязан к несуществующей ноде ${inbound.nodeId}. Удаление из локальной БД.`,
          );
          await this.inboundRepo.delete(inbound.id);
          continue;
        }

        // 3. If node is marked deleted and unreachable/offline, purge immediately
        if (node?.deletedAt) {
          const isOffline =
            [
              NodeHealthStatus.Offline,
              NodeHealthStatus.AuthError,
              NodeHealthStatus.Degraded,
            ].includes(node.healthStatus) ||
            node.consecutiveFailures >= 1 ||
            attempts >= 1;

          if (isOffline) {
            this.logger.warn(
              `Удаление инбаунда ${inbound.id} (xuiId ${inbound.xuiId}) из локальной БД: нода «${node.name}» удалена и недоступна.`,
            );
            await this.inboundRepo.delete(inbound.id);
            continue;
          }
        }

        // 4. Batch Fail-Fast: if node failed earlier in this batch, postpone without network delay
        if (node && failedNodeIdsInBatch.has(node.id)) {
          inbound.cleanupAttempts = attempts + 1;
          inbound.lastCleanupError = `Нода «${node.name}» не отвечает в текущей очереди`;
          inbound.nextCleanupAt = new Date(
            Date.now() + this.cleanupDelay(inbound.cleanupAttempts),
          );
          await this.inboundRepo.save(inbound);
          continue;
        }

        // 5. If node is active but known to be offline or degraded, postpone without hanging on timeout
        if (
          node &&
          ([
            NodeHealthStatus.Offline,
            NodeHealthStatus.AuthError,
            NodeHealthStatus.Degraded,
          ].includes(node.healthStatus) ||
            node.consecutiveFailures > 0)
        ) {
          inbound.cleanupAttempts = attempts + 1;
          inbound.lastCleanupError = `Нода «${node.name}» временно недоступна (${node.healthStatus})`;
          inbound.nextCleanupAt = new Date(
            Date.now() + this.cleanupDelay(inbound.cleanupAttempts),
          );
          await this.inboundRepo.save(inbound);
          continue;
        }

        // 6. Normal deletion attempt via 3x-ui API (or single-client detach if shared)
        const deleted =
          !inbound.xuiId || inbound.xuiId <= 0
            ? true
            : await this.removeOrDetachInboundFromPanel(inbound, node);

        if (deleted) {
          await this.inboundRepo.delete(inbound.id);
          continue;
        }

        if (node?.id) {
          failedNodeIdsInBatch.add(node.id);
        }

        inbound.cleanupAttempts = attempts + 1;
        inbound.lastCleanupError = 'Нода недоступна или отклонила удаление';
        inbound.nextCleanupAt = new Date(
          Date.now() + this.cleanupDelay(inbound.cleanupAttempts),
        );
        await this.inboundRepo.save(inbound);
      }

      await this.finalizeDeletedNodes();
      await this.pruneOldOperationsSafely();
    } catch (error) {
      if (
        !this.dbAvailability.recordFailure(
          error,
          this.logger,
          'processCleanupQueue',
        )
      ) {
        this.logger.error(
          `[RotationService] Сбой очереди очистки: ${this.safeMessage(error)}`,
        );
      }
    } finally {
      this.processingCleanup = false;
    }
  }

  private async pruneOldOperationsSafely() {
    if (
      typeof this.operationRepo.find !== 'function' ||
      typeof this.operationRepo.delete !== 'function'
    ) {
      return;
    }
    const now = Date.now();
    if (
      this.lastOperationPruneAt > 0 &&
      now - this.lastOperationPruneAt <
        RotationService.OPERATION_PRUNE_INTERVAL_MS
    ) {
      return;
    }
    try {
      const stale = await this.operationRepo.find({
        where: {
          status: In([
            RotationOperationStatus.Succeeded,
            RotationOperationStatus.Partial,
            RotationOperationStatus.Failed,
          ]),
        },
        select: ['id'],
        order: { createdAt: 'DESC' },
        skip: RotationService.MAX_STORED_OPERATIONS,
        take: RotationService.OPERATION_PRUNE_BATCH,
      });
      if (Array.isArray(stale) && stale.length > 0) {
        await this.operationRepo.delete(stale.map((item) => item.id));
        this.logger.log(
          `[RotationService] Очищено ${stale.length} устаревших записей истории ротаций`,
        );
      }
      if (
        !Array.isArray(stale) ||
        stale.length < RotationService.OPERATION_PRUNE_BATCH
      ) {
        this.lastOperationPruneAt = now;
      }
    } catch (error) {
      if (
        !this.dbAvailability.recordFailure(
          error,
          this.logger,
          'pruneOldOperations',
        )
      ) {
        this.logger.warn(
          `[RotationService] Не удалось очистить старые записи операций: ${this.safeMessage(error)}`,
        );
      }
    }
  }

  async retryCleanup(id: number) {
    const inbound = await this.inboundRepo.findOne({ where: { id } });
    if (!inbound || inbound.status !== InboundStatus.PendingCleanup) {
      throw new NotFoundException('Cleanup task not found');
    }
    await this.inboundRepo.update(
      { id, status: InboundStatus.PendingCleanup },
      { nextCleanupAt: new Date(), cleanupAttempts: 0 },
    );
    return { success: true };
  }

  async deleteCleanup(id: number) {
    const inbound = await this.inboundRepo.findOne({ where: { id } });
    if (!inbound || inbound.status !== InboundStatus.PendingCleanup) {
      throw new NotFoundException('Cleanup task not found');
    }
    await this.inboundRepo.delete(id);
    this.logger.log(`Инбаунд ${id} принудительно удален из очереди очистки`);
    return { success: true };
  }

  async purgeFailedCleanup() {
    const items = await this.inboundRepo
      .createQueryBuilder('inbound')
      .leftJoinAndSelect('inbound.node', 'node')
      .addSelect('inbound.clientId')
      .where('inbound.status = :status', {
        status: InboundStatus.PendingCleanup,
      })
      .getMany();

    let purgedCount = 0;

    for (const item of items) {
      const isFailed =
        (item.cleanupAttempts || 0) >= 1 ||
        !item.node ||
        Boolean(item.node.deletedAt) ||
        item.node.healthStatus === NodeHealthStatus.Offline ||
        item.node.healthStatus === NodeHealthStatus.AuthError ||
        item.node.healthStatus === NodeHealthStatus.Degraded;

      if (isFailed) {
        if (item.node && item.xuiId && item.xuiId > 0 && !item.node.deletedAt) {
          try {
            const resolvedNode = await this.resolveInboundNode(item);
            if (resolvedNode) {
              await this.removeOrDetachInboundFromPanel(item, resolvedNode);
            }
          } catch {
            // Node might be offline; continue purge
          }
        }
        await this.inboundRepo.delete(item.id);
        purgedCount++;
      }
    }

    this.logger.log(
      `Принудительно очищено ${purgedCount} зависших задач очистки.`,
    );
    return { success: true, purgedCount };
  }

  listCleanup() {
    return this.inboundRepo.find({
      where: { status: InboundStatus.PendingCleanup },
      relations: ['node', 'subscription'],
      order: { nextCleanupAt: 'ASC' },
      take: 200,
    });
  }

  private cleanupDelay(attempt: number) {
    const minutes = [1, 5, 15, 60, 360];
    return minutes[Math.min(attempt - 1, minutes.length - 1)] * 60000;
  }

  private async finalizeDeletedNodes() {
    const nodes = await this.nodeRepo
      .createQueryBuilder('node')
      .addSelect('node.password')
      .addSelect('node.token')
      .where('node.deletedAt IS NOT NULL')
      .getMany();
    for (const node of nodes) {
      const remaining = await this.inboundRepo.count({
        where: { nodeId: node.id },
      });
      if (remaining === 0) {
        this.logger.log(
          `Удалённая нода «${node.name}» (${node.id}) окончательно очищена и удалена.`,
        );
        await this.nodeRepo.remove(node);
      }
    }
  }

  private async queueCleanup(inbounds: Inbound[]) {
    if (!inbounds.length) return;
    const nextCleanupAt = new Date();
    const status = InboundStatus.PendingCleanup;
    await this.inboundRepo.update(
      { id: In(inbounds.map((inbound) => inbound.id)) },
      { status, nextCleanupAt },
    );
    for (const inbound of inbounds) {
      inbound.status = status;
      inbound.nextCleanupAt = nextCleanupAt;
    }
  }

  private pickDomain(domains: Domain[]) {
    const eligible = domains.filter(
      (domain) => !isExcludedSniDomain(domain.name),
    );
    if (!eligible.length) throw new Error('Список доменов пуст');
    return eligible[Math.floor(Math.random() * eligible.length)].name;
  }

  private async getFreePort(currentBatch: Set<number>) {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const port = Math.floor(Math.random() * 50001) + 10000;
      if (currentBatch.has(port)) continue;
      const exists = await this.inboundRepo.findOne({ where: { port } });
      if (!exists) return port;
    }
    throw new Error('Не удалось подобрать свободный порт');
  }

  private async saveSetting(key: string, value: string) {
    const setting =
      (await this.settingRepo.findOne({ where: { key } })) ||
      this.settingRepo.create({ key });
    setting.value = value;
    await this.settingRepo.save(setting);
  }

  private async getDefaultNode(): Promise<Node | null> {
    const mainNode = await this.nodeRepo
      .createQueryBuilder('node')
      .addSelect('node.password')
      .addSelect('node.token')
      .where('node.isMain = true')
      .andWhere('node.deletedAt IS NULL')
      .getOne();
    if (mainNode) return mainNode;

    return this.nodeRepo
      .createQueryBuilder('node')
      .addSelect('node.password')
      .addSelect('node.token')
      .where('node.deletedAt IS NULL')
      .orderBy('node.createdAt', 'ASC')
      .getOne();
  }

  private async resolveNode(
    nodeId?: string,
    subscriptionOrNode?: Node | Pick<Subscription, 'node' | 'name'>,
    defaultNode?: Node | null,
  ): Promise<Node | undefined> {
    const subscriptionNode =
      subscriptionOrNode && 'node' in subscriptionOrNode
        ? subscriptionOrNode.node
        : (subscriptionOrNode as Node | undefined);
    const subscriptionName =
      subscriptionOrNode && 'name' in subscriptionOrNode
        ? subscriptionOrNode.name
        : undefined;

    const targetId = nodeId || subscriptionNode?.id;
    if (targetId) {
      const node = await this.nodeRepo
        .createQueryBuilder('node')
        .addSelect('node.password')
        .addSelect('node.token')
        .where('node.id = :nodeId', { nodeId: targetId })
        .andWhere('node.deletedAt IS NULL')
        .getOne();
      if (node && !this.nodeDeletion.isDeleting(node.id)) return node;
      this.logger.warn(
        `[RotationService] Нода с ID "${targetId}" не найдена или была удалена. Выполняется откат на резервную ноду.`,
      );
    }

    if (subscriptionName) {
      const matchingNode = await this.nodeRepo
        .createQueryBuilder('node')
        .addSelect('node.password')
        .addSelect('node.token')
        .where('LOWER(TRIM(node.name)) = LOWER(TRIM(:name))', {
          name: subscriptionName,
        })
        .andWhere('node.deletedAt IS NULL')
        .getOne();
      if (matchingNode && !this.nodeDeletion.isDeleting(matchingNode.id)) {
        this.logger.log(
          `[RotationService] Для подписки «${subscriptionName}» найдена активная нода с совпадающим именем: «${matchingNode.name}» [${matchingNode.id}]`,
        );
        return matchingNode;
      }
    }

    return defaultNode && !this.nodeDeletion.isDeleting(defaultNode.id)
      ? defaultNode
      : undefined;
  }

  private async resolveInboundNode(
    inbound: Inbound,
  ): Promise<Node | undefined> {
    const targetId = inbound.nodeId || inbound.node?.id;
    if (!targetId) return inbound.node;
    return (
      (await this.nodeRepo
        .createQueryBuilder('node')
        .addSelect('node.password')
        .addSelect('node.token')
        .where('node.id = :nodeId', { nodeId: targetId })
        .andWhere('node.deletedAt IS NULL')
        .getOne()) || inbound.node
    );
  }

  private async resolveRelay(
    relayServerId?: number,
    subscriptionRelay?: Tunnel,
  ) {
    if (!relayServerId) return subscriptionRelay ?? undefined;
    return (
      (await this.tunnelRepo.findOne({ where: { id: relayServerId } })) ||
      undefined
    );
  }

  private isRelayAvailableForNode(relay: Tunnel, node?: Node) {
    return !relay.nodeId || Boolean(node?.id && relay.nodeId === node.id);
  }

  private getNodeAddress(node?: Node) {
    if (!node) return undefined;
    if (node.domain) return node.domain;
    if (node.ip) return node.ip;
    if (node.host) return node.host;
    try {
      return node.url ? new URL(node.url).hostname : undefined;
    } catch {
      return node.url;
    }
  }

  private safeMessage(error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Неизвестная ошибка';
    return redactOperationError(message, 16384);
  }
}
