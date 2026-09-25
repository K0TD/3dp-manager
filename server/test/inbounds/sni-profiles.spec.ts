import {
  resolveSniProfile,
  DEFAULT_SNI_PROFILE,
} from 'src/inbounds/sni-profiles';

describe('resolveSniProfile', () => {
  it('resolves exact Apple CDN profile', () => {
    const profile = resolveSniProfile('swdist.apple.com');
    expect(profile.fingerprint).toBe('safari');
    expect(profile.spiderX).toBe('/content/downloads/');
    expect(profile.xhttpPath).toBe('/download/updates/');
    expect(profile.xPaddingBytes).toBe('500-1500');
    expect(profile.serverNames).toContain('swdist.apple.com');
    expect(profile.serverNames).toContain('swcdn.apple.com');
  });

  it('resolves exact Google download profile', () => {
    const profile = resolveSniProfile('dl.google.com');
    expect(profile.fingerprint).toBe('chrome');
    expect(profile.spiderX).toBe('/chrome/');
    expect(profile.xhttpPath).toBe('/service/update2/');
    expect(profile.serverNames).toEqual(['dl.google.com']);
  });

  it('resolves exact Microsoft static CDN profile', () => {
    const profile = resolveSniProfile('c.s-microsoft.com');
    expect(profile.fingerprint).toBe('edge');
    expect(profile.spiderX).toBe('/content/');
    expect(profile.xhttpPath).toBe('/msdownload/update/');
    expect(profile.serverNames).toContain('c.s-microsoft.com');
  });

  it('resolves exact Samsung profile', () => {
    const profile = resolveSniProfile('www.samsung.com');
    expect(profile.fingerprint).toBe('android');
    expect(profile.spiderX).toBe('/assets/');
    expect(profile.xhttpPath).toBe('/sec/assets/');
  });

  it('resolves exact Speedtest profile', () => {
    const profile = resolveSniProfile('speedtest.net');
    expect(profile.fingerprint).toBe('chrome');
    expect(profile.spiderX).toBe('/api/');
    expect(profile.xhttpPath).toBe('/api/v1/ping');
  });

  it('resolves wildcard / suffix match for subdomains of Apple', () => {
    const profile = resolveSniProfile('updates.custom.apple.com');
    expect(profile.fingerprint).toBe('safari');
    expect(profile.spiderX).toBe('/content/downloads/');
    expect(profile.xhttpPath).toBe('/download/updates/');
    expect(profile.serverNames).toEqual(['updates.custom.apple.com']);
  });

  it('resolves wildcard / suffix match for subdomains of Microsoft', () => {
    const profile = resolveSniProfile('portal.azure.com');
    expect(profile.fingerprint).toBe('edge');
    expect(profile.spiderX).toBe('/content/');
    expect(profile.serverNames).toEqual(['portal.azure.com']);
  });

  it('falls back to default profile for unknown custom domains', () => {
    const profile = resolveSniProfile('my-custom-domain.example');
    expect(profile.fingerprint).toBe(DEFAULT_SNI_PROFILE.fingerprint);
    expect(profile.spiderX).toBe(DEFAULT_SNI_PROFILE.spiderX);
    expect(profile.xhttpPath).toBe(DEFAULT_SNI_PROFILE.xhttpPath);
    expect(profile.serverNames).toEqual(['my-custom-domain.example']);
  });

  it('normalizes uppercase, whitespace and trailing ports', () => {
    const profile = resolveSniProfile('  SWDIST.APPLE.COM:443  ');
    expect(profile.sni).toBe('swdist.apple.com');
    expect(profile.fingerprint).toBe('safari');
    expect(profile.spiderX).toBe('/content/downloads/');
  });

  it('handles empty or null gracefully', () => {
    const profile1 = resolveSniProfile('');
    expect(profile1.sni).toBe('');
    expect(profile1.fingerprint).toBe(DEFAULT_SNI_PROFILE.fingerprint);

    const profile2 = resolveSniProfile(null);
    expect(profile2.sni).toBe('');
    expect(profile2.fingerprint).toBe(DEFAULT_SNI_PROFILE.fingerprint);
  });
});
