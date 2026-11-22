export const SNI_EXCLUSIONS = [
  {
    domain: 'speedtest.net',
    verifiedOn: '2026-11-22',
    source: 'https://www.interfax.ru/digital/1038766',
  },
] as const;

export function isExcludedSniDomain(value: string) {
  const domain = value.toLowerCase().replace(/\.$/, '');
  return SNI_EXCLUSIONS.some(
    (entry) => domain === entry.domain || domain.endsWith('.' + entry.domain),
  );
}
