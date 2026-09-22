import { RoutingPresetsService } from '../../src/nodes/routing/routing-presets.service';
import { RoutingStore } from '../../src/nodes/routing/routing-store.service';
import { XuiService } from '../../src/xui/xui.service';
import { Node } from '../../src/nodes/entities/node.entity';
import {
  emptyRoutingState,
  sniffingObject,
} from '../../src/nodes/routing/routing-presets';
import type {
  RoutingPresetState,
  XrayTemplate,
} from '../../src/nodes/routing/routing-presets';
import type { XuiInboundRaw } from '../../src/xui/xui.types';

describe('routing preset application', () => {
  let service: RoutingPresetsService;
  let template: XrayTemplate;
  let inbounds: XuiInboundRaw[];
  let state: RoutingPresetState;
  let xui: {
    getXrayTemplate: jest.Mock;
    listRoutingInbounds: jest.Mock;
    saveXrayTemplate: jest.Mock;
    updateInboundSniffing: jest.Mock;
    validateRoutingGeodata: jest.Mock;
    applyXrayConfig: jest.Mock;
    waitForXray: jest.Mock;
  };
  let store: { node: jest.Mock; save: jest.Mock; withLock: jest.Mock };
  beforeEach(() => {
    state = emptyRoutingState();
    template = {
      path: '/panel/api/xray',
      outboundTestUrl: 'https://test.test',
      config: {
        api: { tag: 'api' },
        outbounds: [{ tag: 'direct', protocol: 'freedom' }],
        routing: {
          rules: [{ type: 'field', inboundTag: ['api'], outboundTag: 'api' }],
          domainStrategy: 'AsIs',
        },
      },
    };
    inbounds = [
      {
        id: 7,
        protocol: 'vless',
        port: 443,
        sniffing: '{"enabled":false}',
        settings: '{"clients":[{"id":"keep-this-client"}]}',
        streamSettings: '{}',
      },
    ];
    xui = {
      getXrayTemplate: jest.fn(async () => structuredClone(template)),
      listRoutingInbounds: jest.fn(async () => structuredClone(inbounds)),
      saveXrayTemplate: jest.fn(async (_node, value) => {
        template = structuredClone(value);
      }),
      updateInboundSniffing: jest.fn(async (_node, value) => {
        inbounds = inbounds.map((i) =>
          i.id === value.id ? structuredClone(value) : i,
        );
      }),
      validateRoutingGeodata: jest.fn(async () => true),
      applyXrayConfig: jest.fn(async () => undefined),
      waitForXray: jest.fn(async () => undefined),
    };
    store = {
      node: jest.fn(
        async () =>
          ({ id: 'node', routingPresets: structuredClone(state) }) as Node,
      ),
      save: jest.fn(async (_id, value) => {
        state = JSON.parse(JSON.stringify(value));
      }),
      withLock: jest.fn(async (_id, work) => work()),
    };
    service = new RoutingPresetsService(
      store as unknown as RoutingStore,
      xui as unknown as XuiService,
    );
  });
  async function apply(blockRussia = true, blockIpCheckers = true) {
    const view = await service.get('node');
    return service.update('node', {
      blockRussia,
      blockIpCheckers,
      revision: view.revision,
    });
  }

  it('applies, verifies, reloads persisted state and disables both presets', async () => {
    const original = structuredClone({ template, inbounds });
    expect(await apply()).toMatchObject({
      result: 'applied',
      needsApply: false,
      blockRussia: true,
    });
    expect(state.pending).toBe(false);
    expect((await service.get('node')).needsApply).toBe(false);
    expect(await apply(false, false)).toMatchObject({
      result: 'applied',
      blockRussia: false,
    });
    expect(template).toEqual(original.template);
    expect(inbounds).toEqual(original.inbounds);
  });

  it('does not write or restart on a repeated application', async () => {
    await apply();
    xui.saveXrayTemplate.mockClear();
    xui.updateInboundSniffing.mockClear();
    xui.applyXrayConfig.mockClear();
    expect(await apply()).toMatchObject({ result: 'unchanged' });
    expect(xui.saveXrayTemplate).not.toHaveBeenCalled();
    expect(xui.updateInboundSniffing).not.toHaveBeenCalled();
    expect(xui.applyXrayConfig).not.toHaveBeenCalled();
  });

  it('rejects stale revisions before any write', async () => {
    const view = await service.get('node');
    template.config.dns = { servers: ['8.8.8.8'] };
    await expect(
      service.update('node', {
        blockRussia: true,
        blockIpCheckers: false,
        revision: view.revision,
      }),
    ).rejects.toThrow('изменилась');
    expect(store.save).not.toHaveBeenCalled();
    expect(xui.saveXrayTemplate).not.toHaveBeenCalled();
  });

  it('rejects missing geodata before any write and permits IP-checker-only without geodata', async () => {
    xui.validateRoutingGeodata.mockRejectedValue(new Error('missing'));
    await expect(apply()).rejects.toThrow();
    expect(store.save).not.toHaveBeenCalled();
    expect(xui.saveXrayTemplate).not.toHaveBeenCalled();
    expect(await apply(false, true)).toMatchObject({ result: 'applied' });
  });

  it('rolls back even when the write succeeded remotely but its response was lost', async () => {
    const original = structuredClone(template);
    xui.saveXrayTemplate.mockImplementationOnce(async (_node, value) => {
      template = structuredClone(value);
      throw new Error('response lost');
    });
    expect(await apply()).toMatchObject({
      result: 'rolled_back',
      blockRussia: false,
    });
    expect(template).toEqual(original);
    expect(state).toEqual(emptyRoutingState());
  });

  it('rolls back partial sniffing writes and startup failure without losing clients', async () => {
    const original = structuredClone({ template, inbounds });
    xui.applyXrayConfig.mockRejectedValueOnce(new Error('cannot load geoip'));
    expect(await apply()).toMatchObject({ result: 'rolled_back' });
    expect(template).toEqual(original.template);
    expect(inbounds).toEqual(original.inbounds);
    expect(xui.applyXrayConfig).toHaveBeenCalledTimes(2);
  });

  it('reports rollback failure and retains an uncertainty marker, rather than claiming success', async () => {
    xui.applyXrayConfig.mockRejectedValue(new Error('startup failed'));
    expect(await apply()).toMatchObject({
      result: 'rollback_failed',
      revision: '',
      needsApply: true,
    });
    expect(state.pending).toBe(true);
  });

  it('reports unknown state when rollback cannot reach the panel', async () => {
    xui.saveXrayTemplate.mockImplementationOnce(async () => {
      xui.getXrayTemplate.mockRejectedValue({
        isAxiosError: true,
        message: 'network timeout',
      });
      throw new Error('network timeout');
    });
    expect(await apply()).toMatchObject({ result: 'unknown', revision: '' });
    expect(state.pending).toBe(true);
  });

  it('does not replace an externally edited routing table during rollback', async () => {
    xui.applyXrayConfig.mockImplementationOnce(async () => {
      (template.config.routing as { rules: object[] }).rules.push({
        domain: ['domain:external.test'],
        outboundTag: 'direct',
      });
      throw new Error('failed');
    });
    expect(await apply()).toMatchObject({ result: 'rollback_failed' });
    expect(JSON.stringify(template)).toContain('external.test');
  });

  it('uses fresh client settings immediately before updating sniffing', async () => {
    xui.saveXrayTemplate.mockImplementationOnce(async (_node, value) => {
      template = structuredClone(value);
      inbounds[0].settings = '{"clients":[{"id":"new-client"}]}';
    });
    expect(await apply()).toMatchObject({ result: 'applied' });
    expect(inbounds[0].settings).toContain('new-client');
    expect(sniffingObject(inbounds[0]).enabled).toBe(true);
  });

  it('marks unsupported/read failure unavailable without returning configuration or credentials', async () => {
    xui.getXrayTemplate.mockRejectedValue({
      response: { status: 403, data: { password: 'secret' } },
    });
    const view = await service.get('node');
    expect(view).toMatchObject({ available: false, revision: '' });
    expect(JSON.stringify(view)).not.toMatch(
      /secret|password|privateKey|xraySetting/,
    );
  });

  it('recovers an uncertain operation after confirming saved settings and running Xray', async () => {
    await apply();
    state.pending = true;
    const view = await service.get('node');
    expect(view.needsApply).toBe(false);
    expect(state.pending).toBe(false);
    expect(view.warnings.join(' ')).not.toContain('не завершена');
  });
});
