import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
  Res,
  Req,
  Inject,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Response, Request } from 'express';
import * as QRCode from 'qrcode';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Public } from '../auth/public.decorator';
import { Tunnel } from 'src/tunnels/entities/tunnel.entity';
import {
  generateSubscriptionHtmlWithQr,
  type SubscriptionPreviewData,
} from './templates/subscription.template';
import { InboundStatus } from '../inbounds/entities/inbound.entity';
import { sortInboundsByPosition } from '../inbounds/inbound-order';

@Controller()
export class ClientController {
  private readonly logger = new Logger(ClientController.name);

  constructor(
    @InjectRepository(Subscription)
    private subRepo: Repository<Subscription>,
    @InjectRepository(Tunnel)
    private tunnelRepo: Repository<Tunnel>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  @Public()
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  @Get('bus/:uuid')
  async getSubscription(
    @Param('uuid') uuid: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const sub = await this.subRepo.findOne({
      where: { uuid },
      relations: ['inbounds'],
    });

    if (!sub || !sub.isEnabled) {
      throw new HttpException('Subscription not found', HttpStatus.NOT_FOUND);
    }

    const previewData = this.buildPreviewData(
      sortInboundsByPosition(sub.inbounds || [])
        .filter((inbound) => inbound.status === InboundStatus.Active)
        .map((inbound) => ({
          protocol: inbound.protocol,
          link: inbound.link,
        })),
    );
    if (req.query.format === 'amneziawg') {
      const requestedIndex =
        typeof req.query.index === 'string' ? req.query.index : undefined;
      return this.sendAmneziaConfig(
        previewData.amneziaLinks,
        requestedIndex,
        res,
      );
    }
    const plainTextList = previewData.subscriptionLinks.join('\n');
    const base64Config = Buffer.from(plainTextList).toString('base64');

    const userAgent = req.headers['user-agent'] || '';
    const isBrowser = /Mozilla|Chrome|Safari|Firefox|Edge/.test(userAgent);

    if (!isBrowser) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(base64Config);
    } else {
      const currentUrl = `${req.protocol}://${req.get('host')}/bus/${uuid}`;

      const cacheKey = `qr_${uuid}`;

      let qrDataUrl = await this.cacheManager.get<string>(cacheKey);

      if (!qrDataUrl) {
        qrDataUrl = await QRCode.toDataURL(currentUrl, {
          width: 300,
          margin: 2,
        });

        await this.cacheManager.set(cacheKey, qrDataUrl, 86400000);
      } else {
        this.logger.debug(`QR loaded from cache for ${uuid}`);
      }

      const html = generateSubscriptionHtmlWithQr({
        ...previewData,
        currentUrl,
        qrDataUrl,
        subscriptionName: sub.name,
      });

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    }
  }

  @Public()
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  @Get('bus/:uuid/:tunnelId')
  async getRelaySubscription(
    @Param('uuid') uuid: string,
    @Param('tunnelId') tunnelId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tunnel = await this.tunnelRepo.findOne({ where: { id: +tunnelId } });
    if (!tunnel) {
      return res.status(HttpStatus.NOT_FOUND).send('Relay server not found');
    }

    const relayHost = tunnel.domain || tunnel.ip;

    const sub = await this.subRepo.findOne({
      where: { uuid },
      relations: ['inbounds'],
    });

    if (!sub || !sub.isEnabled) {
      throw new HttpException('Subscription not found', HttpStatus.NOT_FOUND);
    }

    const previewData = this.buildPreviewData(
      sortInboundsByPosition(sub.inbounds || [])
        .filter(
          (inbound) =>
            inbound.status === InboundStatus.Active &&
            inbound.link &&
            inbound.link.length > 0,
        )
        .map((inbound) => ({
          protocol: inbound.protocol,
          link:
            inbound.protocol === 'custom'
              ? inbound.link
              : this.patchLink(inbound.link, relayHost),
        })),
    );
    if (req.query.format === 'amneziawg') {
      const requestedIndex =
        typeof req.query.index === 'string' ? req.query.index : undefined;
      return this.sendAmneziaConfig(
        previewData.amneziaLinks,
        requestedIndex,
        res,
      );
    }
    const plainTextList = previewData.subscriptionLinks.join('\n');
    const base64Config = Buffer.from(plainTextList).toString('base64');

    const userAgent = req.headers['user-agent'] || '';
    const isBrowser = /Mozilla|Chrome|Safari|Firefox|Edge/.test(userAgent);

    if (!isBrowser) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(base64Config);
    } else {
      const currentUrl = `${req.protocol}://${req.get('host')}/bus/${uuid}/${tunnelId}`;

      const cacheKey = `qr_${uuid}_${relayHost || 'direct'}`;

      let qrDataUrl = await this.cacheManager.get<string>(cacheKey);

      if (!qrDataUrl) {
        qrDataUrl = await QRCode.toDataURL(currentUrl, {
          width: 300,
          margin: 2,
        });

        await this.cacheManager.set(cacheKey, qrDataUrl, 86400000);
      } else {
        this.logger.debug(`QR loaded from cache for ${uuid}`);
      }

      const html = generateSubscriptionHtmlWithQr({
        ...previewData,
        currentUrl,
        qrDataUrl,
        subscriptionName: sub.name,
      });

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    }
  }

  /** Relay rewriting preserves generated links that cannot be parsed safely. */
  private patchLink(link: string, newHost: string): string {
    if (link.startsWith('vmess://')) {
      return this.tryPatchVmessLink(link, newHost);
    }
    if (
      link.startsWith('vless://') ||
      link.startsWith('trojan://') ||
      link.startsWith('hy2://')
    ) {
      return link.replace(/@.*?:/, `@${newHost}:`);
    }
    if (link.startsWith('ss://'))
      return link.includes('@') ? link.replace(/@.*?:/, `@${newHost}:`) : link;
    if (link.startsWith('tg://proxy?'))
      return this.tryPatchTelegramProxyLink(link, newHost);
    if (link.startsWith('vpn://'))
      return this.tryPatchAmneziaWgLink(link, newHost);

    return link;
  }

  private tryPatchVmessLink(link: string, newHost: string): string {
    try {
      const encodedConfig = link.substring(8);
      const vmessConfig = JSON.parse(
        Buffer.from(encodedConfig, 'base64').toString('utf-8'),
      ) as { add: string };
      vmessConfig.add = newHost;
      return `vmess://${Buffer.from(JSON.stringify(vmessConfig)).toString('base64')}`;
    } catch {
      return link;
    }
  }

  private tryPatchTelegramProxyLink(link: string, newHost: string): string {
    try {
      const proxyUrl = new URL(link);
      proxyUrl.searchParams.set('server', newHost);
      return proxyUrl.toString();
    } catch {
      return link;
    }
  }

  private tryPatchAmneziaWgLink(link: string, newHost: string): string {
    try {
      const vpnConfig = Buffer.from(
        link.slice('vpn://'.length),
        'base64url',
      ).toString('utf8');
      const relayEndpoint = newHost.includes(':') ? `[${newHost}]` : newHost;
      const patchedConfig = vpnConfig.replace(
        /^(Endpoint\s*=\s*)(?:\[[^\]]+\]|[^:\r\n]+):(\d+)\s*$/m,
        `$1${relayEndpoint}:$2`,
      );
      if (patchedConfig === vpnConfig) return link;
      return `vpn://${Buffer.from(patchedConfig, 'utf8').toString('base64url')}`;
    } catch {
      return link;
    }
  }

  private buildPreviewData(
    inbounds: Array<{ protocol?: string; link?: string | null }>,
  ): Pick<
    SubscriptionPreviewData,
    'subscriptionLinks' | 'amneziaLinks' | 'telegramProxyLinks'
  > {
    const groupedLinks = {
      subscriptionLinks: [] as string[],
      amneziaLinks: [] as string[],
      telegramProxyLinks: [] as string[],
    };

    for (const inbound of inbounds) {
      const link = inbound.link?.trim();
      if (!link) continue;

      if (
        inbound.protocol === 'amneziawg' &&
        link.toLowerCase().startsWith('vpn://')
      ) {
        groupedLinks.amneziaLinks.push(link);
        continue;
      }

      if (
        inbound.protocol === 'mtproto' &&
        link.toLowerCase().startsWith('tg://proxy?')
      ) {
        groupedLinks.telegramProxyLinks.push(link);
        continue;
      }

      groupedLinks.subscriptionLinks.push(link);
    }

    return groupedLinks;
  }

  private sendAmneziaConfig(
    amneziaLinks: string[],
    requestedIndex: string | undefined,
    res: Response,
  ) {
    const indexText = requestedIndex ?? '0';
    const configIndex = /^\d+$/.test(indexText) ? Number(indexText) : -1;
    const link = amneziaLinks[configIndex];
    if (!link) {
      return res
        .status(HttpStatus.NOT_FOUND)
        .send('AmneziaWG config not found');
    }

    const config = this.decodeAmneziaConfig(link);
    if (!config) {
      return res
        .status(HttpStatus.UNPROCESSABLE_ENTITY)
        .send('Invalid AmneziaWG config');
    }

    this.setAmneziaDownloadHeaders(res, configIndex);
    return res.send(config);
  }

  private decodeAmneziaConfig(link: string): string | null {
    const config = Buffer.from(
      link.slice('vpn://'.length),
      'base64url',
    ).toString('utf8');
    return this.isValidAmneziaConfig(config) ? config : null;
  }

  private isValidAmneziaConfig(config: string): boolean {
    return (
      config.startsWith('[Interface]') &&
      config.includes('[Peer]') &&
      /^PrivateKey\s*=\s*\S+/m.test(config) &&
      /^PublicKey\s*=\s*\S+/m.test(config) &&
      /^Endpoint\s*=\s*\S+:\d+$/m.test(config)
    );
  }

  private setAmneziaDownloadHeaders(res: Response, configIndex: number) {
    res.setHeader(
      'Content-Type',
      'application/x-wireguard-profile; charset=utf-8',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="amneziawg-${configIndex + 1}.conf"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}
