import * as dns from 'dns/promises';
import axios from 'axios';
import { XuiService } from 'src/xui/xui.service';
import { Node, NodeAuthType } from 'src/nodes/entities/node.entity';
import { SessionService } from 'src/session/session.service';
import { RoutingStore } from 'src/nodes/routing/routing-store.service';
import {
  emptyRoutingState,
  sniffingObject,
} from 'src/nodes/routing/routing-presets';
import {
  mergeCookies,
  normalizeInbound,
  responsePayload,
  isPortConflict,
} from 'src/xui/xui-contract';

jest.mock('axios');
jest.mock('dns/promises', () => ({
  __esModule: true,
  lookup: jest.fn(async () => []),
  resolve4: jest.fn(async () => []),
}));

const inbound = {
  id: 42,
  enable: true,
  protocol: 'vless',
  port: 443,
  settings: {
    clients: [{ id: 'client-id', email: 'test', enable: true }],
    decryption: 'none',
  },
  streamSettings: { network: 'tcp', security: 'none' },
  sniffing: null,
};
const tokenNode = {
  id: 'node',
  name: 'test',
  url: 'https://panel.test/base/',
  authType: NodeAuthType.Token,
  token: 'token',
} as Node;
const passwordNode = {
  ...tokenNode,
  authType: NodeAuthType.Password,
  login: 'admin',
  password: 'password',
} as Node;

describe('3x-ui API contracts', () => {
  let service: XuiService;
  let api: any;
  beforeEach(() => {
    api = {
      get: jest.fn(async (path: string) => {
        if (path === '/csrf-token')
          return {
            data: { success: true, obj: 'csrf' },
            headers: { 'set-cookie': ['session=current; Path=/; HttpOnly'] },
          };
        if (path === '/panel/api/inbounds/list')
          return { data: { success: true, obj: [inbound] }, headers: {} };
        if (path === '/panel/api/inbounds/get/42')
          return { data: { success: true, obj: inbound } };
        if (path === '/panel/api/server/status')
          return {
            data: {
              success: true,
              obj: {
                panelVersion: '3.8.5',
                xray: { version: '26.9.9', state: 'running', errorMsg: '' },
              },
            },
          };
        if (path === '/panel/api/server/getPanelUpdateInfo')
          return { data: { success: true, obj: { currentVersion: '3.7.0' } } };
        if (path === '/panel/api/server/getWebCertFiles')
          return {
            data: {
              success: true,
              obj: {
                webCertFile: '/cert/fullchain.pem',
                webKeyFile: '/cert/privkey.pem',
              },
            },
          };
        throw { response: { status: 404 } };
      }),
      post: jest.fn(async (path: string) =>
        path === '/login'
          ? {
              data: { success: true },
              headers: { 'set-cookie': ['session=logged-in; Path=/'] },
            }
          : { data: { success: true, obj: inbound }, headers: {} },
      ),
      defaults: { headers: { common: {} } },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    (axios.create as jest.Mock).mockReturnValue(api);
    service = new XuiService(
      {
        find: jest.fn(async () => [
          { key: 'xui_url', value: tokenNode.url },
          { key: 'xui_login', value: 'admin' },
          { key: 'xui_password', value: 'password' },
        ]),
      } as any,
      new SessionService(),
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('reads back the modern object response and returns the saved configuration', async () => {
    const result = await service.addInbound(
      normalizeInbound(inbound),
      tokenNode,
    );
    expect(result).toEqual({ id: 42, inbound: normalizeInbound(inbound) });
    expect(api.get).toHaveBeenCalledWith('/panel/api/inbounds/get/42');
    expect(api.defaults.headers.common.Authorization).toBe('Bearer token');
    expect(api.get).not.toHaveBeenCalledWith('/csrf-token');
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://panel.test/base',
        maxRedirects: 0,
      }),
    );
  });

  const routingConfig = {
    outbounds: [{ tag: 'direct', protocol: 'freedom' }],
    routing: { rules: [] },
  };

  it.each([false, true])(
    'reads Xray wrapper and template JSON with string encoding=%s',
    async (encoded) => {
      const wrapper = {
        xraySetting: encoded ? JSON.stringify(routingConfig) : routingConfig,
        outboundTestUrl: 'https://probe.test',
      };
      api.post.mockResolvedValue({
        data: {
          success: true,
          obj: encoded ? JSON.stringify(wrapper) : wrapper,
        },
      });
      expect(await service.getXrayTemplate(tokenNode)).toEqual({
        path: '/panel/api/xray',
        config: routingConfig,
        outboundTestUrl: 'https://probe.test',
      });
      expect(api.defaults.headers.common.Authorization).toBe('Bearer token');
    },
  );

  it('selects legacy routes only after a confirmed missing read route', async () => {
    api.post
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValue({
        data: {
          success: true,
          obj: {
            xraySetting: routingConfig,
            outboundTestUrl: 'https://probe.test',
          },
        },
      });
    expect(await service.getXrayTemplate(tokenNode)).toMatchObject({
      path: '/panel/xray',
    });
    expect(api.post.mock.calls.map((args: unknown[]) => args[0])).toEqual([
      '/panel/api/xray/',
      '/panel/xray/',
    ]);
  });

  it('does not hide auth failure by trying a different route', async () => {
    api.post.mockRejectedValue({ response: { status: 403 } });
    await expect(service.getXrayTemplate(tokenNode)).rejects.toBeDefined();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('saves a form-encoded template, preserving the test URL, and never tries alternate write routes', async () => {
    await service.saveXrayTemplate(tokenNode, {
      path: '/panel/xray',
      config: routingConfig,
      outboundTestUrl: 'https://probe.test/a?b=1&c=2',
    });
    const [path, body] = api.post.mock.calls[0] as [string, URLSearchParams];
    expect(path).toBe('/panel/xray/update');
    expect(JSON.parse(body.get('xraySetting'))).toEqual(routingConfig);
    expect(body.get('outboundTestUrl')).toBe('https://probe.test/a?b=1&c=2');
    api.post.mockClear().mockRejectedValue({ response: { status: 404 } });
    await expect(
      service.saveXrayTemplate(tokenNode, {
        path: '/panel/xray',
        config: routingConfig,
        outboundTestUrl: '',
      }),
    ).rejects.toBeDefined();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('uses password sessions and rotated CSRF tokens for template writes', async () => {
    await service.saveXrayTemplate(passwordNode, {
      path: '/panel/api/xray',
      config: routingConfig,
      outboundTestUrl: 'https://probe.test',
    });
    expect(api.post).toHaveBeenCalledWith(
      '/login',
      expect.objectContaining({ username: 'admin' }),
    );
    expect(api.defaults.headers.common.Cookie).toContain('session=');
    expect(api.defaults.headers.common['X-CSRF-Token']).toBe('csrf');
  });

  it('checks both domain and IP geodata and distinguishes an unavailable validator', async () => {
    api.post.mockResolvedValue({ data: { success: true, obj: [] } });
    expect(
      await service.validateRoutingGeodata(tokenNode, '/panel/api/xray', {
        blockRussia: true,
        blockIpCheckers: false,
      }),
    ).toBe(true);
    expect(
      api.post.mock.calls.map((call: [string, URLSearchParams]) => [
        call[1].get('kind'),
        call[1].get('tokens'),
      ]),
    ).toEqual([
      ['domain', 'geosite:category-ru'],
      ['ip', 'geoip:ru'],
    ]);
    api.post.mockRejectedValue({ response: { status: 404 } });
    expect(
      await service.validateRoutingGeodata(tokenNode, '/panel/api/xray', {
        blockRussia: true,
        blockIpCheckers: false,
      }),
    ).toBe(false);
    api.post.mockResolvedValue({
      data: { success: true, obj: [{ reason: 'categoryMissing' }] },
    });
    await expect(
      service.validateRoutingGeodata(tokenNode, '/panel/api/xray', {
        blockRussia: true,
        blockIpCheckers: false,
      }),
    ).rejects.toThrow('category-ru');
  });

  it('validates only Google geodata for Google-only routing', async () => {
    api.post.mockResolvedValue({ data: { success: true, obj: [] } });
    expect(
      await service.validateRoutingGeodata(tokenNode, '/panel/api/xray', {
        blockRussia: false,
        blockIpCheckers: false,
        googleIpv4: true,
      }),
    ).toBe(true);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls[0][1].get('tokens')).toBe('geosite:google');
    expect(api.post.mock.calls[0][1].get('kind')).toBe('domain');
  });

  it('rejects HTTP-200 API errors and invalid Xray templates', async () => {
    api.post.mockResolvedValue({ data: { success: false, msg: 'rejected' } });
    await expect(
      service.saveXrayTemplate(tokenNode, {
        path: '/panel/api/xray',
        config: routingConfig,
        outboundTestUrl: '',
      }),
    ).rejects.toThrow('rejected');
    api.post.mockResolvedValue({
      data: { success: true, obj: { xraySetting: '{broken' } },
    });
    await expect(service.getXrayTemplate(tokenNode)).rejects.toThrow();
  });

  it('preserves inbound clients/settings and excludes read-only counters during sniffing updates', async () => {
    await service.updateInboundSniffing(tokenNode, {
      ...normalizeInbound(inbound),
      up: 100,
      down: 200,
      clientStats: [{ email: 'client' }],
    });
    const [path, payload] = api.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(path).toBe('/panel/api/inbounds/update/42');
    expect(JSON.parse(payload.settings as string)).toEqual(inbound.settings);
    expect(payload).not.toHaveProperty('up');
    expect(payload).not.toHaveProperty('clientStats');
  });

  it.each([{ blockIpCheckers: true }, { googleIpv4: true }])(
    'applies active sniffing %j to newly created/rotated inbounds and persists restoration fields under the node lock',
    async (selection) => {
      const state = { ...emptyRoutingState(), ...selection };
      const store = {
        node: jest.fn(async () => ({ ...tokenNode, routingPresets: state })),
        save: jest.fn(async () => undefined),
        withLock: jest.fn(async (_id: string, work: () => Promise<unknown>) =>
          work(),
        ),
      };
      service = new XuiService(
        {} as never,
        new SessionService(),
        store as unknown as RoutingStore,
      );
      api.get.mockImplementation(async (path: string) => {
        if (path === '/panel/api/inbounds/get/42')
          return {
            data: {
              success: true,
              obj: {
                ...api.post.mock.calls.find(
                  (call: unknown[]) => call[0] === '/panel/api/inbounds/add',
                )[1],
                id: 42,
              },
            },
          };
        throw new Error('unexpected read');
      });
      const created = await service.addInbound(
        { ...normalizeInbound(inbound), sniffing: '{"enabled":false}' },
        tokenNode,
      );
      expect(sniffingObject(created.inbound)).toMatchObject({
        enabled: true,
        routeOnly: true,
        metadataOnly: false,
      });
      expect(store.withLock).toHaveBeenCalledWith('node', expect.any(Function));
      expect(store.save).toHaveBeenCalledWith(
        'node',
        expect.objectContaining({
          sniffing: {
            '42': expect.objectContaining({
              fields: expect.objectContaining({
                enabled: { before: false, after: true },
              }),
            }),
          },
        }),
      );
      api.get.mockResolvedValue({
        data: { success: true, obj: normalizeInbound(inbound) },
      });
      const ignoredSniffing = await service.addInbound(
        normalizeInbound(inbound),
        tokenNode,
      );
      expect(ignoredSniffing).toMatchObject({
        id: 42,
        verificationError: '3x-ui не сохранила sniffing нового inbound',
      });
    },
  );

  it('accepts legacy JSON strings and numeric creation IDs', async () => {
    api.post.mockResolvedValue({ data: { success: true, obj: '42' } });
    api.get.mockResolvedValue({
      data: { success: true, obj: normalizeInbound(inbound) },
    });
    await expect(
      service.addInbound(normalizeInbound(inbound), tokenNode),
    ).resolves.toEqual({ id: 42, inbound: normalizeInbound(inbound) });
  });

  it('preserves the ID for cleanup when readback fails', async () => {
    api.get.mockRejectedValue({ response: { status: 503 } });
    await expect(
      service.addInbound(normalizeInbound(inbound), tokenNode),
    ).resolves.toMatchObject({
      id: 42,
      verificationError: '3x-ui returned HTTP 503',
    });
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('rejects disabled readback without losing ownership', async () => {
    api.get.mockResolvedValue({
      data: { success: true, obj: { ...inbound, enable: false } },
    });
    await expect(
      service.addInbound(normalizeInbound(inbound), tokenNode),
    ).resolves.toMatchObject({ id: 42, verificationError: expect.any(String) });
  });

  it('adds and deletes individual clients on a shared inbound via addClient/delClient and update fallback', async () => {
    const baseInbound = {
      ...normalizeInbound(inbound),
      id: 82,
      settings: JSON.stringify({
        clients: [{ id: 'client-a', email: 'sub-a', enable: true }],
      }),
    };
    const updatedInbound = {
      ...baseInbound,
      settings: JSON.stringify({
        clients: [
          { id: 'client-a', email: 'sub-a', enable: true },
          { id: 'client-b', email: 'sub-b', enable: true },
        ],
      }),
    };

    api.get
      .mockResolvedValueOnce({ data: { success: true, obj: baseInbound } })
      .mockResolvedValueOnce({ data: { success: true, obj: updatedInbound } });
    api.post.mockResolvedValueOnce({ data: { success: true, obj: null } });

    const attached = await service.addInboundClient(
      82,
      { id: 'client-b', email: 'sub-b', enable: true },
      tokenNode,
    );
    expect(attached?.id).toBe(82);
    expect(api.post).toHaveBeenCalledWith(
      '/panel/api/inbounds/addClient',
      expect.objectContaining({ id: 82 }),
    );

    // Deleting a single client via /delClient/
    api.post.mockResolvedValueOnce({ data: { success: true, obj: null } });
    await expect(
      service.deleteInboundClient(82, 'client-b', tokenNode),
    ).resolves.toBe(true);
    expect(api.post).toHaveBeenCalledWith(
      '/panel/api/inbounds/82/delClient/client-b',
    );

    // Fallback when /delClient/ returns 404: removes client via update/:id while preserving sibling
    api.post.mockRejectedValueOnce({ response: { status: 404 } });
    api.get.mockResolvedValueOnce({
      data: { success: true, obj: updatedInbound },
    });
    api.post.mockResolvedValueOnce({ data: { success: true, obj: null } });
    await expect(
      service.deleteInboundClient(82, 'client-b', tokenNode),
    ).resolves.toBe(true);
    expect(api.post).toHaveBeenLastCalledWith(
      '/panel/api/inbounds/update/82',
      expect.objectContaining({
        settings: expect.stringContaining('client-a'),
      }),
    );
  });

  it.each([
    { success: false, msg: 'Port 443 is already in use' },
    '<html>login</html>',
  ])('rejects HTTP 200 errors: %j', async (data) => {
    api.post.mockResolvedValue({ data });
    await expect(
      service.addInbound(normalizeInbound(inbound), tokenNode),
    ).resolves.toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('uses the separate client API and verifies membership of the requested inbound', async () => {
    const node = { ...tokenNode, version: '3.11.0-awg.2' };
    const client = { id: '11111111-2222-4333-8444-555555555555', email: 'User-11111111', enable: true };
    const updated = {
      ...inbound,
      settings: { ...inbound.settings, clients: [...inbound.settings.clients, client] },
    };
    api.get
      .mockResolvedValueOnce({ data: { success: true, obj: inbound } })
      .mockResolvedValueOnce({ data: { success: true, obj: updated } });
    await expect(service.addInboundClient(42, client, node)).resolves.toMatchObject({
      id: 42,
      inbound: { settings: JSON.stringify(updated.settings) },
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/panel/api/clients/add', {
      client, inboundIds: [42],
    });

    await expect(service.addInboundClient(42, client, node)).resolves.toMatchObject({
      id: 42,
      verificationError: '3x-ui не подтвердила привязку клиента к общему inbound 42',
    });
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it.each([
    { inboundIds: [], externalLinks: [], expected: 'delete' },
    { inboundIds: [42], externalLinks: [], expected: 'delete' },
    { inboundIds: [42, 56], externalLinks: [], expected: 'detach' },
    { inboundIds: [42], externalLinks: [{}], expected: 'detach' },
  ])('cleans up exactly the owned client when attachment data is %j', async ({
    inboundIds, externalLinks, expected,
  }) => {
    const node = { ...tokenNode, version: '3.11.0-awg.2' };
    const uuid = '11111111-2222-4333-8444-555555555555';
    const email = 'User-11111111';
    api.get
      .mockResolvedValueOnce({ data: { success: true, obj: inbound } })
      .mockResolvedValueOnce({ data: { success: true, obj: [{ uuid, email }] } })
      .mockResolvedValueOnce({
        data: { success: true, obj: { client: { uuid, email }, inboundIds, externalLinks } },
      });
    await expect(service.deleteInboundClient(42, uuid, node)).resolves.toBe(true);
    expect(api.post).toHaveBeenCalledTimes(1);
    if (expected === 'delete') {
      expect(api.post).toHaveBeenCalledWith(`/panel/api/clients/del/${email}`);
    } else {
      expect(api.post).toHaveBeenCalledWith(`/panel/api/clients/${email}/detach`, {
        inboundIds: [42],
      });
    }
  });

  it('preserves an inbound when its ID has been reused for a different client', async () => {
    const node = { ...tokenNode, version: '3.11.0-awg.2' };
    api.get
      .mockResolvedValueOnce({ data: { success: true, obj: inbound } })
      .mockResolvedValueOnce({ data: { success: true, obj: inbound } })
      .mockResolvedValueOnce({ data: { success: true, obj: [] } });
    await expect(service.deleteInbound(42, node, 'old-client')).resolves.toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('cleans up the known client after deleting a newly created VLESS inbound', async () => {
    const node = { ...tokenNode, version: '3.11.0-awg.2' };
    const uuid = '11111111-2222-4333-8444-555555555555';
    const email = 'User-11111111';
    const saved = {
      ...inbound,
      settings: { ...inbound.settings, clients: [{ id: uuid, email }] },
    };
    api.get
      .mockResolvedValueOnce({ data: { success: true, obj: saved } })
      .mockResolvedValueOnce({
        data: {
          success: true, obj: { client: { uuid, email }, inboundIds: [], externalLinks: [] },
        },
      });
    await expect(service.deleteInbound(42, node, uuid)).resolves.toBe(true);
    expect(api.post.mock.calls.map(([path]) => path)).toEqual([
      '/panel/api/inbounds/del/42', `/panel/api/clients/del/${email}`,
    ]);
    expect(api.get).not.toHaveBeenCalledWith('/panel/api/clients/list');
  });

  it('does not silently change a port or retry a network failure', async () => {
    const config = normalizeInbound(inbound);
    api.post.mockRejectedValue({ message: 'timeout' });
    await expect(service.addInbound(config, tokenNode)).resolves.toBeNull();
    expect(config.port).toBe(443);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('refreshes CSRF and merges the refreshed session cookie', async () => {
    api.post
      .mockResolvedValueOnce({
        data: { success: true },
        headers: { 'set-cookie': ['session=logged-in; HttpOnly'] },
      })
      .mockRejectedValueOnce({ response: { status: 403 } })
      .mockResolvedValueOnce({ data: { success: true, obj: 42 } });
    const result = await service.addInbound(
      normalizeInbound(inbound),
      passwordNode,
    );
    expect(result?.id).toBe(42);
    expect(api.defaults.headers.common.Cookie).toBe('session=current');
    expect(api.defaults.headers.common['X-CSRF-Token']).toBe('csrf');
    expect(api.post).toHaveBeenCalledWith(
      '/login',
      expect.objectContaining({ _csrf: 'csrf' }),
    );
  });

  it('reauthenticates once on a cookie session 401', async () => {
    api.post
      .mockResolvedValueOnce({
        data: { success: true },
        headers: { 'set-cookie': ['session=one'] },
      })
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({
        data: { success: true },
        headers: { 'set-cookie': ['session=two'] },
      })
      .mockResolvedValueOnce({ data: { success: true, obj: 42 } });
    await expect(
      service.addInbound(normalizeInbound(inbound), passwordNode),
    ).resolves.toMatchObject({ id: 42 });
  });

  it('does not retry rejected bearer credentials', async () => {
    api.post.mockRejectedValue({ response: { status: 403 } });
    await expect(
      service.addInbound(normalizeInbound(inbound), tokenNode),
    ).resolves.toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('requires login success even when a cookie was set', async () => {
    api.post.mockResolvedValue({
      data: { success: false },
      headers: { 'set-cookie': ['session=anonymous'] },
    });
    await expect(service.login()).resolves.toBe(false);
  });

  it('supports CSRF HTML with reversed attribute order on older panels', async () => {
    const get = api.get.getMockImplementation();
    api.get.mockImplementation(async (path: string) => {
      if (path === '/csrf-token') throw { response: { status: 404 } };
      if (path === '/login')
        return {
          data: '<meta content="legacy-token" name="csrf-token">',
          headers: {},
        };
      return get(path);
    });
    await expect(service.login()).resolves.toBe(true);
    expect(api.defaults.headers.common['X-CSRF-Token']).toBe('legacy-token');
  });

  it('uses panelVersion and reports Xray independently from API availability', async () => {
    await expect(service.checkNodeConnection(tokenNode)).resolves.toMatchObject(
      {
        success: true,
        version: '3.8.5',
        xrayVersion: '26.9.9',
        xrayState: 'running',
        webCertificateFile: '/cert/fullchain.pem',
      },
    );
  });

  it.each([
    { success: false, msg: 'Access denied' },
    '<html>login</html>',
    { success: true, obj: {} },
  ])('rejects invalid inbound lists: %j', async (data) => {
    api.get.mockResolvedValue({ data });
    await expect(service.checkNodeConnection(tokenNode)).resolves.toMatchObject(
      { success: false, errorType: 'api' },
    );
  });

  it('classifies network failures separately from authentication', async () => {
    api.get.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(service.checkNodeConnection(tokenNode)).resolves.toMatchObject(
      { success: false, errorType: 'network' },
    );
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT'])(
    'preserves network error code %s without the original request',
    async (code) => {
      api.get.mockRejectedValue(
        Object.assign(new Error('failed password=secret'), { code }),
      );
      const result = await service.checkNodeConnection(tokenNode);
      expect(result.message).toContain(code);
      expect(result.message).not.toContain('secret');
    },
  );

  it('requires a running Xray before activation', async () => {
    await expect(service.waitForXray(tokenNode)).resolves.toBeUndefined();
    api.get.mockResolvedValue({
      data: {
        success: true,
        obj: { xray: { state: 'error', errorMsg: 'invalid transport' } },
      },
    });
    jest.spyOn(global, 'setTimeout').mockImplementation(((
      callback: () => void,
    ) => {
      callback();
      return 0;
    }) as any);
    await expect(service.waitForXray(tokenNode)).rejects.toThrow(
      'invalid transport',
    );
  });

  it('returns false for ambiguous deletion HTTP 404', async () => {
    api.post.mockRejectedValue({ response: { status: 404 } });
    await expect(service.deleteInbound(42, tokenNode)).resolves.toBe(false);
  });

  it('accepts a confirmed already absent inbound', async () => {
    api.post.mockResolvedValue({
      data: { success: false, msg: 'record not found' },
    });
    await expect(service.deleteInbound(42, tokenNode)).resolves.toBe(true);
  });

  it('validates Reality key responses', async () => {
    api.get.mockResolvedValue({
      data: {
        success: true,
        obj: { privateKey: 'private', publicKey: 'public' },
      },
    });
    await expect(service.getNewX25519Cert(tokenNode)).resolves.toEqual({
      privateKey: 'private',
      publicKey: 'public',
    });
    api.get.mockResolvedValue({
      data: { success: true, obj: { privateKey: 'private' } },
    });
    await expect(service.getNewX25519Cert(tokenNode)).resolves.toBeNull();
  });

  it('maps modern and legacy discovery fields', async () => {
    api.get.mockResolvedValue({
      data: {
        success: true,
        obj: [
          {
            address: 'edge.test',
            port: 2053,
            scheme: 'https',
            basePath: '/secret/',
            panelVersion: '3.8.5',
          },
          { host: 'old.test', port: 2053, protocol: 'http', version: '2.9.4' },
          { address: 'bad.test', port: 0, scheme: 'file' },
        ],
      },
    });
    await expect(service.getNodes(tokenNode)).resolves.toEqual([
      {
        host: 'edge.test',
        port: 2053,
        protocol: 'https',
        basePath: '/secret/',
        version: '3.8.5',
      },
      {
        host: 'old.test',
        port: 2053,
        protocol: 'http',
        basePath: '/',
        version: '2.9.4',
      },
    ]);
  });

  describe('pacing and safe mutation retries', () => {
    afterEach(() => {
      delete process.env.PANEL_MUTATION_INTERVAL_MS;
    });

    it('serializes mutations per node and honors PANEL_MUTATION_INTERVAL_MS', async () => {
      process.env.PANEL_MUTATION_INTERVAL_MS = '100';
      const events: string[] = [];
      let resolveFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      const timestamps: number[] = [];

      api.post.mockImplementation(async (path: string) => {
        timestamps.push(Date.now());
        events.push(`start:${path}`);
        if (events.length === 1) await firstGate;
        events.push(`end:${path}`);
        return { data: { success: true, obj: 42 } };
      });

      const first = service.addInbound(normalizeInbound(inbound), tokenNode);
      const second = service.deleteInbound(42, tokenNode);

      // Give event loop a tick so first starts and blocks on firstGate; second must wait in queue.
      await new Promise((r) => setTimeout(r, 20));
      expect(events).toEqual(['start:/panel/api/inbounds/add']);

      resolveFirst();
      await Promise.all([first, second]);

      expect(events).toEqual([
        'start:/panel/api/inbounds/add',
        'end:/panel/api/inbounds/add',
        'start:/panel/api/inbounds/del/42',
        'end:/panel/api/inbounds/del/42',
      ]);
      expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(85);
    });

    it('recovers inbound ID by unique tag after lost add response without sending a second POST', async () => {
      let sentTag: string | undefined;
      api.post.mockImplementationOnce(async (_path: string, body: { tag?: string }) => {
        sentTag = body.tag;
        throw { message: 'socket hang up' };
      });
      const origGet = api.get.getMockImplementation();
      api.get.mockImplementation(async (path: string) => {
        if (path === '/panel/api/inbounds/list') {
          return {
            data: { success: true, obj: [{ ...inbound, id: 42, tag: sentTag }] },
          };
        }
        return origGet(path);
      });

      const result = await service.addInbound(normalizeInbound(inbound), tokenNode);

      expect(sentTag).toMatch(/^3dp-/);
      expect(result).toEqual({ id: 42, inbound: normalizeInbound(inbound) });
      expect(api.post).toHaveBeenCalledTimes(1);
    });

    it('retries create on HTTP 429 and transient database-locked panel messages', async () => {
      api.post
        .mockRejectedValueOnce({ response: { status: 429 } })
        .mockResolvedValueOnce({ data: { success: false, msg: 'database is locked' } })
        .mockResolvedValueOnce({ data: { success: true, obj: 42 } });

      const result = await service.addInbound(normalizeInbound(inbound), tokenNode);

      expect(result).toEqual({ id: 42, inbound: normalizeInbound(inbound) });
      expect(api.post).toHaveBeenCalledTimes(3);
    });

    it('retries delete on HTTP 503 and returns true once panel list confirms absence', async () => {
      api.post
        .mockRejectedValueOnce({ response: { status: 503 } })
        .mockResolvedValueOnce({ data: { success: true, obj: null } });
      api.get.mockResolvedValueOnce({
        data: { success: true, obj: [inbound] }, // id 42 still present after 1st 503
      });

      await expect(service.deleteInbound(42, tokenNode)).resolves.toBe(true);
      expect(api.post).toHaveBeenCalledTimes(2);

      // If inbounds/list already shows id 42 gone after a 503, treat as deleted without a 2nd POST
      api.post.mockRejectedValueOnce({ response: { status: 503 } });
      api.get.mockResolvedValueOnce({
        data: { success: true, obj: [] },
      });
      await expect(service.deleteInbound(42, tokenNode)).resolves.toBe(true);
      expect(api.post).toHaveBeenCalledTimes(3);
    });
  });

  describe('subscription client binding and usage', () => {
    const v3Node = { ...tokenNode, version: '3.8.5' } as Node;

    it('resolves existing clients by email or numeric ID (wrapped and flat lists) and rejects 2.x nodes', async () => {
      const legacyNode = { ...tokenNode, version: '2.9.4' } as Node;
      await expect(
        service.prepareSubscriptionClient('alice', false, legacyNode),
      ).rejects.toThrow('3x-ui 3.x');

      // By numeric ID with wrapped { client: { id, email } } response
      api.get
        .mockResolvedValueOnce({
          data: {
            success: true,
            obj: [{ client: { id: 7, email: 'alice' } }],
          },
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            obj: {
              client: { id: 7, uuid: 'uuid-alice', email: 'alice', enable: true },
            },
          },
        });

      const resolvedWrapped = await service.prepareSubscriptionClient(
        '7',
        false,
        v3Node,
      );
      expect(resolvedWrapped).toMatchObject({ id: 'uuid-alice', email: 'alice' });

      // By numeric ID with flat { id, email } response
      api.get
        .mockResolvedValueOnce({
          data: {
            success: true,
            obj: [{ id: 8, email: 'bob' }],
          },
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            obj: {
              client: { id: 8, uuid: 'uuid-bob', email: 'bob', enable: true },
            },
          },
        });

      const resolvedFlat = await service.prepareSubscriptionClient(
        '8',
        false,
        v3Node,
      );
      expect(resolvedFlat).toMatchObject({ id: 'uuid-bob', email: 'bob' });
    });

    it('auto-creates an unattached client via /panel/api/clients/import', async () => {
      api.post.mockResolvedValueOnce({ data: { success: true } });
      api.get.mockResolvedValueOnce({
        data: {
          success: true,
          obj: {
            client: { uuid: 'uuid-auto', email: '3dp-sub-1', enable: true },
          },
        },
      });

      const client = await service.prepareSubscriptionClient(
        '3dp-sub-1',
        true,
        v3Node,
      );

      expect(api.post).toHaveBeenCalledWith(
        '/panel/api/clients/import',
        expect.objectContaining({ data: expect.any(String) }),
      );
      expect(client).toMatchObject({ id: 'uuid-auto', email: '3dp-sub-1' });
    });

    it('fetches usage from traffic endpoint and falls back to usedTraffic', async () => {
      api.get
        .mockResolvedValueOnce({
          data: {
            success: true,
            obj: {
              client: { totalGB: 1024, expiryTime: 1800000000500 },
              usedTraffic: 500,
            },
          },
        })
        .mockResolvedValueOnce({
          data: { success: true, obj: { up: 100, down: 400 } },
        });

      await expect(
        service.getSubscriptionUsage('alice', v3Node),
      ).resolves.toEqual({
        upload: 100,
        download: 400,
        total: 1024,
        expire: 1800000000,
      });

      api.get
        .mockResolvedValueOnce({
          data: {
            success: true,
            obj: {
              client: { totalGB: 2048, expiryTime: 0 },
              usedTraffic: 750,
            },
          },
        })
        .mockRejectedValueOnce({ response: { status: 404 } });

      await expect(
        service.getSubscriptionUsage('alice', v3Node),
      ).resolves.toEqual({
        upload: 0,
        download: 750,
        total: 2048,
        expire: 0,
      });
    });

    it('creates an empty inbound, attaches the subscription client, and rolls back if attach fails', async () => {
      const boundClient = {
        id: 'uuid-alice',
        email: 'alice',
        enable: true,
      };
      const attachedInbound = {
        ...inbound,
        settings: { clients: [boundClient], decryption: 'none' },
      };
      api.post.mockResolvedValue({ data: { success: true, obj: 42 } });
      api.get
        .mockResolvedValueOnce({
          data: {
            success: true,
            obj: { ...inbound, settings: { clients: [], decryption: 'none' } },
          },
        })
        .mockResolvedValueOnce({
          data: { success: true, obj: attachedInbound },
        });

      const created = await service.addInboundForClient(
        normalizeInbound(inbound),
        boundClient,
        v3Node,
      );

      expect(created?.id).toBe(42);
      expect(api.post).toHaveBeenNthCalledWith(
        1,
        '/panel/api/inbounds/add',
        expect.objectContaining({
          settings: JSON.stringify({ clients: [], decryption: 'none' }),
        }),
      );
      expect(api.post).toHaveBeenNthCalledWith(
        2,
        '/panel/api/clients/alice/attach',
        { inboundIds: [42] },
      );

      // Failure on attach deletes the newly created inbound and returns null
      api.post.mockClear();
      api.post
        .mockResolvedValueOnce({ data: { success: true, obj: 42 } })
        .mockResolvedValueOnce({ data: { success: false, msg: 'attach failed' } })
        .mockResolvedValueOnce({ data: { success: true } });
      api.get.mockResolvedValueOnce({
        data: {
          success: true,
          obj: { ...inbound, settings: { clients: [], decryption: 'none' } },
        },
      });

      await expect(
        service.addInboundForClient(
          normalizeInbound(inbound),
          boundClient,
          v3Node,
        ),
      ).resolves.toBeNull();
      expect(api.post).toHaveBeenCalledWith('/panel/api/inbounds/del/42');
    });

    it('attaches existing client to a shared inbound and detaches without deleting 3dp-* subscription clients', async () => {
      const sharedClient = {
        id: 'uuid-sub-client',
        email: '3dp-sub-uuid',
        enable: true,
      };
      const updated = {
        ...inbound,
        settings: {
          ...inbound.settings,
          clients: [...inbound.settings.clients, sharedClient],
        },
      };
      api.get
        .mockResolvedValueOnce({ data: { success: true, obj: inbound } })
        .mockResolvedValueOnce({ data: { success: true, obj: updated } });
      api.post.mockResolvedValueOnce({ data: { success: true } });

      const attached = await service.attachExistingClientToInbound(
        42,
        sharedClient,
        v3Node,
      );
      expect(attached?.id).toBe(42);
      expect(api.post).toHaveBeenCalledWith(
        '/panel/api/clients/3dp-sub-uuid/attach',
        { inboundIds: [42] },
      );

      // Deleting the owned inbound detaches the 3dp-* client instead of deleting it
      api.post.mockClear();
      api.get
        .mockResolvedValueOnce({
          data: {
            success: true,
            obj: {
              ...inbound,
              settings: { clients: [sharedClient], decryption: 'none' },
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            obj: {
              client: { uuid: 'uuid-sub-client', email: '3dp-sub-uuid' },
              inboundIds: [42],
              externalLinks: [],
            },
          },
        });
      api.post.mockResolvedValue({ data: { success: true } });

      await expect(
        service.deleteInbound(42, v3Node, 'uuid-sub-client'),
      ).resolves.toBe(true);
      expect(api.post).toHaveBeenCalledWith('/panel/api/inbounds/del/42');
      expect(api.post).toHaveBeenCalledWith(
        '/panel/api/clients/3dp-sub-uuid/detach',
        { inboundIds: [42] },
      );
      expect(api.post).not.toHaveBeenCalledWith(
        '/panel/api/clients/del/3dp-sub-uuid',
      );
    });
  });

  describe('agent invalidation, TLS diagnostics, and direct-IP fallback', () => {
    it('destroys cached keep-alive agents when invalidatePanelAgent is called', async () => {
      await service.waitForXray(tokenNode);
      const firstCallConfig = (axios.create as jest.Mock).mock.calls[0]?.[0] as {
        httpsAgent?: { destroy: () => void };
      };
      expect(firstCallConfig?.httpsAgent).toBeDefined();
      const destroySpy = jest.spyOn(firstCallConfig.httpsAgent!, 'destroy');

      service.invalidatePanelAgent(tokenNode.url);
      expect(destroySpy).toHaveBeenCalledTimes(1);

      await service.waitForXray(tokenNode);
      const secondCallConfig = (axios.create as jest.Mock).mock.calls[1]?.[0] as {
        httpsAgent?: unknown;
      };
      expect(secondCallConfig?.httpsAgent).not.toBe(firstCallConfig.httpsAgent);

      service.invalidatePanelAgent();
    });

    it('reports actionable diagnostics and Russian hint for TLS certificate errors', async () => {
      api.get.mockRejectedValue(
        Object.assign(
          new Error('Hostname/IP does not match certificate altnames'),
          { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
        ),
      );

      const result = await service.checkNodeConnection(tokenNode);

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('network');
      expect(result.message).toContain('ERR_TLS_CERT_ALTNAME_INVALID');
      expect(result.diagnostics?.errorCode).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
      expect(result.diagnostics?.hint).toContain('Разрешить недоверенный TLS-сертификат');
    });

    it('supports preferDirectIp and automatic direct-IP fallback on stale DNS timeout', async () => {
      jest.spyOn(dns, 'lookup').mockResolvedValue([
        { address: '198.51.100.1', family: 4 },
      ] as never);

      const domainNode = {
        ...tokenNode,
        ip: '203.0.113.10',
      } as Node;

      const directResult = await service.checkNodeConnection(domainNode, {
        preferDirectIp: true,
      });
      expect(directResult.success).toBe(true);
      expect(directResult.diagnostics?.usedDirectIp).toBe(true);
      const createdOpts = (axios.create as jest.Mock).mock.calls[0]?.[0] as {
        httpsAgent?: { options?: { servername?: string; lookup?: unknown } };
      };
      expect(createdOpts?.httpsAgent?.options?.servername).toBe('panel.test');
      expect(typeof createdOpts?.httpsAgent?.options?.lookup).toBe('function');

      (axios.create as jest.Mock).mockClear();
      const defaultImpl = api.get.getMockImplementation();
      let firstInboundListAttempt = true;
      api.get.mockImplementation(async (path: string) => {
        if (path === '/panel/api/inbounds/list' && firstInboundListAttempt) {
          firstInboundListAttempt = false;
          throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
        }
        return defaultImpl(path);
      });

      const fallbackResult = await service.checkNodeConnection(domainNode);
      expect(fallbackResult.success).toBe(true);
      expect(fallbackResult.diagnostics?.usedDirectIp).toBe(true);
      expect(fallbackResult.diagnostics?.resolvedIps).toEqual(['198.51.100.1']);
      expect(fallbackResult.diagnostics?.configuredIp).toBe('203.0.113.10');
    });

    it('fast-fails attachCsrfToken on network timeout without polling all CSRF endpoints', async () => {
      api.get.mockRejectedValue(
        Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' }),
      );

      const result = await service.checkNodeConnection(passwordNode);

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('network');
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(api.get).toHaveBeenCalledWith('/csrf-token');
    });
  });
});

describe('wire normalization', () => {
  it('merges cookies without duplicating names or forwarding attributes', () => {
    expect(
      mergeCookies('session=old; other=keep', [
        'session=new; Path=/; HttpOnly',
        'csrf=value; Secure',
      ]),
    ).toBe('session=new; other=keep; csrf=value');
    expect(
      mergeCookies('session=old; other=keep', ['session=; Max-Age=0']),
    ).toBe('other=keep');
  });
  it('rejects malformed JSON instead of silently publishing empty settings', () => {
    expect(() => normalizeInbound({ ...inbound, settings: 'bad' })).toThrow(
      'settings',
    );
    expect(() => responsePayload({ success: false, msg: 'Denied' })).toThrow(
      'Denied',
    );
  });
  it.each(['Port 443 is already in use', 'port 443 exists', 'Порт 443 занят'])(
    'recognizes port conflict: %s',
    (message) => {
      expect(isPortConflict(message)).toBe(true);
    },
  );
});
