import {
  IsString,
  IsUrl,
  IsArray,
  ValidateNested,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsInt,
  ValidateIf,
  ValidateBy,
  ValidationOptions,
  IsIn,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CERTIFICATE_MODES,
  INBOUND_TYPES,
  ROUTING_INBOUND_TYPES,
} from '../inbound-config.constants';
import type { CertificateMode } from '../inbound-config.constants';
import { ManagedProfileSettingsDto } from '../../profiles/dto/connection-profile.dto';

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

function HasAtMost20Connections() {
  return ValidateBy({
    name: 'maxConnectionCount',
    validator: {
      validate: (value: unknown) =>
        !Array.isArray(value) ||
        value.filter((item: unknown) => {
          if (!item || typeof item !== 'object') return true;
          const type = (item as { type?: unknown }).type;
          return typeof type !== 'string' || !ROUTING_INBOUND_TYPES.has(type);
        }).length <= 20,
      defaultMessage: () =>
        'inboundsConfig must contain no more than 20 connections',
    },
  });
}

export class InboundConfigDto {
  @IsUUID()
  @IsOptional()
  configId?: string;

  @IsString()
  @IsIn(INBOUND_TYPES)
  type: string;

  @ValidateIf(
    (dto: InboundConfigDto) =>
      !['happ-routing', 'incy-routing'].includes(dto.type),
  )
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

  @IsString()
  @IsOptional()
  routingProfile?: string;

  @IsUUID()
  @IsOptional()
  profileId?: string;

  @ValidateNested()
  @Type(() => ManagedProfileSettingsDto)
  @IsOptional()
  profileSettings?: ManagedProfileSettingsDto;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  disabledReason?: string;
}

export class CreateSubscriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsOptional()
  @ValidateIf((_dto, value: unknown) => value !== '')
  @IsUrl({
    protocols: ['http', 'https', 'tg'],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(2048)
  supportUrl?: string;

  @IsOptional()
  @ValidateIf((_dto, value: unknown) => value !== '')
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(2048)
  websiteUrl?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientId?: string;

  @IsOptional()
  @IsBoolean()
  clientAutoCreate?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InboundConfigDto)
  @HasAtMost20Connections()
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
