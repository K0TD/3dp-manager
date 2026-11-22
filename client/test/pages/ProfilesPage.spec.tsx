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
          data: [{ id: 'node-1', name: 'EU-1', isMain: true }],
        });
      }
      return Promise.resolve({
        data: [
          {
            id: 'prof-1',
            name: 'SelfSNI Main',
            kind: 'self-sni',
            enabled: true,
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
});
