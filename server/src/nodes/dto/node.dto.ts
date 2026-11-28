import {
  IsBoolean,
  IsEnum,
  IsIP,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { NodeAuthType } from '../entities/node.entity';

export class CreateNodeDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  url: string;

  @IsIP()
  @IsOptional()
  ip?: string;

  @IsString()
  @IsOptional()
  domain?: string;

  @IsString()
  @IsOptional()
  flag?: string;

  @IsEnum(NodeAuthType)
  authType: NodeAuthType;

  @ValidateIf((dto: CreateNodeDto) => dto.authType === NodeAuthType.Password)
  @IsString()
  login?: string;

  @ValidateIf((dto: CreateNodeDto) => dto.authType === NodeAuthType.Password)
  @IsString()
  password?: string;

  @ValidateIf((dto: CreateNodeDto) => dto.authType === NodeAuthType.Token)
  @IsString()
  token?: string;

  @IsBoolean()
  @IsOptional()
  isMain?: boolean;

  @IsBoolean()
  @IsOptional()
  allowInvalidTls?: boolean;
}

export class UpdateNodeDto extends PartialType(CreateNodeDto) {
  @IsBoolean()
  @IsOptional()
  syncSubscriptionLinks?: boolean;
}

export class CheckNodeDto {
  @IsUUID()
  @IsOptional()
  nodeId?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  url: string;

  @IsIP()
  @IsOptional()
  ip?: string;

  @IsString()
  @IsOptional()
  domain?: string;

  @IsString()
  @IsOptional()
  flag?: string;

  @IsEnum(NodeAuthType)
  authType: NodeAuthType;

  @IsString()
  @IsOptional()
  login?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  token?: string;

  @IsBoolean()
  @IsOptional()
  isMain?: boolean;

  @IsBoolean()
  @IsOptional()
  allowInvalidTls?: boolean;

  @IsBoolean()
  @IsOptional()
  preferDirectIp?: boolean;
}

export class MigrateNodeAddressDto {
  @IsString()
  url: string;

  @IsIP()
  @IsOptional()
  ip?: string;

  @IsString()
  @IsOptional()
  domain?: string;

  @IsString()
  @IsOptional()
  flag?: string;

  @IsBoolean()
  @IsOptional()
  allowInvalidTls?: boolean;

  @IsBoolean()
  @IsOptional()
  syncSubscriptionLinks?: boolean;

  @IsBoolean()
  @IsOptional()
  preferDirectIp?: boolean;
}

export class NodeConnectionDto {
  @IsString()
  id: string;
}
