import {
  buildRoutingPlan, emptyRoutingState, IP_CHECK_DOMAINS, presetTags,
  routingRevision, sniffingObject,
} from '../../src/nodes/routing/routing-presets';
import type { XrayTemplate } from '../../src/nodes/routing/routing-presets';
import type { XuiInboundRaw } from '../../src/xui/xui.types';

export const templateFixture = (): XrayTemplate => ({
  path: '/panel/api/xray', outboundTestUrl: 'https://example.com/test',
  config: {
    api: { tag: 'api' }, dns: { servers: ['localhost'] },
    outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
    routing: { domainStrategy: 'AsIs', rules: [
      { type: 'field', inboundTag: ['api'], outboundTag: 'api' },
      { type: 'field', network: 'tcp,udp', outboundTag: 'direct' },
    ] },
  },
});
export const inboundFixture = (): XuiInboundRaw => ({
  id: 42, protocol: 'vless', port: 443, enable: true,
  settings: JSON.stringify({ clients: [{ id: 'secret', email: 'client' }] }),
  streamSettings: JSON.stringify({ security: 'reality', realitySettings: { privateKey: 'private-key' } }),
  sniffing: JSON.stringify({ enabled: false, destOverride: ['fakedns'], routeOnly: false }),
});
const both = { blockRussia: true, blockIpCheckers: true };
const neither = { blockRussia: false, blockIpCheckers: false };

describe('routing preset transformations', () => {
  it('places separate domain and IP blocks after the API rule and ahead of catch-all, preserving default outbound', () => {
    const source = templateFixture();
    const plan = buildRoutingPlan('node', source, [inboundFixture()], emptyRoutingState(), both);
    const routing = plan.template.config.routing as { domainStrategy: string; rules: Record<string, unknown>[] };
    expect(routing.rules.map((r) => r.outboundTag)).toEqual(['api', ...Array(3).fill(presetTags('node').outbound), 'direct']);
    expect(routing.rules[1].domain).toEqual(['domain:ru', 'domain:su', 'domain:xn--p1ai', 'geosite:category-ru']);
    expect(routing.rules[1].ip).toBeUndefined();
    expect(routing.rules[2]).toMatchObject({ ip: ['geoip:ru'] });
    expect(routing.rules[2].domain).toBeUndefined();
    expect(routing.rules[3].domain).toEqual(IP_CHECK_DOMAINS.map((d) => `domain:${d}`));
    expect(routing.domainStrategy).toBe('IPOnDemand');
    expect(plan.template.config.outbounds?.[0]).toEqual(source.config.outbounds?.[0]);
    expect(source).toEqual(templateFixture());
  });

  it.each([both, { ...neither, blockRussia: true }, { ...neither, blockIpCheckers: true }])('is idempotent for %j and restores original settings after serialization', (selection) => {
    const source = templateFixture();
    const inbound = inboundFixture();
    const enabled = buildRoutingPlan('node', source, [inbound], emptyRoutingState(), selection);
    const state = JSON.parse(JSON.stringify(enabled.state));
    const repeated = buildRoutingPlan('node', enabled.template, enabled.inboundUpdates, state, selection);
    expect(repeated.changed).toBe(false);
    const disabled = buildRoutingPlan('node', enabled.template, enabled.inboundUpdates, state, neither);
    expect(disabled.template).toEqual(source);
    expect(disabled.inboundUpdates).toEqual([inbound]);
    expect(disabled.state.sniffing).toEqual({});
  });

  it('enables only routing sniffing and preserves clients, TLS, exclusions and existing protocols', () => {
    const inbound = inboundFixture();
    inbound.sniffing = JSON.stringify({ ...sniffingObject(inbound), domainsExcluded: ['example.com'] });
    const plan = buildRoutingPlan('node', templateFixture(), [inbound], emptyRoutingState(), both);
    const result = plan.inboundUpdates[0];
    expect(result.settings).toBe(inbound.settings);
    expect(result.streamSettings).toBe(inbound.streamSettings);
    expect(sniffingObject(result)).toEqual({ enabled: true, metadataOnly: false, routeOnly: true,
      destOverride: ['fakedns', 'http', 'tls', 'quic'], domainsExcluded: ['example.com'] });
    expect(plan.warnings[0]).toContain('исключения');
  });

  it('does not modify settings that already meet requirements or a sidecar protocol', () => {
    const source = templateFixture();
    source.config.routing = { ...(source.config.routing as object), domainStrategy: 'IPOnDemand' };
    const inbound = inboundFixture();
    inbound.sniffing = JSON.stringify({ enabled: true, routeOnly: true, metadataOnly: false, destOverride: ['http', 'tls', 'quic'] });
    const sidecar = { ...inbound, id: 43, protocol: 'amneziawg' };
    const plan = buildRoutingPlan('node', source, [inbound, sidecar], emptyRoutingState(), both);
    expect(plan.inboundUpdates).toHaveLength(0);
    expect(plan.state.strategy).toBeUndefined();
    expect(plan.warnings[0]).toContain('amneziawg');
  });

  it('keeps sniffing enabled until both presets are off', () => {
    const plan = buildRoutingPlan('node', templateFixture(), [inboundFixture()], emptyRoutingState(), both);
    const changed = buildRoutingPlan('node', plan.template, plan.inboundUpdates, plan.state, { ...neither, blockIpCheckers: true });
    expect(changed.inboundUpdates).toHaveLength(0);
    expect(changed.template.config.routing).toMatchObject({ domainStrategy: 'AsIs' });
    expect(changed.state.sniffing['42']).toBeDefined();
  });

  it('does not overwrite manual sniffing/strategy changes when disabling', () => {
    const plan = buildRoutingPlan('node', templateFixture(), [inboundFixture()], emptyRoutingState(), both);
    (plan.template.config.routing as Record<string, unknown>).domainStrategy = 'IPIfNonMatch';
    const inbound = { ...plan.inboundUpdates[0], sniffing: JSON.stringify({ ...sniffingObject(plan.inboundUpdates[0]), destOverride: ['http'] }) };
    const disabled = buildRoutingPlan('node', plan.template, [inbound], plan.state, neither);
    expect(disabled.template.config.routing).toMatchObject({ domainStrategy: 'IPIfNonMatch' });
    expect(sniffingObject(disabled.inboundUpdates[0]).destOverride).toEqual(['http']);
    expect(disabled.warnings).toHaveLength(2);
  });

  it('preserves a managed outbound referenced by a manually added rule', () => {
    const plan = buildRoutingPlan('node', templateFixture(), [], emptyRoutingState(), both);
    const routing = plan.template.config.routing as { rules: object[] };
    routing.rules.push({ domain: ['domain:custom.test'], outboundTag: presetTags('node').outbound });
    const disabled = buildRoutingPlan('node', plan.template, [], plan.state, neither);
    expect(disabled.template.config.outbounds).toHaveLength(2);
    expect((disabled.template.config.routing as { rules: object[] }).rules).toContainEqual({ domain: ['domain:custom.test'], outboundTag: presetTags('node').outbound });
  });

  it('rejects occupied tags and modified managed rules without touching the source', () => {
    const plan = buildRoutingPlan('node', templateFixture(), [], emptyRoutingState(), both);
    expect(() => buildRoutingPlan('node', plan.template, [], emptyRoutingState(), both)).toThrow('метка занята');
    const rules = (plan.template.config.routing as { rules: Record<string, unknown>[] }).rules;
    rules[1].outboundTag = 'direct';
    expect(() => buildRoutingPlan('node', plan.template, [], plan.state, both)).toThrow('изменено вручную');
  });

  it('does not persist a request revision and ignores traffic counters in revision checks', () => {
    const source = templateFixture();
    const inbound = inboundFixture();
    const plan = buildRoutingPlan('node', source, [inbound], emptyRoutingState(), { ...both, revision: 'secret' } as typeof both);
    expect(plan.state).not.toHaveProperty('revision');
    expect(routingRevision(source, [inbound], emptyRoutingState())).toBe(routingRevision(source, [{ ...inbound, up: 10, down: 20 }], emptyRoutingState()));
    expect(routingRevision(source, [inbound], emptyRoutingState())).not.toBe(routingRevision(source, [{ ...inbound, sniffing: '{}' }], emptyRoutingState()));
  });

  it('restores missing fields rather than assigning undefined after a DB round-trip', () => {
    const source = templateFixture();
    delete (source.config.routing as Record<string, unknown>).domainStrategy;
    const inbound = { ...inboundFixture(), sniffing: '{}' };
    const plan = buildRoutingPlan('node', source, [inbound], emptyRoutingState(), both);
    const restored = buildRoutingPlan('node', plan.template, plan.inboundUpdates, JSON.parse(JSON.stringify(plan.state)), neither);
    expect(restored.template).toEqual(source);
    expect(sniffingObject(restored.inboundUpdates[0])).toEqual({});
  });
});
