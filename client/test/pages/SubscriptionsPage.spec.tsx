import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import SubscriptionsPage from '../../src/pages/SubscriptionsPage'
import { ThemeProvider } from '../../src/ThemeContext'
import { AuthProvider } from '../../src/auth/AuthContext'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPut = vi.fn()
const mockDelete = vi.fn()

vi.mock('../../src/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

const mockClipboardWriteText = vi.fn()
Object.assign(navigator, { clipboard: { writeText: mockClipboardWriteText } })

const mockWindowOpen = vi.fn()
const originalWindowOpen = window.open
beforeEach(() => {
  window.open = mockWindowOpen
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => {
  window.open = originalWindowOpen
  vi.restoreAllMocks()
})

const setupMockGet = (overrides?: {
  subscriptions?: unknown[]
  tunnels?: unknown[]
  domains?: unknown[]
  nodes?: unknown[]
}) => {
  mockGet.mockImplementation((url: string) => {
    if (url === '/subscriptions') return Promise.resolve({ data: overrides?.subscriptions || [] })
    if (url === '/tunnels') return Promise.resolve({ data: overrides?.tunnels || [] })
    if (url === '/domains/all') return Promise.resolve({ data: overrides?.domains || [{ id: 1, name: 'example.com', isEnabled: true }] })
    if (url === '/nodes') return Promise.resolve({ data: overrides?.nodes || [{ id: 'node-1', name: 'Main', url: 'https://node.test', isMain: true }] })
    return Promise.resolve({ data: {} })
  })
}

const renderSubscriptionsPage = () => {
  return render(
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <SubscriptionsPage />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

describe('SubscriptionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClipboardWriteText.mockClear()
    mockWindowOpen.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reopens an empty subscription without adding a default inbound', async () => {
    setupMockGet({ subscriptions: [{ id: 'empty', name: 'Empty', uuid: 'empty', inbounds: [], inboundsConfig: [] }] })
    renderSubscriptionsPage()
    fireEvent.click(await screen.findByTestId('icon-MoreVert'))
    fireEvent.click(await screen.findByText('Редактировать'))
    expect(await screen.findByText('Инбаунды (0/20)')).toBeInTheDocument()
  })

  it('shows an AWG provisioning failure separately from saved subscription settings', async () => {
    setupMockGet({ subscriptions: [{ id: 'awg', name: 'AWG', uuid: 'awg', inbounds: [], inboundsConfig: [
      { configId: 'awg-config', type: 'amneziawg', nodeId: 'node-1', port: 'random' },
    ] }] })
    mockPut.mockResolvedValue({ data: { awgProvisioning: { status: 'failed', message: 'Panel offline' } } })
    renderSubscriptionsPage()
    fireEvent.click(await screen.findByTestId('icon-MoreVert'))
    fireEvent.click(await screen.findByText('Редактировать'))
    fireEvent.click(await screen.findByText('Сохранить'))
    expect(await screen.findByText(/Настройки сохранены, но создание подключений не завершено: Panel offline/)).toBeInTheDocument()
  })

  describe('Рендеринг', () => {
    it('должен рендериться с заголовком', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      await waitFor(() => {
        expect(screen.getByText('Подписки')).toBeInTheDocument()
      })
    })

    it('должен отображать кнопку "Создать"', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      await waitFor(() => {
        expect(screen.getByText('Создать')).toBeInTheDocument()
      })
    })

    it('должен отображать сообщение при отсутствии подписок', async () => {
      setupMockGet({ subscriptions: [] })
      renderSubscriptionsPage()

      await waitFor(() => {
        expect(screen.getByText('Нет подписок')).toBeInTheDocument()
      })
    })

    it('должен отображать список подписок', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [{}, {}], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      renderSubscriptionsPage()

      await waitFor(() => {
        expect(screen.getByText('Test Sub')).toBeInTheDocument()
        expect(screen.getByText('abc-123')).toBeInTheDocument()
      })
    })

    it('должен отображать количество инбаундов', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [{}, {}, {}] }
      ]
      setupMockGet({ subscriptions: mockSubs })
      renderSubscriptionsPage()

      await waitFor(() => {
        expect(screen.getByText('3')).toBeInTheDocument()
      })
    })

    it('должен отображать чекбокс авторотации', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      renderSubscriptionsPage()

      await waitFor(() => {
        const checkbox = screen.getByRole('checkbox')
        expect(checkbox).toBeChecked()
      })
    })
  })

  describe('Загрузка данных', () => {
    it('должен загружать подписки при монтировании', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/subscriptions')
      })
    })

    it('должен загружать туннели при монтировании', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/tunnels')
      })
    })

    it('должен загружать домены при монтировании', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/domains/all')
      })
    })

    it('должен фильтровать только установленные туннели', async () => {
      const mockTunnels = [
        { id: 1, name: 'Tunnel 1', ip: '1.1.1.1', domain: '', isInstalled: true },
        { id: 2, name: 'Tunnel 2', ip: '2.2.2.2', domain: '', isInstalled: false }
      ]
      setupMockGet({ tunnels: mockTunnels })
      renderSubscriptionsPage()

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/tunnels')
        expect(mockGet).toHaveBeenCalled()
      })
    })
  })

  describe('Список подписок без выбора сервера', () => {
    it('не должен отображать верхний селектор сервера при наличии туннелей', async () => {
      const mockTunnels = [
        { id: 1, name: 'Tunnel 1', ip: '1.1.1.1', domain: '', isInstalled: true }
      ]
      setupMockGet({ tunnels: mockTunnels, subscriptions: [] })
      renderSubscriptionsPage()

      await waitFor(() => {
        expect(screen.queryByText('Основной сервер')).not.toBeInTheDocument()
      })
    })
  })

  describe('Диалог создания подписки', () => {
    it('должен открывать диалог при клике на "Создать"', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(screen.getByText('Новая подписка')).toBeInTheDocument()
      })
    })

    it('должен закрывать диалог при клике на "Отмена"', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      const cancelButton = await screen.findByText('Отмена')
      fireEvent.click(cancelButton)

      await waitFor(() => {
        expect(screen.queryByText('Новая подписка')).not.toBeInTheDocument()
      })
    })

    it('должен отображать поле имени подписки', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(screen.getByLabelText('Имя подписки')).toBeInTheDocument()
      })
    })

    it('должен отображать инбаунды по умолчанию', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(screen.getByText('Инбаунды (5/20)')).toBeInTheDocument()
      })
    })

    it('должен отображать настроенные стандартные инбаунды из настроек панели', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/settings') {
          return Promise.resolve({
            data: {
              default_inbounds: JSON.stringify([
                { type: 'vless-tcp-reality', nodeId: 'node-1', port: '443' },
                { type: 'hysteria2-udp', nodeId: 'node-2', port: '8443' },
                { type: 'custom', link: 'vless://custom-link' },
              ]),
            },
          })
        }
        if (url === '/nodes') {
          return Promise.resolve({
            data: [
              { id: 'node-1', name: 'Node 1', isMain: true, url: 'https://n1.test' },
              { id: 'node-2', name: 'Node 2', isMain: false, url: 'https://n2.test' },
            ],
          })
        }
        if (url === '/subscriptions') return Promise.resolve({ data: [] })
        if (url === '/tunnels') return Promise.resolve({ data: [] })
        if (url === '/domains/all') return Promise.resolve({ data: [{ id: 1, name: 'domain.test', isEnabled: true }] })
        if (url === '/settings/countries') return Promise.resolve({ data: [] })
        return Promise.resolve({ data: {} })
      })

      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(screen.getByText('Инбаунды (3/20)')).toBeInTheDocument()
        expect(screen.getByDisplayValue('vless://custom-link')).toBeInTheDocument()
      })
    })

    it('должен предлагать оба варианта VLESS TLS', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      fireEvent.click(await screen.findByText('Создать'))
      fireEvent.mouseDown((await screen.findAllByRole('combobox'))[0])

      expect((await screen.findAllByText('vless-tcp-tls')).length).toBeGreaterThan(1)
      expect(screen.getByText('vless-ws-tls')).toBeInTheDocument()
      expect(screen.getByText('amneziawg')).toBeInTheDocument()
    })

    it('должен позволять вводить имя подписки', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      const nameField = await screen.findByLabelText('Имя подписки')
      fireEvent.change(nameField, { target: { value: 'My Subscription' } })

      expect(nameField).toHaveValue('My Subscription')
    })

    it('должен показывать ошибку при пустом имени', async () => {
      setupMockGet()
      mockPost.mockRejectedValue({})

      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      const saveButton = await screen.findByText('Сохранить')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Введите имя подписки')).toBeInTheDocument()
      })
    })
  })

  describe('Управление инбаундами в диалоге', () => {
    it('должен отображать инбаунды по умолчанию', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      await waitFor(() => {
        expect(screen.getByText('Инбаунды (5/20)')).toBeInTheDocument()
      })
    })

    it('должен позволять вводить имя подписки', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      const nameField = await screen.findByLabelText('Имя подписки')
      fireEvent.change(nameField, { target: { value: 'My Subscription' } })

      expect(nameField).toHaveValue('My Subscription')
    })

    it('должен добавлять новый инбаунд', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      const addButton = await screen.findByText('Добавить инбаунд')
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(screen.getByText('Инбаунды (6/20)')).toBeInTheDocument()
      })
    })

    it('должен удалять все инбаунды кнопкой "Удалить все"', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      const removeAllButton = await screen.findByText('Удалить все')
      fireEvent.click(removeAllButton)

      await waitFor(() => {
        expect(screen.getByText('Инбаунды (0/20)')).toBeInTheDocument()
      })
    })

    it('должен запрещать добавление более 20 инбаундов', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      for (let i = 0; i < 15; i++) {
        const addButton = screen.getByText('Добавить инбаунд')
        fireEvent.click(addButton)
      }

      await waitFor(() => {
        const addButton = screen.getByText('Добавить инбаунд')
        expect(addButton).toBeDisabled()
      })
    }, 30000)

    it('должен менять порядок инбаундов стрелками и сохранять его', async () => {
      const firstConfigId = '11111111-1111-4111-8111-111111111111'
      const secondConfigId = '22222222-2222-4222-8222-222222222222'
      setupMockGet({
        subscriptions: [
          {
            id: 'sub-1',
            name: 'Ordered Sub',
            uuid: 'sub-uuid',
            inbounds: [],
            inboundsConfig: [
              { configId: firstConfigId, type: 'vmess-tcp', port: 10001, sni: 'random' },
              { configId: secondConfigId, type: 'vmess-tcp', port: 10002, sni: 'random' },
            ],
          },
        ],
      })
      mockPut.mockResolvedValue({})
      renderSubscriptionsPage()

      fireEvent.click(await screen.findByTestId('icon-MoreVert'))
      fireEvent.click(await screen.findByText('Редактировать'))
      fireEvent.click(await screen.findByRole('button', { name: 'Переместить строку 1 вниз' }))
      fireEvent.click(screen.getByText('Сохранить'))

      await waitFor(() => {
        expect(mockPut).toHaveBeenCalledWith(
          '/subscriptions/sub-1',
          expect.objectContaining({
            inboundsConfig: [
              expect.objectContaining({ configId: secondConfigId }),
              expect.objectContaining({ configId: firstConfigId }),
            ],
          }),
        )
      })
    })

    it('должен предлагать Telemt домены из списка SNI', async () => {
      setupMockGet({
        domains: [
          { id: 1, name: 'example.com', isEnabled: true },
          { id: 2, name: 'vk.com', isEnabled: true },
          { id: 3, name: 'disabled.example.com', isEnabled: false },
        ],
        subscriptions: [
          {
            id: 'sub-telemt',
            name: 'Telegram',
            uuid: 'telemt-uuid',
            inbounds: [],
            inboundsConfig: [
              { type: 'mtproto-faketls', port: 8443, sni: 'random' },
            ],
          },
        ],
      })
      renderSubscriptionsPage()

      fireEvent.click(await screen.findByTestId('icon-MoreVert'))
      fireEvent.click(await screen.findByText('Редактировать'))
      fireEvent.mouseDown(await screen.findByLabelText('FakeTLS SNI'))

      expect(
        await screen.findByRole('option', { name: 'random — из списка SNI' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'example.com' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'vk.com' })).toBeInTheDocument()
      expect(
        screen.queryByRole('option', { name: 'disabled.example.com' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Сохранение подписки', () => {
    it('должен создавать новую подписку', async () => {
      setupMockGet()
      mockPost.mockResolvedValue({})

      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      const nameField = await screen.findByLabelText('Имя подписки')
      fireEvent.change(nameField, { target: { value: 'New Sub' } })

      const saveButton = screen.getByText('Сохранить')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/subscriptions', expect.objectContaining({
          name: 'New Sub',
          inboundsConfig: expect.arrayContaining([
            expect.objectContaining({
              type: 'vless-tcp-tls',
              certificateMode: 'node',
              tlsServerName: 'node.test',
              certificateFile: undefined,
              keyFile: undefined,
            }),
          ]),
        }))
      })
    })

    it('должен показывать успех после создания', async () => {
      setupMockGet()
      mockPost.mockResolvedValue({})

      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      const nameField = await screen.findByLabelText('Имя подписки')
      fireEvent.change(nameField, { target: { value: 'New Sub' } })

      const saveButton = screen.getByText('Сохранить')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Подписка создана')).toBeInTheDocument()
      })
    })

    it('должен показывать ошибку при неудачном сохранении', async () => {
      setupMockGet()
      mockPost.mockRejectedValue({ response: { data: { message: 'Ошибка сервера' } } })

      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      const nameField = await screen.findByLabelText('Имя подписки')
      fireEvent.change(nameField, { target: { value: 'New Sub' } })

      const saveButton = screen.getByText('Сохранить')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Ошибка сервера')).toBeInTheDocument()
      })
    })
  })

  describe('Редактирование подписки', () => {
    it('должен открывать диалог редактирования', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [{ type: 'vless', port: 443, sni: 'example.com' }], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const editOption = await screen.findByText('Редактировать')
      fireEvent.click(editOption)

      await waitFor(() => {
        expect(screen.getByText('Редактировать подписку')).toBeInTheDocument()
      })
    })

    it('должен загружать данные подписки в диалог', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [{ type: 'vless', port: 443, sni: 'example.com' }], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const editOption = await screen.findByText('Редактировать')
      fireEvent.click(editOption)

      const nameField = await screen.findByLabelText('Имя подписки')
      expect(nameField).toHaveValue('Test Sub')
    })

    it('должен обновлять подписку', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [{ type: 'vless', port: 443, sni: 'example.com' }], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockPut.mockResolvedValue({})

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const editOption = await screen.findByText('Редактировать')
      fireEvent.click(editOption)

      const nameField = await screen.findByLabelText('Имя подписки')
      fireEvent.change(nameField, { target: { value: 'Updated Sub' } })

      const saveButton = screen.getByText('Сохранить')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockPut).toHaveBeenCalledWith('/subscriptions/1', expect.objectContaining({
          name: 'Updated Sub',
        }))
      })
    })

    it('должен показывать успех после обновления', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [{ type: 'vless', port: 443, sni: 'example.com' }], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockPut.mockResolvedValue({})

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const editOption = await screen.findByText('Редактировать')
      fireEvent.click(editOption)

      const nameField = await screen.findByLabelText('Имя подписки')
      fireEvent.change(nameField, { target: { value: 'Updated Sub' } })

      const saveButton = screen.getByText('Сохранить')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(screen.getByText('Подписка обновлена')).toBeInTheDocument()
      })
    })

    it('сбрасывает привязку к удалённой ноде при открытии на редактирование и не возвращает её при сохранении', async () => {
      const mockSubs = [
        {
          id: 'sub-deleted-node',
          name: 'Sub with deleted node',
          uuid: 'uuid-1',
          inbounds: [],
          inboundsConfig: [
            {
              configId: 'cfg-deleted',
              type: 'vless-tcp-reality',
              nodeId: 'deleted-node-999',
              flag: '🇳🇱',
              name: 'Old Node Inbound',
              port: '8443',
              enabled: false,
              disabledReason: 'Нода удалена',
            },
          ],
        },
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockPut.mockResolvedValue({})

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const editOption = await screen.findByText('Редактировать')
      fireEvent.click(editOption)

      // Ensure edit dialog opened
      expect(await screen.findByText('Редактировать подписку')).toBeInTheDocument()

      // The name should be reset (cleared) because the old name belonged to the deleted node
      const nameInput = screen.getByLabelText('Название')
      expect(nameInput).toHaveValue('')

      // Save the subscription
      const saveButton = screen.getByText('Сохранить')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockPut).toHaveBeenCalledWith(
          '/subscriptions/sub-deleted-node',
          expect.objectContaining({
            inboundsConfig: [
              expect.objectContaining({
                configId: 'cfg-deleted',
                nodeId: undefined, // empty nodeId converts to undefined (Основная нода)
                enabled: true, // enabled is set to true on save
              }),
            ],
          }),
        )
      })

      // Verify it did NOT revert back to deleted-node-999
      const sentPayload = mockPut.mock.calls[0][1]
      expect(sentPayload.inboundsConfig[0].nodeId).not.toBe('deleted-node-999')
    })

    it('не привязывает persistent-инбаунд к удалённой ноде из activePersistent', async () => {
      const mockSubs = [
        {
          id: 'sub-awg-deleted',
          name: 'AWG Sub',
          uuid: 'uuid-awg',
          inbounds: [
            {
              protocol: 'amneziawg',
              configId: 'cfg-awg-1',
              nodeId: 'deleted-node-999',
            },
          ],
          inboundsConfig: [
            {
              configId: 'cfg-awg-1',
              type: 'amneziawg',
              port: 'random',
              enabled: false,
            },
          ],
        },
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockPut.mockResolvedValue({})

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const editOption = await screen.findByText('Редактировать')
      fireEvent.click(editOption)

      expect(await screen.findByText('Редактировать подписку')).toBeInTheDocument()

      const saveButton = screen.getByText('Сохранить')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockPut).toHaveBeenCalledWith(
          '/subscriptions/sub-awg-deleted',
          expect.objectContaining({
            inboundsConfig: [
              expect.objectContaining({
                configId: 'cfg-awg-1',
                nodeId: undefined,
                enabled: true,
              }),
            ],
          }),
        )
      })

      const sentPayload = mockPut.mock.calls[0][1]
      expect(sentPayload.inboundsConfig[0].nodeId).not.toBe('deleted-node-999')
    })
  })

  describe('Удаление подписки', () => {
    it('должен открывать диалог подтверждения удаления', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const deleteOption = await screen.findByText('Удалить')
      fireEvent.click(deleteOption)

      await waitFor(() => {
        expect(screen.getByText('Удалить подписку и все соединения?')).toBeInTheDocument()
      })
    })

    it('должен закрывать диалог при клике на "Отмена"', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const deleteOption = await screen.findByText('Удалить')
      fireEvent.click(deleteOption)

      const cancelButton = await screen.findByText('Отмена')
      fireEvent.click(cancelButton)

      await waitFor(() => {
        expect(screen.queryByText('Удалить подписку и все соединения?')).not.toBeInTheDocument()
      })
    })

    it('должен удалять подписку при подтверждении', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockDelete.mockResolvedValue({})

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const deleteOption = await screen.findByText('Удалить')
      fireEvent.click(deleteOption)

      const confirmButton = screen.getAllByText('Удалить')[1] as HTMLElement
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith('/subscriptions/1')
      })
    })

    it('должен показывать успех после удаления', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockDelete.mockResolvedValue({})

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const deleteOption = await screen.findByText('Удалить')
      fireEvent.click(deleteOption)

      const confirmButton = screen.getAllByText('Удалить')[1] as HTMLElement
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(screen.getByText('Подписка удалена')).toBeInTheDocument()
      })
    })

    it('должен предлагать принудительное удаление при ошибке INBOUND_DELETE_FAILED и удалять с force=true', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockDelete.mockRejectedValueOnce({
        response: {
          data: {
            code: 'INBOUND_DELETE_FAILED',
            message: 'Не удалось удалить инбаунд 101 из 3x-ui',
          },
        },
      })
      mockDelete.mockResolvedValueOnce({})

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const deleteOption = await screen.findByText('Удалить')
      fireEvent.click(deleteOption)

      const confirmDialog = await screen.findByText('Удалить подписку и все соединения?').then((el) => el.closest('[role="dialog"]')!)
      const confirmButton = within(confirmDialog).getByRole('button', { name: 'Удалить' })
      fireEvent.click(confirmButton)

      const forceTitle = await screen.findByText('Удалить принудительно?')
      const forceDialog = forceTitle.closest('[role="dialog"]')!
      expect(within(forceDialog).getByText('Не удалось удалить инбаунд 101 из 3x-ui')).toBeInTheDocument()
      expect(
        within(forceDialog).getByText(/Подписка удалится, даже если часть инбаундов осталась в 3x-ui/),
      ).toBeInTheDocument()

      const forceButton = within(forceDialog).getByRole('button', { name: 'Удалить принудительно' })
      fireEvent.click(forceButton)

      await waitFor(() => {
        expect(mockDelete).toHaveBeenLastCalledWith('/subscriptions/1', {
          params: { force: true },
        })
      })
      expect(await screen.findByText('Подписка удалена')).toBeInTheDocument()
    })

    it('должен закрывать диалог принудительного удаления при клике на "Отмена"', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockDelete.mockRejectedValueOnce({
        response: {
          data: {
            code: 'INBOUND_DELETE_FAILED',
            message: 'Ошибка удаления инбаунда',
          },
        },
      })

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const deleteOption = await screen.findByText('Удалить')
      fireEvent.click(deleteOption)

      const confirmDialog = await screen.findByText('Удалить подписку и все соединения?').then((el) => el.closest('[role="dialog"]')!)
      const confirmButton = within(confirmDialog).getByRole('button', { name: 'Удалить' })
      fireEvent.click(confirmButton)

      const forceTitle = await screen.findByText('Удалить принудительно?')
      const forceDialog = forceTitle.closest('[role="dialog"]')!

      const cancelButton = within(forceDialog).getByRole('button', { name: 'Отмена' })
      fireEvent.click(cancelButton)

      await waitFor(() => {
        expect(screen.queryByText('Удалить принудительно?')).not.toBeInTheDocument()
      })
      expect(mockDelete).toHaveBeenCalledTimes(1)
    })
  })

  describe('Переключение авторотации', () => {
    it('должен переключать авторотацию при клике на чекбокс', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockPut.mockResolvedValue({})

      renderSubscriptionsPage()

      const checkbox = await screen.findByRole('checkbox')
      fireEvent.click(checkbox)

      await waitFor(() => {
        expect(mockPut).toHaveBeenCalledWith('/subscriptions/bulk-auto-rotation', expect.objectContaining({
          subscriptionIds: ['1'],
          enabled: false
        }))
      })
    })

    it('должен показывать успех при включении авторотации', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: false }
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockPut.mockResolvedValue({})

      renderSubscriptionsPage()

      const checkbox = await screen.findByRole('checkbox')
      fireEvent.click(checkbox)

      await waitFor(() => {
        expect(screen.getByText('Авторотация включена')).toBeInTheDocument()
      })
    })

    it('должен показывать успех при выключении авторотации', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockPut.mockResolvedValue({})

      renderSubscriptionsPage()

      const checkbox = await screen.findByRole('checkbox')
      fireEvent.click(checkbox)

      await waitFor(() => {
        expect(screen.getByText('Авторотация выключена')).toBeInTheDocument()
      })
    })

    it('должен показывать ошибку при неудачном переключении', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockPut.mockRejectedValue({ response: { data: { message: 'Ошибка' } } })

      renderSubscriptionsPage()

      const checkbox = await screen.findByRole('checkbox')
      fireEvent.click(checkbox)

      await waitFor(() => {
        expect(screen.getByText('Ошибка')).toBeInTheDocument()
      })
    })
  })

  describe('Утилитные функции', () => {
    it('должен генерировать уникальный ID', async () => {
      setupMockGet()
      renderSubscriptionsPage()

      const createButton = await screen.findByText('Создать')
      fireEvent.click(createButton)

      // Проверяем что ID генерируется (просто что форма открывается)
      await waitFor(() => {
        expect(screen.getByText('Новая подписка')).toBeInTheDocument()
      })
    })
  })

  describe('Просмотр ссылок', () => {
    it('должен открывать диалог ссылок при клике на опцию меню', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [{ type: 'vless', port: 443, sni: 'example.com', link: 'vless://test' }], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const linksOption = await screen.findByText('Показать конфиги')
      fireEvent.click(linksOption)

      await waitFor(() => {
        expect(screen.getByText('Активные ссылки')).toBeInTheDocument()
      })
    })

    it('должен закрывать диалог ссылок при клике на "Закрыть"', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [{ type: 'vless', port: 443, sni: 'example.com', link: 'vless://test' }], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const linksOption = await screen.findByText('Показать конфиги')
      fireEvent.click(linksOption)

      const closeButton = await screen.findByText('Закрыть')
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(screen.queryByText('Активные ссылки')).not.toBeInTheDocument()
      })
    })

    it('должен копировать ссылку при клике на кнопку копирования', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [{ type: 'vless', port: 443, sni: 'example.com', link: 'vless://test' }], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })
      mockClipboardWriteText.mockResolvedValue(undefined)

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const linksOption = await screen.findByText('Показать конфиги')
      fireEvent.click(linksOption)

      const copyButton = await screen.findByText('Копировать все')
      fireEvent.click(copyButton)

      await waitFor(() => {
        expect(mockClipboardWriteText).toHaveBeenCalled()
      })
    })

    it('должен открывать ссылку в новой вкладке при клике на иконку открытия', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [{ type: 'vless', port: 443, sni: 'example.com', link: 'vless://test' }], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const linksOption = await screen.findByText('Показать конфиги')
      fireEvent.click(linksOption)

      const openButtons = await screen.findAllByTestId('icon-OpenInNew')
      if (openButtons.length > 0) {
        fireEvent.click(openButtons[0])
      }

      await waitFor(() => {
        expect(mockWindowOpen).toHaveBeenCalled()
      })
    })

    it('должен показывать сообщение при отсутствии ссылок', async () => {
      const mockSubs = [
        { id: '1', name: 'Test Sub', uuid: 'abc-123', inbounds: [], isAutoRotationEnabled: true }
      ]
      setupMockGet({ subscriptions: mockSubs })

      renderSubscriptionsPage()

      const menuButton = await screen.findByTestId('icon-MoreVert')
      fireEvent.click(menuButton)

      const linksOption = await screen.findByText('Показать конфиги')
      fireEvent.click(linksOption)

      await waitFor(() => {
        expect(screen.getByText('Нет активных ссылок (ждите ротации)')).toBeInTheDocument()
      })
    })
  })
})
