import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ConnectionProfilesService } from 'src/profiles/connection-profiles.service';
import { ConnectionProfile } from 'src/profiles/entities/connection-profile.entity';
import { Node } from 'src/nodes/entities/node.entity';
import { Inbound } from 'src/inbounds/entities/inbound.entity';
import { XuiService } from 'src/xui/xui.service';
import { TlsSiteProbeService } from 'src/profiles/tls-site-probe.service';
import { ClientProbeService } from 'src/profiles/client-probe.service';
import type { ManagedProfileKind } from 'src/profiles/connection-profile.types';

describe('ConnectionProfiles full lifecycle integration (create -> update -> check -> probe -> rollback -> remove)', () => {
  const store = new Map<string, ConnectionProfile>();
  let idSeq = 0;

  const profileRepo = {
    find: jest.fn(() => Promise.resolve([...store.values()])),
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(store.get(where.id) ?? null),
    ),
    create: jest.fn((value: Partial<ConnectionProfile>) => {
      idSeq += 1;
      return {
        id: `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`,
        ...value,
      };
    }),
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
    findOne: jest.fn(),
  };

  const xuiService = {
    checkNodeConnection: jest.fn(),
    listRoutingInbounds: jest.fn(),
  };

  const tlsSiteProbe = {
    probeDomainAndTls: jest.fn(),
  };

  const clientProbe = {
    probeClientProfile: jest.fn(),
  };

  const service = new ConnectionProfilesService(
    profileRepo as unknown as Repository<ConnectionProfile>,
    nodeRepo as unknown as Repository<Node>,
    inboundRepo as unknown as Repository<Inbound>,
    xuiService as unknown as XuiService,
    tlsSiteProbe as unknown as TlsSiteProbeService,
    clientProbe as unknown as ClientProbeService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    const healthyNode = {
      id: 'node-eu-1',
      name: 'EU-Main',
      ip: '203.0.113.10',
      domain: 'eu.example.com',
      version: '3.8.5',
      xrayVersion: '26.7.11',
      webCertificateFile: '/etc/ssl/eu/fullchain.pem',
      webKeyFile: '/etc/ssl/eu/privkey.pem',
    };
    nodeRepo.findOne.mockResolvedValue(healthyNode);
    nodeRepo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(healthyNode),
    });
    inboundRepo.findOne.mockResolvedValue(null);
    xuiService.checkNodeConnection.mockResolvedValue({
      success: true,
      version: '3.8.5',
      xrayVersion: '26.7.11',
      xrayState: 'running',
      cpuPercent: 18,
      memPercent: 42,
      diskPercent: 31,
    });
    xuiService.listRoutingInbounds.mockResolvedValue([{ id: 1, port: 9000 }]);
    tlsSiteProbe.probeDomainAndTls.mockResolvedValue({
      domain: 'portal.example.com',
      port: 443,
      reachable: true,
      dnsResolvedIps: ['203.0.113.10'],
      dnsMatchesNodeIp: true,
      tlsProtocol: 'TLSv1.3',
      alpnProtocol: 'h2',
      httpStatusCode: 200,
      certificate: {
        subjectCN: 'portal.example.com',
        issuer: "Let's Encrypt",
        daysRemaining: 80,
        authorized: true,
        hostnameMatches: true,
      },
      durationMs: 24,
    });
    clientProbe.probeClientProfile.mockResolvedValue({
      success: true,
      engine: 'xray-core',
      targetAddress: 'eu.example.com',
      targetPort: 443,
      protocol: 'vless',
      httpStatusCode: 204,
      latencyMs: 85,
    });
  });

  const cases: Array<{
    kind: ManagedProfileKind;
    initialName: string;
    updatedName: string;
    port: number;
    sni?: string;
    initialSpec: Record<string, unknown>;
    updatedSpec: Record<string, unknown>;
  }> = [
    {
      kind: 'xhttp-stable',
      initialName: 'XHTTP Auto',
      updatedName: 'XHTTP StreamOne',
      port: 443,
      sni: 'www.microsoft.com',
      initialSpec: { mode: 'auto', path: '/', fingerprint: 'chrome' },
      updatedSpec: {
        mode: 'stream-one',
        path: '/stream',
        fingerprint: 'firefox',
        xmux: { enabled: true, maxConcurrency: '16-32' },
      },
    },
    {
      kind: 'self-sni',
      initialName: 'SelfSNI Nginx',
      updatedName: 'SelfSNI Caddy',
      port: 443,
      sni: 'portal.example.com',
      initialSpec: {
        domain: 'portal.example.com',
        webServer: 'nginx',
        localHttpsPort: 8443,
        xver: 0,
      },
      updatedSpec: {
        domain: 'portal.example.com',
        webServer: 'caddy',
        localHttpsPort: 9443,
        xver: 0,
      },
    },
    {
      kind: 'https-fallback',
      initialName: 'Fallback Direct',
      updatedName: 'Fallback Behind Nginx',
      port: 20443,
      initialSpec: {
        domain: 'portal.example.com',
        path: '/api/v2/stream',
        mode: 'auto',
        reverseProxy: 'none',
      },
      updatedSpec: {
        domain: 'portal.example.com',
        path: '/api/v3/fallback',
        mode: 'packet-up',
        reverseProxy: 'nginx',
        publicPort: 443,
      },
    },
  ];

  it.each(cases)(
    'executes create -> update -> check -> probe -> rollback -> remove for $kind',
    async ({
      kind,
      initialName,
      updatedName,
      port,
      sni,
      initialSpec,
      updatedSpec,
    }) => {
      // 1. Create
      const created = await service.create({
        name: initialName,
        kind,
        nodeId: 'node-eu-1',
        port,
        sni,
        spec: initialSpec,
      });
      expect(created.activeRevision).toBe(1);
      expect(created.lastCheckStatus).toBe('passed');
      await expect(service.rollback(created.id)).rejects.toThrow(
        BadRequestException,
      );

      // 2. Update
      const updated = await service.update(created.id, {
        name: updatedName,
        spec: updatedSpec,
      });
      expect(updated.activeRevision).toBe(2);
      expect(updated.name).toBe(updatedName);
      expect(updated.previousSnapshot?.name).toBe(initialName);

      // 3. Live preflight check (node resources, ports, DNS/TLS)
      const check = await service.checkProfile(created.id);
      expect(check.report.compatible).toBe(true);

      // 4a. Probe before deployment reports clear not-deployed warning without running xray on placeholders
      const undeployedProbe = await service.probeProfile(created.id);
      expect(undeployedProbe.deployed).toBe(false);
      expect(undeployedProbe.probe.success).toBe(false);
      expect(undeployedProbe.probe.error).toContain('ещё не развёрнут');
      expect(clientProbe.probeClientProfile).not.toHaveBeenCalled();

      // 4b. Probe after deployment runs real client connection probe against active inbound
      inboundRepo.findOne.mockResolvedValueOnce({
        id: 500,
        profileId: created.id,
        profileKind: kind,
        port,
        link: `vless://aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee@eu.example.com:${port}#deployed`,
        clientProfileJson: JSON.stringify({
          kind,
          protocol: 'vless',
          address: 'eu.example.com',
          port,
          uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          remark: updatedName,
          network: kind === 'self-sni' ? 'tcp' : 'xhttp',
          security: kind === 'https-fallback' ? 'tls' : 'reality',
          sni: 'portal.example.com',
          fingerprint: 'chrome',
          ...(kind !== 'https-fallback'
            ? {
                publicKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
                shortId: 'a1b2c3d4',
              }
            : {}),
        }),
      });
      const probed = await service.probeProfile(created.id);
      expect(probed.deployed).toBe(true);
      expect(probed.probe.success).toBe(true);
      expect(probed.probe.engine).toBe('xray-core');
      expect(probed.probe.httpStatusCode).toBe(204);

      // 5. Rollback to revision 1 snapshot
      const rolledBack = await service.rollback(created.id);
      expect(rolledBack.activeRevision).toBe(3);
      expect(rolledBack.name).toBe(initialName);
      expect(rolledBack.previousSnapshot?.name).toBe(updatedName);

      // 6. Export never leaks private keys
      const exported = await service.exportProfile(created.id);
      expect(exported.exportBundle.vlessLink).toMatch(/^vless:\/\//);
      expect(JSON.stringify(exported.exportBundle)).not.toContain('privateKey');

      // 7. Remove
      const removed = await service.remove(created.id);
      expect(removed).toEqual({ success: true, id: created.id });
    },
  );

  it('blocks preflight check when node disk usage exceeds 90%', async () => {
    const created = await service.create({
      name: 'XHTTP Disk Test',
      kind: 'xhttp-stable',
      nodeId: 'node-eu-1',
      port: 443,
      sni: 'www.microsoft.com',
    });

    xuiService.checkNodeConnection.mockResolvedValueOnce({
      success: true,
      version: '3.8.5',
      xrayVersion: '26.7.11',
      xrayState: 'running',
      cpuPercent: 50,
      memPercent: 60,
      diskPercent: 96,
    });

    const check = await service.checkProfile(created.id);
    expect(check.status).toBe('failed');
    expect(check.report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'NODE_DISK_HIGH', severity: 'error' }),
      ]),
    );
  });
});
