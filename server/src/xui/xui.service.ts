import {
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, {
  AxiosInstance,
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import * as dns from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { randomBytes, randomUUID } from 'crypto';
import { Setting } from '../settings/entities/setting.entity';
import {
  XuiCertResult,
  XuiInboundClient,
  XuiInboundRaw,
  XuiDiscoveredNode,
} from './xui.types';
import { SessionService } from '../session/session.service';
import { Node, NodeAuthType } from '../nodes/entities/node.entity';
import { isSafeAbsoluteRemotePath } from '../inbounds/tls-config';
import { formatClientEmail } from '../inbounds/client-email';
import { RoutingStore } from '../nodes/routing/routing-store.service';
import {
  emptyRoutingState,
  equal,
  hasPresets,
  prepareSniffing,
  sniffingObject,
  supportsSniffing,
} from '../nodes/routing/routing-presets';
import type {
  RoutingSelection,
  XrayTemplate,
} from '../nodes/routing/routing-presets';
import {
  XuiApiError,
  XuiRuntimeError,
  inboundDiagnostic,
  asRecord,
  jsonObject,
  mergeCookies,
  normalizeInbound,
  responsePayload,
  safePanelMessage,
  verifyInboundAccess,
  verifyTlsIdentity,
} from './xui-contract';

// Panel hosts often rate-limit new TCP connections (connlimit/hashlimit), so a
// burst of fresh connections is refused. Requests to one panel share a single
// keep-alive socket, and a refused connect is retried after a short pause.
const PANEL_SOCKET_IDLE_MS = 30_000;
const REFUSED_RETRY_DELAYS_MS = [1_200, 2_500];

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  refusedRetries?: number;
};

export type XuiConnectionError = 'auth' | 'network' | 'api';
export interface XuiConnectionDiagnostics {
  targetHost?: string;
  targetPort?: number;
  resolvedIps?: string[];
  configuredIp?: string;
  usedDirectIp?: boolean;
  errorCode?: string;
  hint?: string;
}
export interface XuiConnectionStatus {
  success: boolean;
  version?: string;
  xrayVersion?: string;
  xrayState?: string;
  xrayError?: string;
  cpuPercent?: number;
  memPercent?: number;
  diskPercent?: number;
  webCertificateFile?: string;
  webKeyFile?: string;
  responseTimeMs?: number;
  errorType?: XuiConnectionError;
  message?: string;
  diagnostics?: XuiConnectionDiagnostics;
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

export function hasSeparateClientApi(node?: Pick<Node, 'version'>): boolean {
  const raw = node?.version?.trim();
  if (!raw) return false;
  if (/^dev\+/i.test(raw)) return true;
  const version = raw.match(/(?:^|\s)v?(\d+)\.\d+/i);
  return Boolean(version && Number(version[1]) >= 3);
}

@Injectable()
export class XuiService {
  private readonly logger = new Logger(XuiService.name);
  private readonly lastInboundErrors = new Map<string, string>();
  private readonly panelAgents = new Map<string, http.Agent>();
  private readonly mutations = new Map<string, Promise<unknown>>();
  private readonly lastMutation = new Map<string, number>();

  constructor(
    @InjectRepository(Setting) private settingsRepo: Repository<Setting>,
    private sessionService: SessionService,
    @Optional() private readonly routingStore?: RoutingStore,
  ) {}

  getLastInboundError(node?: Node): string | undefined {
    return this.lastInboundErrors.get(node?.id || 'main');
  }

  private normalizeBaseUrl(baseURL: string): string {
    return baseURL
      .trim()
      .replace(/\/(?:panel|xui)(?:\/.*)?$/i, '')
      .replace(/\/+$/, '');
  }

  /**
   * Сбрасывает и закрывает кэшированный keep-alive HTTP/HTTPS-агент для указанной ноды
   * (или для всех нод, если URL не передан).
   */
  invalidatePanelAgent(url?: string): void {
    if (!url) {
      for (const agent of this.panelAgents.values()) {
        agent.destroy();
      }
      this.panelAgents.clear();
      return;
    }

    const clean = this.normalizeBaseUrl(url);
    let origin: string;
    try {
      origin = new URL(clean).origin;
    } catch {
      origin = clean;
    }

    for (const [key, agent] of Array.from(this.panelAgents.entries())) {
      if (
        key.startsWith(`http|${origin}|`) ||
        key.startsWith(`https|${origin}|`)
      ) {
        agent.destroy();
        this.panelAgents.delete(key);
      }
    }
  }

  private createApi(
    baseURL: string,
    allowInvalidTls = false,
    options?: { freshAgent?: boolean; directIp?: string },
  ): AxiosInstance {
    const cleanBaseURL = this.normalizeBaseUrl(baseURL);
    let hostname: string | undefined;
    try {
      hostname = new URL(cleanBaseURL).hostname.replace(/^\[|\]$/g, '');
    } catch {
      hostname = undefined;
    }
    const useFresh = Boolean(options?.freshAgent || options?.directIp);

    const api = axios.create({
      baseURL: cleanBaseURL,
      timeout: 8000,
      proxy: false,
      withCredentials: true,
      maxRedirects: 0,
      httpAgent: useFresh
        ? this.createFreshAgent(false, allowInvalidTls, options?.directIp, hostname)
        : this.panelAgent(cleanBaseURL, false, allowInvalidTls),
      httpsAgent: useFresh
        ? this.createFreshAgent(true, allowInvalidTls, options?.directIp, hostname)
        : this.panelAgent(cleanBaseURL, true, allowInvalidTls),
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
      async (error: AxiosError) => {
        if (error.response) this.acceptCookies(api, error.response);
        // A refused connect never reached the panel, so any method is safe to retry.
        const config = error.config as RetriableRequestConfig | undefined;
        const attempt = config?.refusedRetries ?? 0;
        if (
          config &&
          error.code === 'ECONNREFUSED' &&
          attempt < REFUSED_RETRY_DELAYS_MS.length &&
          !config.signal?.aborted
        ) {
          config.refusedRetries = attempt + 1;
          await new Promise((resolve) =>
            setTimeout(resolve, REFUSED_RETRY_DELAYS_MS[attempt]),
          );
          return api.request(config);
        }
        if (!error.response && !useFresh) {
          this.invalidatePanelAgent(cleanBaseURL);
        }
        return Promise.reject(error);
      },
    );
    return api;
  }

  private createFreshAgent(
    secure: boolean,
    allowInvalidTls: boolean,
    directIp?: string,
    servername?: string,
  ): http.Agent {
    const cleanIp = directIp?.trim().replace(/^\[|\]$/g, '');
    const family = cleanIp ? net.isIP(cleanIp) : 0;
    const lookup: http.AgentOptions['lookup'] =
      family === 4 || family === 6
        ? ((
            _hostname: string,
            options: { all?: boolean } | number | undefined,
            callback: (
              err: NodeJS.ErrnoException | null,
              address: string | Array<{ address: string; family: number }>,
              family?: number,
            ) => void,
          ) => {
            process.nextTick(() => {
              if (
                options &&
                typeof options === 'object' &&
                options.all === true
              ) {
                callback(null, [{ address: cleanIp!, family }]);
              } else {
                callback(null, cleanIp!, family);
              }
            });
          }) as http.AgentOptions['lookup']
        : undefined;

    const baseOptions: http.AgentOptions = {
      keepAlive: false,
      timeout: 8000,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 500,
      ...(lookup ? { lookup } : {}),
    };

    if (!secure) {
      return new http.Agent(baseOptions);
    }

    const cleanSni = servername?.trim().replace(/^\[|\]$/g, '');
    const useSni = Boolean(
      lookup &&
        cleanSni &&
        cleanSni !== 'localhost' &&
        net.isIP(cleanSni) === 0,
    );
    const httpsOptions: https.AgentOptions = {
      ...baseOptions,
      rejectUnauthorized: !allowInvalidTls,
      ...(useSni ? { servername: cleanSni } : {}),
    };
    return new https.Agent(httpsOptions);
  }

  private panelAgent(
    baseURL: string,
    secure: boolean,
    allowInvalidTls: boolean,
  ): http.Agent {
    let origin: string;
    try {
      origin = new URL(baseURL).origin;
    } catch {
      origin = baseURL;
    }
    const key = `${secure ? 'https' : 'http'}|${origin}|${allowInvalidTls}`;
    let agent = this.panelAgents.get(key);
    if (!agent) {
      const options: http.AgentOptions = {
        keepAlive: true,
        maxSockets: 1,
        timeout: PANEL_SOCKET_IDLE_MS,
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: 500,
      };
      agent = secure
        ? new https.Agent({ ...options, rejectUnauthorized: !allowInvalidTls })
        : new http.Agent(options);
      this.panelAgents.set(key, agent);
    }
    return agent;
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
      } catch (error) {
        if (!(error as AxiosError)?.response) {
          throw error;
        }
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

  private async createAuthenticatedApi(
    node?: Node,
    options?: { freshAgent?: boolean; directIp?: string },
  ): Promise<AxiosInstance> {
    if (node) {
      const url = node.url || `${node.protocol}://${node.host}:${node.port}`;
      const api = this.createApi(url, node.allowInvalidTls === true, options);
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
    const api = this.createApi(config.xui_url, true, options);
    await this.authenticatePassword(api, config.xui_login, config.xui_password);
    // Kept for legacy consumers; requests use the instance's own cookies.
    this.sessionService.setFromHeaders(
      ((api.defaults.headers.common.Cookie as string) || '').split('; '),
    );
    return api;
  }

  private async runAuthenticatedOnce<T>(
    node: Node | undefined,
    work: (api: AxiosInstance) => Promise<T>,
    initialApi?: AxiosInstance,
    options?: { freshAgent?: boolean; directIp?: string },
  ): Promise<T> {
    let api = initialApi || (await this.createAuthenticatedApi(node, options));
    for (let attempt = 0; ; attempt++) {
      try {
        return await work(api);
      } catch (error) {
        const status = (error as AxiosError).response?.status;
        if (attempt >= 1 || node?.authType === NodeAuthType.Token) throw error;
        if (status === 401) {
          api = await this.createAuthenticatedApi(node, options);
        } else if (status === 403) {
          const token = await this.attachCsrfToken(api);
          if (!token) throw error;
        } else throw error;
      }
    }
  }

  private async authenticatedRequest<T>(
    node: Node | undefined,
    work: (api: AxiosInstance) => Promise<T>,
    initialApi?: AxiosInstance,
    options?: { freshAgent?: boolean; directIp?: string },
  ): Promise<T> {
    try {
      return await this.runAuthenticatedOnce(node, work, initialApi, options);
    } catch (error) {
      const err = error as AxiosError;
      const configuredIp = node?.ip?.trim().replace(/^\[|\]$/g, '');
      if (
        initialApi ||
        options?.directIp ||
        err?.response ||
        error instanceof XuiApiError ||
        !configuredIp ||
        net.isIP(configuredIp) === 0
      ) {
        throw error;
      }

      const target = this.parseTargetEndpoint(node);
      const isDomainHost = Boolean(
        target.targetHost &&
          target.targetHost !== 'localhost' &&
          net.isIP(target.targetHost) === 0,
      );
      if (!isDomainHost) throw error;

      const resolvedIps = await this.resolveHostIps(target.targetHost);
      if (resolvedIps.includes(configuredIp)) throw error;

      return this.runAuthenticatedOnce(node, work, undefined, {
        ...options,
        freshAgent: true,
        directIp: configuredIp,
      });
    }
  }

  private parseTargetEndpoint(node?: Pick<Node, 'url' | 'host' | 'port' | 'protocol'>): {
    targetHost?: string;
    targetPort?: number;
  } {
    const rawUrl =
      node?.url ||
      (node?.host
        ? `${node.protocol || 'https'}://${node.host}${node.port ? `:${node.port}` : ''}`
        : undefined);
    if (!rawUrl) {
      return {};
    }
    try {
      const normalized = rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`;
      const parsed = new URL(normalized);
      const targetHost = parsed.hostname.replace(/^\[|\]$/g, '') || undefined;
      const targetPort = parsed.port
        ? Number(parsed.port)
        : parsed.protocol === 'http:'
          ? 80
          : 443;
      return {
        targetHost,
        targetPort: Number.isFinite(targetPort) ? targetPort : undefined,
      };
    } catch {
      return {
        targetHost: node?.host?.replace(/^\[|\]$/g, '') || undefined,
        targetPort: node?.port,
      };
    }
  }

  private async resolveHostIps(hostname?: string): Promise<string[]> {
    const clean = hostname?.trim().replace(/^\[|\]$/g, '');
    if (!clean || clean === 'localhost') return [];
    if (net.isIP(clean) !== 0) return [clean];
    try {
      const records = await dns.lookup(clean, { all: true });
      return Array.from(new Set(records.map((entry) => entry.address).filter(Boolean)));
    } catch {
      return [];
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

  private extractNetworkOrTlsCode(error: unknown): {
    code?: string;
    isTls: boolean;
    isTimeout: boolean;
  } {
    const err = error as AxiosError<{ msg?: string }>;
    const rawCode = typeof err.code === 'string' ? err.code : '';
    const msg = typeof err.message === 'string' ? err.message : '';
    const knownPattern =
      /\b(ERR_TLS_CERT_ALTNAME_INVALID|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|ERR_SSL_WRONG_VERSION_NUMBER|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNABORTED|EHOSTUNREACH|ENETUNREACH|EPROTO)\b/;
    const code = knownPattern.test(rawCode)
      ? rawCode
      : msg.match(knownPattern)?.[1];
    const isTls =
      /^(ERR_TLS_CERT_ALTNAME_INVALID|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|ERR_SSL_WRONG_VERSION_NUMBER|EPROTO)$/.test(
        code || '',
      ) || /certificate|self[- ]signed|altnames|wrong version number|ssl/i.test(msg);
    const isTimeout =
      /timeout|aborted|cancel/i.test(msg) ||
      /ETIMEDOUT|ECONNABORTED/.test(code || '');
    return { code, isTls, isTimeout };
  }

  private extractErrorDiagnostics(
    error: unknown,
    target: { targetHost?: string; targetPort?: number },
    resolvedIps: string[],
    configuredIp?: string,
    usedDirectIp?: boolean,
  ): XuiConnectionDiagnostics {
    const err = error as AxiosError<{ msg?: string }>;
    const status = err.response?.status;
    const { code, isTls, isTimeout } = this.extractNetworkOrTlsCode(error);
    const targetAddr =
      (usedDirectIp ? configuredIp : resolvedIps[0]) ||
      configuredIp ||
      target.targetHost;
    const mismatchNote =
      configuredIp && resolvedIps.length > 0 && !resolvedIps.includes(configuredIp)
        ? ` (DNS возвращает ${resolvedIps.join(', ')}, а в настройках ноды указан IP ${configuredIp})`
        : '';

    let hint: string | undefined;
    if (isTls) {
      hint =
        'Включите «Разрешить недоверенный TLS-сертификат» или проверьте домен и сертификат панели.';
    } else if (
      (error instanceof XuiApiError && error.kind === 'auth') ||
      status === 401 ||
      status === 403
    ) {
      hint = 'Проверьте API-токен или логин/пароль панели.';
    } else if (status === 404) {
      hint = 'Проверьте путь панели (basePath) в URL.';
    } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      hint =
        'Домен не резолвится в DNS. Проверьте DNS-запись или переключите URL на прямой IP панели.';
    } else if (code === 'ECONNREFUSED') {
      hint = `Порт ${target.targetPort || 'панели'} закрыт или панель 3x-ui не отвечает по адресу ${targetAddr || 'ноды'}${mismatchNote}.`;
    } else if (isTimeout) {
      hint = `Таймаут подключения к ${targetAddr || 'ноде'}${target.targetPort ? `:${target.targetPort}` : ''}${mismatchNote}. Проверьте новый IP/порт в URL, файрвол сервера или прямой IP.`;
    } else if (mismatchNote) {
      hint = `Проверьте соответствие DNS и IP ноды${mismatchNote}.`;
    }

    return {
      targetHost: target.targetHost,
      targetPort: target.targetPort,
      resolvedIps: resolvedIps.length ? resolvedIps : undefined,
      configuredIp,
      usedDirectIp,
      errorCode: code || (status ? `HTTP_${status}` : undefined),
      hint,
    };
  }

  private errorMessage(error: unknown): string {
    if (error instanceof XuiApiError) return error.message;
    const err = error as AxiosError<{ msg?: string }>;
    if (err.response)
      return err.response.data?.msg
        ? `3x-ui returned HTTP ${err.response.status}: ${safePanelMessage(err.response.data.msg, 16384)}`
        : `3x-ui returned HTTP ${err.response.status}`;
    const { code, isTls, isTimeout } = this.extractNetworkOrTlsCode(error);
    const networkCode = code ? ` (${code})` : '';
    if (isTls) {
      return `TLS certificate error${networkCode}`;
    }
    return isTimeout
      ? `Connection timed out${networkCode}`
      : `Node is unreachable${networkCode}`;
  }

  private wait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private getMutationIntervalMs(): number {
    const raw = process.env.PANEL_MUTATION_INTERVAL_MS;
    if (raw === undefined || raw.trim() === '') {
      return process.env.NODE_ENV === 'test' ||
        Boolean(process.env.JEST_WORKER_ID)
        ? 0
        : 300;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 300;
    return Math.max(100, Math.min(5000, Math.floor(parsed)));
  }

  private getRetryDelayMs(attempt: number): number {
    const raw = process.env.XUI_RETRY_DELAY_MS;
    if (
      (process.env.NODE_ENV === 'test' ||
        Boolean(process.env.JEST_WORKER_ID)) &&
      (raw === undefined || raw.trim() === '')
    ) {
      return 0;
    }
    if (
      raw !== undefined &&
      raw.trim() !== '' &&
      Number.isFinite(Number(raw))
    ) {
      return Math.max(0, Math.floor(Number(raw)));
    }
    return 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150);
  }

  private async withMutation<T>(
    node: Node | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    const key = node?.id || 'main';
    const previous = this.mutations.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(action);
    this.mutations.set(key, task);
    try {
      return await task;
    } finally {
      if (this.mutations.get(key) === task) this.mutations.delete(key);
    }
  }

  private async pace(node?: Node): Promise<void> {
    const key = node?.id || 'main';
    const interval = this.getMutationIntervalMs();
    const waitMs = Math.max(
      0,
      interval - (Date.now() - (this.lastMutation.get(key) || 0)),
    );
    await this.wait(waitMs);
    if (this.lastMutation.size >= 1000) {
      for (const oldestKey of this.lastMutation.keys()) {
        this.lastMutation.delete(oldestKey);
        break;
      }
    }
    this.lastMutation.set(key, Date.now());
  }

  private isTransientPanelMessage(message?: string): boolean {
    return /busy|locked|temporar|timeout|timed out|try again|unavailable|database.*lock|internal|server error/i.test(
      message || '',
    );
  }

  private async remoteInbounds(
    api: AxiosInstance,
  ): Promise<Array<{ id: number; tag?: string; port?: number }> | null> {
    try {
      const res = await api.get<unknown>('/panel/api/inbounds/list');
      const list = responsePayload(res.data);
      if (!Array.isArray(list)) return null;
      return list.flatMap((item) => {
        const record = asRecord(item);
        const id = Number(record?.id);
        if (!Number.isInteger(id) || id <= 0) return [];
        return [
          {
            id,
            tag: typeof record?.tag === 'string' ? record.tag : undefined,
            port: typeof record?.port === 'number' ? record.port : undefined,
          },
        ];
      });
    } catch {
      return null;
    }
  }

  async addInbound(
    inboundConfig: XuiInboundRaw,
    node?: Node,
  ): Promise<XuiCreatedInbound | null> {
    return this.withMutation(node, () =>
      this.createInboundWithRouting(inboundConfig, node),
    );
  }

  private async createInboundWithRouting(
    inboundConfig: XuiInboundRaw,
    node?: Node,
    options?: { allowEmptyClients?: boolean },
  ): Promise<XuiCreatedInbound | null> {
    if (!node || !this.routingStore)
      return this.createInbound(inboundConfig, node, options);
    return this.routingStore.withLock(node.id, async () => {
      const current = await this.routingStore!.node(node.id);
      const state = current.routingPresets || emptyRoutingState();
      if (state.pending)
        throw new ConflictException(
          'Применение маршрутизации ноды не завершено. Проверьте быстрые настройки.',
        );
      const prepared =
        hasPresets(state) && supportsSniffing(inboundConfig)
          ? prepareSniffing(inboundConfig)
          : undefined;
      const result = await this.createInbound(
        prepared?.inbound || inboundConfig,
        current,
        options,
      );
      if (result && prepared) {
        const savedSniffing = sniffingObject(result.inbound);
        const expectedSniffing = sniffingObject(prepared.inbound);
        if (
          ['enabled', 'routeOnly', 'metadataOnly', 'destOverride'].some(
            (field) => !equal(savedSniffing[field], expectedSniffing[field]),
          )
        ) {
          result.verificationError =
            '3x-ui не сохранила sniffing нового inbound';
        }
        state.sniffing[String(result.id)] = prepared.change;
        try {
          await this.routingStore!.save(node.id, state);
        } catch {
          // Return the created identity so rotation's existing cleanup can remove it.
          result.verificationError =
            'Не удалось сохранить исходный sniffing для нового inbound';
        }
      }
      return result;
    });
  }

  private async createInbound(
    inboundConfig: XuiInboundRaw,
    node?: Node,
    options?: { allowEmptyClients?: boolean },
  ): Promise<XuiCreatedInbound | null> {
    const key = node?.id || 'main';
    this.lastInboundErrors.delete(key);
    let created: XuiCreatedInbound | undefined;
    try {
      const config = normalizeInbound(inboundConfig);
      const tag =
        typeof config.tag === 'string' && config.tag
          ? config.tag
          : `3dp-${randomUUID()}`;
      const payload: XuiInboundRaw = { ...config, tag };
      let authenticatedApi = await this.createAuthenticatedApi(node);
      let id: number | undefined;

      for (let attempt = 1; attempt <= 3; attempt++) {
        await this.pace(node);
        try {
          const obj = await this.authenticatedRequest(
            node,
            async (api) => {
              authenticatedApi = api;
              const response = await api.post<unknown>(
                '/panel/api/inbounds/add',
                payload,
              );
              return responsePayload(response.data);
            },
            authenticatedApi,
          );
          const rawId =
            obj && typeof obj === 'object' ? (obj as { id?: unknown }).id : obj;
          const parsedId =
            typeof rawId === 'number' || typeof rawId === 'string'
              ? Number(rawId)
              : NaN;
          if (!Number.isInteger(parsedId) || parsedId <= 0)
            throw new XuiApiError(
              '3x-ui created an inbound without a valid ID; check the panel before retrying',
            );
          id = parsedId;
          break;
        } catch (error) {
          const status = (error as AxiosError)?.response?.status;
          if (error instanceof XuiApiError) {
            if (attempt < 3 && this.isTransientPanelMessage(error.message)) {
              this.logger.warn(
                `Inbound creation (${node?.name || 'main'}): retry ${attempt + 1}/3 (${error.message})`,
              );
              await this.wait(this.getRetryDelayMs(attempt));
              continue;
            }
            throw error;
          }

          if (status === 429) {
            if (attempt < 3) {
              this.logger.warn(
                `Inbound creation (${node?.name || 'main'}): HTTP 429, retry ${attempt + 1}/3`,
              );
              await this.wait(this.getRetryDelayMs(attempt));
              continue;
            }
            throw error;
          }

          if (!status || status === 408 || status >= 500) {
            const list = await this.remoteInbounds(authenticatedApi);
            const existing = list?.find(
              (item) =>
                item.tag === tag &&
                (item.port === undefined || item.port === config.port),
            );
            if (existing) {
              id = existing.id;
              break;
            }
            // Do not blindly retry when the request had no HTTP status (timeout/reset)
            // or when we couldn't inspect existing panel inbounds.
            if (!status) throw error;
            if (list && attempt < 3) {
              this.logger.warn(
                `Inbound creation (${node?.name || 'main'}): HTTP ${status}, retry ${attempt + 1}/3`,
              );
              await this.wait(this.getRetryDelayMs(attempt));
              continue;
            }
            throw error;
          }

          throw error;
        }
      }

      if (!id) {
        throw new XuiApiError(
          '3x-ui created an inbound without a valid ID; check the panel before retrying',
        );
      }
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
      if (!options?.allowEmptyClients) verifyInboundAccess(saved);
      verifyTlsIdentity(config, saved);
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

  async prepareSubscriptionClient(
    clientRef: string,
    autoCreate: boolean,
    node?: Node,
  ): Promise<XuiInboundClient> {
    if (node?.version && !hasSeparateClientApi(node)) {
      throw new Error(
        `Привязка клиента 3x-ui поддерживается на 3x-ui 3.x и выше (нода «${node.name}»: ${node.version})`,
      );
    }
    const run = () =>
      this.authenticatedRequest(node, async (api) => {
        let email = clientRef.trim();
        if (!email) {
          throw new Error('Не указан идентификатор клиента 3x-ui');
        }
        if (!autoCreate && /^\d+$/.test(email)) {
          const list = await api.get<unknown>('/panel/api/clients/list');
          const rows = responsePayload(list.data);
          if (!Array.isArray(rows)) {
            throw new Error(
              `Не удалось получить список клиентов на ноде ${node?.name || 'по умолчанию'}`,
            );
          }
          let matchedEmail: string | undefined;
          for (const row of rows) {
            const record = asRecord(row);
            const clientObj = asRecord(record?.client) ?? record;
            if (
              clientObj &&
              (typeof clientObj.id === 'number' ||
                typeof clientObj.id === 'string') &&
              String(clientObj.id) === email &&
              typeof clientObj.email === 'string' &&
              clientObj.email
            ) {
              matchedEmail = clientObj.email;
              break;
            }
          }
          if (!matchedEmail) {
            throw new Error(
              `Клиент ${email} не найден на ноде ${node?.name || 'по умолчанию'}`,
            );
          }
          email = matchedEmail;
        }
        if (autoCreate) {
          await this.pace(node);
          // Import supports unattached clients, unlike /clients/add which requires an inbound.
          const imported = await api.post<unknown>(
            '/panel/api/clients/import',
            {
              data: JSON.stringify([
                {
                  client: {
                    email,
                    id: randomUUID(),
                    password: randomBytes(32).toString('base64'),
                    auth: randomUUID(),
                    subId: email,
                    enable: true,
                    flow: '',
                    totalGB: 0,
                    expiryTime: 0,
                    limitIp: 0,
                  },
                  inboundIds: [],
                },
              ]),
            },
          );
          if (asRecord(imported.data)?.success !== true) {
            throw new Error(
              `Не удалось создать клиента на ноде ${node?.name || 'по умолчанию'}`,
            );
          }
        }
        return this.getSubscriptionClient(api, email, node);
      });
    return autoCreate ? this.withMutation(node, run) : run();
  }

  private async getSubscriptionClient(
    api: AxiosInstance,
    email: string,
    node?: Node,
  ): Promise<XuiInboundClient> {
    const res = await api.get<unknown>(
      `/panel/api/clients/get/${encodeURIComponent(email)}`,
    );
    const body = asRecord(res.data);
    const payload = body?.success === true ? asRecord(body.obj) : undefined;
    const rawClient = asRecord(payload?.client) ?? payload;
    if (!rawClient || rawClient.email !== email) {
      throw new Error(
        `Клиент ${email} не найден на ноде ${node?.name || 'по умолчанию'}`,
      );
    }
    const id =
      typeof rawClient.uuid === 'string' && rawClient.uuid
        ? rawClient.uuid
        : typeof rawClient.id === 'string'
          ? rawClient.id
          : undefined;
    return {
      ...(rawClient as unknown as XuiInboundClient),
      id,
      email,
    };
  }

  async getSubscriptionUsage(
    email: string,
    node?: Node,
  ): Promise<{
    upload: number;
    download: number;
    total: number;
    expire: number;
  }> {
    return this.authenticatedRequest(node, async (api) => {
      const details = await api.get<unknown>(
        `/panel/api/clients/get/${encodeURIComponent(email)}`,
      );
      const detailsBody = asRecord(details.data);
      const payload =
        detailsBody?.success === true ? asRecord(detailsBody.obj) : undefined;
      const client = asRecord(payload?.client) ?? payload;
      if (!client) {
        throw new Error('Не удалось получить данные клиента');
      }

      let trafficObj: Record<string, unknown> | undefined;
      let trafficOk = false;
      try {
        const traffic = await api.get<unknown>(
          `/panel/api/clients/traffic/${encodeURIComponent(email)}`,
        );
        const trafficBody = asRecord(traffic.data);
        if (trafficBody?.success === true) {
          trafficOk = true;
          trafficObj = asRecord(trafficBody.obj);
        }
      } catch (error) {
        const status = (error as AxiosError)?.response?.status;
        if (status === 401 || status === 403) throw error;
      }

      const count = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value)
          ? Math.max(0, Math.floor(value))
          : 0;
      return {
        upload: trafficOk ? count(trafficObj?.up) : 0,
        download: trafficOk
          ? count(trafficObj?.down)
          : count(payload?.usedTraffic),
        total: count(client.totalGB),
        expire:
          typeof client.expiryTime === 'number' && client.expiryTime > 0
            ? Math.floor(client.expiryTime / 1000)
            : 0,
      };
    });
  }

  async addInboundForClient(
    inboundConfig: XuiInboundRaw,
    client: XuiInboundClient,
    node?: Node,
  ): Promise<XuiCreatedInbound | null> {
    const key = node?.id || 'main';
    const clientEmail = client.email;
    if (!clientEmail) {
      this.lastInboundErrors.set(
        key,
        'Для привязки инбаунда требуется email клиента 3x-ui',
      );
      return null;
    }
    return this.withMutation(node, async () => {
      const settings = jsonObject(inboundConfig.settings, 'settings');
      const originalClient =
        asRecord(
          Array.isArray(settings.clients) ? settings.clients[0] : undefined,
        ) || {};
      const emptyConfig: XuiInboundRaw = {
        ...inboundConfig,
        settings: JSON.stringify({ ...settings, clients: [] }),
      };
      const created = await this.createInboundWithRouting(emptyConfig, node, {
        allowEmptyClients: true,
      });
      if (!created) return null;
      if (created.verificationError) return created;

      try {
        const saved = await this.authenticatedRequest(node, async (api) => {
          await this.pace(node);
          const attached = await api.post<unknown>(
            `/panel/api/clients/${encodeURIComponent(clientEmail)}/attach`,
            { inboundIds: [created.id] },
          );
          responsePayload(attached.data);

          const readback = await api.get<unknown>(
            `/panel/api/inbounds/get/${created.id}`,
          );
          const normalized = normalizeInbound(responsePayload(readback.data));
          const savedSettings = jsonObject(normalized.settings, 'settings');
          const savedClients = Array.isArray(savedSettings.clients)
            ? (savedSettings.clients as Array<Record<string, unknown>>)
            : [];
          if (!savedClients.length) {
            const stored = await this.getSubscriptionClient(
              api,
              clientEmail,
              node,
            );
            normalized.settings = JSON.stringify({
              ...savedSettings,
              clients: [{ ...originalClient, ...stored }],
            });
          }
          verifyInboundAccess(normalized);
          const parsedClients = jsonObject(normalized.settings, 'settings')
            .clients as Array<Record<string, unknown>>;
          if (
            !parsedClients.some(
              (item) =>
                item.enable !== false &&
                (item.email === client.email ||
                  (client.id && item.id === client.id)),
            )
          ) {
            throw new XuiApiError(
              `3x-ui не подтвердила привязку клиента к inbound ${created.id}`,
            );
          }
          return normalized;
        });
        return { id: created.id, inbound: saved };
      } catch (error) {
        const message = this.errorMessage(error);
        this.lastInboundErrors.set(key, message);
        this.logger.warn(
          `Client attach to inbound ${created.id} (${node?.name || 'main'}): ${message}`,
        );
        const cleaned = await this.removeInbound(created.id, node);
        if (cleaned && node && this.routingStore) {
          await this.routingStore.forgetInbound(node.id, created.id);
        }
        if (cleaned) return null;
        return { ...created, verificationError: message };
      }
    });
  }

  async attachExistingClientToInbound(
    inboundId: number,
    client: XuiInboundClient,
    node?: Node,
    matchesInbound?: (inbound: XuiInboundRaw) => boolean,
  ): Promise<XuiCreatedInbound | null> {
    if (!inboundId || inboundId <= 0 || !client.email) return null;
    return this.withMutation(node, () => {
      const run = () =>
        this.attachClientToSharedInbound(
          inboundId,
          client,
          node,
          matchesInbound,
        );
      if (!node || !this.routingStore) return run();
      return this.routingStore.withLock(node.id, run);
    });
  }

  private async attachClientToSharedInbound(
    inboundId: number,
    client: XuiInboundClient,
    node?: Node,
    matchesInbound?: (inbound: XuiInboundRaw) => boolean,
  ): Promise<XuiCreatedInbound | null> {
    const key = node?.id || 'main';
    this.lastInboundErrors.delete(key);
    const email = client.email || '';
    const clientId = client.id || '';
    let accepted: XuiInboundRaw | undefined;
    try {
      return await this.authenticatedRequest(node, async (api) => {
        const currentResp = await api.get<unknown>(
          `/panel/api/inbounds/get/${inboundId}`,
        );
        const current = normalizeInbound(responsePayload(currentResp.data));
        if (current.id !== inboundId) {
          throw new XuiApiError('3x-ui вернула другой инбаунд');
        }
        if (!current.enable) {
          throw new XuiApiError(
            `Общий inbound ${inboundId} отключён на панели 3x-ui`,
          );
        }
        if (matchesInbound && !matchesInbound(current)) {
          throw new XuiApiError(
            'Параметры общего инбаунда изменились на панели 3x-ui',
          );
        }

        const { clients } = jsonObject(current.settings, 'inbound settings');
        if (
          Array.isArray(clients) &&
          clients.some((rawItem) => {
            const item = asRecord(rawItem);
            return (
              item?.enable !== false &&
              item?.email === email &&
              (!clientId || item.id === clientId)
            );
          })
        ) {
          return { id: inboundId, inbound: current };
        }

        accepted = current;
        await this.pace(node);
        const attached = await api.post<unknown>(
          `/panel/api/clients/${encodeURIComponent(email)}/attach`,
          { inboundIds: [inboundId] },
        );
        responsePayload(attached.data);

        const savedResp = await api.get<unknown>(
          `/panel/api/inbounds/get/${inboundId}`,
        );
        const saved = normalizeInbound(responsePayload(savedResp.data));
        const savedSettings = jsonObject(
          saved.settings,
          'saved inbound settings',
        );
        const savedClients = Array.isArray(savedSettings.clients)
          ? (savedSettings.clients as Array<Record<string, unknown>>)
          : [];
        if (
          saved.id !== inboundId ||
          saved.enable !== true ||
          saved.protocol !== current.protocol ||
          !savedClients.some(
            (item) =>
              item?.enable !== false &&
              item.email === email &&
              (!clientId || item.id === clientId),
          )
        ) {
          throw new XuiApiError(
            `3x-ui не подтвердила привязку клиента к общему inbound ${inboundId}`,
          );
        }
        return { id: inboundId, inbound: saved };
      });
    } catch (error) {
      const message = this.errorMessage(error);
      this.lastInboundErrors.set(key, message);
      this.logger.warn(
        `Shared inbound client attach (${node?.name || 'main'}, inbound ${inboundId}): ${message}`,
      );
      return accepted
        ? { id: inboundId, inbound: accepted, verificationError: message }
        : null;
    }
  }

  async addInboundClient(
    inboundId: number,
    client: Record<string, unknown>,
    node?: Node,
    matchesInbound?: (inbound: XuiInboundRaw) => boolean,
  ): Promise<XuiCreatedInbound | null> {
    if (!inboundId || inboundId <= 0) return null;
    return this.withMutation(node, () => {
      const run = () =>
        this.appendInboundClient(inboundId, client, node, matchesInbound);
      if (!node || !this.routingStore) return run();
      return this.routingStore.withLock(node.id, run);
    });
  }

  private async appendInboundClient(
    inboundId: number,
    client: Record<string, unknown>,
    node?: Node,
    matchesInbound?: (inbound: XuiInboundRaw) => boolean,
  ): Promise<XuiCreatedInbound | null> {
    const key = node?.id || 'main';
    this.lastInboundErrors.delete(key);
    const clientId = typeof client.id === 'string' ? client.id : '';
    const email = typeof client.email === 'string' ? client.email : '';
    const separateClients = hasSeparateClientApi(node);
    let accepted: XuiInboundRaw | undefined;
    try {
      return await this.authenticatedRequest(node, async (api) => {
        const currentResp = await api.get<unknown>(
          `/panel/api/inbounds/get/${inboundId}`,
        );
        const current = normalizeInbound(responsePayload(currentResp.data));
        if (current.id !== inboundId) {
          throw new XuiApiError('3x-ui вернула другой инбаунд');
        }
        if (!current.enable) {
          throw new XuiApiError(
            `Общий inbound ${inboundId} отключён на панели 3x-ui`,
          );
        }

        if (matchesInbound && !matchesInbound(current)) {
          throw new XuiApiError(
            'Параметры общего инбаунда изменились на панели 3x-ui',
          );
        }

        if (separateClients) {
          if (!clientId || !email) {
            throw new XuiApiError(
              'Для добавления клиента требуются UUID и email',
            );
          }
          const { clients } = jsonObject(current.settings, 'inbound settings');
          if (
            Array.isArray(clients) &&
            clients.some(
              (item) =>
                item?.id === clientId &&
                item.email === email &&
                item.enable !== false,
            )
          ) {
            return { id: inboundId, inbound: current };
          }
          // A write may have succeeded before the response reached us.
          accepted = current;
          await this.pace(node);
          const response = await api.post<unknown>('/panel/api/clients/add', {
            client,
            inboundIds: [inboundId],
          });
          responsePayload(response.data);
        } else {
          try {
            await this.pace(node);
            const addResp = await api.post<unknown>(
              '/panel/api/inbounds/addClient',
              {
                id: inboundId,
                settings: JSON.stringify({ clients: [client] }),
              },
            );
            responsePayload(addResp.data);
            accepted = current;
          } catch (addError) {
            const status = (addError as AxiosError).response?.status;
            if (status === 401 || status === 403) throw addError;
            // Fallback to /panel/api/inbounds/update/:id for panels without addClient
            const parsedSettings = jsonObject(
              typeof current.settings === 'string'
                ? JSON.parse(current.settings)
                : current.settings,
              'inbound settings',
            );
            const existingClients = Array.isArray(parsedSettings.clients)
              ? (parsedSettings.clients as Array<Record<string, unknown>>)
              : [];
            const nextClients = existingClients.some((c) => c.id === clientId)
              ? existingClients
              : [...existingClients, client];
            const body: Record<string, unknown> = {
              ...current,
              settings: JSON.stringify({
                ...parsedSettings,
                clients: nextClients,
              }),
            };
            for (const field of ['streamSettings', 'sniffing']) {
              if (typeof body[field] !== 'string')
                body[field] = JSON.stringify(body[field] ?? {});
            }
            for (const field of [
              'up',
              'down',
              'allTime',
              'clientStats',
              'lastTrafficResetTime',
            ]) {
              delete body[field];
            }
            const updateResp = await api.post<unknown>(
              `/panel/api/inbounds/update/${inboundId}`,
              body,
            );
            responsePayload(updateResp.data);
            accepted = current;
          }
        }

        const savedResp = await api.get<unknown>(
          `/panel/api/inbounds/get/${inboundId}`,
        );
        const saved = normalizeInbound(responsePayload(savedResp.data));
        const savedSettings = jsonObject(
          typeof saved.settings === 'string'
            ? JSON.parse(saved.settings)
            : saved.settings,
          'saved inbound settings',
        );
        const savedClients = Array.isArray(savedSettings.clients)
          ? (savedSettings.clients as Array<Record<string, unknown>>)
          : [];
        if (
          saved.id !== inboundId ||
          saved.enable !== true ||
          saved.protocol !== current.protocol ||
          (clientId &&
            !savedClients.some(
              (c) =>
                c?.id === clientId &&
                (!separateClients || (c.email === email && c.enable !== false)),
            ))
        ) {
          throw new XuiApiError(
            `3x-ui не подтвердила привязку клиента к общему inbound ${inboundId}`,
          );
        }
        return { id: inboundId, inbound: saved };
      });
    } catch (error) {
      const message = this.errorMessage(error);
      this.lastInboundErrors.set(key, message);
      this.logger.warn(
        `Shared inbound client attach (${node?.name || 'main'}, inbound ${inboundId}): ${message}`,
      );
      return accepted
        ? { id: inboundId, inbound: accepted, verificationError: message }
        : null;
    }
  }

  async deleteInboundClient(
    inboundId: number,
    clientId: string,
    node?: Node,
  ): Promise<boolean> {
    if (!inboundId || inboundId <= 0 || !clientId) return true;
    return this.withMutation(node, async () => {
      await this.pace(node);
      const run = () => this.removeInboundClient(inboundId, clientId, node);
      if (!node || !this.routingStore) return run();
      return this.routingStore.withLock(node.id, run);
    });
  }

  private async removeInboundClient(
    inboundId: number,
    clientId: string,
    node?: Node,
  ): Promise<boolean> {
    try {
      return await this.authenticatedRequest(node, async (api) => {
        if (hasSeparateClientApi(node))
          return this.removeSeparateClient(api, inboundId, clientId);
        try {
          const resp = await api.post<unknown>(
            `/panel/api/inbounds/${inboundId}/delClient/${encodeURIComponent(clientId)}`,
          );
          const body = asRecord(resp.data);
          if (
            body?.success === false &&
            typeof body.msg === 'string' &&
            /not found|does not exist|record not found|no client/i.test(
              body.msg,
            )
          ) {
            return true;
          }
          responsePayload(resp.data);
          return true;
        } catch (delError) {
          const status = (delError as AxiosError).response?.status;
          if (status === 401 || status === 403) throw delError;
          // Fallback: remove client via GET + update/:id (or delete inbound if empty)
          const getResp = await api.get<unknown>(
            `/panel/api/inbounds/get/${inboundId}`,
          );
          const getBody = asRecord(getResp.data);
          if (
            getBody?.success === false &&
            typeof getBody.msg === 'string' &&
            /not found|does not exist|record not found/i.test(getBody.msg)
          ) {
            return true;
          }
          const current = normalizeInbound(responsePayload(getResp.data));
          const parsedSettings = jsonObject(
            typeof current.settings === 'string'
              ? JSON.parse(current.settings)
              : current.settings,
            'inbound settings',
          );
          const existingClients = Array.isArray(parsedSettings.clients)
            ? (parsedSettings.clients as Array<Record<string, unknown>>)
            : [];
          const remainingClients = existingClients.filter(
            (c) => c.id !== clientId && c.email !== clientId,
          );
          if (remainingClients.length === existingClients.length) {
            return true;
          }
          if (remainingClients.length === 0) {
            const delInboundResp = await api.post<unknown>(
              `/panel/api/inbounds/del/${inboundId}`,
            );
            responsePayload(delInboundResp.data);
            return true;
          }
          const body: Record<string, unknown> = {
            ...current,
            settings: JSON.stringify({
              ...parsedSettings,
              clients: remainingClients,
            }),
          };
          for (const field of ['streamSettings', 'sniffing']) {
            if (typeof body[field] !== 'string')
              body[field] = JSON.stringify(body[field] ?? {});
          }
          for (const field of [
            'up',
            'down',
            'allTime',
            'clientStats',
            'lastTrafficResetTime',
          ]) {
            delete body[field];
          }
          const updateResp = await api.post<unknown>(
            `/panel/api/inbounds/update/${inboundId}`,
            body,
          );
          responsePayload(updateResp.data);
          return true;
        }
      });
    } catch (error) {
      this.logger.warn(
        `Shared inbound client deletion (${inboundId}/${clientId}): ${this.errorMessage(error)}`,
      );
      return false;
    }
  }

  private async removeSeparateClient(
    api: AxiosInstance,
    inboundId: number,
    clientId: string,
    knownEmail?: string,
  ): Promise<boolean> {
    let email: unknown = knownEmail;
    if (!knownEmail) {
      const inbound = await api
        .get<unknown>(`/panel/api/inbounds/get/${inboundId}`)
        .catch((error: AxiosError) => {
          if (error.response?.status === 404) return undefined;
          throw error;
        });
      if (inbound && !this.panelRecordMissing(inbound.data)) {
        const current = normalizeInbound(responsePayload(inbound.data));
        const { clients } = jsonObject(current.settings, 'inbound settings');
        if (current.id !== inboundId || !Array.isArray(clients)) return false;
        email = clients.find(
          (client) => asRecord(client)?.id === clientId,
        )?.email;
      }
    }
    if (typeof email !== 'string') {
      // The first read may find an orphan or an inbound removed in a previous retry.
      const list = await api.get<unknown>('/panel/api/clients/list');
      const clients = responsePayload(list.data);
      if (!Array.isArray(clients))
        throw new XuiApiError('Недопустимый список клиентов 3x-ui');
      const matches = clients.filter(
        (client) => asRecord(client)?.uuid === clientId,
      );
      if (matches.length === 0) return true;
      if (matches.length !== 1) return false;
      email = asRecord(matches[0])?.email;
    }
    if (typeof email !== 'string' || !email) return false;

    const encodedEmail = encodeURIComponent(email);
    const details = await api.get<unknown>(
      `/panel/api/clients/get/${encodedEmail}`,
    );
    if (this.panelRecordMissing(details.data)) return true;
    const row = asRecord(responsePayload(details.data));
    const client = asRecord(row?.client);
    if (client?.uuid !== clientId || client.email !== email) return false;
    const attachments = row?.inboundIds === null ? [] : row?.inboundIds;
    if (!Array.isArray(attachments)) return false;
    const shortId = formatClientEmail(null, clientId);
    const managedEmail =
      !email.startsWith('3dp-') &&
      (email === shortId || email.endsWith(`-${shortId}`));
    const emptyExternalLinks =
      row?.externalLinks === null ||
      (Array.isArray(row?.externalLinks) && row.externalLinks.length === 0);
    const canDelete =
      managedEmail &&
      emptyExternalLinks &&
      attachments.every((id) => id === inboundId);
    if (canDelete) {
      const deleted = await api.post<unknown>(
        `/panel/api/clients/del/${encodedEmail}`,
      );
      if (!this.panelRecordMissing(deleted.data)) responsePayload(deleted.data);
    } else if (attachments.includes(inboundId)) {
      const detached = await api.post<unknown>(
        `/panel/api/clients/${encodedEmail}/detach`,
        { inboundIds: [inboundId] },
      );
      if (!this.panelRecordMissing(detached.data))
        responsePayload(detached.data);
    }
    return true;
  }

  private panelRecordMissing(data: unknown): boolean {
    const body = asRecord(data);
    return (
      body?.success === false &&
      typeof body.msg === 'string' &&
      /not found|does not exist|record not found|не найден/i.test(body.msg)
    );
  }

  async deleteInbound(
    id: number,
    node?: Node,
    ownedClientId?: string,
  ): Promise<boolean> {
    return this.withMutation(node, () => {
      const run = async () => {
        if (ownedClientId && hasSeparateClientApi(node))
          return this.removeOwnedInbound(id, ownedClientId, node);
        const removed = await this.removeInbound(id, node);
        if (removed && node && this.routingStore) {
          await this.routingStore.forgetInbound(node.id, id);
        }
        return removed;
      };
      if (!node || !this.routingStore) return run();
      return this.routingStore.withLock(node.id, run);
    });
  }

  private async removeOwnedInbound(
    id: number,
    clientId: string,
    node?: Node,
  ): Promise<boolean> {
    try {
      const current = await this.authenticatedRequest(node, async (api) => {
        const { data } = await api.get<unknown>(
          `/panel/api/inbounds/get/${id}`,
        );
        if (this.panelRecordMissing(data)) return null;
        return normalizeInbound(responsePayload(data));
      });
      let email: string | undefined;
      if (current) {
        const { clients } = jsonObject(current.settings, 'inbound settings');
        if (!Array.isArray(clients)) return false;
        // Do not delete a reused panel ID or an inbound with someone else's clients.
        if (current.id !== id) return false;
        const client = asRecord(clients[0]);
        if (
          current.protocol !== 'vless' ||
          clients.length !== 1 ||
          client?.id !== clientId
        )
          return this.removeInboundClient(id, clientId, node);
        if (typeof client.email === 'string') email = client.email;
        if (!(await this.removeInbound(id, node))) return false;
      }
      if (node && this.routingStore)
        await this.routingStore.forgetInbound(node.id, id);
      return await this.authenticatedRequest(node, (api) =>
        this.removeSeparateClient(api, id, clientId, email),
      );
    } catch (error) {
      this.logger.warn(
        `Managed inbound deletion (${id}): ${this.errorMessage(error)}`,
      );
      return false;
    }
  }

  private async removeInbound(id: number, node?: Node): Promise<boolean> {
    if (!id || id <= 0) return true;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let apiRef: AxiosInstance | undefined;
      try {
        await this.pace(node);
        const result = await this.authenticatedRequest(node, async (api) => {
          apiRef = api;
          const response = await api.post<unknown>(
            `/panel/api/inbounds/del/${id}`,
          );
          const body = asRecord(response.data);
          if (
            body?.success === false &&
            typeof body.msg === 'string' &&
            /not found|does not exist|record not found/i.test(body.msg)
          ) {
            return { done: true, retry: false };
          }
          if (body?.success === false) {
            const msg = safePanelMessage(body.msg, 16384);
            if (this.isTransientPanelMessage(msg)) {
              return { done: false, retry: true, reason: msg };
            }
            const list = await this.remoteInbounds(api);
            if (list && !list.some((item) => item.id === id)) {
              return { done: true, retry: false };
            }
            this.logger.warn(`Inbound deletion ${id}: ${msg}`);
            return { done: false, retry: false };
          }
          responsePayload(response.data);
          return { done: true, retry: false };
        });

        if (result.done) return true;
        if (!result.retry) return false;
        if (attempt < 3) {
          this.logger.warn(
            `Inbound deletion ${id} (${node?.name || 'main'}): retry ${attempt + 1}/3 (${result.reason})`,
          );
          await this.wait(this.getRetryDelayMs(attempt));
          continue;
        }
        return false;
      } catch (error) {
        const status = (error as AxiosError)?.response?.status;
        // A 404 can mean a wrong base path/API route, not an absent inbound.
        if (
          status === 404 ||
          (status &&
            status >= 400 &&
            status < 500 &&
            status !== 408 &&
            status !== 429)
        ) {
          this.logger.warn(
            `Inbound deletion ${id}: ${this.errorMessage(error)}`,
          );
          return false;
        }
        const list = apiRef ? await this.remoteInbounds(apiRef) : null;
        if (list && !list.some((item) => item.id === id)) {
          return true;
        }
        if (
          attempt < 3 &&
          (!status || status === 408 || status === 429 || status >= 500)
        ) {
          this.logger.warn(
            `Inbound deletion ${id} (${node?.name || 'main'}): retry ${attempt + 1}/3 (${this.errorMessage(error)})`,
          );
          await this.wait(this.getRetryDelayMs(attempt));
          continue;
        }
        this.logger.warn(`Inbound deletion ${id}: ${this.errorMessage(error)}`);
        return false;
      }
    }
    return false;
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

  async checkNodeConnection(
    node: Node,
    options?: { freshConnection?: boolean; preferDirectIp?: boolean },
  ): Promise<XuiConnectionStatus> {
    const started = Date.now();
    const target = this.parseTargetEndpoint(node);
    const resolvedIps = await this.resolveHostIps(target.targetHost);
    const configuredIp = node.ip?.trim().replace(/^\[|\]$/g, '') || undefined;
    const validConfiguredIp =
      configuredIp && net.isIP(configuredIp) !== 0 ? configuredIp : undefined;
    const isDomainHost = Boolean(
      target.targetHost &&
        target.targetHost !== 'localhost' &&
        net.isIP(target.targetHost) === 0,
    );

    const probeOnce = async (apiOptions: {
      freshAgent: boolean;
      directIp?: string;
    }) =>
      this.runAuthenticatedOnce(
        node,
        async (api) => {
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
          const mem = asRecord(payload?.mem);
          const disk = asRecord(payload?.disk);
          const toPercent = (rec: Record<string, unknown> | undefined) => {
            const current = Number(rec?.current);
            const total = Number(rec?.total);
            if (
              !Number.isFinite(current) ||
              !Number.isFinite(total) ||
              total <= 0
            ) {
              return undefined;
            }
            return Math.min(100, Math.max(0, (current / total) * 100));
          };
          const rawCpu = Number(payload?.cpu);
          const cpuPercent = Number.isFinite(rawCpu)
            ? Math.min(100, Math.max(0, rawCpu))
            : undefined;
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
            cpuPercent,
            memPercent: toPercent(mem),
            diskPercent: toPercent(disk),
            webCertificateFile: files?.certificateFile,
            webKeyFile: files?.keyFile,
          };
        },
        undefined,
        apiOptions,
      );

    let usedDirectIp = Boolean(
      options?.preferDirectIp && validConfiguredIp && isDomainHost,
    );
    try {
      let profile: Awaited<ReturnType<typeof probeOnce>>;
      try {
        profile = await probeOnce({
          freshAgent: options?.freshConnection !== false,
          ...(usedDirectIp ? { directIp: validConfiguredIp } : {}),
        });
      } catch (error) {
        const status = (error as AxiosError).response?.status;
        if (
          !usedDirectIp &&
          !status &&
          !(error instanceof XuiApiError) &&
          validConfiguredIp &&
          isDomainHost &&
          !resolvedIps.includes(validConfiguredIp)
        ) {
          usedDirectIp = true;
          profile = await probeOnce({
            freshAgent: true,
            directIp: validConfiguredIp,
          });
        } else {
          throw error;
        }
      }

      return {
        success: true,
        ...profile,
        responseTimeMs: Date.now() - started,
        diagnostics: {
          targetHost: target.targetHost,
          targetPort: target.targetPort,
          resolvedIps: resolvedIps.length ? resolvedIps : undefined,
          configuredIp: validConfiguredIp,
          usedDirectIp,
          ...(usedDirectIp
            ? {
                hint: 'Подключение выполнено напрямую по IP ноды (в обход DNS).',
              }
            : {}),
        },
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
        diagnostics: this.extractErrorDiagnostics(
          error,
          target,
          resolvedIps,
          validConfiguredIp,
          usedDirectIp,
        ),
      };
    }
  }

  async assertXrayHealthy(node: Node): Promise<void> {
    await this.authenticatedRequest(node, async (api) => {
      const status = jsonObject(
        responsePayload((await api.get('/panel/api/server/status')).data),
        'server status',
      );
      const xray = jsonObject(status.xray, 'Xray status');
      if (xray.state === 'running' && !xray.errorMsg) return;
      const message = safePanelMessage(
        xray.errorMsg || `Xray state: ${xray.state}`,
        16384,
      );
      const tag =
        typeof xray.errorMsg === 'string'
          ? xray.errorMsg.match(/\btag\s+["']?([^\s"'>]+)/)?.[1]
          : undefined;
      let inbound;
      if (tag) {
        try {
          const list = responsePayload(
            (await api.get('/panel/api/inbounds/list')).data,
          );
          if (Array.isArray(list)) {
            const raw = list.find((value) => asRecord(value)?.tag === tag);
            if (raw) inbound = inboundDiagnostic(normalizeInbound(raw));
          }
        } catch {
          /* Preserve the startup error if diagnostics are unavailable. */
        }
      }
      throw new XuiRuntimeError(
        `Создание остановлено: Xray ноды уже неисправен. ${message}`,
        inbound,
      );
    });
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
          ? safePanelMessage(xray.errorMsg, 16384)
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

  async getXrayTemplate(node: Node): Promise<XrayTemplate> {
    return this.authenticatedRequest(node, async (api) => {
      for (const path of ['/panel/api/xray', '/panel/xray'] as const) {
        let response: AxiosResponse<unknown>;
        try {
          response = await api.post<unknown>(`${path}/`);
        } catch (error) {
          if (
            path === '/panel/api/xray' &&
            [404, 405].includes((error as AxiosError).response?.status || 0)
          )
            continue;
          throw error;
        }
        const wrapper = jsonObject(
          responsePayload(response.data),
          'Xray settings',
        );
        const config = jsonObject(wrapper.xraySetting, 'Xray template');
        if (!Array.isArray(config.outbounds) || !config.outbounds.length) {
          throw new XuiApiError(
            'Шаблон Xray не содержит исходящих подключений',
          );
        }
        if (typeof wrapper.outboundTestUrl !== 'string')
          throw new XuiApiError('Invalid outbound test URL');
        return { path, config, outboundTestUrl: wrapper.outboundTestUrl };
      }
      throw new XuiApiError(
        'API маршрутизации недоступен для этой панели или способа авторизации',
      );
    });
  }

  async saveXrayTemplate(node: Node, template: XrayTemplate): Promise<void> {
    await this.authenticatedRequest(node, async (api) => {
      const body = new URLSearchParams({
        xraySetting: JSON.stringify(template.config),
        outboundTestUrl: template.outboundTestUrl,
      });
      responsePayload(
        (await api.post<unknown>(`${template.path}/update`, body)).data,
      );
    });
  }

  async listRoutingInbounds(node: Node): Promise<XuiInboundRaw[]> {
    return this.authenticatedRequest(node, async (api) => {
      const payload = responsePayload(
        (await api.get<unknown>('/panel/api/inbounds/list')).data,
      );
      if (!Array.isArray(payload))
        throw new XuiApiError('Invalid inbound list');
      return payload.map((value) => {
        const raw = jsonObject(value, 'object');
        // Do not normalize sidecar protocols/port ranges into the creation DTO.
        if (!Number.isInteger(raw.id) || typeof raw.protocol !== 'string')
          throw new XuiApiError('Invalid inbound identity');
        return raw as unknown as XuiInboundRaw;
      });
    });
  }

  async getRoutingInbound(node: Node, id: number): Promise<XuiInboundRaw> {
    return this.authenticatedRequest(node, async (api) => {
      const response = await api.get<unknown>(`/panel/api/inbounds/get/${id}`);
      const inbound = jsonObject(responsePayload(response.data), 'object');
      if (inbound.id !== id || typeof inbound.protocol !== 'string') {
        throw new XuiApiError('Invalid inbound identity');
      }
      return inbound as unknown as XuiInboundRaw;
    });
  }

  async updateInboundSniffing(
    node: Node,
    inbound: XuiInboundRaw,
  ): Promise<void> {
    await this.authenticatedRequest(node, async (api) => {
      const body = { ...inbound };
      for (const field of ['settings', 'streamSettings', 'sniffing']) {
        if (typeof body[field] !== 'string')
          body[field] = JSON.stringify(body[field] ?? {});
      }
      // Read-only statistics must never reset live counters on an update.
      for (const field of [
        'up',
        'down',
        'allTime',
        'clientStats',
        'lastTrafficResetTime',
      ])
        delete body[field];
      responsePayload(
        (
          await api.post<unknown>(
            `/panel/api/inbounds/update/${inbound.id}`,
            body,
          )
        ).data,
      );
    });
  }

  async validateRoutingGeodata(
    node: Node,
    path: XrayTemplate['path'],
    selection: RoutingSelection,
  ): Promise<boolean> {
    return this.authenticatedRequest(node, async (api) => {
      for (const [kind, tokens] of [
        ...(selection.blockRussia
          ? [
              ['domain', 'geosite:category-ru'],
              ['ip', 'geoip:ru'],
            ]
          : []),
        ...(selection.googleIpv4 ? [['domain', 'geosite:google']] : []),
      ]) {
        let response: AxiosResponse<unknown>;
        try {
          response = await api.post<unknown>(
            `${path}/geodata/validate`,
            new URLSearchParams({ kind, tokens }),
          );
        } catch (error) {
          if ([404, 405].includes((error as AxiosError).response?.status || 0))
            return false;
          throw error;
        }
        const issues = responsePayload(response.data);
        if (!Array.isArray(issues))
          throw new XuiApiError('Invalid geodata validation response');
        if (issues.length)
          throw new XuiApiError(
            `В 3x-ui отсутствует или повреждена категория ${tokens}. Обновите геобазы панели.`,
          );
      }
      return true;
    });
  }

  async applyXrayConfig(node: Node): Promise<void> {
    await this.authenticatedRequest(node, async (api) => {
      responsePayload(
        (await api.post<unknown>('/panel/api/server/restartXrayService')).data,
      );
    });
    await this.waitForXray(node);
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
    } catch (error) {
      // Only a panel answer means "no certificate"; transport failures must not
      // be reported as a missing certificate.
      if (error instanceof XuiApiError) return null;
      throw error;
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
