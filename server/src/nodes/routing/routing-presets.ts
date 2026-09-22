import { createHash } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { asRecord, jsonObject } from '../../xui/xui-contract';
import type { XuiInboundRaw } from '../../xui/xui.types';

export type ConfigObject = Record<string, unknown>;
export interface RoutingSelection {
  blockRussia: boolean;
  blockIpCheckers: boolean;
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
  return selection.blockRussia || selection.blockIpCheckers;
}
export function presetTags(nodeId: string) {
  const prefix = `3dp:${nodeId}:`;
  return {
    outbound: `${prefix}block`,
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
function restoreFields(
  target: ConfigObject,
  changes: Record<string, FieldChange>,
  warnings: string[],
) {
  for (const [key, change] of Object.entries(changes)) {
    if (!equal(target[key], change.after)) {
      warnings.push(`Поле ${key} изменено вручную и оставлено без изменений.`);
      continue;
    }
    if (change.before === undefined) delete target[key];
    else target[key] = structuredClone(change.before);
  }
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
    sniffing: { ...previous.pendingPrevious?.sniffing, ...previous.sniffing },
  };
  delete recovered.pendingPrevious;
  return recovered;
}

function foreignRules(
  nodeId: string,
  rules: ConfigObject[],
  previous: RoutingPresetState,
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
  for (const rule of rules.filter(owned)) {
    const expected = expectedRules.find(
      (candidate) => candidate.ruleTag === rule.ruleTag,
    );
    // The panel can add its own UI-only enabled=true field.
    const { enabled, ...withoutEnabled } = rule;
    if (!expected || !equal(withoutEnabled, expected) || enabled === false) {
      throw new ConflictException(
        'Правило пресета изменено вручную или его метка занята. Проверьте правила 3x-ui.',
      );
    }
  }
  return rules.filter((rule) => !owned(rule));
}

function orderedRules(
  others: ConfigObject[],
  managed: ConfigObject[],
  apiTag: unknown,
): ConfigObject[] {
  if (!managed.length) return others;
  const isApi = (rule: ConfigObject) =>
    typeof apiTag === 'string' &&
    rule.outboundTag === apiTag &&
    Array.isArray(rule.inboundTag) &&
    rule.inboundTag.includes(apiTag);
  return [
    ...others.filter(isApi),
    ...managed,
    ...others.filter((rule) => !isApi(rule)),
  ];
}

function strategyPlan(routing: ConfigObject, state: RoutingPresetState) {
  const next = structuredClone(routing);
  const warnings: string[] = [];
  if (!state.blockRussia) {
    if (state.strategy)
      restoreFields(next, { domainStrategy: state.strategy }, warnings);
    return { routing: next, strategy: undefined, warnings };
  }
  if (
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
  const tag = presetTags(nodeId).outbound;
  const existing = outbounds.find((outbound) => outbound.tag === tag);
  const block = { tag, protocol: 'blackhole', settings: {} };
  if (existing && (!state.outboundOwned || !equal(existing, block))) {
    throw new ConflictException(
      'Outbound пресета изменён вручную или его метка занята.',
    );
  }
  if (hasPresets(state))
    return {
      outbounds: existing ? outbounds : [...outbounds, block],
      owned: true,
    };
  // References can also occur in other outbounds (dialerProxy), balancers or observatories.
  const references = {
    ...config,
    outbounds: outbounds.filter((outbound) => outbound !== existing),
  };
  if (existing && !canonical(references).includes(JSON.stringify(tag))) {
    return {
      outbounds: outbounds.filter((outbound) => outbound !== existing),
      owned: undefined,
    };
  }
  return { outbounds, owned: existing ? state.outboundOwned : undefined };
}

function restoredSniffing(inbound: XuiInboundRaw, change?: SniffingChange) {
  const restored = structuredClone(sniffingObject(inbound));
  const warnings: string[] = [];
  if (change?.identity === inboundIdentity(inbound))
    restoreFields(restored, change.fields, warnings);
  else if (change)
    warnings.push(
      `Inbound ${inbound.id} заменён; его sniffing оставлен без изменений.`,
    );
  return {
    inbound: { ...inbound, sniffing: JSON.stringify(restored) },
    warnings,
    change: undefined,
  };
}

function sniffingPlan(inbound: XuiInboundRaw, state: RoutingPresetState) {
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
  const state: RoutingPresetState = {
    ...recoveredState(previous),
    blockRussia: selection.blockRussia,
    blockIpCheckers: selection.blockIpCheckers,
    pending: false,
  };
  const managed = presetRules(nodeId, selection);
  const others = foreignRules(nodeId, rules, previous);
  if (rules.length || managed.length)
    routing.rules = orderedRules(others, managed, asRecord(config.api)?.tag);
  const strategy = strategyPlan(routing, state);
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
