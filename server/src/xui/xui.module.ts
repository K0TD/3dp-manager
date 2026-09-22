import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { XuiService } from './xui.service';
import { Setting } from '../settings/entities/setting.entity';
import { Node } from '../nodes/entities/node.entity';
import { RoutingStore } from '../nodes/routing/routing-store.service';
import { RoutingPresetsService } from '../nodes/routing/routing-presets.service';

@Module({
  imports: [TypeOrmModule.forFeature([Setting, Node])],
  providers: [RoutingStore, XuiService, RoutingPresetsService],
  exports: [XuiService, RoutingPresetsService],
})
export class XuiModule {}
