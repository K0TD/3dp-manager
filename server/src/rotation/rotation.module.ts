import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { RotationService } from './rotation.service';
import { XuiModule } from '../xui/xui.module';
import { InboundsModule } from '../inbounds/inbounds.module';

import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Inbound } from '../inbounds/entities/inbound.entity';
import { Domain } from '../domains/entities/domain.entity';
import { Setting } from '../settings/entities/setting.entity';
import { RotationController } from './rotation.controller';
import { Node } from '../nodes/entities/node.entity';
import { Tunnel } from '../tunnels/entities/tunnel.entity';
import { RotationOperation } from './entities/rotation-operation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Subscription,
      Inbound,
      Domain,
      Setting,
      Node,
      Tunnel,
      RotationOperation,
    ]),
    ScheduleModule.forRoot(),
    XuiModule,
    InboundsModule,
  ],
  providers: [RotationService],
  controllers: [RotationController],
})
export class RotationModule {}
