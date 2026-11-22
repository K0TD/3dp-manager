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
});
