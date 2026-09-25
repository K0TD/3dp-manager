import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { DomainsService } from './domains.service';
import { DomainScannerService } from './domain-scanner.service';

@Controller('domains')
export class DomainsController {
  constructor(
    private readonly domainsService: DomainsService,
    private readonly domainScannerService: DomainScannerService,
  ) {}

  @Post()
  create(@Body() body: { name: string }) {
    return this.domainsService.create(body);
  }

  @Post('upload')
  uploadMany(@Body() body: { domains: string[] }) {
    return this.domainsService.createMany(body.domains);
  }

  @Get('profiles')
  getProfiles() {
    return this.domainsService.getCatalogProfiles();
  }

  @Get('resolve-profile')
  resolveProfile(@Query('sni') sni?: string) {
    return this.domainsService.resolveProfile(sni || '');
  }

  @Post('ping')
  ping(@Body() body: { domain?: string; domains?: string[] }) {
    if (body.domains && Array.isArray(body.domains)) {
      return this.domainsService.pingDomains(body.domains);
    }
    return this.domainsService.pingDomain(body.domain || '');
  }

  @Get('scan/capabilities')
  scanCapabilities() {
    return this.domainScannerService.getCapabilities();
  }

  @Get('scan/status')
  scanStatus() {
    return this.domainScannerService.getScanStatus();
  }

  @Get('scan/last-result')
  lastScanResult() {
    return this.domainScannerService.getLastScanResult();
  }

  @Post('scan/start')
  startScan(
    @Body()
    body: {
      addr: string;
      scanSeconds?: number;
      thread?: number;
      timeout?: number;
    },
  ) {
    return this.domainScannerService.startScan(body);
  }

  @Get('all')
  findAllWithoutPagination() {
    return this.domainsService.findAllUnpaginated();
  }

  @Get()
  findAll(@Query('page') page: number, @Query('limit') limit: number) {
    const pageNum = page ? +page : 1;
    const limitNum = limit ? +limit : 10;

    return this.domainsService.findAll(pageNum, limitNum);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.domainsService.findOne(+id);
  }

  @Delete('all')
  removeAll() {
    return this.domainsService.removeAll();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.domainsService.remove(+id);
  }
}
