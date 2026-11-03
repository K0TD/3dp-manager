import { describe, expect, it } from 'vitest';
import {
  createBuiltinDefaultInbounds,
  createInboundTemplate,
  getDefaultNodeId,
  getNodeAddress,
  getNodeFlag,
  getRelayOptions,
  getSelectedNode,
  hasSni,
  inboundSni,
  isInboundSupported,
  isListedSni,
  isValidPort,
  parseDefaultInboundsSetting,
  sanitizeInboundForStorage,
  validateRoutingProfile,
  validateSubscriptionMetadata,
} from '../../src/utils/inboundUtils';
import type { NodeRecord } from '../../src/types/node';
import type { Domain, Tunnel } from '../../src/types/inbound';

describe('inboundUtils', () => {
  const mockNodes: NodeRecord[] = [
    {
      id: 'node-main',
      name: 'Main Server',
      url: 'https://main.example.com:2053',
      isMain: true,
      order: 1,
      flag: '🇩🇪',
      domain: 'main.example.com',
      capabilities: {
        version: '2.0.0',
        xrayVersion: '1.8.0',
        isCustomXray: false,
        supportedInboundTypes: ['vless-tcp-reality', 'hysteria2-udp'],
        autoTlsCertificate: true,
      },
    },
    {
      id: 'node-nl',
      name: 'NL Server',
      url: 'https://192.168.1.50:2053',
      isMain: false,
      order: 2,
      flag: '🇳🇱',
      ip: '192.168.1.50',
      capabilities: {
        version: '2.0.0',
        xrayVersion: '1.8.0',
        isCustomXray: false,
        supportedInboundTypes: ['vless-xhttp-reality'],
        autoTlsCertificate: false,
      },
    },
  ];

  const mockDomains: Domain[] = [
    { id: 1, name: 'example.com', isEnabled: true },
    { id: 2, name: 'google.com', isEnabled: true },
  ];

  const mockTunnels: Tunnel[] = [
    { id: 10, name: 'Tunnel 1', ip: '1.1.1.1', domain: '', isInstalled: true, nodeId: 'node-main' },
    { id: 20, name: 'Tunnel 2', ip: '2.2.2.2', domain: '', isInstalled: true, nodeId: 'node-nl' },
  ];

  it('correctly resolves default node and node properties', () => {
    expect(getDefaultNodeId(mockNodes)).toBe('node-main');
    expect(getNodeAddress('node-main', mockNodes)).toBe('main.example.com');
    expect(getNodeAddress('node-nl', mockNodes)).toBe('192.168.1.50');
    expect(getNodeFlag('node-main', mockNodes)).toBe('🇩🇪');
    expect(getNodeFlag('node-nl', mockNodes)).toBe('🇳🇱');
    expect(getSelectedNode('node-nl', mockNodes)?.name).toBe('NL Server');
  });

  it('filters relay options for selected node', () => {
    const mainRelays = getRelayOptions('node-main', mockTunnels, mockNodes);
    expect(mainRelays).toHaveLength(1);
    expect(mainRelays[0].id).toBe(10);

    const nlRelays = getRelayOptions('node-nl', mockTunnels, mockNodes);
    expect(nlRelays).toHaveLength(1);
    expect(nlRelays[0].id).toBe(20);
  });

  it('checks supported inbound types per node capabilities', () => {
    expect(isInboundSupported('vless-tcp-reality', 'node-main', mockNodes)).toBe(true);
    expect(isInboundSupported('vless-tcp-reality', 'node-nl', mockNodes)).toBe(false);
    expect(isInboundSupported('vless-xhttp-reality', 'node-nl', mockNodes)).toBe(true);
    expect(isInboundSupported('custom', 'node-nl', mockNodes)).toBe(true);
  });

  it('validates ports properly', () => {
    expect(isValidPort('random')).toBe(true);
    expect(isValidPort('443')).toBe(true);
    expect(isValidPort('65535')).toBe(true);
    expect(isValidPort('0')).toBe(false);
    expect(isValidPort('65536')).toBe(false);
    expect(isValidPort('abc')).toBe(false);
  });

  it('handles SNI resolution and listing', () => {
    expect(hasSni('vless-tcp-reality')).toBe(true);
    expect(hasSni('hysteria2-udp')).toBe(false);
    expect(isListedSni('example.com', mockDomains)).toBe(true);
    expect(isListedSni('random', mockDomains)).toBe(true);
    expect(isListedSni('unknown.com', mockDomains)).toBe(false);

    expect(inboundSni('vless-tcp-reality', mockDomains, 'example.com')).toBe('example.com');
    expect(inboundSni('mtproto-faketls', mockDomains, 'unknown.com')).toBe('random');
  });

  it('creates built-in default inbounds with 5 standard items', () => {
    const defaults = createBuiltinDefaultInbounds(mockNodes, mockDomains);
    expect(defaults).toHaveLength(5);
    expect(defaults.map((d) => d.type)).toEqual([
      'hysteria2-udp',
      'vless-xhttp-reality',
      'vless-tcp-tls',
      'vless-tcp-reality',
      'vless-grpc-reality',
    ]);
  });

  it('creates inbound template with specific node and certificate info', () => {
    const inbound = createInboundTemplate('vless-tcp-tls', mockNodes, mockDomains, {
      nodeId: 'node-nl',
    });
    expect(inbound.nodeId).toBe('node-nl');
    expect(inbound.flag).toBe('🇳🇱');
    expect(inbound.tlsServerName).toBe('192.168.1.50');
    expect(inbound.certificateMode).toBe('node');
  });

  it('parses default inbounds from JSON setting string and handles deleted nodes gracefully', () => {
    const raw = JSON.stringify([
      { type: 'vless-tcp-reality', nodeId: 'node-main', port: '8443' },
      { type: 'vless-xhttp-reality', nodeId: 'node-nl', port: 'random' },
      { type: 'hysteria2-udp', nodeId: 'deleted-node', port: '443', flag: '🇫🇮', name: 'Old Node', relayServerId: '99' },
    ]);

    const parsed = parseDefaultInboundsSetting(raw, mockNodes, mockDomains);
    expect(parsed).toHaveLength(3);
    expect(parsed![0].nodeId).toBe('node-main');
    expect(parsed![1].nodeId).toBe('node-nl');
    // deleted node falls back to Main Node ('') and resets flag, name, relayServerId
    expect(parsed![2].nodeId).toBe('');
    expect(parsed![2].flag).toBe('');
    expect(parsed![2].name).toBe('');
    expect(parsed![2].relayServerId).toBe('');
  });

  it('returns null on invalid or empty JSON', () => {
    expect(parseDefaultInboundsSetting('', mockNodes, mockDomains)).toBeNull();
    expect(parseDefaultInboundsSetting('invalid json', mockNodes, mockDomains)).toBeNull();
    expect(parseDefaultInboundsSetting('[]', mockNodes, mockDomains)).toBeNull();
  });

  it('sanitizes inbound for JSON storage', () => {
    const inbound = createInboundTemplate('vless-tcp-reality', mockNodes, mockDomains, {
      nodeId: 'node-nl',
      port: '10001',
      name: 'NL Inbound',
      sni: 'example.com',
    });
    const sanitized = sanitizeInboundForStorage(inbound);
    expect(sanitized).toEqual({
      type: 'vless-tcp-reality',
      nodeId: 'node-nl',
      relayServerId: '',
      flag: '🇳🇱',
      name: 'NL Inbound',
      port: '10001',
      sni: 'example.com',
      link: '',
      certificateMode: undefined,
      tlsServerName: undefined,
      certificateFile: undefined,
      keyFile: undefined,
    });
  });

  it('handles SNI, support and sanitization for routing and xhttp-get types', () => {
    expect(hasSni('vless-xhttp-get')).toBe(false);
    expect(hasSni('happ-routing')).toBe(false);
    expect(hasSni('incy-routing')).toBe(false);

    expect(isInboundSupported('happ-routing', 'node-nl', mockNodes)).toBe(true);
    expect(isInboundSupported('incy-routing', 'node-nl', mockNodes)).toBe(true);

    const happInbound = createInboundTemplate('happ-routing', mockNodes, mockDomains, {
      routingProfile: 'happ://routing/off',
    });
    expect(happInbound.nodeId).toBe('');
    expect(happInbound.port).toBe('');
    expect(happInbound.sni).toBe('');
    expect(happInbound.routingProfile).toBe('happ://routing/off');

    const sanitized = sanitizeInboundForStorage(happInbound);
    expect(sanitized).toEqual({
      type: 'happ-routing',
      routingProfile: 'happ://routing/off',
    });
  });

  it('validates routing profiles properly', () => {
    expect(validateRoutingProfile('happ-routing', '')).toBe('Укажите профиль маршрутизации');
    expect(validateRoutingProfile('happ-routing', 'happ://routing/off')).toBeNull();
    expect(validateRoutingProfile('happ-routing', '{"rules":[]}')).toBeNull();
    expect(validateRoutingProfile('happ-routing', btoa('{"rules":[]}'))).toBeNull();
    expect(validateRoutingProfile('happ-routing', `happ://routing/add/${btoa('{"rules":[]}')}`)).toBeNull();
    expect(validateRoutingProfile('happ-routing', 'invalid profile')).toContain('Неверный профиль Happ');

    expect(validateRoutingProfile('incy-routing', 'https://example.com/rules')).toBeNull();
    expect(validateRoutingProfile('incy-routing', 'incy://autorouting/add/https://example.com/rules')).toBeNull();
    expect(validateRoutingProfile('incy-routing', '{"rules":[]}')).toBeNull();
    expect(validateRoutingProfile('incy-routing', 'invalid incy')).toContain('Неверный профиль Happ');
  });

  it('counts Unicode code points in metadata limits', () => {
    expect(validateSubscriptionMetadata({ note: '😀'.repeat(200) })).toEqual({});
    expect(validateSubscriptionMetadata({ note: '😀'.repeat(201) })).toHaveProperty('note');
    const prefix = 'https://example.com/';
    expect(validateSubscriptionMetadata({ websiteUrl: prefix + '😀'.repeat(10) + 'a'.repeat(2038 - [...prefix].length) })).toEqual({});
    expect(validateSubscriptionMetadata({ websiteUrl: prefix + '😀'.repeat(2048 - [...prefix].length) })).toEqual({ websiteUrl: 'Некорректный формат ссылки на сайт' });
    expect(validateSubscriptionMetadata({ supportUrl: prefix + '😀'.repeat(2049 - [...prefix].length) })).toHaveProperty('supportUrl');
  });

  it.each(['https://example.com/a b', 'https://example.com/a\tb', 'https://example.com/<x>', 'https://example.com/a\u0000b', 'https://example.com/a\u001fb', 'https://example.com/a\u007fb', 'https://example.com/a\u009fb'])('rejects invalid URL characters in %s', (url) => {
    expect(validateSubscriptionMetadata({ supportUrl: url, websiteUrl: url })).toEqual({ supportUrl: 'Некорректный формат ссылки поддержки', websiteUrl: 'Некорректный формат ссылки на сайт' });
  });

  it('validates subscription metadata properly', () => {
    expect(
      validateSubscriptionMetadata({
        note: 'n'.repeat(201),
      }),
    ).toEqual({
      note: 'Примечание не должно превышать 200 символов',
    });

    expect(
      validateSubscriptionMetadata({
        supportUrl: 'ftp://example.com',
      }),
    ).toEqual({
      supportUrl: 'Ссылка поддержки должна начинаться с http://, https:// или tg://',
    });

    expect(
      validateSubscriptionMetadata({
        websiteUrl: 'tg://resolve?domain=help',
      }),
    ).toEqual({
      websiteUrl: 'Ссылка на сайт должна начинаться с http:// или https://',
    });

    expect(
      validateSubscriptionMetadata({
        note: 'Нормальное примечание',
        supportUrl: 'tg://resolve?domain=help',
        websiteUrl: 'https://example.com',
      }),
    ).toEqual({});
  });
});
