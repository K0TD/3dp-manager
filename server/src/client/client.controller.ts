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
  Optional,
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
import {
  buildHappRoutingLink,
  buildIncyRoutingLink,
} from '../subscriptions/routing-profile';
import {
  amneziaConfigFileName,
  attachmentDisposition,
} from './subscription-name';
import {
  amneziaConfigFromLink,
  renameAmneziaVpnLink,
} from '../inbounds/amnezia-vpn-link';
import {
  isProxyProtocol,
  proxyConnectionFromLink,
  wireguardConfigFromLink,
} from '../inbounds/connection-profiles';
import { patchInboundLinkHost } from '../inbounds/inbound-endpoint.util';
import { buildXrayClientJsonFromSubscriptionInbounds } from '../profiles/profile-config.builder';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Controller()
export class ClientController {
  private readonly logger = new Logger(ClientController.name);

  constructor(
    @InjectRepository(Subscription)
    private subRepo: Repository<Subscription>,
    @InjectRepository(Tunnel)
    private tunnelRepo: Repository<Tunnel>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Optional() private readonly subscriptionsService?: SubscriptionsService,
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
      relations: ['inbounds', 'node'],
    });

    if (!sub || !sub.isEnabled) {
      throw new HttpException('Subscription not found', HttpStatus.NOT_FOUND);
    }
    res.setHeader('Cache-Control', 'no-store');
    await this.setSubscriptionMetadata(sub, res);

    const activeInbounds = sortInboundsByPosition(sub.inbounds || []).filter(
      (inbound) => inbound.status === InboundStatus.Active,
    );
    if (req.query.format === 'xray-json') {
      return this.sendXrayJsonConfig(activeInbounds, sub.name, res);
    }
    const previewData = this.buildPreviewData(
      activeInbounds.map((inbound) => ({
        protocol: inbound.protocol,
        link: inbound.link,
      })),
      sub.name,
    );
    if (req.query.format === 'amneziawg') {
      const requestedIndex =
        typeof req.query.index === 'string' ? req.query.index : undefined;
      return this.sendAmneziaConfig(
        previewData.amneziaLinks,
        requestedIndex,
        sub.name,
        res,
      );
    }
    if (req.query.format === 'wireguard') {
      return this.sendWireguardConfig(
        previewData.wireguardLinks ?? [],
        typeof req.query.index === 'string' ? req.query.index : undefined,
        sub.name,
        res,
      );
    }
    const plainTextList = [
      ...this.routingLines(sub),
      ...previewData.subscriptionLinks,
    ].join('\n');
    const base64Config = Buffer.from(plainTextList).toString('base64');

    const userAgent = req.headers['user-agent'] || '';
    const isBrowser = /Mozilla|Chrome|Safari|Firefox|Edge/.test(userAgent);

    if (!isBrowser) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(base64Config);
    } else {
      const currentUrl = `${req.protocol}://${req.get('host')}/bus/${uuid}`;

      const qrData = await this.buildPreviewQrData(
        currentUrl,
        previewData,
        `qr_${uuid}`,
      );

      const html = generateSubscriptionHtmlWithQr({
        ...previewData,
        currentUrl,
        ...qrData,
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
    const tunnel = /^\d+$/.test(tunnelId)
      ? await this.tunnelRepo.findOne({ where: { id: Number(tunnelId) } })
      : null;
    if (!tunnel) {
      return res.status(HttpStatus.NOT_FOUND).send('Relay server not found');
    }

    const relayHost = tunnel.domain || tunnel.ip;

    const sub = await this.subRepo.findOne({
      where: { uuid },
      relations: ['inbounds', 'node'],
    });

    if (!sub || !sub.isEnabled) {
      throw new HttpException('Subscription not found', HttpStatus.NOT_FOUND);
    }
    res.setHeader('Cache-Control', 'no-store');
    await this.setSubscriptionMetadata(sub, res);

    const activeRelayInbounds = sortInboundsByPosition(
      sub.inbounds || [],
    ).filter(
      (inbound) =>
        inbound.status === InboundStatus.Active &&
        inbound.link &&
        inbound.link.length > 0,
    );
    if (req.query.format === 'xray-json') {
      return this.sendXrayJsonConfig(
        activeRelayInbounds,
        sub.name,
        res,
        relayHost,
      );
    }
    const previewData = this.buildPreviewData(
      activeRelayInbounds.map((inbound) => ({
        protocol: inbound.protocol,
        link:
          inbound.protocol === 'custom'
            ? inbound.link
            : this.patchLink(inbound.link, relayHost),
      })),
      sub.name,
    );
    if (req.query.format === 'amneziawg') {
      const requestedIndex =
        typeof req.query.index === 'string' ? req.query.index : undefined;
      return this.sendAmneziaConfig(
        previewData.amneziaLinks,
        requestedIndex,
        sub.name,
        res,
      );
    }
    if (req.query.format === 'wireguard') {
      return this.sendWireguardConfig(
        previewData.wireguardLinks ?? [],
        typeof req.query.index === 'string' ? req.query.index : undefined,
        sub.name,
        res,
      );
    }
    const plainTextList = [
      ...this.routingLines(sub),
      ...previewData.subscriptionLinks,
    ].join('\n');
    const base64Config = Buffer.from(plainTextList).toString('base64');

    const userAgent = req.headers['user-agent'] || '';
    const isBrowser = /Mozilla|Chrome|Safari|Firefox|Edge/.test(userAgent);

    if (!isBrowser) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(base64Config);
    } else {
      const currentUrl = `${req.protocol}://${req.get('host')}/bus/${uuid}/${tunnelId}`;

      const qrData = await this.buildPreviewQrData(
        currentUrl,
        previewData,
        `qr_${uuid}_${relayHost || 'direct'}`,
      );

      const html = generateSubscriptionHtmlWithQr({
        ...previewData,
        currentUrl,
        ...qrData,
        subscriptionName: sub.name,
      });

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    }
  }

  private async setSubscriptionMetadata(sub: Subscription, res: Response) {
    const encode = (value: string) =>
      `base64:${Buffer.from(value, 'utf8').toString('base64')}`;
    res.setHeader('profile-title', encode(sub.name || 'Подписка'));
    if (sub.note) res.setHeader('announce', encode(sub.note));
    if (sub.supportUrl)
      res.setHeader('support-url', this.encodeHeaderUrl(sub.supportUrl));
    if (sub.websiteUrl)
      res.setHeader(
        'profile-web-page-url',
        this.encodeHeaderUrl(sub.websiteUrl),
      );
    let usage = sub.clientUsage ?? undefined;
    if (sub.clientId && this.subscriptionsService) {
      const key = `usage_${sub.uuid}_${sub.clientId}_${JSON.stringify(sub.inboundsConfig)}`;
      try {
        usage =
          (await this.cacheManager.get<
            NonNullable<Subscription['clientUsage']>
          >(key)) ?? undefined;
        if (!usage) {
          usage =
            (await this.subscriptionsService.syncClientUsage(sub)) ?? undefined;
          if (usage) await this.cacheManager.set(key, usage, 30000);
        }
      } catch {
        usage = sub.clientUsage ?? undefined;
        this.logger.warn(
          'Не удалось обновить статистику клиента; используются сохранённые данные',
        );
      }
    }
    if (usage) {
      res.setHeader(
        'subscription-userinfo',
        `upload=${usage.upload}; download=${usage.download}; total=${usage.total}; expire=${usage.expire}`,
      );
    }
  }

  private encodeHeaderUrl(value: string): string {
    return value.replace(/[^\t\x20-\x7e\x80-\xff]+/gu, (invalid) =>
      Array.from(
        Buffer.from(invalid, 'utf8'),
        (byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`,
      ).join(''),
    );
  }

  private routingLines(sub: Subscription): string[] {
    return (sub.inboundsConfig || [])
      .filter(
        (config) =>
          config.enabled !== false &&
          (config.type === 'happ-routing' || config.type === 'incy-routing'),
      )
      .map((config) =>
        config.type === 'happ-routing'
          ? buildHappRoutingLink(config.routingProfile)
          : buildIncyRoutingLink(config.routingProfile),
      );
  }

  private async buildPreviewQrData(
    currentUrl: string,
    preview: Pick<
      SubscriptionPreviewData,
      'subscriptionLinks' | 'amneziaLinks' | 'wireguardLinks'
    >,
    cacheKey: string,
  ): Promise<
    Pick<
      SubscriptionPreviewData,
      | 'qrDataUrl'
      | 'amneziaQrDataUrls'
      | 'amneziaWgQrDataUrls'
      | 'wireguardQrDataUrls'
    >
  > {
    let qrDataUrl = '';
    if (preview.subscriptionLinks.length > 0) {
      qrDataUrl = (await this.cacheManager.get<string>(cacheKey)) ?? '';
      if (!qrDataUrl) {
        qrDataUrl = await QRCode.toDataURL(currentUrl, {
          width: 300,
          margin: 2,
        });
        await this.cacheManager.set(cacheKey, qrDataUrl, 86400000);
      }
    }

    const amneziaQrDataUrls = await Promise.all(
      preview.amneziaLinks.map(async (link) => {
        try {
          return await QRCode.toDataURL(link, { width: 480, margin: 4 });
        } catch {
          // Large keys may exceed QR capacity; manual import remains available.
          this.logger.warn('Unable to generate Amnezia import QR code');
          return '';
        }
      }),
    );

    const amneziaWgQrDataUrls = await Promise.all(
      preview.amneziaLinks.map(async (link) => {
        try {
          const config = amneziaConfigFromLink(link);
          if (!config) return '';
          return await QRCode.toDataURL(config, {
            errorCorrectionLevel: 'L',
            width: 480,
            margin: 2,
          });
        } catch {
          this.logger.warn('Unable to generate AmneziaWG .conf QR code');
          return '';
        }
      }),
    );

    const wireguardQrDataUrls = await Promise.all(
      (preview.wireguardLinks ?? []).map(async (link) => {
        const config = wireguardConfigFromLink(link);
        if (!config) return '';
        try {
          return await QRCode.toDataURL(config, {
            errorCorrectionLevel: 'L',
            width: 480,
            margin: 2,
          });
        } catch {
          this.logger.warn('Unable to generate WireGuard .conf QR code');
          return '';
        }
      }),
    );
    return {
      qrDataUrl,
      amneziaQrDataUrls,
      amneziaWgQrDataUrls,
      wireguardQrDataUrls,
    };
  }

  /** Relay rewriting preserves generated links that cannot be parsed safely. */
  private patchLink(link: string, newHost: string): string {
    return patchInboundLinkHost(link, newHost);
  }

  private buildPreviewData(
    inbounds: Array<{ protocol?: string; link?: string | null }>,
    subscriptionName: string,
  ): Pick<
    SubscriptionPreviewData,
    | 'subscriptionLinks'
    | 'amneziaLinks'
    | 'telegramProxyLinks'
    | 'wireguardLinks'
    | 'proxyConnections'
  > {
    const groupedLinks = {
      subscriptionLinks: [] as string[],
      amneziaLinks: [] as string[],
      telegramProxyLinks: [] as string[],
      wireguardLinks: [] as string[],
      proxyConnections: [] as NonNullable<
        SubscriptionPreviewData['proxyConnections']
      >,
    };

    for (const inbound of inbounds) {
      const link = inbound.link?.trim();
      if (!link) continue;

      if (inbound.protocol === 'wireguard') {
        if (wireguardConfigFromLink(link))
          groupedLinks.wireguardLinks.push(link);
        continue;
      }
      if (isProxyProtocol(inbound.protocol || '')) {
        const connection = proxyConnectionFromLink(link);
        if (connection) groupedLinks.proxyConnections.push(connection);
        continue;
      }

      if (
        inbound.protocol === 'amneziawg' &&
        link.toLowerCase().startsWith('vpn://')
      ) {
        groupedLinks.amneziaLinks.push(
          this.withAmneziaConnectionName(link, subscriptionName),
        );
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

  private withAmneziaConnectionName(link: string, subscriptionName: string) {
    return renameAmneziaVpnLink(link, subscriptionName);
  }

  private sendWireguardConfig(
    links: string[],
    requestedIndex: string | undefined,
    subscriptionName: string,
    res: Response,
  ) {
    const index = requestedIndex ?? '0';
    const configIndex = /^\d+$/.test(index) ? Number(index) : -1;
    const config = links[configIndex]
      ? wireguardConfigFromLink(links[configIndex])
      : null;
    if (!config)
      return res
        .status(HttpStatus.NOT_FOUND)
        .send('WireGuard config not found');
    res.setHeader(
      'Content-Type',
      'application/x-wireguard-profile; charset=utf-8',
    );
    res.setHeader(
      'Content-Disposition',
      attachmentDisposition(
        amneziaConfigFileName(subscriptionName, configIndex, links.length),
        'wireguard.conf',
      ),
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(config);
  }

  private sendAmneziaConfig(
    amneziaLinks: string[],
    requestedIndex: string | undefined,
    subscriptionName: string,
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

    this.setAmneziaDownloadHeaders(
      res,
      amneziaConfigFileName(subscriptionName, configIndex, amneziaLinks.length),
    );
    return res.send(config);
  }

  private decodeAmneziaConfig(link: string): string | null {
    const config = amneziaConfigFromLink(link);
    if (!config) return null;
    return this.isValidAmneziaConfig(config) ? config : null;
  }

  private isValidAmneziaConfig(config: string): boolean {
    const numericFields = ['MTU', 'Jc', 'Jmin', 'Jmax', 'S1', 'S2', 'S3', 'S4'];
    return (
      config.startsWith('[Interface]') &&
      config.includes('[Peer]') &&
      /^PrivateKey\s*=\s*\S+/m.test(config) &&
      /^PublicKey\s*=\s*\S+/m.test(config) &&
      /^Endpoint\s*=\s*\S+:\d+$/m.test(config) &&
      numericFields.every((field) =>
        new RegExp(`^${field}\\s*=\\s*\\d+$`, 'm').test(config),
      )
    );
  }

  private sendXrayJsonConfig(
    inbounds: Array<{
      remark?: string | null;
      link?: string | null;
      clientProfileJson?: string | null;
    }>,
    subscriptionName: string,
    res: Response,
    overrideHost?: string,
  ) {
    const config = buildXrayClientJsonFromSubscriptionInbounds(
      inbounds,
      overrideHost,
    );
    const safeName =
      (subscriptionName || 'subscription')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'subscription';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      attachmentDisposition(`${safeName}-xray.json`, 'xray-profile.json'),
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(JSON.stringify(config, null, 2));
  }

  private setAmneziaDownloadHeaders(res: Response, fileName: string) {
    res.setHeader(
      'Content-Type',
      'application/x-wireguard-profile; charset=utf-8',
    );
    res.setHeader('Content-Disposition', attachmentDisposition(fileName));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}
