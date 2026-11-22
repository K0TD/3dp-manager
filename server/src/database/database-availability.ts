export type DatabaseErrorKind = 'disk_full' | 'recovery' | 'connection';

export interface DatabaseErrorInfo {
  kind: DatabaseErrorKind;
  code: string;
  message: string;
  detail?: string;
}

export interface DatabaseLogger {
  error(message: string, stack?: string): void;
  warn(message: string): void;
  log(message: string): void;
}

export interface ClassifyDatabaseErrorOptions {
  /**
   * In strict mode (e.g. HTTP exception filter), generic socket errors such as
   * ECONNRESET/ECONNREFUSED are only classified as DB outages when they carry
   * TypeORM/pg markers or when `allowSocketErrors` is explicitly enabled.
   */
  strict?: boolean;
  allowSocketErrors?: boolean;
}

export interface RecordFailureOptions extends ClassifyDatabaseErrorOptions {
  activateBackoff?: boolean;
}

export interface DatabaseAvailabilityOptions {
  baseBackoffMs?: number;
  diskFullBackoffMs?: number;
  maxBackoffMs?: number;
  logIntervalMs?: number;
  now?: () => number;
}

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  errno?: unknown;
  message?: unknown;
  detail?: unknown;
  stack?: unknown;
  isAxiosError?: unknown;
  driverError?: unknown;
  cause?: unknown;
  errors?: unknown;
}

const PG_RECOVERY_CODES = new Set(['57P01', '57P02', '57P03']);
const PG_RESOURCE_CONNECTION_CODES = new Set(['53200', '53300', '53400']);
const SOCKET_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
]);

const DISK_FULL_PATTERN =
  /no space left on device|could not write init file|could not extend file/i;
const RECOVERY_MESSAGE_PATTERN =
  /the database system is (not yet accepting connections|in recovery mode|starting up|shutting down)|terminating connection due to administrator command/i;
const PG_CONNECTION_MESSAGE_PATTERN =
  /connection terminated unexpectedly|timeout exceeded when trying to connect|client has encountered a connection error|cannot use a pool after calling end|too many clients already/i;
const DB_STACK_PATTERN =
  /pg-protocol|pg-pool|node_modules[\\/]+pg[\\/]|typeorm/i;

function asErrorLike(value: unknown): ErrorLike | null {
  return typeof value === 'object' && value !== null
    ? (value as ErrorLike)
    : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function collectCandidates(error: unknown): ErrorLike[] {
  const result: ErrorLike[] = [];
  const seen = new Set<unknown>();
  const queue: Array<{ value: unknown; depth: number }> = [
    { value: error, depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > 4) continue;
    const obj = asErrorLike(current.value);
    if (!obj || seen.has(obj)) continue;
    seen.add(obj);
    result.push(obj);

    if (obj.driverError) {
      queue.push({ value: obj.driverError, depth: current.depth + 1 });
    }
    if (obj.cause) {
      queue.push({ value: obj.cause, depth: current.depth + 1 });
    }
    if (Array.isArray(obj.errors)) {
      for (const nested of obj.errors) {
        queue.push({ value: nested, depth: current.depth + 1 });
      }
    }
  }

  return result;
}

export function formatUnknownError(
  error: unknown,
  fallback = 'Unknown error',
): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  const obj = asErrorLike(error);
  const message = obj ? asNonEmptyString(obj.message) : undefined;
  return message ?? fallback;
}

export function classifyDatabaseError(
  error: unknown,
  options: ClassifyDatabaseErrorOptions = {},
): DatabaseErrorInfo | null {
  const candidates = collectCandidates(error);
  if (candidates.length === 0) return null;

  // Never misclassify Axios HTTP errors to remote 3x-ui panels as PostgreSQL failures.
  if (candidates.some((item) => item.isAxiosError === true)) {
    return null;
  }

  const hasDbMarker = candidates.some((item) => {
    const name = asNonEmptyString(item.name) ?? '';
    const stack = asNonEmptyString(item.stack) ?? '';
    return (
      name === 'QueryFailedError' ||
      name === 'TypeORMError' ||
      name === 'DatabaseError' ||
      Boolean(item.driverError) ||
      DB_STACK_PATTERN.test(stack)
    );
  });

  const allowSockets =
    options.allowSocketErrors ?? (options.strict ? hasDbMarker : true);

  for (const item of candidates) {
    const code = asNonEmptyString(item.code);
    const message = asNonEmptyString(item.message) ?? '';
    const detail = asNonEmptyString(item.detail);

    if (
      code === '53100' ||
      code === 'ENOSPC' ||
      DISK_FULL_PATTERN.test(message)
    ) {
      return {
        kind: 'disk_full',
        code: code ?? '53100',
        message: message || 'No space left on device',
        detail,
      };
    }

    if (
      (code && PG_RECOVERY_CODES.has(code)) ||
      RECOVERY_MESSAGE_PATTERN.test(message)
    ) {
      return {
        kind: 'recovery',
        code: code ?? '57P03',
        message: message || 'Database system is not yet accepting connections',
        detail,
      };
    }

    if (
      (code &&
        (code.startsWith('08') || PG_RESOURCE_CONNECTION_CODES.has(code))) ||
      PG_CONNECTION_MESSAGE_PATTERN.test(message)
    ) {
      return {
        kind: 'connection',
        code: code ?? '08006',
        message: message || 'Database connection error',
        detail,
      };
    }
  }

  if (allowSockets || hasDbMarker) {
    for (const item of candidates) {
      const code = asNonEmptyString(item.code);
      const message = asNonEmptyString(item.message) ?? '';
      if (code && SOCKET_ERROR_CODES.has(code)) {
        return {
          kind: 'connection',
          code,
          message: message || `Database socket error (${code})`,
        };
      }
    }
  }

  return null;
}

export class DatabaseAvailabilityTracker {
  private readonly baseBackoffMs: number;
  private readonly diskFullBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly logIntervalMs: number;
  private readonly now: () => number;

  private consecutiveFailures = 0;
  private degradedSinceMs: number | null = null;
  private backoffUntilMs = 0;
  private lastLoggedAtMs = 0;
  private lastLoggedSignature = '';
  private suppressedLogs = 0;

  constructor(options: DatabaseAvailabilityOptions = {}) {
    this.baseBackoffMs = options.baseBackoffMs ?? 5_000;
    this.diskFullBackoffMs = options.diskFullBackoffMs ?? 30_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.logIntervalMs = options.logIntervalMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  shouldSkip(now = this.now()): boolean {
    return now < this.backoffUntilMs;
  }

  isDegraded(): boolean {
    return this.consecutiveFailures > 0;
  }

  recordSuccess(logger?: DatabaseLogger, source = 'Database'): void {
    if (this.consecutiveFailures === 0) return;

    const now = this.now();
    const durationSec = this.degradedSinceMs
      ? Math.max(1, Math.round((now - this.degradedSinceMs) / 1000))
      : 0;
    const failures = this.consecutiveFailures;
    const suppressed = this.suppressedLogs;

    this.reset();

    if (logger) {
      const suffix =
        suppressed > 0 ? ` (${suppressed} duplicate errors suppressed)` : '';
      logger.log(
        `[${source}] PostgreSQL connection restored after ${durationSec}s (${failures} failed checks)${suffix}. Resuming background tasks.`,
      );
    }
  }

  recordFailure(
    error: unknown,
    logger: DatabaseLogger,
    source: string,
    options: RecordFailureOptions = {},
  ): DatabaseErrorInfo | null {
    const info = classifyDatabaseError(error, options);
    if (!info) return null;

    const now = this.now();
    this.consecutiveFailures += 1;
    if (this.degradedSinceMs === null) {
      this.degradedSinceMs = now;
    }

    const baseDelay =
      info.kind === 'disk_full' ? this.diskFullBackoffMs : this.baseBackoffMs;
    const exponent = Math.min(this.consecutiveFailures - 1, 6);
    const delayMs = Math.min(baseDelay * 2 ** exponent, this.maxBackoffMs);

    if (options.activateBackoff !== false) {
      this.backoffUntilMs = Math.max(this.backoffUntilMs, now + delayMs);
    }

    const signature = `${info.kind}:${info.code}:${info.message}`;
    const shouldEmit =
      this.lastLoggedAtMs === 0 ||
      signature !== this.lastLoggedSignature ||
      now - this.lastLoggedAtMs >= this.logIntervalMs;

    if (shouldEmit) {
      const suppressedSuffix =
        this.suppressedLogs > 0
          ? ` (+${this.suppressedLogs} similar errors suppressed)`
          : '';
      this.suppressedLogs = 0;
      this.lastLoggedAtMs = now;
      this.lastLoggedSignature = signature;

      const detailSuffix = info.detail ? ` (${info.detail})` : '';
      const pauseSeconds = Math.max(1, Math.round(delayMs / 1000));
      const hint =
        info.kind === 'disk_full'
          ? 'PostgreSQL out of disk space — free disk space so PostgreSQL can recover.'
          : 'PostgreSQL unavailable.';

      logger.error(
        `[${source}] ${hint} [${info.code}]: ${info.message}${detailSuffix}. Background DB polling paused for ${pauseSeconds}s${suppressedSuffix}.`,
      );
    } else {
      this.suppressedLogs += 1;
    }

    return info;
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.degradedSinceMs = null;
    this.backoffUntilMs = 0;
    this.lastLoggedAtMs = 0;
    this.lastLoggedSignature = '';
    this.suppressedLogs = 0;
  }
}

export const databaseAvailability = new DatabaseAvailabilityTracker();
