import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  CheckNodeDto,
  CreateNodeDto,
  MigrateNodeAddressDto,
  UpdateNodeDto,
} from './dto/node.dto';
import {
  patchClientProfileJsonAddress,
  patchInboundLinkHost,
} from '../inbounds/inbound-endpoint.util';
import {
  Node,
  NodeAuthType,
  NodeHealthStatus,
  NodeProtocol,
} from './entities/node.entity';
import { XuiService } from '../xui/xui.service';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Tunnel } from '../tunnels/entities/tunnel.entity';
import { Inbound } from '../inbounds/entities/inbound.entity';
import * as dns from 'dns/promises';
import * as net from 'net';
import { COUNTRIES } from '../settings/countries';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InboundStatus } from '../inbounds/entities/inbound.entity';
import { buildNodeCapabilities } from './node-capabilities';
import { Setting } from '../settings/entities/setting.entity';
import { SubscriptionLockService } from '../subscriptions/subscription-lock.service';
import { NodeDeletionService } from './node-deletion.service';
import { ROUTING_INBOUND_TYPES } from '../subscriptions/inbound-config.constants';
import { databaseAvailability } from '../database/database-availability';
import { DomainsService } from '../domains/domains.service';

type GeoResult = {
  ip: string;
  country?: string;
  countryCode?: string;
  flag?: string;
};

const getDomainFromHost = (host?: string) =>
  host && net.isIP(host) === 0 ? host : undefined;

@Injectable()
export class NodesService {
  private readonly logger = new Logger(NodesService.name);
  private readonly dbAvailability = databaseAvailability;
  private refreshingHealth = false;
  constructor(
    @InjectRepository(Node)
    private readonly nodesRepo: Repository<Node>,
    @InjectRepository(Subscription)
    private readonly subscriptionsRepo: Repository<Subscription>,
    @InjectRepository(Tunnel)
    private readonly tunnelsRepo: Repository<Tunnel>,
    @InjectRepository(Inbound)
    private readonly inboundsRepo: Repository<Inbound>,
    private readonly xuiService: XuiService,
    @InjectRepository(Setting)
    private readonly settingsRepo: Repository<Setting>,
    private readonly subscriptionLock: SubscriptionLockService,
    private readonly nodeDeletion: NodeDeletionService,
    @Optional() private readonly domainsService?: DomainsService,
  ) {}

  private sanitizeNode(node: Node) {
    const hasPassword = Boolean(node.password);
    const hasToken = Boolean(node.token);
    const copy = { ...node } as Node & {
      hasPassword?: boolean;
      hasToken?: boolean;
    };
    delete copy.password;
    delete copy.token;
    copy.hasPassword = hasPassword;
    copy.hasToken = hasToken;
    return copy;
  }

  async findAll() {
    const nodes = await this.nodesRepo
      .createQueryBuilder('node')
      .addSelect('node.password')
      .addSelect('node.token')
      .where('node.deletedAt IS NULL')
      .orderBy('node.isMain', 'DESC')
      .addOrderBy('node.createdAt', 'DESC')
      .getMany();
    return nodes.map((node) => this.sanitizeNode(node));
  }

  async findOneWithSecrets(id: string, includeDeleted = false) {
    const qb = this.nodesRepo
      .createQueryBuilder('node')
      .addSelect('node.password')
      .addSelect('node.token')
      .where('node.id = :id', { id });

    if (!includeDeleted) {
      qb.andWhere('node.deletedAt IS NULL');
    }

    const node = await qb.getOne();

    if (!node) {
      throw new NotFoundException('Node not found');
    }

    return node;
  }

  async getDefaultNode() {
    return this.nodesRepo
      .createQueryBuilder('node')
      .addSelect('node.password')
      .addSelect('node.token')
      .where('node.isMain = :isMain', { isMain: true })
      .andWhere('node.deletedAt IS NULL')
      .getOne();
  }

  private getNodePublicAddress(
    node?: Pick<Node, 'domain' | 'ip' | 'host' | 'url'>,
  ): string | undefined {
    if (!node) return undefined;
    if (node.domain?.trim()) return node.domain.trim();
    if (node.ip?.trim()) return node.ip.trim();
    if (node.host?.trim()) return node.host.trim();
    try {
      return node.url ? new URL(node.url).hostname : undefined;
    } catch {
      return node.url;
    }
  }

  private async rewriteNodeInboundEndpoints(
    nodeId: string,
    newAddress: string,
  ): Promise<number> {
    const inbounds = await this.inboundsRepo.find({ where: { nodeId } });
    const changed: Inbound[] = [];

    for (const inbound of inbounds) {
      if (
        inbound.status !== InboundStatus.Active ||
        inbound.protocol === 'custom' ||
        ROUTING_INBOUND_TYPES.has(inbound.protocol) ||
        inbound.relayServerId ||
        !inbound.link
      ) {
        continue;
      }

      const nextLink = patchInboundLinkHost(inbound.link, newAddress);
      const nextProfileJson = patchClientProfileJsonAddress(
        inbound.clientProfileJson,
        newAddress,
      );
      if (
        nextLink !== inbound.link ||
        nextProfileJson !== inbound.clientProfileJson
      ) {
        inbound.link = nextLink;
        inbound.clientProfileJson = nextProfileJson;
        changed.push(inbound);
      }
    }

    if (changed.length > 0) {
      await this.inboundsRepo.save(changed);
    }

    return changed.length;
  }

  private async saveNodeWithDomain(
    node: Node,
    options?: {
      clearMainExceptId?: string;
      autoMainWhenEmpty?: boolean;
    },
  ): Promise<Node> {
    if (typeof this.nodesRepo.manager?.transaction === 'function') {
      return this.nodesRepo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(Node);
        if (
          options?.autoMainWhenEmpty &&
          (await repo.count({ where: { deletedAt: IsNull() } })) === 0
        ) {
          node.isMain = true;
        }
        if (node.isMain && options?.clearMainExceptId !== undefined) {
          await this.clearMainNode(
            options.clearMainExceptId || undefined,
            repo,
          );
        } else if (options?.autoMainWhenEmpty && node.isMain) {
          await this.clearMainNode(undefined, repo);
        }
        const saved = await repo.save(node);
        await this.domainsService?.addHostDomain(
          saved.domain ?? node.domain,
          manager,
        );
        return saved;
      });
    }

    if (
      options?.autoMainWhenEmpty &&
      (await this.nodesRepo.count({ where: { deletedAt: IsNull() } })) === 0
    ) {
      node.isMain = true;
    }

    if (options?.clearMainExceptId !== undefined) {
      await this.clearMainNode(options.clearMainExceptId || undefined);
      node.isMain = true;
    } else if (options?.autoMainWhenEmpty && node.isMain) {
      await this.clearMainNode();
    }

    const saved = await this.nodesRepo.save(node);
    await this.domainsService?.addHostDomain(saved.domain ?? node.domain);
    return saved;
  }

  async create(dto: CreateNodeDto) {
    this.assertCredentials(dto);
    const resolved = await this.resolveNodeLocation(dto.url, dto.flag, dto.ip);

    const node = this.nodesRepo.create({
      ...dto,
      url: this.normalizeUrl(dto.url),
      host: resolved.host,
      domain: dto.domain?.trim() || resolved.domain,
      port: resolved.port,
      protocol: resolved.protocol,
      ip: resolved.ip,
      flag: resolved.flag,
      isMain: dto.isMain ?? false,
    });

    const savedNode = await this.saveNodeWithDomain(node, {
      autoMainWhenEmpty: true,
    });
    const refreshed = await this.refreshNodeProfile(savedNode);
    return this.sanitizeNode(refreshed);
  }

  async update(id: string, dto: UpdateNodeDto) {
    const node = await this.findOneWithSecrets(id);
    const previousUrl = node.url;
    const previousHost = node.host;
    const previousIp = node.ip;
    const previousAddress = this.getNodePublicAddress(node);
    const nextAuthType = dto.authType ?? node.authType;

    const cleanPassword = dto.password?.trim();
    const cleanToken = dto.token?.trim();

    if (nextAuthType === NodeAuthType.Password) {
      const login = dto.login ?? node.login;
      const password = cleanPassword || node.password;
      if (!login || !password) {
        throw new BadRequestException('Login and password are required');
      }
    }

    if (nextAuthType === NodeAuthType.Token) {
      const token = cleanToken || node.token;
      if (!token) {
        throw new BadRequestException('Token is required');
      }
    }

    const syncSubscriptionLinks = dto.syncSubscriptionLinks !== false;
    const patch: Partial<Node> = { ...dto };
    delete (patch as UpdateNodeDto).syncSubscriptionLinks;
    if (!cleanPassword) {
      delete patch.password;
    } else {
      patch.password = cleanPassword;
    }
    if (!cleanToken) {
      delete patch.token;
    } else {
      patch.token = cleanToken;
    }

    Object.assign(node, patch);
    if (dto.url) {
      node.url = this.normalizeUrl(dto.url);
      const nextParsed = this.parseUrl(node.url);
      const preferredIp =
        dto.ip && (nextParsed.host === previousHost || dto.ip !== previousIp)
          ? dto.ip
          : undefined;
      const resolved = await this.resolveNodeLocation(
        dto.url,
        dto.flag ?? node.flag,
        preferredIp,
      );
      node.host = resolved.host;
      node.domain =
        dto.domain !== undefined
          ? dto.domain.trim() || undefined
          : resolved.domain;
      node.port = resolved.port;
      node.protocol = resolved.protocol;
      node.ip = resolved.ip ?? dto.ip ?? previousIp;
      node.flag = resolved.flag;
    } else {
      if (dto.domain !== undefined) {
        node.domain = dto.domain.trim() || undefined;
      }
      if (dto.ip) node.ip = dto.ip;
      if (dto.flag) node.flag = dto.flag;
    }

    const savedNode = await this.saveNodeWithDomain(node, {
      clearMainExceptId: dto.isMain ? id : undefined,
    });
    if (dto.isMain) {
      node.isMain = true;
    }

    this.xuiService.invalidatePanelAgent?.(previousUrl);
    this.xuiService.invalidatePanelAgent?.(savedNode.url);

    const nextAddress = this.getNodePublicAddress(savedNode);
    if (
      syncSubscriptionLinks &&
      nextAddress &&
      previousAddress &&
      nextAddress !== previousAddress
    ) {
      await this.rewriteNodeInboundEndpoints(savedNode.id, nextAddress);
    }

    const refreshed = await this.refreshNodeProfile(savedNode);
    return this.sanitizeNode(refreshed);
  }

  async migrateAddress(id: string, dto: MigrateNodeAddressDto) {
    const node = await this.findOneWithSecrets(id);
    const previousUrl = node.url;
    const previousHost = node.host;
    const previousIp = node.ip;
    const previousAddress = this.getNodePublicAddress(node);

    node.url = this.normalizeUrl(dto.url);
    const nextParsed = this.parseUrl(node.url);
    const preferredIp =
      dto.ip && (nextParsed.host === previousHost || dto.ip !== previousIp)
        ? dto.ip
        : undefined;
    const resolved = await this.resolveNodeLocation(
      dto.url,
      dto.flag || node.flag,
      preferredIp,
    );

    node.host = resolved.host;
    node.port = resolved.port;
    node.protocol = resolved.protocol;
    node.ip = resolved.ip ?? dto.ip ?? previousIp;
    node.flag = dto.flag || resolved.flag || node.flag;
    node.domain =
      dto.domain !== undefined
        ? dto.domain.trim() || undefined
        : resolved.domain;
    if (dto.allowInvalidTls !== undefined) {
      node.allowInvalidTls = dto.allowInvalidTls;
    }

    const savedNode = await this.saveNodeWithDomain(node);
    this.xuiService.invalidatePanelAgent?.(previousUrl);
    this.xuiService.invalidatePanelAgent?.(savedNode.url);

    const nextAddress = this.getNodePublicAddress(savedNode);
    const updatedInbounds =
      dto.syncSubscriptionLinks !== false && nextAddress
        ? await this.rewriteNodeInboundEndpoints(savedNode.id, nextAddress)
        : 0;
    const tunnels = await this.tunnelsRepo.find({
      where: { nodeId: savedNode.id },
    });
    const affectedTunnels = tunnels.length;

    const status = await this.xuiService.checkNodeConnection(savedNode, {
      freshConnection: true,
      preferDirectIp: dto.preferDirectIp,
    });
    await this.applyHealthResult(savedNode, status);

    return {
      node: this.sanitizeNode(savedNode),
      connection: this.connectionSummary(status),
      updatedInbounds,
      affectedTunnels,
      previousAddress,
      nextAddress,
    };
  }

  async remove(id: string, mode: 'safe' | 'deferred' | 'force' = 'safe') {
    const node = await this.findOneWithSecrets(id, mode === 'force');
    this.nodeDeletion.begin(id);
    let removed = false;
    try {
      if (mode === 'force') {
        const result = await this.forcePurgeNode(node);
        removed = true;
        return result;
      }
      if (mode === 'deferred') {
        const result = await this.deferRemoval(node);
        removed = true;
        return result;
      }
      await this.waitForNodeSubscriptions(node);
      await this.cleanupNodeDependencies(node);
      await this.nodesRepo.remove(node);
      removed = true;
      await this.ensureMainNode();
      return { success: true };
    } finally {
      this.nodeDeletion.end(id, removed);
    }
  }

  private async forcePurgeNode(node: Node) {
    const id = node.id;

    await this.detachNodeSubscriptions(node, true);

    const tunnels = await this.tunnelsRepo.find({ where: { nodeId: node.id } });
    for (const tunnel of tunnels) {
      tunnel.nodeId = undefined;
      tunnel.node = undefined;
      tunnel.isInstalled = false;
    }
    if (tunnels.length) await this.tunnelsRepo.save(tunnels);

    await this.tunnelsRepo.delete({ nodeId: id });
    await this.inboundsRepo.delete({ nodeId: id });
    await this.nodesRepo.remove(node);
    await this.ensureMainNode();
    return { success: true, forced: true };
  }

  private async deferRemoval(node: Node) {
    const now = new Date();
    node.deletedAt = now;
    node.healthStatus = NodeHealthStatus.Deleting;

    await this.detachNodeSubscriptions(node, true);
    node.isMain = false;

    const inbounds = await this.inboundsRepo.find({
      where: { nodeId: node.id },
    });
    for (const inbound of inbounds) {
      inbound.status = InboundStatus.PendingCleanup;
      inbound.nextCleanupAt = now;
    }
    if (inbounds.length) await this.inboundsRepo.save(inbounds);

    const tunnels = await this.tunnelsRepo.find({ where: { nodeId: node.id } });
    for (const tunnel of tunnels) {
      tunnel.nodeId = undefined;
      tunnel.node = undefined;
      tunnel.isInstalled = false;
    }
    if (tunnels.length) await this.tunnelsRepo.save(tunnels);

    await this.nodesRepo.save(node);
    await this.ensureMainNode();
    return { success: true, deferred: true, pendingCleanup: inbounds.length };
  }

  private async ensureMainNode() {
    const main = await this.getDefaultNode();
    if (main) return;
    const fallback = await this.nodesRepo.findOne({
      where: { deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (fallback) {
      fallback.isMain = true;
      await this.nodesRepo.save(fallback);
    }
  }

  private async cleanupNodeDependencies(node: Node) {
    await this.deleteNodeInbounds(node);
    const id = node.id;
    await this.detachNodeSubscriptions(node, false);

    await this.tunnelsRepo.delete({ nodeId: id });
    await this.inboundsRepo.delete({ nodeId: id });
  }

  private async detachNodeSubscriptions(node: Node, disable: boolean) {
    const tunnels = await this.tunnelsRepo.find({ where: { nodeId: node.id } });
    const relayIds = new Set(tunnels.map((tunnel) => String(tunnel.id)));
    const rewrite = <
      T extends {
        type?: string;
        nodeId?: string;
        relayServerId?: number | string;
        flag?: string;
        name?: string;
        enabled?: boolean;
        disabledReason?: string;
      },
    >(
      item: T,
      inherited = false,
      disableMatched = disable,
    ): T => {
      if (item.type && ROUTING_INBOUND_TYPES.has(item.type)) return item;
      const matched = item.nodeId === node.id || (inherited && !item.nodeId);
      const relayMatched =
        item.relayServerId != null && relayIds.has(String(item.relayServerId));
      if (!matched && !relayMatched) return item;
      const next = { ...item };
      if (matched) {
        delete next.nodeId;
        delete next.flag;
        delete next.name;
        if (disableMatched) {
          next.enabled = false;
          next.disabledReason = `Нода «${node.name}» удалена — подключение переведено на основную ноду`;
        }
      }
      if (matched || relayMatched) delete next.relayServerId;
      return next;
    };
    const subscriptions = await this.subscriptionsRepo.find();
    const isDefault = await this.isImplicitDefault(node, subscriptions);
    for (const found of subscriptions.filter((sub) =>
      this.referencesNode(sub, node, relayIds, isDefault),
    )) {
      await this.subscriptionLock.run(found.id, async () => {
        const sub = await this.subscriptionsRepo.findOne({
          where: { id: found.id },
        });
        if (!sub || !this.referencesNode(sub, node, relayIds, isDefault))
          return;
        const inherited = sub.nodeId === node.id;
        const config = sub.inboundsConfig || [];
        const next = config.map((item) => rewrite(item, inherited));
        if (inherited) {
          sub.nodeId = null;
          sub.node = null;
        }
        if (inherited || JSON.stringify(next) !== JSON.stringify(config)) {
          sub.inboundsConfig = next;
          await this.subscriptionsRepo.save(sub);
        }
      });
    }
    const setting = await this.settingsRepo.findOne({
      where: { key: 'default_inbounds' },
    });
    if (!setting) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(setting.value);
      if (!Array.isArray(parsed)) throw new Error('expected an array');
    } catch {
      this.logger.warn(
        'Не удалось прочитать default_inbounds при удалении ноды',
      );
      return;
    }
    const next = parsed.map((item: unknown) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? rewrite(item, false, false)
        : item,
    );
    if (JSON.stringify(next) !== JSON.stringify(parsed)) {
      setting.value = JSON.stringify(next);
      await this.settingsRepo.save(setting);
    }
  }

  private hasImplicitNode(sub: Subscription) {
    return (
      !sub.nodeId &&
      (sub.inboundsConfig || []).some(
        (item) =>
          !item.nodeId &&
          item.type !== 'custom' &&
          !ROUTING_INBOUND_TYPES.has(item.type || ''),
      )
    );
  }

  private async isImplicitDefault(node: Node, subscriptions: Subscription[]) {
    if (node.isMain) return true;
    if (!subscriptions.some((sub) => this.hasImplicitNode(sub))) return false;
    // Match rotation's main-node preference and earliest-node fallback.
    const defaultNode = await this.nodesRepo.findOne({
      where: { deletedAt: IsNull() },
      order: { isMain: 'DESC', createdAt: 'ASC' },
    });
    return defaultNode?.id === node.id;
  }

  private referencesNode(
    sub: Subscription,
    node: Node,
    relayIds: Set<string>,
    isDefault: boolean,
  ) {
    const matchesName = Boolean(
      sub.name &&
      node.name &&
      sub.name.trim().toLowerCase() === node.name.trim().toLowerCase(),
    );
    return (
      sub.nodeId === node.id ||
      (this.hasImplicitNode(sub) && (isDefault || matchesName)) ||
      (sub.inboundsConfig || []).some(
        (item) =>
          !ROUTING_INBOUND_TYPES.has(item.type || '') &&
          (item.nodeId === node.id ||
            (item.relayServerId != null &&
              relayIds.has(String(item.relayServerId)))),
      )
    );
  }

  private async waitForNodeSubscriptions(node: Node) {
    const tunnels = await this.tunnelsRepo.find({ where: { nodeId: node.id } });
    const relayIds = new Set(tunnels.map((tunnel) => String(tunnel.id)));
    const subscriptions = await this.subscriptionsRepo.find();
    const isDefault = await this.isImplicitDefault(node, subscriptions);
    for (const sub of subscriptions.filter((item) =>
      this.referencesNode(item, node, relayIds, isDefault),
    )) {
      await this.subscriptionLock.run(sub.id, async () => {
        // A running rotation finishes before we inspect and remove its inbounds.
        await this.subscriptionsRepo.findOne({ where: { id: sub.id } });
      });
    }
  }

  private async deleteNodeInbounds(node: Node) {
    const inbounds = await this.inboundsRepo.find({
      where: { nodeId: node.id },
    });

    for (const inbound of inbounds) {
      if (inbound.xuiId && inbound.xuiId > 0) {
        const isDeleted = await this.xuiService.deleteInbound(
          inbound.xuiId,
          node,
        );
        if (!isDeleted) {
          throw new BadRequestException(
            `Failed to delete inbound ${inbound.xuiId} from 3x-ui`,
          );
        }
      }
    }
  }

  async setMain(id: string) {
    const node = await this.findOneWithSecrets(id);
    await this.clearMainNode(id);
    node.isMain = true;
    return this.sanitizeNode(await this.nodesRepo.save(node));
  }

  async checkConnection(id: string) {
    const node = await this.findOneWithSecrets(id);
    const status = await this.xuiService.checkNodeConnection(node);
    await this.applyHealthResult(node, status);
    return this.connectionSummary(status);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async refreshHealth() {
    if (this.refreshingHealth || this.dbAvailability.shouldSkip()) return;
    this.refreshingHealth = true;
    try {
      const nodes = await this.nodesRepo
        .createQueryBuilder('node')
        .addSelect('node.password')
        .addSelect('node.token')
        .where('node.deletedAt IS NULL')
        .getMany();
      this.dbAvailability.recordSuccess(this.logger, 'NodesService');

      for (let offset = 0; offset < nodes.length; offset += 4) {
        if (this.dbAvailability.shouldSkip()) break;
        const settled = await Promise.allSettled(
          nodes.slice(offset, offset + 4).map(async (node) => {
            const status = await this.xuiService.checkNodeConnection(node);
            await this.applyHealthResult(node, status);
          }),
        );
        for (const result of settled) {
          if (result.status !== 'rejected') continue;
          if (
            !this.dbAvailability.recordFailure(
              result.reason,
              this.logger,
              'refreshHealth',
              { strict: true },
            )
          ) {
            const message =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
            this.logger.warn(`Ошибка проверки состояния ноды: ${message}`);
          }
        }
      }
    } catch (error) {
      if (
        !this.dbAvailability.recordFailure(error, this.logger, 'refreshHealth')
      ) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Сбой фоновой проверки состояния нод: ${message}`);
      }
    } finally {
      this.refreshingHealth = false;
    }
  }

  private async applyHealthResult(
    node: Node,
    status: Awaited<ReturnType<XuiService['checkNodeConnection']>>,
  ) {
    node.lastCheckedAt = new Date();
    node.responseTimeMs = status.responseTimeMs;
    if (status.success) {
      const xrayFailed = Boolean(
        status.xrayError ||
        (status.xrayState && status.xrayState !== 'running'),
      );
      node.healthStatus = xrayFailed
        ? NodeHealthStatus.Degraded
        : NodeHealthStatus.Online;
      node.consecutiveFailures = 0;
      node.lastError = xrayFailed
        ? status.xrayError || `Xray: ${status.xrayState}`
        : undefined;
      if (status.version) node.version = status.version;
      if (status.xrayVersion) node.xrayVersion = status.xrayVersion;
      node.webCertificateFile = status.webCertificateFile;
      node.webKeyFile = status.webKeyFile;
      node.compatibilityCheckedAt = new Date();
      node.capabilities = buildNodeCapabilities({
        panelVersion: node.version,
        xrayVersion: node.xrayVersion,
        autoTlsCertificate: Boolean(
          status.webCertificateFile && status.webKeyFile,
        ),
      });
    } else {
      node.consecutiveFailures = (node.consecutiveFailures || 0) + 1;
      node.healthStatus =
        status.errorType === 'auth'
          ? NodeHealthStatus.AuthError
          : node.consecutiveFailures >= 3
            ? NodeHealthStatus.Offline
            : NodeHealthStatus.Degraded;
      node.lastError = status.message;
    }
    await this.nodesRepo.save(node);
  }

  async syncFromMain() {
    const main = await this.getDefaultNode();
    if (!main) {
      throw new BadRequestException('Main node is not configured');
    }

    const discovered = await this.xuiService.getNodes(main);
    const synced: Node[] = [];

    for (const item of discovered) {
      if (!item.host || !item.port) {
        continue;
      }
      const host = item.host.replace(/^\[|\]$/g, '');
      const authority = host.includes(':') ? `[${host}]` : host;
      const basePath = (item.basePath || '/').replace(/^\/+|\/+$/g, '');
      const url = `${item.protocol}://${authority}:${item.port}${basePath ? `/${basePath}` : ''}`;

      const existing = await this.nodesRepo.findOne({
        where: { url },
      });

      if (existing) {
        existing.name = item.name || existing.name;
        existing.version = item.version || existing.version;
        synced.push(await this.nodesRepo.save(existing));
        continue;
      }

      synced.push(
        await this.nodesRepo.save(
          this.nodesRepo.create({
            name: item.name || item.host,
            url,
            host: item.host,
            domain: getDomainFromHost(item.host),
            port: item.port,
            ip: await this.resolveIp(item.host),
            flag: (await this.lookupGeo(await this.resolveIp(item.host)))?.flag,
            protocol:
              item.protocol === 'http' ? NodeProtocol.Http : NodeProtocol.Https,
            authType: main.authType,
            login: main.login,
            password: main.password,
            token: main.token,
            version: item.version,
            isMain: false,
          }),
        ),
      );
    }

    return {
      success: true,
      count: synced.length,
      nodes: synced.map((item) => this.sanitizeNode(item)),
    };
  }

  private assertCredentials(
    dto: Pick<CreateNodeDto, 'authType' | 'login' | 'password' | 'token'>,
  ) {
    if (
      dto.authType === NodeAuthType.Password &&
      (!dto.login || !dto.password)
    ) {
      throw new BadRequestException('Login and password are required');
    }

    if (dto.authType === NodeAuthType.Token && !dto.token) {
      throw new BadRequestException('Token is required');
    }
  }

  private async clearMainNode(exceptId?: string, repo = this.nodesRepo) {
    const qb = repo
      .createQueryBuilder()
      .update(Node)
      .set({ isMain: false })
      .where('isMain = :isMain', { isMain: true });

    if (exceptId) {
      qb.andWhere('id != :exceptId', { exceptId });
    }

    await qb.execute();
  }

  async checkPayload(dto: CheckNodeDto) {
    const existing = dto.nodeId
      ? await this.findOneWithSecrets(dto.nodeId)
      : undefined;
    const authType = dto.authType ?? existing?.authType;
    const login = dto.login?.trim() || existing?.login;
    const password = dto.password?.trim() || existing?.password;
    const token = dto.token?.trim() || existing?.token;
    const allowInvalidTls =
      dto.allowInvalidTls ?? existing?.allowInvalidTls ?? false;
    const ip = dto.ip?.trim() || existing?.ip;

    this.assertCredentials({
      authType,
      login,
      password,
      token,
    });

    const node = this.nodesRepo.create({
      ...(existing || {}),
      ...dto,
      authType,
      login,
      password,
      token,
      allowInvalidTls,
      ip,
      url: this.normalizeUrl(dto.url),
    });
    const status = await this.xuiService.checkNodeConnection(node, {
      freshConnection: true,
      preferDirectIp: dto.preferDirectIp,
    });
    return this.connectionSummary(status);
  }

  private async refreshNodeProfile(node: Node) {
    const status = await this.xuiService.checkNodeConnection(node, {
      freshConnection: true,
    });
    await this.applyHealthResult(node, status);
    return node;
  }

  private connectionSummary(
    status: Awaited<ReturnType<XuiService['checkNodeConnection']>>,
  ) {
    const capabilities = status.success
      ? buildNodeCapabilities({
          panelVersion: status.version,
          xrayVersion: status.xrayVersion,
          autoTlsCertificate: Boolean(
            status.webCertificateFile && status.webKeyFile,
          ),
        })
      : undefined;
    return {
      success: status.success,
      version: status.version,
      xrayVersion: status.xrayVersion,
      capabilities,
      responseTimeMs: status.responseTimeMs,
      diagnostics: status.diagnostics,
      message: status.message,
    };
  }

  async detectLocation(url: string) {
    const resolved = await this.resolveNodeLocation(url);
    return {
      ip: resolved.ip,
      resolvedIps: resolved.resolvedIps,
      host: resolved.host,
      domain: resolved.domain,
      port: resolved.port,
      protocol: resolved.protocol,
      flag: resolved.flag,
      country: resolved.country,
      countryCode: resolved.countryCode,
    };
  }

  private async resolveNodeLocation(
    url: string,
    preferredFlag?: string,
    preferredIp?: string,
  ) {
    const normalized = this.normalizeUrl(url);
    const parsed = this.parseUrl(normalized);
    const resolvedIps = await this.resolveHostIps(parsed.host);
    const ip =
      preferredIp ||
      resolvedIps.find((entry) => net.isIPv4(entry)) ||
      resolvedIps[0] ||
      (await this.resolveIp(parsed.host));
    const geo = ip ? await this.lookupGeo(ip) : undefined;

    return {
      ...parsed,
      domain: getDomainFromHost(parsed.host),
      ip,
      resolvedIps,
      country: geo?.country,
      countryCode: geo?.countryCode,
      flag: preferredFlag || geo?.flag,
    };
  }

  private parseUrl(url: string) {
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : undefined,
        protocol:
          parsed.protocol.replace(':', '') === 'http'
            ? NodeProtocol.Http
            : NodeProtocol.Https,
      };
    } catch {
      return { host: url, port: undefined, protocol: NodeProtocol.Https };
    }
  }

  private async resolveHostIps(host?: string): Promise<string[]> {
    const clean = host?.trim().replace(/^\[|\]$/g, '');
    if (!clean || clean === 'localhost') return [];
    if (net.isIP(clean) !== 0) return [clean];
    const collected: string[] = [];
    try {
      const v4 = await dns.resolve4(clean);
      collected.push(...v4);
    } catch {
      // Fallback below.
    }
    try {
      const lookups = await dns.lookup(clean, { all: true });
      for (const item of lookups) {
        if (item.address && !collected.includes(item.address)) {
          collected.push(item.address);
        }
      }
    } catch {
      // Keep any IPv4 records already resolved above.
    }
    return collected;
  }

  private async resolveIp(host?: string) {
    const clean = host?.trim().replace(/^\[|\]$/g, '');
    if (!clean || clean === 'localhost') return undefined;
    if (net.isIP(clean) !== 0) return clean;

    try {
      const v4 = await dns.resolve4(clean);
      if (v4[0]) return v4[0];
    } catch {
      // Fallback below.
    }

    try {
      const v4Lookup = await dns.lookup(clean, { family: 4 });
      if (v4Lookup.address) return v4Lookup.address;
    } catch {
      // Fallback below.
    }

    try {
      const result = await dns.lookup(clean);
      return result.address;
    } catch {
      return undefined;
    }
  }

  private async lookupGeo(ip?: string): Promise<GeoResult | undefined> {
    if (!ip || ip === '127.0.0.1') return undefined;

    const fromCode = (countryCode?: string, country?: string) => {
      const countryInfo = COUNTRIES.find((c) => c.code === countryCode);
      return countryInfo
        ? {
            ip,
            country: countryInfo.name,
            countryCode,
            flag: countryInfo.emoji,
          }
        : { ip, country, countryCode };
    };

    try {
      const res = await fetch(`https://ipwho.is/${ip}`);
      const data = (await res.json()) as {
        success?: boolean;
        country?: string;
        country_code?: string;
      };
      if (data.success !== false) {
        return fromCode(data.country_code, data.country);
      }
    } catch {
      // Fallback below.
    }

    try {
      const res = await fetch(`http://ip-api.com/json/${ip}`);
      const data = (await res.json()) as {
        status?: string;
        country?: string;
        countryCode?: string;
      };
      if (data.status === 'success') {
        return fromCode(data.countryCode, data.country);
      }
    } catch {
      return undefined;
    }
  }

  private normalizeUrl(url: string) {
    return url
      .trim()
      .replace(/\/(?:panel|xui)(?:\/.*)?$/i, '')
      .replace(/\/+$/, '');
  }
}
