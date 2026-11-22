export type OperationErrorStage =
  | 'login'
  | 'create'
  | 'delete'
  | 'cleanup'
  | 'preflight'
  | 'verify'
  | 'ssh'
  | 'rotation';

export interface OperationErrorDetails {
  title: string;
  hint: string;
  code: string;
  stage: OperationErrorStage;
  node?: string;
  inboundType?: string;
  port?: number;
  raw: string;
}

export interface OperationErrorContext {
  node?: string;
  inboundType?: string;
  port?: number;
  stage?: OperationErrorStage;
  panelRejected?: boolean;
}

/** Strip credentials before persisting or returning technical error details. */
export function redactOperationError(value: unknown, maxLength = 2048): string {
  const message =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.message
        : 'Неизвестная ошибка';
  // An escaped JSON document may contain further escaped strings at arbitrary
  // nesting depths. Once an escaped credential key is found, discard the
  // remainder instead of trying to parse potentially malformed panel output.
  const escapedCredential =
    /\\+["'](?:password|passwd|pwd|token|secret|private[_-]?key|authorization|cookie|session|api[_-]?key|client[_-]?id|uuid|id)\\+["']\s*[:=]/i.exec(
      message,
    );
  const safeInput = escapedCredential
    ? `${message.slice(0, escapedCredential.index)}[скрыто]`
    : message;
  return safeInput
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/gi,
      '[скрытый ключ]',
    )
    .replace(
      /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/gi,
      '[скрытый заголовок]',
    )
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [скрыто]')
    .replace(
      /(["']?\b(?:password|passwd|pwd|token|secret|private[_-]?key|authorization|cookie|session|api[_-]?key|client[_-]?id|uuid|id)["']?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,
      '$1[скрыто]',
    )
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[ссылка скрыта]')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '[UUID скрыт]',
    )
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, '[скрыто]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, maxLength);
}

export function normalizeOperationError(
  error: unknown,
  context: OperationErrorContext = {},
): OperationErrorDetails {
  const raw = redactOperationError(error);
  const node = context.node
    ? redactOperationError(context.node, 150)
    : undefined;
  const inboundType = context.inboundType
    ? redactOperationError(context.inboundType, 100)
    : undefined;
  const port =
    Number.isInteger(context.port) && context.port >= 1 && context.port <= 65535
      ? context.port
      : undefined;
  let stage = context.stage || 'rotation';
  const target = node ? `Нода «${node}»` : 'Нода';
  const connection = inboundType ? ` ${inboundType}` : ' подключения';
  const portLabel = port ? ` на порту ${port}` : '';
  let title: string;
  let hint: string;
  let code: string;
  if (/Canary-проверка профиля/i.test(raw)) {
    code = 'CANARY_PROBE_FAILED';
    stage = 'verify';
    const hasSelfSni = /\(self-sni\)/i.test(raw);
    const hasHttpsFallback = /\(https-fallback\)/i.test(raw);
    const hasXhttpStable = /\(xhttp-stable\)/i.test(raw);
    const failedKindCount = [
      hasSelfSni,
      hasHttpsFallback,
      hasXhttpStable,
    ].filter(Boolean).length;
    title = `Canary-проверка${connection}${portLabel} не пройдена — выполнен автооткат`;
    if (failedKindCount > 1) {
      hint =
        'Несколько профилей одновременно не прошли canary-проверку. Проверьте статус Xray в 3x-ui (нет ли ошибки перезапуска), firewall ноды/провайдера и исходящий доступ с ноды до проверочного URL. Для Self-SNI дополнительно требуется работающий локальный HTTPS-сайт на 127.0.0.1:<localHttpsPort>.';
    } else if (inboundType === 'self-sni' || hasSelfSni) {
      hint =
        'Для Self-SNI убедитесь, что порт Xray (обычно 443/tcp) открыт в firewall ноды, а на 127.0.0.1:<localHttpsPort> запущен локальный HTTPS-сайт (Nginx/Caddy) с TLS 1.3 и валидным сертификатом домена.';
    } else if (inboundType === 'https-fallback' || hasHttpsFallback) {
      hint =
        'Для HTTPS Fallback проверьте открытость порта, совпадение endpoint path, валидность TLS-сертификата и настройки reverse proxy: для Nginx используйте grpc_pass (HTTP/2 h2c) для auto/stream-one (либо mode=packet-up + proxy_buffering off при proxy_pass), для Caddy — versions h2c 1.1 и flush_interval -1.';
    } else {
      hint =
        'Проверьте открытость порта в firewall ноды, совпадение SNI, Host, Path и режима XHTTP в клиенте и на сервере, после этого проверьте исходящий доступ.';
    }
  } else if (/неоднозначная связь.*configId/i.test(raw)) {
    code = 'AMBIGUOUS_CONFIG';
    title = 'Не удалось определить предыдущий инбаунд';
    hint = 'Проверьте связь конфигурации с действующим инбаундом.';
  } else if (/не предоставила сертификат|TLS-конфигурация/i.test(raw)) {
    code = 'TLS_CERTIFICATE_UNAVAILABLE';
    title = 'Сертификат ноды недоступен';
    hint = 'Проверьте настройки TLS и сертификат ноды в 3x-ui.';
  } else if (/не сохранила SNI, Host, Path/i.test(raw)) {
    code = 'XHTTP_CONFIG_MISMATCH';
    title = '3x-ui сохранила другие параметры XHTTP';
    hint = 'Сверьте SNI, Host, Path и режим XHTTP с текущей конфигурацией панели.';
    stage = 'verify';
  } else if (/csrf/i.test(raw)) {
    code = 'CSRF_FAILED';
    title = 'Панель отклонила защитный токен CSRF';
    hint = 'Проверьте адрес панели и авторизацию, затем повторите операцию.';
    stage = 'login';
  } else if (stage === 'ssh' || /ssh/i.test(raw)) {
    stage = 'ssh';
    if (/timeout|timed out|ETIMEDOUT/i.test(raw)) {
      code = 'SSH_TIMEOUT';
      title = 'Истекло время ожидания SSH';
      hint = 'Проверьте доступность SSH и выполнение команды на сервере.';
    } else {
      code = 'SSH_FAILED';
      title = 'Ошибка SSH';
      hint = 'Проверьте доступность SSH, учётные данные и вывод команды.';
    }
  } else if (/ECONNREFUSED/i.test(raw)) {
    code = 'ECONNREFUSED';
    title = `${target} недоступна: соединение отклонено (ECONNREFUSED)`;
    hint = 'Проверьте, запущена ли 3x-ui и верен ли порт панели.';
  } else if (/ENOTFOUND|EAI_AGAIN|(?:getaddrinfo|dns).*not found/i.test(raw)) {
    code = 'DNS_FAILED';
    title = `${target} недоступна: не удалось разрешить имя`;
    hint = 'Проверьте адрес панели и настройки DNS.';
  } else if (/ECONNRESET|socket hang up/i.test(raw)) {
    code = 'ECONNRESET';
    title = `${target} разорвала соединение (ECONNRESET)`;
    hint = 'Проверьте панель, прокси и сетевое соединение.';
  } else if (
    /ETIMEDOUT|ECONNABORTED|timeout|timed out|aborted|aborterror|превышено время/i.test(
      raw,
    )
  ) {
    code = 'TIMEOUT';
    title = `${target} не ответила вовремя`;
    hint = 'Проверьте доступность панели и сетевое соединение.';
  } else if (
    /\b401\b|authentication was rejected|credentials are missing|api token is missing/i.test(
      raw,
    )
  ) {
    code = 'PANEL_AUTH_FAILED';
    title = 'Не удалось авторизоваться в панели 3x-ui';
    hint = 'Проверьте логин, пароль или API-токен ноды.';
    stage = 'login';
  } else if (/\b403\b/i.test(raw)) {
    code = 'PANEL_FORBIDDEN';
    title = 'Панель 3x-ui запретила запрос';
    hint = 'Проверьте права учётной записи и настройки доступа панели.';
  } else if (/\b404\b/i.test(raw)) {
    code = 'PANEL_NOT_FOUND';
    title = 'Панель 3x-ui не нашла запрошенный адрес';
    hint = 'Проверьте URL панели, её базовый путь и версию.';
  } else if (
    /address already in use|port.*(?:exists|in use|already used|occupied|conflict|overlap)|порт.*(?:занят|использ|существ)/i.test(
      raw,
    )
  ) {
    code = 'PORT_CONFLICT';
    title = `Панель отклонила создание${connection}${portLabel}: порт уже занят`;
    hint = 'Выберите другой порт или освободите его.';
  } else if (
    /duplicate tag|duplicated tag|tag.*(?:already exists|duplicate)|повторяющ.*tag/i.test(
      raw,
    )
  ) {
    code = 'DUPLICATE_TAG';
    title = 'В Xray уже существует такой тег подключения';
    hint = 'Проверьте и устраните дублирующийся тег в конфигурации панели.';
  } else if (
    /cannot unmarshal|json:.*unmarshal|go struct unmarshal/i.test(raw)
  ) {
    code = 'PANEL_INVALID_PAYLOAD';
    title = 'Панель не смогла прочитать параметры подключения';
    hint = 'Проверьте совместимость версии 3x-ui и параметров подключения.';
  } else if (/\b5\d\d\b/.test(raw)) {
    code = 'PANEL_SERVER_ERROR';
    title = 'Ошибка сервера панели 3x-ui';
    hint = 'Проверьте состояние и журнал панели 3x-ui.';
  } else if (
    /node is unreachable|нода.*(?:недоступна|не найдена)|для конфигурации не назначена нода/i.test(
      raw,
    )
  ) {
    code = 'NODE_UNAVAILABLE';
    title = `${target} недоступна`;
    hint = 'Проверьте адрес, состояние и сетевую доступность ноды.';
  } else if (/failed to delete inbound|не удалось удалить инбаунд/i.test(raw)) {
    code = 'INBOUND_DELETE_FAILED';
    title = `Не удалось удалить подключение${inboundType ? ` ${inboundType}` : ''}${portLabel}`;
    hint =
      'Проверьте доступность панели и удалите подключение в 3x-ui при необходимости.';
    stage = context.stage === 'cleanup' ? 'cleanup' : 'delete';
  } else if (
    context.panelRejected ||
    /отклонил|отклонила|panel rejected|3x-ui.*(?:failed|reject|HTTP 4\d\d)/i.test(
      raw,
    )
  ) {
    code = 'PANEL_REJECTED';
    title = `Панель отклонила операцию${inboundType ? ` для ${inboundType}` : ''}${portLabel}`;
    hint = 'Проверьте параметры подключения и подробности ответа панели.';
  } else {
    code = 'OPERATION_FAILED';
    title = 'Не удалось выполнить операцию';
    hint = 'Проверьте технические детали и журнал сервера.';
  }
  return {
    title,
    hint,
    code,
    stage,
    ...(node ? { node } : {}),
    ...(inboundType ? { inboundType } : {}),
    ...(port ? { port } : {}),
    raw,
  };
}
