import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectionProfile } from './entities/connection-profile.entity';
import { Node } from '../nodes/entities/node.entity';
import { Inbound } from '../inbounds/entities/inbound.entity';
import { XuiModule } from '../xui/xui.module';
import { ConnectionProfilesService } from './connection-profiles.service';
import { ConnectionProfilesController } from './connection-profiles.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConnectionProfile, Node, Inbound]),
    XuiModule,
  ],
  controllers: [ConnectionProfilesController],
  providers: [ConnectionProfilesService],
  exports: [ConnectionProfilesService, TypeOrmModule],
})
export class ConnectionProfilesModule {}
