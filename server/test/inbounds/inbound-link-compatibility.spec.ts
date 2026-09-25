import { InboundBuilderService } from 'src/inbounds/inbound-builder.service';
import { normalizeInbound } from 'src/xui/xui-contract';

const builder = new InboundBuilderService();
const reality = {
  port: 24443,
  uuid: 'db6b9a55-494a-4e63-8b78-b15df0aa1c0e',
  sni: 'cover.example',
  privateKey: 'private',
  publicKey: 'public',
};

describe('published links match saved panel clients', () => {
  it('generates XHTTP TLS and publishes the saved transport parameters without Vision', () => {
    const inbound = builder.buildVlessTlsXhttp({
      port: 443,
      uuid: reality.uuid,
      serverName: 'tls.example',
      certificateFile: '/cert/fullchain.pem',
      keyFile: '/cert/key.pem',
    });
    const stream = JSON.parse(inbound.streamSettings);
    expect(stream).toMatchObject({
      network: 'xhttp',
      security: 'tls',
      xhttpSettings: { path: '/', host: 'tls.example', mode: 'auto' },
      tlsSettings: {
        certificates: [
          { certificateFile: '/cert/fullchain.pem', keyFile: '/cert/key.pem' },
        ],
      },
    });
    expect(stream.tcpSettings).toBeUndefined();
    expect(JSON.parse(inbound.settings).clients[0].flow).toBe('');
    stream.xhttpSettings = {
      path: '/panel path?ed=1',
      host: 'http.example',
      mode: 'stream-one',
    };
    inbound.streamSettings = JSON.stringify(stream);
    const link = new URL(
      builder.buildInboundLink(inbound, 'node.example', '', ''),
    );
    expect(Object.fromEntries(link.searchParams)).toMatchObject({
      type: 'xhttp',
      security: 'tls',
      sni: 'tls.example',
      path: '/panel path?ed=1',
      host: 'http.example',
      mode: 'stream-one',
    });
    expect(link.searchParams.has('flow')).toBe(false);
    expect(link.searchParams.has('pbk')).toBe(false);
  });

  it('keeps XHTTP Reality transport fields in published links', () => {
    const link = new URL(
      builder.buildInboundLink(
        builder.buildVlessRealityXhttp(reality),
        'node.example',
        '',
        '',
      ),
    );
    expect(Object.fromEntries(link.searchParams)).toMatchObject({
      type: 'xhttp',
      security: 'reality',
      host: reality.sni,
      path: '/',
      mode: 'auto',
      pbk: 'public',
    });
  });
  it('uses the Trojan password and node address independently from UUID and SNI', () => {
    const inbound = builder.buildTrojanRealityTcp(reality);
    const settings = JSON.parse(inbound.settings) as {
      clients: Array<{ password: string }>;
    };
    const link = new URL(
      builder.buildInboundLink(inbound, '203.0.113.5', reality.uuid, ''),
    );
    expect(decodeURIComponent(link.username)).toBe(
      settings.clients[0].password,
    );
    expect(link.username).not.toBe(reality.uuid);
    expect(link.hostname).toBe('203.0.113.5');
    expect(link.searchParams.get('sni')).toBe('cover.example');
    expect(link.searchParams.get('pbk')).toBe('public');
    expect(link.searchParams.get('fp')).toBe('chrome');
  });

  it('uses the saved credential and port after panel normalization', () => {
    const requested = builder.buildVlessRealityTcp(reality);
    const saved = normalizeInbound({
      ...requested,
      port: 25555,
      settings: { clients: [{ id: 'saved-uuid', flow: 'xtls-rprx-vision' }] },
    });
    const link = new URL(
      builder.buildInboundLink(saved, '2001:db8::1', reality.uuid, ''),
    );
    expect(link.username).toBe('saved-uuid');
    expect(link.port).toBe('25555');
    expect(link.hostname).toBe('[2001:db8::1]');
    expect(link.searchParams.get('flow')).toBe('xtls-rprx-vision');
  });

  it.each(['host', 'headers'])('preserves WS host from %s', (shape) => {
    const inbound = builder.buildVlessWs(reality);
    inbound.streamSettings = JSON.stringify({
      network: 'ws',
      security: 'none',
      wsSettings: {
        path: '/socket?ed=2048',
        ...(shape === 'host'
          ? { host: 'ws.example' }
          : { headers: { Host: 'ws.example' } }),
      },
    });
    const link = new URL(
      builder.buildInboundLink(inbound, 'node.example', '', ''),
    );
    expect(link.searchParams.get('host')).toBe('ws.example');
    expect(link.searchParams.get('path')).toBe('/socket?ed=2048');
  });

  it('encodes both Shadowsocks 2022 keys and a remark without corrupting the URL', () => {
    const inbound = builder.buildShadowsocksTcp(reality);
    inbound.remark = 'server #1 & Москва';
    const settings = JSON.parse(inbound.settings) as {
      method: string;
      password: string;
      clients: Array<{ password: string }>;
    };
    const link = new URL(
      builder.buildInboundLink(inbound, '2001:db8::2', '', ''),
    );
    expect(Buffer.from(link.username, 'base64url').toString()).toBe(
      `${settings.method}:${settings.password}:${settings.clients[0].password}`,
    );
    expect(Buffer.from(settings.password, 'base64')).toHaveLength(32);
    expect(Buffer.from(settings.clients[0].password, 'base64')).toHaveLength(
      32,
    );
    expect(link.hostname).toBe('[2001:db8::2]');
    expect(decodeURIComponent(link.hash)).toContain('server #1 & Москва');
  });

  it('handles a Hysteria readback without optional obfuscation', () => {
    const inbound = normalizeInbound({
      protocol: 'hysteria',
      port: 24443,
      settings: { clients: [{ auth: 'saved-auth' }] },
      streamSettings: {
        network: 'hysteria',
        security: 'tls',
        tlsSettings: { serverName: 'tls.example' },
      },
    });
    const link = new URL(
      builder.buildInboundLink(inbound, 'node.example', 'old', ''),
    );
    expect(link.username).toBe('saved-auth');
    expect(link.searchParams.has('fm')).toBe(false);
    expect(link.searchParams.get('sni')).toBe('tls.example');
  });
});
