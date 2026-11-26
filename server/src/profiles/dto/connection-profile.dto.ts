import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { COUNTRIES } from '../../settings/countries';
import {
  CLIENT_FINGERPRINTS,
  MANAGED_PROFILE_KINDS,
  PROFILE_ROTATION_POLICIES,
  REVERSE_PROXY_ENGINES,
  XHTTP_MODES,
  type ClientFingerprint,
  type ManagedProfileKind,
  type ProfileRotationPolicy,
  type ReverseProxyEngine,
  type XhttpMode,
} from '../connection-profile.types';

const COUNTRY_FLAGS = COUNTRIES.map((country) => country.emoji);

export class XhttpXmuxDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  maxConcurrency?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  maxConnections?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  cMaxReuseTimes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  hMaxRequestTimes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  hMaxReusableSecs?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3600)
  @IsOptional()
  hKeepAlivePeriod?: number;
}

export class ProfileMonitoringExtensionDto {
  @IsString()
  @IsIn(['xray', 'mihomo'])
  @IsOptional()
  probeEngine?: 'xray' | 'mihomo';

  @IsString()
  @IsIn(['direct', 'ru-eu-relay'])
  @IsOptional()
  routingStrategy?: 'direct' | 'ru-eu-relay';

  @IsUUID()
  @IsOptional()
  entryNodeId?: string;

  @IsUUID()
  @IsOptional()
  exitNodeId?: string;

  @IsObject()
  @IsOptional()
  labels?: Record<string, string>;
}

export class ManagedProfileSettingsDto {
  @IsString()
  @IsIn(XHTTP_MODES)
  @IsOptional()
  mode?: XhttpMode;

  @IsString()
  @IsOptional()
  @MaxLength(256)
  path?: string;

  @IsString()
  @IsOptional()
  @MaxLength(253)
  host?: string;

  @IsString()
  @IsOptional()
  @MaxLength(253)
  domain?: string;

  @IsString()
  @IsIn(CLIENT_FINGERPRINTS)
  @IsOptional()
  fingerprint?: ClientFingerprint;

  @IsString()
  @IsOptional()
  @MaxLength(256)
  spiderX?: string;

  @IsBoolean()
  @IsOptional()
  noGRPCHeader?: boolean;

  @ValidateNested()
  @Type(() => XhttpXmuxDto)
  @IsOptional()
  xmux?: XhttpXmuxDto;

  @IsString()
  @IsIn(PROFILE_ROTATION_POLICIES)
  @IsOptional()
  rotationPolicy?: ProfileRotationPolicy;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  destPort?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  localHttpsPort?: number;

  @IsString()
  @IsIn(REVERSE_PROXY_ENGINES)
  @IsOptional()
  webServer?: ReverseProxyEngine;

  @IsString()
  @IsIn(REVERSE_PROXY_ENGINES)
  @IsOptional()
  reverseProxy?: ReverseProxyEngine;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  publicPort?: number;

  @Type(() => Number)
  @IsIn([0, 1, 2])
  @IsOptional()
  xver?: 0 | 1 | 2;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  certificateFile?: string;

  @IsString()
  @IsOptional()
  @MaxLength(512)
  keyFile?: string;

  @ValidateNested()
  @Type(() => ProfileMonitoringExtensionDto)
  @IsOptional()
  monitoring?: ProfileMonitoringExtensionDto;
}

export class CreateConnectionProfileDto {
  @IsString()
  @MaxLength(160)
  name: string;

  @IsOptional()
  @IsIn(COUNTRY_FLAGS)
  flag?: string | null;

  @IsString()
  @IsIn(MANAGED_PROFILE_KINDS)
  kind: ManagedProfileKind;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsUUID()
  @IsOptional()
  subscriptionId?: string;

  @IsUUID()
  @IsOptional()
  nodeId?: string;

  @IsUUID()
  @IsOptional()
  configId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number;

  @IsString()
  @IsOptional()
  @MaxLength(253)
  sni?: string;

  @IsString()
  @IsIn(PROFILE_ROTATION_POLICIES)
  @IsOptional()
  rotationPolicy?: ProfileRotationPolicy;

  @ValidateNested()
  @Type(() => ManagedProfileSettingsDto)
  @IsOptional()
  spec?: ManagedProfileSettingsDto;

  @ValidateNested()
  @Type(() => ProfileMonitoringExtensionDto)
  @IsOptional()
  monitoringConfig?: ProfileMonitoringExtensionDto;
}

export class UpdateConnectionProfileDto {
  @IsString()
  @MaxLength(160)
  @IsOptional()
  name?: string;

  @IsOptional()
  @IsIn(COUNTRY_FLAGS)
  flag?: string | null;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsUUID()
  @IsOptional()
  subscriptionId?: string | null;

  @IsUUID()
  @IsOptional()
  nodeId?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number | null;

  @IsString()
  @IsOptional()
  @MaxLength(253)
  sni?: string | null;

  @IsString()
  @IsIn(PROFILE_ROTATION_POLICIES)
  @IsOptional()
  rotationPolicy?: ProfileRotationPolicy;

  @ValidateNested()
  @Type(() => ManagedProfileSettingsDto)
  @IsOptional()
  spec?: ManagedProfileSettingsDto;

  @ValidateNested()
  @Type(() => ProfileMonitoringExtensionDto)
  @IsOptional()
  monitoringConfig?: ProfileMonitoringExtensionDto | null;
}

export class PreviewConnectionProfileDto {
  @IsString()
  @IsIn(MANAGED_PROFILE_KINDS)
  kind: ManagedProfileKind;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  flag?: string | null;

  @IsUUID()
  @IsOptional()
  nodeId?: string;

  @IsOptional()
  port?: number | string;

  @IsString()
  @IsOptional()
  @MaxLength(253)
  sni?: string;

  @ValidateNested()
  @Type(() => ManagedProfileSettingsDto)
  @IsOptional()
  settings?: ManagedProfileSettingsDto;

  @IsBoolean()
  @IsOptional()
  liveCheck?: boolean;
}
