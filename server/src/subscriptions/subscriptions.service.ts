import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsOrder, In, Not, Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { XuiService } from '../xui/xui.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { MoveSubscriptionDto } from './dto/move-subscription.dto';
import { v4 as uuidv4 } from 'uuid';
import { Node } from '../nodes/entities/node.entity';
import { Tunnel } from '../tunnels/entities/tunnel.entity';
import { Inbound, InboundStatus } from '../inbounds/entities/inbound.entity';
import { extractInboundClientId } from '../inbounds/inbound-client.util';
import { sortInboundsByPosition } from '../inbounds/inbound-order';
import {
  ACTIVE_MANAGED_PROFILE_TYPES,
  CERTIFICATE_INBOUND_TYPES,
  CertificateMode,
  INBOUND_TYPES,
  InboundType,
  PERSISTENT_INBOUND_TYPES,
  ROUTING_INBOUND_TYPES,
  panelInboundProtocol,
  requiresPanelTlsCertificate,
} from './inbound-config.constants';
import { supportsInboundType } from '../nodes/node-capabilities';
import { isManagedProfileKind } from '../profiles/connection-profile.types';
import {
  evaluateProfileCompatibility,
  normalizeManagedProfileSettings,
  validateManagedProfileSettings,
} from '../profiles/profile-compatibility';
import {
  isValidFakeTlsDomain,
  normalizeFakeTlsDomain,
} from '../inbounds/mtproto-faketls';
import { isSafeAbsoluteRemotePath } from '../inbounds/tls-config';
import { Domain } from '../domains/entities/domain.entity';
import {
  isProxyProtocol,
  proxyConnectionFromLink,
  wireguardConfigFromLink,
} from '../inbounds/connection-profiles';
import { RotationService } from '../rotation/rotation.service';
import { SubscriptionLockService } from './subscription-lock.service';
import { buildHappRoutingLink, buildIncyRoutingLink } from './routing-profile';

type InboundConfig = NonNullable<
  CreateSubscriptionDto['inboundsConfig']
>[number];

const TLS_SERVER_NAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const subscriptionOrder: FindOptionsOrder<Subscription> = {
  displayOrder: { direction: 'ASC', nulls: 'FIRST' },
  createdAt: 'DESC',
  id: 'DESC',
};

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  constructor(
    @InjectRepository(Subscription)
    private subRepo: Repository<Subscription>,
    @InjectRepository(Node)
    private nodeRepo: Repository<Node>,
    @InjectRepository(Tunnel)
    private tunnelRepo: Repository<Tunnel>,
    @InjectRepository(Domain)
    private domainRepo: Repository<Domain>,
    private xuiService: XuiService,
    private rotationService: RotationService,
    private subscriptionLock: SubscriptionLockService,
  ) {}

  async findAll() {
    const subscriptions = await this.subRepo.find({
      relations: ['inbounds', 'node', 'relayServer'],
      order: subscriptionOrder,
    });
    for (const subscription of subscriptions) {
      subscription.inbounds = sortInboundsByPosition(
        (subscription.inbounds || []).filter(
          (inbound) => inbound.status === InboundStatus.Active,
        ),
      );
      for (const inbound of subscription.inbounds) {
        if (isProxyProtocol(inbound.protocol))
          inbound.connection =
            proxyConnectionFromLink(inbound.link) ?? undefined;
        if (inbound.protocol === 'wireguard')
          inbound.wireguardConfig =
            wireguardConfigFromLink(inbound.link) ?? undefined;
      }
    }
    return subscriptions;
  }

  async move({ subscriptionId, neighborId, direction }: MoveSubscriptionDto) {
    return this.subRepo.manager.transaction(async (manager) => {
      // Keep the checked neighbor and the positions stable during a concurrent edit.
      await manager.query(
        'LOCK TABLE "subscription" IN SHARE ROW EXCLUSIVE MODE',
      );
      const subscriptions = await manager.find(Subscription, {
        select: ['id'],
        order: subscriptionOrder,
      });
      const ids = subscriptions.map((subscription) => subscription.id);
      const position = ids.indexOf(subscriptionId.toLowerCase());
      const neighborPosition = position + (direction === 'up' ? -1 : 1);
      if (position < 0 || ids[neighborPosition] !== neighborId.toLowerCase()) {
        throw new ConflictException(
          'Порядок подписок изменился. Повторите перемещение.',
        );
      }

      [ids[position], ids[neighborPosition]] = [
        ids[neighborPosition],
        ids[position],
      ];
      await manager.query(
        `UPDATE "subscription" AS sub
         SET "displayOrder" = ordered.position
         FROM unnest($1::uuid[]) WITH ORDINALITY AS ordered(id, position)
         WHERE sub.id = ordered.id AND sub."displayOrder" IS DISTINCT FROM ordered.position`,
        [ids],
      );
      return { subscriptionIds: ids };
    });
  }

  async count() {
    const count = await this.subRepo.count();
    return { count };
  }

  async create(dto: CreateSubscriptionDto) {
    await this.validateInboundsConfig(dto.inboundsConfig);
    const trimmedClientId = dto.clientId?.trim() || '';
    const clientAutoCreate = !trimmedClientId && dto.clientAutoCreate === true;
    const clientId = trimmedClientId
      ? trimmedClientId
      : clientAutoCreate
        ? `3dp-${uuidv4()}`
        : undefined;
    const sub = this.subRepo.create({
      id: uuidv4(),
      name: dto.name,
      note: dto.note,
      supportUrl: dto.supportUrl,
      websiteUrl: dto.websiteUrl,
      uuid: uuidv4(),
      ...(clientId ? { clientId, clientAutoCreate } : {}),
      inboundsConfig: this.withConfigIds(dto.inboundsConfig || []),
      isAutoRotationEnabled: dto.isAutoRotationEnabled ?? true,
      node: await this.resolveNode(dto.nodeId),
      relayServer: await this.resolveRelay(dto.relayServerId),
    });

    if (sub.clientId) {
      try {
        await this.syncClientUsage(sub, true);
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error
            ? error.message
            : 'Не удалось подготовить клиента на выбранных нодах. Проверьте ID клиента и доступность 3x-ui.',
        );
      }
    }

    return this.subscriptionLock.run(sub.id, async () => {
      const saved = await this.subRepo.save(sub);
      return this.provisionPersistentInbounds(saved);
    });
  }

  async syncClientUsage(sub: Subscription, creating = false) {
    if (!sub.clientId) return sub.clientUsage ?? null;
    const nonClientTypes = new Set<string>([
      'custom',
      'mtproto-faketls',
      ...ROUTING_INBOUND_TYPES,
      ...PERSISTENT_INBOUND_TYPES,
    ]);
    const configs: Array<{ nodeId?: string }> = (
      sub.inboundsConfig || []
    ).filter((config) => !nonClientTypes.has(config.type || ''));
    if (!configs.length) configs.push({});

    const seen = new Set<string>();
    const usages: Array<NonNullable<Subscription['clientUsage']>> = [];
    for (const config of configs) {
      const nodeId = config.nodeId || sub.nodeId || sub.node?.id;
      const node = nodeId
        ? await this.resolveNode(nodeId)
        : await this.nodeRepo
            .createQueryBuilder('node')
            .addSelect('node.password')
            .addSelect('node.token')
            .where('node.isMain = :isMain AND node.deletedAt IS NULL', {
              isMain: true,
            })
            .getOne();
      const key = node?.id || node?.url || 'default';
      if (seen.has(key)) continue;
      seen.add(key);

      const client = await this.xuiService.prepareSubscriptionClient(
        sub.clientId,
        creating && sub.clientAutoCreate === true,
        node || undefined,
      );
      usages.push(
        await this.xuiService.getSubscriptionUsage(
          client.email || sub.clientId,
          node || undefined,
        ),
      );
    }

    const expires = usages
      .map((usage) => usage.expire)
      .filter((expire) => expire > 0);
    sub.clientUsage = {
      upload: usages.reduce((sum, usage) => sum + usage.upload, 0),
      download: usages.reduce((sum, usage) => sum + usage.download, 0),
      total: usages.some((usage) => usage.total === 0)
        ? 0
        : usages.reduce((sum, usage) => sum + usage.total, 0),
      expire: expires.length ? Math.min(...expires) : 0,
    };
    if (!creating && sub.id) {
      await this.subRepo.update(
        { id: sub.id, clientId: sub.clientId },
        { clientUsage: sub.clientUsage },
      );
    }
    return sub.clientUsage;
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    return this.subscriptionLock.run(id, () => this.updateLocked(id, dto));
  }

  private async updateLocked(id: string, dto: UpdateSubscriptionDto) {
    const sub = await this.subRepo.findOne({
      where: { id },
      relations: ['inbounds', 'node', 'relayServer'],
    });

    if (!sub) {
      return null;
    }

    this.validatePersistentChanges(sub, dto);

    // Пустое имя не обновляется — защита от случайной очистки
    if (dto.name && dto.name.trim().length > 0) {
      sub.name = dto.name;
    }

    if (dto.note !== undefined) sub.note = dto.note;
    if (dto.supportUrl !== undefined) sub.supportUrl = dto.supportUrl;
    if (dto.websiteUrl !== undefined) sub.websiteUrl = dto.websiteUrl;

    let nextConfigs: InboundConfig[] | undefined;
    if (dto.inboundsConfig) {
      await this.validateInboundsConfig(dto.inboundsConfig);
      nextConfigs = this.withConfigIds(
        dto.inboundsConfig,
        sub.inboundsConfig as Array<{ configId?: string; nodeId?: string }>,
      );
      sub.inboundsConfig = nextConfigs;
    }

    if (dto.isAutoRotationEnabled !== undefined) {
      sub.isAutoRotationEnabled = dto.isAutoRotationEnabled;
    }

    if ('nodeId' in dto) {
      sub.node = await this.resolveNode(dto.nodeId);
      sub.nodeId = dto.nodeId;
    }

    if ('relayServerId' in dto) {
      sub.relayServer = await this.resolveRelay(dto.relayServerId);
      sub.relayServerId = dto.relayServerId;
    }

    let clientChanged = false;
    if (dto.clientId !== undefined || dto.clientAutoCreate !== undefined) {
      const trimmed =
        dto.clientId !== undefined ? dto.clientId.trim() : sub.clientId || '';
      if (dto.clientId !== undefined && trimmed !== (sub.clientId || '')) {
        if (trimmed) {
          sub.clientId = trimmed;
          sub.clientAutoCreate = false;
        } else if (dto.clientAutoCreate === true) {
          sub.clientId = `3dp-${uuidv4()}`;
          sub.clientAutoCreate = true;
        } else {
          sub.clientId = null;
          sub.clientAutoCreate = false;
        }
        sub.clientUsage = null;
        clientChanged = true;
      } else if (dto.clientAutoCreate !== undefined) {
        if (dto.clientAutoCreate === true && !sub.clientId) {
          sub.clientId = `3dp-${uuidv4()}`;
          sub.clientAutoCreate = true;
          sub.clientUsage = null;
          clientChanged = true;
        } else if (dto.clientAutoCreate === false && sub.clientAutoCreate) {
          sub.clientId = null;
          sub.clientAutoCreate = false;
          sub.clientUsage = null;
          clientChanged = true;
        }
      }
    }

    if (clientChanged && sub.clientId) {
      try {
        await this.syncClientUsage(sub, true);
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error
            ? error.message
            : 'Не удалось подготовить клиента на выбранных нодах. Проверьте ID клиента и доступность 3x-ui.',
        );
      }
    }

    if (!nextConfigs) return this.subRepo.save(sub);

    const desiredPersistentIds = new Set(
      nextConfigs
        .filter((config) => PERSISTENT_INBOUND_TYPES.has(config.type))
        .map((config) => config.configId),
    );
    const removedPersistent = (sub.inbounds || []).filter(
      (inbound) =>
        PERSISTENT_INBOUND_TYPES.has(inbound.protocol) &&
        inbound.status === InboundStatus.Active &&
        inbound.configId &&
        !desiredPersistentIds.has(inbound.configId),
    );
    const saved = await this.subRepo.manager.transaction(
      async (entityManager) => {
        const savedSubscription = await entityManager.save(Subscription, sub);
        if (removedPersistent.length) {
          await entityManager.update(
            Inbound,
            { id: In(removedPersistent.map((inbound) => inbound.id)) },
            {
              status: InboundStatus.PendingCleanup,
              nextCleanupAt: new Date(),
            },
          );
        }
        await this.syncActivePositions(entityManager, id, nextConfigs);
        return savedSubscription;
      },
    );
    saved.inbounds = (saved.inbounds || []).filter(
      (inbound) =>
        !removedPersistent.some((removed) => removed.id === inbound.id),
    );
    return this.provisionPersistentInbounds(saved);
  }

  async remove(id: string, force = false) {
    return this.subscriptionLock.run(id, () => this.removeLocked(id, force));
  }

  private async removeLocked(id: string, force: boolean) {
    const sub = await this.subRepo.findOne({
      where: { id },
      relations: ['inbounds', 'inbounds.node'],
    });
    if (!sub) return;

    if (sub.inbounds && sub.inbounds.length > 0) {
      for (const inbound of sub.inbounds) {
        if (!inbound.xuiId || inbound.xuiId <= 0) continue;

        let node = inbound.node;
        let isDeleted = false;
        try {
          node = await this.resolveInboundNode(inbound);
          const targetNodeId = inbound.nodeId || inbound.node?.id || node?.id;
          let otherRefs = 0;
          if (
            targetNodeId &&
            typeof this.subRepo.manager?.count === 'function'
          ) {
            otherRefs = await this.subRepo.manager
              .count(Inbound, {
                where: {
                  nodeId: targetNodeId,
                  xuiId: inbound.xuiId,
                  subscriptionId: Not(sub.id),
                  status: In([InboundStatus.Active, InboundStatus.Staged]),
                },
              })
              .catch(() => 0);
          }
          if (otherRefs > 0) {
            const clientId = extractInboundClientId(inbound);
            if (
              clientId &&
              typeof this.xuiService.deleteInboundClient === 'function'
            ) {
              isDeleted = await this.xuiService.deleteInboundClient(
                inbound.xuiId,
                clientId,
                node,
              );
            } else {
              isDeleted = true;
            }
          } else {
            isDeleted = await this.xuiService.deleteInbound(
              inbound.xuiId,
              node,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Ошибка удаления инбаунда ${inbound.xuiId}: ${String(error)}`,
          );
        }
        if (!isDeleted) {
          const message = `Не удалось удалить инбаунд ${inbound.xuiId} (${inbound.protocol || inbound.remark || 'неизвестный тип'}) на ноде «${node?.name || inbound.node?.name || 'основная'}» из 3x-ui. Можно удалить подписку принудительно.`;
          if (!force)
            throw new BadRequestException({
              code: 'INBOUND_DELETE_FAILED',
              message,
            });
          this.logger.warn(message);
        }
      }
    }

    return this.subRepo.remove(sub);
  }

  private async provisionPersistentInbounds(sub: Subscription) {
    if (
      !(sub.inboundsConfig || []).some((config) =>
        PERSISTENT_INBOUND_TYPES.has(config.type),
      )
    )
      return sub;
    try {
      const awgProvisioning =
        await this.rotationService.provisionPersistentInbounds(sub);
      return { ...sub, inboundProvisioning: awgProvisioning, awgProvisioning };
    } catch {
      const failedProvisioning = {
        status: 'failed' as const,
        message:
          'Не удалось завершить создание подключения. Повторите сохранение подписки.',
      };
      return {
        ...sub,
        inboundProvisioning: failedProvisioning,
        awgProvisioning: failedProvisioning,
      };
    }
  }

  private validatePersistentChanges(
    sub: Subscription,
    dto: UpdateSubscriptionDto,
  ) {
    if (!dto.inboundsConfig && !('nodeId' in dto) && !('relayServerId' in dto))
      return;
    const activePersistent = (sub.inbounds || []).filter(
      (inbound) =>
        PERSISTENT_INBOUND_TYPES.has(inbound.protocol) &&
        inbound.status === InboundStatus.Active,
    );
    const oldConfigs = sub.inboundsConfig || [];
    const nextConfigs = dto.inboundsConfig ?? oldConfigs;
    for (const inbound of activePersistent) {
      const matches = oldConfigs.filter(
        (config) =>
          config.configId === inbound.configId &&
          panelInboundProtocol(config.type) === inbound.protocol,
      );
      if (
        !inbound.configId ||
        matches.length !== 1 ||
        activePersistent.filter((item) => item.configId === inbound.configId)
          .length !== 1
      ) {
        throw new BadRequestException(
          'Инбаунд не связан однозначно с конфигурацией. Существующее подключение сохранено; исправьте связь configId.',
        );
      }
      const previous = matches[0];
      const next = nextConfigs.find(
        (config) => config.configId === inbound.configId,
      );
      if (!next) continue;
      const previousNode = previous.nodeId || sub.nodeId || inbound.nodeId;
      const nextNode =
        next.nodeId ||
        ('nodeId' in dto ? dto.nodeId : sub.nodeId) ||
        inbound.nodeId;
      const previousRelay =
        previous.relayServerId || sub.relayServerId || undefined;
      const nextRelay =
        next.relayServerId ||
        ('relayServerId' in dto ? dto.relayServerId : sub.relayServerId) ||
        undefined;
      if (
        next.type !== previous.type ||
        String(next.port || 'random') !== String(previous.port || 'random') ||
        nextNode !== previousNode ||
        nextRelay !== previousRelay
      ) {
        throw new BadRequestException(
          `Чтобы изменить ${inbound.protocol === 'amneziawg' ? 'AWG' : inbound.protocol}, удалите инбаунд, сохраните подписку, затем добавьте его заново и сохраните.`,
        );
      }
    }
    // Replacing a persistent connection requires saving its removal first.
    const removed = activePersistent.some(
      (inbound) =>
        !nextConfigs.some((config) => config.configId === inbound.configId),
    );
    const added = nextConfigs.some(
      (config) =>
        PERSISTENT_INBOUND_TYPES.has(config.type) &&
        !oldConfigs.some(
          (previous) =>
            PERSISTENT_INBOUND_TYPES.has(previous.type) &&
            previous.configId === config.configId,
        ),
    );
    if (removed && added) {
      throw new BadRequestException(
        'Сначала сохраните удаление постоянного подключения, затем откройте подписку и добавьте новое.',
      );
    }
  }

  private async resolveNode(nodeId?: string | null) {
    if (!nodeId) return null;
    const node = await this.nodeRepo
      .createQueryBuilder('node')
      .addSelect('node.password')
      .addSelect('node.token')
      .where('node.id = :nodeId', { nodeId })
      .getOne();

    if (!node) {
      throw new BadRequestException('Node not found');
    }

    return node;
  }

  private async resolveInboundNode(inbound: Inbound) {
    if (!inbound.nodeId) return undefined;

    return (
      (await this.nodeRepo
        .createQueryBuilder('node')
        .addSelect('node.password')
        .addSelect('node.token')
        .where('node.id = :nodeId', { nodeId: inbound.nodeId })
        .getOne()) ?? inbound.node
    );
  }

  private async resolveRelay(relayServerId?: number | null) {
    if (!relayServerId) return null;
    const relay = await this.tunnelRepo.findOne({
      where: { id: relayServerId },
    });

    if (!relay) {
      throw new BadRequestException('Relay server not found');
    }

    return relay;
  }

  private async validateInboundsConfig(
    inboundsConfig?: CreateSubscriptionDto['inboundsConfig'],
  ) {
    const configIds = new Set<string>();
    for (const config of inboundsConfig || []) {
      this.validateConfigIdentity(config, configIds);
      if (ROUTING_INBOUND_TYPES.has(config.type)) {
        if (config.type === 'happ-routing')
          buildHappRoutingLink(config.routingProfile);
        else buildIncyRoutingLink(config.routingProfile);
        continue;
      }
      this.validateTlsConfig(config);
      this.validateManagedProfileConfig(config);
      await this.validateMtprotoConfig(config);
      if (config.type === 'custom') continue;

      await this.validateConfigRelations(config);
      this.validateConfigPort(config.port);
    }
    this.validateNodePortCollisions(inboundsConfig || []);
  }

  private validateNodePortCollisions(configs: InboundConfig[]) {
    const byNode = new Map<string, InboundConfig[]>();
    for (const config of configs) {
      if (config.type === 'custom' || ROUTING_INBOUND_TYPES.has(config.type)) {
        continue;
      }
      const key = config.nodeId || '__default';
      const list = byNode.get(key) || [];
      list.push(config);
      byNode.set(key, list);
    }

    for (const nodeConfigs of byNode.values()) {
      const fixedPorts = new Map<number, string>();
      const reservedLocalPorts = new Map<number, string>();

      for (const config of nodeConfigs) {
        const label = config.name?.trim() || config.type;
        if (
          config.type === 'self-sni' &&
          (config.profileSettings?.webServer ?? 'nginx') !== 'none'
        ) {
          const localPort = config.profileSettings?.localHttpsPort ?? 8443;
          reservedLocalPorts.set(
            localPort,
            `локальным HTTPS-портом веб-сервера Self-SNI «${label}»`,
          );
        }
        if (
          config.type === 'https-fallback' &&
          (config.profileSettings?.reverseProxy === 'nginx' ||
            config.profileSettings?.reverseProxy === 'caddy')
        ) {
          const publicPort = config.profileSettings?.publicPort ?? 443;
          reservedLocalPorts.set(
            publicPort,
            `публичным портом reverse proxy HTTPS Fallback «${label}»`,
          );
        }
      }

      for (const config of nodeConfigs) {
        if (
          config.port === undefined ||
          config.port === null ||
          config.port === '' ||
          config.port === 'random'
        ) {
          continue;
        }
        const port = Number(config.port);
        if (!Number.isInteger(port)) continue;
        const label = config.name?.trim() || config.type;
        const existingOwner = fixedPorts.get(port);
        if (existingOwner) {
          throw new BadRequestException(
            `Конфликт порта ${port} на одной ноде: порт уже назначен для «${existingOwner}» и не может использоваться в «${label}»`,
          );
        }
        fixedPorts.set(port, label);

        const reservedReason = reservedLocalPorts.get(port);
        if (reservedReason) {
          throw new BadRequestException(
            `Конфликт порта ${port} для «${label}»: порт пересекается с ${reservedReason}`,
          );
        }
      }
    }
  }

  private withConfigIds(
    configs: InboundConfig[],
    existingConfigs?: Array<{ configId?: string; nodeId?: string }>,
  ): InboundConfig[] {
    const existingMap = new Map(
      (existingConfigs || [])
        .filter((c): c is { configId: string; nodeId?: string } =>
          Boolean(c.configId),
        )
        .map((c) => [c.configId, c]),
    );
    return configs.map((config) =>
      this.normalizeConfig(
        config,
        config.configId ? existingMap.get(config.configId) : undefined,
      ),
    );
  }

  private normalizeConfig(
    config: InboundConfig,
    existingConfig?: { configId?: string; nodeId?: string },
  ): InboundConfig {
    const isCertificateInbound = requiresPanelTlsCertificate(config);
    // When changing node in an already created inbound, reset certificate to the target node
    const nodeChanged = Boolean(
      existingConfig &&
      (existingConfig.nodeId || undefined) !== (config.nodeId || undefined),
    );
    const certificateMode = isCertificateInbound
      ? nodeChanged
        ? 'node'
        : this.resolveCertificateMode(config)
      : undefined;
    return {
      ...config,
      configId: config.configId || uuidv4(),
      sni:
        CERTIFICATE_INBOUND_TYPES.has(config.type as InboundType) ||
        PERSISTENT_INBOUND_TYPES.has(config.type)
          ? undefined
          : config.sni?.trim() || undefined,
      certificateMode,
      tlsServerName:
        certificateMode === 'custom'
          ? nodeChanged
            ? undefined
            : config.tlsServerName?.trim() || this.legacyTlsServerName(config)
          : undefined,
      certificateFile:
        certificateMode === 'custom'
          ? config.certificateFile?.trim() || undefined
          : undefined,
      keyFile:
        certificateMode === 'custom'
          ? config.keyFile?.trim() || undefined
          : undefined,
      profileId: isManagedProfileKind(config.type)
        ? config.profileId || undefined
        : undefined,
      profileSettings: isManagedProfileKind(config.type)
        ? normalizeManagedProfileSettings(config.type, config.profileSettings)
        : undefined,
      enabled: config.enabled !== false,
      disabledReason:
        config.enabled === false ? config.disabledReason : undefined,
    };
  }

  private resolveCertificateMode(config: InboundConfig): CertificateMode {
    if (config.certificateMode === 'custom') return 'custom';
    return 'node';
  }

  private legacyTlsServerName(config: InboundConfig) {
    const legacySni = config.sni?.trim();
    return legacySni && legacySni !== 'random' ? legacySni : undefined;
  }

  private validateConfigIdentity(
    config: InboundConfig,
    configIds: Set<string>,
  ) {
    if (
      !INBOUND_TYPES.includes(config.type as (typeof INBOUND_TYPES)[number])
    ) {
      throw new BadRequestException('Unsupported inbound type');
    }
    if (!config.configId) return;
    if (configIds.has(config.configId)) {
      throw new BadRequestException('Duplicate inbound config ID');
    }
    configIds.add(config.configId);
  }

  private validateTlsConfig(config: InboundConfig) {
    if (!requiresPanelTlsCertificate(config)) return;
    const certificateMode = this.resolveCertificateMode(config);
    if (certificateMode === 'node') return;

    const hasCertificate = Boolean(
      config.certificateFile?.trim() ||
      config.profileSettings?.certificateFile?.trim(),
    );
    const hasPrivateKey = Boolean(
      config.keyFile?.trim() || config.profileSettings?.keyFile?.trim(),
    );
    if (!hasCertificate || !hasPrivateKey) {
      throw new BadRequestException(
        'Custom TLS mode requires certificate and private key paths',
      );
    }
    this.validateRemotePath(
      config.certificateFile || config.profileSettings?.certificateFile || '',
      'Certificate',
    );
    this.validateRemotePath(
      config.keyFile || config.profileSettings?.keyFile || '',
      'Private key',
    );
    const serverName =
      config.tlsServerName?.trim() ||
      config.profileSettings?.domain?.trim() ||
      this.legacyTlsServerName(config);
    if (!serverName || !TLS_SERVER_NAME_PATTERN.test(serverName)) {
      throw new BadRequestException(
        'Custom TLS mode requires a valid TLS server name',
      );
    }
  }

  private validateManagedProfileConfig(config: InboundConfig) {
    if (!isManagedProfileKind(config.type)) return;
    if (!ACTIVE_MANAGED_PROFILE_TYPES.has(config.type)) {
      throw new BadRequestException(
        `Профиль ${config.type} запланирован на следующий этап внедрения; сейчас доступны: ${[...ACTIVE_MANAGED_PROFILE_TYPES].join(', ')}`,
      );
    }
    const errors = validateManagedProfileSettings(
      config.type,
      config.profileSettings,
      { sni: config.tlsServerName || config.sni, port: config.port },
    );
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '));
    }
  }

  private validateRemotePath(remotePath: string, label: string) {
    if (!isSafeAbsoluteRemotePath(remotePath)) {
      throw new BadRequestException(`${label} path must be an absolute path`);
    }
  }

  private async validateMtprotoConfig(config: InboundConfig) {
    if (config.type !== 'mtproto-faketls') return;

    const fakeTlsDomain = config.sni?.trim();
    if (!fakeTlsDomain) {
      throw new BadRequestException(
        'MTProto FakeTLS domain must be selected from SNI domains',
      );
    }
    const normalizedDomain = normalizeFakeTlsDomain(fakeTlsDomain);
    if (
      normalizedDomain !== 'random' &&
      !isValidFakeTlsDomain(normalizedDomain)
    ) {
      throw new BadRequestException(
        'MTProto FakeTLS domain must be a valid hostname',
      );
    }
    const listedDomain = await this.domainRepo.findOne({
      where:
        normalizedDomain === 'random'
          ? { isEnabled: true }
          : { name: normalizedDomain, isEnabled: true },
    });
    if (!listedDomain) {
      throw new BadRequestException(
        'MTProto FakeTLS domain must be selected from enabled SNI domains',
      );
    }
  }

  private async validateConfigRelations(config: InboundConfig) {
    if (config.nodeId) {
      const node = await this.nodeRepo.findOne({
        where: { id: config.nodeId },
      });
      if (!node) throw new BadRequestException('Node not found');
      if (
        !supportsInboundType(config.type as InboundType, {
          panelVersion: node.version,
          xrayVersion: node.xrayVersion,
          autoTlsCertificate: Boolean(
            node.webCertificateFile && node.webKeyFile,
          ),
        })
      ) {
        throw new BadRequestException(
          `Inbound ${config.type} is not supported by node ${node.name}`,
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
          const errorMessages = compat.checks
            .filter((item) => item.severity === 'error')
            .map((item) => item.message);
          throw new BadRequestException(
            errorMessages.join('; ') ||
              `Профиль ${config.type} несовместим с нодой ${node.name}`,
          );
        }
      }
    }
    if (!config.relayServerId) return;

    const relay = await this.tunnelRepo.findOne({
      where: { id: config.relayServerId },
    });
    if (!relay) throw new BadRequestException('Relay server not found');
    if (config.nodeId && relay.nodeId && relay.nodeId !== config.nodeId) {
      throw new BadRequestException('Relay server belongs to another node');
    }
  }

  private validateConfigPort(port?: number | string) {
    if (
      port === undefined ||
      port === null ||
      port === '' ||
      port === 'random'
    ) {
      return;
    }
    const parsedPort =
      typeof port === 'number' ? port : /^\d+$/.test(port) ? Number(port) : NaN;
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new BadRequestException(
        'Port must be "random" or an integer from 1 to 65535',
      );
    }
  }

  private async syncActivePositions(
    entityManager: EntityManager,
    subscriptionId: string,
    configs: InboundConfig[],
  ) {
    await entityManager.update(
      Inbound,
      { subscriptionId, status: InboundStatus.Active },
      { position: configs.length },
    );
    for (const [position, config] of configs.entries()) {
      await entityManager.update(
        Inbound,
        {
          subscriptionId,
          configId: config.configId,
          status: InboundStatus.Active,
        },
        { position },
      );
    }
  }
}
