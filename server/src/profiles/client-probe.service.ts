import { Injectable, Logger } from '@nestjs/common';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as tls from 'tls';
import { v4 as uuidv4 } from 'uuid';
import { buildXrayOutboundFromClientProfile } from './profile-config.builder';
import type {
  ClientConnectionProbeResult,
  SeparatedClientProfile,
  XrayClientJsonConfig,
} from './connection-profile.types';

export interface ClientProbeOptions {
  timeoutMs?: number;
  probeHost?: string;
  probePort?: number;
  probePath?: string;
  forceFallback?: boolean;
}

const DEFAULT_PROBE_TIMEOUT_MS = 8000;
const DEFAULT_PROBE_HOST = 'cp.cloudflare.com';
const DEFAULT_PROBE_PORT = 80;
const DEFAULT_PROBE_PATH = '/generate_204';

@Injectable()
export class ClientProbeService {
  private readonly logger = new Logger(ClientProbeService.name);
  private cachedXrayBin: string | null | undefined;

  /**
   * Builds a strictly isolated ephemeral Xray client JSON config that routes
   * all traffic from the local SOCKS5 probe listener exclusively through the
   * candidate profile outbound (no direct fallback).
   */
  buildEphemeralProbeConfig(
    client: SeparatedClientProfile,
    socksPort: number,
  ): XrayClientJsonConfig {
    return {
      log: { loglevel: 'warning' },
      inbounds: [
        {
          tag: 'socks-probe',
          listen: '127.0.0.1',
          port: socksPort,
          protocol: 'socks',
          settings: { auth: 'noauth', udp: false },
        },
      ],
      outbounds: [buildXrayOutboundFromClientProfile(client, 'proxy')],
      routing: {
        domainStrategy: 'AsIs',
        rules: [
          {
            type: 'field',
            inboundTag: ['socks-probe'],
            outboundTag: 'proxy',
          },
        ],
      },
    };
  }

  resolveXrayBinary(): string | null {
    if (this.cachedXrayBin !== undefined) return this.cachedXrayBin;
    const candidates = [
      process.env.XRAY_BIN?.trim(),
      '/usr/local/bin/xray',
      'xray',
    ].filter((v): v is string => Boolean(v));

    for (const candidate of candidates) {
      try {
        const res = spawnSync(candidate, ['version'], {
          stdio: 'ignore',
          timeout: 2000,
        });
        if (res.status === 0) {
          this.cachedXrayBin = candidate;
          return candidate;
        }
      } catch {
        // Try next candidate
      }
    }
    this.cachedXrayBin = null;
    return null;
  }

  async probeClientProfile(
    client: SeparatedClientProfile,
    options?: ClientProbeOptions,
  ): Promise<ClientConnectionProbeResult> {
    const startedAt = Date.now();
    const timeoutMs = options?.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const probeHost = options?.probeHost || DEFAULT_PROBE_HOST;
    const probePort = options?.probePort || DEFAULT_PROBE_PORT;
    const probePath = options?.probePath || DEFAULT_PROBE_PATH;

    if (!client.address || !Number.isInteger(client.port) || client.port < 1) {
      return {
        success: false,
        engine: 'tcp-tls-fallback',
        targetAddress: client.address || '',
        targetPort: client.port || 0,
        protocol: 'vless',
        profileKind: client.kind,
        latencyMs: Date.now() - startedAt,
        error: 'Некорректный адрес или порт в клиентском профиле',
      };
    }

    if (
      client.security === 'reality' &&
      (!client.publicKey ||
        client.publicKey.includes('<') ||
        client.publicKey.includes('>') ||
        client.publicKey.length < 32)
    ) {
      return {
        success: false,
        engine: 'xray-core',
        targetAddress: client.address,
        targetPort: client.port,
        protocol: 'vless',
        profileKind: client.kind,
        latencyMs: Date.now() - startedAt,
        error:
          'Профиль не развёрнут на ноде: отсутствует реальный публичный ключ REALITY (используется preview-заглушка). Добавьте профиль в подписку и выполните ротацию.',
      };
    }

    const xrayBin = options?.forceFallback ? null : this.resolveXrayBinary();
    if (xrayBin) {
      return this.probeViaXrayCore(client, xrayBin, {
        timeoutMs,
        probeHost,
        probePort,
        probePath,
        startedAt,
      });
    }

    return this.probeViaTcpTlsFallback(client, {
      timeoutMs: Math.min(timeoutMs, 4000),
      startedAt,
      fallbackReason:
        'Бинарник xray-core недоступен локально; выполнена TCP/TLS проверка доступности',
    });
  }

  private async probeViaXrayCore(
    client: SeparatedClientProfile,
    xrayBin: string,
    ctx: {
      timeoutMs: number;
      probeHost: string;
      probePort: number;
      probePath: string;
      startedAt: number;
    },
  ): Promise<ClientConnectionProbeResult> {
    const probeUrl = `http://${ctx.probeHost}:${ctx.probePort}${ctx.probePath}`;
    let tmpConfigPath: string | null = null;
    let child: ReturnType<typeof spawn> | null = null;

    try {
      const socksPort = await this.allocateLocalPort();
      const config = this.buildEphemeralProbeConfig(client, socksPort);
      tmpConfigPath = path.join(os.tmpdir(), `3dp-probe-${uuidv4()}.json`);
      await fs.writeFile(tmpConfigPath, JSON.stringify(config), {
        mode: 0o600,
      });

      let outputTail = '';
      let exitedEarly = false;
      let exitCode: number | null = null;
      let spawnError: string | null = null;

      child = spawn(xrayBin, ['run', '-c', tmpConfigPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const appendOutput = (chunk: Buffer) => {
        outputTail = `${outputTail}${chunk.toString('utf8')}`.slice(-1536);
      };
      child.stdout?.on('data', appendOutput);
      child.stderr?.on('data', appendOutput);
      child.once('error', (err: Error) => {
        exitedEarly = true;
        spawnError = err.message;
      });
      child.once('exit', (code) => {
        exitedEarly = true;
        exitCode = code;
      });

      const listenReady = await this.waitForLocalPort(
        socksPort,
        Math.min(3000, ctx.timeoutMs),
        () => exitedEarly,
      );
      if (!listenReady) {
        const sanitizedErr = this.sanitizeError(spawnError || outputTail);
        return {
          success: false,
          engine: 'xray-core',
          targetAddress: client.address,
          targetPort: client.port,
          protocol: 'vless',
          profileKind: client.kind,
          probeUrl,
          latencyMs: Date.now() - ctx.startedAt,
          error: exitedEarly
            ? `Xray-клиент завершился с кодом ${String(exitCode)}: ${sanitizedErr || 'ошибка конфигурации'}`
            : 'Локальный SOCKS5 порт Xray-клиента не открылся вовремя',
        };
      }

      const remainingMs = Math.max(
        1500,
        ctx.timeoutMs - (Date.now() - ctx.startedAt),
      );
      const httpStatus = await this.httpGetThroughSocks5(
        socksPort,
        ctx.probeHost,
        ctx.probePort,
        ctx.probePath,
        remainingMs,
      );

      if (httpStatus >= 200 && httpStatus < 400) {
        return {
          success: true,
          engine: 'xray-core',
          targetAddress: client.address,
          targetPort: client.port,
          protocol: 'vless',
          profileKind: client.kind,
          httpStatusCode: httpStatus,
          probeUrl,
          latencyMs: Date.now() - ctx.startedAt,
        };
      }

      return {
        success: false,
        engine: 'xray-core',
        targetAddress: client.address,
        targetPort: client.port,
        protocol: 'vless',
        profileKind: client.kind,
        httpStatusCode: httpStatus,
        probeUrl,
        latencyMs: Date.now() - ctx.startedAt,
        error: `Пробный HTTP-запрос через клиентский туннель вернул статус ${httpStatus}`,
      };
    } catch (err) {
      return {
        success: false,
        engine: 'xray-core',
        targetAddress: client.address,
        targetPort: client.port,
        protocol: 'vless',
        profileKind: client.kind,
        probeUrl,
        latencyMs: Date.now() - ctx.startedAt,
        error: this.sanitizeError(
          err instanceof Error ? err.message : String(err),
        ),
      };
    } finally {
      if (child && !child.killed) {
        try {
          child.kill('SIGTERM');
          setTimeout(() => {
            try {
              child?.kill('SIGKILL');
            } catch {
              // Process already exited
            }
          }, 300).unref();
        } catch {
          // Ignore kill errors
        }
      }
      if (tmpConfigPath) {
        await fs.unlink(tmpConfigPath).catch(() => undefined);
      }
    }
  }

  private probeViaTcpTlsFallback(
    client: SeparatedClientProfile,
    ctx: { timeoutMs: number; startedAt: number; fallbackReason: string },
  ): Promise<ClientConnectionProbeResult> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (result: ClientConnectionProbeResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const host = client.address.replace(/^\[|\]$/g, '');
      let activeSocket: net.Socket | tls.TLSSocket | null = null;
      const timer = setTimeout(() => {
        activeSocket?.destroy();
        done({
          success: false,
          engine: 'tcp-tls-fallback',
          targetAddress: client.address,
          targetPort: client.port,
          protocol: 'vless',
          profileKind: client.kind,
          fallbackReason: ctx.fallbackReason,
          latencyMs: Date.now() - ctx.startedAt,
          error: `Таймаут подключения к ${host}:${client.port} (${ctx.timeoutMs} мс)`,
        });
      }, ctx.timeoutMs);

      if (client.security === 'tls') {
        const socket = tls.connect({
          host,
          port: client.port,
          servername: client.sni || host,
          ALPNProtocols: client.alpn?.length ? client.alpn : ['h2', 'http/1.1'],
          rejectUnauthorized: false,
          timeout: ctx.timeoutMs,
        });
        activeSocket = socket;
        socket.once('secureConnect', () => {
          clearTimeout(timer);
          const protocol = socket.getProtocol();
          socket.end();
          if (!protocol) {
            done({
              success: false,
              engine: 'tcp-tls-fallback',
              targetAddress: client.address,
              targetPort: client.port,
              protocol: 'vless',
              profileKind: client.kind,
              fallbackReason: ctx.fallbackReason,
              latencyMs: Date.now() - ctx.startedAt,
              error: 'TLS handshake не согласовал протокол',
            });
            return;
          }
          done({
            success: true,
            engine: 'tcp-tls-fallback',
            targetAddress: client.address,
            targetPort: client.port,
            protocol: 'vless',
            profileKind: client.kind,
            fallbackReason: ctx.fallbackReason,
            latencyMs: Date.now() - ctx.startedAt,
          });
        });
        socket.once('error', (err: Error) => {
          clearTimeout(timer);
          socket.destroy();
          done({
            success: false,
            engine: 'tcp-tls-fallback',
            targetAddress: client.address,
            targetPort: client.port,
            protocol: 'vless',
            profileKind: client.kind,
            fallbackReason: ctx.fallbackReason,
            latencyMs: Date.now() - ctx.startedAt,
            error: `Ошибка TLS-подключения: ${this.sanitizeError(err.message)}`,
          });
        });
        return;
      }

      const socket = net.createConnection({
        host,
        port: client.port,
        timeout: ctx.timeoutMs,
      });
      activeSocket = socket;
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.end();
        done({
          success: true,
          engine: 'tcp-tls-fallback',
          targetAddress: client.address,
          targetPort: client.port,
          protocol: 'vless',
          profileKind: client.kind,
          fallbackReason: ctx.fallbackReason,
          latencyMs: Date.now() - ctx.startedAt,
        });
      });
      socket.once('error', (err: Error) => {
        clearTimeout(timer);
        socket.destroy();
        done({
          success: false,
          engine: 'tcp-tls-fallback',
          targetAddress: client.address,
          targetPort: client.port,
          protocol: 'vless',
          profileKind: client.kind,
          fallbackReason: ctx.fallbackReason,
          latencyMs: Date.now() - ctx.startedAt,
          error: `TCP-порт ${host}:${client.port} недоступен: ${this.sanitizeError(err.message)}`,
        });
      });
    });
  }

  private allocateLocalPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        server.close(() => {
          if (port > 0) resolve(port);
          else
            reject(new Error('Не удалось выделить свободный локальный порт'));
        });
      });
    });
  }

  private async waitForLocalPort(
    port: number,
    timeoutMs: number,
    shouldAbort: () => boolean,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (shouldAbort()) return false;
      const open = await new Promise<boolean>((resolve) => {
        const sock = net.createConnection({
          host: '127.0.0.1',
          port,
          timeout: 200,
        });
        sock.once('connect', () => {
          sock.destroy();
          resolve(true);
        });
        sock.once('error', () => {
          sock.destroy();
          resolve(false);
        });
        sock.once('timeout', () => {
          sock.destroy();
          resolve(false);
        });
      });
      if (open) return true;
      await new Promise((r) => setTimeout(r, 80));
    }
    return false;
  }

  private httpGetThroughSocks5(
    socksPort: number,
    targetHost: string,
    targetPort: number,
    targetPath: string,
    timeoutMs: number,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: '127.0.0.1', port: socksPort });
      let stage: 'greeting' | 'connect' | 'http' = 'greeting';
      let buffer = Buffer.alloc(0);

      const fail = (message: string) => {
        clearTimeout(timer);
        sock.destroy();
        reject(new Error(message));
      };

      const timer = setTimeout(() => {
        fail(`Таймаут клиентской пробы через SOCKS5 (${timeoutMs} мс)`);
      }, timeoutMs);

      sock.once('error', (err) => fail(err.message));

      sock.once('connect', () => {
        // SOCKS5 greeting: version 5, 1 auth method, 0x00 (no auth)
        sock.write(Buffer.from([0x05, 0x01, 0x00]));
      });

      sock.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (stage === 'greeting') {
          if (buffer.length < 2) return;
          if (buffer[0] !== 0x05 || buffer[1] !== 0x00) {
            fail('SOCKS5 handshake отклонён локальным Xray-клиентом');
            return;
          }
          buffer = buffer.subarray(2);
          stage = 'connect';
          const hostBuf = Buffer.from(targetHost, 'ascii');
          const portBuf = Buffer.alloc(2);
          portBuf.writeUInt16BE(targetPort, 0);
          sock.write(
            Buffer.concat([
              Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
              hostBuf,
              portBuf,
            ]),
          );
          return;
        }

        if (stage === 'connect') {
          if (buffer.length < 4) return;
          if (buffer[0] !== 0x05 || buffer[1] !== 0x00) {
            fail(
              `Xray-клиент не смог открыть туннель к ${targetHost}:${targetPort} (SOCKS5 код 0x${buffer[1].toString(16)})`,
            );
            return;
          }
          const atyp = buffer[3];
          let headerLen = 0;
          if (atyp === 0x01) headerLen = 10;
          else if (atyp === 0x04) headerLen = 22;
          else if (atyp === 0x03) {
            if (buffer.length < 5) return;
            headerLen = 7 + buffer[4];
          } else {
            fail('Неожиданный формат ответа SOCKS5');
            return;
          }
          if (buffer.length < headerLen) return;
          buffer = buffer.subarray(headerLen);
          stage = 'http';
          sock.write(
            `GET ${targetPath} HTTP/1.1\r\nHost: ${targetHost}\r\nUser-Agent: 3dp-manager-canary/1.0\r\nConnection: close\r\n\r\n`,
          );
          if (buffer.length === 0) return;
        }

        if (stage === 'http') {
          const text = buffer.toString('utf8');
          const firstLineEnd = text.indexOf('\r\n');
          if (firstLineEnd === -1 && text.length < 32) return;
          const statusLine =
            firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
          const match = /^HTTP\/\d\.\d\s+(\d{3})/.exec(statusLine);
          clearTimeout(timer);
          sock.destroy();
          if (!match) {
            reject(
              new Error(`Некорректный HTTP-ответ через туннель: ${statusLine}`),
            );
            return;
          }
          resolve(Number(match[1]));
        }
      });
    });
  }

  private sanitizeError(raw: string): string {
    return raw
      .replace(
        /privateKey["']?\s*[:=]\s*["']?[^\s"',}]+/gi,
        'privateKey=<redacted>',
      )
      .replace(
        /password["']?\s*[:=]\s*["']?[^\s"',}]+/gi,
        'password=<redacted>',
      )
      .trim()
      .slice(0, 300);
  }
}
