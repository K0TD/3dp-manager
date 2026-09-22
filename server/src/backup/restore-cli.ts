import { execFileSync } from 'child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { BackupEnvelope, openBackupEnvelope } from './backup.crypto';

function restore() {
  const archivePath = process.argv[2];
  if (!archivePath) throw new Error('Usage: restore-cli <archive>');
  const envelope = JSON.parse(
    readFileSync(archivePath, 'utf8'),
  ) as BackupEnvelope;
  const dump = openBackupEnvelope(envelope, process.env.BACKUP_PASSPHRASE);
  const dumpPath = `/tmp/3dp-restore-${randomBytes(6).toString('hex')}.dump`;
  writeFileSync(dumpPath, dump, { mode: 0o600 });
  try {
    execFileSync(
      'pg_restore',
      [
        '--clean',
        '--if-exists',
        '--no-owner',
        '-h',
        process.env.DB_HOST || 'postgres',
        '-p',
        process.env.DB_PORT || '5432',
        '-U',
        process.env.DB_USERNAME || 'admin',
        '-d',
        process.env.DB_NAME || '3dp_manager',
        dumpPath,
      ],
      {
        stdio: 'inherit',
        env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' },
      },
    );
  } finally {
    unlinkSync(dumpPath);
  }
}

try {
  restore();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Restore failed'}\n`,
  );
  process.exitCode = 1;
}
