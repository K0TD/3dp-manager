import { createPrivateKey, createPublicKey } from 'crypto';
import { isIP } from 'net';
import type { XuiInboundRaw, XuiInboundSettings } from './xui-inbound.types';

export interface ProxyConnection {
  type: 'http' | 'socks' | 'mixed';
  host: string;
  port: number;
  username: string;
  password: string;
}

export function isProxyProtocol(protocol: string): boolean {
  return ['http', 'socks', 'mixed'].includes(protocol);
}

function hostLiteral(address: string): string {
  const host = address.replace(/^\[|\]$/g, '');
  if (isIP(host) === 6) return `[${host}]`;
  if (
    !host ||
    host.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)
  )
    throw new Error('Invalid connection host');
  return host;
}

function validKey(key: string | undefined): key is string {
  return (
    typeof key === 'string' &&
    /^[A-Za-z0-9+/]{43}=$/.test(key) &&
    Buffer.from(key, 'base64').length === 32
  );
}

function publicKeyFromPrivate(key: string): string {
  if (!validKey(key)) throw new Error('Invalid WireGuard key');
  const privateKey = createPrivateKey({
    format: 'der',
    type: 'pkcs8',
    key: Buffer.concat([
      Buffer.from('302e020100300506032b656e04220420', 'hex'),
      Buffer.from(key, 'base64'),
    ]),
  });
  const publicKey = createPublicKey(privateKey).export({ format: 'jwk' });
  return Buffer.from(publicKey.x!, 'base64url').toString('base64');
}

export function buildWireguardLink(
  inbound: XuiInboundRaw,
  address: string,
): string {
  const settings = JSON.parse(inbound.settings) as XuiInboundSettings;
  const client = settings.clients?.[0];
  if (!client || !validKey(client.privateKey) || !client.allowedIPs?.length)
    throw new Error('Saved WireGuard client has no usable profile');
  const link = new URL(`wireguard://${hostLiteral(address)}:${inbound.port}`);
  link.searchParams.set('privateKey', client.privateKey);
  link.searchParams.set('publicKey', publicKeyFromPrivate(settings.secretKey!));
  link.searchParams.set('address', client.allowedIPs.join(', '));
  link.searchParams.set('dns', settings.dns || '1.1.1.1, 8.8.8.8');
  link.searchParams.set('mtu', String(settings.mtu || 1360));
  link.searchParams.set('keepAlive', String(client.keepAlive || 25));
  if (client.preSharedKey)
    link.searchParams.set('preSharedKey', client.preSharedKey);
  // Internal storage only; public subscriptions expose .conf downloads instead.
  return link.toString();
}

export function wireguardConfigFromLink(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'wireguard:') return null;
    const params = url.searchParams;
    const privateKey = params.get('privateKey');
    const publicKey = params.get('publicKey');
    const preSharedKey = params.get('preSharedKey');
    const addresses = (params.get('address') || '')
      .split(',')
      .map((v) => v.trim());
    const dns = (params.get('dns') || '').split(',').map((v) => v.trim());
    const mtu = Number(params.get('mtu'));
    const keepAlive = Number(params.get('keepAlive'));
    const port = Number(url.port);
    if (
      !validKey(privateKey) ||
      !validKey(publicKey) ||
      (preSharedKey && !validKey(preSharedKey)) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !Number.isInteger(mtu) ||
      mtu < 1280 ||
      mtu > 1420 ||
      !Number.isInteger(keepAlive) ||
      keepAlive < 0 ||
      keepAlive > 65535 ||
      !addresses.length ||
      addresses.some((value) => {
        const [ip, prefix, extra] = value.split('/');
        return (
          extra !== undefined ||
          !isIP(ip) ||
          prefix !== (isIP(ip) === 6 ? '128' : '32')
        );
      }) ||
      !dns.length ||
      dns.some((value) => !isIP(value))
    )
      return null;
    return `[Interface]\nPrivateKey = ${privateKey}\nAddress = ${addresses.join(', ')}\nDNS = ${dns.join(', ')}\nMTU = ${mtu}\n\n[Peer]\nPublicKey = ${publicKey}\n${preSharedKey ? `PresharedKey = ${preSharedKey}\n` : ''}AllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = ${hostLiteral(url.hostname)}:${port}\nPersistentKeepalive = ${keepAlive}\n`;
  } catch {
    return null;
  }
}

export function buildProxyLink(
  inbound: XuiInboundRaw,
  address: string,
): string {
  const settings = JSON.parse(inbound.settings) as XuiInboundSettings;
  const account = settings.accounts?.[0];
  if (
    !account?.user ||
    !account.pass ||
    /[\r\n]/.test(account.user + account.pass)
  )
    throw new Error('Saved proxy has no usable credentials');
  const scheme = inbound.protocol === 'socks' ? 'socks5' : inbound.protocol;
  const url = new URL(`${scheme}://${hostLiteral(address)}:${inbound.port}`);
  url.username = encodeURIComponent(account.user);
  url.password = encodeURIComponent(account.pass);
  return url.toString();
}

export function proxyConnectionFromLink(link: string): ProxyConnection | null {
  try {
    const url = new URL(link);
    const type =
      url.protocol === 'socks5:' ? 'socks' : url.protocol.slice(0, -1);
    if (!isProxyProtocol(type)) return null;
    const port = Number(url.port || (type === 'http' ? '80' : '0'));
    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !url.username ||
      !url.password
    )
      return null;
    hostLiteral(url.hostname);
    return {
      type: type as ProxyConnection['type'],
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    return null;
  }
}

export function patchConnectionHost(link: string, address: string): string {
  try {
    const url = new URL(link);
    url.hostname = hostLiteral(address);
    return url.toString();
  } catch {
    return link;
  }
}
