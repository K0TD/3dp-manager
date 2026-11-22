import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
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
  isValidHostname,
  normalizeManagedProfileSettings,
  PROFILE_CATALOG,
  validateManagedProfileSettings,
} from './profile-compatibility';
import {
  buildHttpsFallbackExportBundle,
  buildHttpsFallbackServerInbound,
  buildSelfSniExportBundle,
  buildSelfSniServerInbound,
  buildXhttpStableExportBundle,
  buildXhttpStableServerInbound,
  buildXrayClientJsonFromProfile,
  buildVlessUriFromClientProfile,
  sanitizeServerInboundPreview,
} from './profile-config.builder';
import {
  buildHttpsFallbackProxyBundle,
  buildSelfSniWebServerBundle,
} from './web-server-config.builder';
import { TlsSiteProbeService } from './tls-site-probe.service';
import { ClientProbeService } from './client-probe.service';
import type {
  ClientConnectionProbeResult,
  ManagedProfileKind,
  ProfileCompatibilityReport,
  ProfileExportBundle,
  SeparatedClientProfile,
  TlsSiteProbeResult,
  WebServerConfigBundle,
} from './connection-profile.types';

const PREVIEW_UUID = '00000000-0000-4000-8000-000000000000';
const PREVIEW_PUBLIC_KEY = '<generated-reality-public-key>';
const PREVIEW_SHORT_ID = 'a1b2c3d4';

@Injectable()
export class ConnectionProfilesService {
  private readonly fallbackProbe = new TlsSiteProbeService();
  private readonly fallbackClientProbe = new ClientProbeService();

  constructor(
    @InjectRepository(ConnectionProfile)
    private readonly profileRepo: Repository<ConnectionProfile>,
    @InjectRepository(Node)
    private readonly nodeRepo: Repository<Node>,
    @InjectRepository(Inbound)
    private readonly inboundRepo: Repository<Inbound>,
    private readonly xuiService: XuiService,
    @Optional()
    private readonly tlsSiteProbe?: TlsSiteProbeService,
    @Optional()
    private readonly clientProbe?: ClientProbeService,
  ) {}

  private get probe(): TlsSiteProbeService {
    return this.tlsSiteProbe ?? this.fallbackProbe;
  }

  private get clientVerifier(): ClientProbeService {
    return this.clientProbe ?? this.fallbackClientProbe;
  }

  getCatalog() {
    return PROFILE_CATALOG;
  }

  async findAll() {
    const profiles = await this.profileRepo.find({
      order: { updatedAt: 'DESC', createdAt: 'DESC' },
    });
    if (profiles.length === 0 || typeof this.inboundRepo.find !== 'function') {
      return profiles.map((profile) => ({
        ...profile,
        deployed: false,
        activeInbound: null,
      }));
    }

    const activeInbounds = await this.inboundRepo.find({
      where: { status: InboundStatus.Active },
      order: { createdAt: 'DESC' },
    });
    return profiles.map((profile) => {
      const matched = this.matchActiveInbound(profile, activeInbounds);
      return {
        ...profile,
        deployed: Boolean(matched),
        activeInbound: matched
          ? {
              id: matched.id,
              port: matched.port,
              remark: matched.remark ?? null,
              subscriptionId: matched.subscriptionId ?? null,
            }
          : null,
      };
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

  async preview(dto: PreviewConnectionProfileDto): Promise<{
    kind: ManagedProfileKind;
    compatibility: ProfileCompatibilityReport;
    serverPreview: Record<string, unknown>;
    clientPreview: ProfileExportBundle;
    webServerConfig?: WebServerConfigBundle;
    tlsProbe?: TlsSiteProbeResult;
  }> {
    const node = dto.nodeId
      ? dto.liveCheck
        ? await this.loadNodeWithSecrets(dto.nodeId)
        : await this.loadNodeMeta(dto.nodeId)
      : null;
    const normalized = normalizeManagedProfileSettings(dto.kind, dto.settings);

    const address = this.resolveNodeAddress(node) || 'node.example.com';
    const numericPort =
      dto.port && dto.port !== 'random' && /^\d+$/.test(String(dto.port))
        ? Number(dto.port)
        : 443;
    const explicitDomain =
      normalized.domain?.trim() ||
      (dto.sni && dto.sni !== 'random' ? dto.sni.trim() : '');
    const effectiveSni =
      explicitDomain ||
      (dto.kind === 'xhttp-stable' ? 'www.microsoft.com' : 'example.com');
    const remark = dto.name?.trim() || dto.kind;

    let occupiedPorts: number[] | undefined;
    let nodeResources:
      | {
          cpuPercent?: number;
          memPercent?: number;
          diskPercent?: number;
          xrayState?: string;
        }
      | undefined;
    let dnsResolvedIps: string[] | undefined;
    let dnsError: string | undefined;
    let tlsProbe: TlsSiteProbeResult | undefined;

    if (dto.liveCheck) {
      if (node) {
        const liveNode = await this.queryLiveNodeState(node);
        occupiedPorts = liveNode.occupiedPorts;
        nodeResources = liveNode.nodeResources;
      }
      if (explicitDomain && isValidHostname(explicitDomain)) {
        const probePort =
          dto.kind === 'self-sni'
            ? normalized.webServer === 'none'
              ? (normalized.destPort ?? numericPort)
              : numericPort
            : dto.kind === 'https-fallback'
              ? (normalized.publicPort ?? numericPort)
              : 443;
        tlsProbe = await this.probe.probeDomainAndTls({
          domain: explicitDomain,
          port: probePort,
          expectedHostIps: this.resolveExpectedNodeIps(node, explicitDomain),
          checkHttpSite: dto.kind !== 'xhttp-stable',
        });
        dnsResolvedIps = tlsProbe.dnsResolvedIps;
        dnsError = tlsProbe.dnsError;
      }
    }

    const compatibility = evaluateProfileCompatibility({
      kind: dto.kind,
      port: dto.port ?? 'random',
      sni: dto.sni,
      settings: normalized,
      node: this.toNodeCompatInput(node),
      occupiedPorts,
      dnsResolvedIps,
      dnsError,
      tlsProbe,
      nodeResources,
    });

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
        ...(tlsProbe ? { tlsProbe } : {}),
      };
    }

    if (dto.kind === 'self-sni') {
      const serverInbound = buildSelfSniServerInbound({
        port: numericPort,
        uuid: PREVIEW_UUID,
        remark,
        domain: effectiveSni,
        privateKey: '<server-only:redacted>',
        publicKey: PREVIEW_PUBLIC_KEY,
        shortIds: [PREVIEW_SHORT_ID],
        settings: normalized,
      });
      const exportBundle = buildSelfSniExportBundle({
        address: explicitDomain || address,
        port: numericPort,
        uuid: PREVIEW_UUID,
        remark,
        domain: effectiveSni,
        publicKey: PREVIEW_PUBLIC_KEY,
        shortId: PREVIEW_SHORT_ID,
        settings: normalized,
      });
      let webServerConfig: WebServerConfigBundle | undefined;
      if (
        (normalized.webServer === 'nginx' ||
          normalized.webServer === 'caddy') &&
        isValidHostname(effectiveSni)
      ) {
        webServerConfig = buildSelfSniWebServerBundle({
          engine: normalized.webServer,
          domain: effectiveSni,
          localHttpsPort: normalized.localHttpsPort ?? 8443,
          xver: normalized.xver ?? 0,
          certificateFile:
            normalized.certificateFile || node?.webCertificateFile,
          keyFile: normalized.keyFile || node?.webKeyFile,
        });
      }

      return {
        kind: dto.kind,
        compatibility,
        serverPreview: sanitizeServerInboundPreview(serverInbound),
        clientPreview: exportBundle,
        ...(webServerConfig ? { webServerConfig } : {}),
        ...(tlsProbe ? { tlsProbe } : {}),
      };
    }

    // HTTPS Fallback (Stage 3): VLESS + XHTTP + TLS (direct or behind Nginx/Caddy reverse proxy)
    const fallbackUpstreamPort =
      dto.port && dto.port !== 'random' && /^\d+$/.test(String(dto.port))
        ? Number(dto.port)
        : normalized.reverseProxy === 'nginx' ||
            normalized.reverseProxy === 'caddy'
          ? 20443
          : 443;
    const serverInbound = buildHttpsFallbackServerInbound({
      port: fallbackUpstreamPort,
      uuid: PREVIEW_UUID,
      remark,
      domain: effectiveSni,
      certificateFile: normalized.certificateFile || node?.webCertificateFile,
      keyFile: normalized.keyFile || node?.webKeyFile,
      settings: normalized,
    });
    const clientPreview = buildHttpsFallbackExportBundle({
      address: explicitDomain || address,
      port: fallbackUpstreamPort,
      uuid: PREVIEW_UUID,
      remark,
      domain: effectiveSni,
      settings: normalized,
    });
    let webServerConfig: WebServerConfigBundle | undefined;
    if (
      (normalized.reverseProxy === 'nginx' ||
        normalized.reverseProxy === 'caddy') &&
      isValidHostname(effectiveSni)
    ) {
      webServerConfig = buildHttpsFallbackProxyBundle({
        engine: normalized.reverseProxy,
        domain: effectiveSni,
        path: normalized.path || '/api/v2/stream',
        publicPort: normalized.publicPort ?? 443,
        upstreamPort: fallbackUpstreamPort,
        certificateFile: normalized.certificateFile || node?.webCertificateFile,
        keyFile: normalized.keyFile || node?.webKeyFile,
      });
    }

    return {
      kind: dto.kind,
      compatibility,
      serverPreview: sanitizeServerInboundPreview(serverInbound),
      clientPreview,
      ...(webServerConfig ? { webServerConfig } : {}),
      ...(tlsProbe ? { tlsProbe } : {}),
    };
  }

  async checkProfile(id: string): Promise<{
    id: string;
    status: ProfileCompatibilityReport['status'];
    report: ProfileCompatibilityReport;
    tlsProbe?: TlsSiteProbeResult;
    checkedAt: string;
  }> {
    const profile = await this.findOne(id);
    const activeInbound = await this.findActiveInboundForProfile(profile);
    const deployed = Boolean(activeInbound);
    const node = profile.nodeId
      ? await this.loadNodeWithSecrets(profile.nodeId)
      : null;

    let occupiedPorts: number[] | undefined;
    let nodeResources:
      | {
          cpuPercent?: number;
          memPercent?: number;
          diskPercent?: number;
          xrayState?: string;
        }
      | undefined;
    if (node) {
      const liveNode = await this.queryLiveNodeState(node);
      occupiedPorts = liveNode.occupiedPorts?.filter(
        (p) => !activeInbound || p !== activeInbound.port,
      );
      nodeResources = liveNode.nodeResources;
    }

    let dnsResolvedIps: string[] | undefined;
    let dnsError: string | undefined;
    let tlsProbe: TlsSiteProbeResult | undefined;
    const domainToResolve =
      profile.spec?.domain?.trim() ||
      (profile.sni && profile.sni !== 'random' ? profile.sni.trim() : '');
    if (domainToResolve && isValidHostname(domainToResolve)) {
      if (profile.kind === 'self-sni' || profile.kind === 'https-fallback') {
        const probePort =
          profile.kind === 'self-sni'
            ? profile.spec?.webServer === 'none'
              ? (profile.spec?.destPort ?? profile.port ?? 443)
              : (profile.port ?? 443)
            : (profile.spec?.publicPort ?? profile.port ?? 443);
        const expectedIps = this.resolveExpectedNodeIps(node, domainToResolve);
        tlsProbe = await this.probe.probeDomainAndTls({
          domain: domainToResolve,
          port: probePort,
          expectedHostIps: expectedIps,
          checkHttpSite: true,
        });
        // For undeployed drafts on a custom Xray port (e.g. 24443), the Xray port is
        // expected to be closed before deployment; try port 443 to still validate the
        // domain's TLS certificate if Nginx/Caddy is already serving HTTPS on 443.
        if (
          !deployed &&
          probePort !== 443 &&
          !tlsProbe.reachable &&
          !tlsProbe.dnsError &&
          /ECONNREFUSED/i.test(tlsProbe.error || '')
        ) {
          const fallback443 = await this.probe.probeDomainAndTls({
            domain: domainToResolve,
            port: 443,
            expectedHostIps: expectedIps,
            checkHttpSite: true,
          });
          if (fallback443.reachable) {
            tlsProbe = fallback443;
          }
        }
        dnsResolvedIps = tlsProbe.dnsResolvedIps;
        dnsError = tlsProbe.dnsError;
      } else {
        try {
          const resolved = await dns.lookup(domainToResolve, { all: true });
          dnsResolvedIps = resolved.map((entry) => entry.address);
        } catch (err) {
          dnsError = `Не удалось разрешить домен «${domainToResolve}»: ${
            err instanceof Error ? err.message : 'DNS lookup failed'
          }`;
        }
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
      tlsProbe,
      nodeResources,
      deployed,
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
      ...(tlsProbe ? { tlsProbe } : {}),
      checkedAt: checkedAt.toISOString(),
    };
  }

  async probeProfile(id: string): Promise<{
    id: string;
    source: 'active_inbound' | 'preview';
    deployed: boolean;
    probe: ClientConnectionProbeResult;
    checkedAt: string;
  }> {
    const profile = await this.findOne(id);
    const exported = await this.exportProfile(id);
    const checkedAt = new Date();
    const existingChecks = profile.lastCheckResult?.checks || [];
    const filtered = existingChecks.filter(
      (item) =>
        item.code !== 'CLIENT_PROBE_OK' &&
        item.code !== 'CLIENT_PROBE_FAILED' &&
        item.code !== 'CLIENT_PROBE_NOT_DEPLOYED',
    );

    if (exported.source !== 'active_inbound') {
      const probe: ClientConnectionProbeResult = {
        success: false,
        engine: 'xray-core',
        targetAddress: exported.exportBundle.clientConfig.address,
        targetPort: exported.exportBundle.clientConfig.port,
        protocol: 'vless',
        profileKind: profile.kind,
        latencyMs: 0,
        error:
          'Профиль сохранён как черновик и ещё не развёрнут на ноде 3x-ui. Нажмите «В подписку» (или добавьте этот тип в подписку) и выполните ротацию, затем повторите клиентскую пробу.',
      };
      const nextChecks = [
        ...filtered,
        {
          code: 'CLIENT_PROBE_NOT_DEPLOYED',
          severity: 'warning' as const,
          title: 'Профиль ещё не развёрнут на ноде',
          message: probe.error,
        },
      ];
      const hasError = nextChecks.some((c) => c.severity === 'error');
      profile.lastCheckResult = {
        compatible: !hasError,
        status: hasError ? 'failed' : 'warning',
        checks: nextChecks,
      };
      profile.lastCheckStatus = profile.lastCheckResult.status;
      profile.lastCheckedAt = checkedAt;
      await this.profileRepo.save(profile);

      return {
        id: profile.id,
        source: 'preview',
        deployed: false,
        probe,
        checkedAt: checkedAt.toISOString(),
      };
    }

    const probe = await this.clientVerifier.probeClientProfile(
      exported.exportBundle.clientConfig,
    );
    const nextChecks = [
      ...filtered,
      probe.success
        ? {
            code: 'CLIENT_PROBE_OK',
            severity: 'ok' as const,
            title: `Клиентская проверка пройдена (${probe.engine})`,
            message: `Подключение к ${probe.targetAddress}:${probe.targetPort} подтверждено за ${probe.latencyMs} мс${probe.httpStatusCode ? ` (HTTP ${probe.httpStatusCode})` : ''}.`,
          }
        : {
            code: 'CLIENT_PROBE_FAILED',
            severity: 'error' as const,
            title: `Клиентская проверка не пройдена (${probe.engine})`,
            message:
              probe.error || 'Не удалось установить клиентское соединение.',
          },
    ];
    const hasError = nextChecks.some((c) => c.severity === 'error');
    const hasWarn = nextChecks.some((c) => c.severity === 'warning');
    profile.lastCheckResult = {
      compatible: !hasError,
      status: hasError ? 'failed' : hasWarn ? 'warning' : 'passed',
      checks: nextChecks,
    };
    profile.lastCheckStatus = profile.lastCheckResult.status;
    profile.lastCheckedAt = checkedAt;
    await this.profileRepo.save(profile);

    return {
      id: profile.id,
      source: exported.source,
      deployed: true,
      probe,
      checkedAt: checkedAt.toISOString(),
    };
  }

  async rollback(id: string): Promise<ConnectionProfile> {
    const profile = await this.findOne(id);
    const snapshot = profile.previousSnapshot;
    if (!snapshot) {
      throw new BadRequestException(
        'У профиля нет предыдущей ревизии (previousSnapshot) для отката',
      );
    }

    const currentSnapshot = {
      revision: profile.activeRevision,
      savedAt: new Date().toISOString(),
      name: profile.name,
      kind: profile.kind,
      nodeId: profile.nodeId,
      port: profile.port,
      sni: profile.sni,
      rotationPolicy: profile.rotationPolicy,
      spec: profile.spec,
    };

    profile.name = snapshot.name;
    if (snapshot.nodeId !== undefined) {
      profile.nodeId = snapshot.nodeId ?? null;
    }
    profile.port = snapshot.port ?? null;
    profile.sni = snapshot.sni ?? null;
    profile.rotationPolicy = snapshot.rotationPolicy;
    profile.spec = normalizeManagedProfileSettings(profile.kind, snapshot.spec);
    profile.previousSnapshot = currentSnapshot;
    profile.activeRevision += 1;

    const node = profile.nodeId
      ? await this.loadNodeMeta(profile.nodeId)
      : null;
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

  private async queryLiveNodeState(node: Node): Promise<{
    occupiedPorts?: number[];
    nodeResources?: {
      cpuPercent?: number;
      memPercent?: number;
      diskPercent?: number;
      xrayState?: string;
    };
  }> {
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
      let nodeResources:
        | {
            cpuPercent?: number;
            memPercent?: number;
            diskPercent?: number;
            xrayState?: string;
          }
        | undefined;
      if (status.success) {
        if (status.version) node.version = status.version;
        if (status.xrayVersion) node.xrayVersion = status.xrayVersion;
        nodeResources = {
          cpuPercent: status.cpuPercent,
          memPercent: status.memPercent,
          diskPercent: status.diskPercent,
          xrayState: status.xrayState,
        };
      }
      const occupiedPorts = panelInbounds
        .map((item) => item.port)
        .filter((port): port is number => Number.isInteger(port));
      return { occupiedPorts, nodeResources };
    } catch {
      return {};
    }
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

  private matchActiveInbound(
    profile: ConnectionProfile,
    activeInbounds: Inbound[],
  ): Inbound | null {
    if (profile.configId) {
      const byConfig = activeInbounds.find(
        (item) => item.configId === profile.configId,
      );
      if (byConfig) return byConfig;
    }
    const byProfileId = activeInbounds.find(
      (item) => item.profileId === profile.id,
    );
    if (byProfileId) return byProfileId;

    if (profile.nodeId) {
      if (profile.port) {
        const byNodeKindPort = activeInbounds.find(
          (item) =>
            item.nodeId === profile.nodeId &&
            item.profileKind === profile.kind &&
            item.port === profile.port,
        );
        if (byNodeKindPort) return byNodeKindPort;
      }
      const byNodeKind = activeInbounds.find(
        (item) =>
          item.nodeId === profile.nodeId && item.profileKind === profile.kind,
      );
      if (byNodeKind) return byNodeKind;
    }
    return null;
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
    const byProfileId = await this.inboundRepo.findOne({
      where: { profileId: profile.id, status: InboundStatus.Active },
      order: { createdAt: 'DESC' },
    });
    if (byProfileId) return byProfileId;

    if (profile.nodeId) {
      if (profile.port) {
        const byNodeKindPort = await this.inboundRepo.findOne({
          where: {
            nodeId: profile.nodeId,
            profileKind: profile.kind,
            port: profile.port,
            status: InboundStatus.Active,
          },
          order: { createdAt: 'DESC' },
        });
        if (byNodeKindPort) return byNodeKindPort;
      }
      return this.inboundRepo.findOne({
        where: {
          nodeId: profile.nodeId,
          profileKind: profile.kind,
          status: InboundStatus.Active,
        },
        order: { createdAt: 'DESC' },
      });
    }
    return null;
  }

  private resolveExpectedNodeIps(
    node: Node | null,
    domainToResolve: string,
  ): string[] | undefined {
    if (!node) return undefined;
    const normalizedDomain = domainToResolve.trim().toLowerCase();
    const nodeHosts = new Set<string>();
    if (node.domain?.trim()) nodeHosts.add(node.domain.trim().toLowerCase());
    if (node.host?.trim()) nodeHosts.add(node.host.trim().toLowerCase());
    if (node.url) {
      try {
        nodeHosts.add(new URL(node.url).hostname.toLowerCase());
      } catch {
        // Ignore malformed URL
      }
    }
    // If the checked domain IS the node's own panel hostname/domain,
    // do not emit a false IP mismatch against a stale cached node.ip.
    if (nodeHosts.has(normalizedDomain)) {
      return undefined;
    }
    return node.ip ? [node.ip] : undefined;
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
