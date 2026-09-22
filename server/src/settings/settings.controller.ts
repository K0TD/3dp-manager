import { Controller, Get, Post, Body, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './entities/setting.entity';
import * as net from 'net';
import * as dns from 'dns/promises';
import { COUNTRIES } from './countries';
import { XuiService } from 'src/xui/xui.service';

@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    @InjectRepository(Setting)
    private settingsRepo: Repository<Setting>,
    private xuiService: XuiService,
  ) {}

  @Get()
  async findAll() {
    const settings = await this.settingsRepo.find();
    const sensitiveKeys = new Set([
      'admin_password',
      'xui_password',
      'xui_token',
    ]);
    return settings
      .filter((setting) => !sensitiveKeys.has(setting.key))
      .reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});
  }

  @Get('countries')
  countries() {
    return COUNTRIES;
  }

  @Post('check')
  async checkConnection(
    @Body() body: { xui_url: string; xui_login: string; xui_password: string },
  ) {
    const success = await this.xuiService.checkConnection(
      body.xui_url,
      body.xui_login,
      body.xui_password,
    );
    return { success };
  }

  @Post()
  async update(@Body() settings: Record<string, string>) {
    if (settings.xui_url) {
      try {
        const parsed = new URL(settings.xui_url);
        settings['xui_host'] = parsed.hostname;

        let address = '';
        if (net.isIP(parsed.hostname) === 0) {
          const result = await dns.lookup(parsed.hostname);
          address = result.address;
        } else {
          address = parsed.hostname;
        }

        settings['xui_ip'] = address;
        this.logger.log(
          `Extracted host: ${parsed.hostname} from ${settings.xui_url}`,
        );

        if (address && address !== '127.0.0.1' && address !== 'localhost') {
          try {
            this.logger.log(`Определяем страну для IP: ${address}...`);
            const geoRes = await fetch(`http://ip-api.com/json/${address}`);
            const geoData = (await geoRes.json()) as {
              status: string;
              countryCode?: string;
              country?: string;
              message?: string;
            };

            if (geoData.status === 'success') {
              const countryCode = geoData.countryCode;

              const countryInfo = COUNTRIES.find((c) => c.code === countryCode);

              if (countryInfo) {
                const flagEmoji = countryInfo.emoji;

                settings['xui_geo_country'] = countryInfo.name;
                settings['xui_geo_flag'] = flagEmoji;

                this.logger.log(
                  `GeoIP Success: ${countryInfo.name} ${flagEmoji}`,
                );
              } else {
                this.logger.warn(
                  `Страна с кодом ${countryCode} не найдена в countries.ts`,
                );
                settings['xui_geo_country'] = geoData.country;
                settings['xui_geo_flag'] = '';
              }
            } else {
              this.logger.warn(
                `GeoIP Error: ${(geoData as { message?: string }).message}`,
              );
            }
          } catch (geoError) {
            this.logger.error(
              `Ошибка запроса к ip-api.com: ${(geoError as Error).message}`,
            );
          }
        }
      } catch {
        this.logger.warn(`Не удалось извлечь хост из URL: ${settings.xui_url}`);
      }
    }
    for (const [key, value] of Object.entries(settings)) {
      await this.settingsRepo.save({ key, value });
    }
    this.logger.log('Settings saved to database');
    return { success: true };
  }
}
