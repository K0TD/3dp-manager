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
          data: [{ id: 'sub-1', name: 'Main Sub', inboundsConfig: [] }],
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

    fireEvent.click(screen.getByRole('button', { name: /Клиентская проба/ }));
    await waitFor(() => {
      expect(screen.getByText(/HTTP 204/)).toBeInTheDocument();
    });
    expect(api.post).toHaveBeenCalledWith('/profiles/prof-1/probe');

    fireEvent.click(screen.getByRole('button', { name: /Откатить/ }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/profiles/prof-1/rollback');
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
