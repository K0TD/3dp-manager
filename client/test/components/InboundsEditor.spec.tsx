import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InboundsEditor } from '../../src/components/InboundsEditor';
import { ThemeProvider } from '../../src/ThemeContext';
import type { NodeRecord } from '../../src/types/node';
import type { CountryOption, Domain, InboundConfigUI, Tunnel } from '../../src/types/inbound';

vi.mock('../../src/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('InboundsEditor', () => {
  const mockNodes: NodeRecord[] = [
    {
      id: 'node-1',
      name: 'Main Server',
      url: 'https://main.example.com',
      isMain: true,
      order: 1,
      flag: '🇩🇪',
      domain: 'main.example.com',
      capabilities: {
        version: '2.0.0',
        xrayVersion: '1.8.0',
        isCustomXray: false,
        supportedInboundTypes: ['vless-tcp-reality', 'hysteria2-udp'],
        autoTlsCertificate: true,
      },
    },
    {
      id: 'node-2',
      name: 'Secondary Server',
      url: 'https://sec.example.com',
      isMain: false,
      order: 2,
      flag: '🇫🇮',
      domain: 'sec.example.com',
      capabilities: {
        version: '2.0.0',
        xrayVersion: '1.8.0',
        isCustomXray: false,
        supportedInboundTypes: ['vless-tcp-reality'],
        autoTlsCertificate: false,
      },
    },
  ];

  const mockTunnels: Tunnel[] = [
    { id: 101, name: 'Relay 1', ip: '1.1.1.1', domain: '', isInstalled: true, nodeId: 'node-1' },
    { id: 202, name: 'Relay 2', ip: '2.2.2.2', domain: '', isInstalled: true, nodeId: 'node-2' },
  ];

  const mockDomains: Domain[] = [
    { id: 1, name: 'domain1.com', isEnabled: true },
    { id: 2, name: 'domain2.com', isEnabled: true },
  ];

  const mockCountries: CountryOption[] = [
    { name: 'Германия', code: 'DE', emoji: '🇩🇪' },
    { name: 'Финляндия', code: 'FI', emoji: '🇫🇮' },
  ];

  const initialInbounds: InboundConfigUI[] = [
    {
      id: 'inb-1',
      configId: 'cfg-1',
      type: 'vless-tcp-reality',
      port: 'random',
      sni: 'domain1.com',
      nodeId: 'node-1',
      flag: '🇩🇪',
      name: 'Node 1 Inbound',
    },
    {
      id: 'inb-2',
      configId: 'cfg-2',
      type: 'vless-tcp-reality',
      port: '8443',
      sni: 'random',
      nodeId: 'node-2',
      flag: '🇫🇮',
      name: 'Node 2 Inbound',
    },
  ];

  const renderEditor = (props?: Partial<React.ComponentProps<typeof InboundsEditor>>) => {
    const handleChange = vi.fn();
    const handlePortErrorsChange = vi.fn();
    const handleResetDefaults = vi.fn();

    const utils = render(
      <ThemeProvider>
        <InboundsEditor
          inbounds={initialInbounds}
          onChange={handleChange}
          nodes={mockNodes}
          tunnels={mockTunnels}
          domains={mockDomains}
          countries={mockCountries}
          onPortErrorsChange={handlePortErrorsChange}
          onResetDefaults={handleResetDefaults}
          {...props}
        />
      </ThemeProvider>,
    );

    return { ...utils, handleChange, handlePortErrorsChange, handleResetDefaults };
  };

  it('renders all inbound items and their node labels', () => {
    renderEditor();

    expect(screen.getByText('Инбаунды (2/20)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Node 1 Inbound')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Node 2 Inbound')).toBeInTheDocument();
    expect(screen.getByText('Main Server (основная)')).toBeInTheDocument();
    expect(screen.getByText('Secondary Server')).toBeInTheDocument();
  });

  it('calls onChange with a new inbound when adding', () => {
    const { handleChange } = renderEditor();

    fireEvent.click(screen.getByText('Добавить инбаунд'));
    expect(handleChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'inb-1' }),
        expect.objectContaining({ id: 'inb-2' }),
        expect.objectContaining({ type: 'vless-tcp-reality' }),
      ]),
    );
  });

  it('calls onChange with reordered items when moving with arrows', () => {
    const { handleChange } = renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Переместить строку 1 вниз' }));
    expect(handleChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'inb-2' }),
      expect.objectContaining({ id: 'inb-1' }),
    ]);
  });

  it('calls onChange when deleting an inbound', () => {
    const { handleChange } = renderEditor();

    const deleteButtons = screen.getAllByTestId('icon-Delete');
    fireEvent.click(deleteButtons[0].closest('button')!);

    expect(handleChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'inb-2' }),
    ]);
  });

  it('allows deleting the sole AWG and protects its connection settings', () => {
    const { handleChange } = renderEditor({ inbounds: [{
      ...initialInbounds[0], type: 'amneziawg', awgLocked: true,
    }] });
    expect(screen.getByLabelText('Порт')).toBeDisabled();
    const selects = screen.getAllByRole('combobox');
    expect(selects.slice(0, 3).every((select) => select.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(screen.getByLabelText('Название')).not.toBeDisabled();
    expect(screen.getByText(/не участвуют в общей ротации/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('icon-Delete').closest('button')!);
    expect(handleChange).toHaveBeenCalledWith([]);
  });

  it('shows certificate fields for the XHTTP TLS option', () => {
    renderEditor({ inbounds: [{ ...initialInbounds[0], type: 'vless-xhttp-tls', certificateMode: 'custom' }] });
    expect(screen.getByLabelText('Сертификат')).toBeInTheDocument();
    expect(screen.getByLabelText('Приватный ключ')).toBeInTheDocument();
    expect(screen.getByLabelText('TLS server name')).toBeEnabled();
    expect(screen.queryByLabelText('SNI')).not.toBeInTheDocument();
  });

  it('calls onResetDefaults when clicking "Сбросить по умолчанию"', () => {
    const { handleResetDefaults } = renderEditor();

    fireEvent.click(screen.getByText('Сбросить по умолчанию'));
    expect(handleResetDefaults).toHaveBeenCalled();
  });

  it('validates port input and notifies error callback', () => {
    const { handlePortErrorsChange } = renderEditor();

    const portInputs = screen.getAllByLabelText('Порт');
    fireEvent.change(portInputs[0], { target: { value: '99999' } });

    expect(handlePortErrorsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        'inb-1': 'Порт: число 1-65535 или random',
      }),
    );
  });

  it('renders extraActions when provided', () => {
    renderEditor({ extraActions: <button type="button">Extra Action</button> });
    expect(screen.getByText('Extra Action')).toBeInTheDocument();
  });

  it('renders routing profiles with multiline field and without port/node/sni', () => {
    const { handleChange } = renderEditor({
      inbounds: [
        {
          id: 'inb-happ',
          configId: 'cfg-happ',
          type: 'happ-routing',
          port: '',
          sni: '',
          routingProfile: 'happ://routing/off',
        },
      ],
    });

    expect(screen.getByLabelText('Профиль Happ routing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('happ://routing/off')).toBeInTheDocument();
    expect(screen.queryByLabelText('Порт')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Нода')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('SNI')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Профиль Happ routing'), {
      target: { value: '{"rules":[]}' },
    });
    expect(handleChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'inb-happ',
        routingProfile: '{"rules":[]}',
      }),
    ]);
  });

  it.each(['custom', 'happ-routing', 'incy-routing'])('restores a random port when switching %s to an ordinary type', async (type) => {
    const { handleChange } = renderEditor({ inbounds: [{ id: 'row', configId: 'cfg', type, port: '', sni: '' }] });
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'vless-tcp-reality' }));
    expect(handleChange).toHaveBeenCalledWith([expect.objectContaining({ type: 'vless-tcp-reality', port: 'random' })]);
  });

  it('does not count routing profiles in the connection count limit', () => {
    // 2 connections + 2 routing profiles = 2/20
    renderEditor({
      inbounds: [
        initialInbounds[0],
        initialInbounds[1],
        {
          id: 'inb-happ',
          configId: 'cfg-happ',
          type: 'happ-routing',
          port: '',
          sni: '',
          routingProfile: '{}',
        },
        {
          id: 'inb-incy',
          configId: 'cfg-incy',
          type: 'incy-routing',
          port: '',
          sni: '',
          routingProfile: '{}',
        },
      ],
    });

    expect(screen.getByText('Инбаунды (2/20)')).toBeInTheDocument();
    expect(screen.getByText('Добавить инбаунд')).toBeEnabled();
  });

  it('shows ordinary XHTTP Reality in the type selector and hides managed profiles', () => {
    renderEditor({ inbounds: [initialInbounds[0]] });
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    expect(screen.getByRole('option', { name: /vless-xhttp-reality/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /XHTTP Stable|Self-SNI|HTTPS Fallback/ })).not.toBeInTheDocument();
  });

  it('renders XHTTP Stable settings, validates conflicting XMUX ranges, and opens preview button', () => {
    renderEditor({
      nodes: [
        {
          ...mockNodes[0],
          capabilities: {
            ...mockNodes[0].capabilities!,
            supportedInboundTypes: ['vless-tcp-reality', 'xhttp-stable'],
          },
        },
      ],
      inbounds: [
        {
          id: 'inb-xhttp',
          configId: 'cfg-xhttp',
          type: 'xhttp-stable',
          port: '443',
          sni: 'domain1.com',
          nodeId: 'node-1',
          flag: '🇩🇪',
          name: 'Stable XHTTP',
          profileSettings: {
            mode: 'stream-one',
            path: '/',
            fingerprint: 'chrome',
            rotationPolicy: 'fixed_domain',
            xmux: {
              enabled: true,
              maxConcurrency: '16-32',
              maxConnections: '4-8',
            },
          },
        },
      ],
    });

    expect(
      screen.getByText(/Параметры XHTTP берутся из выбранного SNI/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/maxConcurrency, либо maxConnections/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Предпросмотр и проверка/ }),
    ).toBeInTheDocument();

    expect(screen.queryByLabelText('XHTTP Path')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('SpiderX')).not.toBeInTheDocument();
  });

  it('renders Self-SNI settings, validates Xray vs local HTTPS port conflict, and syncs own domain', () => {
    const { handleChange } = renderEditor({
      nodes: [
        {
          ...mockNodes[0],
          capabilities: {
            ...mockNodes[0].capabilities!,
            supportedInboundTypes: ['vless-tcp-reality', 'self-sni'],
          },
        },
      ],
      inbounds: [
        {
          id: 'inb-self-sni',
          configId: 'cfg-self-sni',
          type: 'self-sni',
          port: '8443',
          sni: 'portal.example.com',
          nodeId: 'node-1',
          flag: '🇩🇪',
          name: 'Portal SelfSNI',
          profileSettings: {
            domain: 'portal.example.com',
            webServer: 'nginx',
            localHttpsPort: 8443,
            fingerprint: 'chrome',
            xver: 0,
            rotationPolicy: 'fixed_domain',
          },
        },
      ],
    });

    expect(
      screen.getByText(/Self-SNI · VLESS \+ RAW \+ REALITY \+ Vision/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Порт Xray \(8443\) не должен совпадать/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Предпросмотр/,
      }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Собственный домен (Self-SNI)'), {
      target: { value: 'edge.example.org' },
    });
    expect(handleChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'inb-self-sni',
        sni: 'edge.example.org',
        profileSettings: expect.objectContaining({
          domain: 'edge.example.org',
        }),
      }),
    ]);
  });

  it('renders HTTPS Fallback settings, validates reverse proxy port conflict, and hides panel TLS block behind proxy', () => {
    const { handleChange } = renderEditor({
      nodes: [
        {
          ...mockNodes[0],
          capabilities: {
            ...mockNodes[0].capabilities!,
            supportedInboundTypes: ['vless-tcp-reality', 'https-fallback'],
          },
        },
      ],
      inbounds: [
        {
          id: 'inb-fallback',
          configId: 'cfg-fallback',
          type: 'https-fallback',
          port: '443',
          sni: '',
          nodeId: 'node-1',
          flag: '🇩🇪',
          name: 'Fallback Proxy',
          tlsServerName: 'fb.example.com',
          profileSettings: {
            domain: 'fb.example.com',
            path: '/api/v2/stream',
            mode: 'auto',
            reverseProxy: 'nginx',
            publicPort: 443,
            fingerprint: 'chrome',
            rotationPolicy: 'fixed_domain',
          },
        },
      ],
    });

    expect(
      screen.getByText(/HTTPS Fallback · независимый VLESS \+ XHTTP \+ TLS/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Внутренний порт Xray \(443\) не должен совпадать/),
    ).toBeInTheDocument();
    expect(screen.queryByText('TLS панели ноды')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Предпросмотр/ }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Endpoint Path (выделенный)'), {
      target: { value: '/api/v3/tunnel' },
    });
    expect(handleChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'inb-fallback',
        profileSettings: expect.objectContaining({
          path: '/api/v3/tunnel',
        }),
      }),
    ]);
  });

  it('uses the selected SNI without a separate apply action', () => {
    renderEditor({
      domains: [
        ...mockDomains,
        { id: 3, name: 'swdist.apple.com', isEnabled: true },
      ],
      nodes: [
        {
          ...mockNodes[0],
          capabilities: {
            ...mockNodes[0].capabilities!,
            supportedInboundTypes: ['vless-tcp-reality', 'xhttp-stable'],
          },
        },
      ],
      inbounds: [
        {
          id: 'inb-xhttp-sni',
          configId: 'cfg-xhttp-sni',
          type: 'xhttp-stable',
          port: '443',
          sni: 'swdist.apple.com',
          nodeId: 'node-1',
          flag: '🇩🇪',
          name: 'Apple XHTTP',
          profileSettings: {
            mode: 'auto',
            path: '/',
            fingerprint: 'chrome',
            spiderX: '/',
            rotationPolicy: 'fixed_domain',
          },
        },
      ],
    });

    expect(
      screen.getByText(/Профиль: Apple \(safari, \/download\/updates\/\)/),
    ).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /Из SNI-профиля/ })).not.toBeInTheDocument();
  });
});
