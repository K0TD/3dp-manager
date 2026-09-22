import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { TunnelsService } from './tunnels.service';
import { CreateTunnelDto } from './dto/create-tunnel.dto';

@Controller('tunnels')
export class TunnelsController {
  constructor(private readonly tunnelsService: TunnelsService) {}

  @Post()
  create(@Body() createTunnelDto: CreateTunnelDto) {
    return this.tunnelsService.create(createTunnelDto);
  }

  @Get()
  findAll() {
    return this.tunnelsService.findAll();
  }

  @Post(':id/install')
  install(@Param('id') id: string) {
    return this.tunnelsService.installScript(+id);
  }

  @Post(':id/uninstall')
  uninstall(@Param('id') id: string) {
    return this.tunnelsService.uninstallScript(+id);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Query('deleteForwarding') deleteForwarding?: string,
  ) {
    return this.tunnelsService.remove(+id, deleteForwarding === 'true');
  }
}
