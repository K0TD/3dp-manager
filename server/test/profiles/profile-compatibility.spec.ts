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

  it('validates Self-SNI port collisions, Caddy xver warning, and live TLS 1.3 + certificate probe results', () => {
    const portCollisionErrors = validateManagedProfileSettings(
      'self-sni',
      {
        domain: 'site.example.com',
        webServer: 'nginx',
        localHttpsPort: 443,
      },
      { port: 443 },
    );
    expect(portCollisionErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('не может совпадать')]),
    );

    const healthySelfSni = evaluateProfileCompatibility({
      kind: 'self-sni',
      port: 443,
      settings: {
        domain: 'site.example.com',
        webServer: 'nginx',
        localHttpsPort: 8443,
        xver: 0,
      },
      node: { name: 'EU-Self', xrayVersion: '26.7.11' },
      occupiedPorts: [8080],
      tlsProbe: {
        domain: 'site.example.com',
        port: 443,
        reachable: true,
        dnsResolvedIps: ['203.0.113.20'],
        dnsMatchesNodeIp: true,
        tlsProtocol: 'TLSv1.3',
        alpnProtocol: 'h2',
        httpStatusCode: 200,
        httpServerHeader: 'nginx',
        certificate: {
          subjectCN: 'site.example.com',
          issuer: "Let's Encrypt",
          daysRemaining: 62,
          authorized: true,
          hostnameMatches: true,
        },
        durationMs: 42,
      },
    });
    expect(healthySelfSni.compatible).toBe(true);
    expect(healthySelfSni.status).toBe('passed');
    expect(healthySelfSni.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TLS_PROTOCOL_OK', severity: 'ok' }),
        expect.objectContaining({ code: 'TLS_CERT_OK', severity: 'ok' }),
        expect.objectContaining({ code: 'HTTPS_SITE_OK', severity: 'ok' }),
      ]),
    );

    const brokenTlsSelfSni = evaluateProfileCompatibility({
      kind: 'self-sni',
      port: 443,
      settings: {
        domain: 'site.example.com',
        webServer: 'caddy',
        localHttpsPort: 8443,
        xver: 1,
      },
      node: { name: 'EU-Self', xrayVersion: '26.7.11' },
      tlsProbe: {
        domain: 'site.example.com',
        port: 443,
        reachable: true,
        dnsResolvedIps: ['203.0.113.20'],
        tlsProtocol: 'TLSv1.2',
        alpnProtocol: 'http/1.1',
        certificate: {
          subjectCN: 'other.example.com',
          daysRemaining: -2,
          authorized: false,
          hostnameMatches: false,
        },
        durationMs: 55,
      },
    });
    expect(brokenTlsSelfSni.compatible).toBe(false);
    expect(brokenTlsSelfSni.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SELF_SNI_CADDY_XVER_WARN',
          severity: 'warning',
        }),
        expect.objectContaining({
          code: 'TLS_PROTOCOL_NOT_13',
          severity: 'error',
        }),
        expect.objectContaining({
          code: 'TLS_CERT_EXPIRED',
          severity: 'error',
        }),
      ]),
    );
  });

  it('validates HTTPS Fallback reverse-proxy port collisions, Xray version, and direct TLS readiness', () => {
    const portConflict = validateManagedProfileSettings(
      'https-fallback',
      {
        domain: 'fb.example.com',
        path: '/api/v2/stream',
        reverseProxy: 'nginx',
        publicPort: 443,
      },
      { port: 443 },
    );
    expect(portConflict).toEqual(
      expect.arrayContaining([expect.stringContaining('не может совпадать')]),
    );

    const readyFallback = evaluateProfileCompatibility({
      kind: 'https-fallback',
      port: 20443,
      settings: {
        domain: 'fb.example.com',
        path: '/api/v2/stream',
        mode: 'auto',
        reverseProxy: 'caddy',
        publicPort: 443,
      },
      node: {
        name: 'EU-Fallback',
        xrayVersion: '26.7.11',
        autoTlsCertificate: false,
      },
      occupiedPorts: [443, 8443],
    });
    expect(readyFallback.compatible).toBe(true);
    expect(readyFallback.status).toBe('passed');
    expect(readyFallback.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FALLBACK_DOMAIN_OK', severity: 'ok' }),
        expect.objectContaining({ code: 'XRAY_VERSION_OK', severity: 'ok' }),
        expect.objectContaining({ code: 'PORT_FREE', severity: 'ok' }),
      ]),
    );
  });

  it('treats ECONNREFUSED on an undeployed Self-SNI draft port as warning instead of blocking error', () => {
    const draftReport = evaluateProfileCompatibility({
      kind: 'self-sni',
      port: 24443,
      deployed: false,
      settings: {
        domain: 'mscone.samx.pw',
        webServer: 'nginx',
        localHttpsPort: 8443,
      },
      node: {
        name: 'mscone',
        xrayVersion: '26.7.11',
      },
      tlsProbe: {
        domain: 'mscone.samx.pw',
        port: 24443,
        reachable: false,
        dnsResolvedIps: ['31.59.126.121'],
        error:
          'Ошибка TLS-подключения к mscone.samx.pw:24443: connect ECONNREFUSED 31.59.126.121:24443',
        durationMs: 12,
      },
    });

    expect(draftReport.compatible).toBe(true);
    expect(draftReport.status).toBe('warning');
    expect(draftReport.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'TLS_PROBE_DRAFT_PORT_CLOSED',
          severity: 'warning',
        }),
      ]),
    );
  });
});
