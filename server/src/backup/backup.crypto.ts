import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'crypto';

const FORMAT = '3dp-backup-v1';

export interface BackupEnvelope {
  format: typeof FORMAT;
  encrypted: boolean;
  createdAt: string;
  appVersion: string;
  checksum: string;
  salt?: string;
  iv?: string;
  tag?: string;
  payload: string;
}

export function createBackupEnvelope(
  dump: Buffer,
  appVersion: string,
  passphrase?: string,
): BackupEnvelope {
  const checksum = createHash('sha256').update(dump).digest('hex');
  const base = {
    format: FORMAT,
    createdAt: new Date().toISOString(),
    appVersion,
    checksum,
  } as const;
  if (!passphrase) {
    return { ...base, encrypted: false, payload: dump.toString('base64') };
  }

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(dump), cipher.final()]);
  return {
    ...base,
    encrypted: true,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    payload: encrypted.toString('base64'),
  };
}

export function openBackupEnvelope(envelope: BackupEnvelope, passphrase?: string) {
  if (envelope.format !== FORMAT) throw new Error('Unsupported backup format');
  let dump: Buffer;
  if (envelope.encrypted) {
    if (!passphrase) throw new Error('Backup passphrase is required');
    if (!envelope.salt || !envelope.iv || !envelope.tag) {
      throw new Error('Encrypted backup metadata is incomplete');
    }
    const key = scryptSync(passphrase, Buffer.from(envelope.salt, 'base64'), 32);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    dump = Buffer.concat([
      decipher.update(Buffer.from(envelope.payload, 'base64')),
      decipher.final(),
    ]);
  } else {
    dump = Buffer.from(envelope.payload, 'base64');
  }
  const checksum = createHash('sha256').update(dump).digest('hex');
  if (checksum !== envelope.checksum) throw new Error('Backup checksum mismatch');
  return dump;
}
