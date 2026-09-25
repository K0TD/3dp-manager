import { IsBoolean, IsString, Matches, ValidateIf } from 'class-validator';

export class UpdateRoutingPresetsDto {
  @IsBoolean()
  blockRussia: boolean;

  @IsBoolean()
  blockIpCheckers: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  googleIpv4?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  forceAdopt?: boolean;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  revision: string;
}
