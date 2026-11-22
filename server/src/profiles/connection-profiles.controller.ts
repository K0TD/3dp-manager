import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ConnectionProfilesService } from './connection-profiles.service';
import {
  CreateConnectionProfileDto,
  PreviewConnectionProfileDto,
  UpdateConnectionProfileDto,
} from './dto/connection-profile.dto';

@Controller('profiles')
export class ConnectionProfilesController {
  constructor(private readonly profilesService: ConnectionProfilesService) {}

  @Get('catalog')
  getCatalog() {
    return this.profilesService.getCatalog();
  }

  @Get()
  findAll() {
    return this.profilesService.findAll();
  }

  @Post('preview')
  preview(@Body() dto: PreviewConnectionProfileDto) {
    return this.profilesService.preview(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.profilesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateConnectionProfileDto) {
    return this.profilesService.create(dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectionProfileDto,
  ) {
    return this.profilesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.profilesService.remove(id);
  }

  @Post(':id/check')
  check(@Param('id', ParseUUIDPipe) id: string) {
    return this.profilesService.checkProfile(id);
  }

  @Get(':id/export')
  exportProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.profilesService.exportProfile(id);
  }
}
