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
