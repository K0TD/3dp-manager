const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function amneziaConfigFileName(
  subscriptionName: string,
  configIndex: number,
  configCount: number,
): string {
  const normalizedName = subscriptionName
    .normalize('NFKC')
    .replace(/\p{Cc}/gu, '-')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  const safeName = normalizedName || 'subscription';
  const portableName = RESERVED_WINDOWS_NAMES.test(safeName)
    ? `subscription-${safeName}`
    : safeName;
  const suffix = configCount > 1 ? `-${configIndex + 1}` : '';
  const truncatedName = Array.from(portableName)
    .slice(0, 80 - suffix.length)
    .join('');
  return `${truncatedName}${suffix}.conf`;
}

export function attachmentDisposition(fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="amneziawg.conf"; filename*=UTF-8''${encodedFileName}`;
}
