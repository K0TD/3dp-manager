import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from '../../src/pages/DashboardPage'

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
})
