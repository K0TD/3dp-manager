import { createHash } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { asRecord, jsonObject } from '../../xui/xui-contract';
import type { XuiInboundRaw } from '../../xui/xui.types';

export type ConfigObject = Record<string, unknown>;
export interface RoutingSelection {
  blockRussia: boolean;
  blockIpCheckers: boolean;
  googleIpv4?: boolean;
  forceAdopt?: boolean;
}
export interface FieldChange {
  before?: unknown;
  after: unknown;
}
export interface SniffingChange {
  identity: string;
  fields: Record<string, FieldChange>;
}
export interface RoutingPresetState extends RoutingSelection {
  strategy?: FieldChange;
  sniffing: Record<string, SniffingChange>;
  outboundOwned?: boolean;
  googleRule?: ConfigObject;
  // Persisted before remote writes; a failed/unknown operation must not look applied.
  pending?: boolean;
  pendingPrevious?: Omit<RoutingPresetState, 'pendingPrevious'>;
}
export interface XrayTemplate {
  path: '/panel/api/xray' | '/panel/xray';
  config: ConfigObject;
  outboundTestUrl: string;
}
export const IP_CHECK_DOMAINS = [
  '2ip.ru',
  '2ip.io',
  'whoer.net',
  'browserleaks.com',
  'dnsleaktest.com',
  'ipinfo.io',
  'ip-api.com',
  'ifconfig.me',
  'icanhazip.com',
  'whatismyipaddress.com',
];
export const RUSSIA_DOMAINS = [
  'domain:ru',
  'domain:su',
  'domain:xn--p1ai',
  'geosite:category-ru',
];
// These are native user-facing Xray protocols. Panel sidecars are not covered.
const SNIFFING_PROTOCOLS = new Set([
  'vless',
  'vmess',
  'trojan',
  'shadowsocks',
  'socks',
  'http',
  'dokodemo-door',
  'tunnel',
  'wireguard',
  'hysteria',
  'tun',
]);

export function emptyRoutingState(): RoutingPresetState {
  return { blockRussia: false, blockIpCheckers: false, sniffing: {} };
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = asRecord(value);
  if (record)
    return `{${Object.keys(record)
      .sort()
      .filter((k) => record[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
export function equal(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
export function routingRevision(
  template: XrayTemplate,
  inbounds: XuiInboundRaw[],
  state: RoutingPresetState,
): string {
  return createHash('sha256')
    .update(
      canonical({
        template,
        // Traffic counters change continuously and are not configuration revisions.
        inbounds: inbounds
          .map((i) => ({
            id: i.id,
            identity: inboundIdentity(i),
            sniffing: sniffingObject(i),
          }))
          .sort((a, b) => Number(a.id) - Number(b.id)),
        state,
      }),
    )
    .digest('hex');
}
export function inboundIdentity(inbound: XuiInboundRaw): string {
  return canonical([inbound.protocol, inbound.port, inbound.listen || '']);
}
export function sniffingObject(inbound: XuiInboundRaw): ConfigObject {
  return jsonObject(inbound.sniffing, 'sniffing', true);
}
export function supportsSniffing(inbound: XuiInboundRaw): boolean {
  return SNIFFING_PROTOCOLS.has(inbound.protocol);
}
export function hasPresets(selection: RoutingSelection): boolean {
  return (
    selection.blockRussia ||
    selection.blockIpCheckers ||
    selection.googleIpv4 === true
  );
}
export function presetTags(nodeId: string) {
  const prefix = `3dp:${nodeId}:`;
  return {
    outbound: 'blocked',
    legacyOutbound: `${prefix}block`,
    google: `${prefix}google-ipv4`,
    russia: `${prefix}ru-domains`,
    ips: `${prefix}ru-ips`,
    checkers: `${prefix}ip-checkers`,
  };
}
export function presetRules(
  nodeId: string,
  selection: RoutingSelection,
): ConfigObject[] {
  const tags = presetTags(nodeId);
  const rule = (ruleTag: string, match: ConfigObject) => ({
    type: 'field',
    ruleTag,
    ...match,
    outboundTag: tags.outbound,
  });
  return [
    ...(selection.blockRussia
      ? [
          rule(tags.russia, { domain: RUSSIA_DOMAINS }),
          rule(tags.ips, { ip: ['geoip:ru'] }),
        ]
      : []),
    ...(selection.blockIpCheckers
      ? [
          rule(tags.checkers, {
            domain: IP_CHECK_DOMAINS.map((d) => `domain:${d}`),
          }),
        ]
      : []),
  ];
}

function objects(value: unknown, field: string): ConfigObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => !asRecord(v)))
    throw new Error(`Некорректный ${field} в конфигурации 3x-ui`);
  return value as ConfigObject[];
}

function singleOutbound(
  config: ConfigObject,
  tag: string,
): ConfigObject | undefined {
  const matches = objects(config.outbounds, 'outbounds').filter(
    (outbound) => outbound.tag === tag,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function isIpv4Outbound(outbound?: ConfigObject): boolean {
  const settings = asRecord(outbound?.settings);
  const sockopt = asRecord(asRecord(outbound?.streamSettings)?.sockopt);
  const strategy =
    settings?.targetStrategy ||
    settings?.domainStrategy ||
    sockopt?.domainStrategy;
  return (
    outbound?.protocol === 'freedom' &&
    (strategy === 'UseIPv4' || strategy === 'ForceIPv4')
  );
}

export function routingCapabilities(config: ConfigObject) {
  const blocking = singleOutbound(config, 'blocked')?.protocol === 'blackhole';
  const googleIpv4 = isIpv4Outbound(singleOutbound(config, 'IPv4'));
  return {
    blocking: {
      available: blocking,
      reason: blocking
        ? undefined
        : 'В панели нужен выход blocked с протоколом blackhole.',
    },
    googleIpv4: {
      available: googleIpv4,
      reason: googleIpv4
        ? undefined
        : 'В панели нужен выход IPv4 с протоколом freedom и стратегией UseIPv4 или ForceIPv4.',
    },
  };
}

function isGoogleRule(rule: ConfigObject): boolean {
  return (
    rule.type === 'field' &&
    rule.outboundTag === 'IPv4' &&
    equal(rule.domain, ['geosite:google']) &&
    (rule.enabled === undefined || typeof rule.enabled === 'boolean') &&
    (rule.ruleTag === undefined || typeof rule.ruleTag === 'string') &&
    Object.keys(rule).every((key) =>
      ['type', 'outboundTag', 'domain', 'enabled', 'ruleTag'].includes(key),
    )
  );
}

export function googleSelection(
  config: ConfigObject,
  state: RoutingPresetState,
): boolean {
  const rules = objects(asRecord(config.routing)?.rules, 'routing.rules');
  if (state.googleRule || state.pending) return state.googleIpv4 === true;
  return (
    state.googleIpv4 === true ||
    rules.some((rule) => isGoogleRule(rule) && rule.enabled !== false)
  );
}

function enabledGoogleRule(rule: ConfigObject): ConfigObject {
  return { ...rule, ...(rule.enabled === undefined ? {} : { enabled: true }) };
}

function sameGoogleRule(left: ConfigObject, right: ConfigObject): boolean {
  const { enabled: _leftEnabled, ...leftFields } = left;
  const { enabled: _rightEnabled, ...rightFields } = right;
  return equal(leftFields, rightFields);
}

function existingGoogleRule(
  nodeId: string,
  rules: ConfigObject[],
  state: RoutingPresetState,
  forceAdopt?: boolean,
) {
  // Zero matches means a new rule; multiple matches cannot be adopted unambiguously.
  const candidates = rules.filter(isGoogleRule);
  if (candidates.length > 1)
    throw new ConflictException(
      'Найдено несколько правил Google → IPv4. Удалите дубликаты в 3x-ui.',
    );
  const existing = candidates[0];
  const tag = state.googleRule?.ruleTag || presetTags(nodeId).google;
  if (!forceAdopt) {
    if (rules.some((rule) => rule.ruleTag === tag && rule !== existing))
      throw new ConflictException(
        'Правило Google изменено вручную или его метка занята.',
      );
    if (
      existing &&
      state.googleRule &&
      !sameGoogleRule(existing, state.googleRule)
    )
      throw new ConflictException(
        'Правило Google изменено вручную. Проверьте настройки 3x-ui.',
      );
  }
  return existing;
}

function googlePlan(
  nodeId: string,
  rules: ConfigObject[],
  state: RoutingPresetState,
  forceAdopt?: boolean,
) {
  const existing = existingGoogleRule(nodeId, rules, state, forceAdopt);
  // A disabled, previously unmanaged rule stays untouched until explicitly enabled.
  if (
    !state.googleIpv4 &&
    !state.googleRule &&
    (!existing || existing.enabled === false)
  )
    return { others: rules, managed: [], googleRule: undefined };
  const googleRule =
    state.googleRule ||
    structuredClone(
      existing || {
        type: 'field',
        ruleTag: presetTags(nodeId).google,
        domain: ['geosite:google'],
        outboundTag: 'IPv4',
      },
    );
  return {
    others: rules.filter((rule) => rule !== existing),
    managed: state.googleIpv4
      ? [enabledGoogleRule(existing || googleRule)]
      : [],
    googleRule,
  };
}
function restoreFields(
  target: ConfigObject,
  changes: Record<string, FieldChange>,
) {
  const restored = structuredClone(target);
  const warnings: string[] = [];
  for (const [key, change] of Object.entries(changes)) {
    if (!equal(restored[key], change.after)) {
      warnings.push(`Поле ${key} изменено вручную и оставлено без изменений.`);
      continue;
    }
    if (change.before === undefined) delete restored[key];
    else restored[key] = structuredClone(change.before);
  }
  return { restored, warnings };
}

function stringArray(input: unknown): string[] {
  if (input === undefined) return [];
  if (
    !Array.isArray(input) ||
    input.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error('Некорректный список протоколов sniffing');
  }
  return input as string[];
}

export function prepareSniffing(
  inbound: XuiInboundRaw,
  previous?: SniffingChange,
): { inbound: XuiInboundRaw; change: SniffingChange } {
  const original = sniffingObject(inbound);
  const next: ConfigObject = {
    ...original,
    enabled: true,
    metadataOnly: false,
    routeOnly: true,
    destOverride: [
      ...new Set([
        ...stringArray(original.destOverride),
        'http',
        'tls',
        'quic',
      ]),
    ],
  };
  const change: SniffingChange =
    previous?.identity === inboundIdentity(inbound)
      ? structuredClone(previous)
      : { identity: inboundIdentity(inbound), fields: {} };
  for (const key of ['enabled', 'metadataOnly', 'routeOnly', 'destOverride']) {
    if (
      change.fields[key] &&
      !equal(original[key], change.fields[key].after) &&
      !equal(original[key], change.fields[key].before)
    ) {
      throw new ConflictException(
        `Sniffing inbound ${inbound.id} изменён вручную. Восстановите настройки в 3x-ui перед повторным применением.`,
      );
    }
    if (!equal(original[key], next[key]))
      change.fields[key] ??= { before: original[key], after: next[key] };
  }
  return { inbound: { ...inbound, sniffing: JSON.stringify(next) }, change };
}

export interface RoutingSnapshot {
  template: XrayTemplate;
  inbounds: XuiInboundRaw[];
}

function recoveredState(previous: RoutingPresetState): RoutingPresetState {
  const recovered = {
    ...structuredClone(previous.pendingPrevious),
    ...structuredClone(previous),
    strategy: previous.strategy || previous.pendingPrevious?.strategy,
    outboundOwned:
      previous.outboundOwned || previous.pendingPrevious?.outboundOwned,
    googleRule: previous.googleRule || previous.pendingPrevious?.googleRule,
    sniffing: { ...previous.pendingPrevious?.sniffing, ...previous.sniffing },
  };
  delete recovered.pendingPrevious;
  return recovered;
}

function foreignRules(
  nodeId: string,
  rules: ConfigObject[],
  previous: RoutingPresetState,
  forceAdopt?: boolean,
): ConfigObject[] {
  const tags = presetTags(nodeId);
  const ownedTags = [tags.russia, tags.ips, tags.checkers];
  const owned = (rule: ConfigObject) =>
    typeof rule.ruleTag === 'string' && ownedTags.includes(rule.ruleTag);
  const expectedRules = [
    ...presetRules(nodeId, previous),
    ...(previous.pendingPrevious
      ? presetRules(nodeId, previous.pendingPrevious)
      : []),
  ];
  if (!forceAdopt) {
    for (const rule of rules.filter(owned)) {
      // The panel can add its own UI-only enabled=true field.
      const { enabled, ...withoutEnabled } = rule;
      const expected = expectedRules.some(
        (candidate) =>
          equal(withoutEnabled, candidate) ||
          ((previous.outboundOwned || previous.pendingPrevious?.outboundOwned) &&
            equal(withoutEnabled, {
              ...candidate,
              outboundTag: tags.legacyOutbound,
            })),
      );
      if (!expected || enabled === false) {
        throw new ConflictException(
          'Правило пресета изменено вручную или его метка занята. Проверьте правила 3x-ui.',
        );
      }
    }
  }
  const hadPrivate = rules.some(
    (rule) =>
      owned(rule) &&
      Array.isArray(rule.ip) &&
      rule.ip.includes('geoip:private'),
  );
  const others = rules.filter((rule) => !owned(rule));
  if (
    hadPrivate &&
    !others.some((r) => Array.isArray(r.ip) && r.ip.includes('geoip:private'))
  ) {
    others.push({
      type: 'field',
      ip: ['geoip:private'],
      outboundTag: tags.outbound,
    });
  }
  return others;
}

function orderedRules(
  others: ConfigObject[],
  managed: ConfigObject[],
  apiTag: unknown,
): ConfigObject[] {
  const isApi = (rule: ConfigObject) =>
    typeof apiTag === 'string' &&
    rule.outboundTag === apiTag &&
    Array.isArray(rule.inboundTag) &&
    rule.inboundTag.includes(apiTag);
  const remaining = others.filter((rule) => !isApi(rule));
  if (!managed.length) return [...others.filter(isApi), ...remaining];
  // Google must not bypass existing blocked/private/bittorrent rules.
  const lastBlock = remaining.findLastIndex(
    (rule) => rule.outboundTag === 'blocked',
  );
  return [
    ...others.filter(isApi),
    ...managed.filter((rule) => rule.outboundTag === 'blocked'),
    ...remaining.slice(0, lastBlock + 1),
    ...managed.filter((rule) => rule.outboundTag !== 'blocked'),
    ...remaining.slice(lastBlock + 1),
  ];
}

function strategyPlan(
  routing: ConfigObject,
  state: RoutingPresetState,
  forceAdopt?: boolean,
) {
  const next = structuredClone(routing);
  const warnings: string[] = [];
  if (!state.blockRussia) {
    const restoration = restoreFields(
      next,
      state.strategy ? { domainStrategy: state.strategy } : {},
    );
    return {
      routing: restoration.restored,
      strategy: undefined,
      warnings: restoration.warnings,
    };
  }
  if (
    !forceAdopt &&
    state.strategy &&
    !equal(next.domainStrategy, state.strategy.after) &&
    !equal(next.domainStrategy, state.strategy.before)
  ) {
    throw new ConflictException(
      'Стратегия маршрутизации изменена вручную. Обновите настройки в 3x-ui.',
    );
  }
  const strategy =
    state.strategy ||
    (next.domainStrategy === 'IPOnDemand'
      ? undefined
      : { before: next.domainStrategy, after: 'IPOnDemand' });
  next.domainStrategy = 'IPOnDemand';
  return { routing: next, strategy, warnings };
}

function outboundPlan(
  nodeId: string,
  config: ConfigObject,
  state: RoutingPresetState,
) {
  const outbounds = [...objects(config.outbounds, 'outbounds')];
  const capabilities = routingCapabilities(config);
  if (
    (state.blockRussia || state.blockIpCheckers) &&
    !capabilities.blocking.available
  )
    throw new ConflictException(capabilities.blocking.reason);
  if (state.googleIpv4 && !capabilities.googleIpv4.available)
    throw new ConflictException(capabilities.googleIpv4.reason);
  const tag = presetTags(nodeId).legacyOutbound;
  const existing = outbounds.find((outbound) => outbound.tag === tag);
  const block = { tag, protocol: 'blackhole', settings: {} };
  // References can also occur in other outbounds (dialerProxy), balancers or observatories.
  const references = {
    ...config,
    outbounds: outbounds.filter((outbound) => outbound !== existing),
  };
  if (
    existing &&
    state.outboundOwned &&
    equal(existing, block) &&
    outbounds.filter((outbound) => outbound.tag === tag).length === 1 &&
    !canonical(references).includes(JSON.stringify(tag))
  ) {
    return {
      outbounds: outbounds.filter((outbound) => outbound !== existing),
      owned: undefined,
    };
  }
  return { outbounds, owned: existing ? state.outboundOwned : undefined };
}

interface InboundSniffingPlan {
  inbound: XuiInboundRaw;
  change?: SniffingChange;
  warnings: string[];
}

function restoredSniffing(
  inbound: XuiInboundRaw,
  change?: SniffingChange,
): InboundSniffingPlan {
  const matchingIdentity = change?.identity === inboundIdentity(inbound);
  const { restored, warnings } = restoreFields(
    sniffingObject(inbound),
    matchingIdentity ? change.fields : {},
  );
  if (change && !matchingIdentity)
    warnings.push(
      `Inbound ${inbound.id} заменён; его sniffing оставлен без изменений.`,
    );
  return {
    inbound: { ...inbound, sniffing: JSON.stringify(restored) },
    warnings,
    change: undefined,
  };
}

function sniffingPlan(
  inbound: XuiInboundRaw,
  state: RoutingPresetState,
): InboundSniffingPlan {
  const previous = state.sniffing[String(inbound.id)];
  if (!supportsSniffing(inbound))
    return {
      inbound,
      change: previous,
      warnings: [
        `Inbound ${inbound.id} (${inbound.protocol}): распознавание доменов не управляется; трафик вне Xray не покрывается.`,
      ],
    };
  if (!hasPresets(state)) return restoredSniffing(inbound, previous);
  const prepared = prepareSniffing(inbound, previous);
  const original = sniffingObject(inbound);
  const excluded = ['domainsExcluded', 'ipsExcluded'].some(
    (key) => Array.isArray(original[key]) && original[key].length,
  );
  return {
    ...prepared,
    warnings: excluded
      ? [
          `Inbound ${inbound.id}: исключения sniffing могут ограничивать блокировку доменов.`,
        ]
      : [],
  };
}

function inboundPlans(inbounds: XuiInboundRaw[], state: RoutingPresetState) {
  const updates: XuiInboundRaw[] = [];
  const sniffing: Record<string, SniffingChange> = {};
  const warnings: string[] = [];
  for (const original of inbounds) {
    const plan = sniffingPlan(original, state);
    warnings.push(...plan.warnings);
    if (plan.change) sniffing[String(original.id)] = plan.change;
    if (!equal(sniffingObject(original), sniffingObject(plan.inbound)))
      updates.push(plan.inbound);
  }
  return { updates, sniffing, warnings };
}

export function buildRoutingPlan(
  nodeId: string,
  snapshot: RoutingSnapshot,
  previous: RoutingPresetState,
  selection: RoutingSelection,
) {
  const { template, inbounds } = snapshot;
  const config = structuredClone(template.config);
  const routing =
    config.routing === undefined ? {} : jsonObject(config.routing, 'routing');
  const rules = objects(routing.rules, 'routing.rules');
  const forceAdopt = selection.forceAdopt === true;
  const state: RoutingPresetState = {
    ...recoveredState(previous),
    blockRussia: selection.blockRussia,
    blockIpCheckers: selection.blockIpCheckers,
    googleIpv4: selection.googleIpv4 ?? googleSelection(config, previous),
    pending: false,
  };
  const google = googlePlan(nodeId, rules, state, forceAdopt);
  state.googleRule = google.googleRule;
  const managed = [...presetRules(nodeId, selection), ...google.managed];
  const others = foreignRules(nodeId, google.others, previous, forceAdopt);
  if (rules.length || managed.length)
    routing.rules = orderedRules(others, managed, asRecord(config.api)?.tag);
  const strategy = strategyPlan(routing, state, forceAdopt);
  state.strategy = strategy.strategy;
  if (config.routing !== undefined || Object.keys(strategy.routing).length)
    config.routing = strategy.routing;
  const outbound = outboundPlan(nodeId, config, state);
  if (config.outbounds !== undefined || outbound.outbounds.length)
    config.outbounds = outbound.outbounds;
  state.outboundOwned = outbound.owned;
  const inboundPlan = inboundPlans(inbounds, state);
  state.sniffing = inboundPlan.sniffing;
  return {
    template: { ...template, config },
    state,
    inboundUpdates: inboundPlan.updates,
    warnings: [...strategy.warnings, ...inboundPlan.warnings],
    changed: !equal(config, template.config) || inboundPlan.updates.length > 0,
  };
}
