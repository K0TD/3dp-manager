import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as dns from 'dns/promises';
import { ConnectionProfile } from './entities/connection-profile.entity';
import { Node } from '../nodes/entities/node.entity';
import { Inbound, InboundStatus } from '../inbounds/entities/inbound.entity';
import { XuiService } from '../xui/xui.service';
import {
  CreateConnectionProfileDto,
  PreviewConnectionProfileDto,
  UpdateConnectionProfileDto,
} from './dto/connection-profile.dto';
import {
  evaluateProfileCompatibility,
  normalizeManagedProfileSettings,
  PROFILE_CATALOG,
  validateManagedProfileSettings,
} from './profile-compatibility';
import {
  buildXhttpStableExportBundle,
  buildXhttpStableServerInbound,
  buildXrayClientJsonFromProfile,
  buildVlessUriFromClientProfile,
  sanitizeServerInboundPreview,
} from './profile-config.builder';
import type {
  ProfileCompatibilityReport,
  ProfileExportBundle,
  SeparatedClientProfile,
} from './connection-profile.types';

const PREVIEW_UUID = '00000000-0000-4000-8000-000000000000';
const PREVIEW_PUBLIC_KEY = '<generated-reality-public-key>';
const PREVIEW_SHORT_ID = 'a1b2c3d4';

@Injectable()
export class ConnectionProfilesService {
  constructor(
    @InjectRepository(ConnectionProfile)
    private readonly profileRepo: Repository<ConnectionProfile>,
    @InjectRepository(Node)
    private readonly nodeRepo: Repository<Node>,
    @InjectRepository(Inbound)
    private readonly inboundRepo: Repository<Inbound>,
    private readonly xuiService: XuiService,
  ) {}

  getCatalog() {
    return PROFILE_CATALOG;
  }

  findAll() {
    return this.profileRepo.find({
      order: { updatedAt: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const profile = await this.profileRepo.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Connection profile not found');
    return profile;
  }

  async create(dto: CreateConnectionProfileDto) {
    const validationErrors = validateManagedProfileSettings(
      dto.kind,
      dto.spec,
      { sni: dto.sni, port: dto.port },
    );
    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors.join('; '));
    }

    const node = dto.nodeId ? await this.loadNodeMeta(dto.nodeId) : null;
    if (dto.nodeId && !node) {
      throw new BadRequestException('Node not found');
    }

    const normalizedSpec = normalizeManagedProfileSettings(dto.kind, dto.spec);
    const compatibility = evaluateProfileCompatibility({
      kind: dto.kind,
      port: dto.port ?? 'random',
      sni: dto.sni,
      settings: normalizedSpec,
      node: this.toNodeCompatInput(node),
    });

    const profile = this.profileRepo.create({
      name: dto.name.trim(),
      kind: dto.kind,
      enabled: dto.enabled !== false,
      subscriptionId: dto.subscriptionId ?? null,
      nodeId: dto.nodeId ?? null,
      configId: dto.configId ?? null,
      port: dto.port ?? null,
      sni: dto.sni?.trim() || null,
      rotationPolicy:
        dto.rotationPolicy ?? normalizedSpec.rotationPolicy ?? 'fixed_domain',
      spec: normalizedSpec,
      monitoringConfig:
        dto.monitoringConfig ?? normalizedSpec.monitoring ?? null,
      lastCheckStatus: compatibility.status,
      lastCheckResult: compatibility,
      lastCheckedAt: new Date(),
      activeRevision: 1,
      previousSnapshot: null,
    });

    return this.profileRepo.save(profile);
  }

  async update(id: string, dto: UpdateConnectionProfileDto) {
    const profile = await this.findOne(id);
    const nextSpec = dto.spec
      ? normalizeManagedProfileSettings(profile.kind, {
          ...profile.spec,
          ...dto.spec,
        })
      : profile.spec;
    const nextPort = dto.port !== undefined ? dto.port : profile.port;
    const nextSni =
      dto.sni !== undefined ? dto.sni?.trim() || null : profile.sni;

    const validationErrors = validateManagedProfileSettings(
      profile.kind,
      nextSpec,
      { sni: nextSni, port: nextPort },
    );
    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors.join('; '));
    }

    const nextNodeId = dto.nodeId !== undefined ? dto.nodeId : profile.nodeId;
    const node = nextNodeId ? await this.loadNodeMeta(nextNodeId) : null;
    if (nextNodeId && !node) {
      throw new BadRequestException('Node not found');
    }

    profile.previousSnapshot = {
      revision: profile.activeRevision,
      savedAt: new Date().toISOString(),
      name: profile.name,
      kind: profile.kind,
      port: profile.port,
      sni: profile.sni,
      rotationPolicy: profile.rotationPolicy,
      spec: profile.spec,
    };

    if (dto.name !== undefined && dto.name.trim()) {
      profile.name = dto.name.trim();
    }
    if (dto.enabled !== undefined) profile.enabled = dto.enabled;
    if (dto.subscriptionId !== undefined) {
      profile.subscriptionId = dto.subscriptionId;
    }
    profile.nodeId = nextNodeId ?? null;
    profile.port = nextPort ?? null;
    profile.sni = nextSni ?? null;
    profile.rotationPolicy =
      dto.rotationPolicy ?? nextSpec.rotationPolicy ?? profile.rotationPolicy;
    profile.spec = nextSpec;
    if (dto.monitoringConfig !== undefined) {
      profile.monitoringConfig = dto.monitoringConfig;
    }
    profile.activeRevision += 1;

    const compatibility = evaluateProfileCompatibility({
      kind: profile.kind,
      port: profile.port ?? 'random',
      sni: profile.sni,
      settings: profile.spec,
      node: this.toNodeCompatInput(node),
    });
    profile.lastCheckStatus = compatibility.status;
    profile.lastCheckResult = compatibility;
    profile.lastCheckedAt = new Date();

    return this.profileRepo.save(profile);
  }

  async remove(id: string) {
    const profile = await this.findOne(id);
    await this.profileRepo.remove(profile);
    return { success: true, id };
  }

  async preview(dto: PreviewConnectionProfileDto) {
    const node = dto.nodeId ? await this.loadNodeMeta(dto.nodeId) : null;
    const normalized = normalizeManagedProfileSettings(dto.kind, dto.settings);
    const compatibility = evaluateProfileCompatibility({
      kind: dto.kind,
      port: dto.port ?? 'random',
      sni: dto.sni,
      settings: normalized,
      node: this.toNodeCompatInput(node),
    });

    const address = this.resolveNodeAddress(node) || 'node.example.com';
    const numericPort =
      dto.port && dto.port !== 'random' && /^\d+$/.test(String(dto.port))
        ? Number(dto.port)
        : 443;
    const effectiveSni =
      dto.sni && dto.sni !== 'random'
        ? dto.sni.trim()
        : normalized.domain || 'www.microsoft.com';
    const remark = dto.name?.trim() || dto.kind;

    if (dto.kind === 'xhttp-stable') {
      const serverInbound = buildXhttpStableServerInbound({
        port: numericPort,
        uuid: PREVIEW_UUID,
        remark,
        sni: effectiveSni,
        privateKey: '<server-only:redacted>',
        publicKey: PREVIEW_PUBLIC_KEY,
        shortIds: [PREVIEW_SHORT_ID],
        settings: normalized,
      });
      const exportBundle = buildXhttpStableExportBundle({
        address,
        port: numericPort,
        uuid: PREVIEW_UUID,
        remark,
        sni: effectiveSni,
        publicKey: PREVIEW_PUBLIC_KEY,
        shortId: PREVIEW_SHORT_ID,
        settings: normalized,
      });

      return {
        kind: dto.kind,
        compatibility,
        serverPreview: sanitizeServerInboundPreview(serverInbound),
        clientPreview: exportBundle,
      };
    }

    // Stages 2 & 3 preview skeleton (Self-SNI & HTTPS Fallback)
    const clientConfig: SeparatedClientProfile =
      dto.kind === 'self-sni'
        ? {
            kind: 'self-sni',
            protocol: 'vless',
            address,
            port: numericPort,
            uuid: PREVIEW_UUID,
            remark,
            flow: 'xtls-rprx-vision',
            network: 'tcp',
            security: 'reality',
            sni: effectiveSni,
            fingerprint: normalized.fingerprint || 'chrome',
            publicKey: PREVIEW_PUBLIC_KEY,
            shortId: PREVIEW_SHORT_ID,
            spiderX: normalized.spiderX || '/',
          }
        : {
            kind: 'https-fallback',
            protocol: 'vless',
            address: normalized.domain || address,
            port: normalized.publicPort || numericPort,
            uuid: PREVIEW_UUID,
            remark,
            network: 'xhttp',
            security: 'tls',
            sni: effectiveSni,
            fingerprint: normalized.fingerprint || 'chrome',
            alpn: ['h2', 'http/1.1'],
            xhttp: {
              path: normalized.path || '/api/v2/stream',
              host: normalized.host || effectiveSni,
              mode: normalized.mode || 'auto',
            },
          };

    const clientPreview: ProfileExportBundle = {
      kind: dto.kind,
      vlessLink: buildVlessUriFromClientProfile(clientConfig),
      clientConfig,
      xrayClientJson: buildXrayClientJsonFromProfile(clientConfig),
    };

    return {
      kind: dto.kind,
      compatibility,
      serverPreview: {
        protocol: 'vless',
        port: numericPort,
        remark,
        profileKind: dto.kind,
        stageNote:
          dto.kind === 'self-sni'
            ? 'Полная генерация серверного Self-SNI и конфигов Nginx/Caddy будет активирована на Этапе 2'
            : 'Полная генерация серверного HTTPS Fallback и reverse proxy будет активирована на Этапе 3',
      },
      clientPreview,
    };
  }

  async checkProfile(id: string): Promise<{
    id: string;
    status: ProfileCompatibilityReport['status'];
    report: ProfileCompatibilityReport;
    checkedAt: string;
  }> {
    const profile = await this.findOne(id);
    const node = profile.nodeId
      ? await this.loadNodeWithSecrets(profile.nodeId)
      : null;

    let occupiedPorts: number[] | undefined;
    let nodeResources:
      | {
          xrayState?: string;
        }
      | undefined;
    if (node) {
      try {
        const panelInboundsPromise: Promise<Array<{ port?: number }>> =
          this.xuiService
            .listRoutingInbounds(node)
            .then((rows: unknown) =>
              Array.isArray(rows) ? (rows as Array<{ port?: number }>) : [],
            )
            .catch(() => []);
        const [status, panelInbounds] = await Promise.all([
          this.xuiService.checkNodeConnection(node),
          panelInboundsPromise,
        ]);
        if (status.success) {
          if (status.version) node.version = status.version;
          if (status.xrayVersion) node.xrayVersion = status.xrayVersion;
          nodeResources = { xrayState: status.xrayState };
        }
        occupiedPorts = panelInbounds
          .map((item) => item.port)
          .filter((port): port is number => Number.isInteger(port));
      } catch {
        // Keep cached node metadata if live query fails
      }
    }

    let dnsResolvedIps: string[] | undefined;
    let dnsError: string | undefined;
    const domainToResolve =
      profile.spec?.domain?.trim() ||
      (profile.sni && profile.sni !== 'random' ? profile.sni.trim() : '');
    if (domainToResolve) {
      try {
        const resolved = await dns.lookup(domainToResolve, { all: true });
        dnsResolvedIps = resolved.map((entry) => entry.address);
      } catch (err) {
        dnsError = `Не удалось разрешить домен «${domainToResolve}»: ${
          err instanceof Error ? err.message : 'DNS lookup failed'
        }`;
      }
    }

    const report = evaluateProfileCompatibility({
      kind: profile.kind,
      port: profile.port ?? 'random',
      sni: profile.sni,
      settings: profile.spec,
      node: this.toNodeCompatInput(node),
      occupiedPorts,
      dnsResolvedIps,
      dnsError,
      nodeResources,
    });

    const checkedAt = new Date();
    profile.lastCheckStatus = report.status;
    profile.lastCheckResult = report;
    profile.lastCheckedAt = checkedAt;
    await this.profileRepo.save(profile);

    return {
      id: profile.id,
      status: report.status,
      report,
      checkedAt: checkedAt.toISOString(),
    };
  }

  async exportProfile(id: string): Promise<{
    id: string;
    name: string;
    kind: ConnectionProfile['kind'];
    source: 'active_inbound' | 'preview';
    exportBundle: ProfileExportBundle;
  }> {
    const profile = await this.findOne(id);
    const activeInbound = await this.findActiveInboundForProfile(profile);

    if (activeInbound?.clientProfileJson) {
      try {
        const clientConfig = JSON.parse(
          activeInbound.clientProfileJson,
        ) as SeparatedClientProfile;
        return {
          id: profile.id,
          name: profile.name,
          kind: profile.kind,
          source: 'active_inbound',
          exportBundle: {
            kind: profile.kind,
            vlessLink:
              activeInbound.link ||
              buildVlessUriFromClientProfile(clientConfig),
            clientConfig,
            xrayClientJson: buildXrayClientJsonFromProfile(clientConfig),
          },
        };
      } catch {
        // Fallback to preview export below
      }
    }

    const previewResult = await this.preview({
      kind: profile.kind,
      name: profile.name,
      nodeId: profile.nodeId ?? undefined,
      port: profile.port ?? 'random',
      sni: profile.sni ?? undefined,
      settings: profile.spec,
    });

    return {
      id: profile.id,
      name: profile.name,
      kind: profile.kind,
      source: 'preview',
      exportBundle: previewResult.clientPreview,
    };
  }

  private async findActiveInboundForProfile(
    profile: ConnectionProfile,
  ): Promise<Inbound | null> {
    if (profile.configId) {
      const byConfig = await this.inboundRepo.findOne({
        where: { configId: profile.configId, status: InboundStatus.Active },
        order: { createdAt: 'DESC' },
      });
      if (byConfig) return byConfig;
    }
    return this.inboundRepo.findOne({
      where: { profileId: profile.id, status: InboundStatus.Active },
      order: { createdAt: 'DESC' },
    });
  }

  private async loadNodeMeta(nodeId: string): Promise<Node | null> {
    return this.nodeRepo.findOne({ where: { id: nodeId } });
  }

  private async loadNodeWithSecrets(nodeId: string): Promise<Node | null> {
    return this.nodeRepo
      .createQueryBuilder('node')
      .addSelect('node.password')
      .addSelect('node.token')
      .where('node.id = :nodeId', { nodeId })
      .getOne();
  }

  private toNodeCompatInput(node: Node | null) {
    if (!node) return null;
    return {
      name: node.name,
      version: node.version,
      xrayVersion: node.xrayVersion,
      autoTlsCertificate: Boolean(node.webCertificateFile && node.webKeyFile),
      healthStatus: node.healthStatus,
    };
  }

  private resolveNodeAddress(node: Node | null): string | undefined {
    if (!node) return undefined;
    if (node.domain) return node.domain;
    if (node.ip) return node.ip;
    if (node.host) return node.host;
    try {
      return node.url ? new URL(node.url).hostname : undefined;
    } catch {
      return undefined;
    }
  }
}
