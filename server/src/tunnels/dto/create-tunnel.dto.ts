import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { isValidForwardingPortSpec } from '../forwarding-ports';

function IsForwardingPortSpec() {
  return ValidateBy({
    name: 'forwardingPortSpec',
    validator: {
      validate: (value: unknown) => isValidForwardingPortSpec(value),
      defaultMessage: () =>
        'Ports must be comma-separated numbers or ranges from 1 to 65535 (e.g. 443,8443,10000:60000)',
    },
  });
}

export class CreateTunnelDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsUUID()
  @IsOptional()
  nodeId?: string;

  @IsString()
  @MinLength(1)
  ip: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort: number;

  @IsString()
  @MinLength(1)
  username: string;

  @ValidateIf((dto: CreateTunnelDto) => !dto.privateKey)
  @IsString()
  password?: string;

  @ValidateIf((dto: CreateTunnelDto) => !dto.password)
  @IsString()
  privateKey?: string;

  @IsString()
  @IsOptional()
  domain?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  @IsForwardingPortSpec()
  tcpPorts?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  @IsForwardingPortSpec()
  udpPorts?: string;
}
