import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CheckNodeDto,
  CreateNodeDto,
  MigrateNodeAddressDto,
  UpdateNodeDto,
} from './dto/node.dto';
import { NodesService } from './nodes.service';
import { RoutingPresetsService } from './routing/routing-presets.service';
import { UpdateRoutingPresetsDto } from './dto/routing-presets.dto';

@Controller('nodes')
export class NodesController {
  constructor(
    private readonly nodesService: NodesService,
    private readonly routingPresets: RoutingPresetsService,
  ) {}

  @Get(':id/routing-presets')
  getRoutingPresets(@Param('id', ParseUUIDPipe) id: string) {
    return this.routingPresets.get(id);
  }

  @Put(':id/routing-presets')
  updateRoutingPresets(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoutingPresetsDto,
  ) {
    return this.routingPresets.update(id, dto);
  }

  @Get()
  findAll() {
    return this.nodesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateNodeDto) {
    return this.nodesService.create(dto);
  }

  @Post('check')
  checkPayload(@Body() dto: CheckNodeDto) {
    return this.nodesService.checkPayload(dto);
  }

  @Post('detect-location')
  detectLocation(@Body() body: { url: string }) {
    return this.nodesService.detectLocation(body.url);
  }

  @Post('sync/main')
  syncFromMain() {
    return this.nodesService.syncFromMain();
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNodeDto) {
    return this.nodesService.update(id, dto);
  }

  @Post(':id/migrate-address')
  migrateAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MigrateNodeAddressDto,
  ) {
    return this.nodesService.migrateAddress(id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Query('mode') mode: 'safe' | 'deferred' | 'force' = 'safe',
  ) {
    return this.nodesService.remove(id, mode);
  }

  @Post(':id/main')
  setMain(@Param('id') id: string) {
    return this.nodesService.setMain(id);
  }

  @Post(':id/check')
  check(@Param('id') id: string) {
    return this.nodesService.checkConnection(id);
  }
}
