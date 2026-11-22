import { Injectable } from '@nestjs/common';
import * as dns from 'dns/promises';
import * as tls from 'tls';
import * as https from 'https';
import type {
  TlsCertificateProbeInfo,
  TlsSiteProbeResult,
} from './connection-profile.types';

export interface TlsSiteProbeOptions {
  domain: string;
  port?: number;
  expectedHostIps?: string[];
  checkHttpSite?: boolean;
  timeoutMs?: number;
}

@Injectable()
export class TlsSiteProbeService {
  async probeDomainAndTls(
    options: TlsSiteProbeOptions,
  ): Promise<TlsSiteProbeResult> {
    const startedAt = Date.now();
    const domain = options.domain.trim().toLowerCase();
    const port = options.port ?? 443;
    const timeoutMs = options.timeoutMs ?? 4000;

    let dnsResolvedIps: string[] = [];
    let dnsError: string | undefined;
    try {
      const records = await dns.lookup(domain, { all: true });
      dnsResolvedIps = [...new Set(records.map((entry) => entry.address))];
    } catch (err) {
      dnsError = `Не удалось разрешить домен «${domain}»: ${
        err instanceof Error ? err.message : 'DNS lookup failed'
      }`;
      return {
        domain,
        port,
        reachable: false,
        dnsResolvedIps,
        dnsError,
        error: dnsError,
        durationMs: Date.now() - startedAt,
      };
    }

    const expectedSet = new Set(
      (options.expectedHostIps || []).map((ip) => ip.trim()).filter(Boolean),
    );
    const dnsMatchesNodeIp =
      expectedSet.size > 0
        ? dnsResolvedIps.some((ip) => expectedSet.has(ip))
        : undefined;

    const tlsResult = await this.performTlsHandshake(domain, port, timeoutMs);
    if (!tlsResult.reachable) {
      return {
        domain,
        port,
        reachable: false,
        dnsResolvedIps,
        dnsMatchesNodeIp,
        error: tlsResult.error,
        durationMs: Date.now() - startedAt,
      };
    }

    let httpStatusCode: number | undefined;
    let httpServerHeader: string | undefined;
    if (options.checkHttpSite !== false) {
      const httpProbe = await this.performHttpsHeadOrGet(
        domain,
        port,
        timeoutMs,
      );
      httpStatusCode = httpProbe.statusCode;
      httpServerHeader = httpProbe.serverHeader;
    }

    return {
      domain,
      port,
      reachable: true,
      dnsResolvedIps,
      dnsMatchesNodeIp,
      tlsProtocol: tlsResult.tlsProtocol,
      alpnProtocol: tlsResult.alpnProtocol,
      certificate: tlsResult.certificate,
      httpStatusCode,
      httpServerHeader,
      durationMs: Date.now() - startedAt,
    };
  }

  private performTlsHandshake(
    domain: string,
    port: number,
    timeoutMs: number,
  ): Promise<{
    reachable: boolean;
    tlsProtocol?: string;
    alpnProtocol?: string;
    certificate?: TlsCertificateProbeInfo;
    error?: string;
  }> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (result: {
        reachable: boolean;
        tlsProtocol?: string;
        alpnProtocol?: string;
        certificate?: TlsCertificateProbeInfo;
        error?: string;
      }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const socket = tls.connect({
        host: domain,
        port,
        servername: domain,
        ALPNProtocols: ['h2', 'http/1.1'],
        rejectUnauthorized: false,
        timeout: timeoutMs,
      });

      const timer = setTimeout(() => {
        socket.destroy();
        done({
          reachable: false,
          error: `Таймаут TLS-подключения к ${domain}:${port} (${timeoutMs} мс)`,
        });
      }, timeoutMs);

      socket.once('secureConnect', () => {
        clearTimeout(timer);
        const tlsProtocol = socket.getProtocol() || undefined;
        const rawAlpn = socket.alpnProtocol;
        const alpnProtocol =
          typeof rawAlpn === 'string' && rawAlpn ? rawAlpn : undefined;
        const peer = socket.getPeerCertificate(false);
        const certificate = this.extractCertificateInfo(
          domain,
          peer,
          socket.authorized,
          socket.authorizationError,
        );
        socket.end();
        done({
          reachable: true,
          tlsProtocol,
          alpnProtocol,
          certificate,
        });
      });

      socket.once('timeout', () => {
        clearTimeout(timer);
        socket.destroy();
        done({
          reachable: false,
          error: `Таймаут TLS-соединения к ${domain}:${port}`,
        });
      });

      socket.once('error', (err: Error) => {
        clearTimeout(timer);
        socket.destroy();
        done({
          reachable: false,
          error: `Ошибка TLS-подключения к ${domain}:${port}: ${err.message}`,
        });
      });
    });
  }

  private extractCertificateInfo(
    domain: string,
    peer: tls.PeerCertificate,
    authorized: boolean,
    authorizationError?: Error,
  ): TlsCertificateProbeInfo | undefined {
    if (!peer || Object.keys(peer).length === 0) return undefined;
    const validToDate = peer.valid_to ? new Date(peer.valid_to) : null;
    const daysRemaining =
      validToDate && !Number.isNaN(validToDate.getTime())
        ? Math.floor((validToDate.getTime() - Date.now()) / 86_400_000)
        : undefined;
    const hostCheck = tls.checkServerIdentity(domain, peer);
    const subjectCN =
      typeof peer.subject?.CN === 'string' ? peer.subject.CN : undefined;
    const issuerCN =
      typeof peer.issuer?.CN === 'string'
        ? peer.issuer.CN
        : typeof peer.issuer?.O === 'string'
          ? peer.issuer.O
          : undefined;

    return {
      subjectCN,
      subjectAltName: peer.subjectaltname,
      issuer: issuerCN,
      validFrom: peer.valid_from,
      validTo: peer.valid_to,
      daysRemaining,
      authorized,
      authorizationError: authorizationError
        ? String(authorizationError.message || authorizationError)
        : undefined,
      hostnameMatches: hostCheck === undefined,
    };
  }

  private performHttpsHeadOrGet(
    domain: string,
    port: number,
    timeoutMs: number,
  ): Promise<{ statusCode?: number; serverHeader?: string }> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (result: { statusCode?: number; serverHeader?: string }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const req = https.request(
        {
          host: domain,
          port,
          servername: domain,
          path: '/',
          method: 'HEAD',
          rejectUnauthorized: false,
          timeout: timeoutMs,
          headers: {
            Host: domain,
            'User-Agent': '3dp-manager-healthcheck/1.0',
          },
        },
        (res) => {
          res.resume();
          const serverHeader =
            typeof res.headers.server === 'string'
              ? res.headers.server
              : undefined;
          done({ statusCode: res.statusCode, serverHeader });
        },
      );

      req.once('timeout', () => {
        req.destroy();
        done({});
      });
      req.once('error', () => {
        done({});
      });
      req.end();
    });
  }
}
