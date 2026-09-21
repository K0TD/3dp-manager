import { createBackupEnvelope, openBackupEnvelope } from 'src/backup/backup.crypto';

describe('portable backup crypto', () => {
  const dump = Buffer.from('postgres custom dump bytes');

  it('round-trips an encrypted dump without exposing plaintext', () => {
    const envelope = createBackupEnvelope(dump, '3.0.0', 'correct horse battery staple');

    expect(envelope.encrypted).toBe(true);
    expect(envelope.payload).not.toContain(dump.toString('base64'));
    expect(openBackupEnvelope(envelope, 'correct horse battery staple')).toEqual(dump);
  });

  it('rejects a wrong passphrase', () => {
    const envelope = createBackupEnvelope(dump, '3.0.0', 'correct-passphrase');

    expect(() => openBackupEnvelope(envelope, 'wrong-passphrase')).toThrow();
  });

  it('detects corruption in an unencrypted archive', () => {
    const envelope = createBackupEnvelope(dump, '3.0.0');
    envelope.payload = Buffer.from('tampered').toString('base64');

    expect(() => openBackupEnvelope(envelope)).toThrow('Backup checksum mismatch');
  });
});
