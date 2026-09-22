const FAKE_TLS_DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function normalizeFakeTlsDomain(domain: string) {
  return domain.trim().toLowerCase();
}

export function isValidFakeTlsDomain(domain: string) {
  return FAKE_TLS_DOMAIN_PATTERN.test(normalizeFakeTlsDomain(domain));
}
