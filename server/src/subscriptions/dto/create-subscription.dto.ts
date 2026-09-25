import {
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsInt,
  ValidateIf,
  ArrayMaxSize,
  ValidateBy,
  ValidationOptions,
  IsIn,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CERTIFICATE_MODES, INBOUND_TYPES } from '../inbound-config.constants';
import type { CertificateMode } from '../inbound-config.constants';

const PORT_OR_RANDOM = 'portOrRandom';

function IsPortOrRandom(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: PORT_OR_RANDOM,
      validator: {
        validate: (value: unknown) => {
          if (value === undefined || value === null || value === '') {
            return true;
          }
          if (value === 'random') return true;
          const port =
            typeof value === 'number'
              ? value
              : typeof value === 'string' && /^\d+$/.test(value)
                ? Number(value)
                : NaN;
          return Number.isInteger(port) && port >= 1 && port <= 65535;
        },
        defaultMessage: () =>
          'port must be "random" or an integer from 1 to 65535',
      },
    },
    validationOptions,
  );
}

export class InboundConfigDto {
  @IsUUID()
  @IsOptional()
  configId?: string;

  @IsString()
  @IsIn(INBOUND_TYPES)
  type: string;

  @IsOptional()
  @IsPortOrRandom()
  port?: number | string;

  @IsString()
  @IsOptional()
  @MaxLength(253)
  sni?: string;

  @IsString()
  @IsOptional()
  @IsIn(CERTIFICATE_MODES)
  certificateMode?: CertificateMode;

  @IsString()
  @IsOptional()
  @MaxLength(253)
  tlsServerName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  link?: string;

  @IsUUID()
  @IsOptional()
  nodeId?: string;

  @ValidateIf((dto: InboundConfigDto) => dto.relayServerId !== undefined)
  @Type(() => Number)
  @IsInt()
  relayServerId?: number;

  @IsString()
  @IsOptional()
  flag?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  certificateFile?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  keyFile?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  disabledReason?: string;
}

export class CreateSubscriptionDto {
  @IsString()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InboundConfigDto)
  @ArrayMaxSize(20)
  @IsOptional()
  inboundsConfig?: InboundConfigDto[];

  @IsBoolean()
  @IsOptional()
  isAutoRotationEnabled?: boolean;

  @IsUUID()
  @IsOptional()
  nodeId?: string;

  @ValidateIf((dto: CreateSubscriptionDto) => dto.relayServerId !== undefined)
  @Type(() => Number)
  @IsInt()
  relayServerId?: number;
}
