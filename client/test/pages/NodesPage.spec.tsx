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
    expect(alert.textContent).toContain('Подписки сохранятся, но их подключения будут переведены на «Основную ноду» и отключены до добавления новой ноды');
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
});
