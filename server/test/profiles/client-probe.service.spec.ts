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
});
