import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { isUUID } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { RotationTarget } from '../rotation/entities/rotation-operation.entity';
import { RotationService } from '../rotation/rotation.service';
import { ApiTokenService } from './api-token.service';
import {
  ApiTokenGuard,
  type AutomationRequest,
  RequiresScope,
} from './api-token.guard';
import { AutomationService } from './automation.service';

@Controller('settings/api-tokens')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokenService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.tokens.list();
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  issue(@Body() body: Parameters<ApiTokenService['issue']>[0]) {
    return this.tokens.issue(body);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id', ParseUUIDPipe) id: string) {
    await this.tokens.revoke(id);
  }
}

@Controller('rotation/operations')
export class RotationDiagnosticsController {
  constructor(private readonly automation: AutomationService) {}

  @Get(':id/diagnostics')
  @Header('Cache-Control', 'no-store')
  getDiagnostics(@Param('id', ParseUUIDPipe) id: string) {
    return this.automation.getOperation(id);
  }
}

function rotationTarget(
  operationId: string,
  body: unknown,
  repair: boolean,
): RotationTarget {
  const input = body as Partial<RotationTarget> | null;
  if (
    !input ||
    typeof input.subscriptionId !== 'string' ||
    !isUUID(input.subscriptionId) ||
    typeof input.configId !== 'string' ||
    !isUUID(input.configId) ||
    Object.keys(input).some(
      (key) =>
        !(
          repair
            ? ['subscriptionId', 'configId', 'version', 'patch']
            : ['subscriptionId', 'configId']
        ).includes(key),
    )
  )
    throw new BadRequestException('Invalid inbound target');

  const target = {
    operationId,
    subscriptionId: input.subscriptionId,
    configId: input.configId,
  };
  if (!repair) return target;
  const { patch, version } = input;
  if (
    typeof version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(version) ||
    !patch ||
    typeof patch !== 'object' ||
    Array.isArray(patch) ||
    !Object.keys(patch).length ||
    Object.keys(patch).some(
      (key) => !['port', 'sni', 'mode', 'path'].includes(key),
    )
  ) {
    throw new BadRequestException(
      'Repair requires a version and supported patch fields',
    );
  }
  const { port, sni, path, mode } = patch;
  if (
    (port !== undefined &&
      port !== 'random' &&
      (!Number.isInteger(port) || port < 1 || port > 65535)) ||
    (sni !== undefined &&
      (typeof sni !== 'string' ||
        sni.length > 253 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]+$/i.test(
          sni,
        ))) ||
    (path !== undefined &&
      (typeof path !== 'string' ||
        !/^\/[a-zA-Z0-9._~/%-]{0,255}$/.test(path))) ||
    (mode !== undefined && !['auto', 'packet-up', 'stream-one'].includes(mode))
  ) {
    throw new BadRequestException('Invalid repair parameters');
  }
  return {
    ...target,
    version,
    patch: {
      ...(port !== undefined ? { port } : {}),
      ...(sni !== undefined ? { sni: sni.toLowerCase() } : {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(path !== undefined ? { path } : {}),
    },
  };
}

@Public()
@UseGuards(ApiTokenGuard)
@Throttle({ default: { limit: 60, ttl: 60000 } })
@Controller('v1/rotation')
export class AutomationController {
  constructor(
    private readonly automation: AutomationService,
    private readonly rotation: RotationService,
  ) {}

  @Get('operations')
  @RequiresScope('diagnostics:read')
  listOperations(@Query() query: Record<string, unknown>) {
    return this.automation.listOperations(query);
  }

  @Get('operations/:id')
  @RequiresScope('diagnostics:read')
  getOperation(@Param('id', ParseUUIDPipe) id: string) {
    return this.automation.getOperation(id);
  }

  @Get('cleanup')
  @RequiresScope('diagnostics:read')
  listCleanup(@Query() query: Record<string, unknown>) {
    return this.automation.listCleanup(query);
  }

  @Post('operations/:id/retry')
  @RequiresScope('rotation:retry')
  @HttpCode(202)
  retryInbound(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AutomationRequest,
  ) {
    return this.automation.enqueue(
      req.apiToken.id,
      key,
      rotationTarget(id, body, false),
    );
  }

  @Post('operations/:id/repair')
  @RequiresScope('inbounds:repair')
  @HttpCode(202)
  repairInbound(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AutomationRequest,
  ) {
    return this.automation.enqueue(
      req.apiToken.id,
      key,
      rotationTarget(id, body, true),
    );
  }

  @Post('cleanup/:id/retry')
  @RequiresScope('cleanup:retry')
  @HttpCode(202)
  retryCleanup(@Param('id', ParseIntPipe) id: number) {
    return this.rotation.retryCleanup(id);
  }
}
