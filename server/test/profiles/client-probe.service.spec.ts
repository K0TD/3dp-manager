import { EventEmitter } from 'node:events';
import childProcess from 'child_process';
import * as net from 'net';
import { ClientProbeService } from 'src/profiles/client-probe.service';
import type { SeparatedClientProfile } from 'src/profiles/connection-profile.types';

describe('ClientProbeService', () => {
  const service = new ClientProbeService();

  const sampleProfile: SeparatedClientProfile = {
    kind: 'xhttp-stable',
    protocol: 'vless',
    address: '127.0.0.1',
    port: 443,
    uuid: '11111111-1111-4111-8111-111111111111',
    remark: 'CanaryTest',
    network: 'xhttp',
    security: 'reality',
    sni: 'www.microsoft.com',
    fingerprint: 'chrome',
    publicKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
    shortId: 'a1b2c3d4',
    spiderX: '/',
    xhttp: {
      path: '/',
      host: 'www.microsoft.com',
      mode: 'stream-one',
      extra: { xmux: { maxConcurrency: '16-32' } },
    },
  };

  it('builds isolated ephemeral Xray client JSON config routing strictly via candidate proxy outbound', () => {
    const config = service.buildEphemeralProbeConfig(sampleProfile, 19876);

    expect(config.inbounds).toHaveLength(1);
    expect(config.inbounds[0]).toMatchObject({
      tag: 'socks-probe',
      listen: '127.0.0.1',
      port: 19876,
      protocol: 'socks',
    });
    expect(config.outbounds).toHaveLength(1);
    expect(config.outbounds[0].tag).toBe('proxy');
    expect(JSON.stringify(config)).not.toContain('"freedom"');
    expect(JSON.stringify(config)).not.toContain('privateKey');
    expect(JSON.stringify(config)).toContain('"maxConcurrency":"16-32"');
  });

  it('succeeds in tcp-tls-fallback against a reachable local TCP listener and fails against an unreachable port', async () => {
    const server = net.createServer((socket) => {
      socket.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    const addr = server.address();
    const listeningPort = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      const ok = await service.probeClientProfile(
        { ...sampleProfile, port: listeningPort },
        { forceFallback: true, timeoutMs: 2000 },
      );
      expect(ok.success).toBe(true);
      expect(ok.engine).toBe('tcp-tls-fallback');
      expect(ok.targetPort).toBe(listeningPort);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Now the closed port must fail cleanly
    const failed = await service.probeClientProfile(
      { ...sampleProfile, port: listeningPort },
      { forceFallback: true, timeoutMs: 1500 },
    );
    expect(failed.success).toBe(false);
    expect(failed.engine).toBe('tcp-tls-fallback');
    expect(failed.error).toBeTruthy();
  });

  it('tries another HTTP endpoint after a 503 and reports both attempts', async () => {
    const probe = new ClientProbeService();
    const worker = probe as unknown as {
      waitForRemoteTcpPort: () => Promise<{ reachable: boolean }>;
      allocateLocalPort: () => Promise<number>;
      waitForLocalPort: () => Promise<boolean>;
      httpGetThroughSocks5: () => Promise<number>;
      probeViaXrayCore: (
        profile: SeparatedClientProfile,
        binary: string,
        context: {
          timeoutMs: number;
          waitForPortMs: number;
          startedAt: number;
          probeTargets: Array<{
            host: string;
            port: number;
            path: string;
            url: string;
          }>;
        },
      ) => ReturnType<ClientProbeService['probeClientProfile']>;
    };
    const child = Object.assign(new EventEmitter(), { killed: true });
    const spawn = jest
      .spyOn(childProcess, 'spawn')
      .mockReturnValue(
        child as unknown as ReturnType<typeof childProcess.spawn>,
      );
    jest
      .spyOn(worker, 'waitForRemoteTcpPort')
      .mockResolvedValue({ reachable: true });
    jest.spyOn(worker, 'allocateLocalPort').mockResolvedValue(12345);
    jest.spyOn(worker, 'waitForLocalPort').mockResolvedValue(true);
    jest
      .spyOn(worker, 'httpGetThroughSocks5')
      .mockResolvedValueOnce(503)
      .mockResolvedValueOnce(204);
    const hosts = ['first.example.com', 'second.example.com'];

    try {
      const result = await worker.probeViaXrayCore(sampleProfile, 'xray', {
        timeoutMs: 3000,
        startedAt: Date.now(),
        waitForPortMs: 0,
        probeTargets: hosts.map((host) => ({
          host,
          port: 80,
          path: '/',
          url: `http://${host}/`,
        })),
      });
      expect(result).toMatchObject({
        success: true,
        httpStatusCode: 204,
        tcpReachable: true,
        tcpDurationMs: expect.any(Number),
        xrayStartupMs: expect.any(Number),
        attempts: [
          {
            host: hosts[0],
            httpStatusCode: 503,
            stage: 'http',
            failure: 'HTTP_STATUS',
          },
          { host: hosts[1], httpStatusCode: 204, stage: 'http' },
        ],
      });
    } finally {
      spawn.mockRestore();
    }
  });

  it('rejects malformed profile address or port immediately', async () => {
    const res = await service.probeClientProfile({
      ...sampleProfile,
      address: '',
      port: 0,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Некорректный адрес или порт');
  });

  it('rejects undeployed preview REALITY placeholder publicKey cleanly without spawning broken xray', async () => {
    const res = await service.probeClientProfile({
      ...sampleProfile,
      publicKey: '<generated-reality-public-key>',
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('не развёрнут на ноде');
  });

  it('extracts meaningful xray warning diagnostics while filtering startup banners and secrets', () => {
    const sampleOutput = [
      'Xray 25.3.6 (Xray, Penetrates Everything.)',
      'A unified platform for anti-censorship.',
      'Reading config: /tmp/3dp-probe.json',
      '2026/11/22 19:00:00 [Warning] core: Xray 25.3.6 started',
      '2026/11/22 19:00:01 [Info] proxy/vless/outbound: failed to dial mscone.samx.pw:443 > tls: handshake failure privateKey=secret123',
    ].join('\n');

    const diag = service.extractXrayDiagnostic(sampleOutput);
    expect(diag).toContain('tls: handshake failure');
    expect(diag).not.toContain('secret123');
    expect(diag).not.toContain('A unified platform');
    expect(diag).not.toContain('Xray 25.3.6 started');

    expect(
      service.extractXrayDiagnostic(
        [
          '2026/11/22 19:00:00 [Warning] core: Xray 25.3.6 started',
          '2026/11/22 19:00:00 [Info] [1] proxy/socks: Connection closed immediately, likely health check connection',
        ].join('\n'),
      ),
    ).toBe('');
  });

  it('reports ECONNREFUSED cleanly via waitForRemoteTcpPort when target port is closed', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    const addr = server.address();
    const closedPort = typeof addr === 'object' && addr ? addr.port : 0;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const res = await service.waitForRemoteTcpPort(
      '127.0.0.1',
      closedPort,
      0,
      1000,
    );
    expect(res.reachable).toBe(false);
    expect(res.reason).toContain('ECONNREFUSED');
  });
});
