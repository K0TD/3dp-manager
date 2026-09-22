/**
 * Explicit live check, without booting Nest or its rotation/cleanup jobs.
 * XUI_CHECK_CONFIG: path to a mode-0600 JSON file {url,token}.
 * XRAY_BINARY: client binary matching the target panel's Xray.
 * Optional: SMOKE_TYPES (comma-separated), SMOKE_SNI, SMOKE_ADDRESS,
 * SMOKE_TARGET (HTTPS URL), SMOKE_ARTIFACT_DIR (private directory).
 */
import 'reflect-metadata';
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomInt, randomUUID } from 'crypto';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { createServer } from 'net';
import { once } from 'events';
import { InboundBuilderService } from '../src/inbounds/inbound-builder.service';
import { XuiInboundRaw } from '../src/inbounds/xui-inbound.types';
import { XuiService } from '../src/xui/xui.service';
import { Node, NodeAuthType } from '../src/nodes/entities/node.entity';
import { SessionService } from '../src/session/session.service';
import { Logger } from '@nestjs/common';
import { safePanelMessage } from '../src/xui/xui-contract';

const runFile = promisify(execFile);

// Parse the published link, rather than copying credentials from the inbound:
// this makes the traffic check detect broken links as well as bad server JSON.
export function outboundFromLink(link: string): Record<string, any> {
  if (link.startsWith('vmess://')) {
    const v = JSON.parse(Buffer.from(link.slice(8), 'base64').toString());
    return {
      protocol: 'vmess',
      settings: {
        vnext: [
          {
            address: v.add,
            port: Number(v.port),
            users: [{ id: v.id, security: 'auto' }],
          },
        ],
      },
      streamSettings: { network: v.net, security: v.tls || 'none' },
    };
  }
  const url = new URL(link);
  const p = url.searchParams;
  const address = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port);
  const credential = decodeURIComponent(url.username);
  if (url.protocol === 'ss:') {
    const [method, ...password] = Buffer.from(credential, 'base64url')
      .toString()
      .split(':');
    return {
      protocol: 'shadowsocks',
      settings: {
        servers: [{ address, port, method, password: password.join(':') }],
      },
    };
  }
  const stream: Record<string, any> = {
    network: p.get('type') || 'tcp',
    security: p.get('security') || 'none',
  };
  if (stream.security === 'reality')
    stream.realitySettings = {
      serverName: p.get('sni'),
      fingerprint: p.get('fp'),
      publicKey: p.get('pbk'),
      shortId: p.get('sid'),
      spiderX: p.get('spx'),
    };
  if (stream.security === 'tls')
    stream.tlsSettings = {
      serverName: p.get('sni'),
      fingerprint: p.get('fp') || 'chrome',
      ...(p.has('alpn') ? { alpn: p.get('alpn')!.split(',') } : {}),
    };
  if (stream.network === 'ws')
    stream.wsSettings = {
      path: p.get('path') || '/',
      host: p.get('host') || '',
    };
  if (stream.network === 'grpc')
    stream.grpcSettings = {
      serviceName: p.get('serviceName'),
      authority: p.get('authority'),
      multiMode: p.get('mode') === 'multi',
    };
  if (stream.network === 'xhttp')
    stream.xhttpSettings = {
      path: p.get('path'),
      host: p.get('host'),
      mode: p.get('mode') || 'auto',
    };
  if (url.protocol === 'hy2:') {
    stream.network = 'hysteria';
    stream.hysteriaSettings = { version: 2, auth: credential };
    if (p.has('fm')) stream.finalmask = JSON.parse(p.get('fm')!);
    return {
      protocol: 'hysteria',
      settings: { version: 2, address, port },
      streamSettings: stream,
    };
  }
  if (url.protocol === 'trojan:')
    return {
      protocol: 'trojan',
      settings: { servers: [{ address, port, password: credential }] },
      streamSettings: stream,
    };
  if (url.protocol === 'vless:')
    return {
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address,
            port,
            users: [
              { id: credential, encryption: 'none', flow: p.get('flow') || '' },
            ],
          },
        ],
      },
      streamSettings: stream,
    };
  throw new Error(`No traffic adapter for ${url.protocol}`);
}

async function localPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export async function checkTraffic(
  link: string,
  binary: string,
  target: string,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), '3dp-xray-smoke-'));
  const port = await localPort();
  const path = join(directory, 'client.json');
  writeFileSync(
    path,
    JSON.stringify({
      log: { loglevel: 'warning' },
      inbounds: [
        {
          listen: '127.0.0.1',
          port,
          protocol: 'socks',
          settings: { auth: 'noauth', udp: true },
        },
      ],
      outbounds: [outboundFromLink(link)],
    }),
    { mode: 0o600 },
  );
  const client = spawn(binary, ['run', '-c', path], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let startupError = false;
  client.on('error', () => {
    startupError = true;
  });
  let diagnostics = '';
  const collect = (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-1500);
  };
  client.stdout?.on('data', collect);
  client.stderr?.on('data', collect);
  try {
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (startupError || client.exitCode !== null)
      throw new Error(
        `Xray client failed to start: ${safePanelMessage(diagnostics)}`,
      );
    await runFile(
      'curl',
      [
        '--silent',
        '--show-error',
        '--fail',
        '--max-time',
        '15',
        '--noproxy',
        '',
        '--proxy',
        `socks5h://127.0.0.1:${port}`,
        target,
        '-o',
        '/dev/null',
      ],
      { timeout: 18000 },
    );
  } catch (error) {
    // execFile errors include arguments; only surface the exit code.
    if ((error as any).code)
      throw new Error(`Proxy HTTPS failed (exit ${(error as any).code})`);
    throw error;
  } finally {
    if (!startupError && client.exitCode === null) {
      const exited = once(client, 'exit');
      client.kill('SIGTERM');
      const killTimer = setTimeout(() => client.kill('SIGKILL'), 2000);
      await exited;
      clearTimeout(killTimer);
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  Logger.overrideLogger(['error', 'warn']);
  const configPath = process.env.XUI_CHECK_CONFIG;
  const binary = process.env.XRAY_BINARY;
  if (!configPath || !binary)
    throw new Error('Set XUI_CHECK_CONFIG and XRAY_BINARY');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const node = {
    id: 'smoke',
    name: 'smoke',
    url: config.url,
    token: config.token,
    authType: NodeAuthType.Token,
    allowInvalidTls: config.allowInvalidTls === true,
  } as Node;
  const api = new XuiService(
    { find: async () => [] } as any,
    new SessionService(),
  );
  const builder = new InboundBuilderService();
  const profile = await api.checkNodeConnection(node);
  if (!profile.success) throw new Error(profile.message);
  console.log(
    JSON.stringify({
      panelVersion: profile.version,
      xrayVersion: profile.xrayVersion,
      xrayState: profile.xrayState,
    }),
  );
  const keys = await api.getNewX25519Cert(node);
  const cert = await api.getWebCertificateFiles(node);
  if (!keys || !cert)
    throw new Error('Reality keys or panel certificate unavailable');
  const address = process.env.SMOKE_ADDRESS || new URL(config.url).hostname;
  const serverName = new URL(config.url).hostname;
  const sni = process.env.SMOKE_SNI || 'www.cloudflare.com';
  const cases: Record<string, (port: number, uuid: string) => XuiInboundRaw> = {
    'vless-tcp-reality': (port, uuid) =>
      builder.buildVlessRealityTcp({ port, uuid, sni, ...keys }),
    'vless-grpc-reality': (port, uuid) =>
      builder.buildVlessRealityGrpc({ port, uuid, sni, ...keys }),
    'vless-xhttp-reality': (port, uuid) =>
      builder.buildVlessRealityXhttp({ port, uuid, sni, ...keys }),
    'vless-ws': (port, uuid) => builder.buildVlessWs({ port, uuid, sni }),
    'vless-tcp-tls': (port, uuid) =>
      builder.buildVlessTlsTcp({ port, uuid, serverName, ...cert }),
    'vless-ws-tls': (port, uuid) =>
      builder.buildVlessTlsWs({ port, uuid, serverName, ...cert }),
    'vmess-tcp': (port, uuid) => builder.buildVmessTcp({ port, uuid }),
    'shadowsocks-tcp': (port, uuid) =>
      builder.buildShadowsocksTcp({ port, uuid }),
    'trojan-tcp-reality': (port, uuid) =>
      builder.buildTrojanRealityTcp({ port, uuid, sni, ...keys }),
    'hysteria2-udp': (port, uuid) =>
      builder.buildHysteria2Inbound({ port, uuid, serverName, ...cert }),
  };
  const selected =
    process.env.SMOKE_TYPES?.split(',') ||
    Object.keys(cases).filter((type) => type !== 'vless-ws');
  const results: Record<string, unknown>[] = [];
  for (const type of selected) {
    if (!cases[type]) throw new Error(`Unknown smoke type: ${type}`);
    const config = cases[type](randomInt(20000, 60000), randomUUID());
    config.remark = `3dp-smoke-${type}-${Date.now()}`;
    let remoteId: number | undefined;
    const result: Record<string, unknown> = {
      type,
      created: false,
      traffic: false,
      deleted: false,
    };
    try {
      const created = await api.addInbound(config, node);
      if (!created) throw new Error(api.getLastInboundError(node));
      remoteId = created.id;
      result.created = true;
      result.port = created.inbound.port;
      if (created.verificationError) throw new Error(created.verificationError);
      await api.waitForXray(node);
      const link = builder.buildInboundLink(created.inbound, address, '', '');
      if (process.env.SMOKE_ARTIFACT_DIR) {
        mkdirSync(process.env.SMOKE_ARTIFACT_DIR, {
          recursive: true,
          mode: 0o700,
        });
        writeFileSync(
          join(process.env.SMOKE_ARTIFACT_DIR, `${type}.json`),
          JSON.stringify({ inbound: created.inbound, link }),
          { mode: 0o600 },
        );
      }
      await checkTraffic(
        link,
        binary,
        process.env.SMOKE_TARGET || 'https://www.cloudflare.com/cdn-cgi/trace',
      );
      result.traffic = true;
    } catch (error) {
      result.error =
        error instanceof Error ? error.message : 'Smoke check failed';
    } finally {
      if (remoteId) result.deleted = await api.deleteInbound(remoteId, node);
    }
    results.push(result);
    console.log(JSON.stringify(result));
    if (remoteId && !result.deleted) {
      console.error(
        `Cleanup failed for temporary inbound ID ${remoteId}; stopping.`,
      );
      break;
    }
  }
  process.exitCode = results.some((r) => !r.traffic || !r.deleted) ? 1 : 0;
}

if (require.main === module)
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Smoke check failed',
    );
    process.exitCode = 1;
  });
