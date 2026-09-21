import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import TunnelsPage from '../../src/pages/TunnelsPage'
import { ThemeProvider } from '../../src/ThemeContext'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockDelete = vi.fn()

vi.mock('../../src/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

const node = { id: 'node-1', name: 'Main', url: 'https://node.test', isMain: true }

function arrange(tunnels: unknown[] = []) {
  mockGet.mockImplementation((url: string) => Promise.resolve({
    data: url === '/tunnels' ? tunnels : url === '/nodes' ? [node] : {},
  }))
  return render(<ThemeProvider><TunnelsPage /></ThemeProvider>)
}

async function openForm() {
  fireEvent.click(await screen.findByRole('button', { name: /Добавить/ }))
  return screen.findByText('Новый relay сервер')
}

describe('TunnelsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ data: {} })
    mockDelete.mockResolvedValue({ data: {} })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
  })

  it('loads relay servers and nodes', async () => {
    arrange()
    expect(await screen.findByText('Relay серверы не добавлены')).toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledWith('/tunnels')
    expect(mockGet).toHaveBeenCalledWith('/nodes')
  })

  it('shows relay state and address', async () => {
    arrange([{ id: 1, name: 'Relay NL', ip: '1.2.3.4', sshPort: 22, username: 'root', isInstalled: false }])
    expect(await screen.findByText('Relay NL')).toBeInTheDocument()
    expect(screen.getByText('1.2.3.4')).toBeInTheDocument()
    expect(screen.getByText('Не установлен')).toBeInTheDocument()
  })

  it('validates an incomplete relay form', async () => {
    arrange()
    await openForm()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Введите название relay сервера')).toBeInTheDocument()
    expect(screen.getByText('Введите корректный IP или домен relay сервера')).toBeInTheDocument()
  })

  it('creates a relay for the selected node', async () => {
    arrange()
    await openForm()
    fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: 'Relay DE' } })
    fireEvent.change(screen.getByLabelText(/^IP или домен relay сервера/), { target: { value: 'relay.example.com' } })
    fireEvent.change(screen.getByLabelText(/^SSH пароль/), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tunnels', expect.objectContaining({
      name: 'Relay DE',
      ip: 'relay.example.com',
      nodeId: 'node-1',
      password: 'secret',
    })))
    expect(await screen.findByText('Relay сервер добавлен')).toBeInTheDocument()
  })

  it('installs forwarding after confirmation', async () => {
    arrange([{ id: 7, name: 'Relay', ip: '1.2.3.4', sshPort: 22, username: 'root', isInstalled: false }])
    fireEvent.click(await screen.findByRole('button', { name: /Установить/ }))
    expect(screen.getByText('Установить перенаправление на выбранный сервер?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Установить' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tunnels/7/install'))
    expect(await screen.findByText('Перенаправление установлено')).toBeInTheDocument()
  })

  it('deletes the database record and passes the forwarding choice', async () => {
    arrange([{ id: 4, name: 'Relay', ip: '1.2.3.4', sshPort: 22, username: 'root', isInstalled: true }])
    fireEvent.click((await screen.findByTestId('icon-Delete')).closest('button')!)
    expect(screen.getByText('Удалить relay сервер только из списка?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/tunnels/4', {
      params: { deleteForwarding: false },
    }))
  })
})
