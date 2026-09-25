import {
  buildRoutingPlan,
  emptyRoutingState,
  IP_CHECK_DOMAINS,
  presetTags,
  routingRevision,
  sniffingObject,
} from '../../src/nodes/routing/routing-presets';
import type { XrayTemplate } from '../../src/nodes/routing/routing-presets';
import type { XuiInboundRaw } from '../../src/xui/xui.types';

export const templateFixture = (): XrayTemplate => ({
  path: '/panel/api/xray',
  outboundTestUrl: 'https://example.com/test',
  config: {
    api: { tag: 'api' },
    dns: { servers: ['localhost'] },
    outbounds: [
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'blocked', protocol: 'blackhole' },
      {
        tag: 'IPv4',
        protocol: 'freedom',
        settings: { domainStrategy: 'UseIPv4' },
      },
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        { type: 'field', inboundTag: ['api'], outboundTag: 'api' },
        { type: 'field', network: 'tcp,udp', outboundTag: 'direct' },
      ],
    },
  },
});
export const inboundFixture = (): XuiInboundRaw => ({
  id: 42,
  protocol: 'vless',
  port: 443,
  enable: true,
  settings: JSON.stringify({ clients: [{ id: 'secret', email: 'client' }] }),
  streamSettings: JSON.stringify({
    security: 'reality',
    realitySettings: { privateKey: 'private-key' },
  }),
  sniffing: JSON.stringify({
    enabled: false,
    destOverride: ['fakedns'],
    routeOnly: false,
  }),
});
const both = { blockRussia: true, blockIpCheckers: true };
const neither = { blockRussia: false, blockIpCheckers: false };

describe('routing preset transformations', () => {
  it('places separate domain and IP blocks after the API rule and ahead of catch-all, preserving default outbound', () => {
    const source = templateFixture();
    const plan = buildRoutingPlan(
      'node',
      { template: source, inbounds: [inboundFixture()] },
      emptyRoutingState(),
      both,
    );
    const routing = plan.template.config.routing as {
      domainStrategy: string;
      rules: Record<string, unknown>[];
    };
    expect(routing.rules.map((r) => r.outboundTag)).toEqual([
      'api',
      ...Array(3).fill(presetTags('node').outbound),
      'direct',
    ]);
    expect(routing.rules[1].domain).toEqual([
      'domain:ru',
      'domain:su',
      'domain:xn--p1ai',
      'geosite:category-ru',
    ]);
    expect(routing.rules[1].ip).toBeUndefined();
    expect(routing.rules[2]).toMatchObject({ ip: ['geoip:ru'] });
    expect(routing.rules[2].domain).toBeUndefined();
    expect(routing.rules[3].domain).toEqual(
      IP_CHECK_DOMAINS.map((d) => `domain:${d}`),
    );
    expect(routing.domainStrategy).toBe('IPOnDemand');
    expect(plan.template.config.outbounds?.[0]).toEqual(
      source.config.outbounds?.[0],
    );
    expect(source).toEqual(templateFixture());
  });

  it.each([
    both,
    { ...neither, blockRussia: true },
    { ...neither, blockIpCheckers: true },
  ])(
    'is idempotent for %j and restores original settings after serialization',
    (selection) => {
      const source = templateFixture();
      const inbound = inboundFixture();
      const enabled = buildRoutingPlan(
        'node',
        { template: source, inbounds: [inbound] },
        emptyRoutingState(),
        selection,
      );
      const state = JSON.parse(JSON.stringify(enabled.state));
      const repeated = buildRoutingPlan(
        'node',
        { template: enabled.template, inbounds: enabled.inboundUpdates },
        state,
        selection,
      );
      expect(repeated.changed).toBe(false);
      const disabled = buildRoutingPlan(
        'node',
        { template: enabled.template, inbounds: enabled.inboundUpdates },
        state,
        neither,
      );
      expect(disabled.template).toEqual(source);
      expect(disabled.inboundUpdates).toEqual([inbound]);
      expect(disabled.state.sniffing).toEqual({});
    },
  );

  it('enables only routing sniffing and preserves clients, TLS, exclusions and existing protocols', () => {
    const inbound = inboundFixture();
    inbound.sniffing = JSON.stringify({
      ...sniffingObject(inbound),
      domainsExcluded: ['example.com'],
    });
    const plan = buildRoutingPlan(
      'node',
      { template: templateFixture(), inbounds: [inbound] },
      emptyRoutingState(),
      both,
    );
    const result = plan.inboundUpdates[0];
    expect(result.settings).toBe(inbound.settings);
    expect(result.streamSettings).toBe(inbound.streamSettings);
    expect(sniffingObject(result)).toEqual({
      enabled: true,
      metadataOnly: false,
      routeOnly: true,
      destOverride: ['fakedns', 'http', 'tls', 'quic'],
      domainsExcluded: ['example.com'],
    });
    expect(plan.warnings[0]).toContain('исключения');
  });

  it('does not modify settings that already meet requirements or a sidecar protocol', () => {
    const source = templateFixture();
    source.config.routing = {
      ...(source.config.routing as object),
      domainStrategy: 'IPOnDemand',
    };
    const inbound = inboundFixture();
    inbound.sniffing = JSON.stringify({
      enabled: true,
      routeOnly: true,
      metadataOnly: false,
      destOverride: ['http', 'tls', 'quic'],
    });
    const sidecar = { ...inbound, id: 43, protocol: 'amneziawg' };
    const plan = buildRoutingPlan(
      'node',
      { template: source, inbounds: [inbound, sidecar] },
      emptyRoutingState(),
      both,
    );
    expect(plan.inboundUpdates).toHaveLength(0);
    expect(plan.state.strategy).toBeUndefined();
    expect(plan.warnings[0]).toContain('amneziawg');
  });

  it('keeps sniffing enabled until both presets are off', () => {
    const plan = buildRoutingPlan(
      'node',
      { template: templateFixture(), inbounds: [inboundFixture()] },
      emptyRoutingState(),
      both,
    );
    const changed = buildRoutingPlan(
      'node',
      { template: plan.template, inbounds: plan.inboundUpdates },
      plan.state,
      { ...neither, blockIpCheckers: true },
    );
    expect(changed.inboundUpdates).toHaveLength(0);
    expect(changed.template.config.routing).toMatchObject({
      domainStrategy: 'AsIs',
    });
    expect(changed.state.sniffing['42']).toBeDefined();
  });

  it('does not overwrite manual sniffing/strategy changes when disabling', () => {
    const plan = buildRoutingPlan(
      'node',
      { template: templateFixture(), inbounds: [inboundFixture()] },
      emptyRoutingState(),
      both,
    );
    (plan.template.config.routing as Record<string, unknown>).domainStrategy =
      'IPIfNonMatch';
    const inbound = {
      ...plan.inboundUpdates[0],
      sniffing: JSON.stringify({
        ...sniffingObject(plan.inboundUpdates[0]),
        destOverride: ['http'],
      }),
    };
    const disabled = buildRoutingPlan(
      'node',
      { template: plan.template, inbounds: [inbound] },
      plan.state,
      neither,
    );
    expect(disabled.template.config.routing).toMatchObject({
      domainStrategy: 'IPIfNonMatch',
    });
    expect(sniffingObject(disabled.inboundUpdates[0]).destOverride).toEqual([
      'http',
    ]);
    expect(disabled.warnings).toHaveLength(2);
  });

  it('preserves a managed outbound referenced by a manually added rule', () => {
    const plan = buildRoutingPlan(
      'node',
      { template: templateFixture(), inbounds: [] },
      emptyRoutingState(),
      both,
    );
    const routing = plan.template.config.routing as { rules: object[] };
    routing.rules.push({
      domain: ['domain:custom.test'],
      outboundTag: presetTags('node').outbound,
    });
    const disabled = buildRoutingPlan(
      'node',
      { template: plan.template, inbounds: [] },
      plan.state,
      neither,
    );
    expect(disabled.template.config.outbounds).toEqual(
      templateFixture().config.outbounds,
    );
    expect(
      (disabled.template.config.routing as { rules: object[] }).rules,
    ).toContainEqual({
      domain: ['domain:custom.test'],
      outboundTag: presetTags('node').outbound,
    });
  });

  it('rejects occupied tags and modified managed rules without touching the source', () => {
    const plan = buildRoutingPlan(
      'node',
      { template: templateFixture(), inbounds: [] },
      emptyRoutingState(),
      both,
    );
    expect(() =>
      buildRoutingPlan(
        'node',
        { template: plan.template, inbounds: [] },
        emptyRoutingState(),
        both,
      ),
    ).toThrow('метка занята');
    const rules = (
      plan.template.config.routing as { rules: Record<string, unknown>[] }
    ).rules;
    rules[1].outboundTag = 'direct';
    expect(() =>
      buildRoutingPlan(
        'node',
        { template: plan.template, inbounds: [] },
        plan.state,
        both,
      ),
    ).toThrow('изменено вручную');
  });

  it('does not persist a request revision and ignores traffic counters in revision checks', () => {
    const source = templateFixture();
    const inbound = inboundFixture();
    const plan = buildRoutingPlan(
      'node',
      { template: source, inbounds: [inbound] },
      emptyRoutingState(),
      { ...both, revision: 'secret' } as typeof both,
    );
    expect(plan.state).not.toHaveProperty('revision');
    expect(routingRevision(source, [inbound], emptyRoutingState())).toBe(
      routingRevision(
        source,
        [{ ...inbound, up: 10, down: 20 }],
        emptyRoutingState(),
      ),
    );
    expect(routingRevision(source, [inbound], emptyRoutingState())).not.toBe(
      routingRevision(
        source,
        [{ ...inbound, sniffing: '{}' }],
        emptyRoutingState(),
      ),
    );
  });

  it('restores missing fields rather than assigning undefined after a DB round-trip', () => {
    const source = templateFixture();
    delete (source.config.routing as Record<string, unknown>).domainStrategy;
    const inbound = { ...inboundFixture(), sniffing: '{}' };
    const plan = buildRoutingPlan(
      'node',
      { template: source, inbounds: [inbound] },
      emptyRoutingState(),
      both,
    );
    const restored = buildRoutingPlan(
      'node',
      { template: plan.template, inbounds: plan.inboundUpdates },
      JSON.parse(JSON.stringify(plan.state)),
      neither,
    );
    expect(restored.template).toEqual(source);
    expect(sniffingObject(restored.inboundUpdates[0])).toEqual({});
  });
});

describe('existing routing outbounds and Google', () => {
  const googleRule = {
    type: 'field',
    domain: ['geosite:google'],
    outboundTag: 'IPv4',
  };
  const rulesOf = (template: XrayTemplate) =>
    (template.config.routing as { rules: Record<string, unknown>[] }).rules;
  const outboundsOf = (template: XrayTemplate) =>
    template.config.outbounds as Record<string, unknown>[];
  const googleOnly = { ...neither, googleIpv4: true };

  it('adopts, disables and restores an existing Google rule without duplicates or outbound changes', () => {
    const source = templateFixture();
    const originalRule = {
      ...googleRule,
      ruleTag: 'panel-google',
      enabled: true,
    };
    rulesOf(source).splice(1, 0, originalRule);
    const enabled = buildRoutingPlan(
      'node',
      { template: source, inbounds: [] },
      emptyRoutingState(),
      googleOnly,
    );
    expect(enabled.changed).toBe(false);
    expect(enabled.state.googleRule).toEqual(originalRule);
    const disabled = buildRoutingPlan(
      'node',
      { template: enabled.template, inbounds: [] },
      enabled.state,
      { ...neither, googleIpv4: false },
    );
    expect(rulesOf(disabled.template)).not.toContainEqual(originalRule);
    const restored = buildRoutingPlan(
      'node',
      { template: disabled.template, inbounds: [] },
      JSON.parse(JSON.stringify(disabled.state)),
      googleOnly,
    );
    expect(restored.template).toEqual(source);
    expect(outboundsOf(restored.template)).toEqual(outboundsOf(source));
  });

  it('preserves Google for legacy requests without the new field, and keeps sniffing until all three presets are off', () => {
    const source = templateFixture();
    rulesOf(source).push(googleRule);
    const active = buildRoutingPlan(
      'node',
      { template: source, inbounds: [inboundFixture()] },
      emptyRoutingState(),
      both,
    );
    expect(active.state.googleIpv4).toBe(true);
    const google = buildRoutingPlan(
      'node',
      { template: active.template, inbounds: active.inboundUpdates },
      active.state,
      neither,
    );
    expect(google.state.googleIpv4).toBe(true);
    expect(google.inboundUpdates).toEqual([]);
    expect(google.template.config.routing).toMatchObject({
      domainStrategy: 'AsIs',
    });
    const off = buildRoutingPlan(
      'node',
      { template: google.template, inbounds: active.inboundUpdates },
      google.state,
      { ...neither, googleIpv4: false },
    );
    expect(off.inboundUpdates).toEqual([inboundFixture()]);
  });

  it('puts Google behind API and blocking rules while preserving other rule order', () => {
    const source = templateFixture();
    const privateBlock = {
      type: 'field',
      ip: ['geoip:private'],
      outboundTag: 'blocked',
    };
    const torrentBlock = {
      type: 'field',
      protocol: ['bittorrent'],
      outboundTag: 'blocked',
    };
    rulesOf(source).splice(1, 0, privateBlock, torrentBlock);
    const plan = buildRoutingPlan(
      'node',
      { template: source, inbounds: [] },
      emptyRoutingState(),
      { ...both, googleIpv4: true },
    );
    const rules = rulesOf(plan.template);
    expect(rules.map((rule) => rule.outboundTag)).toEqual([
      'api',
      'blocked',
      'blocked',
      'blocked',
      'blocked',
      'blocked',
      'IPv4',
      'direct',
    ]);
    expect(rules[4]).toEqual(privateBlock);
    expect(rules[5]).toEqual(torrentBlock);
  });

  it('does not adopt conditional Google rules or change DNS', () => {
    const source = templateFixture();
    const conditional = { ...googleRule, inboundTag: ['special'] };
    rulesOf(source).splice(1, 0, conditional);
    const plan = buildRoutingPlan(
      'node',
      { template: source, inbounds: [] },
      emptyRoutingState(),
      googleOnly,
    );
    expect(rulesOf(plan.template)).toContainEqual(conditional);
    expect(
      rulesOf(plan.template).filter((rule) => rule.outboundTag === 'IPv4'),
    ).toHaveLength(2);
    expect(plan.template.config.dns).toEqual(source.config.dns);
  });

  it('rejects duplicate simple Google rules rather than deleting manual configuration', () => {
    const source = templateFixture();
    rulesOf(source).push(googleRule, { ...googleRule, ruleTag: 'other' });
    expect(() =>
      buildRoutingPlan(
        'node',
        { template: source, inbounds: [] },
        emptyRoutingState(),
        googleOnly,
      ),
    ).toThrow('несколько правил');
    expect(rulesOf(source)).toHaveLength(4);
  });

  it('rejects a modified managed Google rule, including when turning it off', () => {
    const active = buildRoutingPlan(
      'node',
      { template: templateFixture(), inbounds: [] },
      emptyRoutingState(),
      googleOnly,
    );
    rulesOf(active.template).find((rule) => rule.outboundTag === 'IPv4')!.port =
      '443';
    expect(() =>
      buildRoutingPlan(
        'node',
        { template: active.template, inbounds: [] },
        active.state,
        { ...neither, googleIpv4: false },
      ),
    ).toThrow('изменено вручную');
  });

  it('accepts enabled=true added by the panel without repeatedly rewriting the template', () => {
    const active = buildRoutingPlan(
      'node',
      { template: templateFixture(), inbounds: [] },
      emptyRoutingState(),
      googleOnly,
    );
    rulesOf(active.template).find(
      (rule) => rule.outboundTag === 'IPv4',
    )!.enabled = true;
    const repeated = buildRoutingPlan(
      'node',
      { template: active.template, inbounds: [] },
      active.state,
      googleOnly,
    );
    expect(repeated.changed).toBe(false);
  });

  it.each(['missing', 'wrong protocol', 'duplicate'])(
    'rejects a %s blocked outbound before changing anything',
    (kind) => {
      const source = templateFixture();
      if (kind === 'missing')
        source.config.outbounds = outboundsOf(source).filter(
          (o) => o.tag !== 'blocked',
        );
      if (kind === 'wrong protocol')
        outboundsOf(source).find((o) => o.tag === 'blocked')!.protocol =
          'freedom';
      if (kind === 'duplicate')
        outboundsOf(source).push({ tag: 'blocked', protocol: 'blackhole' });
      const original = structuredClone(source);
      expect(() =>
        buildRoutingPlan(
          'node',
          { template: source, inbounds: [] },
          emptyRoutingState(),
          both,
        ),
      ).toThrow('blocked');
      expect(source).toEqual(original);
      expect(
        buildRoutingPlan(
          'node',
          { template: source, inbounds: [] },
          emptyRoutingState(),
          googleOnly,
        ).state.googleIpv4,
      ).toBe(true);
    },
  );

  it.each(['missing', 'wrong protocol', 'UseIPv6', 'lowercase tag'])(
    'rejects an incompatible IPv4 outbound: %s',
    (kind) => {
      const source = templateFixture();
      const ipv4 = outboundsOf(source).find((o) => o.tag === 'IPv4')!;
      if (kind === 'missing')
        source.config.outbounds = outboundsOf(source).filter((o) => o !== ipv4);
      if (kind === 'wrong protocol') ipv4.protocol = 'blackhole';
      if (kind === 'UseIPv6') ipv4.settings = { domainStrategy: 'UseIPv6' };
      if (kind === 'lowercase tag') ipv4.tag = 'ipv4';
      expect(() =>
        buildRoutingPlan(
          'node',
          { template: source, inbounds: [] },
          emptyRoutingState(),
          googleOnly,
        ),
      ).toThrow('IPv4');
      expect(
        buildRoutingPlan(
          'node',
          { template: source, inbounds: [] },
          emptyRoutingState(),
          both,
        ).state.blockRussia,
      ).toBe(true);
    },
  );

  it.each([
    'unused',
    'manual rule',
    'dialerProxy',
    'modified outbound',
    'not owned',
  ])(
    'migrates legacy blocks and only removes an unmodified, owned, unused outbound: %s',
    (kind) => {
      const enabled = buildRoutingPlan(
        'node',
        { template: templateFixture(), inbounds: [] },
        emptyRoutingState(),
        both,
      );
      const legacyTag = presetTags('node').legacyOutbound;
      for (const rule of rulesOf(enabled.template))
        if (rule.ruleTag) rule.outboundTag = legacyTag;
      const legacy = { tag: legacyTag, protocol: 'blackhole', settings: {} };
      outboundsOf(enabled.template).push(legacy);
      enabled.state.outboundOwned = kind !== 'not owned';
      if (kind === 'manual rule')
        rulesOf(enabled.template).push({
          type: 'field',
          domain: ['domain:custom.test'],
          outboundTag: legacyTag,
        });
      if (kind === 'dialerProxy')
        outboundsOf(enabled.template)[0].streamSettings = {
          sockopt: { dialerProxy: legacyTag },
        };
      if (kind === 'modified outbound')
        legacy.settings = { response: { type: 'http' } };
      if (kind === 'not owned') {
        expect(() =>
          buildRoutingPlan(
            'node',
            { template: enabled.template, inbounds: [] },
            enabled.state,
            both,
          ),
        ).toThrow('изменено вручную');
        return;
      }
      const migrated = buildRoutingPlan(
        'node',
        { template: enabled.template, inbounds: [] },
        enabled.state,
        both,
      );
      expect(
        rulesOf(migrated.template)
          .filter((rule) => rule.ruleTag)
          .every((rule) => rule.outboundTag === 'blocked'),
      ).toBe(true);
      expect(
        outboundsOf(migrated.template).some((o) => o.tag === legacyTag),
      ).toBe(kind !== 'unused');
      expect(outboundsOf(migrated.template)).toContainEqual({
        tag: 'blocked',
        protocol: 'blackhole',
      });
    },
  );

  it('adopts manually modified rules when forceAdopt is true', () => {
    const plan = buildRoutingPlan(
      'node',
      { template: templateFixture(), inbounds: [] },
      emptyRoutingState(),
      both,
    );
    const rules = (
      plan.template.config.routing as { rules: Record<string, unknown>[] }
    ).rules;
    // Modify the preset rule manually
    rules[1].domain = ['domain:ru', 'regexp:.*\\.ru$', 'ext:geosite_RU.dat:custom'];
    expect(() =>
      buildRoutingPlan(
        'node',
        { template: plan.template, inbounds: [] },
        plan.state,
        both,
      ),
    ).toThrow('изменено вручную');

    // With forceAdopt: true, adoption succeeds
    const adopted = buildRoutingPlan(
      'node',
      { template: plan.template, inbounds: [] },
      plan.state,
      { ...both, forceAdopt: true },
    );
    expect(adopted.changed).toBe(true);
    const adoptedRules = (
      adopted.template.config.routing as { rules: Record<string, unknown>[] }
    ).rules;
    expect(adoptedRules[1].domain).toEqual([
      'domain:ru',
      'domain:su',
      'domain:xn--p1ai',
      'geosite:category-ru',
    ]);
  });

  it('preserves geoip:private when bundled into an owned rule, even when presets are disabled', () => {
    const plan = buildRoutingPlan(
      'node',
      { template: templateFixture(), inbounds: [] },
      emptyRoutingState(),
      both,
    );
    const rules = (
      plan.template.config.routing as { rules: Record<string, unknown>[] }
    ).rules;
    // Bundle geoip:private into ru-ips (simulating manual panel edit)
    rules[2].ip = ['geoip:private', 'ext:geoip_RU.dat:ru'];

    // Disabling Russia with forceAdopt should preserve geoip:private as an unmanaged rule
    const disabled = buildRoutingPlan(
      'node',
      { template: plan.template, inbounds: [] },
      plan.state,
      { blockRussia: false, blockIpCheckers: false, forceAdopt: true },
    );
    const disabledRules = (
      disabled.template.config.routing as { rules: Record<string, unknown>[] }
    ).rules;
    const privateRule = disabledRules.find(
      (r) => Array.isArray(r.ip) && r.ip.includes('geoip:private'),
    );
    expect(privateRule).toBeDefined();
    expect(privateRule?.outboundTag).toBe('blocked');
    expect(privateRule?.ruleTag).toBeUndefined();
  });
});
