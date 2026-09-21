import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { RotationService } from './rotation.service';

@Controller('rotation')
export class RotationController {
  constructor(private readonly rotationService: RotationService) {}

  @Post('rotate-all')
  @HttpCode(HttpStatus.ACCEPTED)
  async rotateAll() {
    return this.rotationService.enqueueRotation();
  }

  @Post('rotate-one/:id')
  @HttpCode(HttpStatus.ACCEPTED)
  async rotateSingle(@Param('id') id: string) {
    return this.rotationService.enqueueRotation([id]);
  }

  @Post('operations')
  @HttpCode(HttpStatus.ACCEPTED)
  enqueue(@Body() body: { subscriptionIds?: string[] }) {
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

  @Get('cleanup')
  listCleanup() {
    return this.rotationService.listCleanup();
  }

  @Post('cleanup/:id/retry')
  retryCleanup(@Param('id') id: string) {
    return this.rotationService.retryCleanup(Number(id));
  }
}
