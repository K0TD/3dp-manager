import {
  CLIENT_FINGERPRINTS,
  MANAGED_PROFILE_KINDS,
  PROFILE_ROTATION_POLICIES,
  REVERSE_PROXY_ENGINES,
  XHTTP_MODES,
  type ClientFingerprint,
  type ManagedProfileKind,
  type ManagedProfileSettings,
  type ProfileCompatibilityItem,
  type ProfileCompatibilityReport,
  type XhttpMode,
  type XhttpXmuxSettings,
} from './connection-profile.types';

export const XHTTP_MIN_XRAY_VERSION = [24, 11, 30] as const;
export const XHTTP_XMUX_MIN_XRAY_VERSION = [25, 1, 30] as const;
export const SELF_SNI_MIN_XRAY_VERSION = [1, 8, 0] as const;

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const XMUX_RANGE_PATTERN = /^(\d+)(?:-(\d+))?$/;

export interface ProfileCatalogEntry {
  kind: ManagedProfileKind;
  stage: 1 | 2 | 3;
  status: 'ready' | 'planned';
  title: string;
  transportSummary: string;
  description: string;
  minXrayVersion: string;
  defaults: ManagedProfileSettings;
}

export const PROFILE_CATALOG: readonly ProfileCatalogEntry[] = [
  {
    kind: 'xhttp-stable',
    stage: 1,
    status: 'ready',
    title: 'XHTTP Stable',
    transportSummary: 'VLESS + XHTTP + REALITY',
    description:
      'Управляемый профиль XHTTP поверх REALITY с минимальной конфигурацией по умолчанию, выбором режима (auto / stream-one / packet-up), fingerprint и опциональным клиентским XMUX.',
    minXrayVersion: '24.11.30',
    defaults: {
      mode: 'auto',
      path: '/',
      fingerprint: 'chrome',
      spiderX: '/',
      rotationPolicy: 'fixed_domain',
      xmux: { enabled: false },
    },
  },
  {
    kind: 'self-sni',
    stage: 2,
    status: 'planned',
    title: 'Self-SNI',
    transportSummary: 'VLESS + RAW + REALITY + Vision',
    description:
      'Профиль на собственном домене и локальном HTTPS-сайте с проверкой сертификата и генерацией конфигов Nginx/Caddy.',
    minXrayVersion: '1.8.0',
    defaults: {
      fingerprint: 'chrome',
      spiderX: '/',
      destPort: 443,
      localHttpsPort: 8443,
      webServer: 'nginx',
      xver: 0,
      rotationPolicy: 'fixed_domain',
    },
  },
  {
    kind: 'https-fallback',
    stage: 3,
    status: 'planned',
    title: 'HTTPS Fallback',
    transportSummary: 'VLESS + XHTTP + TLS',
    description:
      'Независимый резервный профиль поверх TLS с собственным сертификатом, выделенным endpoint и поддержкой reverse proxy (Nginx/Caddy).',
    minXrayVersion: '24.11.30',
    defaults: {
      mode: 'auto',
      path: '/api/v2/stream',
      fingerprint: 'chrome',
      reverseProxy: 'none',
      publicPort: 443,
      rotationPolicy: 'fixed_domain',
    },
  },
];

export interface ProfileCompatibilityInput {
  kind: ManagedProfileKind;
  port?: number | string | null;
  sni?: string | null;
  settings?: ManagedProfileSettings | null;
  node?: {
    name?: string;
    version?: string;
    xrayVersion?: string;
    autoTlsCertificate?: boolean;
    healthStatus?: string;
  } | null;
  occupiedPorts?: number[];
  dnsResolvedIps?: string[];
  dnsError?: string;
  nodeResources?: {
    cpuPercent?: number;
    memPercent?: number;
    diskPercent?: number;
    xrayState?: string;
  };
}

export function parseSemver(version?: string): [number, number, number] | null {
  const match = version?.trim().match(/v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isVersionAtLeast(
  version: string | undefined,
  minimum: readonly [number, number, number],
): boolean {
  const parsed = parseSemver(version);
  if (!parsed) return false;
  for (let i = 0; i < minimum.length; i += 1) {
    if (parsed[i] !== minimum[i]) return parsed[i] > minimum[i];
  }
  return true;
}

export function normalizeXhttpPath(rawPath?: string): string {
  const trimmed = (rawPath ?? '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function isValidXhttpPath(rawPath?: string): boolean {
  const trimmed = (rawPath ?? '').trim();
  if (!trimmed) return true;
  if (trimmed.length > 256) return false;
  if (/[\s\r\n?#]/.test(trimmed)) return false;
  return /^\/[A-Za-z0-9._~:/@!$&'()*+,;=%-]*$/.test(
    trimmed.startsWith('/') ? trimmed : `/${trimmed}`,
  );
}

export function isValidHostname(host?: string | null): boolean {
  const value = (host ?? '').trim().toLowerCase();
  return Boolean(value) && HOSTNAME_PATTERN.test(value);
}

export function isValidXmuxRange(
  value: string | undefined,
  allowZero = false,
): boolean {
  if (value === undefined || value === '') return true;
  const match = XMUX_RANGE_PATTERN.exec(value.trim());
  if (!match) return false;
  const min = Number(match[1]);
  const max = match[2] !== undefined ? Number(match[2]) : min;
  if (!Number.isInteger(min) || !Number.isInteger(max)) return false;
  if (!allowZero && (min < 1 || max < 1)) return false;
  if (min < 0 || max < 0) return false;
  return min <= max && max <= 1_000_000;
}

export function normalizeXmuxSettings(
  xmux?: XhttpXmuxSettings | null,
): XhttpXmuxSettings | undefined {
  if (!xmux || xmux.enabled !== true) return undefined;
  const normalized: XhttpXmuxSettings = { enabled: true };
  const trimValue = (value?: string) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  const maxConcurrency = trimValue(xmux.maxConcurrency);
  const maxConnections = trimValue(xmux.maxConnections);
  const cMaxReuseTimes = trimValue(xmux.cMaxReuseTimes);
  const hMaxRequestTimes = trimValue(xmux.hMaxRequestTimes);
  const hMaxReusableSecs = trimValue(xmux.hMaxReusableSecs);

  if (maxConcurrency) normalized.maxConcurrency = maxConcurrency;
  if (maxConnections) normalized.maxConnections = maxConnections;
  if (cMaxReuseTimes) normalized.cMaxReuseTimes = cMaxReuseTimes;
  if (hMaxRequestTimes) normalized.hMaxRequestTimes = hMaxRequestTimes;
  if (hMaxReusableSecs) normalized.hMaxReusableSecs = hMaxReusableSecs;
  if (
    typeof xmux.hKeepAlivePeriod === 'number' &&
    Number.isInteger(xmux.hKeepAlivePeriod) &&
    xmux.hKeepAlivePeriod >= 0
  ) {
    normalized.hKeepAlivePeriod = xmux.hKeepAlivePeriod;
  }

  return normalized;
}

export function normalizeManagedProfileSettings(
  kind: ManagedProfileKind,
  settings?: ManagedProfileSettings | null,
): ManagedProfileSettings {
  const input = settings ?? {};
  const fingerprint: ClientFingerprint =
    input.fingerprint &&
    (CLIENT_FINGERPRINTS as readonly string[]).includes(input.fingerprint)
      ? input.fingerprint
      : 'chrome';
  const rotationPolicy =
    input.rotationPolicy &&
    (PROFILE_ROTATION_POLICIES as readonly string[]).includes(
      input.rotationPolicy,
    )
      ? input.rotationPolicy
      : 'fixed_domain';

  const monitoring = input.monitoring
    ? {
        ...(input.monitoring.probeEngine
          ? { probeEngine: input.monitoring.probeEngine }
          : {}),
        ...(input.monitoring.routingStrategy
          ? { routingStrategy: input.monitoring.routingStrategy }
          : {}),
        ...(input.monitoring.entryNodeId
          ? { entryNodeId: input.monitoring.entryNodeId }
          : {}),
        ...(input.monitoring.exitNodeId
          ? { exitNodeId: input.monitoring.exitNodeId }
          : {}),
        ...(input.monitoring.labels
          ? { labels: { ...input.monitoring.labels } }
          : {}),
      }
    : undefined;

  if (kind === 'xhttp-stable') {
    const mode: XhttpMode =
      input.mode && (XHTTP_MODES as readonly string[]).includes(input.mode)
        ? input.mode
        : 'auto';
    const xmux = normalizeXmuxSettings(input.xmux);
    return {
      mode,
      path: normalizeXhttpPath(input.path),
      ...(input.host?.trim() ? { host: input.host.trim() } : {}),
      fingerprint,
      spiderX: input.spiderX?.trim() || '/',
      ...(input.noGRPCHeader === true ? { noGRPCHeader: true } : {}),
      ...(xmux ? { xmux } : {}),
      rotationPolicy,
      ...(monitoring ? { monitoring } : {}),
    };
  }

  if (kind === 'self-sni') {
    return {
      ...(input.domain?.trim() ? { domain: input.domain.trim() } : {}),
      destPort: input.destPort ?? 443,
      localHttpsPort: input.localHttpsPort ?? 8443,
      webServer:
        input.webServer &&
        (REVERSE_PROXY_ENGINES as readonly string[]).includes(input.webServer)
          ? input.webServer
          : 'nginx',
      fingerprint,
      spiderX: input.spiderX?.trim() || '/',
      xver: input.xver ?? 0,
      rotationPolicy,
      ...(monitoring ? { monitoring } : {}),
    };
  }

  const mode: XhttpMode =
    input.mode && (XHTTP_MODES as readonly string[]).includes(input.mode)
      ? input.mode
      : 'auto';
  return {
    ...(input.domain?.trim() ? { domain: input.domain.trim() } : {}),
    mode,
    path: normalizeXhttpPath(input.path || '/api/v2/stream'),
    ...(input.host?.trim() ? { host: input.host.trim() } : {}),
    fingerprint,
    reverseProxy:
      input.reverseProxy &&
      (REVERSE_PROXY_ENGINES as readonly string[]).includes(input.reverseProxy)
        ? input.reverseProxy
        : 'none',
    publicPort: input.publicPort ?? 443,
    rotationPolicy,
    ...(monitoring ? { monitoring } : {}),
  };
}

export function validateManagedProfileSettings(
  kind: ManagedProfileKind,
  settings?: ManagedProfileSettings | null,
  context?: { sni?: string | null; port?: number | string | null },
): string[] {
  const errors: string[] = [];
  if (!(MANAGED_PROFILE_KINDS as readonly string[]).includes(kind)) {
    return [`Неизвестный тип профиля: ${String(kind)}`];
  }

  const input = settings ?? {};

  if (
    input.fingerprint &&
    !(CLIENT_FINGERPRINTS as readonly string[]).includes(input.fingerprint)
  ) {
    errors.push(`Неподдерживаемый TLS fingerprint: ${input.fingerprint}`);
  }

  if (
    input.rotationPolicy &&
    !(PROFILE_ROTATION_POLICIES as readonly string[]).includes(
      input.rotationPolicy,
    )
  ) {
    errors.push(`Неподдерживаемая политика ротации: ${input.rotationPolicy}`);
  }

  if (
    context?.port !== undefined &&
    context.port !== null &&
    context.port !== '' &&
    context.port !== 'random'
  ) {
    const numericPort = Number(context.port);
    if (
      !Number.isInteger(numericPort) ||
      numericPort < 1 ||
      numericPort > 65535
    ) {
      errors.push('Порт должен быть "random" или числом от 1 до 65535');
    }
  }

  if (kind === 'xhttp-stable' || kind === 'https-fallback') {
    if (
      input.mode &&
      !(XHTTP_MODES as readonly string[]).includes(input.mode)
    ) {
      errors.push(
        `Недопустимый режим XHTTP: ${input.mode} (ожидается auto, stream-one или packet-up)`,
      );
    }
    if (!isValidXhttpPath(input.path)) {
      errors.push(
        'Некорректный XHTTP path: путь не должен содержать пробелы, "?", "#" и управляющие символы',
      );
    }
    if (input.host?.trim() && !isValidHostname(input.host)) {
      errors.push('Некорректный XHTTP host: укажите валидное доменное имя');
    }
  }

  if (kind === 'xhttp-stable' && input.xmux?.enabled) {
    const x = input.xmux;
    if (x.maxConcurrency?.trim() && x.maxConnections?.trim()) {
      errors.push(
        'XMUX: параметры maxConcurrency и maxConnections взаимоисключающие в Xray-core — укажите только один из них',
      );
    }
    if (!isValidXmuxRange(x.maxConcurrency, false)) {
      errors.push('XMUX: некорректное значение maxConcurrency (пример: 16-32)');
    }
    if (!isValidXmuxRange(x.maxConnections, false)) {
      errors.push('XMUX: некорректное значение maxConnections (пример: 4-8)');
    }
    if (!isValidXmuxRange(x.cMaxReuseTimes, true)) {
      errors.push(
        'XMUX: некорректное значение cMaxReuseTimes (пример: 0 или 16-32)',
      );
    }
    if (!isValidXmuxRange(x.hMaxRequestTimes, false)) {
      errors.push(
        'XMUX: некорректное значение hMaxRequestTimes (пример: 600-900)',
      );
    }
    if (!isValidXmuxRange(x.hMaxReusableSecs, false)) {
      errors.push(
        'XMUX: некорректное значение hMaxReusableSecs (пример: 1800-3000)',
      );
    }
    if (
      x.hKeepAlivePeriod !== undefined &&
      (!Number.isInteger(x.hKeepAlivePeriod) ||
        x.hKeepAlivePeriod < 0 ||
        x.hKeepAlivePeriod > 3600)
    ) {
      errors.push(
        'XMUX: hKeepAlivePeriod должен быть целым числом от 0 до 3600',
      );
    }
  }

  if (kind === 'self-sni') {
    const domain =
      input.domain?.trim() ||
      (context?.sni !== 'random' ? context?.sni?.trim() : '');
    if (domain && !isValidHostname(domain)) {
      errors.push('Self-SNI требует валидный собственный домен');
    }
    if (
      input.localHttpsPort !== undefined &&
      (!Number.isInteger(input.localHttpsPort) ||
        input.localHttpsPort < 1 ||
        input.localHttpsPort > 65535)
    ) {
      errors.push('Self-SNI: локальный HTTPS-порт должен быть от 1 до 65535');
    }
  }

  if (kind === 'https-fallback') {
    const domain =
      input.domain?.trim() ||
      (context?.sni !== 'random' ? context?.sni?.trim() : '');
    if (domain && !isValidHostname(domain)) {
      errors.push('HTTPS Fallback требует валидный домен для TLS-сертификата');
    }
  }

  return errors;
}

export function evaluateProfileCompatibility(
  input: ProfileCompatibilityInput,
): ProfileCompatibilityReport {
  const checks: ProfileCompatibilityItem[] = [];
  const normalized = normalizeManagedProfileSettings(
    input.kind,
    input.settings,
  );
  const validationErrors = validateManagedProfileSettings(
    input.kind,
    input.settings,
    { sni: input.sni, port: input.port },
  );

  for (const [index, message] of validationErrors.entries()) {
    checks.push({
      code: `VALIDATION_${index + 1}`,
      severity: 'error',
      title: 'Некорректные параметры профиля',
      message,
    });
  }

  if (validationErrors.length === 0) {
    checks.push({
      code: 'SCHEMA_OK',
      severity: 'ok',
      title: 'Схема профиля валидна',
      message: `Параметры профиля ${input.kind} прошли проверку корректности.`,
    });
  }

  // Xray version compatibility
  const xrayVersion = input.node?.xrayVersion;
  if (input.kind === 'xhttp-stable') {
    const needsXmuxOrStreamOne =
      normalized.xmux?.enabled === true || normalized.mode === 'stream-one';
    const minVersion = needsXmuxOrStreamOne
      ? XHTTP_XMUX_MIN_XRAY_VERSION
      : XHTTP_MIN_XRAY_VERSION;
    const minLabel = minVersion.join('.');

    if (!input.node) {
      checks.push({
        code: 'NODE_NOT_SELECTED',
        severity: 'warning',
        title: 'Нода не выбрана',
        message: `Выберите ноду для проверки совместимости Xray (требуется >= ${minLabel}).`,
      });
    } else if (!xrayVersion) {
      checks.push({
        code: 'XRAY_VERSION_UNKNOWN',
        severity: 'warning',
        title: 'Версия Xray не определена',
        message: `Выполните проверку подключения ноды «${input.node.name || 'node'}», чтобы подтвердить Xray >= ${minLabel}.`,
      });
    } else if (!isVersionAtLeast(xrayVersion, minVersion)) {
      checks.push({
        code: 'XRAY_VERSION_TOO_OLD',
        severity: 'error',
        title: 'Несовместимая версия Xray',
        message: `Нода «${input.node.name || 'node'}» использует Xray ${xrayVersion}, а для выбранного режима XHTTP требуется >= ${minLabel}.`,
      });
    } else {
      checks.push({
        code: 'XRAY_VERSION_OK',
        severity: 'ok',
        title: 'Версия Xray совместима',
        message: `Xray ${xrayVersion} поддерживает XHTTP (${normalized.mode})${normalized.xmux?.enabled ? ' и клиентский XMUX' : ''}.`,
      });
    }

    if (normalized.mode === 'packet-up' && normalized.xmux?.enabled) {
      checks.push({
        code: 'XHTTP_PACKET_UP_XMUX',
        severity: 'warning',
        title: 'XMUX в режиме packet-up',
        message:
          'В режиме packet-up используйте умеренные значения XMUX; минимальная конфигурация без XMUX предпочтительна по умолчанию.',
      });
    }

    if (input.sni && input.sni !== 'random' && !isValidHostname(input.sni)) {
      checks.push({
        code: 'INVALID_SNI',
        severity: 'error',
        title: 'Некорректный SNI',
        message: `SNI «${input.sni}» не является корректным доменным именем.`,
      });
    }
  } else if (input.kind === 'self-sni') {
    const domain =
      normalized.domain ||
      (input.sni && input.sni !== 'random' ? input.sni : '');
    if (!domain) {
      checks.push({
        code: 'SELF_SNI_DOMAIN_REQUIRED',
        severity: 'error',
        title: 'Требуется собственный домен',
        message:
          'Для Self-SNI необходимо указать собственный домен (случайный SNI не допускается).',
      });
    }
    if (
      input.node &&
      xrayVersion &&
      !isVersionAtLeast(xrayVersion, SELF_SNI_MIN_XRAY_VERSION)
    ) {
      checks.push({
        code: 'XRAY_VERSION_TOO_OLD',
        severity: 'error',
        title: 'Несовместимая версия Xray',
        message: `Xray ${xrayVersion} слишком стар для REALITY + Vision (требуется >= 1.8.0).`,
      });
    }
    checks.push({
      code: 'STAGE_2_DEPLOYMENT',
      severity: 'warning',
      title: 'Профиль доступен в Этапе 2',
      message:
        'Модель и проверки Self-SNI готовы; генерация конфигов Nginx/Caddy и развёртывание локального HTTPS-сайта активируются на Этапе 2.',
    });
  } else if (input.kind === 'https-fallback') {
    const domain =
      normalized.domain ||
      (input.sni && input.sni !== 'random' ? input.sni : '');
    if (!domain) {
      checks.push({
        code: 'FALLBACK_DOMAIN_REQUIRED',
        severity: 'error',
        title: 'Требуется домен сертификата',
        message:
          'Для HTTPS Fallback необходимо указать домен с действующим TLS-сертификатом.',
      });
    }
    if (normalized.path === '/') {
      checks.push({
        code: 'FALLBACK_ROOT_PATH_WARN',
        severity: 'warning',
        title: 'Используется корневой путь /',
        message:
          'Для HTTPS Fallback рекомендуется выделить отдельный endpoint (например, /api/v2/stream).',
      });
    }
    if (
      input.node &&
      xrayVersion &&
      !isVersionAtLeast(xrayVersion, XHTTP_MIN_XRAY_VERSION)
    ) {
      checks.push({
        code: 'XRAY_VERSION_TOO_OLD',
        severity: 'error',
        title: 'Несовместимая версия Xray',
        message: `Для HTTPS Fallback (VLESS + XHTTP + TLS) требуется Xray >= 24.11.30 (текущая: ${xrayVersion}).`,
      });
    }
    checks.push({
      code: 'STAGE_3_DEPLOYMENT',
      severity: 'warning',
      title: 'Профиль доступен в Этапе 3',
      message:
        'Модель и проверки HTTPS Fallback готовы; генератор reverse proxy (Nginx/Caddy) и независимое развёртывание активируются на Этапе 3.',
    });
  }

  // Port conflict check against live 3x-ui inbounds
  if (
    input.port !== undefined &&
    input.port !== null &&
    input.port !== '' &&
    input.port !== 'random' &&
    Array.isArray(input.occupiedPorts)
  ) {
    const portNum = Number(input.port);
    if (Number.isInteger(portNum) && input.occupiedPorts.includes(portNum)) {
      checks.push({
        code: 'PORT_OCCUPIED',
        severity: 'error',
        title: `Порт ${portNum} уже занят в 3x-ui`,
        message: `На выбранной ноде порт ${portNum} уже используется другим inbound. Выберите свободный порт или random.`,
      });
    } else if (Number.isInteger(portNum)) {
      checks.push({
        code: 'PORT_FREE',
        severity: 'ok',
        title: `Порт ${portNum} свободен в 3x-ui`,
        message: `Конфликтов порта ${portNum} среди текущих inbound панели не обнаружено.`,
      });
    }
  }

  // DNS resolution check (when performed)
  if (input.dnsError) {
    checks.push({
      code: 'DNS_LOOKUP_FAILED',
      severity: input.kind === 'xhttp-stable' ? 'warning' : 'error',
      title: 'Ошибка DNS-проверки домена',
      message: input.dnsError,
    });
  } else if (input.dnsResolvedIps && input.dnsResolvedIps.length > 0) {
    checks.push({
      code: 'DNS_RESOLVED',
      severity: 'ok',
      title: 'DNS-запись домена подтверждена',
      message: `Домен разрешается в: ${input.dnsResolvedIps.slice(0, 4).join(', ')}.`,
    });
  }

  // Node resource checks (from /panel/api/server/status)
  if (input.nodeResources) {
    const { cpuPercent, memPercent, diskPercent, xrayState } =
      input.nodeResources;
    if (xrayState && xrayState !== 'running') {
      checks.push({
        code: 'XRAY_NOT_RUNNING',
        severity: 'error',
        title: 'Xray на ноде не запущен',
        message: `Текущее состояние Xray: ${xrayState}.`,
      });
    }
    if (typeof diskPercent === 'number' && diskPercent >= 90) {
      checks.push({
        code: 'NODE_DISK_HIGH',
        severity: 'error',
        title: 'Критически мало места на диске ноды',
        message: `Диск ноды заполнен на ${Math.round(diskPercent)}%. Освободите место перед применением.`,
      });
    }
    if (typeof memPercent === 'number' && memPercent >= 90) {
      checks.push({
        code: 'NODE_MEM_HIGH',
        severity: 'warning',
        title: 'Высокое потребление RAM на ноде',
        message: `Использование памяти: ${Math.round(memPercent)}%.`,
      });
    }
    if (typeof cpuPercent === 'number' && cpuPercent >= 95) {
      checks.push({
        code: 'NODE_CPU_HIGH',
        severity: 'warning',
        title: 'Высокая загрузка CPU на ноде',
        message: `Загрузка CPU: ${Math.round(cpuPercent)}%.`,
      });
    }
  }

  const hasError = checks.some((item) => item.severity === 'error');
  const hasWarning = checks.some((item) => item.severity === 'warning');
  return {
    compatible: !hasError,
    status: hasError ? 'failed' : hasWarning ? 'warning' : 'passed',
    checks,
  };
}
