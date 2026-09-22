import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import {
  XuiInboundRaw,
  XuiInboundSettings,
  XuiStreamSettings,
} from './xui-inbound.types';
import {
  isValidFakeTlsDomain,
  normalizeFakeTlsDomain,
} from './mtproto-faketls';
import { createAmneziaVpnLink } from './amnezia-vpn-link';

interface VlessTlsParams {
  port: number;
  uuid: string;
  serverName: string;
  certificateFile: string;
  keyFile: string;
}

interface WireguardKeyPair {
  privateKey: string;
  publicKey: string;
}

interface AmneziaWgLinkSettings {
  server: Record<string, unknown> & {
    primaryDns?: string;
    secondaryDns?: string;
    mtu?: number;
    publicKey?: string;
    randomTrailers?: boolean;
    disableCookies?: boolean;
  };
  clients: Array<
    Record<string, unknown> & {
      privateKey?: string;
      publicKey?: string;
      allowedIPs?: string[];
      keepAlive?: number;
      preSharedKey?: string;
    }
  >;
}

@Injectable()
export class InboundBuilderService {
  private flag = process.env.COUNTRY_FLAG ?? '%F0%9F%92%AF';

  private randomInt(min: number, max: number) {
    return crypto.randomInt(min, max + 1);
  }

  private base64UrlToBase64(value: string) {
    return (
      value.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - (value.length % 4)) % 4)
    );
  }

  private generateWireguardKeyPair(): WireguardKeyPair {
    const pair = crypto.generateKeyPairSync('x25519');
    const privateJwk = pair.privateKey.export({
      format: 'jwk',
    }) as JsonWebKey & { d?: string };
    const publicJwk = pair.publicKey.export({ format: 'jwk' }) as JsonWebKey & {
      x?: string;
    };
    if (!privateJwk.d || !publicJwk.x)
      throw new Error('Не удалось сгенерировать ключи AmneziaWG');
    return {
      privateKey: this.base64UrlToBase64(privateJwk.d),
      publicKey: this.base64UrlToBase64(publicJwk.x),
    };
  }

  private generateAmneziaWgObfuscation() {
    const jmin = this.randomInt(40, 89);
    const s1 = this.randomInt(15, 150);
    let s2 = this.randomInt(15, 150);
    while (s1 + 56 === s2) s2 = this.randomInt(15, 150);
    const hMax = 2_147_483_647;
    const bandSize = Math.floor((hMax - 4) / 4);
    const h = [0, 1, 2, 3].map((index) =>
      String(this.randomInt(5 + index * bandSize, 4 + (index + 1) * bandSize)),
    );
    const cpLo = this.randomInt(8, 24);
    const rekeyLo = this.randomInt(100, 120);
    const rekeyHi = rekeyLo + this.randomInt(10, 40);
    const rejectLo = rekeyHi + this.randomInt(30, 60);
    const timeoutLo = this.randomInt(3, 6);
    const keepaliveLo = this.randomInt(8, 12);
    const attemptsLo = this.randomInt(15, 25);
    return {
      jc: this.randomInt(3, 6),
      jmin,
      jmax: jmin + this.randomInt(50, 250),
      s1,
      s2,
      s3: this.randomInt(12, 55),
      s4: this.randomInt(12, 27),
      h1: h[0],
      h2: h[1],
      h3: h[2],
      h4: h[3],
      i1: `<r ${this.randomInt(32, 256)}>`,
      i2: '',
      i3: '',
      i4: '',
      i5: '',
      headerProtectionKey: crypto.randomBytes(32).toString('base64'),
      contentPaddingAddition: `${cpLo}-${cpLo + this.randomInt(8, 40)}`,
      rekeyAfterTime: `${rekeyLo}-${rekeyHi}`,
      rekeyTimeout: `${timeoutLo}-${timeoutLo + this.randomInt(1, 4)}`,
      rejectAfterTime: `${rejectLo}-${rejectLo + this.randomInt(30, 90)}`,
      keepaliveTimeout: `${keepaliveLo}-${keepaliveLo + this.randomInt(2, 8)}`,
      maxHandshakeAttempts: `${attemptsLo}-${attemptsLo + this.randomInt(5, 25)}`,
      randomTrailers: true,
      disableCookies: true,
    };
  }

  buildAmneziaWgInbound(params: { port: number; uuid: string }) {
    const serverKeys = this.generateWireguardKeyPair();
    const clientKeys = this.generateWireguardKeyPair();
    const obfuscation = this.generateAmneziaWgObfuscation();
    const mtu = Math.max(1280, 1420 - obfuscation.s4);
    return {
      enable: true,
      listen: '0.0.0.0',
      port: params.port,
      protocol: 'amneziawg',
      remark: 'amneziawg',
      settings: JSON.stringify({
        server: {
          privateKey: serverKeys.privateKey,
          publicKey: serverKeys.publicKey,
          subnetIp: '10.8.1.0',
          subnetCidr: 24,
          mtu,
          primaryDns: '8.8.8.8',
          secondaryDns: '8.8.4.4',
          externalInterface: '',
          ipv6Enabled: false,
          ipv6Subnet: '',
          ipv6ExternalInterface: '',
          routeThroughXray: false,
          ...obfuscation,
        },
        clients: [
          {
            privateKey: clientKeys.privateKey,
            publicKey: clientKeys.publicKey,
            allowedIPs: ['10.8.1.2/32'],
            keepAlive: 25,
            email: params.uuid,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            enable: true,
            tgId: 0,
            subId: '',
            reset: 0,
          },
        ],
      }),
      streamSettings: '',
      sniffing: JSON.stringify({ enabled: false }),
    };
  }

  buildMtprotoInbound(params: {
    port: number;
    uuid: string;
    fakeTlsDomain: string;
  }) {
    const fakeTlsDomain = normalizeFakeTlsDomain(params.fakeTlsDomain);
    if (!isValidFakeTlsDomain(fakeTlsDomain)) {
      throw new Error('Некорректный FakeTLS-домен MTProto');
    }
    const secret = this.generateMtprotoSecret(fakeTlsDomain);

    return {
      enable: true,
      listen: '0.0.0.0',
      port: params.port,
      protocol: 'mtproto',
      remark: 'mtproto-faketls',
      settings: JSON.stringify({
        fakeTlsDomain,
        clients: [
          {
            secret,
            email: params.uuid,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            enable: true,
            tgId: 0,
            subId: '',
            comment: '',
            reset: 0,
          },
        ],
      }),
      streamSettings: '',
      sniffing: '',
    };
  }

  private generateMtprotoSecret(fakeTlsDomain: string) {
    const randomSecret = crypto.randomBytes(16).toString('hex');
    const encodedDomain = Buffer.from(fakeTlsDomain, 'utf8').toString('hex');
    return `ee${randomSecret}${encodedDomain}`;
  }

  buildVlessRealityTcp(params: {
    port: number;
    uuid: string;
    sni: string;
    privateKey: string;
    publicKey: string;
  }) {
    const { port, uuid, sni, privateKey, publicKey } = params;
    return {
      enable: true,
      port,
      protocol: 'vless',
      remark: `vless-tcp-reality`,
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            flow: 'xtls-rprx-vision',
            email: uuid,
            enable: true,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            tgId: 0,
            subId: '',
            reset: 0,
          },
        ],
        decryption: 'none',
        encryption: 'none',
        fallbacks: [],
      }),
      streamSettings: JSON.stringify({
        network: 'tcp',
        security: 'reality',
        externalProxy: [],
        realitySettings: {
          show: false,
          xver: 0,
          target: `${sni}:443`,
          dest: `${sni}:443`,
          serverNames: [sni],
          privateKey: privateKey,
          shortIds: [
            crypto.randomBytes(4).toString('hex'),
            crypto.randomBytes(4).toString('hex'),
          ],
          settings: {
            publicKey: publicKey,
            fingerprint: 'random',
            serverName: '',
            spiderX: '/',
          },
        },
        tcpSettings: { acceptProxyProtocol: false, header: { type: 'none' } },
      }),
      sniffing: JSON.stringify({
        enabled: false,
        destOverride: ['http', 'tls', 'quic', 'fakedns'],
        metadataOnly: false,
        routeOnly: false,
      }),
    };
  }

  buildVlessRealityXhttp(params: {
    port: number;
    uuid: string;
    sni: string;
    privateKey: string;
    publicKey: string;
  }) {
    const { port, uuid, sni, privateKey, publicKey } = params;
    return {
      enable: true,
      port,
      protocol: 'vless',
      remark: `vless-xhttp-reality`,
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            flow: '',
            email: uuid,
            enable: true,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            tgId: 0,
            subId: '',
            reset: 0,
          },
        ],
        decryption: 'none',
        encryption: 'none',
        fallbacks: [],
      }),
      streamSettings: JSON.stringify({
        network: 'xhttp',
        security: 'reality',
        externalProxy: [],
        realitySettings: {
          show: false,
          xver: 0,
          target: `${sni}:443`,
          dest: `${sni}:443`,
          serverNames: [sni],
          privateKey: privateKey,
          shortIds: [
            crypto.randomBytes(4).toString('hex'),
            crypto.randomBytes(4).toString('hex'),
          ],
          settings: {
            publicKey: publicKey,
            fingerprint: 'random',
            serverName: '',
            spiderX: '/',
          },
        },
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
      sniffing: JSON.stringify({
        enabled: false,
        destOverride: ['http', 'tls', 'quic', 'fakedns'],
        metadataOnly: false,
        routeOnly: false,
      }),
    };
  }

  buildVlessRealityGrpc(params: {
    port: number;
    uuid: string;
    sni: string;
    privateKey: string;
    publicKey: string;
  }) {
    const { port, uuid, sni, privateKey, publicKey } = params;
    return {
      enable: true,
      port,
      protocol: 'vless',
      remark: 'vless-grpc-reality',
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            email: uuid,
            enable: true,
            flow: '',
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            tgId: 0,
            subId: '',
            reset: 0,
          },
        ],
        decryption: 'none',
        encryption: 'none',
        fallbacks: [],
      }),
      streamSettings: JSON.stringify({
        network: 'grpc',
        security: 'reality',
        externalProxy: [],
        realitySettings: {
          show: false,
          xver: 0,
          target: `${sni}:443`,
          dest: `${sni}:443`,
          serverNames: [sni],
          privateKey: privateKey,
          shortIds: [crypto.randomBytes(4).toString('hex')],
          settings: {
            publicKey: publicKey,
            fingerprint: 'random',
            serverName: '',
            spiderX: '/',
          },
        },
        grpcSettings: {
          serviceName: 'myservice',
          authority: sni,
          multiMode: false,
        },
      }),
      sniffing: JSON.stringify({
        enabled: false,
        destOverride: ['http', 'tls', 'quic', 'fakedns'],
        metadataOnly: false,
        routeOnly: false,
      }),
    };
  }

  buildVlessTlsTcp(params: VlessTlsParams) {
    return this.buildVlessTlsInbound(params, {
      network: 'tcp',
      remark: 'vless-tcp-tls',
      flow: 'xtls-rprx-vision',
      transportSettings: {
        tcpSettings: { acceptProxyProtocol: false, header: { type: 'none' } },
      },
    });
  }

  buildVlessTlsWs(params: VlessTlsParams) {
    return this.buildVlessTlsInbound(params, {
      network: 'ws',
      remark: 'vless-ws-tls',
      flow: '',
      transportSettings: {
        wsSettings: {
          path: '/',
          headers: { Host: params.serverName },
          acceptProxyProtocol: false,
          heartbeatPeriod: 0,
        },
      },
    });
  }

  private buildVlessTlsInbound(
    params: VlessTlsParams,
    transport: {
      network: 'tcp' | 'ws';
      remark: string;
      flow: string;
      transportSettings: Record<string, unknown>;
    },
  ) {
    return {
      enable: true,
      port: params.port,
      protocol: 'vless',
      remark: transport.remark,
      settings: JSON.stringify({
        clients: [
          {
            id: params.uuid,
            email: params.uuid,
            flow: transport.flow,
            enable: true,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            tgId: 0,
            subId: '',
            reset: 0,
          },
        ],
        decryption: 'none',
        encryption: 'none',
        fallbacks: [],
      }),
      streamSettings: JSON.stringify({
        network: transport.network,
        security: 'tls',
        externalProxy: [],
        ...transport.transportSettings,
        tlsSettings: {
          serverName: params.serverName,
          alpn: ['h2', 'http/1.1'],
          certificates: [
            {
              buildChain: false,
              certificateFile: params.certificateFile,
              keyFile: params.keyFile,
              oneTimeLoading: false,
              usage: 'encipherment',
            },
          ],
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
      sniffing: JSON.stringify({
        enabled: false,
        destOverride: ['http', 'tls', 'quic', 'fakedns'],
        metadataOnly: false,
        routeOnly: false,
      }),
    };
  }

  buildVlessWs(params: { port: number; uuid: string; sni: string }) {
    const { port, uuid, sni } = params;
    return {
      enable: true,
      port,
      protocol: 'vless',
      remark: `vless-ws`,
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            email: uuid,
            enable: true,
            flow: '',
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            tgId: 0,
            subId: '',
            reset: 0,
          },
        ],
        decryption: 'none',
        encryption: 'none',
        fallbacks: [],
      }),
      streamSettings: JSON.stringify({
        network: 'ws',
        security: 'none',
        externalProxy: [],
        wsSettings: {
          host: sni,
          path: '/',
          acceptProxyProtocol: false,
          heartbeatPeriod: 0,
        },
      }),
      sniffing: JSON.stringify({
        enabled: false,
        destOverride: ['http', 'tls', 'quic', 'fakedns'],
        metadataOnly: false,
        routeOnly: false,
      }),
    };
  }

  buildVmessTcp(params: { port: number; uuid: string }) {
    const { port, uuid } = params;
    return {
      enable: true,
      port,
      protocol: 'vmess',
      remark: 'vmess-tcp',
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            flow: '',
            email: uuid,
            enable: true,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            tgId: 0,
            subId: '0',
            alterId: 0,
            reset: 0,
          },
        ],
      }),
      streamSettings: JSON.stringify({
        network: 'tcp',
        security: 'none',
        tcpSettings: {
          acceptProxyProtocol: false,
          header: { type: 'none' },
        },
      }),
      sniffing: JSON.stringify({
        enabled: false,
        destOverride: ['http', 'tls', 'quic', 'fakedns'],
        metadataOnly: false,
        routeOnly: false,
      }),
    };
  }

  buildShadowsocksTcp(params: { port: number; uuid: string }) {
    const { port, uuid } = params;
    return {
      enable: true,
      port,
      protocol: 'shadowsocks',
      remark: 'shadowsocks-tcp',
      settings: JSON.stringify({
        clients: [
          {
            id: '',
            flow: '',
            email: uuid,
            password: crypto.randomBytes(32).toString('base64'),
            enable: true,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            tgId: 0,
            subId: '',
            reset: 0,
          },
        ],
        ivCheck: false,
        method: '2022-blake3-aes-256-gcm',
        network: 'tcp',
        password: crypto.randomBytes(32).toString('base64'),
      }),
      streamSettings: JSON.stringify({
        network: 'tcp',
        security: 'none',
        tcpSettings: {
          acceptProxyProtocol: false,
          header: { type: 'none' },
        },
      }),
      sniffing: JSON.stringify({
        enabled: false,
        destOverride: ['http', 'tls', 'quic', 'fakedns'],
        metadataOnly: false,
        routeOnly: false,
      }),
    };
  }

  buildTrojanRealityTcp(params: {
    port: number;
    uuid: string;
    sni: string;
    privateKey: string;
    publicKey: string;
  }) {
    const { port, uuid, sni, privateKey, publicKey } = params;
    return {
      enable: true,
      port,
      protocol: 'trojan',
      remark: `trojan-tcp-reality`,
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            email: uuid,
            password: crypto.randomBytes(8).toString('hex'),
            enable: true,
            flow: '',
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            tgId: 0,
            subId: '',
            reset: 0,
          },
        ],
        fallbacks: [],
      }),
      streamSettings: JSON.stringify({
        network: 'tcp',
        security: 'reality',
        externalProxy: [],
        realitySettings: {
          show: false,
          xver: 0,
          target: `${sni}:443`,
          dest: `${sni}:443`,
          serverNames: [sni],
          privateKey: privateKey,
          shortIds: [
            crypto.randomBytes(4).toString('hex'),
            crypto.randomBytes(3).toString('hex'),
            crypto.randomBytes(8).toString('hex'),
            crypto.randomBytes(2).toString('hex'),
            crypto.randomBytes(2).toString('hex'),
            crypto.randomBytes(2).toString('hex'),
            crypto.randomBytes(2).toString('hex'),
            crypto.randomBytes(4).toString('hex'),
          ],
          settings: {
            publicKey: publicKey,
            fingerprint: 'random',
            serverName: '',
            spiderX: '/',
          },
        },
        tcpSettings: {
          acceptProxyProtocol: false,
          header: { type: 'none' },
        },
      }),
      sniffing: JSON.stringify({
        enabled: false,
        destOverride: ['http', 'tls', 'quic', 'fakedns'],
        metadataOnly: false,
        routeOnly: false,
      }),
    };
  }

  buildHysteria2Inbound(params: {
    port: number;
    uuid: string;
    serverName: string;
    certificateFile: string;
    keyFile: string;
  }) {
    const { port, uuid, serverName } = params;
    const obfsPassword = crypto.randomBytes(8).toString('hex');
    return {
      enable: true,
      listen: '0.0.0.0',
      port,
      protocol: 'hysteria',
      tag: `inbound-${port}`,
      remark: 'hysteria2-udp',
      settings: JSON.stringify({
        clients: [
          {
            auth: uuid,
            email: uuid,
            enable: true,
          },
        ],
        version: 2,
      }),
      streamSettings: JSON.stringify({
        network: 'hysteria',
        security: 'tls',
        finalmask: {
          udp: [
            {
              settings: {
                password: obfsPassword,
              },
              type: 'salamander',
            },
          ],
        },
        hysteriaSettings: {
          auth: uuid,
          masquerade: {
            content: '',
            dir: '',
            headers: {},
            rewriteHost: false,
            statusCode: 0,
            type: 'proxy',
            url: 'https://google.com',
          },
          udpIdleTimeout: 60,
          version: 2,
        },
        tlsSettings: {
          serverName,
          alpn: ['h3'],
          certificates: [
            {
              buildChain: false,
              certificateFile: params.certificateFile,
              keyFile: params.keyFile,
              oneTimeLoading: false,
              usage: 'encipherment',
            },
          ],
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
      sniffing: JSON.stringify({
        enabled: false,
        destOverride: ['http', 'tls', 'quic', 'fakedns'],
        metadataOnly: false,
        routeOnly: false,
      }),
    };
  }

  generateUuid() {
    return uuidv4();
  }

  buildInboundLink(
    inbound: XuiInboundRaw,
    sni: string,
    idOrPass: string,
    flagEmoji: string,
  ): string {
    this.flag = flagEmoji;
    let link = '';

    switch (inbound.protocol) {
      case 'vless':
        link = this.buildVlessLink(inbound, sni, idOrPass);
        break;
      case 'vmess':
        link = this.buildVmessLink(inbound, sni, idOrPass);
        break;
      case 'shadowsocks':
        link = this.buildSsLink(inbound, sni, idOrPass);
        break;
      case 'trojan':
        link = this.buildTrojanLink(inbound, sni, idOrPass);
        break;
      case 'hysteria':
      case 'hysteria2':
        link = this.buildHysteria2PanelLink(inbound, sni, idOrPass, flagEmoji);
        break;
      case 'amneziawg':
        link = this.buildAmneziaWgLink(inbound, sni, flagEmoji);
        break;
      case 'mtproto':
        link = this.buildMtprotoLink(inbound, sni, idOrPass);
        break;
    }

    return link;
  }

  private buildMtprotoLink(
    inbound: XuiInboundRaw,
    address: string,
    secret: string,
  ) {
    if (
      !address ||
      /[\r\n]/.test(address) ||
      !/^ee[0-9a-f]{34,}$/i.test(secret) ||
      secret.length % 2 !== 0 ||
      !Number.isInteger(inbound.port) ||
      inbound.port < 1 ||
      inbound.port > 65535
    ) {
      return '';
    }

    const link = new URL('tg://proxy');
    link.searchParams.set('server', address);
    link.searchParams.set('port', String(inbound.port));
    link.searchParams.set('secret', secret);
    return link.toString();
  }

  private buildAmneziaWgLink(
    inbound: XuiInboundRaw,
    address: string,
    flagEmoji: string,
  ) {
    let settings: AmneziaWgLinkSettings;
    try {
      settings = JSON.parse(inbound.settings) as AmneziaWgLinkSettings;
    } catch {
      return '';
    }
    const server = settings.server;
    const client = settings.clients?.[0];
    if (!server || !client) return '';
    if (/\r|\n/.test(address)) return '';
    const line = (key: string, rawFieldValue: unknown, fallback = '') => {
      const scalar =
        typeof rawFieldValue === 'string'
          ? rawFieldValue.trim()
          : typeof rawFieldValue === 'number' && Number.isFinite(rawFieldValue)
            ? String(rawFieldValue)
            : '';
      const safeValue = scalar && !/[\r\n]/.test(scalar) ? scalar : fallback;
      return `${key} = ${safeValue}\n`;
    };
    let decodedFlag = flagEmoji || '';
    try {
      decodedFlag = decodeURIComponent(decodedFlag);
    } catch {
      // Keep the raw flag if an administrator supplied a malformed escape.
    }
    const remark = `${decodedFlag} ${inbound.remark || ''}`
      .replace(/[\r\n]+/g, ' ')
      .trim();
    let config = '[Interface]\n';
    config += line('PrivateKey', client.privateKey);
    config += line(
      'Address',
      Array.isArray(client.allowedIPs) ? client.allowedIPs.join(', ') : '',
    );
    const dns = [server.primaryDns, server.secondaryDns].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    config += line('DNS', dns.join(', '));
    if (Number(server.mtu) > 0) config += line('MTU', server.mtu);
    for (const key of ['jc', 'jmin', 'jmax', 's1', 's2', 's3', 's4'])
      config += line(key[0].toUpperCase() + key.slice(1), server[key]);
    for (const key of ['h1', 'h2', 'h3', 'h4', 'i1', 'i2', 'i3', 'i4', 'i5']) {
      const fallback = key.startsWith('h') ? key.slice(1) : '';
      if (key.startsWith('h') || server[key])
        config += line(key.toUpperCase(), server[key], fallback);
    }
    for (const [key, label] of [
      ['headerProtectionKey', 'HeaderProtectionKey'],
      ['contentPaddingAddition', 'ContentPaddingAddition'],
      ['rekeyAfterTime', 'RekeyAfterTime'],
      ['rekeyTimeout', 'RekeyTimeout'],
      ['rejectAfterTime', 'RejectAfterTime'],
      ['keepaliveTimeout', 'KeepaliveTimeout'],
      ['maxHandshakeAttempts', 'MaxHandshakeAttempts'],
    ] as const)
      if (server[key]) config += line(label, server[key]);
    if (server.randomTrailers) config += 'RandomTrailers = on\n';
    if (server.disableCookies) config += 'DisableCookies = on\n';
    config += `\n# ${remark}\n[Peer]\n`;
    config += line('PublicKey', server.publicKey);
    if (client.preSharedKey)
      config += line('PresharedKey', client.preSharedKey);
    config += 'AllowedIPs = 0.0.0.0/0, ::/0\n';
    const endpoint =
      address.includes(':') && !address.startsWith('[')
        ? `[${address}]`
        : address;
    config += `Endpoint = ${endpoint}:${inbound.port}`;
    if (Number(client.keepAlive) > 0)
      config += `\nPersistentKeepalive = ${String(client.keepAlive)}`;
    return createAmneziaVpnLink({
      config,
      description: remark || 'AmneziaWG',
      clientPublicKey:
        typeof client.publicKey === 'string' ? client.publicKey : undefined,
    });
  }

  private buildVlessLink(inbound: XuiInboundRaw, sni: string, uuid: string) {
    const stream = JSON.parse(inbound.streamSettings) as XuiStreamSettings;
    const settings = JSON.parse(inbound.settings) as XuiInboundSettings;

    const network = stream.network;
    const security = stream.security || 'none';

    const params = new URLSearchParams();

    params.set('type', network);
    params.set('encryption', 'none');
    params.set('security', security);

    if (security === 'reality') {
      const r = stream.realitySettings;
      if (!r) return '';
      params.set('pbk', r.settings?.publicKey || '');
      params.set('fp', r.settings?.fingerprint || 'random');
      params.set('sni', r.serverNames?.[0] || '');
      params.set('sid', r.shortIds?.[0] || '');
      params.set('spx', '/');

      if (network === 'tcp') {
        const client = settings.clients?.[0];
        if (client?.flow) {
          params.set('flow', client.flow);
        }
      }

      if (network === 'xhttp') {
        const x =
          (
            stream as {
              xhttpSettings?: { path?: string; host?: string; mode?: string };
            }
          ).xhttpSettings || {};
        params.set('path', x.path || '/');
        params.set('host', x.host || r.serverNames?.[0] || '');
        params.set('mode', x.mode || 'auto');
      }

      if (network === 'grpc') {
        const g =
          (
            stream as {
              grpcSettings?: { serviceName?: string; authority?: string };
            }
          ).grpcSettings || {};
        params.set('serviceName', g.serviceName || 'grpc');
        params.set('authority', g.authority || r.serverNames?.[0] || '');
      }
    }

    if (security === 'tls') {
      params.set('sni', stream.tlsSettings?.serverName || '');
      params.set('fp', 'chrome');
      if (network === 'tcp') {
        const flow = settings.clients?.[0]?.flow;
        if (flow) params.set('flow', flow);
      }
    }

    if (network === 'ws') {
      const ws =
        (
          stream as {
            wsSettings?: { path?: string; headers?: { Host?: string } };
          }
        ).wsSettings || {};
      params.set('path', ws.path || '/');
      if (ws.headers?.Host) {
        params.set('host', ws.headers.Host);
      }
    }

    return (
      `vless://${uuid}@${sni}:${inbound.port}` +
      `?${params.toString()}` +
      `#${this.flag}%20${encodeURIComponent(inbound.remark || '')}`
    );
  }

  private buildVmessLink(inbound: XuiInboundRaw, sni: string, uuid: string) {
    const stream = JSON.parse(inbound.streamSettings) as XuiStreamSettings;

    const vmessObj = {
      add: sni,
      aid: '0',
      alpn: '',
      fp: '',
      host: '',
      id: uuid,
      net: stream.network || 'tcp',
      path: '/',
      port: inbound.port.toString(),
      ps: decodeURIComponent(this.flag) + ' ' + (inbound.remark || ''),
      scy: '',
      sni: '',
      tls: stream.security || 'none',
      type: 'none',
      v: '2',
    };

    const base64 = Buffer.from(JSON.stringify(vmessObj), 'utf8').toString(
      'base64',
    );

    return `vmess://${base64}`;
  }

  private buildSsLink(inbound: XuiInboundRaw, sni: string, _idOrPass: string) {
    const settings = JSON.parse(inbound.settings) as XuiInboundSettings;

    const method = settings.method || '';
    const serverPassword = settings.password || '';
    const clientPassword = settings.clients?.[0]?.password || '';

    const userInfo = `${method}:${serverPassword}:${clientPassword}`;

    const base64 = Buffer.from(userInfo, 'utf8').toString('base64');

    return `ss://${base64}@${sni}:${inbound.port}?type=tcp#${this.flag}%20${inbound.remark || ''}`;
  }

  private buildTrojanLink(
    inbound: XuiInboundRaw,
    sni: string,
    password: string,
  ) {
    const stream = JSON.parse(inbound.streamSettings) as XuiStreamSettings;
    const reality = stream.realitySettings;
    if (!reality) return '';

    const pbk = reality.settings?.publicKey || '';
    const SNI = reality.serverNames?.[0] || sni;
    const sid = reality.shortIds?.[0] || '';
    const spx = '%2F';

    return (
      `trojan://${password}@${SNI}:${inbound.port}` +
      `?type=tcp` +
      `&security=reality` +
      `&pbk=${pbk}` +
      `&fp=random` +
      `&sni=${SNI}` +
      `&sid=${sid}` +
      `&spx=${spx}` +
      `#${this.flag}%20${inbound.remark || ''}`
    );
  }

  private buildHysteria2PanelLink(
    inbound: XuiInboundRaw,
    serverAddress: string,
    password: string,
    flagEmoji: string,
  ) {
    const stream = JSON.parse(inbound.streamSettings) as {
      tlsSettings?: { serverName?: string };
      finalmask?: {
        udp?: Array<{ type?: string; settings?: { password?: string } }>;
      };
    };
    const settings = JSON.parse(inbound.settings) as {
      clients?: Array<{ auth?: string; password?: string }>;
    };
    const auth =
      settings.clients?.[0]?.auth ||
      settings.clients?.[0]?.password ||
      password;
    const finalmask = stream.finalmask?.udp?.[0];
    const params = new URLSearchParams();
    params.set('security', 'tls');
    params.set('fp', 'chrome');
    params.set('alpn', 'h3');

    const fmConfig = {
      udp: [
        {
          type: finalmask.type,
          settings: {
            password: finalmask.settings.password,
          },
        },
      ],
    };
    params.set('fm', JSON.stringify(fmConfig));
    params.set('sni', stream.tlsSettings?.serverName || serverAddress);
    if (finalmask?.type) params.set('obfs', finalmask.type);
    if (finalmask?.settings?.password) {
      params.set('obfs-password', finalmask.settings.password);
    }

    return (
      `hy2://${auth}@${serverAddress}:${inbound.port}/?${params.toString()}` +
      `#${flagEmoji}%20${encodeURIComponent(inbound.remark || '')}`
    );
  }

  buildHysteria2Link(
    serverAddress: string,
    sni: string,
    remark: string,
  ): string {
    let auth = 'YOUR_AUTH';
    let obfs = 'salamander';
    let obfsPass = 'YOUR_PASS';
    let port = 443;

    try {
      const configPath =
        process.env.HYSTERIA_CONFIG_PATH || '/etc/hysteria/config.yaml';

      if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf8');

        const authMatch = fileContent.match(/password:\s*['"]?([^'"\n]+)['"]?/);
        if (authMatch) auth = authMatch[1];

        const obfsMatch = fileContent.match(/type:\s*['"]?(salamander)['"]?/);
        if (obfsMatch) obfs = obfsMatch[1];

        const passMatch = fileContent.match(
          /salamander:[\s\S]*?password:\s*['"]?([^'"\n]+)['"]?/,
        );
        if (passMatch) obfsPass = passMatch[1];

        const listenMatch = fileContent.match(/listen:\s*['"]?:(\d+)['"]?/);
        if (listenMatch) port = parseInt(listenMatch[1], 10);
      } else {
        console.warn(`Конфиг Hysteria2 не найден по пути: ${configPath}`);
      }
    } catch (e) {
      console.error('Ошибка чтения конфига Hysteria2', e);
    }

    const params = new URLSearchParams();
    params.set('security', 'tls');
    params.set('fp', 'chrome');
    params.set('alpn', 'h3');

    params.set('sni', serverAddress);

    params.set('obfs', obfs);
    params.set('obfs-password', obfsPass);

    const fmConfig = {
      udp: [
        {
          type: obfs,
          settings: {
            password: obfsPass,
          },
        },
      ],
    };
    params.set('fm', JSON.stringify(fmConfig));

    return `hy2://${auth}@${serverAddress}:${port}/?${params.toString()}#${remark}`;
  }
}
