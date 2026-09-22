import axios from 'axios';
import { XuiService } from 'src/xui/xui.service';
import { Node, NodeAuthType } from 'src/nodes/entities/node.entity';
import { SessionService } from 'src/session/session.service';
import {
  mergeCookies,
  normalizeInbound,
  responsePayload,
  isPortConflict,
} from 'src/xui/xui-contract';

jest.mock('axios');

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
