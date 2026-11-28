export const DEFAULT_FORWARDING_PORTS = '443,8443,10000:60000';

const PORT_TOKEN_PATTERN = /^(\d{1,5})(?:\s*:\s*(\d{1,5}))?$/;
const ENV_SAFE_PORT_LIST_PATTERN = /^[0-9,:]*$/;

/**
 * Validates and canonicalizes a comma-separated list of ports and ranges (`443,8443,10000:60000`).
 * Returns `undefined` when omitted, `""` when explicitly blank, or throws on invalid syntax.
 */
export function normalizeForwardingPortSpec(
  raw?: string | null,
): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    throw new Error('Порты перенаправления должны быть строкой');
  }
  if (/[\r\n]/.test(raw)) {
    throw new Error('Некорректный список портов перенаправления');
  }
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const parts = trimmed.split(',');
  const normalized: string[] = [];
  for (const part of parts) {
    const token = part.trim();
    const match = token.match(PORT_TOKEN_PATTERN);
    if (!match) {
      throw new Error(`Некорректный порт или диапазон: "${token}"`);
    }
    const first = Number(match[1]);
    const last = match[2] !== undefined ? Number(match[2]) : first;
    if (
      !Number.isInteger(first) ||
      !Number.isInteger(last) ||
      first < 1 ||
      first > last ||
      last > 65535
    ) {
      throw new Error(`Недопустимый диапазон портов: "${token}"`);
    }
    normalized.push(first === last ? String(first) : `${first}:${last}`);
  }

  return normalized.join(',');
}

export function isValidForwardingPortSpec(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    normalizeForwardingPortSpec(value);
    return true;
  } catch {
    return false;
  }
}

export function isEnvSafePortSpec(value: string): boolean {
  return ENV_SAFE_PORT_LIST_PATTERN.test(value);
}
