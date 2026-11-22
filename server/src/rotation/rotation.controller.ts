import {
  Body,
  BadRequestException,
  ParseUUIDPipe,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { RotationService } from './rotation.service';

@Controller('rotation')
export class RotationController {
  private readonly logger = new Logger(RotationController.name);

  constructor(private readonly rotationService: RotationService) {}

  @Post('rotate-all')
  @HttpCode(HttpStatus.ACCEPTED)
  async rotateAll() {
    this.logger.log('Received request to rotate all active subscriptions');
    return this.rotationService.enqueueRotation();
  }

  @Post('rotate-one/:id')
  @HttpCode(HttpStatus.ACCEPTED)
  async rotateSingle(@Param('id') id: string) {
    this.logger.log(`Received request to rotate single subscription: ${id}`);
    return this.rotationService.enqueueRotation([id]);
  }

  @Post('operations')
  @HttpCode(HttpStatus.ACCEPTED)
  enqueue(@Body() body: { subscriptionIds?: string[] }) {
    this.logger.log(
      `Received request to enqueue rotation operations for: ${body.subscriptionIds?.join(', ') || 'all'}`,
    );
    return this.rotationService.enqueueRotation(body.subscriptionIds);
  }

  @Get('operations')
  listOperations() {
    return this.rotationService.listOperations();
  }

  @Get('operations/:id')
  getOperation(@Param('id') id: string) {
    return this.rotationService.getOperation(id);
  }

  @Post('operations/:id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retryInbound(
    @Param('id', ParseUUIDPipe) operationId: string,
    @Body() body: { subscriptionId?: string; configId?: string },
  ) {
    if (!isUUID(body?.subscriptionId || '') || !isUUID(body?.configId || '')) {
      throw new BadRequestException('Invalid inbound target');
    }
    return this.rotationService.enqueueTargetedRotation({
      operationId,
      subscriptionId: body.subscriptionId!,
      configId: body.configId!,
    });
  }

  @Get('cleanup')
  listCleanup() {
    return this.rotationService.listCleanup();
  }

  @Post('cleanup/:id/retry')
  retryCleanup(@Param('id') id: string) {
    return this.rotationService.retryCleanup(Number(id));
  }

  @Delete('cleanup/:id')
  deleteCleanup(@Param('id') id: string) {
    return this.rotationService.deleteCleanup(Number(id));
  }

  @Post('cleanup/purge-failed')
  purgeFailedCleanup() {
    return this.rotationService.purgeFailedCleanup();
  }
}
