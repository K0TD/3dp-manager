import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SecurityWarning from '../../src/components/SecurityWarning'

// Мок для navigator.clipboard
const mockWriteText = vi.fn()
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
})

// Мок для document.execCommand (fallback для старых браузеров)
const mockExecCommand = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  document.execCommand = mockExecCommand
})

describe('SecurityWarning', () => {
  const INSTALL_COMMAND = 'bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)'

  const renderWarning = () => {
    return render(<SecurityWarning />)
  }

  describe('рендеринг', () => {
    it('должен рендериться с заголовком предупреждения', () => {
      renderWarning()
      expect(
        screen.getByText(/3DP-MANAGER работает в небезопасном режиме/i)
      ).toBeInTheDocument()
    })

    it('должен отображать предупреждение о паролях', () => {
      renderWarning()
      expect(
        screen.getByText(/Не вводите реальные пароли от 3x-ui панели/i)
      ).toBeInTheDocument()
    })

    it('должен отображать инструкцию по переустановке', () => {
      renderWarning()
      expect(
        screen.getByText(/Для безопасной работы переустановите 3DP-MANAGER с SSL-сертификатами/i)
      ).toBeInTheDocument()
    })

    it('должен отображать команду установки', () => {
      renderWarning()
      expect(screen.getByText(INSTALL_COMMAND)).toBeInTheDocument()
    })

    it('должен отображать кнопку копирования команды', () => {
      renderWarning()
      expect(screen.getByText('Копировать')).toBeInTheDocument()
    })

    it('должен отображать иконку копирования', () => {
      renderWarning()
      expect(screen.getByTestId('icon-ContentCopy')).toBeInTheDocument()
    })

    it('должен иметь семантически правильный Alert', () => {
      renderWarning()
      const alert = screen.getByRole('alert')
      expect(alert).toBeInTheDocument()
    })
  })

  describe('копирование команды', () => {
    it('должен копировать команду в буфер обмена при клике', async () => {
      mockWriteText.mockResolvedValue(undefined)

      renderWarning()
      const copyButton = screen.getByText('Копировать')
      fireEvent.click(copyButton)

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(INSTALL_COMMAND)
      })
    })

    it('должен показывать уведомление "Скопировано" после копирования', async () => {
      mockWriteText.mockResolvedValue(undefined)

      renderWarning()
      const copyButton = screen.getByText('Копировать')
      fireEvent.click(copyButton)

      await waitFor(() => {
        expect(screen.getByText('Скопировано')).toBeInTheDocument()
      })
    })

    it('должен использовать fallback при отсутствии navigator.clipboard', async () => {
      // Мок ошибки clipboard API
      mockWriteText.mockRejectedValue(new Error('Not supported'))

      renderWarning()
      const copyButton = screen.getByText('Копировать')
      fireEvent.click(copyButton)

      await waitFor(() => {
        expect(mockExecCommand).toHaveBeenCalledWith('copy')
      })
    })

    it('должен показывать уведомление "Скопировано" при использовании fallback', async () => {
      mockWriteText.mockRejectedValue(new Error('Not supported'))
      mockExecCommand.mockReturnValue(true)

      renderWarning()
      const copyButton = screen.getByText('Копировать')
      fireEvent.click(copyButton)

      await waitFor(() => {
        expect(screen.getByText('Скопировано')).toBeInTheDocument()
      })
    })
  })

  describe('Snackbar уведомление', () => {
    it('должен показывать уведомление после копирования', async () => {
      mockWriteText.mockResolvedValue(undefined)

      renderWarning()
      const copyButton = screen.getByText('Копировать')
      fireEvent.click(copyButton)

      await waitFor(() => {
        expect(screen.getByText('Скопировано')).toBeInTheDocument()
      })
    })

    it('должен закрывать уведомление при клике на кнопку закрытия', async () => {
      mockWriteText.mockResolvedValue(undefined)

      renderWarning()
      const copyButton = screen.getByText('Копировать')
      fireEvent.click(copyButton)

      // Ждём появления уведомления
      await waitFor(() => {
        expect(screen.getByText('Скопировано')).toBeInTheDocument()
      })

      // Находим кнопку закрытия по иконке Close
      const closeButton = screen.getByTestId('icon-Close').closest('button')
      if (closeButton) {
        fireEvent.click(closeButton)
      }

      // Уведомление закрыто
      await waitFor(() => {
        expect(screen.queryByText('Скопировано')).not.toBeInTheDocument()
      })
    })
  })

  describe('стили компонента', () => {
    it('должен иметь variant="filled"', () => {
      renderWarning()
      const alert = screen.getByRole('alert')
      // Проверяем что Alert имеет filled стиль (проверка через классы MUI)
      expect(alert).toHaveClass('MuiAlert-filledWarning')
    })

    it('должен отображать код в monospace шрифте', () => {
      renderWarning()
      const codeBlock = screen.getByText(INSTALL_COMMAND)
      expect(codeBlock.tagName).toBe('CODE')
    })
  })
})
