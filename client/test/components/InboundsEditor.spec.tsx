import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InboundsEditor } from '../../src/components/InboundsEditor';
import { ThemeProvider } from '../../src/ThemeContext';
import type { NodeRecord } from '../../src/types/node';
import type { CountryOption, Domain, InboundConfigUI, Tunnel } from '../../src/types/inbound';

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
});
