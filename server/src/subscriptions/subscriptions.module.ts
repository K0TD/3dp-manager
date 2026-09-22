import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { Subscription } from './entities/subscription.entity';
import { Inbound } from '../inbounds/entities/inbound.entity';
import { XuiModule } from '../xui/xui.module';
import { Node } from '../nodes/entities/node.entity';
import { Tunnel } from '../tunnels/entities/tunnel.entity';
import { Domain } from '../domains/entities/domain.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Inbound, Node, Tunnel, Domain]),
    XuiModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
