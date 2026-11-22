import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfilesPage from '../../src/pages/ProfilesPage';
import { ThemeProvider } from '../../src/ThemeContext';
import api from '../../src/api';

vi.mock('../../src/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('ProfilesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/profiles/catalog') {
        return Promise.resolve({
          data: [
            {
              kind: 'xhttp-stable',
              stage: 1,
              status: 'ready',
              title: 'XHTTP Stable',
              transportSummary: 'VLESS + XHTTP + REALITY',
              description: 'Минимальный XHTTP',
              minXrayVersion: '24.11.30',
              defaults: {},
            },
          ],
        });
      }
      if (url === '/nodes') {
        return Promise.resolve({
          data: [
            {
              id: 'node-1',
              name: 'EU-1',
              domain: 'eu1.example.com',
              webCertificateFile: '/root/cert/eu1/fullchain.pem',
              webKeyFile: '/root/cert/eu1/privkey.pem',
              isMain: true,
            },
          ],
        });
      }
      if (url === '/subscriptions') {
        return Promise.resolve({
          data: [
            { id: 'sub-1', name: 'Main Sub', inboundsConfig: [] },
            {
              id: 'sub-2',
              name: 'Backup Sub',
              inboundsConfig: [{ profileId: 'prof-1', type: 'self-sni', name: 'SelfSNI Main' }],
            },
          ],
        });
      }
      if (url === '/domains/all') {
        return Promise.resolve({
          data: [
            { id: 1, name: 'swdist.apple.com', isEnabled: true },
            { id: 2, name: 'dl.google.com', isEnabled: true },
          ],
        });
      }
      if (url === '/domains/profiles') {
        return Promise.resolve({
          data: {
            profiles: [
              {
                id: 'apple',
                name: 'Apple CDN & Services',
                category: 'Apple',
                description: 'Apple CDN',
                recommendedDomains: ['swdist.apple.com'],
                exact: ['swdist.apple.com'],
                suffix: ['.apple.com'],
                profile: {
                  fingerprint: 'safari',
                  spiderX: '/content/downloads/',
                  xhttpPath: '/download/updates/',
                },
              },
            ],
          },
        });
      }
      return Promise.resolve({
        data: [
          {
            id: 'prof-1',
            name: 'SelfSNI Main',
            kind: 'self-sni',
            enabled: true,
            deployed: true,
            activeInbound: { id: 10, port: 443, remark: 'SelfSNI Main' },
            nodeId: 'node-1',
            port: 443,
            sni: 'portal.example.com',
            rotationPolicy: 'preserve_all',
            spec: { domain: 'portal.example.com', webServer: 'nginx' },
            lastCheckStatus: 'passed',
            lastCheckResult: { compatible: true, status: 'passed', checks: [] },
            activeRevision: 2,
            previousSnapshot: {
              revision: 1,
              savedAt: '2026-11-22T10:00:00.000Z',
              name: 'SelfSNI Old',
              kind: 'self-sni',
              port: 443,
              sni: 'portal.example.com',
              rotationPolicy: 'fixed_domain',
              spec: { domain: 'portal.example.com' },
            },
          },
          {
            id: 'prof-2',
            name: 'XHTTP Draft',
            kind: 'xhttp-stable',
            enabled: true,
            deployed: false,
            nodeId: 'node-1',
            port: null,
            sni: 'swdist.apple.com',
            rotationPolicy: 'fixed_domain',
            spec: { mode: 'auto', path: '/download/updates/', fingerprint: 'safari' },
            lastCheckStatus: 'passed',
            lastCheckResult: { compatible: true, status: 'passed', checks: [] },
            activeRevision: 1,
            previousSnapshot: null,
          },
        ],
      });
    });
  });

  it('loads profiles, runs client probe and manual revision rollback', async () => {
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url === '/profiles/prof-1/probe') {
        return Promise.resolve({
          data: {
            id: 'prof-1',
            source: 'active_inbound',
            checkedAt: '2026-11-22T12:00:00.000Z',
            probe: {
              success: true,
              engine: 'xray-core',
              targetAddress: 'portal.example.com',
              targetPort: 443,
              httpStatusCode: 204,
              latencyMs: 65,
            },
          },
        });
      }
      if (url === '/profiles/prof-1/rollback') {
        return Promise.resolve({ data: { id: 'prof-1', activeRevision: 3 } });
      }
      return Promise.resolve({ data: { status: 'passed' } });
    });

    render(
      <ThemeProvider>
        <ProfilesPage />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('SelfSNI Main')).toBeInTheDocument();
    });
    expect(screen.getByText('rev.2')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Клиентская проба/ })[0]);
    await waitFor(() => {
      expect(screen.getByText(/HTTP 204/)).toBeInTheDocument();
    });
    expect(api.post).toHaveBeenCalledWith('/profiles/prof-1/probe');

    fireEvent.click(screen.getAllByRole('button', { name: /Откатить/ })[0]);
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/profiles/prof-1/rollback');
    });
  });

  it('supports bulk-attaching multiple selected profiles to multiple subscriptions while skipping duplicates', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'op-1' } });

    render(
      <ThemeProvider>
        <ProfilesPage />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('SelfSNI Main')).toBeInTheDocument();
      expect(screen.getByText('XHTTP Draft')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Выбрать профиль SelfSNI Main'));
    fireEvent.click(screen.getByLabelText('Выбрать профиль XHTTP Draft'));

    fireEvent.click(
      screen.getByRole('button', { name: /В подписки \(2\)/ }),
    );

    await waitFor(() => {
      expect(
        screen.getByText('Массовое добавление профилей (2)'),
      ).toBeInTheDocument();
    });

    // Select all subscriptions (Main Sub + Backup Sub)
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }));

    // Fixed port warning should appear because SelfSNI Main has port 443 across >1 sub
    expect(
      screen.getByText(/указан фиксированный порт/),
    ).toBeInTheDocument();

    // Planned additions: Main Sub gets 2, Backup Sub already has prof-1 so gets 1 => total 3
    fireEvent.click(screen.getByRole('button', { name: 'Добавить (3)' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledTimes(2);
      expect(api.put).toHaveBeenCalledWith(
        '/subscriptions/sub-1',
        expect.objectContaining({
          inboundsConfig: expect.arrayContaining([
            expect.objectContaining({ profileId: 'prof-1' }),
            expect.objectContaining({ profileId: 'prof-2' }),
          ]),
        }),
      );
      expect(api.put).toHaveBeenCalledWith(
        '/subscriptions/sub-2',
        expect.objectContaining({
          inboundsConfig: expect.arrayContaining([
            expect.objectContaining({ profileId: 'prof-1' }),
            expect.objectContaining({ profileId: 'prof-2' }),
          ]),
        }),
      );
      expect(api.post).toHaveBeenCalledWith('/rotation/operations', {
        subscriptionIds: ['sub-1', 'sub-2'],
      });
    });
  });

  it('shows dedicated "Nginx и инструкция" button on Self-SNI card and opens directly on the Nginx tab', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        kind: 'self-sni',
        compatibility: { compatible: true, status: 'passed', checks: [] },
        serverPreview: {},
        clientPreview: {
          kind: 'self-sni',
          vlessLink: 'vless://test',
          clientConfig: {},
          xrayClientJson: {},
        },
        webServerConfig: {
          engine: 'nginx',
          purpose: 'self-sni',
          domain: 'portal.example.com',
          filename: '/etc/nginx/sites-available/self-sni-portal.example.com.conf',
          config: 'server { listen 127.0.0.1:8443 ssl http2; }',
          staticSitePath: '/var/www/self-sni/portal.example.com/index.html',
          staticSiteHtml: '<html></html>',
          backupCommand: 'cp bak',
          validateCommand: 'nginx -t',
          reloadCommand: 'systemctl reload nginx',
          rollbackCommand: 'cp rollback',
          notes: ['Nginx слушает 127.0.0.1:8443'],
        },
      },
    });

    render(
      <ThemeProvider>
        <ProfilesPage />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('SelfSNI Main')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Nginx и инструкция/ }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Пошаговая установка Nginx на ноде:/),
      ).toBeInTheDocument();
      expect(
        screen.getByDisplayValue(/listen 127\.0\.0\.1:8443 ssl http2;/),
      ).toBeInTheDocument();
    });
  });

  it('allows selecting a domain from «Домены» in XHTTP Stable dialog and auto-fills its SNI profile', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'prof-new' } });

    render(
      <ThemeProvider>
        <ProfilesPage />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('SelfSNI Main')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Создать XHTTP Stable/ }));

    fireEvent.change(screen.getByLabelText('Название профиля'), {
      target: { value: 'Apple XHTTP' },
    });

    const sniInput = screen.getByLabelText(
      /SNI \(выбор из «Доменов» \/ SNI-профилей или свой\)/,
    );
    fireEvent.mouseDown(sniInput);
    fireEvent.click(await screen.findByText('swdist.apple.com'));

    await waitFor(() => {
      expect(
        screen.getByText(/Применён SNI-профиль: Apple CDN & Services/),
      ).toBeInTheDocument();
    });
    expect(screen.getByLabelText('XHTTP Path')).toHaveValue(
      '/download/updates/',
    );
    expect(screen.getByLabelText('SpiderX')).toHaveValue(
      '/content/downloads/',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/profiles',
        expect.objectContaining({
          name: 'Apple XHTTP',
          kind: 'xhttp-stable',
          sni: 'swdist.apple.com',
          spec: expect.objectContaining({
            fingerprint: 'safari',
            path: '/download/updates/',
            spiderX: '/content/downloads/',
          }),
        }),
      );
    });
  });
});
