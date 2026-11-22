import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfilePreviewDialog } from '../../src/components/ProfilePreviewDialog';
import { ThemeProvider } from '../../src/ThemeContext';
import api from '../../src/api';

vi.mock('../../src/api', () => ({
  default: {
    post: vi.fn(),
  },
}));

describe('ProfilePreviewDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches preview, renders compatibility checks, VLESS link, Xray JSON, and redacted server inbound', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        kind: 'xhttp-stable',
        compatibility: {
          compatible: true,
          status: 'passed',
          checks: [
            {
              code: 'XRAY_VERSION_OK',
              severity: 'ok',
              title: 'Версия Xray совместима',
              message: 'Xray 26.7.11 поддерживает XHTTP (stream-one).',
            },
          ],
        },
        serverPreview: {
          protocol: 'vless',
          streamSettings: {
            realitySettings: { privateKey: '<server-only:redacted>' },
          },
        },
        clientPreview: {
          kind: 'xhttp-stable',
          vlessLink:
            'vless://00000000-0000-4000-8000-000000000000@eu.example.com:443?type=xhttp&mode=stream-one#preview',
          clientConfig: {},
          xrayClientJson: {
            log: { loglevel: 'warning' },
            outbounds: [{ tag: 'proxy', protocol: 'vless' }],
          },
        },
      },
    });

    render(
      <ThemeProvider>
        <ProfilePreviewDialog
          open
          onClose={vi.fn()}
          kind="xhttp-stable"
          name="Test XHTTP"
          nodeId="node-1"
          port="443"
          sni="www.microsoft.com"
          settings={{ mode: 'stream-one', fingerprint: 'firefox' }}
        />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Совместимо')).toBeInTheDocument();
    });
    expect(screen.getByText(/Версия Xray совместима/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/mode=stream-one/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Xray JSON (клиент)' }));
    expect(screen.getByDisplayValue(/"protocol": "vless"/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('tab', { name: 'Серверный inbound (3x-ui)' }),
    );
    expect(
      screen.getByDisplayValue(/<server-only:redacted>/),
    ).toBeInTheDocument();
  });

  it('renders Nginx config tab for Self-SNI and triggers liveCheck when clicking check button', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: {
          kind: 'self-sni',
          compatibility: {
            compatible: true,
            status: 'passed',
            checks: [
              {
                code: 'SELF_SNI_DOMAIN_OK',
                severity: 'ok',
                title: 'Собственный домен настроен',
                message: 'Self-SNI использует portal.example.com',
              },
            ],
          },
          serverPreview: { protocol: 'vless' },
          clientPreview: {
            kind: 'self-sni',
            vlessLink:
              'vless://00000000-0000-4000-8000-000000000000@portal.example.com:443?type=tcp&security=reality&flow=xtls-rprx-vision#self',
            clientConfig: {},
            xrayClientJson: { outbounds: [] },
          },
          webServerConfig: {
            engine: 'nginx',
            purpose: 'self-sni',
            domain: 'portal.example.com',
            filename: '/etc/nginx/sites-available/self-sni-portal.example.com.conf',
            config: 'server { listen 127.0.0.1:8443 ssl http2; }',
            staticSiteHtml: '<html></html>',
            backupCommand: 'sudo cp a b',
            validateCommand: 'sudo nginx -t',
            reloadCommand: 'sudo systemctl reload nginx',
            rollbackCommand: 'sudo cp b a',
            notes: ['Слушает только 127.0.0.1:8443'],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          kind: 'self-sni',
          compatibility: {
            compatible: true,
            status: 'passed',
            checks: [
              {
                code: 'TLS_CERT_OK',
                severity: 'ok',
                title: 'TLS-сертификат валиден',
                message: 'Осталось 70 дн.',
              },
            ],
          },
          serverPreview: { protocol: 'vless' },
          clientPreview: {
            kind: 'self-sni',
            vlessLink: 'vless://00000000-0000-4000-8000-000000000000@portal.example.com:443?flow=xtls-rprx-vision#self',
            clientConfig: {},
            xrayClientJson: { outbounds: [] },
          },
          tlsProbe: {
            domain: 'portal.example.com',
            port: 443,
            reachable: true,
            dnsResolvedIps: ['203.0.113.55'],
            tlsProtocol: 'TLSv1.3',
            alpnProtocol: 'h2',
            httpStatusCode: 200,
            durationMs: 25,
          },
        },
      });

    render(
      <ThemeProvider>
        <ProfilePreviewDialog
          open
          onClose={vi.fn()}
          kind="self-sni"
          name="Portal"
          nodeId="node-1"
          port="443"
          settings={{
            domain: 'portal.example.com',
            webServer: 'nginx',
            localHttpsPort: 8443,
          }}
        />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: 'Nginx конфиг' }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Nginx конфиг' }));
    expect(
      screen.getByDisplayValue(/listen 127\.0\.0\.1:8443 ssl http2/),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: /Проверить домен и сертификат \(live\)/,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/TLS: TLSv1\.3/)).toBeInTheDocument();
    });
    expect(vi.mocked(api.post)).toHaveBeenLastCalledWith(
      '/profiles/preview',
      expect.objectContaining({ liveCheck: true }),
    );
  });
});
