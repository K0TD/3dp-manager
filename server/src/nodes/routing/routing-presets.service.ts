import {
  BadGatewayException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AxiosError } from 'axios';
import { Node } from '../entities/node.entity';
import { UpdateRoutingPresetsDto } from '../dto/routing-presets.dto';
import { XuiService } from '../../xui/xui.service';
import {
  asRecord,
  safePanelMessage,
  XuiApiError,
} from '../../xui/xui-contract';
import type { XuiInboundRaw } from '../../xui/xui.types';
import { RoutingStore } from './routing-store.service';
import {
  buildRoutingPlan,
  emptyRoutingState,
  equal,
  inboundIdentity,
  routingRevision,
  sniffingObject,
  googleSelection,
  routingCapabilities,
} from './routing-presets';
import type {
  ConfigObject,
  RoutingPresetState,
  RoutingSelection,
  XrayTemplate,
} from './routing-presets';

type Snapshot = { template: XrayTemplate; inbounds: XuiInboundRaw[] };
type RoutingPlan = ReturnType<typeof buildRoutingPlan>;
export interface RoutingPresetView {
  available: boolean;
  blockRussia: boolean;
  blockIpCheckers: boolean;
  googleIpv4: boolean;
  capabilities?: ReturnType<typeof routingCapabilities>;
  revision: string;
  needsApply: boolean;
  hasConflict?: boolean;
  warnings: string[];
  result?:
    | 'applied'
    | 'unchanged'
    | 'rolled_back'
    | 'rollback_failed'
    | 'unknown';
  message?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof XuiApiError || error instanceof ConflictException)
    return safePanelMessage(error.message);
  const status = (error as AxiosError)?.response?.status;
  if ([401, 403].includes(status || 0))
    return 'Нет прав на изменение настроек 3x-ui. Проверьте авторизацию ноды.';
  if ([404, 405].includes(status || 0))
    return 'API маршрутизации недоступен для этой панели или способа авторизации.';
  return 'Не удалось связаться с 3x-ui или проверить её конфигурацию.';
}

// A concurrent external edit must never be replaced by our original snapshot.
function restoreChangedFields(
  current: ConfigObject,
  before: ConfigObject,
  applied: ConfigObject,
): ConfigObject {
  const restored = structuredClone(current);
  for (const key of changedKeys(before, applied)) {
    if (equal(restored[key], before[key])) continue;
    if (!equal(restored[key], applied[key]))
      throw new ConflictException(
        'Конфигурация изменена извне; автоматический откат остановлен.',
      );
    if (before[key] === undefined) delete restored[key];
    else restored[key] = structuredClone(before[key]);
  }
  return restored;
}

function changedKeys(before: ConfigObject, applied: ConfigObject): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(applied)])].filter(
    (key) => !equal(before[key], applied[key]),
  );
}

function verifyRestoredFields(
  current: ConfigObject,
  before: ConfigObject,
  applied: ConfigObject,
): void {
  if (
    changedKeys(before, applied).some(
      (key) => !equal(current[key], before[key]),
    )
  ) {
    throw new XuiApiError('Не удалось подтвердить восстановление настроек');
  }
}

interface Application {
  node: Node;
  before: Snapshot;
  previous: RoutingPresetState;
  plan: RoutingPlan;
  warnings: string[];
}
interface AttemptedChanges {
  template: boolean;
  inbounds: XuiInboundRaw[];
}

@Injectable()
export class RoutingPresetsService {
  constructor(
    private readonly store: RoutingStore,
    private readonly xui: XuiService,
  ) {}

  async get(id: string): Promise<RoutingPresetView> {
    return this.store.withLock(id, async () => {
      const node = await this.store.node(id);
      const state = node.routingPresets || emptyRoutingState();
      try {
        return this.view(node, await this.snapshot(node), state);
      } catch (error) {
        return {
          available: false,
          blockRussia: state.blockRussia,
          blockIpCheckers: state.blockIpCheckers,
          googleIpv4: state.googleIpv4 === true,
          revision: '',
          needsApply: true,
          warnings: [errorMessage(error)],
        };
      }
    });
  }

  private async snapshot(node: Node): Promise<Snapshot> {
    const [template, inbounds] = await Promise.all([
      this.xui.getXrayTemplate(node),
      this.xui.listRoutingInbounds(node),
    ]);
    return { template, inbounds };
  }

  private view(
    node: Node,
    snapshot: Snapshot,
    state: RoutingPresetState,
  ): RoutingPresetView {
    const warnings: string[] = [];
    const googleIpv4 = googleSelection(snapshot.template.config, state);
    const selection = { ...state, googleIpv4 };
    let needsApply = true;
    let hasConflict = false;
    try {
      const plan = buildRoutingPlan(node.id, snapshot, state, selection);
      needsApply =
        plan.changed ||
        state.pending === true ||
        (plan.state.googleIpv4 === true && !state.googleRule);
      warnings.push(...plan.warnings);
    } catch (error) {
      hasConflict = true;
      warnings.push(errorMessage(error));
      try {
        const fallbackPlan = buildRoutingPlan(node.id, snapshot, state, {
          ...selection,
          forceAdopt: true,
        });
        warnings.push(...fallbackPlan.warnings);
      } catch {
        /* Ignore secondary error */
      }
    }
    if (state.pending)
      warnings.push(
        'Предыдущая операция не завершена. Повторное применение проверит и восстановит выбранные настройки, если нет ручных конфликтов.',
      );
    else if (needsApply && !hasConflict)
      warnings.push(
        'Настройки в панели отличаются от выбранных пресетов. Требуется применение.',
      );
    return {
      available: true,
      blockRussia: state.blockRussia,
      blockIpCheckers: state.blockIpCheckers,
      googleIpv4,
      capabilities: routingCapabilities(snapshot.template.config),
      revision: routingRevision(snapshot.template, snapshot.inbounds, state),
      needsApply,
      hasConflict,
      warnings,
    };
  }

  async update(
    id: string,
    dto: UpdateRoutingPresetsDto,
  ): Promise<RoutingPresetView> {
    return this.store.withLock(id, async () => {
      const application = await this.preflight(id, dto);
      if (!application.plan.changed) return this.confirmUnchanged(application);
      await this.assertRevision(application, dto.revision);
      await this.store.save(id, this.pendingState(application));
      return this.applyPlan(application);
    });
  }

  private async preflight(
    id: string,
    dto: UpdateRoutingPresetsDto,
  ): Promise<Application> {
    const node = await this.store.node(id);
    const previous = node.routingPresets || emptyRoutingState();
    let before: Snapshot;
    try {
      before = await this.snapshot(node);
    } catch (error) {
      throw new BadGatewayException(errorMessage(error));
    }
    this.checkRevision(before, previous, dto.revision);
    const plan = buildRoutingPlan(id, before, previous, dto);
    const warnings = [...plan.warnings];
    if (plan.state.blockRussia || plan.state.googleIpv4)
      warnings.push(
        ...(await this.geodataWarnings(node, before.template.path, plan.state)),
      );
    return { node, before, previous, plan, warnings };
  }

  private async geodataWarnings(
    node: Node,
    path: XrayTemplate['path'],
    selection: RoutingSelection,
  ): Promise<string[]> {
    try {
      return (await this.xui.validateRoutingGeodata(node, path, selection))
        ? []
        : [
            'Панель не поддерживает предварительную проверку геобаз; результат проверяется после запуска Xray.',
          ];
    } catch (error) {
      throw new BadGatewayException(errorMessage(error));
    }
  }

  private checkRevision(
    snapshot: Snapshot,
    state: RoutingPresetState,
    revision: string,
  ): void {
    if (
      routingRevision(snapshot.template, snapshot.inbounds, state) !== revision
    ) {
      throw new ConflictException(
        'Конфигурация ноды изменилась. Обновите состояние перед применением.',
      );
    }
  }

  private async assertRevision(
    application: Application,
    revision: string,
  ): Promise<void> {
    // Preflight can take time: do not overwrite edits made while it was running.
    this.checkRevision(
      await this.snapshot(application.node),
      application.previous,
      revision,
    );
  }

  private pendingState({ plan, previous }: Application): RoutingPresetState {
    const { pendingPrevious: older, ...recoveryState } = previous;
    return {
      ...plan.state,
      pending: true,
      pendingPrevious: {
        ...older,
        ...recoveryState,
        sniffing: { ...older?.sniffing, ...previous.sniffing },
        strategy: previous.strategy || older?.strategy,
        outboundOwned: previous.outboundOwned || older?.outboundOwned,
        googleRule: previous.googleRule || older?.googleRule,
      },
    };
  }

  private async confirmUnchanged({
    node,
    plan,
    before,
    previous,
    warnings,
  }: Application): Promise<RoutingPresetView> {
    // A previous write may have succeeded despite a lost response. Re-apply only
    // when its runtime result was not confirmed; ordinary repeats never restart.
    if (previous.pending) await this.xui.applyXrayConfig(node);
    else await this.xui.waitForXray(node);
    await this.store.save(node.id, plan.state);
    return {
      ...this.view(node, before, plan.state),
      warnings,
      result: 'unchanged',
      message: 'Настройки уже применены.',
    };
  }

  private async applyPlan(
    application: Application,
  ): Promise<RoutingPresetView> {
    const attempted: AttemptedChanges = { template: false, inbounds: [] };
    try {
      await this.writeChanges(application, attempted);
      await this.xui.applyXrayConfig(application.node);
      const saved = await this.snapshot(application.node);
      const { node, plan, warnings } = application;
      if (buildRoutingPlan(node.id, saved, plan.state, plan.state).changed)
        throw new XuiApiError('3x-ui не сохранила все настройки пресетов');
      await this.store.save(node.id, plan.state);
      return {
        ...this.view(node, saved, plan.state),
        warnings,
        result: 'applied',
        message: 'Настройки применены, Xray работает.',
      };
    } catch (error) {
      return this.failedApplication(application, attempted, error);
    }
  }

  private async writeChanges(
    application: Application,
    attempted: AttemptedChanges,
  ): Promise<void> {
    const { node, before, plan } = application;
    if (!equal(before.template.config, plan.template.config)) {
      attempted.template = true;
      await this.xui.saveXrayTemplate(node, plan.template);
    }
    for (const update of plan.inboundUpdates) {
      const current = await this.xui.getRoutingInbound(node, Number(update.id));
      const original = before.inbounds.find(
        (inbound) => inbound.id === update.id,
      );
      if (
        inboundIdentity(current) !== inboundIdentity(original) ||
        !equal(sniffingObject(current), sniffingObject(original))
      ) {
        throw new ConflictException('Inbound изменился во время применения.');
      }
      // Use fresh clients/TLS, and record the attempt before an ambiguous timeout.
      attempted.inbounds.push(update);
      await this.xui.updateInboundSniffing(node, {
        ...current,
        sniffing: update.sniffing,
      });
    }
  }

  private async failedApplication(
    application: Application,
    attempted: AttemptedChanges,
    error: unknown,
  ): Promise<RoutingPresetView> {
    const { node, before, plan, previous, warnings } = application;
    let outcome: 'rolled_back' | 'rollback_failed' | 'unknown' = 'rolled_back';
    try {
      await this.rollback(node, before, plan, attempted);
      await this.store.save(node.id, previous);
    } catch (rollbackError) {
      outcome =
        (rollbackError as AxiosError)?.isAxiosError &&
        !(rollbackError as AxiosError).response
          ? 'unknown'
          : 'rollback_failed';
    }
    const selection = outcome === 'rolled_back' ? previous : plan.state;
    const messages = {
      rolled_back: 'Применение не удалось. Прежние настройки восстановлены.',
      unknown:
        'Нода недоступна: результат применения и отката неизвестен. Проверьте 3x-ui.',
      rollback_failed:
        'Автоматический откат не завершён. Проверьте конфигурацию и работу Xray в 3x-ui.',
    };
    return {
      available: true,
      blockRussia: selection.blockRussia,
      blockIpCheckers: selection.blockIpCheckers,
      googleIpv4: googleSelection(before.template.config, selection),
      revision: '',
      needsApply: true,
      warnings: [...warnings, errorMessage(error)],
      result: outcome,
      message: messages[outcome],
    };
  }

  private async rollback(
    node: Node,
    before: Snapshot,
    plan: RoutingPlan,
    attempted: AttemptedChanges,
  ): Promise<void> {
    // A timeout is ambiguous: read before attempting the inverse operation.
    const current = await this.snapshot(node);
    await this.rollbackInbounds(node, before.inbounds, attempted.inbounds);
    if (attempted.template) {
      const restored = this.restoredTemplate(
        current.template,
        before.template,
        plan.template,
      );
      if (!equal(restored.config, current.template.config))
        await this.xui.saveXrayTemplate(node, restored);
    }
    await this.xui.applyXrayConfig(node);
    const restored = await this.snapshot(node);
    this.verifyRollback(restored, before, plan, attempted);
  }

  private async rollbackInbounds(
    node: Node,
    before: XuiInboundRaw[],
    attempted: XuiInboundRaw[],
  ): Promise<void> {
    for (const applied of [...attempted].reverse()) {
      const original = before.find((inbound) => inbound.id === applied.id);
      const current = await this.xui.getRoutingInbound(
        node,
        Number(applied.id),
      );
      if (inboundIdentity(current) !== inboundIdentity(original))
        throw new ConflictException('Inbound заменён во время отката.');
      const sniffing = restoreChangedFields(
        sniffingObject(current),
        sniffingObject(original),
        sniffingObject(applied),
      );
      if (!equal(sniffing, sniffingObject(current)))
        await this.xui.updateInboundSniffing(node, {
          ...current,
          sniffing: JSON.stringify(sniffing),
        });
    }
  }

  private restoredTemplate(
    current: XrayTemplate,
    before: XrayTemplate,
    applied: XrayTemplate,
  ): XrayTemplate {
    const routing = restoreChangedFields(
      asRecord(current.config.routing) || {},
      asRecord(before.config.routing) || {},
      asRecord(applied.config.routing) || {},
    );
    const config = restoreChangedFields(
      current.config,
      { outbounds: before.config.outbounds },
      { outbounds: applied.config.outbounds },
    );
    if (Object.keys(routing).length || before.config.routing !== undefined)
      config.routing = routing;
    else delete config.routing;
    return { ...current, config };
  }

  private verifyRollback(
    restored: Snapshot,
    before: Snapshot,
    plan: RoutingPlan,
    attempted: AttemptedChanges,
  ): void {
    if (attempted.template) {
      verifyRestoredFields(
        restored.template.config,
        { outbounds: before.template.config.outbounds },
        { outbounds: plan.template.config.outbounds },
      );
      verifyRestoredFields(
        asRecord(restored.template.config.routing) || {},
        asRecord(before.template.config.routing) || {},
        asRecord(plan.template.config.routing) || {},
      );
    }
    for (const applied of attempted.inbounds) {
      const original = before.inbounds.find(
        (inbound) => inbound.id === applied.id,
      );
      const actual = restored.inbounds.find(
        (inbound) => inbound.id === applied.id,
      );
      if (!actual) throw new XuiApiError('Inbound отсутствует после отката');
      verifyRestoredFields(
        sniffingObject(actual),
        sniffingObject(original),
        sniffingObject(applied),
      );
    }
  }
}
