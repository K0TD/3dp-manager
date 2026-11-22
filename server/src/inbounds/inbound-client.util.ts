export function extractInboundClientId(inbound: {
  clientProfileJson?: string | null;
  link?: string | null;
}): string | null {
  if (inbound.clientProfileJson) {
    try {
      const parsed = JSON.parse(inbound.clientProfileJson) as {
        uuid?: unknown;
      };
      if (typeof parsed?.uuid === 'string' && parsed.uuid.trim()) {
        return parsed.uuid.trim();
      }
    } catch {
      // Fall back to link parsing
    }
  }
  if (inbound.link && /^(?:vless|vmess|trojan):\/\//i.test(inbound.link)) {
    try {
      const parsed = new URL(inbound.link);
      const user = decodeURIComponent(parsed.username || '').trim();
      if (user) return user;
    } catch {
      // Ignore malformed links
    }
  }
  return null;
}
