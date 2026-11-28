import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Domain } from 'src/domains/entities/domain.entity';
import { ConnectionProfilesService } from 'src/profiles/connection-profiles.service';
import { ConnectionProfile } from 'src/profiles/entities/connection-profile.entity';
import { Node } from 'src/nodes/entities/node.entity';
import { Inbound } from 'src/inbounds/entities/inbound.entity';
import { XuiService } from 'src/xui/xui.service';
import { TlsSiteProbeService } from 'src/profiles/tls-site-probe.service';
import { buildXhttpStableClientProfile } from 'src/profiles/profile-config.builder';
import type { ManagedProfileKind } from 'src/profiles/connection-profile.types';

const franceFlag = '%F0%9F%87%AB%F0%9F%87%B7';

describe('ConnectionProfilesService', () => {
  const store = new Map<string, ConnectionProfile>();
  const profileRepo = {
    find: jest.fn(() => Promise.resolve([...store.values()])),
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(store.get(where.id) ?? null),
    ),
    create: jest.fn((value: Partial<ConnectionProfile>) => ({
      id: '11111111-1111-4111-8111-111111111111',
      ...value,
    })),
    save: jest.fn((entity: ConnectionProfile) => {
      store.set(entity.id, entity);
      return Promise.resolve(entity);
    }),
    remove: jest.fn((entity: ConnectionProfile) => {
      store.delete(entity.id);
      return Promise.resolve(entity);
    }),
  };

  const nodeRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const inboundRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
  };

  const xuiService = {
    checkNodeConnection: jest.fn(),
    listRoutingInbounds: jest.fn(),
  };

  const tlsSiteProbe = {
    probeDomainAndTls: jest.fn(),
  };

  const domainRepo = { find: jest.fn() };

  const service = new ConnectionProfilesService(
    profileRepo as unknown as Repository<ConnectionProfile>,
    nodeRepo as unknown as Repository<Node>,
    inboundRepo as unknown as Repository<Inbound>,
    xuiService as unknown as XuiService,
    tlsSiteProbe as unknown as TlsSiteProbeService,
    undefined,
    domainRepo as unknown as Repository<Domain>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    nodeRepo.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'EU-1',
      domain: 'eu1.example.com',
      flag: '🇩🇪',
      version: '3.8.5',
      xrayVersion: '26.7.11',
      webCertificateFile: '/cert.pem',
      webKeyFile: '/key.pem',
    });
    inboundRepo.findOne.mockResolvedValue(null);
  });

  it.each<ManagedProfileKind>(['xhttp-stable', 'self-sni', 'https-fallback'])(
    'labels the %s preview and draft export with the chosen or inherited flag',
    async (kind) => {
      const profile = await service.create({
        kind,
        name: 'Европа',
        flag: franceFlag,
        nodeId: 'node-1',
        sni: 'portal.example.com',
      });
      const exported = await service.exportProfile(profile.id);
      expect(exported.source).toBe('preview');
      expect(decodeURIComponent(new URL(exported.exportBundle.vlessLink).hash)).toBe('#🇫🇷 Европа');

      const preview = await service.preview({
        kind,
        name: 'Европа',
        nodeId: 'node-1',
        sni: 'portal.example.com',
      });
      expect(decodeURIComponent(new URL(preview.clientPreview.vlessLink).hash)).toBe('#🇩🇪 Европа');
    },
  );

  it('retains a flag on partial updates and restores it on rollback after clearing it', async () => {
    const { id } = await service.create({
      name: 'Main XHTTP',
      kind: 'xhttp-stable',
      sni: 'www.microsoft.com',
      flag: franceFlag,
    });
    expect(await service.update(id, { name: 'Updated' })).toMatchObject({ flag: franceFlag });
    expect(await service.update(id, { flag: null })).toMatchObject({
      flag: null,
      previousSnapshot: { flag: franceFlag },
    });
    expect(await service.rollback(id)).toMatchObject({ flag: franceFlag });
  });

  it('reports only linked listeners and counts distinct subscriptions', async () => {
    store.set('profile-a', {
      id: 'profile-a', kind: 'self-sni', nodeId: 'node-1', port: 24443,
    } as ConnectionProfile);
    store.set('profile-b', {
      id: 'profile-b', kind: 'self-sni', nodeId: 'node-1', port: 24443,
    } as ConnectionProfile);
    inboundRepo.find.mockResolvedValueOnce([
      { id: 10, nodeId: 'node-1', profileKind: 'self-sni', port: 24443, subscriptionId: 'unlinked' },
      { id: 11, profileId: 'profile-a', port: 26658, subscriptionId: 'sub-a' },
      { id: 12, profileId: 'profile-a', port: 26659, subscriptionId: 'sub-a' },
      { id: 13, profileId: 'profile-a', port: 26658, subscriptionId: 'sub-b' },
    ]);

    expect(await service.findAll()).toMatchObject([
      {
        id: 'profile-a', deployed: true, activeSubscriptionCount: 2,
        activePorts: [26658, 26659], activeInbound: { id: 11 },
      },
      {
        id: 'profile-b', deployed: false, activeSubscriptionCount: 0,
        activePorts: [], activeInbound: null,
      },
    ]);
  });

  it('previews random XHTTP Stable with an enabled catalog domain and its settings', async () => {
    domainRepo.find.mockResolvedValue([{ name: 'speedtest.net' }, { name: 'www.samsung.com' }]);
    const preview = await service.preview({
      kind: 'xhttp-stable', sni: 'random',
      settings: { path: '/legacy', host: 'old.example', fingerprint: 'firefox', spiderX: '/old' },
    });
    expect(domainRepo.find).toHaveBeenCalledWith({
      where: { isEnabled: true }, order: { name: 'ASC' },
    });
    expect(preview.clientPreview.clientConfig).toMatchObject({
      sni: 'www.samsung.com', fingerprint: 'chrome', spiderX: '/assets/',
      xhttp: { path: '/sec/assets/', host: 'www.samsung.com' },
    });
  });

  it('creates, updates with previousSnapshot/revision bump, previews, checks, exports, and removes xhttp-stable profile', async () => {
    const created = await service.create({
      name: 'Main XHTTP',
      kind: 'xhttp-stable',
      nodeId: 'node-1',
      port: 443,
      sni: 'www.microsoft.com',
      spec: { mode: 'auto', fingerprint: 'chrome' },
    });

    expect(created.activeRevision).toBe(1);
    expect(created.lastCheckStatus).toBe('passed');
    expect(created.previousSnapshot).toBeNull();

    // Update bumps revision and stores redacted snapshot
    const updated = await service.update(created.id, {
      name: 'Main XHTTP Stream',
      spec: {
        mode: 'stream-one',
        xmux: { enabled: true, maxConcurrency: '16-32' },
      },
    });
    expect(updated.activeRevision).toBe(2);
    expect(updated.previousSnapshot).toMatchObject({
      revision: 1,
      name: 'Main XHTTP',
    });
    expect(updated.previousSnapshot?.spec).toMatchObject({ mode: 'auto' });

    // Preview separates server (redacted) and client (VLESS + Xray JSON)
    const preview = await service.preview({
      kind: 'xhttp-stable',
      name: 'Preview',
      nodeId: 'node-1',
      port: 443,
      sni: 'www.microsoft.com',
      settings: updated.spec,
    });
    expect(preview.compatibility.compatible).toBe(true);
    expect(JSON.stringify(preview.serverPreview)).toContain(
      '<server-only:redacted>',
    );
    expect(preview.clientPreview.vlessLink).toContain('mode=stream-one');
    expect(JSON.stringify(preview.clientPreview.xrayClientJson)).toContain(
      'maxConcurrency',
    );

    // Live check detects occupied port in 3x-ui
    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'node-1',
        name: 'EU-1',
        version: '3.8.5',
        xrayVersion: '26.7.11',
      }),
    });
    xuiService.checkNodeConnection.mockResolvedValue({
      success: true,
      version: '3.8.5',
      xrayVersion: '26.7.11',
      xrayState: 'running',
    });
    xuiService.listRoutingInbounds.mockResolvedValue([{ id: 7, port: 443 }]);

    const checked = await service.checkProfile(created.id);
    expect(checked.status).toBe('failed');
    expect(checked.report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PORT_OCCUPIED', severity: 'error' }),
      ]),
    );

    // Export uses active deployed inbound when present
    const clientProfile = buildXhttpStableClientProfile({
      address: 'eu1.example.com',
      port: 443,
      uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      remark: 'Main XHTTP Stream',
      sni: 'www.microsoft.com',
      publicKey: 'LIVE_PUBLIC_KEY',
      shortId: 'abcd1234',
      settings: updated.spec,
    });
    inboundRepo.findOne.mockResolvedValueOnce({
      id: 42,
      profileId: created.id,
      link: 'vless://aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee@eu1.example.com:443?type=xhttp#Main',
      clientProfileJson: JSON.stringify(clientProfile),
    });

    const exported = await service.exportProfile(created.id);
    expect(exported.source).toBe('active_inbound');
    expect(exported.exportBundle.clientConfig.publicKey).toBe(
      'LIVE_PUBLIC_KEY',
    );
    expect(JSON.stringify(exported.exportBundle)).not.toContain('privateKey');

    const removed = await service.remove(created.id);
    expect(removed).toEqual({ success: true, id: created.id });
    expect(await service.findAll()).toEqual([]);
  });

  it('rejects incompatible XMUX configuration on create', async () => {
    await expect(
      service.create({
        name: 'Invalid XMUX',
        kind: 'xhttp-stable',
        spec: {
          mode: 'auto',
          xmux: {
            enabled: true,
            maxConcurrency: '16-32',
            maxConnections: '4-8',
          },
        },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates, previews with Nginx config, runs live TLS/cert check, and exports self-sni profile', async () => {
    const created = await service.create({
      name: 'Self SNI Portal',
      kind: 'self-sni',
      nodeId: 'node-1',
      port: 443,
      sni: 'portal.example.com',
      spec: {
        domain: 'portal.example.com',
        webServer: 'nginx',
        localHttpsPort: 8443,
        fingerprint: 'chrome',
        xver: 0,
      },
    });

    expect(created.activeRevision).toBe(1);
    expect(created.lastCheckStatus).toBe('passed');

    tlsSiteProbe.probeDomainAndTls.mockResolvedValue({
      domain: 'portal.example.com',
      port: 443,
      reachable: true,
      dnsResolvedIps: ['203.0.113.55'],
      dnsMatchesNodeIp: true,
      tlsProtocol: 'TLSv1.3',
      alpnProtocol: 'h2',
      httpStatusCode: 200,
      certificate: {
        subjectCN: 'portal.example.com',
        issuer: "Let's Encrypt",
        daysRemaining: 75,
        authorized: true,
        hostnameMatches: true,
      },
      durationMs: 38,
    });

    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'node-1',
        name: 'EU-1',
        ip: '203.0.113.55',
        version: '3.8.5',
        xrayVersion: '26.7.11',
      }),
    });
    xuiService.checkNodeConnection.mockResolvedValue({
      success: true,
      version: '3.8.5',
      xrayVersion: '26.7.11',
      xrayState: 'running',
    });
    xuiService.listRoutingInbounds.mockResolvedValue([{ id: 9, port: 8080 }]);

    const preview = await service.preview({
      kind: 'self-sni',
      name: 'Self SNI Portal',
      nodeId: 'node-1',
      port: 443,
      settings: created.spec,
      liveCheck: true,
    });

    expect(preview.compatibility.compatible).toBe(true);
    expect(preview.webServerConfig?.engine).toBe('nginx');
    expect(preview.webServerConfig?.config).toContain(
      'listen 127.0.0.1:8443 ssl http2;',
    );
    expect(preview.clientPreview.vlessLink).toContain('flow=xtls-rprx-vision');
    expect(JSON.stringify(preview.serverPreview)).toContain(
      '<server-only:redacted>',
    );
    expect(preview.tlsProbe?.tlsProtocol).toBe('TLSv1.3');

    const checked = await service.checkProfile(created.id);
    expect(checked.status).toBe('passed');
    expect(checked.tlsProbe?.certificate?.authorized).toBe(true);
  });

  it('creates, previews with Caddy reverse proxy, and exports https-fallback profile', async () => {
    const created = await service.create({
      name: 'HTTPS Fallback Proxy',
      kind: 'https-fallback',
      nodeId: 'node-1',
      port: 20443,
      spec: {
        domain: 'fb.example.com',
        path: '/api/v2/stream',
        mode: 'auto',
        reverseProxy: 'caddy',
        publicPort: 443,
      },
    });

    expect(created.activeRevision).toBe(1);
    expect(created.lastCheckStatus).toBe('passed');

    const preview = await service.preview({
      kind: 'https-fallback',
      name: 'HTTPS Fallback Proxy',
      nodeId: 'node-1',
      port: 20443,
      settings: created.spec,
    });

    expect(preview.compatibility.compatible).toBe(true);
    expect(preview.serverPreview.listen).toBe('127.0.0.1');
    expect(preview.clientPreview.vlessLink).toContain(':443?');
    expect(preview.clientPreview.vlessLink).toContain('security=tls');
    expect(preview.clientPreview.vlessLink).toContain(
      'path=%2Fapi%2Fv2%2Fstream',
    );
    expect(preview.webServerConfig?.engine).toBe('caddy');
    expect(preview.webServerConfig?.config).toContain('flush_interval -1');
    expect(preview.webServerConfig?.config).toContain(
      'reverse_proxy 127.0.0.1:20443',
    );
  });
});
