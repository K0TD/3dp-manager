import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inbound } from '../inbounds/entities/inbound.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { RotationModule } from '../rotation/rotation.module';
import { RotationOperation } from '../rotation/entities/rotation-operation.entity';
import { ApiToken } from './api-token.entity';
import { ApiTokenService } from './api-token.service';
import { ApiTokenGuard } from './api-token.guard';
import {
  ApiTokensController,
  AutomationController,
  RotationDiagnosticsController,
} from './automation.controller';
import { AutomationService } from './automation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApiToken,
      Inbound,
      Subscription,
      RotationOperation,
    ]),
    RotationModule,
  ],
  providers: [ApiTokenService, ApiTokenGuard, AutomationService],
  controllers: [
    ApiTokensController,
    AutomationController,
    RotationDiagnosticsController,
  ],
})
export class AutomationModule {}
