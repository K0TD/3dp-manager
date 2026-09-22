import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AuthService } from '../auth/auth.service';
import { createBackupEnvelope } from './backup.crypto';

const execFileAsync = promisify(execFile);

@Injectable()
export class BackupService {
  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {}

  async export(currentPassword: string, passphrase?: string) {
    const login = await this.authService.getAdminLogin();
    const user = login
      ? await this.authService.validateUser(login, currentPassword)
      : null;
    if (!user)
      throw new UnauthorizedException('Неверный пароль администратора');

    const host = this.config.get<string>('DB_HOST', 'postgres');
    const port = this.config.get<string>('DB_PORT', '5432');
    const username = this.config.get<string>('DB_USERNAME', 'admin');
    const database = this.config.get<string>('DB_NAME', '3dp_manager');
    const password = this.config.get<string>('DB_PASSWORD', '');
    const { stdout } = await execFileAsync(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '-h',
        host,
        '-p',
        port,
        '-U',
        username,
        database,
      ],
      {
        encoding: 'buffer',
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, PGPASSWORD: password },
      },
    );
    const envelope = createBackupEnvelope(
      stdout as unknown as Buffer,
      process.env.APP_VERSION || 'development',
      passphrase?.trim() || undefined,
    );
    return Buffer.from(JSON.stringify(envelope));
  }
}
