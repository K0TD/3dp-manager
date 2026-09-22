import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CreateNodeDto, UpdateNodeDto } from './dto/node.dto';
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
  ) {}

  findAll() {
    return this.nodesRepo.find({
      where: { deletedAt: IsNull() },
      order: { isMain: 'DESC', createdAt: 'DESC' },
    });
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

  async create(dto: CreateNodeDto) {
    this.assertCredentials(dto);
    const resolved = await this.resolveNodeLocation(dto.url, dto.flag, dto.ip);

    const node = this.nodesRepo.create({
      ...dto,
      url: this.normalizeUrl(dto.url),
      host: resolved.host,
      domain: dto.domain || resolved.domain,
      port: resolved.port,
      protocol: resolved.protocol,
      ip: resolved.ip,
      flag: resolved.flag,
      isMain: dto.isMain ?? false,
    });

    if (
      (await this.nodesRepo.count({ where: { deletedAt: IsNull() } })) === 0
    ) {
      node.isMain = true;
    }

    if (node.isMain) {
      await this.clearMainNode();
    }

    const savedNode = await this.nodesRepo.save(node);
    return this.refreshNodeProfile(savedNode);
  }

  async update(id: string, dto: UpdateNodeDto) {
    const node = await this.findOneWithSecrets(id);
    const nextAuthType = dto.authType ?? node.authType;

    if (nextAuthType === NodeAuthType.Password) {
      const login = dto.login ?? node.login;
      const password = dto.password ?? node.password;
      if (!login || !password) {
        throw new BadRequestException('Login and password are required');
      }
    }

    if (nextAuthType === NodeAuthType.Token) {
      const token = dto.token ?? node.token;
      if (!token) {
        throw new BadRequestException('Token is required');
      }
    }

    Object.assign(node, dto);
    if (dto.url) {
      node.url = this.normalizeUrl(dto.url);
      const resolved = await this.resolveNodeLocation(
        dto.url,
        dto.flag ?? node.flag,
        dto.ip,
      );
      node.host = resolved.host;
      node.domain = dto.domain || resolved.domain;
      node.port = resolved.port;
      node.protocol = resolved.protocol;
      node.ip = resolved.ip;
      node.flag = resolved.flag;
    } else {
      if (dto.domain !== undefined) node.domain = dto.domain;
      if (dto.ip) node.ip = dto.ip;
      if (dto.flag) node.flag = dto.flag;
    }

    if (dto.isMain) {
      await this.clearMainNode(id);
      node.isMain = true;
    }

    const savedNode = await this.nodesRepo.save(node);
    return this.refreshNodeProfile(savedNode);
  }

  async remove(id: string, mode: 'safe' | 'deferred' | 'force' = 'safe') {
    const node = await this.findOneWithSecrets(id, mode === 'force');
    if (mode === 'force') return this.forcePurgeNode(node);
    if (mode === 'deferred') return this.deferRemoval(node);
    await this.cleanupNodeDependencies(node);
    await this.nodesRepo.remove(node);

    await this.ensureMainNode();
    return { success: true };
  }

  private async forcePurgeNode(node: Node) {
    const id = node.id;

    const subscriptions = await this.subscriptionsRepo.find();
    for (const subscription of subscriptions) {
      const inheritedDeletedNode = subscription.nodeId === node.id;
      let changed = inheritedDeletedNode;
      subscription.inboundsConfig = (subscription.inboundsConfig || []).map(
        (item) => {
          if (
            item.nodeId !== node.id &&
            !(inheritedDeletedNode && !item.nodeId)
          ) {
            return item;
          }
          changed = true;
          const { nodeId: _nodeId, relayServerId: _relayId, ...rest } = item;
          return {
            ...rest,
            enabled: false,
            disabledReason: `Нода «${node.name}» удалена`,
          };
        },
      );
      if (inheritedDeletedNode) {
        subscription.nodeId = undefined;
        subscription.node = undefined;
      }
      if (changed) await this.subscriptionsRepo.save(subscription);
    }

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
    node.isMain = false;

    const inbounds = await this.inboundsRepo.find({
      where: { nodeId: node.id },
    });
    for (const inbound of inbounds) {
      inbound.status = InboundStatus.PendingCleanup;
      inbound.nextCleanupAt = now;
    }
    if (inbounds.length) await this.inboundsRepo.save(inbounds);

    const subscriptions = await this.subscriptionsRepo.find();
    for (const subscription of subscriptions) {
      const inheritedDeletedNode = subscription.nodeId === node.id;
      let changed = inheritedDeletedNode;
      subscription.inboundsConfig = (subscription.inboundsConfig || []).map(
        (item) => {
          if (
            item.nodeId !== node.id &&
            !(inheritedDeletedNode && !item.nodeId)
          ) {
            return item;
          }
          changed = true;
          const { nodeId: _nodeId, relayServerId: _relayId, ...rest } = item;
          return {
            ...rest,
            enabled: false,
            disabledReason: `Нода «${node.name}» удалена`,
          };
        },
      );
      if (inheritedDeletedNode) {
        subscription.nodeId = undefined;
        subscription.node = undefined;
      }
      if (changed) await this.subscriptionsRepo.save(subscription);
    }

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

    await this.tunnelsRepo.delete({ nodeId: id });
    await this.inboundsRepo.delete({ nodeId: id });
    await this.detachNodeSubscriptions(node);
  }

  private async detachNodeSubscriptions(node: Node) {
    const id = node.id;
    const subscriptions = await this.subscriptionsRepo.find({
      where: [{ nodeId: id }],
    });

    for (const sub of subscriptions) {
      sub.nodeId = undefined;
      sub.node = undefined;
      await this.subscriptionsRepo.save(sub);
    }

    const configuredSubscriptions = await this.subscriptionsRepo.find();
    for (const sub of configuredSubscriptions) {
      const config = sub.inboundsConfig || [];
      const nextConfig = config.map((item) => {
        if (item.nodeId !== id) return item;
        const {
          nodeId: _nodeId,
          relayServerId: _relayServerId,
          ...rest
        } = item;
        return rest;
      });

      if (JSON.stringify(nextConfig) !== JSON.stringify(config)) {
        sub.inboundsConfig = nextConfig;
        await this.subscriptionsRepo.save(sub);
      }
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
    return this.nodesRepo.save(node);
  }

  async checkConnection(id: string) {
    const node = await this.findOneWithSecrets(id);
    const status = await this.xuiService.checkNodeConnection(node);
    await this.applyHealthResult(node, status);
    return this.connectionSummary(status);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async refreshHealth() {
    const nodes = await this.nodesRepo
      .createQueryBuilder('node')
      .addSelect('node.password')
      .addSelect('node.token')
      .where('node.deletedAt IS NULL')
      .getMany();

    for (let offset = 0; offset < nodes.length; offset += 4) {
      await Promise.allSettled(
        nodes.slice(offset, offset + 4).map(async (node) => {
          const status = await this.xuiService.checkNodeConnection(node);
          await this.applyHealthResult(node, status);
        }),
      );
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

    return { success: true, count: synced.length, nodes: synced };
  }

  private assertCredentials(dto: CreateNodeDto) {
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

  private async clearMainNode(exceptId?: string) {
    const qb = this.nodesRepo
      .createQueryBuilder()
      .update(Node)
      .set({ isMain: false })
      .where('isMain = :isMain', { isMain: true });

    if (exceptId) {
      qb.andWhere('id != :exceptId', { exceptId });
    }

    await qb.execute();
  }

  async checkPayload(dto: CreateNodeDto) {
    this.assertCredentials(dto);
    const node = this.nodesRepo.create({
      ...dto,
      url: this.normalizeUrl(dto.url),
    });
    const status = await this.xuiService.checkNodeConnection(node);
    return this.connectionSummary(status);
  }

  private async refreshNodeProfile(node: Node) {
    const status = await this.xuiService.checkNodeConnection(node);
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
      message: status.message,
    };
  }

  async detectLocation(url: string) {
    const resolved = await this.resolveNodeLocation(url);
    return {
      ip: resolved.ip,
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
    const ip = preferredIp || (await this.resolveIp(parsed.host));
    const geo = ip ? await this.lookupGeo(ip) : undefined;

    return {
      ...parsed,
      domain: getDomainFromHost(parsed.host),
      ip,
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

  private async resolveIp(host?: string) {
    if (!host || host === 'localhost') return undefined;
    if (net.isIP(host) !== 0) return host;

    try {
      const result = await dns.lookup(host);
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
    return url.trim().replace(/\/+$/, '');
  }
}
