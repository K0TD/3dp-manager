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
      if (!config.signal) {
        config.signal = AbortSignal.timeout(config.timeout || 8000);
      }
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
    const api = axios.create({
      baseURL,
      timeout: 8000,
      proxy: false,
      ...this.getAgentConfig(baseURL, allowInvalidTls),
      withCredentials: true,
      maxRedirects: 0,
    });

    api.interceptors.request.use((config) => {
      if (!config.signal) {
        config.signal = AbortSignal.timeout(config.timeout || 8000);
      }
      return config;
    });

    return api;
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

    const baseUrl = this.getNodeBaseUrl(node);
    const api = this.createApi(
      baseUrl,
      node.allowInvalidTls === true,
    );

    if (node.authType === NodeAuthType.Token) {
      if (!node.token) {
        this.logger.error(
          `[XuiService] Нода «${node.name}» (${node.id}) настроена на Token-аутентификацию, но токен пуст!`,
        );
        return null;
      }
      api.defaults.headers.common.Authorization = `Bearer ${node.token}`;
      return api;
    }

    if (!node.login || !node.password) {
      this.logger.error(
        `[XuiService] У ноды «${node.name}» (${node.id}) не заданы учетные данные: login=${node.login ? 'задан' : 'пуст'}, password=${node.password ? 'задан' : 'пуст'}`,
      );
      return null;
    }

    try {
      this.logger.debug(
        `[XuiService] Выполняется вход на ноду «${node.name}» (${baseUrl}/login) под пользователем «${node.login}»...`,
      );
      const res = await api.post<LoginResponse>('/login', {
        username: node.login,
        password: node.password,
      });

      if (!res.data?.success || !res.headers['set-cookie']) {
        this.logger.error(
          `[XuiService] Вход на ноду «${node.name}» отклонен 3x-ui: success=${res.data?.success}, msg=${res.data?.msg || 'нет сообщения'}, cookies=${Boolean(res.headers['set-cookie'])}`,
        );
        return null;
      }

      api.defaults.headers.common.Cookie = res.headers['set-cookie'].join('; ');
      await this.attachCsrfToken(api, res.headers as Record<string, unknown>);
      this.logger.debug(
        `[XuiService] Успешная аутентификация на ноде «${node.name}»`,
      );
      return api;
    } catch (e) {
      const err = e as AxiosError;
      const status = err.response?.status;
      const dataStr = err.response?.data ? JSON.stringify(err.response.data) : '';
      this.logger.error(
        `[XuiService] Ошибка подключения/авторизации к ноде «${node.name}» (${baseUrl}): ${err.message} ${status ? `(HTTP ${status}: ${dataStr})` : ''}`,
      );
      return null;
    }
  }

  private async attachCsrfToken(
    api: AxiosInstance,
    initialHeaders?: Record<string, unknown>,
  ) {
    // 1. Проверяем наличие токена в ответе логина (в заголовках или cookie x-ui-csrf)
    if (initialHeaders) {
      const headerToken = initialHeaders['x-csrf-token'] as string | undefined;
      if (headerToken) {
        api.defaults.headers.common['X-CSRF-Token'] = headerToken;
        this.logger.debug(`Найден CSRF токен в заголовке ответа логина`);
        return;
      }
      const setCookie = initialHeaders['set-cookie'];
      if (Array.isArray(setCookie) || typeof setCookie === 'string') {
        const cookiesStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
        const match = cookiesStr.match(/(?:x-ui-csrf|x_ui_csrf|csrf_token|csrfToken)=([^;]+)/i);
        if (match && match[1]) {
          api.defaults.headers.common['X-CSRF-Token'] = match[1];
          this.logger.debug(`Извлечен CSRF токен из Set-Cookie: ${match[1].slice(0, 8)}...`);
          return;
        }
      }
    }

    // 2. Пробуем запросить GET /csrf-token (поддерживается в некоторых версиях панели)
    try {
      const response = await api.get('/csrf-token');
      const headerToken = response.headers?.['x-csrf-token'] as string | undefined;
      if (headerToken) {
        api.defaults.headers.common['X-CSRF-Token'] = headerToken;
        return;
      }
      const data = response.data as {
        csrfToken?: string;
        token?: string;
        obj?: string | { token?: string; csrfToken?: string };
      };
      const token =
        data?.csrfToken ||
        data?.token ||
        (typeof data?.obj === 'string'
          ? data.obj
          : data?.obj?.csrfToken || data?.obj?.token);
      if (token) {
        api.defaults.headers.common['X-CSRF-Token'] = token;
        return;
      }
    } catch {
      // 404 нормален для версий без JSON-эндпоинта /csrf-token
    }

    // 3. Резервный поиск: извлечение из <meta name="csrf-token" content="..."> на корневой HTML странице
    try {
      const htmlRes = await api.get('/');
      const headerToken = htmlRes.headers?.['x-csrf-token'] as string | undefined;
      if (headerToken) {
        api.defaults.headers.common['X-CSRF-Token'] = headerToken;
        return;
      }
      if (typeof htmlRes.data === 'string') {
        const metaMatch = htmlRes.data.match(
          /<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i,
        );
        if (metaMatch && metaMatch[1]) {
          api.defaults.headers.common['X-CSRF-Token'] = metaMatch[1];
          this.logger.debug(`Извлечен CSRF токен из HTML meta: ${metaMatch[1].slice(0, 8)}...`);
          return;
        }
      }
    } catch {
      // Игнорируем ошибки фонового поиска
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
        await this.attachCsrfToken(this.api, res.headers as Record<string, unknown>);
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

    const nodeName = node?.name || 'main';
    this.logger.log(
      `[XuiService] Создание инбаунда на ноде «${nodeName}» (протокол: ${inboundConfig.protocol}, порт: ${inboundConfig.port}, remark: «${inboundConfig.remark || ''}»)`,
    );

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const api = await this.createAuthenticatedApi(node);
        if (!api) {
          this.logger.error(
            `[XuiService] Ошибка аутентификации перед добавлением инбаунда на ноде «${nodeName}»`,
          );
          return null;
        }

        const res = await api.post<XuiResponse<{ id: number }>>(
          '/panel/api/inbounds/add',
          inboundConfig,
        );

        if (res.data?.success) {
          const obj = res.data.obj;
          const id =
            typeof obj === 'number'
              ? obj
              : obj && typeof obj === 'object' && 'id' in obj
                ? Number(obj.id)
                : typeof obj === 'string' && /^\d+$/.test(obj)
                  ? Number(obj)
                  : NaN;
          if (Number.isInteger(id) && id > 0) {
            this.logger.log(
              `[XuiService] Инбаунд успешно создан на ноде «${nodeName}» с ID: ${id} (порт: ${inboundConfig.port})`,
            );
            return id;
          }
          this.logger.error(
            `[XuiService] 3x-ui на ноде «${nodeName}» создал инбаунд, но вернул неожиданный формат ID: ${JSON.stringify(obj)}`,
          );
          return null;
        } else {
          const msg = res.data?.msg || '';

          if (
            msg.toLowerCase().includes('port') &&
            msg.toLowerCase().includes('exists')
          ) {
            const oldPort = inboundConfig.port;
            inboundConfig.port = Math.floor(
              Math.random() * (60000 - 10000 + 1) + 10000,
            );
            this.logger.warn(
              `[XuiService] Попытка ${attempts}/${maxAttempts}: Порт ${oldPort} занят. Сгенерирован новый порт ${inboundConfig.port}. Повтор...`,
            );
          } else {
            this.logger.error(
              `[XuiService] 3x-ui на ноде «${nodeName}» отклонил создание инбаунда: ${msg || 'нет текста ошибки'}`,
            );
            return null;
          }
        }
      } catch (e) {
        const error = e as AxiosError;
        const status = error.response?.status;
        const dataStr = error.response?.data
          ? JSON.stringify(error.response.data)
          : '';
        this.logger.error(
          `[XuiService] Ошибка при добавлении инбаунда на ноде «${nodeName}»: ${error.message} ${status ? `(HTTP ${status}: ${dataStr})` : ''}`,
        );

        if (status === 401 && attempts < maxAttempts) {
          this.logger.log(
            `[XuiService] Сессия истекла (401) на ноде «${nodeName}», попытка повторной авторизации...`,
          );
          if (!node) {
            await this.login();
          }
          continue;
        }

        return null;
      }
    }

    this.logger.error(
      `[XuiService] Не удалось создать инбаунд на ноде «${nodeName}» после ${maxAttempts} попыток смены порта.`,
    );
    return null;
  }

  async deleteInbound(id: number, node?: Node): Promise<boolean> {
    if (!id || id <= 0) {
      this.logger.debug(
        `Skipping 3x-ui inbound deletion for non-remote id: ${id}`,
      );
      return true;
    }

    const nodeName = node?.name || 'main';
    this.logger.log(
      `[XuiService] Удаление инбаунда ${id} на ноде «${nodeName}»...`,
    );
    try {
      const api = await this.createAuthenticatedApi(node);
      if (!api) {
        this.logger.error(
          `[XuiService] 3x-ui ошибка аутентификации перед удалением инбаунда ${id} на ноде «${nodeName}»`,
        );
        return false;
      }
      const res = await api.post<XuiResponse<unknown>>(
        `/panel/api/inbounds/del/${id}`,
      );
      if (!res.data?.success) {
        const message = (res.data?.msg || '').toLowerCase();
        if (
          message.includes('not found') ||
          message.includes('does not exist')
        ) {
          this.logger.log(
            `[XuiService] Инбаунд ${id} уже отсутствует на панели 3x-ui ноды «${nodeName}»`,
          );
          return true;
        }
        this.logger.error(
          `[XuiService] 3x-ui отклонил удаление инбаунда ${id} на ноде «${nodeName}»: ${res.data?.msg || 'неизвестная ошибка'}`,
        );
        return false;
      }
      this.logger.log(
        `[XuiService] Инбаунд ${id} успешно удален на ноде «${nodeName}»`,
      );
      return true;
    } catch (e) {
      const error = e as AxiosError;
      if (error.response?.status === 404) {
        this.logger.log(
          `[XuiService] Инбаунд ${id} вернул 404 (уже удален) на ноде «${nodeName}»`,
        );
        return true;
      }
      this.logger.error(
        `[XuiService] Ошибка удаления инбаунда ${id} на ноде «${nodeName}»: ${error.message} ${error.response ? `(HTTP ${error.response.status})` : ''}`,
      );
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
    if (
      error.code === 'ECONNABORTED' ||
      error.name === 'CanceledError' ||
      error.name === 'AbortError' ||
      error.message?.toLowerCase().includes('timeout') ||
      error.message?.toLowerCase().includes('aborted')
    ) {
      return 'Connection timed out';
    }
    if (!error.response) return 'Node is unreachable';
    if (error.response.status === 401 || error.response.status === 403) {
      return 'Authentication was rejected';
    }
    return `3x-ui returned HTTP ${error.response.status}`;
  }

  async getNewX25519Cert(node?: Node): Promise<XuiCertResult | null> {
    const nodeName = node?.name || 'main';
    try {
      this.logger.log(
        `[XuiService] Запрос сертификата Reality (X25519) у ноды «${nodeName}» (/panel/api/server/getNewX25519Cert)...`,
      );
      const api = await this.createAuthenticatedApi(node);
      if (!api) {
        this.logger.error(
          `[XuiService] Не удалось пройти аутентификацию для получения Reality-ключей на ноде «${nodeName}»`,
        );
        return null;
      }
      const res = await api.get<XuiResponse<XuiCertResult>>(
        '/panel/api/server/getNewX25519Cert',
      );
      if (res.data?.success && res.data.obj) {
        this.logger.log(
          `[XuiService] Reality-ключи успешно получены от ноды «${nodeName}»`,
        );
        return res.data.obj;
      }
      this.logger.error(
        `[XuiService] 3x-ui на ноде «${nodeName}» вернул ошибку при получении ключей Reality: ${res.data?.msg || 'пустой ответ'}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const axiosErr = error as AxiosError;
      const status = axiosErr.response?.status;
      const dataStr = axiosErr.response?.data
        ? JSON.stringify(axiosErr.response.data)
        : '';
      this.logger.error(
        `[XuiService] Ошибка получения ключей Reality (${nodeName}): ${msg} ${status ? `(HTTP ${status}: ${dataStr})` : ''}`,
      );
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
