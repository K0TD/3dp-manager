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
});
