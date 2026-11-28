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
  ClientProbeAttempt,
  ClientProbeFailure,
  ClientProbeSignal,
  SeparatedClientProfile,
  XrayClientJsonConfig,
} from './connection-profile.types';

export interface ClientProbeOptions {
  timeoutMs?: number;
  waitForPortMs?: number;
  probeHost?: string;
  probePort?: number;
  probePath?: string;
  forceFallback?: boolean;
}

interface ProbeTarget {
  host: string;
  port: number;
  path: string;
  url: string;
}

class SocksProbeError extends Error {
  constructor(
    message: string,
    readonly phase: ClientProbeAttempt['stage'],
    readonly failure: ClientProbeFailure,
    readonly socksReply?: number,
  ) {
    super(message);
  }
}

export function classifyXraySignal(
  diagnostic: string,
): ClientProbeSignal | undefined {
  if (
    /invalid user|received real certificate|reality.*(?:reject|invalid|verify|authentication|minClientVer|handshake|failed)/i.test(
      diagnostic,
    )
  )
    return 'REALITY_REJECTED';
  if (/tls:|certificate|tls handshake/i.test(diagnostic)) return 'TLS_ERROR';
  if (/no such host|lookup.*failed|dns.*(?:failed|timeout)/i.test(diagnostic))
    return 'DNS_ERROR';
  if (/connection refused/i.test(diagnostic)) return 'TCP_REFUSED';
  if (/connection reset/i.test(diagnostic)) return 'CONNECTION_RESET';
  if (/\bEOF\b/i.test(diagnostic)) return 'EOF';
  if (/status (?:4|5)[0-9]{2}/i.test(diagnostic)) return 'UPSTREAM_HTTP_ERROR';
  return undefined;
}

const DEFAULT_PROBE_TIMEOUT_MS = 10000;
const DEFAULT_PROBE_TARGETS: readonly ProbeTarget[] = [
  {
    host: 'cp.cloudflare.com',
    port: 80,
    path: '/generate_204',
    url: 'http://cp.cloudflare.com:80/generate_204',
  },
  {
    host: 'connectivitycheck.gstatic.com',
    port: 80,
    path: '/generate_204',
    url: 'http://connectivitycheck.gstatic.com:80/generate_204',
  },
];

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
      log: { loglevel: 'info' },
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
    const waitForPortMs = Math.max(0, options?.waitForPortMs ?? 0);
    const probeTargets = this.resolveProbeTargets(options);

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
        waitForPortMs,
        probeTargets,
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

  private resolveProbeTargets(options?: ClientProbeOptions): ProbeTarget[] {
    if (options?.probeHost) {
      const port = options.probePort || 80;
      const targetPath = options.probePath || '/generate_204';
      return [
        {
          host: options.probeHost,
          port,
          path: targetPath,
          url: `http://${options.probeHost}:${port}${targetPath}`,
        },
      ];
    }
    const envUrl = process.env.CANARY_PROBE_URL?.trim();
    if (envUrl) {
      try {
        const parsed = new URL(envUrl);
        if (parsed.protocol === 'http:' && parsed.hostname) {
          const port = parsed.port ? Number(parsed.port) : 80;
          const targetPath = `${parsed.pathname || '/'}${parsed.search || ''}`;
          return [
            {
              host: parsed.hostname,
              port,
              path: targetPath,
              url: `http://${parsed.hostname}:${port}${targetPath}`,
            },
          ];
        }
      } catch {
        // Fallback to built-in probe targets
      }
    }
    return [...DEFAULT_PROBE_TARGETS];
  }

  private async probeViaXrayCore(
    client: SeparatedClientProfile,
    xrayBin: string,
    ctx: {
      timeoutMs: number;
      waitForPortMs: number;
      probeTargets: ProbeTarget[];
      startedAt: number;
    },
  ): Promise<ClientConnectionProbeResult> {
    const started = Date.now();
    const attempts: ClientProbeAttempt[] = [];
    let tmpConfigPath: string | null = null;
    let child: ReturnType<typeof spawn> | null = null;
    let outputTail = '';
    let tcpReachable: boolean | undefined;
    let tcpDurationMs: number | undefined;
    let xrayStartupMs: number | undefined;
    const result = (
      extra: Partial<ClientConnectionProbeResult>,
    ): ClientConnectionProbeResult => ({
      success: false,
      engine: 'xray-core',
      targetAddress: client.address,
      targetPort: client.port,
      protocol: 'vless',
      profileKind: client.kind,
      latencyMs: Date.now() - ctx.startedAt,
      tcpReachable,
      tcpDurationMs,
      xrayStartupMs,
      attempts,
      ...extra,
    });

    try {
      const host = client.address.replace(/^\[|\]$/g, '');
      const tcpReady = await this.waitForRemoteTcpPort(
        host,
        client.port,
        ctx.waitForPortMs,
        Math.min(3000, ctx.timeoutMs),
      );
      tcpDurationMs = Date.now() - started;
      tcpReachable = tcpReady.reachable;
      if (!tcpReachable)
        return result({
          stage: 'tcp',
          failure: 'TARGET_UNREACHABLE',
          error: tcpReady.reason,
        });

      const socksPort = await this.allocateLocalPort();
      const config = this.buildEphemeralProbeConfig(client, socksPort);
      tmpConfigPath = path.join(os.tmpdir(), `3dp-probe-${uuidv4()}.json`);
      await fs.writeFile(tmpConfigPath, JSON.stringify(config), {
        mode: 0o600,
      });

      let exitedEarly = false;
      let exitCode: number | null = null;
      let spawnError: string | null = null;

      const spawning = Date.now();
      child = spawn(xrayBin, ['run', '-c', tmpConfigPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const appendOutput = (chunk: Buffer) => {
        outputTail = `${outputTail}${chunk.toString('utf8')}`.slice(-3072);
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
      xrayStartupMs = Date.now() - spawning;
      if (!listenReady) {
        const sanitizedErr = this.sanitizeError(spawnError || outputTail);
        return result({
          stage: 'startup',
          failure: 'XRAY_STARTUP',
          error: exitedEarly
            ? `Xray-клиент завершился с кодом ${String(exitCode)}: ${sanitizedErr || 'ошибка конфигурации'}`
            : 'Локальный SOCKS5 порт Xray-клиента не открылся вовремя',
        });
      }

      let lastError = 'Клиентская проба не завершена';
      let lastUrl: string | undefined;
      for (const [index, target] of ctx.probeTargets.entries()) {
        lastUrl = target.url;
        const remaining = ctx.probeTargets.length - index;
        const budget = Math.max(
          1000,
          ctx.timeoutMs - (Date.now() - ctx.startedAt),
        );
        const perAttempt =
          remaining > 1
            ? Math.min(5000, Math.ceil(budget / remaining))
            : budget;
        const attemptStarted = Date.now();
        outputTail = '';
        try {
          const status = await this.httpGetThroughSocks5(
            socksPort,
            target.host,
            target.port,
            target.path,
            perAttempt,
          );
          const success = status >= 200 && status < 400;
          attempts.push({
            host: target.host,
            port: target.port,
            stage: 'http',
            durationMs: Date.now() - attemptStarted,
            httpStatusCode: status,
            ...(success ? {} : { failure: 'HTTP_STATUS' as const }),
          });
          if (success)
            return result({
              success,
              stage: 'http',
              httpStatusCode: status,
              probeUrl: lastUrl,
            });
          lastError = `Пробный HTTP-запрос через клиентский туннель вернул статус ${status}`;
        } catch (error) {
          const durationMs = Date.now() - attemptStarted;
          await new Promise((resolve) => setTimeout(resolve, 80));
          const diagnostic = this.extractXrayDiagnostic(outputTail);
          const signal = classifyXraySignal(diagnostic);
          const probeError =
            error instanceof SocksProbeError ? error : undefined;
          attempts.push({
            host: target.host,
            port: target.port,
            durationMs,
            signal,
            stage: probeError?.phase ?? 'socks',
            failure: probeError?.failure ?? 'SOCKET_ERROR',
            socksReply: probeError?.socksReply,
          });
          const message = this.sanitizeError(
            error instanceof Error ? error.message : String(error),
          );
          lastError = diagnostic ? `${message} · xray: ${diagnostic}` : message;
          // A different HTTP target helps distinguish a bad endpoint from a broken tunnel.
          if (
            exitedEarly ||
            signal === 'REALITY_REJECTED' ||
            signal === 'TLS_ERROR'
          )
            break;
        }
      }
      const last = attempts.at(-1);
      return result({
        stage: last?.stage,
        failure: last?.failure,
        httpStatusCode: last?.httpStatusCode,
        probeUrl: lastUrl,
        error: lastError,
      });
    } catch (err) {
      const baseErr = this.sanitizeError(
        err instanceof Error ? err.message : String(err),
      );
      return result({
        stage: tcpReachable ? 'startup' : 'tcp',
        failure: tcpReachable ? 'XRAY_STARTUP' : 'TARGET_UNREACHABLE',
        error: baseErr,
      });
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
      let tcpDurationMs: number | undefined;
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
          stage:
            client.security === 'tls' && tcpDurationMs !== undefined
              ? 'tls'
              : 'tcp',
          tcpReachable: tcpDurationMs !== undefined,
          tcpDurationMs,
          failure: 'TIMEOUT',
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
        socket.once('connect', () => {
          tcpDurationMs = Date.now() - ctx.startedAt;
        });
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
              stage: 'tls',
              tcpReachable: true,
              tcpDurationMs,
              failure: 'INVALID_RESPONSE',
              error: 'TLS handshake не согласовал протокол',
            });
            return;
          }
          done({
            success: true,
            stage: 'tls',
            tcpReachable: true,
            tcpDurationMs,
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
            stage: tcpDurationMs !== undefined ? 'tls' : 'tcp',
            tcpReachable: tcpDurationMs !== undefined,
            tcpDurationMs,
            failure: 'SOCKET_ERROR',
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
          stage: 'tcp',
          tcpReachable: true,
          tcpDurationMs: Date.now() - ctx.startedAt,
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
          stage: 'tcp',
          tcpReachable: false,
          failure: 'TARGET_UNREACHABLE',
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

  async waitForRemoteTcpPort(
    host: string,
    port: number,
    retryBudgetMs: number,
    connectTimeoutMs = 3000,
  ): Promise<{ reachable: boolean; reason?: string }> {
    const deadline = Date.now() + Math.max(0, retryBudgetMs);
    let lastCode = '';
    let lastMessage = '';

    for (;;) {
      const attemptTimeout = Math.min(
        connectTimeoutMs,
        retryBudgetMs > 0
          ? Math.max(800, deadline - Date.now())
          : connectTimeoutMs,
      );
      const outcome = await new Promise<{
        ok: boolean;
        code?: string;
        message?: string;
      }>((resolve) => {
        let settled = false;
        const done = (res: {
          ok: boolean;
          code?: string;
          message?: string;
        }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          sock.destroy();
          resolve(res);
        };
        const sock = net.createConnection({ host, port });
        const timer = setTimeout(() => {
          done({ ok: false, code: 'ETIMEDOUT', message: 'timeout' });
        }, attemptTimeout);
        sock.once('connect', () => done({ ok: true }));
        sock.once('error', (err: NodeJS.ErrnoException) =>
          done({ ok: false, code: err.code || '', message: err.message }),
        );
      });

      if (outcome.ok) return { reachable: true };
      lastCode = outcome.code || '';
      lastMessage = outcome.message || '';

      // Retry ECONNREFUSED within the retry budget (e.g. while 3x-ui finishes reloading Xray)
      if (lastCode === 'ECONNREFUSED' && Date.now() < deadline - 200) {
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }
      break;
    }

    if (lastCode === 'ECONNREFUSED') {
      return {
        reachable: false,
        reason: `TCP-порт ${host}:${port} отклоняет соединение (ECONNREFUSED) — Xray на ноде не слушает этот порт или не успел перезапуститься`,
      };
    }
    if (lastCode === 'ETIMEDOUT') {
      return {
        reachable: false,
        reason: `TCP-порт ${host}:${port} не отвечает (таймаут) — проверьте firewall ноды/провайдера и доступность порта`,
      };
    }
    return {
      reachable: false,
      reason: `TCP-порт ${host}:${port} недоступен (${this.sanitizeError(lastMessage || lastCode || 'network error')})`,
    };
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
      let settled = false;

      const fail = (
        message: string,
        failure: ClientProbeFailure,
        socksReply?: number,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        reject(
          new SocksProbeError(
            message,
            stage === 'http' ? 'http' : 'socks',
            failure,
            socksReply,
          ),
        );
      };

      const succeed = (status: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        resolve(status);
      };

      const timer = setTimeout(() => {
        fail(
          `Таймаут клиентской пробы через SOCKS5 (${timeoutMs} мс, этап ${stage})`,
          'TIMEOUT',
        );
      }, timeoutMs);

      sock.once('error', (err) => fail(err.message, 'SOCKET_ERROR'));
      sock.once('end', () => {
        fail(
          `Туннель закрыт до получения ответа (этап ${stage})`,
          'TUNNEL_CLOSED',
        );
      });
      sock.once('close', () => {
        fail(
          `Туннель закрыт до получения ответа (этап ${stage})`,
          'TUNNEL_CLOSED',
        );
      });

      sock.once('connect', () => {
        // SOCKS5 greeting: version 5, 1 auth method, 0x00 (no auth)
        sock.write(Buffer.from([0x05, 0x01, 0x00]));
      });

      sock.on('data', (chunk: Buffer) => {
        if (settled) return;
        buffer = Buffer.concat([buffer, chunk]);
        if (stage === 'greeting') {
          if (buffer.length < 2) return;
          if (buffer[0] !== 0x05 || buffer[1] !== 0x00) {
            fail(
              'SOCKS5 handshake отклонён локальным Xray-клиентом',
              'SOCKS_REJECTED',
            );
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
              'SOCKS_REJECTED',
              buffer[1],
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
            fail('Неожиданный формат ответа SOCKS5', 'INVALID_RESPONSE');
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
          if (!match) {
            fail(
              `Некорректный HTTP-ответ через туннель: ${statusLine}`,
              'INVALID_RESPONSE',
            );
            return;
          }
          succeed(Number(match[1]));
        }
      });
    });
  }

  extractXrayDiagnostic(rawOutput: string): string {
    if (!rawOutput) return '';
    const lines = rawOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          Boolean(line) &&
          !/^Xray\s+\d+/i.test(line) &&
          !/^A unified platform/i.test(line) &&
          !/^Reading config:/i.test(line) &&
          !/core:\s+Xray\s+\d+.*started/i.test(line) &&
          !/likely health check connection/i.test(line),
      );
    if (lines.length === 0) return '';
    const highlighted = [...lines]
      .reverse()
      .find((line) =>
        /(?:failed|error|timeout|refused|reset|eof|rejected|invalid|tls:|reality|status|denied|closed|bad gateway|not found|forbidden|\b(?:400|403|404|405|500|502|503)\b)/i.test(
          line,
        ),
      );
    if (highlighted) return this.sanitizeError(highlighted);
    return this.sanitizeError(lines.slice(-2).join(' | '));
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
