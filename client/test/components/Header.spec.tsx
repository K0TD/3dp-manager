import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Header from '../../src/components/Header'
import { useThemeContext } from '../../src/ThemeContext'
import { useAuth } from '../../src/auth/AuthContext'

vi.mock('../../src/ThemeContext', () => ({
  useThemeContext: vi.fn(),
}))

vi.mock('../../src/auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

describe('Header', () => {
  const mockToggleColorMode = vi.fn()
  const mockLogout = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useThemeContext).mockReturnValue({
      mode: 'light',
      toggleColorMode: mockToggleColorMode,
    })
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      login: vi.fn(),
      logout: mockLogout,
    })
  })

  const renderHeader = (props: Partial<React.ComponentProps<typeof Header>> = {}) => {
    return render(
      <MemoryRouter>
        <Header {...props} />
      </MemoryRouter>
    )
  }

  it('должен рендериться с логотипом и названием', () => {
    renderHeader()
    expect(screen.getByText('3DP / CONTROL')).toBeInTheDocument()
    const logo = screen.getByAltText('Logo')
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveAttribute('src', '/img/logo.png')
  })

  it('должен отображать иконку справки', () => {
    renderHeader()
    const helpButton = screen.getByLabelText('Справка о программе')
    expect(helpButton).toBeInTheDocument()
  })

  it('должен открывать диалог справки при клике на иконку справки', async () => {
    renderHeader()
    const helpButton = screen.getByLabelText('Справка о программе')
    fireEvent.click(helpButton)
    
    await waitFor(() => {
      expect(screen.getByText('Об утилите 3DP-MANAGER')).toBeInTheDocument()
    })
    expect(screen.getByText(/Утилита для автогенерации инбаундов/)).toBeInTheDocument()
  })

  it('должен закрывать диалог справки при клике на кнопку "Понятно"', async () => {
    renderHeader()
    const helpButton = screen.getByLabelText('Справка о программе')
    fireEvent.click(helpButton)
    
    await waitFor(() => {
      expect(screen.getByText('Об утилите 3DP-MANAGER')).toBeInTheDocument()
    })
    
    const closeButton = screen.getByText('Понятно')
    fireEvent.click(closeButton)
    
    await waitFor(() => {
      expect(screen.queryByText('Об утилите 3DP-MANAGER')).not.toBeInTheDocument()
    })
  })

  it('должен отображать иконку темы', () => {
    renderHeader()
    const themeButton = screen.getByLabelText('Режим: Светлая тема')
    expect(themeButton).toBeInTheDocument()
  })

  it('должен вызывать toggleColorMode при клике на иконку темы', () => {
    renderHeader()
    const themeButton = screen.getByLabelText('Режим: Светлая тема')
    fireEvent.click(themeButton)
    expect(mockToggleColorMode).toHaveBeenCalled()
  })

  it('должен отображать правильную иконку для light mode', () => {
    vi.mocked(useThemeContext).mockReturnValue({
      mode: 'light',
      toggleColorMode: mockToggleColorMode,
    })
    renderHeader()
    expect(screen.getByLabelText('Режим: Светлая тема')).toBeInTheDocument()
  })

  it('должен отображать правильную иконку для dark mode', () => {
    vi.mocked(useThemeContext).mockReturnValue({
      mode: 'dark',
      toggleColorMode: mockToggleColorMode,
    })
    renderHeader()
    expect(screen.getByLabelText('Режим: Темная тема')).toBeInTheDocument()
  })

  it('должен отображать правильную иконку для system mode', () => {
    vi.mocked(useThemeContext).mockReturnValue({
      mode: 'system',
      toggleColorMode: mockToggleColorMode,
    })
    renderHeader()
    expect(screen.getByLabelText('Режим: Системная тема')).toBeInTheDocument()
  })

  it('должен отображать иконку выхода', () => {
    renderHeader()
    const logoutButton = screen.getByLabelText('Выйти из системы')
    expect(logoutButton).toBeInTheDocument()
  })

  it('должен открывать диалог подтверждения при клике на выход', async () => {
    renderHeader()
    const logoutButton = screen.getByLabelText('Выйти из системы')
    fireEvent.click(logoutButton)
    
    await waitFor(() => {
      expect(screen.getByText('Вы действительно хотите выйти?')).toBeInTheDocument()
    })
  })

  it('должен закрывать диалог подтверждения при клике на "Отмена"', async () => {
    renderHeader()
    const logoutButton = screen.getByLabelText('Выйти из системы')
    fireEvent.click(logoutButton)
    
    await waitFor(() => {
      expect(screen.getByText('Вы действительно хотите выйти?')).toBeInTheDocument()
    })
    
    const cancelButton = screen.getByText('Отмена')
    fireEvent.click(cancelButton)
    
    await waitFor(() => {
      expect(screen.queryByText('Вы действительно хотите выйти?')).not.toBeInTheDocument()
    })
  })

  it('должен вызывать logout при подтверждении выхода', async () => {
    renderHeader()
    const logoutButton = screen.getByLabelText('Выйти из системы')
    fireEvent.click(logoutButton)
    
    await waitFor(() => {
      expect(screen.getByText('Вы действительно хотите выйти?')).toBeInTheDocument()
    })
    
    const confirmButton = screen.getByText('Выйти')
    fireEvent.click(confirmButton)
    
    expect(mockLogout).toHaveBeenCalled()
  })

  it('должен принимать prop isMobile', () => {
    renderHeader({ isMobile: true })
    expect(screen.getByText('3DP / CONTROL')).toBeInTheDocument()
  })

  it('должен отображать кнопку меню в мобильном режиме', () => {
    const onMenuClick = vi.fn()
    renderHeader({ isMobile: true, onMenuClick })
    
    const menuButton = screen.getByTestId('icon-Menu').closest('button')
    expect(menuButton).toBeInTheDocument()
    
    if (menuButton) {
      fireEvent.click(menuButton)
      expect(onMenuClick).toHaveBeenCalled()
    }
  })

  it('должен отображать версию в диалоге справки', async () => {
    renderHeader()
    const helpButton = screen.getByLabelText('Справка о программе')
    fireEvent.click(helpButton)
    
    await waitFor(() => {
      expect(screen.getByText(/Форк: K0TD/)).toBeInTheDocument()
    })
    // Версия отображается отдельным текстом с br переносом
    expect(screen.getByText(/\d+\.\d+\.\d+/)).toBeInTheDocument()
  })

  it('должен отображать список возможностей в диалоге справки', async () => {
    renderHeader()
    const helpButton = screen.getByLabelText('Справка о программе')
    fireEvent.click(helpButton)
    
    await waitFor(() => {
      expect(screen.getByText('Автоматическая генерация')).toBeInTheDocument()
    })
    expect(screen.getByText('Управление подписками')).toBeInTheDocument()
    expect(screen.getByText('Белый список доменов')).toBeInTheDocument()
    expect(screen.getByText('Перенаправление')).toBeInTheDocument()
  })
})
