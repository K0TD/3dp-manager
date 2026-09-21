import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
  imports: [AuthModule],
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}
