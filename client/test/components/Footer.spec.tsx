import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Footer from '../../src/components/Footer'

describe('Footer', () => {
  const renderFooter = (props: Partial<React.ComponentProps<typeof Footer>> = {}) => {
    return render(
      <MemoryRouter>
        <Footer {...props} />
      </MemoryRouter>
    )
  }

  it('должен рендериться с логотипом', () => {
    renderFooter()
    const logo = screen.getByAltText('Logo')
    expect(logo).toBeInTheDocument()
    expect(logo).toHaveAttribute('src', '/img/logo.png')
  })

  it('должен отображать ссылку на документацию', () => {
    renderFooter()
    const docLink = screen.getByText('Документация')
    expect(docLink).toBeInTheDocument()
    expect(docLink).toHaveAttribute('href', 'https://3dp-manager.com/docs/intro')
    expect(docLink).toHaveAttribute('target', '_blank')
    expect(docLink).toHaveAttribute('rel', 'noopener')
  })

  it('должен отображать иконку GitHub', () => {
    renderFooter()
    const githubButton = screen.getByLabelText('GitHub')
    expect(githubButton).toBeInTheDocument()
    expect(githubButton.closest('a')).toHaveAttribute(
      'href',
      'https://github.com/K0TD/3dp-manager'
    )
  })

  it('должен отображать иконку YouTube', () => {
    renderFooter()
    const youtubeButton = screen.getByLabelText('YouTube')
    expect(youtubeButton).toBeInTheDocument()
    expect(youtubeButton.closest('a')).toHaveAttribute(
      'href',
      'https://youtube.com/@denpiligrim'
    )
  })

  it('должен отображать иконку Telegram', () => {
    renderFooter()
    const telegramButton = screen.getByLabelText('Telegram')
    expect(telegramButton).toBeInTheDocument()
    expect(telegramButton.closest('a')).toHaveAttribute(
      'href',
      'https://t.me/denpiligrim_web'
    )
  })

  it('должен принимать prop isMobile', () => {
    renderFooter({ isMobile: true })
    expect(screen.getByAltText('Logo')).toBeInTheDocument()
  })

  it('должен иметь правильный семантический тег footer', () => {
    renderFooter()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('должен иметь правильный layout с Grid', () => {
    renderFooter()
    // Проверяем, что все три колонки присутствуют
    expect(screen.getByText('Документация')).toBeInTheDocument()
    expect(screen.getByLabelText('GitHub')).toBeInTheDocument()
    expect(screen.getByAltText('Logo')).toBeInTheDocument()
  })
})
