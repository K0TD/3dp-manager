import { BadGatewayException, ConflictException, Injectable } from '@nestjs/common';
import { AxiosError } from 'axios';
import { Node } from '../entities/node.entity';
import { UpdateRoutingPresetsDto } from '../dto/routing-presets.dto';
import { XuiService } from '../../xui/xui.service';
import { asRecord, safePanelMessage, XuiApiError } from '../../xui/xui-contract';
import type { XuiInboundRaw } from '../../xui/xui.types';
import { RoutingStore } from './routing-store.service';
import {
  buildRoutingPlan, emptyRoutingState, equal, inboundIdentity,
  routingRevision, sniffingObject,
} from './routing-presets';
import type { ConfigObject, RoutingPresetState, XrayTemplate } from './routing-presets';

type Snapshot = { template: XrayTemplate; inbounds: XuiInboundRaw[] };
type RoutingPlan = ReturnType<typeof buildRoutingPlan>;
export interface RoutingPresetView {
  available: boolean;
  blockRussia: boolean;
  blockIpCheckers: boolean;
  revision: string;
  needsApply: boolean;
  warnings: string[];
  result?: 'applied' | 'unchanged' | 'rolled_back' | 'rollback_failed' | 'unknown';
  message?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof XuiApiError || error instanceof ConflictException) return safePanelMessage(error.message);
  const status = (error as AxiosError)?.response?.status;
  if ([401, 403].includes(status || 0)) return 'Нет прав на изменение настроек 3x-ui. Проверьте авторизацию ноды.';
  if ([404, 405].includes(status || 0)) return 'API маршрутизации недоступен для этой панели или способа авторизации.';
  return 'Не удалось связаться с 3x-ui или проверить её конфигурацию.';
}

// Roll back only when the field still has either our value or its original value.
// An external edit must never be replaced by the old snapshot.
function undoField(target: ConfigObject, key: string, before: unknown, applied: unknown) {
  if (equal(before, applied) || equal(target[key], before)) return;
  if (!equal(target[key], applied)) throw new ConflictException('Конфигурация изменена извне; автоматический откат остановлен.');
  if (before === undefined) delete target[key];
  else target[key] = structuredClone(before);
}

@Injectable()
export class RoutingPresetsService {
  constructor(private readonly store: RoutingStore, private readonly xui: XuiService) {}

  async get(id: string): Promise<RoutingPresetView> {
    return this.store.withLock(id, async () => {
      const node = await this.store.node(id);
      const state = node.routingPresets || emptyRoutingState();
      try {
        const snapshot = await this.snapshot(node);
        const view = this.view(node, snapshot, state);
        // A lost response may have been the only failure. Readback + runtime
        // verification can safely clear the persisted uncertain-operation marker.
        if (state.pending && !view.needsApply) {
          await this.xui.waitForXray(node);
          state.pending = false;
          delete state.pendingPrevious;
          await this.store.save(id, state);
          return this.view(node, snapshot, state);
        }
        return view;
      } catch (error) {
        return { available: false, blockRussia: state.blockRussia, blockIpCheckers: state.blockIpCheckers,
          revision: '', needsApply: true, warnings: [errorMessage(error)] };
      }
    });
  }

  private async snapshot(node: Node): Promise<Snapshot> {
    const [template, inbounds] = await Promise.all([this.xui.getXrayTemplate(node), this.xui.listRoutingInbounds(node)]);
    return { template, inbounds };
  }

  private view(node: Node, snapshot: Snapshot, state: RoutingPresetState): RoutingPresetView {
    const warnings: string[] = [];
    let needsApply = true;
    try {
      const plan = buildRoutingPlan(node.id, snapshot.template, snapshot.inbounds, state, state);
      needsApply = plan.changed;
      warnings.push(...plan.warnings);
    } catch (error) {
      warnings.push(errorMessage(error));
    }
    if (state.pending) warnings.push('Предыдущая операция не завершена. Проверьте настройки и работу Xray; повторное применение восстановит выбранные пресеты, если нет ручных конфликтов.');
    if (needsApply) warnings.push('Настройки в панели отличаются от выбранных пресетов. Требуется применение.');
    return { available: true, blockRussia: state.blockRussia, blockIpCheckers: state.blockIpCheckers,
      revision: routingRevision(snapshot.template, snapshot.inbounds, state), needsApply, warnings };
  }

  async update(id: string, dto: UpdateRoutingPresetsDto): Promise<RoutingPresetView> {
    return this.store.withLock(id, async () => {
      const node = await this.store.node(id);
      const previous = node.routingPresets || emptyRoutingState();
      let before: Snapshot;
      try { before = await this.snapshot(node); }
      catch (error) { throw new BadGatewayException(errorMessage(error)); }
      if (routingRevision(before.template, before.inbounds, previous) !== dto.revision) {
        throw new ConflictException('Конфигурация ноды изменилась. Обновите состояние перед применением.');
      }
      const plan = buildRoutingPlan(id, before.template, before.inbounds, previous, dto);
      const warnings = [...plan.warnings];
      if (dto.blockRussia) {
        try {
          if (!await this.xui.validateRoutingGeodata(node, before.template.path)) warnings.push('Панель не поддерживает предварительную проверку геобаз; результат проверяется после запуска Xray.');
        } catch (error) { throw new BadGatewayException(errorMessage(error)); }
      }
      if (!plan.changed) {
        await this.xui.waitForXray(node);
        await this.store.save(id, plan.state);
        return { ...this.view(node, before, plan.state), warnings, result: 'unchanged', message: 'Настройки уже применены.' };
      }
      // A second read catches edits made while preflight requests were running.
      const fresh = await this.snapshot(node);
      if (routingRevision(fresh.template, fresh.inbounds, previous) !== dto.revision) {
        throw new ConflictException('Конфигурация ноды изменилась во время проверки. Обновите состояние.');
      }
      await this.store.save(id, { ...plan.state, pending: true, pendingPrevious: {
        blockRussia: previous.blockRussia, blockIpCheckers: previous.blockIpCheckers,
      } });
      let templateAttempted = false;
      const attemptedInbounds: XuiInboundRaw[] = [];
      try {
        if (!equal(before.template.config, plan.template.config)) {
          templateAttempted = true;
          await this.xui.saveXrayTemplate(node, plan.template);
        }
        for (const update of plan.inboundUpdates) {
          const current = (await this.xui.listRoutingInbounds(node)).find((i) => i.id === update.id);
          const original = before.inbounds.find((i) => i.id === update.id)!;
          if (!current || inboundIdentity(current) !== inboundIdentity(original) || !equal(sniffingObject(current), sniffingObject(original))) {
            throw new ConflictException('Inbound изменился во время применения.');
          }
          // Retain the freshest clients, TLS and other writable inbound settings.
          attemptedInbounds.push(update);
          await this.xui.updateInboundSniffing(node, { ...current, sniffing: update.sniffing });
        }
        await this.xui.applyXrayConfig(node);
        const saved = await this.snapshot(node);
        if (buildRoutingPlan(id, saved.template, saved.inbounds, plan.state, dto).changed) {
          throw new XuiApiError('3x-ui не сохранила все настройки пресетов');
        }
        await this.store.save(id, plan.state);
        return { ...this.view(node, saved, plan.state), warnings, result: 'applied', message: 'Настройки применены, Xray работает.' };
      } catch (error) {
        let result: RoutingPresetView['result'] = 'rolled_back';
        try {
          await this.rollback(node, before, plan, templateAttempted, attemptedInbounds);
          await this.store.save(id, previous);
        } catch (rollbackError) {
          result = (rollbackError as AxiosError)?.isAxiosError && !(rollbackError as AxiosError).response
            ? 'unknown' : 'rollback_failed';
        }
        const restored = result === 'rolled_back';
        const message = restored ? 'Применение не удалось. Прежние настройки восстановлены.'
          : result === 'unknown' ? 'Нода недоступна: результат применения и отката неизвестен. Проверьте 3x-ui.'
            : 'Автоматический откат не завершён. Проверьте конфигурацию и работу Xray в 3x-ui.';
        return { available: true, blockRussia: restored ? previous.blockRussia : plan.state.blockRussia,
          blockIpCheckers: restored ? previous.blockIpCheckers : plan.state.blockIpCheckers,
          revision: '', needsApply: true, warnings: [...warnings, errorMessage(error)], result, message };
      }
    });
  }

  private async rollback(node: Node, before: Snapshot, plan: RoutingPlan, templateAttempted: boolean, attemptedInbounds: XuiInboundRaw[]) {
    // A timeout is ambiguous: read before attempting the inverse operation.
    const current = await this.snapshot(node);
    for (const applied of [...attemptedInbounds].reverse()) {
      const original = before.inbounds.find((i) => i.id === applied.id)!;
      const inbound = current.inbounds.find((i) => i.id === applied.id);
      if (!inbound || inboundIdentity(inbound) !== inboundIdentity(original)) throw new ConflictException('Inbound заменён во время отката.');
      const sniffing = structuredClone(sniffingObject(inbound));
      const oldSniffing = sniffingObject(original);
      const appliedSniffing = sniffingObject(applied);
      for (const key of new Set([...Object.keys(oldSniffing), ...Object.keys(appliedSniffing)])) {
        undoField(sniffing, key, oldSniffing[key], appliedSniffing[key]);
      }
      if (!equal(sniffing, sniffingObject(inbound))) await this.xui.updateInboundSniffing(node, { ...inbound, sniffing: JSON.stringify(sniffing) });
    }
    if (templateAttempted) {
      const config = structuredClone(current.template.config);
      const routing = asRecord(config.routing) || {};
      const oldRouting = asRecord(before.template.config.routing) || {};
      const appliedRouting = asRecord(plan.template.config.routing) || {};
      undoField(routing, 'rules', oldRouting.rules, appliedRouting.rules);
      undoField(routing, 'domainStrategy', oldRouting.domainStrategy, appliedRouting.domainStrategy);
      if (Object.keys(routing).length || before.template.config.routing !== undefined) config.routing = routing;
      else delete config.routing;
      undoField(config, 'outbounds', before.template.config.outbounds, plan.template.config.outbounds);
      if (!equal(config, current.template.config)) await this.xui.saveXrayTemplate(node, { ...current.template, config });
    }
    await this.xui.applyXrayConfig(node);
    const restored = await this.snapshot(node);
    // Compare only fields we changed, never volatile counters or unrelated settings.
    if (templateAttempted) {
      for (const key of ['outbounds', 'routing']) {
        if (!equal(restored.template.config[key], before.template.config[key])) throw new XuiApiError('Не удалось подтвердить откат маршрутизации');
      }
    }
    for (const applied of attemptedInbounds) {
      const original = before.inbounds.find((i) => i.id === applied.id)!;
      const actual = restored.inbounds.find((i) => i.id === applied.id);
      if (!actual || !equal(sniffingObject(actual), sniffingObject(original))) throw new XuiApiError('Не удалось подтвердить откат sniffing');
    }
  }
}
