/**
 * Formats a recognizable client email/identifier for 3x-ui inbounds:
 * `<SubscriptionName>-<shortHash>` (e.g. `Sai-0939535c`).
 *
 * If subscriptionName is missing, empty, or consists only of invalid characters,
 * falls back to the shortHash (`0939535c`).
 */
export function formatClientEmail(
  subscriptionName: string | undefined | null,
  uuid: string,
): string {
  const shortHash = uuid.includes('-') ? uuid.split('-')[0] : uuid.slice(0, 8);
  if (!subscriptionName || !subscriptionName.trim()) {
    return shortHash;
  }

  const cleanPrefix = subscriptionName
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!cleanPrefix) {
    return shortHash;
  }

  const truncatedPrefix = Array.from(cleanPrefix)
    .slice(0, 32)
    .join('')
    .replace(/-+$/g, '');

  if (!truncatedPrefix) {
    return shortHash;
  }

  return `${truncatedPrefix}-${shortHash}`;
}
