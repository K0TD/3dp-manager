import { posix } from 'path';

export function isSafeAbsoluteRemotePath(remotePath: string) {
  return (
    remotePath.startsWith('/') &&
    remotePath.length <= 2048 &&
    !Array.from(remotePath).some((character) => {
      const codePoint = character.codePointAt(0) || 0;
      return codePoint < 32 || codePoint === 127;
    })
  );
}

// A managed certificate directory names its owner. Arbitrary custom filenames
// carry no such metadata and must be supplied explicitly by the administrator.
export function assertManagedCertificateHost(
  remotePath: string,
  serverName: string,
) {
  const managedDomain = posix
    .normalize(remotePath)
    .match(
      /^\/(?:etc\/letsencrypt\/(?:live|archive)|root\/cert)\/([^/]+)\//,
    )?.[1];
  const host = serverName.toLowerCase();
  if (
    managedDomain &&
    managedDomain.toLowerCase() !== host &&
    managedDomain.toLowerCase().replace(/-\d{4}$/, '') !== host
  ) {
    throw new Error(
      `TLS-сертификат «${remotePath}» относится к «${managedDomain}», а имя TLS-сервера — «${serverName}». Проверьте сертификат и домен выбранной ноды.`,
    );
  }
}
