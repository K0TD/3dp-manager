import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance, AxiosError } from 'axios';
import * as https from 'https';
import * as http from 'http';
import { Setting } from '../settings/entities/setting.entity';
import {
  XuiResponse,
  XuiCertResult,
  XuiInboundRaw,
  XuiDiscoveredNode,
} from './xui.types';
import { SessionService } from '../session/session.service';
import { Node, NodeAuthType } from '../nodes/entities/node.entity';

interface LoginResponse {
  success: boolean;
  msg?: string;
  obj?: unknown;
}

export type XuiConnectionError = 'auth' | 'network' | 'api';

export interface XuiConnectionStatus {
  success: boolean;
  version?: string;
  responseTimeMs?: number;
  errorType?: XuiConnectionError;
  message?: string;
}

@Injectable()
export class XuiService {
  private readonly logger = new Logger(XuiService.name);
  private api: AxiosInstance;

  constructor(
    @InjectRepository(Setting)
    private settingsRepo: Repository<Setting>,
    private sessionService: SessionService,
  ) {
    this.api = axios.create({
      timeout: 8000,
      proxy: false,
      withCredentials: true,
    });

    this.api.interceptors.request.use((config) => {
      const cookie = this.sessionService.getCookie();
      if (cookie) {
        config.headers['Cookie'] = cookie;
      }
      return config;
    });
  }

  private getNodeBaseUrl(node: Node): string {
    if (node.url) {
      return node.url.replace(/\/+$/, '');
    }

    return `${node.protocol}://${node.host}:${node.port}`.replace(/\/+$/, '');
  }

  private async getSettings() {
    const settings = await this.settingsRepo.find();
    const config: Record<string, string> = {};
    settings.forEach((s) => (config[s.key] = s.value));
    return config;
  }

  private createApi(baseURL?: string, allowInvalidTls = false): AxiosInstance {
    return axios.create({
      baseURL,
      timeout: 8000,
      proxy: false,
      ...this.getAgentConfig(baseURL, allowInvalidTls),
      withCredentials: true,
      maxRedirects: 0,
    });
  }

  private getAgentConfig(baseURL?: string, allowInvalidTls = false) {
    if (!baseURL || baseURL.startsWith('https://')) {
      return {
        httpsAgent: new https.Agent({ rejectUnauthorized: !allowInvalidTls }),
      };
    }

    return { httpAgent: new http.Agent() };
  }

  private async createAuthenticatedApi(node?: Node): Promise<AxiosInstance | null> {
    if (!node) {
      const success = await this.login();
      return success ? this.api : null;
    }

    const api = this.createApi(
      this.getNodeBaseUrl(node),
      node.allowInvalidTls === true,
    );

    if (node.authType === NodeAuthType.Token) {
      if (!node.token) return null;
      api.defaults.headers.common.Authorization = `Bearer ${node.token}`;
      return api;
    }

    if (!node.login || !node.password) return null;

    const res = await api.post<LoginResponse>('/login', {
      username: node.login,
      password: node.password,
    });

    if (!res.data?.success || !res.headers['set-cookie']) {
      return null;
    }

    api.defaults.headers.common.Cookie = res.headers['set-cookie'].join('; ');
    await this.attachCsrfToken(api);
    return api;
  }

  private async attachCsrfToken(api: AxiosInstance) {
    try {
      const response = await api.get('/csrf-token');
      const data = response.data as {
        csrfToken?: string;
        token?: string;
        obj?: string | { token?: string; csrfToken?: string };
      };
      const token =
        data.csrfToken ||
        data.token ||
        (typeof data.obj === 'string'
          ? data.obj
          : data.obj?.csrfToken || data.obj?.token);
      if (token) api.defaults.headers.common['X-CSRF-Token'] = token;
    } catch (error) {
      const status = (error as AxiosError).response?.status;
      if (status !== 404) {
        this.logger.debug(`CSRF token is unavailable: ${(error as Error).message}`);
      }
    }
  }

  private parseVersion(headers: Record<string, unknown>, data: unknown): string | undefined {
    const headerVersion = headers['x-ui-version'] || headers['x-3x-ui-version'];
    if (typeof headerVersion === 'string') return headerVersion;

    if (data && typeof data === 'object' && 'version' in data) {
      const version = (data as { version?: unknown }).version;
      return typeof version === 'string' ? version : undefined;
    }

    return undefined;
  }

  async login() {
    try {
      const config = await this.getSettings();
      if (
        !config['xui_url'] ||
        !config['xui_login'] ||
        !config['xui_password']
      ) {
        this.logger.warn('Настройки 3x-ui не заполнены в БД');
        return false;
      }

      this.logger.log(`Attempting login to 3x-ui: ${config['xui_url']}`);
      this.api.defaults.baseURL = config['xui_url'];
      const agentConfig = this.getAgentConfig(config['xui_url'], true);
      this.api.defaults.httpAgent = agentConfig.httpAgent;
      this.api.defaults.httpsAgent = agentConfig.httpsAgent;

      const res = await this.api.post<LoginResponse>('/login', {
        username: config['xui_login'],
        password: config['xui_password'],
      });

      if (res.headers['set-cookie']) {
        this.sessionService.setFromHeaders(res.headers['set-cookie']);
        await this.attachCsrfToken(this.api);
        this.logger.log('3x-ui login successful');
        return true;
      } else {
        this.logger.warn('3x-ui login failed: No cookie received');
      }
    } catch (e) {
      const error = e as AxiosError;
      this.logger.error(`3x-ui login error: ${error.message}`);
    }
    return false;
  }

  async addInbound(
    inboundConfig: { port: number; [key: string]: unknown } | XuiInboundRaw,
    node?: Node,
  ): Promise<number | null> {
    let attempts = 0;
    const maxAttempts = 3;

    this.logger.log(`Adding inbound on port ${inboundConfig.port}`);

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const api = await this.createAuthenticatedApi(node);
        if (!api) {
          this.logger.error('3x-ui authentication failed before addInbound');
          return null;
        }

        const res = await api.post<XuiResponse<{ id: number }>>(
          '/panel/api/inbounds/add',
          inboundConfig,
        );

        if (res.data?.success) {
          this.logger.log(
            `Inbound created successfully with ID: ${res.data.obj.id}`,
          );
          const obj = res.data.obj;
          const id =
            typeof obj === 'number'
              ? obj
              : obj && typeof obj === 'object' && 'id' in obj
                ? Number(obj.id)
                : NaN;
          if (Number.isInteger(id) && id > 0) return id;
          this.logger.error('3x-ui created an inbound but did not return its id');
          return null;
        } else {
          const msg = res.data?.msg || '';

          if (
            msg.toLowerCase().includes('port') &&
            msg.toLowerCase().includes('exists')
          ) {
            this.logger.warn(
              `Попытка ${attempts}/${maxAttempts}: Порт ${inboundConfig.port} занят. Генерируем новый...`,
            );

            inboundConfig.port = Math.floor(
              Math.random() * (60000 - 10000 + 1) + 10000,
            );
          } else {
            this.logger.error(`3x-ui отклонил создание: ${msg}`);
            return null;
          }
        }
      } catch (e) {
        const error = e as AxiosError;
        if (error.response?.status === 401) {
          this.logger.log('Сессия истекла, пробуем релогин...');
          if (!node && (await this.login())) {
            return this.addInbound(inboundConfig);
          }
        }

        this.logger.error(
          `Ошибка сети/валидации при добавлении инбаунда: ${error.message}`,
        );
        return null;
      }
    }

    this.logger.error(
      `Не удалось создать инбаунд после ${maxAttempts} попыток смены порта.`,
    );
    return null;
  }

  async deleteInbound(id: number, node?: Node): Promise<boolean> {
    if (!id || id <= 0) {
      this.logger.debug(`Skipping 3x-ui inbound deletion for non-remote id: ${id}`);
      return true;
    }

    try {
      const api = await this.createAuthenticatedApi(node);
      if (!api) {
        this.logger.error(`3x-ui authentication failed before deleting inbound ${id}`);
        return false;
      }
      const res = await api.post<XuiResponse<unknown>>(
        `/panel/api/inbounds/del/${id}`,
      );
      if (!res.data?.success) {
        const message = (res.data?.msg || '').toLowerCase();
        if (message.includes('not found') || message.includes('does not exist')) {
          return true;
        }
        this.logger.error(
          `3x-ui rejected inbound deletion ${id}: ${res.data?.msg || 'unknown error'}`,
        );
        return false;
      }
      this.logger.debug(`Inbound ${id} deleted`);
      return true;
    } catch (e) {
      const error = e as AxiosError;
      if (error.response?.status === 404) return true;
      this.logger.error(`Ошибка удаления инбаунда ${id}: ${error.message}`);
    }

    return false;
  }

  async checkConnection(
    url: string,
    username: string,
    pass: string,
  ): Promise<boolean> {
    try {
      this.logger.log(`Checking connection to 3x-ui: ${url}`);

      const tempApi = this.createApi(url, true);

      const res = await tempApi.post<LoginResponse>('/login', {
        username: username,
        password: pass,
      });

      if (res.headers['set-cookie'] && res.data?.success) {
        this.logger.log(`Connection to 3x-ui successful: ${url}`);
        return true;
      } else {
        this.logger.warn(
          `Connection failed: Invalid credentials or no cookie received`,
        );
      }
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Connection error: ${axiosError.message} (URL: ${url})`,
      );
    }
    return false;
  }

  async checkNodeConnection(
    node: Node,
  ): Promise<XuiConnectionStatus> {
    const startedAt = Date.now();
    try {
      const api = await this.createAuthenticatedApi(node);
      if (!api) {
        return {
          success: false,
          responseTimeMs: Date.now() - startedAt,
          errorType: 'auth',
          message: 'Authentication failed',
        };
      }

      const res = await api.get('/panel/api/inbounds/list');
      return {
        success: true,
        version: this.parseVersion(res.headers as Record<string, unknown>, res.data),
        responseTimeMs: Date.now() - startedAt,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Node connection error: ${axiosError.message} (${node.name})`,
      );
      const status = axiosError.response?.status;
      return {
        success: false,
        responseTimeMs: Date.now() - startedAt,
        errorType: status === 401 || status === 403 ? 'auth' : status ? 'api' : 'network',
        message: this.safeErrorMessage(axiosError),
      };
    }
  }

  private safeErrorMessage(error: AxiosError) {
    if (error.code === 'ECONNABORTED') return 'Connection timed out';
    if (!error.response) return 'Node is unreachable';
    if (error.response.status === 401 || error.response.status === 403) {
      return 'Authentication was rejected';
    }
    return `3x-ui returned HTTP ${error.response.status}`;
  }

  async getNewX25519Cert(node?: Node): Promise<XuiCertResult | null> {
    try {
      const api = await this.createAuthenticatedApi(node);
      if (!api) return null;
      const res = await api.get<XuiResponse<XuiCertResult>>(
        '/panel/api/server/getNewX25519Cert',
      );
      if (res.data?.success && res.data.obj) return res.data.obj;
    } catch {
      this.logger.error('Ошибка получения ключей Reality');
    }
    return null;
  }

  async getNodes(node: Node): Promise<XuiDiscoveredNode[]> {
    try {
      const api = await this.createAuthenticatedApi(node);
      if (!api) return [];

      const res = await api.get<XuiResponse<XuiDiscoveredNode[]>>(
        '/panel/api/nodes/list',
      );

      if (res.data?.success && Array.isArray(res.data.obj)) {
        return res.data.obj;
      }
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.warn(`Node sync is not available: ${axiosError.message}`);
    }

    return [];
  }
}
