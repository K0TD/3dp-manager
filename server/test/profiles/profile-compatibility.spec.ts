import {
  evaluateProfileCompatibility,
  normalizeManagedProfileSettings,
  validateManagedProfileSettings,
} from 'src/profiles/profile-compatibility';

describe('profile-compatibility', () => {
  it('blocks xhttp-stable on Xray versions older than 24.11.30', () => {
    const report = evaluateProfileCompatibility({
      kind: 'xhttp-stable',
      port: 443,
      sni: 'www.microsoft.com',
      node: { name: 'OldNode', xrayVersion: '24.10.31' },
    });

    expect(report.compatible).toBe(false);
    expect(report.status).toBe('failed');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'XRAY_VERSION_TOO_OLD',
          severity: 'error',
        }),
      ]),
    );
  });

  it('requires Xray >= 25.1.30 for stream-one or XMUX and passes on 25.1.30+', () => {
    const blocked = evaluateProfileCompatibility({
      kind: 'xhttp-stable',
      port: 443,
      sni: 'www.microsoft.com',
      settings: {
        mode: 'stream-one',
        xmux: { enabled: true, maxConcurrency: '16-32' },
      },
      node: { name: 'Node24', xrayVersion: '24.11.30' },
    });
    expect(blocked.compatible).toBe(false);

    const passed = evaluateProfileCompatibility({
      kind: 'xhttp-stable',
      port: 443,
      sni: 'www.microsoft.com',
      settings: {
        mode: 'stream-one',
        xmux: { enabled: true, maxConcurrency: '16-32' },
      },
      node: { name: 'Node25', xrayVersion: '25.1.30' },
      occupiedPorts: [8443],
      dnsResolvedIps: ['203.0.113.10'],
    });
    expect(passed.compatible).toBe(true);
    expect(passed.status).toBe('passed');
  });

  it('rejects mutually exclusive XMUX maxConcurrency and maxConnections', () => {
    const errors = validateManagedProfileSettings('xhttp-stable', {
      mode: 'auto',
      xmux: {
        enabled: true,
        maxConcurrency: '16-32',
        maxConnections: '4-8',
      },
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('maxConcurrency и maxConnections'),
      ]),
    );
  });

  it('detects port conflicts and critical disk usage on the target node', () => {
    const report = evaluateProfileCompatibility({
      kind: 'xhttp-stable',
      port: 8443,
      sni: 'www.microsoft.com',
      node: { name: 'Node26', xrayVersion: '26.7.11' },
      occupiedPorts: [443, 8443],
      nodeResources: { diskPercent: 94, xrayState: 'running' },
    });

    expect(report.compatible).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PORT_OCCUPIED', severity: 'error' }),
        expect.objectContaining({ code: 'NODE_DISK_HIGH', severity: 'error' }),
      ]),
    );
  });

  it('enforces own domain for self-sni and warns on root path for https-fallback', () => {
    const selfSni = evaluateProfileCompatibility({
      kind: 'self-sni',
      sni: 'random',
      node: { name: 'Node26', xrayVersion: '26.7.11' },
    });
    expect(selfSni.compatible).toBe(false);
    expect(selfSni.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SELF_SNI_DOMAIN_REQUIRED',
          severity: 'error',
        }),
      ]),
    );

    const fallback = evaluateProfileCompatibility({
      kind: 'https-fallback',
      settings: { domain: 'vpn.example.com', path: '/' },
      node: { name: 'Node26', xrayVersion: '26.7.11' },
    });
    expect(fallback.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FALLBACK_ROOT_PATH_WARN',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('preserves future mihomo/RU->EU monitoring extension metadata without altering defaults', () => {
    const normalized = normalizeManagedProfileSettings('xhttp-stable', {
      monitoring: {
        probeEngine: 'mihomo',
        routingStrategy: 'ru-eu-relay',
        entryNodeId: 'ru-node',
        exitNodeId: 'eu-node',
      },
    });
    expect(normalized.mode).toBe('auto');
    expect(normalized.xmux).toBeUndefined();
    expect(normalized.monitoring).toEqual({
      probeEngine: 'mihomo',
      routingStrategy: 'ru-eu-relay',
      entryNodeId: 'ru-node',
      exitNodeId: 'eu-node',
    });
  });
});
