import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NodesPage from '../../src/pages/NodesPage';
import { ThemeProvider } from '../../src/ThemeContext';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../src/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

describe('NodesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((url: string) => {
      if (url === '/nodes') {
        return Promise.resolve({
          data: [
            { id: 'node-1', name: 'Main Node', url: 'https://main.test:2053', isMain: true, flag: '🇩🇪' },
          ],
        });
      }
      if (url === '/settings/countries') {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: {} });
    });
    mockDelete.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows warning alert about last node and preserves subscriptions when 1 node remains', async () => {
    render(
      <ThemeProvider>
        <NodesPage />
      </ThemeProvider>,
    );

    expect(await screen.findByText('Main Node')).toBeInTheDocument();

    const deleteBtn = screen.getByRole('button', { name: /Удалить Main Node/ });
    fireEvent.click(deleteBtn);

    expect(await screen.findByText('Удалить ноду Main Node?')).toBeInTheDocument();

    // Verify last-node alert is displayed with correct wording:
    const alert = screen.getByText(/Это последняя нода/);
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain(
      'Это последняя нода. Подписки сохранятся, но их подключения останутся без рабочей ноды. При принудительном или отложенном удалении подключения будут отключены — после добавления новой ноды откройте подписку и сохраните её, чтобы активировать их заново.',
    );
    // Ensure it does NOT claim subscriptions will be deleted
    expect(alert.textContent).not.toContain('будут удалены все подписки');
  });

  it('does NOT show last-node warning when multiple nodes exist', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/nodes') {
        return Promise.resolve({
          data: [
            { id: 'node-1', name: 'Main Node', url: 'https://main.test:2053', isMain: true },
            { id: 'node-2', name: 'Secondary Node', url: 'https://sec.test:2053', isMain: false },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <ThemeProvider>
        <NodesPage />
      </ThemeProvider>,
    );

    expect(await screen.findByText('Main Node')).toBeInTheDocument();
    expect(screen.getByText('Secondary Node')).toBeInTheDocument();

    const deleteBtn = screen.getByRole('button', { name: /Удалить Main Node/ });
    fireEvent.click(deleteBtn);

    expect(await screen.findByText('Удалить ноду Main Node?')).toBeInTheDocument();
    expect(screen.queryByText(/Это последняя нода/)).not.toBeInTheDocument();
  });

  it('deletes safely when clicking "Удалить безопасно"', async () => {
    render(
      <ThemeProvider>
        <NodesPage />
      </ThemeProvider>,
    );

    const deleteBtn = await screen.findByRole('button', { name: /Удалить Main Node/ });
    fireEvent.click(deleteBtn);

    const safeBtn = screen.getByRole('button', { name: 'Удалить безопасно' });
    fireEvent.click(safeBtn);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/nodes/node-1', {
        params: { mode: 'safe' },
      });
    });
  });

  it('deletes forcefully when clicking "Удалить принудительно"', async () => {
    mockDelete.mockResolvedValueOnce({ data: { success: true, forced: true } });

    render(
      <ThemeProvider>
        <NodesPage />
      </ThemeProvider>,
    );

    const deleteBtn = await screen.findByRole('button', { name: /Удалить Main Node/ });
    fireEvent.click(deleteBtn);

    const forceBtn = screen.getByRole('button', { name: 'Удалить принудительно' });
    fireEvent.click(forceBtn);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/nodes/node-1', {
        params: { mode: 'force' },
      });
    });
  });

  it('cancels deletion without sending DELETE request', async () => {
    render(
      <ThemeProvider>
        <NodesPage />
      </ThemeProvider>,
    );

    const deleteBtn = await screen.findByRole('button', { name: /Удалить Main Node/ });
    fireEvent.click(deleteBtn);

    expect(await screen.findByText('Удалить ноду Main Node?')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: 'Отмена' });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText('Удалить ноду Main Node?')).not.toBeInTheDocument();
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('masks saved secrets in edit dialog and preserves credentials when checking or saving new URL', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/nodes') {
        return Promise.resolve({
          data: [
            {
              id: 'node-1',
              name: 'Main Node',
              url: 'https://old.example.com:2053',
              domain: 'old.example.com',
              ip: '198.51.100.1',
              flag: '🇩🇪',
              authType: 'token',
              hasToken: true,
              isMain: true,
              allowInvalidTls: false,
            },
          ],
        });
      }
      if (url === '/settings/countries') {
        return Promise.resolve({
          data: [{ name: 'Germany', code: 'DE', emoji: '🇩🇪' }],
        });
      }
      return Promise.resolve({ data: {} });
    });
    mockPost.mockResolvedValue({
      data: {
        success: true,
        version: '3.11.0',
        xrayVersion: '26.11.9',
        responseTimeMs: 45,
      },
    });
    mockPut.mockResolvedValue({ data: { id: 'node-1' } });

    render(
      <ThemeProvider>
        <NodesPage />
      </ThemeProvider>,
    );

    const editBtn = await screen.findByRole('button', { name: /Редактировать Main Node/ });
    fireEvent.click(editBtn);

    const tokenInput = screen.getByLabelText(/^Токен/) as HTMLInputElement;
    expect(tokenInput.value).toBe('••••••••••••••••');
    expect(tokenInput.type).toBe('password');
    expect(screen.getByText('Сохранён')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Заменить' })).toBeInTheDocument();

    const urlInput = screen.getByLabelText(/URL панели 3x-ui/);
    fireEvent.change(urlInput, { target: { value: 'https://203.0.113.55:2053/panel' } });

    expect((screen.getByLabelText(/Домен ноды/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/IP ноды/) as HTMLInputElement).value).toBe('203.0.113.55');

    fireEvent.click(screen.getByRole('button', { name: 'Проверить подключение' }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/nodes/check',
        expect.objectContaining({
          nodeId: 'node-1',
          url: 'https://203.0.113.55:2053/panel',
          ip: '203.0.113.55',
          authType: 'token',
        }),
      );
    });
    const checkCall = mockPost.mock.calls.find(([path]) => path === '/nodes/check');
    expect(checkCall?.[1]).not.toHaveProperty('token', '••••••••••••••••');
    expect(checkCall?.[1]?.token).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith(
        '/nodes/node-1',
        expect.objectContaining({
          url: 'https://203.0.113.55:2053/panel',
          domain: '',
          ip: '203.0.113.55',
          syncSubscriptionLinks: true,
        }),
      );
    });
    const putCall = mockPut.mock.calls[0];
    expect(putCall?.[1]?.token).toBeUndefined();
  });

  it('supports fast address migration dialog without re-entering secrets', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/nodes') {
        return Promise.resolve({
          data: [
            {
              id: 'node-1',
              name: 'Main Node',
              url: 'https://blocked.example.com:2053',
              domain: 'blocked.example.com',
              ip: '198.51.100.1',
              flag: '🇩🇪',
              authType: 'password',
              login: 'admin',
              hasPassword: true,
              isMain: true,
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    mockPost.mockImplementation((url: string) => {
      if (url === '/nodes/check') {
        return Promise.resolve({
          data: {
            success: true,
            version: '3.11.0',
            xrayVersion: '26.11.9',
            responseTimeMs: 32,
          },
        });
      }
      if (url === '/nodes/node-1/migrate-address') {
        return Promise.resolve({
          data: {
            node: { id: 'node-1', name: 'Main Node' },
            connection: { success: true, version: '3.11.0', xrayVersion: '26.11.9' },
            updatedInbounds: 4,
            affectedTunnels: 0,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(
      <ThemeProvider>
        <NodesPage />
      </ThemeProvider>,
    );

    const migrateBtn = await screen.findByRole('button', {
      name: /Быстрая смена адреса Main Node/,
    });
    fireEvent.click(migrateBtn);

    expect(
      await screen.findByText(/Токен\/пароль панели сохраняются автоматически/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/IP ноды/), {
      target: { value: '198.51.100.77' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Перейти на прямой IP' }));

    expect((screen.getByLabelText(/Новый URL панели 3x-ui/) as HTMLInputElement).value).toBe(
      'https://198.51.100.77:2053',
    );
    expect(
      (screen.getByLabelText(/Домен ноды/) as HTMLInputElement).value,
    ).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Проверить новый адрес' }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/nodes/check',
        expect.objectContaining({
          nodeId: 'node-1',
          url: 'https://198.51.100.77:2053',
          ip: '198.51.100.77',
          allowInvalidTls: true,
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Применить и адаптировать' }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/nodes/node-1/migrate-address',
        expect.objectContaining({
          url: 'https://198.51.100.77:2053',
          domain: '',
          ip: '198.51.100.77',
          allowInvalidTls: true,
          syncSubscriptionLinks: true,
          preferDirectIp: false,
        }),
      );
    });
  });
});
