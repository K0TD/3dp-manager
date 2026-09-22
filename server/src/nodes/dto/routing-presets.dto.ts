import { IsBoolean, IsString, Matches } from 'class-validator';

export class UpdateRoutingPresetsDto {
  @IsBoolean()
  blockRussia: boolean;

  @IsBoolean()
  blockIpCheckers: boolean;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  revision: string;
}
