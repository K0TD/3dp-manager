import { InboundBuilderService } from 'src/inbounds/inbound-builder.service';
import {
  resolveSniProfile,
  SNI_PROFILE_RULES,
} from 'src/inbounds/sni-profiles';
import type { XuiInboundRaw } from 'src/inbounds/xui-inbound.types';
import {
  buildNodeCapabilities,
  supportsInboundType,
} from 'src/nodes/node-capabilities';
import { classifyXraySignal } from 'src/profiles/client-probe.service';
import {
  evaluateProfileCompatibility,
  evaluateRealityFingerprintCheck,
  REALITY_SAFE_FINGERPRINTS,
} from 'src/profiles/profile-compatibility';
import {
  buildHttpsFallbackExportBundle,
  buildSelfSniExportBundle,
  buildXhttpStableExportBundle,
  parseVlessLinkToXrayOutbound,
} from 'src/profiles/profile-config.builder';
import { hasSeparateClientApi } from 'src/xui/xui.service';

const SAFE_FINGERPRINTS = ['chrome', 'firefox', 'safari'];

type JsonMap = Record<string, unknown>;

const parseJson = (raw: string): JsonMap => JSON.parse(raw) as JsonMap;
const asMap = (value: unknown): JsonMap | undefined =>
  value && typeof value === 'object' ? (value as JsonMap) : undefined;

describe('Xray 26.7.11-26.11.9 and 3x-ui 3.8-3.11.0 compatibility', () => {
  const builder = new InboundBuilderService();
  const baseReality = {
    port: 443,
    uuid: '11111111-1111-4111-8111-111111111111',
    sni: 'swdist.apple.com',
    privateKey: 'priv-key-test',
    publicKey: 'pub-key-test',
  };
  const baseTls = {
    port: 8443,
    uuid: '11111111-1111-4111-8111-111111111111',
    serverName: 'tls.example.com',
    certificateFile: '/etc/ssl/cert.pem',
    keyFile: '/etc/ssl/key.pem',
  };

  describe('SNI catalog fingerprints for REALITY', () => {
    it('uses only chrome, firefox, or safari across all SNI profile rules', () => {
      expect(SNI_PROFILE_RULES.length).toBeGreaterThan(0);
      for (const rule of SNI_PROFILE_RULES) {
        expect(SAFE_FINGERPRINTS).toContain(rule.profile.fingerprint);
      }
    });

    it('maps Microsoft and Samsung domains to chrome instead of edge/android', () => {
      expect(resolveSniProfile('c.s-microsoft.com').fingerprint).toBe('chrome');
      expect(resolveSniProfile('portal.azure.com').fingerprint).toBe('chrome');
      expect(resolveSniProfile('www.samsung.com').fingerprint).toBe('chrome');
    });
  });

  describe('InboundBuilderService Xray 26 stream & credential invariants', () => {
    it('omits maxConcurrency from vless-xhttp-get xmux when maxConnections is set', () => {
      const inbound = builder.buildVlessXhttpGet({
        port: 8080,
        uuid: baseReality.uuid,
      });
      const stream = parseJson(inbound.streamSettings);
      const xhttpSettings = asMap(stream.xhttpSettings);
      const xmux = asMap(xhttpSettings?.xmux);
      expect(xmux?.maxConnections).toBe('4-8');
      expect(xmux?.maxConcurrency).toBeUndefined();
    });

    it('uses wsSettings.host (not deprecated headers.Host) in buildVlessTlsWs', () => {
      const inbound = builder.buildVlessTlsWs(baseTls);
      const stream = parseJson(inbound.streamSettings);
      const wsSettings = asMap(stream.wsSettings);
      expect(wsSettings?.host).toBe('tls.example.com');
      expect(wsSettings?.headers).toBeUndefined();
    });

    it('sets VMess client security to auto and encodes scy=auto in vmess:// links', () => {
      const inbound = builder.buildVmessTcp({
        port: 10086,
        uuid: baseReality.uuid,
      });
      const settings = parseJson(inbound.settings);
      const clients = settings.clients as Array<JsonMap>;
      expect(clients[0]?.security).toBe('auto');

      const link = builder.buildInboundLink(
        inbound as unknown as XuiInboundRaw,
        'node.example.com',
        baseReality.uuid,
        '',
      );
      expect(link.startsWith('vmess://')).toBe(true);
      const payload = parseJson(
        Buffer.from(link.slice('vmess://'.length), 'base64').toString('utf8'),
      );
      expect(payload.scy).toBe('auto');
    });

    it('normalizes legacy none/zero VMess security to auto in buildInboundLink', () => {
      const legacyInbound: XuiInboundRaw = {
        port: 10087,
        protocol: 'vmess',
        remark: 'vmess-legacy',
        settings: JSON.stringify({
          clients: [{ id: baseReality.uuid, alterId: 0, security: 'none' }],
        }),
        streamSettings: JSON.stringify({ network: 'tcp', security: 'none' }),
      };

      const link = builder.buildInboundLink(
        legacyInbound,
        'node.example.com',
        baseReality.uuid,
        '',
      );
      const payload = parseJson(
        Buffer.from(link.slice('vmess://'.length), 'base64').toString('utf8'),
      );
      expect(payload.scy).toBe('auto');
    });

    it('preserves encryption, TLS alpn, REALITY pqv/publicKey, and gRPC multiMode in VLESS links', () => {
      const realityGrpcInbound: XuiInboundRaw = {
        port: 2053,
        protocol: 'vless',
        remark: 'vless-grpc-reality',
        settings: JSON.stringify({
          clients: [{ id: baseReality.uuid }],
          encryption: 'mlkem768x25519plus.native.0rtt.testkey',
        }),
        streamSettings: JSON.stringify({
          network: 'grpc',
          security: 'reality',
          grpcSettings: {
            serviceName: 'grpcSvc',
            authority: 'auth.example',
            multiMode: true,
          },
          realitySettings: {
            serverNames: ['swdist.apple.com'],
            shortIds: ['abcd1234'],
            publicKey: 'fallback-pbk',
            mldsa65Verify: 'pqv-verify-token',
            settings: { fingerprint: 'chrome', spiderX: '/' },
          },
        }),
      };

      const realityUrl = new URL(
        builder.buildInboundLink(
          realityGrpcInbound,
          'edge.example.com',
          baseReality.uuid,
          '',
        ),
      );
      expect(realityUrl.searchParams.get('encryption')).toBe(
        'mlkem768x25519plus.native.0rtt.testkey',
      );
      expect(realityUrl.searchParams.get('pbk')).toBe('fallback-pbk');
      expect(realityUrl.searchParams.get('pqv')).toBe('pqv-verify-token');
      expect(realityUrl.searchParams.get('serviceName')).toBe('grpcSvc');
      expect(realityUrl.searchParams.get('authority')).toBe('auth.example');
      expect(realityUrl.searchParams.get('mode')).toBe('multi');

      const tlsInbound: XuiInboundRaw = {
        port: 2083,
        protocol: 'vless',
        remark: 'vless-tls-alpn',
        settings: JSON.stringify({
          clients: [{ id: baseReality.uuid }],
          encryption: 'none',
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
          security: 'tls',
          tlsSettings: {
            serverName: 'tls.example.com',
            alpn: ['h2', 'http/1.1'],
            settings: { fingerprint: 'chrome' },
          },
        }),
      };

      const tlsUrl = new URL(
        builder.buildInboundLink(
          tlsInbound,
          'edge.example.com',
          baseReality.uuid,
          '',
        ),
      );
      expect(tlsUrl.searchParams.get('alpn')).toBe('h2,http/1.1');
    });

    it('preserves REALITY pqv and publicKey fallback in Trojan links', () => {
      const trojanInbound: XuiInboundRaw = {
        port: 443,
        protocol: 'trojan',
        remark: 'trojan-reality',
        settings: JSON.stringify({
          clients: [{ password: 'secret-password' }],
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            serverNames: ['swdist.apple.com'],
            shortIds: ['1234'],
            publicKey: 'trojan-fallback-pbk',
            mldsa65Verify: 'trojan-pqv',
            settings: { fingerprint: 'safari' },
          },
        }),
      };

      const url = new URL(
        builder.buildInboundLink(
          trojanInbound,
          'edge.example.com',
          'secret-password',
          '',
        ),
      );
      expect(url.searchParams.get('pbk')).toBe('trojan-fallback-pbk');
      expect(url.searchParams.get('pqv')).toBe('trojan-pqv');
    });

    it('enforces Xray 26 invariants across all generated server inbound templates', () => {
      const inbounds = [
        builder.buildVlessRealityTcp(baseReality),
        builder.buildVlessRealityXhttp(baseReality),
        builder.buildVlessXhttpGet({ port: 8080, uuid: baseReality.uuid }),
        builder.buildVlessRealityGrpc(baseReality),
        builder.buildVlessWs({ port: 80, uuid: baseReality.uuid }),
        builder.buildVlessTlsTcp(baseTls),
        builder.buildVlessTlsWs(baseTls),
        builder.buildVlessTlsXhttp(baseTls),
        builder.buildVmessTcp({ port: 10086, uuid: baseReality.uuid }),
        builder.buildShadowsocksTcp({ port: 9000, uuid: baseReality.uuid }),
        builder.buildTrojanRealityTcp(baseReality),
        builder.buildHysteria2Inbound({
          port: 443,
          uuid: baseReality.uuid,
          serverName: 'hy2.example.com',
          certificateFile: '/etc/ssl/cert.pem',
          keyFile: '/etc/ssl/key.pem',
        }),
      ];

      for (const inbound of inbounds) {
        const serialized = `${inbound.settings}\n${inbound.streamSettings}`;
        expect(serialized).not.toContain('allowInsecure');

        const stream = parseJson(inbound.streamSettings);
        const xhttpSettings = asMap(stream.xhttpSettings);
        const xmux = asMap(xhttpSettings?.xmux);
        if (xmux) {
          expect(
            !(
              xmux.maxConcurrency !== undefined &&
              xmux.maxConnections !== undefined
            ),
          ).toBe(true);
        }
        if (stream.security === 'reality') {
          const finalmask = asMap(stream.finalmask);
          expect(finalmask?.tcp).toBeUndefined();
          const realitySettings = asMap(stream.realitySettings);
          const realityInner = asMap(realitySettings?.settings);
          const fp = realityInner?.fingerprint;
          if (typeof fp === 'string') {
            expect(SAFE_FINGERPRINTS).toContain(fp);
          }
        }
      }
    });
  });

  describe('Managed profiles & parseVlessLinkToXrayOutbound', () => {
    it('builds safe fingerprints and valid xmux across managed export bundles', () => {
      const xhttpBundle = buildXhttpStableExportBundle({
        address: '198.51.100.1',
        port: 443,
        uuid: baseReality.uuid,
        remark: 'xhttp-node',
        sni: 'www.samsung.com',
        publicKey: 'pub',
        shortId: 'abcd',
      });
      const selfSniBundle = buildSelfSniExportBundle({
        address: '198.51.100.1',
        port: 443,
        uuid: baseReality.uuid,
        remark: 'self-sni-node',
        domain: 'self.example.com',
        publicKey: 'pub',
        shortId: 'abcd',
      });
      const httpsBundle = buildHttpsFallbackExportBundle({
        address: '198.51.100.1',
        port: 443,
        uuid: baseReality.uuid,
        remark: 'https-node',
        domain: 'tls.example.com',
      });

      expect(SAFE_FINGERPRINTS).toContain(xhttpBundle.clientConfig.fingerprint);
      expect(SAFE_FINGERPRINTS).toContain(
        selfSniBundle.clientConfig.fingerprint,
      );
      expect(httpsBundle.clientConfig.security).toBe('tls');
      expect(httpsBundle.clientConfig.sni).toBe('tls.example.com');
    });

    it('parses pqv and grpc mode=multi in parseVlessLinkToXrayOutbound', () => {
      const link =
        'vless://11111111-1111-4111-8111-111111111111@203.0.113.1:443' +
        '?type=grpc&security=reality&sni=swdist.apple.com&fp=chrome&pbk=pub123' +
        '&pqv=mldsaVerify123&serviceName=svc&authority=auth.host&mode=multi#grpc-node';
      const outbound = parseVlessLinkToXrayOutbound(link, 'proxy');
      expect(outbound).not.toBeNull();
      const stream = outbound?.streamSettings as Record<string, JsonMap>;
      expect(stream.realitySettings.mldsa65Verify).toBe('mldsaVerify123');
      expect(stream.grpcSettings.serviceName).toBe('svc');
      expect(stream.grpcSettings.authority).toBe('auth.host');
      expect(stream.grpcSettings.multiMode).toBe(true);
    });
  });

  describe('Node capabilities for vless-xhttp-get on Xray 26.9.9+', () => {
    it('allows vless-xhttp-get on 26.7.11 and disables with warning on 26.9.9+', () => {
      expect(
        supportsInboundType('vless-xhttp-get', { xrayVersion: '26.7.11' }),
      ).toBe(true);
      expect(
        supportsInboundType('vless-xhttp-get', { xrayVersion: undefined }),
      ).toBe(true);
      expect(
        supportsInboundType('vless-xhttp-get', { xrayVersion: '26.9.9' }),
      ).toBe(false);
      expect(
        supportsInboundType('vless-xhttp-get', { xrayVersion: '26.11.9' }),
      ).toBe(false);

      const caps = buildNodeCapabilities({ xrayVersion: '26.11.9' });
      expect(caps.supportedInboundTypes).not.toContain('vless-xhttp-get');
      expect(caps.warnings.some((w) => w.includes('XHTTP GET'))).toBe(true);
    });
  });

  describe('REALITY fingerprint compatibility checks', () => {
    it('warns for edge/random on Xray 26.9.9+ and android/360 on any version', () => {
      expect(REALITY_SAFE_FINGERPRINTS).toEqual([
        'chrome',
        'firefox',
        'safari',
      ]);
      expect(evaluateRealityFingerprintCheck('chrome', '26.11.9')).toBeNull();
      expect(evaluateRealityFingerprintCheck('firefox', '26.11.9')).toBeNull();
      expect(evaluateRealityFingerprintCheck('safari', '26.11.9')).toBeNull();
      expect(evaluateRealityFingerprintCheck('edge', '26.7.11')).toBeNull();
      expect(evaluateRealityFingerprintCheck('edge', '26.9.9')?.code).toBe(
        'REALITY_FINGERPRINT_INCOMPATIBLE',
      );
      expect(evaluateRealityFingerprintCheck('android', '26.7.8')?.code).toBe(
        'REALITY_FINGERPRINT_INCOMPATIBLE',
      );

      const report = evaluateProfileCompatibility({
        kind: 'self-sni',
        port: 443,
        sni: 'cover.example.com',
        settings: { domain: 'cover.example.com', fingerprint: 'edge' },
        node: { name: 'node-26', xrayVersion: '26.11.9' },
      });
      expect(
        report.checks.some(
          (c) => c.code === 'REALITY_FINGERPRINT_INCOMPATIBLE',
        ),
      ).toBe(true);

      const okReport = evaluateProfileCompatibility({
        kind: 'self-sni',
        port: 443,
        sni: 'cover.example.com',
        settings: { domain: 'cover.example.com', fingerprint: 'chrome' },
        node: { name: 'node-26', xrayVersion: '26.11.9' },
      });
      expect(
        okReport.checks.some(
          (c) => c.code === 'REALITY_FINGERPRINT_INCOMPATIBLE',
        ),
      ).toBe(false);
    });
  });

  describe('Client probe signal classification', () => {
    it('classifies received real certificate and minClientVer as REALITY_REJECTED', () => {
      expect(
        classifyXraySignal('tls: received real certificate from fallback'),
      ).toBe('REALITY_REJECTED');
      expect(
        classifyXraySignal('reality handshake failed: minClientVer mismatch'),
      ).toBe('REALITY_REJECTED');
    });
  });

  describe('hasSeparateClientApi for 3x-ui 3.x and dev builds', () => {
    it('returns true for 3.x / dev builds and false for 2.x / undefined', () => {
      expect(hasSeparateClientApi({ version: '3.11.0' })).toBe(true);
      expect(hasSeparateClientApi({ version: '3.11.0-awg.3' })).toBe(true);
      expect(hasSeparateClientApi({ version: 'v3.11.0-awg.3' })).toBe(true);
      expect(hasSeparateClientApi({ version: 'v3.9.0' })).toBe(true);
      expect(hasSeparateClientApi({ version: '3x-ui v3.11.0' })).toBe(true);
      expect(hasSeparateClientApi({ version: 'dev+44a9dc7' })).toBe(true);
      expect(hasSeparateClientApi({ version: '2.9.4' })).toBe(false);
      expect(hasSeparateClientApi(undefined)).toBe(false);
    });
  });
});
