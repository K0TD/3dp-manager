import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectionProfile } from './entities/connection-profile.entity';
import { Node } from '../nodes/entities/node.entity';
import { Domain } from '../domains/entities/domain.entity';
import { Inbound } from '../inbounds/entities/inbound.entity';
import { XuiModule } from '../xui/xui.module';
import { ConnectionProfilesService } from './connection-profiles.service';
import { ConnectionProfilesController } from './connection-profiles.controller';
import { TlsSiteProbeService } from './tls-site-probe.service';
import { ClientProbeService } from './client-probe.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConnectionProfile, Node, Inbound, Domain]),
    XuiModule,
  ],
  controllers: [ConnectionProfilesController],
  providers: [
    ConnectionProfilesService,
    TlsSiteProbeService,
    ClientProbeService,
  ],
  exports: [
    ConnectionProfilesService,
    TlsSiteProbeService,
    ClientProbeService,
    TypeOrmModule,
  ],
})
export class ConnectionProfilesModule {}
