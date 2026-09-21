import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BackupService } from './backup.service';
import { ExportBackupDto } from './backup.dto';

@Controller('backups')
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Post('export')
  async export(
    @Body() body: ExportBackupDto,
    @Res() response: Response,
  ) {
    const archive = await this.backups.export(body.currentPassword, body.passphrase);
    const date = new Date().toISOString().slice(0, 10);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="3dp-manager-${date}.3dp-backup"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.send(archive);
  }
}
