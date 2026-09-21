import { IsOptional, IsString, Length } from 'class-validator';

export class ExportBackupDto {
  @IsString()
  @Length(1, 256)
  currentPassword: string;

  @IsOptional()
  @IsString()
  @Length(8, 256)
  passphrase?: string;
}
