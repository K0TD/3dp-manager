import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Node } from './entities/node.entity';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';
import { XuiModule } from '../xui/xui.module';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Tunnel } from '../tunnels/entities/tunnel.entity';
import { Inbound } from '../inbounds/entities/inbound.entity';
import { Setting } from '../settings/entities/setting.entity';
import { SubscriptionLockService } from '../subscriptions/subscription-lock.service';
import { NodeDeletionModule } from './node-deletion.module';
import { DomainsModule } from '../domains/domains.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Node, Subscription, Tunnel, Inbound, Setting]),
    XuiModule,
    NodeDeletionModule,
    DomainsModule,
  ],
  controllers: [NodesController],
  providers: [NodesService, SubscriptionLockService],
  exports: [NodesService, TypeOrmModule],
})
export class NodesModule {}
