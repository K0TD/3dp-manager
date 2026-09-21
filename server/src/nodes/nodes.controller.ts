import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CreateNodeDto, UpdateNodeDto } from './dto/node.dto';
import { NodesService } from './nodes.service';

@Controller('nodes')
export class NodesController {
  constructor(private readonly nodesService: NodesService) {}

  @Get()
  findAll() {
    return this.nodesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateNodeDto) {
    return this.nodesService.create(dto);
  }

  @Post('check')
  checkPayload(@Body() dto: CreateNodeDto) {
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

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Query('mode') mode: 'safe' | 'deferred' = 'safe',
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
