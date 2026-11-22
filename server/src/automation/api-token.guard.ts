import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ApiScope, ApiToken } from './api-token.entity';
import { ApiTokenService } from './api-token.service';

export const RequiresScope = (scope: ApiScope) =>
  SetMetadata('automationScope', scope);
export type AutomationRequest = Request & { apiToken: ApiToken };

@Injectable()
export class ApiTokenGuard implements CanActivate {
  private readonly logger = new Logger('AutomationAudit');

  constructor(
    private readonly service: ApiTokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AutomationRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    const match = /^Bearer (3dp_[A-Za-z0-9_-]{43})$/i.exec(
      request.headers.authorization || '',
    );
    const token = match && (await this.service.authenticate(match[1]));
    if (!token) throw new UnauthorizedException();
    const scope = this.reflector.get<ApiScope>(
      'automationScope',
      context.getHandler(),
    );
    response.once('finish', () => {
      const target = Object.values(request.params).find(
        (value) =>
          typeof value === 'string' &&
          /^(?:[0-9a-f-]{36}|[0-9]{1,10})$/i.test(value),
      );
      this.logger.log(
        JSON.stringify({
          tokenId: token.id,
          action: context.getHandler().name,
          target,
          status: response.statusCode,
        }),
      );
    });
    if (!scope || !token.scopes.includes(scope)) throw new ForbiddenException();
    request.apiToken = token;
    return true;
  }
}
