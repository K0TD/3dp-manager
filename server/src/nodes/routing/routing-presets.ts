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
  // Persisted before remote writes; a failed/unknown operation must not look applied.
  pending?: boolean;
}
export interface XrayTemplate {
  path: '/panel/api/xray' | '/panel/xray';
  config: ConfigObject;
  outboundTestUrl: string;
}
export const IP_CHECK_DOMAINS = [
  '2ip.ru', '2ip.io', 'whoer.net', 'browserleaks.com', 'dnsleaktest.com',
  'ipinfo.io', 'ip-api.com', 'ifconfig.me', 'icanhazip.com', 'whatismyipaddress.com',
];
export const RUSSIA_DOMAINS = [
  'domain:ru', 'domain:su', 'domain:xn--p1ai', 'geosite:category-ru',
];
// These are native user-facing Xray protocols. Panel sidecars are not covered.
const SNIFFING_PROTOCOLS = new Set([
  'vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http',
  'dokodemo-door', 'tunnel', 'wireguard', 'hysteria', 'tun',
]);

export function emptyRoutingState(): RoutingPresetState {
  return { blockRussia: false, blockIpCheckers: false, sniffing: {} };
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = asRecord(value);
  if (record) return `{${Object.keys(record).sort().filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
export function equal(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
export function routingRevision(template: XrayTemplate, inbounds: XuiInboundRaw[], state: RoutingPresetState): string {
  return createHash('sha256').update(canonical({
    template,
    // Traffic counters change continuously and are not configuration revisions.
    inbounds: inbounds.map((i) => ({ id: i.id, identity: inboundIdentity(i), sniffing: sniffingObject(i) }))
      .sort((a, b) => Number(a.id) - Number(b.id)),
    state,
  })).digest('hex');
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
  return { outbound: `${prefix}block`, russia: `${prefix}ru-domains`, ips: `${prefix}ru-ips`, checkers: `${prefix}ip-checkers` };
}
export function presetRules(nodeId: string, selection: RoutingSelection): ConfigObject[] {
  const tags = presetTags(nodeId);
  const rule = (ruleTag: string, match: ConfigObject) => ({ type: 'field', ruleTag, ...match, outboundTag: tags.outbound });
  return [
    ...(selection.blockRussia ? [rule(tags.russia, { domain: RUSSIA_DOMAINS }), rule(tags.ips, { ip: ['geoip:ru'] })] : []),
    ...(selection.blockIpCheckers ? [rule(tags.checkers, { domain: IP_CHECK_DOMAINS.map((d) => `domain:${d}`) })] : []),
  ];
}

function objects(value: unknown, field: string): ConfigObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => !asRecord(v))) throw new Error(`Некорректный ${field} в конфигурации 3x-ui`);
  return value as ConfigObject[];
}
function restoreFields(target: ConfigObject, changes: Record<string, FieldChange>, warnings: string[]) {
  for (const [key, change] of Object.entries(changes)) {
    if (!equal(target[key], change.after)) {
      warnings.push(`Поле ${key} изменено вручную и оставлено без изменений.`);
      continue;
    }
    if (change.before === undefined) delete target[key];
    else target[key] = structuredClone(change.before);
  }
}

export function prepareSniffing(inbound: XuiInboundRaw, previous?: SniffingChange): { inbound: XuiInboundRaw; change: SniffingChange } {
  const original = sniffingObject(inbound);
  const next = { ...original, enabled: true, metadataOnly: false, routeOnly: true,
    destOverride: [...new Set([...(Array.isArray(original.destOverride) ? original.destOverride : []), 'http', 'tls', 'quic'])] };
  const change: SniffingChange = previous?.identity === inboundIdentity(inbound)
    ? structuredClone(previous) : { identity: inboundIdentity(inbound), fields: {} };
  for (const key of ['enabled', 'metadataOnly', 'routeOnly', 'destOverride']) {
    if (change.fields[key] && !equal(original[key], change.fields[key].after)) {
      throw new ConflictException(`Sniffing inbound ${inbound.id} изменён вручную. Восстановите настройки в 3x-ui перед повторным применением.`);
    }
    if (!equal(original[key], next[key])) change.fields[key] ??= { before: original[key], after: next[key] };
  }
  return { inbound: { ...inbound, sniffing: JSON.stringify(next) }, change };
}

export function buildRoutingPlan(nodeId: string, template: XrayTemplate, inbounds: XuiInboundRaw[], previous: RoutingPresetState, selection: RoutingSelection) {
  const config = structuredClone(template.config);
  const routing = config.routing === undefined ? {} : jsonObject(config.routing, 'routing');
  const rules = objects(routing.rules, 'routing.rules');
  const outbounds = objects(config.outbounds, 'outbounds');
  const tags = presetTags(nodeId);
  const ownedTags = [tags.russia, tags.ips, tags.checkers];
  const oldRules = presetRules(nodeId, previous);
  for (const rule of rules.filter((r) => ownedTags.includes(String(r.ruleTag)))) {
    const expected = oldRules.find((r) => r.ruleTag === rule.ruleTag);
    // The panel can add its own UI-only enabled=true field.
    const { enabled, ...withoutEnabled } = rule;
    if (!expected || !equal(withoutEnabled, expected) || enabled === false) {
      throw new ConflictException('Правило пресета изменено вручную или его метка занята. Проверьте правила 3x-ui.');
    }
  }
  const warnings: string[] = [];
  const state: RoutingPresetState = { ...structuredClone(previous), ...selection, pending: false };
  const managed = presetRules(nodeId, selection);
  const others = rules.filter((r) => !ownedTags.includes(String(r.ruleTag)));
  const apiTag = asRecord(config.api)?.tag;
  const isApi = (r: ConfigObject) => typeof apiTag === 'string' && r.outboundTag === apiTag &&
    Array.isArray(r.inboundTag) && r.inboundTag.includes(apiTag);
  const nextRules = [...others.filter(isApi), ...managed, ...others.filter((r) => !isApi(r))];
  if (rules.length || managed.length) routing.rules = nextRules;
  const existingOutbound = outbounds.find((o) => o.tag === tags.outbound);
  const block = { tag: tags.outbound, protocol: 'blackhole', settings: {} };
  if (existingOutbound && !equal(existingOutbound, block)) throw new ConflictException('Outbound пресета изменён вручную или его метка занята.');
  if (hasPresets(selection)) {
    if (!existingOutbound) outbounds.push(block);
  } else if (existingOutbound && !canonical({ ...config, outbounds: undefined, routing: { ...routing, rules: nextRules } }).includes(JSON.stringify(tags.outbound))) {
    outbounds.splice(outbounds.indexOf(existingOutbound), 1);
  }
  if (config.outbounds !== undefined || outbounds.length) config.outbounds = outbounds;
  if (selection.blockRussia) {
    if (previous.strategy && !equal(routing.domainStrategy, previous.strategy.after)) {
      throw new ConflictException('Стратегия маршрутизации изменена вручную. Обновите настройки в 3x-ui.');
    }
    if (routing.domainStrategy !== 'IPOnDemand') {
      state.strategy = { before: routing.domainStrategy, after: 'IPOnDemand' };
      routing.domainStrategy = 'IPOnDemand';
    }
  } else if (state.strategy) {
    restoreFields(routing, { domainStrategy: state.strategy }, warnings);
    delete state.strategy;
  }
  if (config.routing !== undefined || Object.keys(routing).length) config.routing = routing;
  const inboundUpdates: XuiInboundRaw[] = [];
  const activeIds = new Set<string>();
  for (const inbound of inbounds) {
    const id = String(inbound.id);
    activeIds.add(id);
    if (!supportsSniffing(inbound)) {
      warnings.push(`Inbound ${inbound.id} (${inbound.protocol}): распознавание доменов не управляется; трафик вне Xray не покрывается.`);
      continue;
    }
    const original = sniffingObject(inbound);
    let next: XuiInboundRaw;
    if (hasPresets(selection)) {
      const prepared = prepareSniffing(inbound, state.sniffing[id]);
      state.sniffing[id] = prepared.change;
      next = prepared.inbound;
      if (['domainsExcluded', 'ipsExcluded'].some((key) => Array.isArray(original[key]) && original[key].length)) {
        warnings.push(`Inbound ${inbound.id}: исключения sniffing могут ограничивать блокировку доменов.`);
      }
    } else {
      const change = state.sniffing[id];
      if (!change) continue;
      const restored = structuredClone(original);
      if (change.identity === inboundIdentity(inbound)) restoreFields(restored, change.fields, warnings);
      else warnings.push(`Inbound ${inbound.id} заменён; его sniffing оставлен без изменений.`);
      delete state.sniffing[id];
      next = { ...inbound, sniffing: JSON.stringify(restored) };
    }
    if (!equal(original, sniffingObject(next))) inboundUpdates.push(next);
  }
  for (const id of Object.keys(state.sniffing)) if (!activeIds.has(id)) delete state.sniffing[id];
  return { template: { ...template, config }, state, inboundUpdates, warnings,
    changed: !equal(config, template.config) || inboundUpdates.length > 0 };
}
