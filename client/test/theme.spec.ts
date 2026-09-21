import { describe, expect, it } from 'vitest'
import { getDesignTokens } from '@/theme'

describe('network console theme', () => {
  it('defines light and dark palettes', () => {
    const light = getDesignTokens('light')
    const dark = getDesignTokens('dark')

    expect(light.palette.mode).toBe('light')
    expect(light.palette.primary.main).toBe('#006f91')
    expect(light.palette.background.default).toBe('#edf3f5')
    expect(dark.palette.mode).toBe('dark')
    expect(dark.palette.primary.main).toBe('#53d8ff')
    expect(dark.palette.background.default).toBe('#081014')
  })

  it('uses console typography and consistent components', () => {
    const tokens = getDesignTokens('dark')

    expect(tokens.typography.fontFamily).toBe('"IBM Plex Sans", sans-serif')
    expect(tokens.typography.h3.fontFamily).toContain('Unbounded')
    expect(tokens.typography.button.textTransform).toBe('none')
    expect(tokens.shape.borderRadius).toBe(10)
    expect(tokens.components.MuiPaper.styleOverrides.root.backgroundImage).toBe('none')
    expect(tokens.components.MuiCssBaseline.styleOverrides.body.backgroundImage).toContain('radial-gradient')
  })
})
