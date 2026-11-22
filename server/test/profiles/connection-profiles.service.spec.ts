import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ConnectionProfilesService } from 'src/profiles/connection-profiles.service';
import { ConnectionProfile } from 'src/profiles/entities/connection-profile.entity';
import { Node } from 'src/nodes/entities/node.entity';
import { Inbound } from 'src/inbounds/entities/inbound.entity';
import { XuiService } from 'src/xui/xui.service';
import { buildXhttpStableClientProfile } from 'src/profiles/profile-config.builder';

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
    findOne: jest.fn(),
  };

  const xuiService = {
    checkNodeConnection: jest.fn(),
    listRoutingInbounds: jest.fn(),
  };

  const service = new ConnectionProfilesService(
    profileRepo as unknown as Repository<ConnectionProfile>,
    nodeRepo as unknown as Repository<Node>,
    inboundRepo as unknown as Repository<Inbound>,
    xuiService as unknown as XuiService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    nodeRepo.findOne.mockResolvedValue({
      id: 'node-1',
      name: 'EU-1',
      domain: 'eu1.example.com',
      version: '3.8.5',
      xrayVersion: '26.7.11',
      webCertificateFile: '/cert.pem',
      webKeyFile: '/key.pem',
    });
    inboundRepo.findOne.mockResolvedValue(null);
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
});
