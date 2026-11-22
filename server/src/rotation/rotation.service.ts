import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Inbound, InboundStatus } from '../inbounds/entities/inbound.entity';
import { Domain } from '../domains/entities/domain.entity';
import { Setting } from '../settings/entities/setting.entity';
import { Node, NodeHealthStatus } from '../nodes/entities/node.entity';
import { Tunnel } from '../tunnels/entities/tunnel.entity';
import { XuiCertificateFiles, XuiService } from '../xui/xui.service';
import { InboundBuilderService } from '../inbounds/inbound-builder.service';
import { XuiInboundRaw } from '../inbounds/xui-inbound.types';
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
} from '../xui/xui-contract';
import { supportsInboundType } from '../nodes/node-capabilities';
import { SubscriptionLockService } from '../subscriptions/subscription-lock.service';
import { NodeDeletionService } from '../nodes/node-deletion.service';
import { renameAmneziaVpnLink } from '../inbounds/amnezia-vpn-link';
import {
  normalizeOperationError,
  redactOperationError,
  OperationErrorStage,
} from './operation-error';
import {
  RotationNodeResult,
  RotationOperation,
  RotationOperationStatus,
  RotationInboundDiagnostic,
} from './entities/rotation-operation.entity';
import {
  classifyDatabaseError,
  databaseAvailability,
} from '../database/database-availability';
import {
  isManagedProfileKind,
  type SeparatedClientProfile,
} from '../profiles/connection-profile.types';
import { evaluateProfileCompatibility } from '../profiles/profile-compatibility';

type InboundConfig = NonNullable<Subscription['inboundsConfig']>[number];

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
    if (this.processingOperation || this.dbAvailability.shouldSkip()) return;

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
        const result = await this.performRotation(operation.subscriptionIds);
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
          : result.results.some((item) => item.status === 'succeeded')
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
    for (const subscription of subscriptions) {
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
    const noneSucceeded =
      results.length === 0 || results.every((item) => item.status === 'failed');

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
          !PERSISTENT_INBOUND_TYPES.has(inbound.protocol),
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
          !PERSISTENT_INBOUND_TYPES.has(inbound.protocol),
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
    const desiredKeys = new Set(groups.keys());
    for (const [key, group] of groups) {
      results.push(
        await this.rotateNodeGroup(subscription, key, group, domains),
      );
    }

    const obsolete = (subscription.inbounds || []).filter((inbound) => {
      if (PERSISTENT_INBOUND_TYPES.has(inbound.protocol)) return false;
      if (inbound.status !== InboundStatus.Active) return false;
      const key =
        inbound.protocol === 'custom'
          ? '__custom'
          : inbound.nodeId || '__missing';
      return !desiredKeys.has(key);
    });
    if (obsolete.length > 0) {
      this.logger.log(
        `[RotationService] Помечено на очистку ${obsolete.length} устаревших инбаундов для подписки «${subscription.name}»`,
      );
    }
    await this.queueCleanup(obsolete);
    return results;
  }

  private async rotateNodeGroup(
    subscription: Subscription,
    key: string,
    group: { node?: Node; configs: PositionedInboundConfig[] },
    domains: Domain[],
  ): Promise<RotationNodeResult> {
    const generationId = uuidv4();
    const created: Inbound[] = [];
    const usedPorts = new Set<number>();
    const diagnostics: RotationInboundDiagnostic[] = [];
    let phase = 'Проверка ноды и TLS';
    let stage: OperationErrorStage = 'preflight';
    let failedConfig: InboundConfig | undefined;
    let failedPort: number | undefined;
    let failureReason: string | undefined;
    let diagnosticStart = 0;
    let realityKeys:
      | Awaited<ReturnType<XuiService['getNewX25519Cert']>>
      | undefined;

    const nodeLabel =
      group.node?.name ||
      (key === '__custom' ? 'Локальные ссылки' : 'Без ноды');
    this.logger.log(
      `[RotationService] Запуск ротации группы ноды «${nodeLabel}» для подписки «${subscription.name}» (${group.configs.length} инбаундов)...`,
    );

    try {
      if (key === '__missing')
        throw new Error('Для конфигурации не назначена нода');
      if (
        group.node &&
        group.node.consecutiveFailures >= 3 &&
        [NodeHealthStatus.Offline, NodeHealthStatus.AuthError].includes(
          group.node.healthStatus,
        ) &&
        group.node.lastCheckedAt &&
        Date.now() - new Date(group.node.lastCheckedAt).getTime() < 120_000
      ) {
        throw new Error(`Нода ${group.node.name} временно недоступна`);
      }
      const nodeCertificate = await this.preflightNodeGroup(
        group.configs,
        group.node,
      );
      const rejectedInbounds: Array<{
        type: string;
        name?: string;
        reason: string;
      }> = [];

      for (const positionedConfig of group.configs) {
        const { config } = positionedConfig;
        phase = `Создание ${config.name || config.type}`;
        stage = 'create';
        diagnosticStart = diagnostics.length;
        if (!failureReason) {
          failedConfig = config;
          failedPort = undefined;
        }
        if (
          (config.type?.includes('reality') ||
            config.type === 'xhttp-stable' ||
            config.type === 'self-sni') &&
          !realityKeys
        ) {
          this.logger.log(
            `[RotationService] Запрос ключей Reality для ноды «${group.node?.name || 'main'}»...`,
          );
          realityKeys = await this.xuiService.getNewX25519Cert(group.node);
          if (!realityKeys) {
            throw new Error(
              `Нода «${group.node?.name || 'main'}» не выдала Reality-ключи`,
            );
          }
          this.logger.log(
            `[RotationService] Ключи Reality успешно получены для ноды «${group.node?.name || 'main'}»`,
          );
        }
        const inbound = await this.createInbound({
          subscription,
          positionedConfig,
          node: group.node,
          domains,
          usedPorts,
          generationId,
          realityKeys,
          nodeCertificate,
          diagnostics,
        });
        if (!inbound) {
          const reason =
            this.xuiService.getLastInboundError(group.node) ||
            '3x-ui отклонил создание инбаунда';
          if (!failureReason) {
            failureReason = reason;
            failedConfig = config;
            failedPort = diagnostics.at(-1)?.port;
          }
          rejectedInbounds.push({
            type: config.type,
            name: config.name,
            reason,
          });
          continue;
        }
        created.push(inbound);
      }

      if (rejectedInbounds.length > 0) {
        const summary = rejectedInbounds
          .map(
            (item) =>
              `[${item.type}${item.name ? ` / ${item.name}` : ''}]: ${item.reason}`,
          )
          .join('; ');
        this.logger.warn(
          `[RotationService] Сводка отклонённых панелью инбаундов для подписки «${subscription.name}» на ноде «${nodeLabel}» (${rejectedInbounds.length}/${group.configs.length}): ${redactOperationError(summary, 16384)}`,
        );
        throw new Error(summary);
      }

      if (!created.length) {
        const failureDetails = rejectedInbounds.length
          ? rejectedInbounds
              .map((item) => `${item.type} (${item.reason})`)
              .join('; ')
          : '3x-ui отклонил inbound';
        throw new Error(
          `3x-ui отклонил все инбаунды на ноде «${nodeLabel}»: ${failureDetails}`,
        );
      }

      phase = 'Проверка запуска Xray';
      stage = 'verify';
      failedConfig = undefined;
      failedPort = undefined;
      if (
        group.node &&
        group.configs.some(
          ({ config }) =>
            !['custom', 'amneziawg', 'mtproto-faketls'].includes(config.type),
        )
      )
        await this.xuiService.waitForXray(group.node);

      const old = (subscription.inbounds || []).filter((inbound) => {
        if (PERSISTENT_INBOUND_TYPES.has(inbound.protocol)) return false;
        if (inbound.status !== InboundStatus.Active) return false;
        return key === '__custom'
          ? inbound.protocol === 'custom'
          : inbound.nodeId === group.node?.id;
      });
      await this.inboundRepo.manager.transaction(async (manager) => {
        if (old.length) {
          await manager.update(
            Inbound,
            { id: In(old.map((item) => item.id)) },
            { status: InboundStatus.PendingCleanup, nextCleanupAt: new Date() },
          );
        }
        if (created.length) {
          await manager.update(
            Inbound,
            { id: In(created.map((item) => item.id)) },
            { status: InboundStatus.Active },
          );
        }
      });
      this.logger.log(
        `[RotationService] Успешно создано ${created.length} инбаундов для подписки «${subscription.name}» на ноде «${nodeLabel}» (устаревших: ${old.length})`,
      );
      return {
        subscriptionId: subscription.id,
        subscriptionName: subscription.name,
        nodeId: group.node?.id,
        nodeName: group.node?.name || 'Локальные ссылки',
        status: 'succeeded',
        created: created.length,
        pendingCleanup: old.length,
      };
    } catch (error) {
      const errMessage = this.safeMessage(error);
      let blockingInbound;
      if (error instanceof XuiRuntimeError && error.inbound) {
        const owner =
          error.inbound.xuiId && group.node
            ? await this.inboundRepo
                .findOne({
                  where: { xuiId: error.inbound.xuiId, nodeId: group.node.id },
                  relations: ['subscription'],
                })
                .catch(() => null)
            : null;
        blockingInbound = {
          ...error.inbound,
          subscriptionId: owner?.subscription?.id,
          subscriptionName: owner?.subscription?.name,
        };
      }
      this.logger.error(
        `[RotationService] Сбой ротации для подписки «${subscription.name}» на ноде «${nodeLabel}»: ${errMessage}`,
        error instanceof Error && error.stack
          ? redactOperationError(error.stack, 16384)
          : undefined,
      );
      await this.queueCleanup(created);
      return {
        subscriptionId: subscription.id,
        subscriptionName: subscription.name,
        nodeId: group.node?.id,
        nodeName:
          group.node?.name ||
          (key === '__custom' ? 'Локальные ссылки' : 'Без ноды'),
        status: 'preserved',
        created: 0,
        pendingCleanup: created.length,
        message: errMessage,
        errorDetails: normalizeOperationError(failureReason || errMessage, {
          node: group.node?.name,
          inboundType: failedConfig?.type,
          port:
            failedPort ||
            (failedConfig && diagnostics.length > diagnosticStart
              ? diagnostics.at(-1)?.port
              : undefined) ||
            (typeof failedConfig?.port === 'number'
              ? failedConfig.port
              : /^\d+$/.test(failedConfig?.port || '')
                ? Number(failedConfig?.port)
                : undefined),
          stage,
          panelRejected: Boolean(failureReason),
        }),
        details: {
          phase,
          inbounds: diagnostics.length
            ? diagnostics
            : group.configs.map(({ config }) => ({
                protocol: config.type,
                configId: config.configId,
                name: config.name,
                serverName:
                  config.certificateMode === 'custom'
                    ? config.tlsServerName
                    : undefined,
                certificates:
                  config.certificateMode === 'custom'
                    ? [
                        {
                          certificateFile: config.certificateFile,
                          keyFile: config.keyFile,
                        },
                      ]
                    : undefined,
              })),
          blockingInbound,
        },
      };
    }
  }

  private async preflightNodeGroup(
    positionedConfigs: PositionedInboundConfig[],
    node?: Node,
  ): Promise<XuiCertificateFiles | undefined> {
    const configs = positionedConfigs.map(({ config }) => config);
    for (const config of configs) this.assertNodeCompatibility(config, node);
    if (node) await this.xuiService.assertXrayHealthy(node);

    const needsNodeCertificate = configs.some(
      (config) =>
        requiresPanelTlsCertificate(config) &&
        this.getCertificateMode(config) === 'node',
    );
    let certificate: XuiCertificateFiles | undefined;
    if (needsNodeCertificate) {
      if (!node) throw new Error('Для TLS-конфигурации не назначена нода');
      certificate =
        (await this.xuiService.getWebCertificateFiles(node)) || undefined;
      if (!certificate) {
        throw new Error(
          `Нода «${node.name}» не предоставила сертификат панели через getWebCertFiles`,
        );
      }
    }
    for (const config of configs) {
      if (!requiresPanelTlsCertificate(config)) continue;
      if (!node) throw new Error('Для TLS-конфигурации не назначена нода');
      try {
        this.resolveTlsConfig(config, node, certificate);
      } catch (error) {
        throw new Error(
          `Конфигурация «${config.name || config.type}» (${config.configId || 'без configId'}): ${this.safeMessage(error)}`,
        );
      }
    }
    return certificate;
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
        config.profileSettings?.domain?.trim() ||
        config.tlsServerName?.trim() ||
        (config.sni && config.sni.trim() !== 'random' ? config.sni.trim() : '');
      if (explicitDomain) return explicitDomain;
      const rotationPolicy =
        config.profileSettings?.rotationPolicy || 'fixed_domain';
      if (rotationPolicy !== 'standard' && config.configId && subscription) {
        const previousSni = this.findActiveProfileSni(
          subscription,
          config.configId,
        );
        if (previousSni) return previousSni;
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
    const port =
      config.port === 'random' || !config.port
        ? await this.getFreePort(usedPorts)
        : Number(config.port);
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

    const randomPort = config.port === 'random' || !config.port;
    if (this.nodeDeletion.isDeleting(node.id)) {
      throw new Error(`Нода «${node.name}» удаляется`);
    }
    let result = await this.xuiService.addInbound(built, node);
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
      });
    } catch (error) {
      const deleted = await this.xuiService.deleteInbound(result.id, node);
      if (!deleted)
        this.logger.error(
          `Не удалось сохранить или удалить новый инбаунд ${result.id} на ноде «${node.name}»; требуется очистка на панели`,
        );
      throw error;
    }
    try {
      if (result.verificationError) throw new Error(result.verificationError);
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
              )
            : config.type === 'self-sni'
              ? this.inboundBuilder.buildSelfSniClientBundle(
                  saved,
                  targetAddress,
                  flag,
                  config.profileSettings,
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
      await this.queueCleanup([staged]);
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
        configId: config.configId,
        position,
        subscription,
        node,
        relayServer,
        status: InboundStatus.Staged,
        generationId,
      }),
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processCleanupQueue() {
    if (this.processingCleanup || this.dbAvailability.shouldSkip()) return;
    this.processingCleanup = true;
    try {
      const items = await this.inboundRepo
        .createQueryBuilder('inbound')
        .leftJoinAndSelect('inbound.node', 'node')
        .where('inbound.status = :status', {
          status: InboundStatus.PendingCleanup,
        })
        .andWhere(
          '(inbound.nextCleanupAt IS NULL OR inbound.nextCleanupAt <= :now)',
          {
            now: new Date(),
          },
        )
        .orderBy('inbound.createdAt', 'ASC')
        .take(50)
        .getMany();
      this.dbAvailability.recordSuccess(this.logger, 'RotationService');

      const failedNodeIdsInBatch = new Set<string>();
      const successfulNodes = new Map<string, Node>();

      for (const inbound of items) {
        const attempts = inbound.cleanupAttempts || 0;

        // 1. If max cleanup attempts exceeded, purge from DB
        if (attempts >= this.maxCleanupAttempts) {
          this.logger.warn(
            `Превышен лимит попыток очистки (${this.maxCleanupAttempts}) для инбаунда ${inbound.id} (xuiId ${inbound.xuiId}). Запись удалена из локальной БД.`,
          );
          await this.inboundRepo.delete(inbound.id);
          continue;
        }

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

        // 6. Normal deletion attempt via 3x-ui API
        const deleted =
          !inbound.xuiId || inbound.xuiId <= 0
            ? true
            : await this.xuiService.deleteInbound(inbound.xuiId, node);

        if (deleted) {
          if (node?.id) {
            successfulNodes.set(node.id, node);
          }
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

      for (const node of successfulNodes.values()) {
        await this.cleanupZeroTrafficOrphans(node);
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
    inbound.nextCleanupAt = new Date();
    await this.inboundRepo.save(inbound);
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
      .where('inbound.status = :status', {
        status: InboundStatus.PendingCleanup,
      })
      .getMany();

    let purgedCount = 0;
    const nodesToClean = new Map<string, Node>();

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
              await this.xuiService.deleteInbound(item.xuiId, resolvedNode);
              nodesToClean.set(resolvedNode.id, resolvedNode);
            }
          } catch {
            // Node might be offline; continue purge
          }
        }
        await this.inboundRepo.delete(item.id);
        purgedCount++;
      }
    }

    try {
      const defaultNode = await this.getDefaultNode();
      if (defaultNode && !nodesToClean.has(defaultNode.id)) {
        nodesToClean.set(defaultNode.id, defaultNode);
      }
    } catch {
      // Continue
    }

    for (const node of nodesToClean.values()) {
      await this.cleanupZeroTrafficOrphans(node);
    }

    this.logger.log(
      `Принудительно очищено ${purgedCount} зависших задач очистки.`,
    );
    return { success: true, purgedCount };
  }

  async cleanupZeroTrafficOrphans(node: Node): Promise<number> {
    try {
      if (!this.xuiService.listRoutingInbounds) {
        return 0;
      }
      const panelInbounds = await this.xuiService.listRoutingInbounds(node);
      if (!Array.isArray(panelInbounds) || !panelInbounds.length) {
        return 0;
      }

      const trackedInbounds = await this.inboundRepo.find({
        where: {
          nodeId: node.id,
          status: In([InboundStatus.Active, InboundStatus.Staged]),
        },
        select: ['xuiId'],
      });
      const trackedXuiIds = new Set(
        trackedInbounds
          .map((i) => i.xuiId)
          .filter((id): id is number => typeof id === 'number' && id > 0),
      );

      let cleanedCount = 0;
      const now = Date.now();
      const MIN_AGE_MS = 5 * 60 * 1000;

      for (const raw of panelInbounds) {
        if (!raw.id || trackedXuiIds.has(raw.id)) {
          continue;
        }

        const totalTraffic = (Number(raw.up) || 0) + (Number(raw.down) || 0);
        if (totalTraffic > 0) {
          continue;
        }

        const clientStats = Array.isArray(raw.clientStats)
          ? raw.clientStats
          : [];
        if (clientStats.length > 1) {
          continue;
        }

        const hasClientTraffic = clientStats.some(
          (cs: Record<string, unknown>) =>
            (Number(cs.up) || 0) > 0 || (Number(cs.down) || 0) > 0,
        );
        if (hasClientTraffic) {
          continue;
        }

        let clients: Array<Record<string, unknown>> = [];
        try {
          const rawSettings: unknown =
            typeof raw.settings === 'string'
              ? JSON.parse(raw.settings)
              : raw.settings;
          const parsedSettings =
            typeof rawSettings === 'object' && rawSettings !== null
              ? (rawSettings as { clients?: unknown })
              : null;
          clients = Array.isArray(parsedSettings?.clients)
            ? (parsedSettings.clients as Array<Record<string, unknown>>)
            : [];
        } catch {
          continue;
        }

        if (clients.length > 1) {
          continue;
        }

        const createdAt =
          Number(clients[0]?.created_at) ||
          Number((clientStats[0] as Record<string, unknown>)?.created_at) ||
          0;
        if (createdAt > 0 && now - createdAt < MIN_AGE_MS) {
          continue;
        }

        const lastOnline =
          Number((clientStats[0] as Record<string, unknown>)?.lastOnline) || 0;
        if (lastOnline > 0 && now - lastOnline < MIN_AGE_MS) {
          continue;
        }

        try {
          const deleted = await this.xuiService.deleteInbound(raw.id, node);
          if (deleted) {
            cleanedCount++;
            this.logger.log(
              `[Cleanup] Удален устаревший инбаунд ${raw.id} (${raw.remark || raw.protocol}) с 0 B расхода на ноде «${node.name}»`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `[Cleanup] Ошибка удаления устаревшего инбаунда ${raw.id} на ноде «${node.name}»: ${this.safeMessage(err)}`,
          );
        }
      }

      return cleanedCount;
    } catch (err) {
      this.logger.warn(
        `[Cleanup] Не удалось выполнить проверку неактивных инбаундов на ноде «${node.name}»: ${this.safeMessage(err)}`,
      );
      return 0;
    }
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
    const now = new Date();
    for (const inbound of inbounds) {
      inbound.status = InboundStatus.PendingCleanup;
      inbound.nextCleanupAt = now;
    }
    await this.inboundRepo.save(inbounds);
  }

  private pickDomain(domains: Domain[]) {
    if (!domains.length) throw new Error('Список доменов пуст');
    return domains[Math.floor(Math.random() * domains.length)].name;
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
