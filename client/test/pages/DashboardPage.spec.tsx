import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from '../../src/pages/DashboardPage'
import { copyToClipboard } from '../../src/utils/copyToClipboard'

vi.mock('../../src/utils/copyToClipboard', () => ({ copyToClipboard: vi.fn(async () => {}) }))

const mockGet = vi.fn()
const mockDelete = vi.fn()
const mockPost = vi.fn()

vi.mock('../../src/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows node health, subscriptions and queued cleanup', async () => {
    mockGet.mockImplementation((url: string) => {
      const responses: Record<string, unknown> = {
        '/nodes': [
          { id: 'node-1', name: 'NL', url: 'https://nl.test', healthStatus: 'online' },
          { id: 'node-2', name: 'DE', url: 'https://de.test', healthStatus: 'offline' },
        ],
        '/subscriptions': [{ id: 1 }, { id: 2 }],
        '/subscriptions/count': { count: 2 },
        '/rotation/operations': [],
        '/rotation/cleanup': [{ id: 3 }],
      }
      return Promise.resolve({ data: responses[url] })
    })

    renderPage()

    expect(await screen.findByText('Обзор сети')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/1 нод недоступны/)).toBeInTheDocument()
    expect(screen.getByText('NL')).toBeInTheDocument()
  })

  it('allows deleting and purging cleanup items', async () => {
    mockGet.mockImplementation((url: string) => {
      const responses: Record<string, unknown> = {
        '/nodes': [],
        '/subscriptions/count': { count: 0 },
        '/rotation/operations': [],
        '/rotation/cleanup': [{ id: 42, port: 8080, protocol: 'vless', cleanupAttempts: 1 }],
      }
      return Promise.resolve({ data: responses[url] })
    })
    mockDelete.mockResolvedValue({ data: { success: true } })
    mockPost.mockResolvedValue({ data: { success: true } })

    renderPage()

    expect(await screen.findByText('Очередь очистки инбаундов (1)')).toBeInTheDocument()
    const deleteBtn = screen.getByText('Удалить из очереди')
    fireEvent.click(deleteBtn)
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/rotation/cleanup/42')
    })

    const purgeBtn = screen.getByText('Очистить зависшие')
    fireEvent.click(purgeBtn)
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/rotation/cleanup/purge-failed')
    })
  })

  it('reports an infrastructure loading error', async () => {
    mockGet.mockRejectedValue(new Error('offline'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Не удалось загрузить состояние инфраструктуры')).toBeInTheDocument()
    })
  })

  it('displays normalized errorDetails in timeline and modal dialog', async () => {
    const errorDetails = {
      title: 'Панель отклонила защитный токен CSRF',
      hint: 'Проверьте адрес панели и авторизацию, затем повторите операцию.',
      code: 'CSRF_FAILED',
      stage: 'login',
      node: 'NL Server',
      inboundType: 'vless-tcp-reality',
      port: 443,
      raw: 'CSRF token mismatch at /login',
    };

    mockGet.mockImplementation((url: string) => {
      const responses: Record<string, unknown> = {
        '/nodes': [],
        '/subscriptions/count': { count: 1 },
        '/rotation/operations': [
          {
            id: 'op-1234',
            status: 'failed',
            createdAt: new Date().toISOString(),
            error: 'CSRF token mismatch',
            errorDetails,
            results: [
              {
                subscriptionName: 'VIP',
                nodeName: 'NL Server',
                status: 'failed',
                errorDetails,
              },
            ],
          },
        ],
        '/rotation/cleanup': [],
      };
      return Promise.resolve({ data: responses[url] });
    });

    renderPage();

    // In timeline
    expect(await screen.findAllByText(/Панель отклонила защитный токен CSRF/)).toHaveLength(2);
    expect(screen.getAllByText('Подсказка: Проверьте адрес панели и авторизацию, затем повторите операцию.')).toHaveLength(2);
    expect(screen.getAllByText('Нода: NL Server · Тип: vless-tcp-reality · Порт: 443')).toHaveLength(2);

    // Open modal dialog
    const detailsBtn = screen.getByText('Подробности операции');
    fireEvent.click(detailsBtn);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('Технические детали')).toHaveLength(2);
    expect(screen.getAllByText('Копировать детали')).toHaveLength(2);
  });

  it('displays legacy error and message when errorDetails is absent', async () => {
    mockGet.mockImplementation((url: string) => {
      const responses: Record<string, unknown> = {
        '/nodes': [],
        '/subscriptions/count': { count: 1 },
        '/rotation/operations': [
          {
            id: 'op-legacy',
            status: 'failed',
            createdAt: new Date().toISOString(),
            error: 'Old raw error message from 3x-ui',
            results: [
              {
                subscriptionName: 'Basic',
                nodeName: 'DE Server',
                status: 'failed',
                message: 'Old node failure reason',
              },
            ],
          },
        ],
        '/rotation/cleanup': [],
      };
      return Promise.resolve({ data: responses[url] });
    });

    renderPage();

    // Timeline shows legacy texts
    expect(await screen.findByText('Ошибка: Old raw error message from 3x-ui')).toBeInTheDocument();
    expect(screen.getByText(/Old node failure reason/)).toBeInTheDocument();

    // Open modal dialog
    const detailsBtn = screen.getByText('Подробности операции');
    fireEvent.click(detailsBtn);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Old raw error message from 3x-ui')).toBeInTheDocument();
    expect(screen.getByText('Old node failure reason')).toBeInTheDocument();
    expect(screen.queryByText('Технические детали')).not.toBeInTheDocument();
  });

  it('copies the diagnostics projection instead of the raw operation', async () => {
    const report = { id: 'op-export', results: [{ inbounds: [{ canary: { failure: 'TUNNEL_CLOSED' } }] }] }
    mockGet.mockImplementation((url: string) => {
      const responses: Record<string, unknown> = {
        '/nodes': [],
        '/subscriptions/count': { count: 1 },
        '/rotation/operations': [
          { id: 'op-export', status: 'failed', createdAt: new Date().toISOString(), error: 'raw fixture' },
        ],
        '/rotation/cleanup': [],
        '/rotation/operations/op-export/diagnostics': report,
      }
      return Promise.resolve({ data: responses[url] })
    })

    renderPage()
    fireEvent.click(await screen.findByText('Подробности операции'))
    fireEvent.click(screen.getByRole('button', { name: 'Копировать диагностику' }))
    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith(JSON.stringify(report, null, 2))
    })
  })

  it('displays canaryResults, auto-rollback chip, and preserved count in operation details', async () => {
    mockGet.mockImplementation((url: string) => {
      const responses: Record<string, unknown> = {
        '/nodes': [],
        '/subscriptions/count': { count: 1 },
        '/rotation/operations': [
          {
            id: 'op-canary',
            status: 'partial',
            createdAt: new Date().toISOString(),
            results: [
              {
                subscriptionName: 'Prod',
                nodeName: 'EU-1',
                status: 'preserved',
                preserved: 1,
                rolledBack: true,
                canaryResults: [
                  {
                    success: false,
                    engine: 'xray-core',
                    targetAddress: 'eu.example.com',
                    targetPort: 443,
                    profileKind: 'xhttp-stable',
                    latencyMs: 320,
                    error: 'SOCKS5 handshake timeout',
                  },
                ],
                message: 'Canary-проверка не пройдена',
              },
            ],
          },
        ],
        '/rotation/cleanup': [],
      };
      return Promise.resolve({ data: responses[url] });
    });

    renderPage();

    const detailsBtn = await screen.findByText('Подробности операции');
    fireEvent.click(detailsBtn);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText('Откат неудачных подключений'),
    ).toBeInTheDocument();
    expect(screen.getByText('Сохранено постоянных: 1')).toBeInTheDocument();
    expect(screen.getByText('Canary-проверки подключения')).toBeInTheDocument();
    expect(screen.getByText(/SOCKS5 handshake timeout/)).toBeInTheDocument();
  });
})
