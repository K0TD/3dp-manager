import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import * as https from 'https';
import { Setting } from '../settings/entities/setting.entity';
import { XuiCertResult, XuiInboundRaw, XuiDiscoveredNode } from './xui.types';
import { SessionService } from '../session/session.service';
import { Node, NodeAuthType } from '../nodes/entities/node.entity';
import { isSafeAbsoluteRemotePath } from '../inbounds/tls-config';
import {
  XuiApiError,
  asRecord,
  jsonObject,
  mergeCookies,
  normalizeInbound,
  responsePayload,
  safePanelMessage,
} from './xui-contract';

export type XuiConnectionError = 'auth' | 'network' | 'api';
export interface XuiConnectionStatus {
  success: boolean;
  version?: string;
  xrayVersion?: string;
  xrayState?: string;
  xrayError?: string;
  webCertificateFile?: string;
  webKeyFile?: string;
  responseTimeMs?: number;
  errorType?: XuiConnectionError;
  message?: string;
}
export interface XuiCertificateFiles {
  certificateFile: string;
  keyFile: string;
}
export interface XuiCreatedInbound {
  id: number;
  inbound: XuiInboundRaw;
  // A persisted inbound must remain available to the caller for cleanup even
  // when the subsequent detail request fails.
  verificationError?: string;
}

@Injectable()
export class XuiService {
  private readonly logger = new Logger(XuiService.name);
  private readonly lastInboundErrors = new Map<string, string>();

  constructor(
    @InjectRepository(Setting) private settingsRepo: Repository<Setting>,
    private sessionService: SessionService,
  ) {}

  getLastInboundError(node?: Node): string | undefined {
    return this.lastInboundErrors.get(node?.id || 'main');
  }

  private createApi(baseURL: string, allowInvalidTls = false): AxiosInstance {
    const api = axios.create({
      baseURL: baseURL.replace(/\/+$/, ''),
      timeout: 8000,
      proxy: false,
      withCredentials: true,
      maxRedirects: 0,
      httpsAgent: new https.Agent({ rejectUnauthorized: !allowInvalidTls }),
    });
    api.interceptors.request.use((config) => {
      config.signal ??= AbortSignal.timeout(config.timeout || 8000);
      return config;
    });
    api.interceptors.response.use(
      (response) => {
        this.acceptCookies(api, response);
        return response;
      },
      (error: AxiosError) => {
        if (error.response) this.acceptCookies(api, error.response);
        return Promise.reject(error);
      },
    );
    return api;
  }

  private acceptCookies(api: AxiosInstance, response?: AxiosResponse<unknown>) {
    if (!response?.headers?.['set-cookie']) return;
    api.defaults.headers.common.Cookie = mergeCookies(
      api.defaults.headers.common.Cookie as string | undefined,
      response.headers['set-cookie'],
    );
  }

  private csrfFromResponse(
    response?: AxiosResponse<unknown>,
  ): string | undefined {
    const header: unknown = response?.headers?.['x-csrf-token'];
    if (typeof header === 'string' && header) return header;
    const data: unknown = response?.data;
    if (data && typeof data === 'object') {
      const body = data as Record<string, unknown>;
      if (body.success === false) return undefined;
      const token =
        body.csrfToken ||
        body.token ||
        (typeof body.obj === 'string'
          ? body.obj
          : asRecord(body.obj)?.csrfToken || asRecord(body.obj)?.token);
      if (typeof token === 'string' && token) return token;
    }
    if (typeof data === 'string') {
      // Attribute order is not fixed in server-rendered login pages.
      for (const tag of data.match(/<(?:meta|input)\b[^>]*>/gi) || []) {
        const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
        if (!['csrf-token', '_csrf', 'csrf_token'].includes(name || ''))
          continue;
        const value = tag.match(
          /\b(?:content|value)\s*=\s*["']([^"']+)["']/i,
        )?.[1];
        if (value) return value;
      }
    }
    const cookies = response?.headers?.['set-cookie'];
    return (
      Array.isArray(cookies) ? cookies.join('; ') : String(cookies || '')
    ).match(
      /(?:^|;\s*)(?:x-ui-csrf|x_ui_csrf|csrf_token|csrfToken)=([^;]+)/i,
    )?.[1];
  }

  private async attachCsrfToken(
    api: AxiosInstance,
    initial?: AxiosResponse<unknown>,
  ): Promise<string | undefined> {
    this.acceptCookies(api, initial);
    const initialToken = this.csrfFromResponse(initial);
    if (initialToken) {
      api.defaults.headers.common['X-CSRF-Token'] = initialToken;
      return initialToken;
    }
    for (const path of ['/csrf-token', '/login', '/']) {
      try {
        const response = await api.get<unknown>(path);
        this.acceptCookies(api, response);
        const token = this.csrfFromResponse(response);
        if (token) {
          api.defaults.headers.common['X-CSRF-Token'] = token;
          return token;
        }
      } catch {
        /* Older panels may not expose this CSRF source. */
      }
    }
    return undefined;
  }

  private async authenticatePassword(
    api: AxiosInstance,
    username: string,
    password: string,
  ) {
    const token = await this.attachCsrfToken(api);
    const response = await api.post<unknown>('/login', {
      username,
      password,
      ...(token ? { _csrf: token, csrf_token: token } : {}),
    });
    this.acceptCookies(api, response);
    if (
      asRecord(response?.data)?.success !== true ||
      !response.headers?.['set-cookie']
    ) {
      throw new XuiApiError('Authentication was rejected', 'auth');
    }
    // A login can rotate both the session cookie and its CSRF token.
    delete api.defaults.headers.common['X-CSRF-Token'];
    await this.attachCsrfToken(api, response);
  }

  private async createAuthenticatedApi(node?: Node): Promise<AxiosInstance> {
    if (node) {
      const url = node.url || `${node.protocol}://${node.host}:${node.port}`;
      const api = this.createApi(url, node.allowInvalidTls === true);
      if (node.authType === NodeAuthType.Token) {
        if (!node.token) throw new XuiApiError('API token is missing', 'auth');
        api.defaults.headers.common.Authorization = `Bearer ${node.token}`;
      } else {
        if (!node.login || !node.password)
          throw new XuiApiError('Panel credentials are missing', 'auth');
        await this.authenticatePassword(api, node.login, node.password);
      }
      return api;
    }
    const config = Object.fromEntries(
      (await this.settingsRepo.find()).map((s) => [s.key, s.value]),
    );
    if (!config.xui_url || !config.xui_login || !config.xui_password) {
      throw new XuiApiError('Panel credentials are missing', 'auth');
    }
    const api = this.createApi(config.xui_url, true);
    await this.authenticatePassword(api, config.xui_login, config.xui_password);
    // Kept for legacy consumers; requests use the instance's own cookies.
    this.sessionService.setFromHeaders(
      ((api.defaults.headers.common.Cookie as string) || '').split('; '),
    );
    return api;
  }

  private async authenticatedRequest<T>(
    node: Node | undefined,
    work: (api: AxiosInstance) => Promise<T>,
    initialApi?: AxiosInstance,
  ): Promise<T> {
    let api = initialApi || (await this.createAuthenticatedApi(node));
    for (let attempt = 0; ; attempt++) {
      try {
        return await work(api);
      } catch (error) {
        const status = (error as AxiosError).response?.status;
        if (attempt >= 1 || node?.authType === NodeAuthType.Token) throw error;
        if (status === 401) api = await this.createAuthenticatedApi(node);
        else if (status === 403) {
          const token = await this.attachCsrfToken(api);
          if (!token) throw error;
        } else throw error;
      }
    }
  }

  async login(): Promise<boolean> {
    try {
      await this.createAuthenticatedApi();
      return true;
    } catch (error) {
      this.logger.warn(this.errorMessage(error));
      return false;
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof XuiApiError) return error.message;
    const err = error as AxiosError<{ msg?: string }>;
    if (err.response)
      return err.response.data?.msg
        ? safePanelMessage(err.response.data.msg)
        : `3x-ui returned HTTP ${err.response.status}`;
    return /timeout|aborted|cancel/i.test(err.message || '')
      ? 'Connection timed out'
      : 'Node is unreachable';
  }

  async addInbound(
    inboundConfig: XuiInboundRaw,
    node?: Node,
  ): Promise<XuiCreatedInbound | null> {
    const key = node?.id || 'main';
    this.lastInboundErrors.delete(key);
    let created: XuiCreatedInbound | undefined;
    try {
      const config = normalizeInbound(inboundConfig);
      const { obj, api: authenticatedApi } = await this.authenticatedRequest(
        node,
        async (api) => {
          const response = await api.post<unknown>(
            '/panel/api/inbounds/add',
            config,
          );
          return { obj: responsePayload(response.data), api };
        },
      );
      const rawId =
        obj && typeof obj === 'object' ? (obj as { id?: unknown }).id : obj;
      const id =
        typeof rawId === 'number' || typeof rawId === 'string'
          ? Number(rawId)
          : NaN;
      if (!Number.isInteger(id) || id <= 0)
        throw new XuiApiError(
          '3x-ui created an inbound without a valid ID; check the panel before retrying',
        );
      created = { id, inbound: { ...config, id } };
      const saved = await this.authenticatedRequest(
        node,
        async (api) => {
          const response = await api.get<unknown>(
            `/panel/api/inbounds/get/${id}`,
          );
          return normalizeInbound(responsePayload(response.data));
        },
        authenticatedApi,
      );
      if (
        saved.id !== id ||
        saved.protocol !== config.protocol ||
        saved.enable !== true
      ) {
        throw new XuiApiError(
          'Saved inbound identity, protocol or enabled state does not match',
        );
      }
      const clients = jsonObject(saved.settings, 'settings').clients;
      if (
        !Array.isArray(clients) ||
        !clients.length ||
        clients.some((c: unknown) => asRecord(c)?.enable === false)
      ) {
        throw new XuiApiError('Saved inbound has no enabled clients');
      }
      created.inbound = saved;
      return created;
    } catch (error) {
      const message = this.errorMessage(error);
      this.lastInboundErrors.set(key, message);
      this.logger.warn(
        `Inbound creation (${node?.name || 'main'}): ${message}`,
      );
      if (created) return { ...created, verificationError: message };
      return null;
    }
  }

  async getInbound(id: number, node?: Node): Promise<XuiInboundRaw> {
    return this.authenticatedRequest(node, async (api) => {
      const response = await api.get<unknown>(`/panel/api/inbounds/get/${id}`);
      return normalizeInbound(responsePayload(response.data));
    });
  }

  async deleteInbound(id: number, node?: Node): Promise<boolean> {
    if (!id || id <= 0) return true;
    try {
      return await this.authenticatedRequest(node, async (api) => {
        const response = await api.post<unknown>(
          `/panel/api/inbounds/del/${id}`,
        );
        const body = asRecord(response.data);
        if (
          body?.success === false &&
          typeof body.msg === 'string' &&
          /not found|does not exist|record not found/i.test(body.msg)
        )
          return true;
        responsePayload(response.data);
        return true;
      });
    } catch (error) {
      // A 404 can mean a wrong base path/API route, not an absent inbound.
      this.logger.warn(`Inbound deletion ${id}: ${this.errorMessage(error)}`);
      return false;
    }
  }

  async checkConnection(
    url: string,
    username: string,
    password: string,
  ): Promise<boolean> {
    try {
      const api = this.createApi(url, true);
      await this.authenticatePassword(api, username, password);
      const response = await api.get<unknown>('/panel/api/inbounds/list');
      if (!Array.isArray(responsePayload(response.data)))
        throw new XuiApiError('Invalid inbound list');
      return true;
    } catch {
      return false;
    }
  }

  private async optionalGet(
    api: AxiosInstance,
    path: string,
  ): Promise<AxiosResponse<unknown> | undefined> {
    try {
      const response = await api.get<unknown>(path);
      responsePayload(response.data);
      return response;
    } catch {
      return undefined;
    }
  }

  private parseCertificateFiles(data: unknown): XuiCertificateFiles | null {
    if (!data || typeof data !== 'object') return null;
    const { webCertFile, webKeyFile } = data as Record<string, unknown>;
    return typeof webCertFile === 'string' &&
      typeof webKeyFile === 'string' &&
      isSafeAbsoluteRemotePath(webCertFile) &&
      isSafeAbsoluteRemotePath(webKeyFile)
      ? { certificateFile: webCertFile, keyFile: webKeyFile }
      : null;
  }

  async checkNodeConnection(node: Node): Promise<XuiConnectionStatus> {
    const started = Date.now();
    try {
      const profile = await this.authenticatedRequest(node, async (api) => {
        const list = await api.get<unknown>('/panel/api/inbounds/list');
        if (!Array.isArray(responsePayload(list.data)))
          throw new XuiApiError('Invalid inbound list');
        const [status, update, certificate] = await Promise.all([
          this.optionalGet(api, '/panel/api/server/status'),
          this.optionalGet(api, '/panel/api/server/getPanelUpdateInfo'),
          this.optionalGet(api, '/panel/api/server/getWebCertFiles'),
        ]);
        const payload = asRecord(asRecord(status?.data)?.obj);
        const xray = asRecord(payload?.xray);
        const files = this.parseCertificateFiles(
          asRecord(certificate?.data)?.obj,
        );
        const version: unknown =
          payload?.panelVersion ||
          asRecord(asRecord(update?.data)?.obj)?.currentVersion ||
          list.headers?.['x-ui-version'] ||
          list.headers?.['x-3x-ui-version'];
        return {
          version: typeof version === 'string' ? version : undefined,
          xrayVersion:
            typeof xray?.version === 'string' ? xray.version : undefined,
          xrayState: typeof xray?.state === 'string' ? xray.state : undefined,
          xrayError: xray?.errorMsg
            ? safePanelMessage(xray.errorMsg)
            : undefined,
          webCertificateFile: files?.certificateFile,
          webKeyFile: files?.keyFile,
        };
      });
      return {
        success: true,
        ...profile,
        responseTimeMs: Date.now() - started,
      };
    } catch (error) {
      const status = (error as AxiosError).response?.status;
      return {
        success: false,
        responseTimeMs: Date.now() - started,
        errorType:
          error instanceof XuiApiError
            ? error.kind
            : status === 401 || status === 403
              ? 'auth'
              : status
                ? 'api'
                : 'network',
        message: this.errorMessage(error),
      };
    }
  }

  async waitForXray(node?: Node): Promise<void> {
    await this.authenticatedRequest(node, async (api) => {
      const deadline = Date.now() + 10_000;
      let message = 'Xray is not running';
      for (let attempt = 0; attempt < 6; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const response = await api.get<unknown>('/panel/api/server/status', {
          timeout: Math.min(8000, remaining),
          signal: AbortSignal.timeout(remaining),
        });
        const status = jsonObject(
          responsePayload(response.data),
          'server status',
        );
        const xray = jsonObject(status.xray, 'Xray status');
        if (xray.state === 'running' && !xray.errorMsg) return;
        message = xray.errorMsg
          ? safePanelMessage(xray.errorMsg)
          : `Xray state: ${typeof xray.state === 'string' ? xray.state : 'unknown'}`;
        if (attempt < 5)
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.min(2000, Math.max(0, deadline - Date.now())),
            ),
          );
      }
      throw new XuiApiError(message);
    });
  }

  async getWebCertificateFiles(
    node: Node,
  ): Promise<XuiCertificateFiles | null> {
    try {
      return await this.authenticatedRequest(node, async (api) => {
        const response = await api.get<unknown>(
          '/panel/api/server/getWebCertFiles',
        );
        return this.parseCertificateFiles(responsePayload(response.data));
      });
    } catch {
      return null;
    }
  }

  async getNewX25519Cert(node?: Node): Promise<XuiCertResult | null> {
    try {
      return await this.authenticatedRequest(node, async (api) => {
        const response = await api.get<unknown>(
          '/panel/api/server/getNewX25519Cert',
        );
        const pair = jsonObject(
          responsePayload(response.data),
          'Reality key pair',
        );
        if (
          typeof pair.privateKey !== 'string' ||
          typeof pair.publicKey !== 'string' ||
          !pair.privateKey ||
          !pair.publicKey
        )
          throw new XuiApiError('Invalid Reality key pair');
        return { privateKey: pair.privateKey, publicKey: pair.publicKey };
      });
    } catch (error) {
      this.logger.warn(this.errorMessage(error));
      return null;
    }
  }

  async getNodes(node: Node): Promise<XuiDiscoveredNode[]> {
    try {
      return await this.authenticatedRequest(node, async (api) => {
        const response = await api.get<unknown>('/panel/api/nodes/list');
        const rows = responsePayload(response.data);
        if (!Array.isArray(rows)) throw new XuiApiError('Invalid node list');
        return rows.flatMap((value: unknown): XuiDiscoveredNode[] => {
          const row = asRecord(value);
          if (!row) return [];
          const host = row.address || row.host;
          const protocol = row.scheme || row.protocol;
          const port = row.port;
          if (
            typeof host !== 'string' ||
            !host ||
            typeof port !== 'number' ||
            !Number.isInteger(port) ||
            port < 1 ||
            port > 65535 ||
            (protocol !== 'http' && protocol !== 'https')
          )
            return [];
          const version = row.panelVersion || row.version;
          return [
            {
              name: typeof row.name === 'string' ? row.name : undefined,
              host,
              port,
              protocol,
              version: typeof version === 'string' ? version : undefined,
              basePath: typeof row.basePath === 'string' ? row.basePath : '/',
            },
          ];
        });
      });
    } catch (error) {
      this.logger.warn(this.errorMessage(error));
      return [];
    }
  }
}
