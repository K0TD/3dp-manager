import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SettingsPage from '../../src/pages/SettingsPage'
import { ThemeProvider } from '../../src/ThemeContext'

const mockGet = vi.fn()
const mockPost = vi.fn()

vi.mock('../../src/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

const renderPage = () => render(<ThemeProvider><SettingsPage /></ThemeProvider>)

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReset()
    mockPost.mockReset()
    mockGet.mockResolvedValue({ data: { admin_login: 'operator' } })
    mockPost.mockResolvedValue({ data: new Blob(['backup']) })
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test'), configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })

  it('loads and displays the administrator login', async () => {
    renderPage()

    expect(await screen.findByDisplayValue('operator')).toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledWith('/settings')
    expect(screen.getByText('Перенос панели')).toBeInTheDocument()
  })

  it('updates the administrator profile', async () => {
    renderPage()
    const login = await screen.findByLabelText('Логин')
    fireEvent.change(login, { target: { value: 'new-operator' } })
    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'strong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/auth/update-profile', {
      login: 'new-operator',
      password: 'strong-password',
    }))
  }, 20000)

  it('requires the current administrator password for export', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Скачать полный архив' }))

    expect(await screen.findByText('Введите текущий пароль администратора')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalledWith('/backups/export', expect.anything(), expect.anything())
  })

  it('downloads an encrypted portable backup', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText('Текущий пароль администратора'), { target: { value: 'admin-pass' } })
    fireEvent.change(screen.getByLabelText('Парольная фраза архива'), { target: { value: 'archive-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Скачать полный архив' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/backups/export',
      { currentPassword: 'admin-pass', passphrase: 'archive-secret' },
      { responseType: 'blob' },
    ))
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
  })

  it('warns before exporting an unencrypted backup', async () => {
    renderPage()
    const label = await screen.findByText('Зашифровать архив')
    const encryptionSwitch = label.closest('label')?.querySelector('input')
    expect(encryptionSwitch).toBeTruthy()
    fireEvent.click(encryptionSwitch!)

    expect(screen.getByText(/Открытый архив содержит пароли нод/)).toBeInTheDocument()
  })

  it('displays standard inbounds section and saves custom inbounds with different nodes', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/settings') {
        return Promise.resolve({
          data: {
            admin_login: 'operator',
            default_inbounds: JSON.stringify([
              { type: 'vless-tcp-reality', nodeId: 'node-1', port: '443', name: 'Primary Inbound' },
              { type: 'vless-xhttp-reality', nodeId: 'node-2', port: '8443', name: 'Secondary Inbound' },
            ]),
          },
        })
      }
      if (url === '/nodes') {
        return Promise.resolve({
          data: [
            { id: 'node-1', name: 'Node 1 (DE)', isMain: true, flag: '🇩🇪', url: 'https://de.test' },
            { id: 'node-2', name: 'Node 2 (FI)', isMain: false, flag: '🇫🇮', url: 'https://fi.test' },
          ],
        })
      }
      if (url === '/tunnels') return Promise.resolve({ data: [] })
      if (url === '/domains/all') return Promise.resolve({ data: [{ id: 1, name: 'test.com', isEnabled: true }] })
      if (url === '/settings/countries') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: {} })
    })

    renderPage()

    expect(await screen.findByText('Стандартные инбаунды подписок')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Primary Inbound')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Secondary Inbound')).toBeInTheDocument()

    // Click "Сохранить стандартные инбаунды"
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить стандартные инбаунды' }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/settings', expect.objectContaining({
        default_inbounds: expect.stringContaining('Primary Inbound'),
      }))
    })

    expect(await screen.findByText('Стандартные инбаунды сохранены')).toBeInTheDocument()
  })

  it('resets standard inbounds to defaults on clicking reset', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/settings') {
        return Promise.resolve({
          data: {
            admin_login: 'operator',
            default_inbounds: JSON.stringify([
              { type: 'custom', link: 'vless://one' },
            ]),
          },
        })
      }
      if (url === '/nodes') {
        return Promise.resolve({
          data: [{ id: 'node-1', name: 'Node 1', isMain: true, url: 'https://node.test' }],
        })
      }
      return Promise.resolve({ data: [] })
    })

    renderPage()

    expect(await screen.findByDisplayValue('vless://one')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить по умолчанию' }))

    expect(await screen.findByText('Инбаунды сброшены к значениям по умолчанию (не забудьте сохранить)')).toBeInTheDocument()
    expect(await screen.findByText('Инбаунды (5/20)')).toBeInTheDocument()
  })
})
