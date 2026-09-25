import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import DomainsPage from '../../src/pages/DomainsPage'
import { ThemeProvider } from '../../src/ThemeContext'
import { AuthProvider } from '../../src/auth/AuthContext'

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

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
    writable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const setupMockGet = (overrides?: {
  domains?: { data: unknown[]; total: number }
  capabilities?: unknown
  status?: unknown
  settings?: unknown
}) => {
  mockGet.mockImplementation((url: string) => {
    if (url.startsWith('/domains?page=')) {
      return Promise.resolve({ data: overrides?.domains || { data: [], total: 0 } })
    }
    if (url === '/domains/scan/capabilities') {
      return Promise.resolve({ data: overrides?.capabilities || { scannerAvailable: false } })
    }
    if (url === '/domains/scan/status') {
      return Promise.resolve({ data: overrides?.status || { running: false } })
    }
    if (url === '/settings') {
      return Promise.resolve({ data: overrides?.settings || {} })
    }
    return Promise.resolve({ data: {} })
  })
}

const renderDomainsPage = () => {
  return render(
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <DomainsPage />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

describe('DomainsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Рендеринг', () => {
    it('должен рендериться с заголовком', async () => {
      setupMockGet()
      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getByText('Белый список доменов (SNI)')).toBeInTheDocument()
      })
    })

    it('должен отображать поле для добавления домена', async () => {
      setupMockGet()
      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getByLabelText('Доменное имя')).toBeInTheDocument()
      })
    })

    it('должен отображать кнопку "Добавить"', async () => {
      setupMockGet()
      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getByText('Добавить')).toBeInTheDocument()
      })
    })

    it('должен отображать кнопку "Из файла"', async () => {
      setupMockGet()
      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getByText('Из файла')).toBeInTheDocument()
      })
    })

    it('должен отображать таблицу доменов', async () => {
      setupMockGet({
        domains: { data: [{ id: 1, name: 'example.com' }], total: 1 }
      })
      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getByText('example.com')).toBeInTheDocument()
      })
    })

    it('должен отображать сообщение при отсутствии доменов', async () => {
      setupMockGet({ domains: { data: [], total: 0 } })
      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getByText('Нет доменов')).toBeInTheDocument()
      })
    })
  })

  describe('Загрузка данных', () => {
    it('должен загружать домены при монтировании', async () => {
      setupMockGet()
      renderDomainsPage()

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/domains?page=1&limit=10')
      })
    })

    it('должен загружать возможности сканера', async () => {
      setupMockGet()
      renderDomainsPage()

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/domains/scan/capabilities')
      })
    })

    it('должен загружать настройки', async () => {
      setupMockGet()
      renderDomainsPage()

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/settings')
      })
    })
  })

  describe('Пагинация', () => {
    it('должен отображать пагинацию', async () => {
      setupMockGet({ domains: { data: [{ id: 1, name: 'test.com' }], total: 25 } })
      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })
    })

    it('должен переключать страницу при клике на следующую', async () => {
      setupMockGet({ domains: { data: [{ id: 1, name: 'test.com' }], total: 25 } })
      renderDomainsPage()

      const nextPageButton = await screen.findByLabelText('Go to next page')
      fireEvent.click(nextPageButton)

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/domains?page=2&limit=10')
      })
    })

    it('должен менять количество строк на странице', async () => {
      setupMockGet({ domains: { data: [{ id: 1, name: 'test.com' }], total: 25 } })
      renderDomainsPage()

      const rowsPerPageSelect = await screen.findByLabelText('Доменов на странице:')
      fireEvent.mouseDown(rowsPerPageSelect)

      const option = await screen.findByText('25')
      fireEvent.click(option)

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/domains?page=1&limit=25')
      })
    })
  })

  describe('Добавление домена', () => {
    it('должен позволять вводить домен', async () => {
      setupMockGet()
      renderDomainsPage()

      const input = await screen.findByLabelText('Доменное имя')
      fireEvent.change(input, { target: { value: 'newdomain.com' } })

      expect(input).toHaveValue('newdomain.com')
    })

    it('должен добавлять домен при клике на кнопку', async () => {
      setupMockGet()
      mockPost.mockResolvedValue({})

      renderDomainsPage()

      const input = await screen.findByLabelText('Доменное имя')
      fireEvent.change(input, { target: { value: 'newdomain.com' } })

      const addButton = screen.getByText('Добавить')
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/domains', { name: 'newdomain.com' })
      })
    })

    it('должен очищать поле после добавления', async () => {
      setupMockGet()
      mockPost.mockResolvedValue({})

      renderDomainsPage()

      const input = await screen.findByLabelText('Доменное имя')
      fireEvent.change(input, { target: { value: 'newdomain.com' } })

      const addButton = screen.getByText('Добавить')
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(input).toHaveValue('')
      })
    })

    it('должен перезагружать список после добавления', async () => {
      setupMockGet()
      mockPost.mockResolvedValue({})

      renderDomainsPage()

      const input = await screen.findByLabelText('Доменное имя')
      fireEvent.change(input, { target: { value: 'newdomain.com' } })

      const addButton = screen.getByText('Добавить')
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/domains?page=1&limit=10')
      })
    })
  })

  describe('Удаление домена', () => {
    it('должен отображать кнопку удаления для домена', async () => {
      setupMockGet({
        domains: { data: [{ id: 1, name: 'test.com' }], total: 1 }
      })
      renderDomainsPage()

      const deleteButton = await screen.findByTestId('icon-Delete')
      expect(deleteButton).toBeInTheDocument()
    })

    it('должен удалять домен при клике на кнопку удаления', async () => {
      setupMockGet({
        domains: { data: [{ id: 1, name: 'test.com' }], total: 1 }
      })
      mockDelete.mockResolvedValue({})

      renderDomainsPage()

      const deleteButton = await screen.findByTestId('icon-Delete')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith('/domains/1')
      })
    })

    it('должен перезагружать список после удаления', async () => {
      setupMockGet({
        domains: { data: [{ id: 1, name: 'test.com' }], total: 1 }
      })
      mockDelete.mockResolvedValue({})

      renderDomainsPage()

      const deleteButton = await screen.findByTestId('icon-Delete')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/domains?page=1&limit=10')
      })
    })
  })

  describe('Удаление всех доменов', () => {
    it('должен отображать кнопку "Удалить все"', async () => {
      setupMockGet({
        domains: { data: [{ id: 1, name: 'test.com' }], total: 1 }
      })
      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getByText('Удалить все')).toBeInTheDocument()
      })
    })

    it('должен открывать диалог подтверждения удаления всех', async () => {
      setupMockGet({
        domains: { data: [{ id: 1, name: 'test.com' }], total: 1 }
      })
      mockDelete.mockResolvedValue({})

      renderDomainsPage()

      const deleteAllButton = await screen.findByText('Удалить все')
      fireEvent.click(deleteAllButton)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('должен закрывать диалог при клике на "Отмена"', async () => {
      setupMockGet({
        domains: { data: [{ id: 1, name: 'test.com' }], total: 1 }
      })
      mockDelete.mockResolvedValue({})

      renderDomainsPage()

      const deleteAllButton = await screen.findByText('Удалить все')
      fireEvent.click(deleteAllButton)

      const cancelButton = await screen.findByText('Отмена')
      fireEvent.click(cancelButton)

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })
  })

  describe('Загрузка из файла', () => {
    it('должен отображать кнопку "Из файла"', async () => {
      setupMockGet()
      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getByText('Из файла')).toBeInTheDocument()
      })
    })

    it('должен иметь скрытый input type="file"', async () => {
      setupMockGet()
      renderDomainsPage()

      const fileInput = screen.getByTestId('file-input')
      expect(fileInput).toBeInTheDocument()
    })

    it('должен загружать файл при выборе', async () => {
      setupMockGet()
      mockPost.mockResolvedValue({ data: { count: 5 } })

      renderDomainsPage()

      const fileInput = screen.getByTestId('file-input') as HTMLInputElement
      const file = new File(['example.com\ntest.org'], 'domains.txt', { type: 'text/plain' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/domains/upload', { domains: expect.any(Array) })
      })
    })

    it('должен показывать успех после загрузки файла', async () => {
      setupMockGet()
      mockPost.mockResolvedValue({ data: { count: 5 } })

      renderDomainsPage()

      const fileInput = screen.getByTestId('file-input') as HTMLInputElement
      const file = new File(['example.com\ntest.org'], 'domains.txt', { type: 'text/plain' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByText('Успешно добавлено доменов: 5')).toBeInTheDocument()
      })
    })
  })

  describe('Сканер доменов', () => {
    it('должен отображать кнопку "Сканировать" в аккордеоне', async () => {
      setupMockGet({
        capabilities: { scannerAvailable: true }
      })
      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getByText('Сканировать')).toBeInTheDocument()
      })
    })

    it('должен запускать сканирование при валидных данных', async () => {
      setupMockGet({
        capabilities: { scannerAvailable: true },
        settings: { xui_ip: '1.2.3.4' }
      })
      mockPost.mockResolvedValue({ data: { runId: '123', foundCount: 5, domains: ['a.com', 'b.com'] } })

      renderDomainsPage()

      const scanButton = await screen.findByText('Сканировать')
      fireEvent.click(scanButton)

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/domains/scan/start', expect.objectContaining({
          addr: expect.any(String),
        }))
      })
    })

    it('должен очищать результаты сканирования', async () => {
      setupMockGet({
        capabilities: { scannerAvailable: true },
        settings: { xui_ip: '1.2.3.4' }
      })
      mockPost.mockResolvedValue({ data: { runId: '123', foundCount: 2, domains: ['a.com', 'b.com'] } })

      renderDomainsPage()

      const scanButton = await screen.findByText('Сканировать')
      fireEvent.click(scanButton)

      const clearButton = await screen.findByText('Очистить предварительный')
      fireEvent.click(clearButton)

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalled()
      })
    })

    it('должен изменять настройки сканирования', async () => {
      setupMockGet({
        capabilities: { scannerAvailable: true },
        settings: { xui_ip: '1.2.3.4' }
      })

      renderDomainsPage()

      const secondsInput = await screen.findByLabelText('Секунд скана')
      fireEvent.change(secondsInput, { target: { value: '120' } })
      expect(secondsInput).toHaveValue(120)

      const threadInput = screen.getByLabelText('Потоков')
      fireEvent.change(threadInput, { target: { value: '8' } })
      expect(threadInput).toHaveValue(8)

      const timeoutInput = screen.getByLabelText('Таймаут, сек')
      fireEvent.change(timeoutInput, { target: { value: '10' } })
      expect(timeoutInput).toHaveValue(10)
    })

    it('должен разворачивать/сворачивать аккордеон сканера', async () => {
      setupMockGet({
        capabilities: { scannerAvailable: true }
      })

      renderDomainsPage()

      const accordionSummary = await screen.findByText('Автопоиск SNI (backend scanner)')
      
      fireEvent.click(accordionSummary)

      await waitFor(() => {
        const secondsInput = screen.getByLabelText('Секунд скана')
        expect(secondsInput).toBeInTheDocument()
      })
    })

    it('должен показывать сообщение при пустом списке кандидатов после сканирования', async () => {
      setupMockGet({
        capabilities: { scannerAvailable: true },
        settings: { xui_ip: '1.2.3.4' }
      })
      mockPost.mockResolvedValue({ data: { runId: '123', foundCount: 0, domains: [] } })

      renderDomainsPage()

      const scanButton = await screen.findByText('Сканировать')
      fireEvent.click(scanButton)

      await waitFor(() => {
        expect(screen.getByText('Домены не найдены')).toBeInTheDocument()
      })
    })

    it('должен сохранять состояние сканера в localStorage', async () => {
      const mockSetItem = vi.fn()
      const mockLocalStorage = {
        getItem: vi.fn().mockReturnValue(null),
        setItem: mockSetItem,
        removeItem: vi.fn(),
        clear: vi.fn(),
      }
      Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, writable: true })

      setupMockGet({
        capabilities: { scannerAvailable: true },
        settings: { xui_ip: '1.2.3.4' }
      })

      renderDomainsPage()

      const addrInput = await screen.findByLabelText('IP/домен VPS')
      fireEvent.change(addrInput, { target: { value: 'new-addr.com' } })

      await waitFor(() => {
        expect(mockSetItem).toHaveBeenCalledWith(
          'domains_scan_state_v1',
          expect.any(String)
        )
      })
    })

    it('должен показывать кнопку удаления для домена в основном списке', async () => {
      setupMockGet({
        domains: { data: [{ id: 1, name: 'test.com' }], total: 1 }
      })

      renderDomainsPage()

      const deleteButtons = await screen.findAllByTestId('icon-Delete')
      expect(deleteButtons.length).toBeGreaterThan(0)
    })

    it('должен подтверждать удаление всех доменов', async () => {
      setupMockGet({
        domains: { data: [{ id: 1, name: 'test.com' }], total: 1 }
      })
      mockDelete.mockResolvedValue({})

      renderDomainsPage()

      const deleteAllButton = await screen.findByText('Удалить все')
      fireEvent.click(deleteAllButton)

      const confirmButton = await screen.findByText('Удалить')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith('/domains/all')
      })
    })

    it('должен показывать успех после удаления всех доменов', async () => {
      setupMockGet({
        domains: { data: [{ id: 1, name: 'test.com' }], total: 1 }
      })
      mockDelete.mockResolvedValue({})

      renderDomainsPage()

      const deleteAllButton = await screen.findByText('Удалить все')
      fireEvent.click(deleteAllButton)

      const confirmButton = await screen.findByText('Удалить')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        const alerts = screen.getAllByRole('alert')
        const successAlert = alerts.find(alert => alert.textContent?.includes('Все домены удалены'))
        expect(successAlert).toBeInTheDocument()
      })
    })

    it('должен показывать ошибку при неудачном удалении всех доменов', async () => {
      setupMockGet({
        domains: { data: [{ id: 1, name: 'test.com' }], total: 1 }
      })
      mockDelete.mockRejectedValue({ response: { status: 500 } })

      renderDomainsPage()

      const deleteAllButton = await screen.findByText('Удалить все')
      fireEvent.click(deleteAllButton)

      const confirmButton = await screen.findByText('Удалить')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        const alerts = screen.getAllByRole('alert')
        const errorAlert = alerts.find(alert => alert.textContent?.includes('Ошибка удаления'))
        expect(errorAlert).toBeInTheDocument()
      })
    })
  })

  describe('Профили маскировки SNI и каталог Reality', () => {
    it('должен отображать бейдж профиля маскировки для домена в белом списке', async () => {
      setupMockGet({
        domains: {
          data: [
            {
              id: 1,
              name: 'swdist.apple.com',
              profile: {
                sni: 'swdist.apple.com',
                category: 'Apple',
                fingerprint: 'safari',
                spiderX: '/content/downloads/',
              },
            },
          ],
          total: 1,
        },
      })

      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getAllByText('swdist.apple.com').length).toBeGreaterThan(0)
        expect(screen.getByText('Apple • safari')).toBeInTheDocument()
      })
    })

    it('должен переключаться на вкладку каталога профилей маскировки', async () => {
      setupMockGet()
      renderDomainsPage()

      const catalogTab = await screen.findByText('Каталог профилей маскировки')
      fireEvent.click(catalogTab)

      await waitFor(() => {
        expect(screen.getByText('Инспектор маскировки (Live SNI Tester)')).toBeInTheDocument()
        expect(screen.getByText('Готовые паспорта маскировки (Reality Profiles)')).toBeInTheDocument()
      })
    })

    it('должен отображать карточки профилей в каталоге (Apple, Microsoft, Google)', async () => {
      setupMockGet()
      renderDomainsPage()

      const catalogTab = await screen.findByText('Каталог профилей маскировки')
      fireEvent.click(catalogTab)

      await waitFor(() => {
        expect(screen.getAllByText('Apple CDN & Services').length).toBeGreaterThan(0)
        expect(screen.getAllByText('Microsoft & Azure Edge').length).toBeGreaterThan(0)
        expect(screen.getAllByText('Google CDN & Omaha Update').length).toBeGreaterThan(0)
      })
    })

    it('должен позволять вводить домен в Live SNI Inspector и отображать параметры маскировки', async () => {
      setupMockGet()
      renderDomainsPage()

      const catalogTab = await screen.findByText('Каталог профилей маскировки')
      fireEvent.click(catalogTab)

      const inspectorInput = await screen.findByPlaceholderText(
        'Введите SNI (например, swdist.apple.com, dl.google.com, mydomain.org)'
      )
      fireEvent.change(inspectorInput, { target: { value: 'dl.google.com' } })

      await waitFor(() => {
        expect(screen.getAllByText('Google CDN & Omaha Update').length).toBeGreaterThan(0)
        expect(screen.getAllByText('/service/update2/').length).toBeGreaterThan(0)
      })
    })

    it('должен открывать и закрывать модальное окно инспекции параметров домена', async () => {
      setupMockGet({
        domains: {
          data: [
            {
              id: 1,
              name: 'swdist.apple.com',
              profile: {
                sni: 'swdist.apple.com',
                category: 'Apple',
                fingerprint: 'safari',
                spiderX: '/content/downloads/',
                xhttpPath: '/download/updates/',
                xPaddingBytes: '500-1500',
              },
            },
          ],
          total: 1,
        },
      })

      renderDomainsPage()

      await waitFor(() => {
        expect(screen.getByText('swdist.apple.com')).toBeInTheDocument()
      })

      const infoButton = await screen.findByTestId('icon-Info')
      fireEvent.click(infoButton)

      await waitFor(() => {
        expect(screen.getByText('Паспорт маскировки Reality')).toBeInTheDocument()
        expect(screen.getByText('Путь протокола XHTTP:')).toBeInTheDocument()
      })

      const closeButton = screen.getByText('Закрыть')
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(screen.queryByText('Паспорт маскировки Reality')).not.toBeInTheDocument()
      })
    })

    it('должен пакетно добавлять проверенные домены из карточки профиля', async () => {
      setupMockGet()
      mockPost.mockResolvedValue({ data: { count: 3 } })

      renderDomainsPage()

      const catalogTab = await screen.findByText('Каталог профилей маскировки')
      fireEvent.click(catalogTab)

      const addButtons = await screen.findAllByText('Добавить проверенные домены')
      expect(addButtons.length).toBeGreaterThan(0)
      fireEvent.click(addButtons[0])

      await waitFor(() => {
        expect(mockPost).toHaveBeenCalledWith('/domains/upload', {
          domains: expect.any(Array),
        })
      })
    })
  })
})

