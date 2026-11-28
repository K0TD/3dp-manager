import { describe, expect, it } from 'vitest'
import {
  CLIENT_SNI_PROFILES_CATALOG,
  resolveClientSniProfile,
} from '@/utils/sniProfiles'

const REALITY_SAFE_FINGERPRINTS = ['chrome', 'firefox', 'safari']

describe('sniProfiles (Xray 26.9.9+ REALITY compatibility)', () => {
  it('uses only REALITY-safe fingerprints across the client SNI catalog', () => {
    expect(CLIENT_SNI_PROFILES_CATALOG.length).toBeGreaterThan(0)
    for (const entry of CLIENT_SNI_PROFILES_CATALOG) {
      expect(REALITY_SAFE_FINGERPRINTS).toContain(entry.profile.fingerprint)
    }
  })

  it('resolves Microsoft domains to chrome instead of deprecated edge', () => {
    expect(resolveClientSniProfile('www.microsoft.com').fingerprint).toBe('chrome')
    expect(resolveClientSniProfile('c.s-microsoft.com').fingerprint).toBe('chrome')
  })

  it('resolves Samsung domains to chrome instead of broken android', () => {
    const profile = resolveClientSniProfile('www.samsung.com')
    expect(profile.fingerprint).toBe('chrome')
    expect(profile.spiderX).toBe('/assets/')
    expect(profile.xhttpPath).toBe('/sec/assets/')
  })

  it('resolves Apple domains to safari', () => {
    expect(resolveClientSniProfile('swdist.apple.com').fingerprint).toBe('safari')
  })

  it('falls back to a REALITY-safe fingerprint for unknown SNIs', () => {
    const fallback = resolveClientSniProfile('custom.example.com')
    expect(REALITY_SAFE_FINGERPRINTS).toContain(fallback.fingerprint)
  })
})
