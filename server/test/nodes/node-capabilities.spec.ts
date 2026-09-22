import {
  buildNodeCapabilities,
  supportsInboundType,
} from 'src/nodes/node-capabilities';

describe('MTProto node capabilities', () => {
  const baseInput = {
    xrayVersion: '26.7.11',
    autoTlsCertificate: true,
  };

  it('requires 3x-ui 3.5.0 or newer for multi-client MTProto', () => {
    expect(
      supportsInboundType('mtproto-faketls', {
        ...baseInput,
        panelVersion: 'v3.4.2',
      }),
    ).toBe(false);
    expect(
      supportsInboundType('mtproto-faketls', {
        ...baseInput,
        panelVersion: 'v3.5.0',
      }),
    ).toBe(true);
  });

  it('advertises MTProto only on compatible nodes', () => {
    expect(
      buildNodeCapabilities({
        ...baseInput,
        panelVersion: 'v3.5.0',
      }).supportedInboundTypes,
    ).toContain('mtproto-faketls');
    expect(
      buildNodeCapabilities({
        ...baseInput,
        panelVersion: undefined,
      }).supportedInboundTypes,
    ).not.toContain('mtproto-faketls');
  });

  it('parses versions with product-name prefixes', () => {
    expect(
      supportsInboundType('hysteria2-udp', {
        panelVersion: '3x-ui v3.7.1',
        xrayVersion: 'Xray 26.7.11',
        autoTlsCertificate: true,
      }),
    ).toBe(true);
  });
});

describe('modern Xray client profile', () => {
  it('keeps legacy WS on older nodes and directs current nodes to WS TLS', () => {
    const base = { panelVersion: '3.8.5', autoTlsCertificate: true };
    expect(
      supportsInboundType('vless-ws', { ...base, xrayVersion: '26.7.11' }),
    ).toBe(true);
    const capabilities = buildNodeCapabilities({
      ...base,
      xrayVersion: '26.9.9',
    });
    expect(capabilities.supportedInboundTypes).not.toContain('vless-ws');
    expect(capabilities.supportedInboundTypes).toContain('vless-ws-tls');
    expect(capabilities.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('WS TLS')]),
    );
  });
});
