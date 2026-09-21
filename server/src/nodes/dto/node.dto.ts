import {
  IsBoolean,
  IsEnum,
  IsIP,
  IsOptional,
  IsString,
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

  @IsString()
  @IsOptional()
  version?: string;

  @IsBoolean()
  @IsOptional()
  allowInvalidTls?: boolean;
}

export class UpdateNodeDto extends PartialType(CreateNodeDto) {}

export class NodeConnectionDto {
  @IsString()
  id: string;
}
