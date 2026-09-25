import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { XuiService } from '../xui/xui.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { v4 as uuidv4 } from 'uuid';
import { Node } from '../nodes/entities/node.entity';
import { Tunnel } from '../tunnels/entities/tunnel.entity';
import { Inbound, InboundStatus } from '../inbounds/entities/inbound.entity';
import { sortInboundsByPosition } from '../inbounds/inbound-order';
import {
  CERTIFICATE_INBOUND_TYPES,
  CertificateMode,
  INBOUND_TYPES,
  InboundType,
} from './inbound-config.constants';
import { supportsInboundType } from '../nodes/node-capabilities';
import {
  isValidFakeTlsDomain,
  normalizeFakeTlsDomain,
} from '../inbounds/mtproto-faketls';
import { isSafeAbsoluteRemotePath } from '../inbounds/tls-config';
import { Domain } from '../domains/entities/domain.entity';
import { RotationService } from '../rotation/rotation.service';
import { SubscriptionLockService } from './subscription-lock.service';

type InboundConfig = NonNullable<
  CreateSubscriptionDto['inboundsConfig']
>[number];

const TLS_SERVER_NAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

@Injectable()
export class SubscriptionsService {
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
      order: { createdAt: 'DESC' },
    });
    for (const subscription of subscriptions) {
      subscription.inbounds = sortInboundsByPosition(
        (subscription.inbounds || []).filter(
          (inbound) => inbound.status === InboundStatus.Active,
        ),
      );
    }
    return subscriptions;
  }

  async count() {
    const count = await this.subRepo.count();
    return { count };
  }

  async create(dto: CreateSubscriptionDto) {
    await this.validateInboundsConfig(dto.inboundsConfig);
    const sub = this.subRepo.create({
      id: uuidv4(),
      name: dto.name,
      uuid: uuidv4(),
      inboundsConfig: this.withConfigIds(dto.inboundsConfig || []),
      isAutoRotationEnabled: dto.isAutoRotationEnabled ?? true,
      node: await this.resolveNode(dto.nodeId),
      relayServer: await this.resolveRelay(dto.relayServerId),
    });

    return this.subscriptionLock.run(sub.id, async () => {
      const saved = await this.subRepo.save(sub);
      return this.provisionAmnezia(saved);
    });
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

    this.validateAmneziaChanges(sub, dto);

    // Пустое имя не обновляется — защита от случайной очистки
    if (dto.name && dto.name.trim().length > 0) {
      sub.name = dto.name;
    }

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

    if (!nextConfigs) return this.subRepo.save(sub);

    const desiredAwgIds = new Set(
      nextConfigs
        .filter((config) => config.type === 'amneziawg')
        .map((config) => config.configId),
    );
    const removedAwg = (sub.inbounds || []).filter(
      (inbound) =>
        inbound.protocol === 'amneziawg' &&
        inbound.status === InboundStatus.Active &&
        inbound.configId &&
        !desiredAwgIds.has(inbound.configId),
    );
    const saved = await this.subRepo.manager.transaction(
      async (entityManager) => {
        const savedSubscription = await entityManager.save(Subscription, sub);
        if (removedAwg.length) {
          await entityManager.update(
            Inbound,
            { id: In(removedAwg.map((inbound) => inbound.id)) },
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
      (inbound) => !removedAwg.some((removed) => removed.id === inbound.id),
    );
    return this.provisionAmnezia(saved);
  }

  async remove(id: string) {
    return this.subscriptionLock.run(id, () => this.removeLocked(id));
  }

  private async removeLocked(id: string) {
    const sub = await this.subRepo.findOne({
      where: { id },
      relations: ['inbounds', 'inbounds.node'],
    });
    if (!sub) return;

    if (sub.inbounds && sub.inbounds.length > 0) {
      for (const inbound of sub.inbounds) {
        if (!inbound.xuiId || inbound.xuiId <= 0) continue;

        const isDeleted = await this.xuiService.deleteInbound(
          inbound.xuiId,
          await this.resolveInboundNode(inbound),
        );

        if (!isDeleted) {
          throw new BadRequestException(
            `Failed to delete inbound ${inbound.xuiId} from 3x-ui`,
          );
        }
      }
    }

    return this.subRepo.remove(sub);
  }

  private async provisionAmnezia(sub: Subscription) {
    if (
      !(sub.inboundsConfig || []).some((config) => config.type === 'amneziawg')
    )
      return sub;
    try {
      const awgProvisioning = await this.rotationService.provisionAmnezia(sub);
      return { ...sub, awgProvisioning };
    } catch {
      return {
        ...sub,
        awgProvisioning: {
          status: 'failed' as const,
          message:
            'Не удалось завершить создание AWG. Повторите сохранение подписки.',
        },
      };
    }
  }

  private validateAmneziaChanges(
    sub: Subscription,
    dto: UpdateSubscriptionDto,
  ) {
    if (!dto.inboundsConfig && !('nodeId' in dto) && !('relayServerId' in dto))
      return;
    const activeAwg = (sub.inbounds || []).filter(
      (inbound) =>
        inbound.protocol === 'amneziawg' &&
        inbound.status === InboundStatus.Active,
    );
    const oldConfigs = sub.inboundsConfig || [];
    const nextConfigs = dto.inboundsConfig ?? oldConfigs;
    for (const inbound of activeAwg) {
      const matches = oldConfigs.filter(
        (config) =>
          config.configId === inbound.configId && config.type === 'amneziawg',
      );
      if (
        !inbound.configId ||
        matches.length !== 1 ||
        activeAwg.filter((item) => item.configId === inbound.configId)
          .length !== 1
      ) {
        throw new BadRequestException(
          'AWG не связан однозначно с конфигурацией. Существующее подключение сохранено; исправьте связь configId.',
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
        next.type !== 'amneziawg' ||
        String(next.port || 'random') !== String(previous.port || 'random') ||
        nextNode !== previousNode ||
        nextRelay !== previousRelay
      ) {
        throw new BadRequestException(
          'Чтобы изменить AWG, удалите инбаунд, сохраните подписку, затем добавьте AWG заново и сохраните.',
        );
      }
    }
    // A new row cannot replace an active AWG in the same save operation.
    const removed = activeAwg.some(
      (inbound) =>
        !nextConfigs.some((config) => config.configId === inbound.configId),
    );
    const added = nextConfigs.some(
      (config) =>
        config.type === 'amneziawg' &&
        !oldConfigs.some(
          (previous) =>
            previous.type === 'amneziawg' &&
            previous.configId === config.configId,
        ),
    );
    if (removed && added) {
      throw new BadRequestException(
        'Сначала сохраните удаление AWG, затем откройте подписку и добавьте новый AWG.',
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
      this.validateTlsConfig(config);
      await this.validateMtprotoConfig(config);
      if (config.type === 'custom') continue;

      await this.validateConfigRelations(config);
      this.validateConfigPort(config.port);
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
    const isCertificateInbound = CERTIFICATE_INBOUND_TYPES.has(
      config.type as InboundType,
    );
    // When changing node in an already created inbound, reset certificate to the target node
    const nodeChanged = Boolean(
      existingConfig &&
      existingConfig.nodeId &&
      config.nodeId &&
      existingConfig.nodeId !== config.nodeId,
    );
    const certificateMode = isCertificateInbound
      ? nodeChanged
        ? 'node'
        : this.resolveCertificateMode(config)
      : undefined;
    return {
      ...config,
      configId: config.configId || uuidv4(),
      sni: config.sni?.trim() || undefined,
      certificateMode,
      tlsServerName: isCertificateInbound
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
    if (!CERTIFICATE_INBOUND_TYPES.has(config.type as InboundType)) return;
    const certificateMode = this.resolveCertificateMode(config);
    if (certificateMode === 'node') return;

    const hasCertificate = Boolean(config.certificateFile?.trim());
    const hasPrivateKey = Boolean(config.keyFile?.trim());
    if (!hasCertificate || !hasPrivateKey) {
      throw new BadRequestException(
        'Custom TLS mode requires certificate and private key paths',
      );
    }
    this.validateRemotePath(config.certificateFile || '', 'Certificate');
    this.validateRemotePath(config.keyFile || '', 'Private key');
    const serverName =
      config.tlsServerName?.trim() || this.legacyTlsServerName(config);
    if (!serverName || !TLS_SERVER_NAME_PATTERN.test(serverName)) {
      throw new BadRequestException(
        'Custom TLS mode requires a valid TLS server name',
      );
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
