import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
import { isValidFakeTlsDomain } from '../inbounds/mtproto-faketls';
import { isSafeAbsoluteRemotePath } from '../inbounds/tls-config';

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
    private xuiService: XuiService,
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
      name: dto.name,
      uuid: uuidv4(),
      inboundsConfig: this.withConfigIds(dto.inboundsConfig || []),
      isAutoRotationEnabled: dto.isAutoRotationEnabled ?? true,
      node: await this.resolveNode(dto.nodeId),
      relayServer: await this.resolveRelay(dto.relayServerId),
    });

    return this.subRepo.save(sub);
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    const sub = await this.subRepo.findOne({
      where: { id },
      relations: ['inbounds', 'node', 'relayServer'],
    });

    if (!sub) {
      return null;
    }

    // Пустое имя не обновляется — защита от случайной очистки
    if (dto.name && dto.name.trim().length > 0) {
      sub.name = dto.name;
    }

    let nextConfigs: InboundConfig[] | undefined;
    if (dto.inboundsConfig) {
      await this.validateInboundsConfig(dto.inboundsConfig);
      nextConfigs = this.withConfigIds(dto.inboundsConfig);
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

    return this.subRepo.manager.transaction(async (entityManager) => {
      const savedSubscription = await entityManager.save(Subscription, sub);
      await this.syncActivePositions(entityManager, id, nextConfigs);
      return savedSubscription;
    });
  }

  async remove(id: string) {
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
      this.validateMtprotoConfig(config);
      if (config.type === 'custom') continue;

      await this.validateConfigRelations(config);
      this.validateConfigPort(config.port);
    }
  }

  private withConfigIds(configs: InboundConfig[]): InboundConfig[] {
    return configs.map((config) => this.normalizeConfig(config));
  }

  private normalizeConfig(config: InboundConfig): InboundConfig {
    const isCertificateInbound = CERTIFICATE_INBOUND_TYPES.has(
      config.type as InboundType,
    );
    const certificateMode = isCertificateInbound
      ? this.resolveCertificateMode(config)
      : undefined;
    return {
      ...config,
      configId: config.configId || uuidv4(),
      sni: config.sni?.trim() || undefined,
      certificateMode,
      tlsServerName: isCertificateInbound
        ? config.tlsServerName?.trim() || this.legacyTlsServerName(config)
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
    if (config.certificateMode === 'node') return 'node';
    return config.certificateFile?.trim() && config.keyFile?.trim()
      ? 'custom'
      : 'node';
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

  private validateMtprotoConfig(config: InboundConfig) {
    if (config.type !== 'mtproto-faketls') return;

    const fakeTlsDomain = config.sni?.trim();
    if (
      !fakeTlsDomain ||
      fakeTlsDomain === 'random' ||
      !isValidFakeTlsDomain(fakeTlsDomain)
    ) {
      throw new BadRequestException(
        'MTProto FakeTLS domain must be a valid hostname',
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
