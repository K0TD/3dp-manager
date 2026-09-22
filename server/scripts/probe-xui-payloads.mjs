// Standalone diagnostic payloads adapted from upstream PR #63:
// https://github.com/denpiligrim/3dp-manager/pull/63
// These cover the eight original connection types. For checks using the current
// production builders and real proxy traffic, use smoke-inbounds.ts.
import crypto from 'node:crypto';

const hex = (n) => crypto.randomBytes(n).toString('hex');
const b64 = (n) => crypto.randomBytes(n).toString('base64');

const sniffing = () =>
  JSON.stringify({
    enabled: false,
    destOverride: ['http', 'tls', 'quic', 'fakedns'],
    metadataOnly: false,
    routeOnly: false,
  });

const client = (id, extra = {}) => ({
  id,
  email: id,
  enable: true,
  flow: '',
  limitIp: 0,
  totalGB: 0,
  expiryTime: 0,
  tgId: 0,
  subId: '',
  reset: 0,
  ...extra,
});

const realitySettings = (sni, keys, shortIds) => ({
  show: false,
  xver: 0,
  target: `${sni}:443`,
  dest: `${sni}:443`,
  serverNames: [sni],
  privateKey: keys.privateKey,
  shortIds,
  settings: {
    publicKey: keys.publicKey,
    fingerprint: 'random',
    serverName: '',
    spiderX: '/',
  },
});

export function buildCases(keys, sni, certificateFile, keyFile) {
  return [
    {
      type: 'vless-tcp-reality',
      build: (port, id) => ({
        enable: true,
        port,
        protocol: 'vless',
        remark: 'probe-vless-tcp-reality',
        settings: JSON.stringify({
          clients: [client(id, { flow: 'xtls-rprx-vision' })],
          decryption: 'none',
          encryption: 'none',
          fallbacks: [],
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
          security: 'reality',
          externalProxy: [],
          realitySettings: realitySettings(sni, keys, [hex(4), hex(4)]),
          tcpSettings: { acceptProxyProtocol: false, header: { type: 'none' } },
        }),
        sniffing: sniffing(),
      }),
    },
    {
      type: 'vless-xhttp-reality',
      build: (port, id) => ({
        enable: true,
        port,
        protocol: 'vless',
        remark: 'probe-vless-xhttp-reality',
        settings: JSON.stringify({
          clients: [client(id)],
          decryption: 'none',
          encryption: 'none',
          fallbacks: [],
        }),
        streamSettings: JSON.stringify({
          network: 'xhttp',
          security: 'reality',
          externalProxy: [],
          realitySettings: realitySettings(sni, keys, [hex(4), hex(4)]),
          xhttpSettings: {
            host: sni,
            path: '/',
            mode: 'auto',
            noSSEHeader: false,
            scMaxBufferedPosts: 30,
            scMaxEachPostBytes: '1000000',
            scStreamUpServerSecs: '20-80',
            xPaddingBytes: '100-1000',
          },
        }),
        sniffing: sniffing(),
      }),
    },
    {
      type: 'vless-grpc-reality',
      build: (port, id) => ({
        enable: true,
        port,
        protocol: 'vless',
        remark: 'probe-vless-grpc-reality',
        settings: JSON.stringify({
          clients: [client(id)],
          decryption: 'none',
          encryption: 'none',
          fallbacks: [],
        }),
        streamSettings: JSON.stringify({
          network: 'grpc',
          security: 'reality',
          externalProxy: [],
          realitySettings: realitySettings(sni, keys, [hex(4)]),
          grpcSettings: { serviceName: 'myservice', authority: sni, multiMode: false },
        }),
        sniffing: sniffing(),
      }),
    },
    {
      type: 'vless-ws',
      build: (port, id) => ({
        enable: true,
        port,
        protocol: 'vless',
        remark: 'probe-vless-ws',
        settings: JSON.stringify({
          clients: [client(id)],
          decryption: 'none',
          encryption: 'none',
          fallbacks: [],
        }),
        streamSettings: JSON.stringify({
          network: 'ws',
          security: 'none',
          externalProxy: [],
          wsSettings: { host: sni, path: '/', acceptProxyProtocol: false, heartbeatPeriod: 0 },
        }),
        sniffing: sniffing(),
      }),
    },
    {
      type: 'vmess-tcp',
      build: (port, id) => ({
        enable: true,
        port,
        protocol: 'vmess',
        remark: 'probe-vmess-tcp',
        settings: JSON.stringify({
          clients: [client(id, { subId: '0', alterId: 0 })],
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
          security: 'none',
          tcpSettings: { acceptProxyProtocol: false, header: { type: 'none' } },
        }),
        sniffing: sniffing(),
      }),
    },
    {
      type: 'shadowsocks-tcp',
      build: (port, id) => ({
        enable: true,
        port,
        protocol: 'shadowsocks',
        remark: 'probe-shadowsocks-tcp',
        settings: JSON.stringify({
          clients: [client('', { email: id, password: b64(32) })],
          ivCheck: false,
          method: '2022-blake3-aes-256-gcm',
          network: 'tcp',
          password: b64(32),
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
          security: 'none',
          tcpSettings: { acceptProxyProtocol: false, header: { type: 'none' } },
        }),
        sniffing: sniffing(),
      }),
    },
    {
      type: 'trojan-tcp-reality',
      build: (port, id) => ({
        enable: true,
        port,
        protocol: 'trojan',
        remark: 'probe-trojan-tcp-reality',
        settings: JSON.stringify({
          clients: [client(id, { password: hex(8) })],
          fallbacks: [],
        }),
        streamSettings: JSON.stringify({
          network: 'tcp',
          security: 'reality',
          externalProxy: [],
          realitySettings: realitySettings(sni, keys, [
            hex(4), hex(3), hex(8), hex(2), hex(2), hex(2), hex(2), hex(4),
          ]),
          tcpSettings: { acceptProxyProtocol: false, header: { type: 'none' } },
        }),
        sniffing: sniffing(),
      }),
    },
    {
      type: 'hysteria2-udp',
      build: (port, id) => ({
        enable: true,
        port,
        protocol: 'hysteria',
        remark: 'probe-hysteria2-udp',
        settings: JSON.stringify({
          clients: [{ auth: id, email: id, enable: true }],
          version: 2,
        }),
        streamSettings: JSON.stringify({
          network: 'hysteria',
          security: 'tls',
          finalmask: { udp: [{ settings: { password: hex(8) }, type: 'salamander' }] },
          hysteriaSettings: {
            auth: id,
            masquerade: {
              content: '', dir: '', headers: {}, rewriteHost: false,
              statusCode: 0, type: 'proxy', url: 'https://google.com',
            },
            udpIdleTimeout: 60,
            version: 2,
          },
          tlsSettings: {
            serverName: sni,
            alpn: ['h3'],
            certificates: [{
              buildChain: false,
              certificateFile,
              keyFile,
              oneTimeLoading: false,
              usage: 'encipherment',
            }],
            cipherSuites: '',
            disableSystemRoot: false,
            echForceQuery: 'none',
            echServerKeys: '',
            enableSessionResumption: false,
            maxVersion: '1.3',
            minVersion: '1.2',
            rejectUnknownSni: false,
          },
        }),
        sniffing: sniffing(),
      }),
    },
  ];
}

