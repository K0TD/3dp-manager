import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  pingDomainFromBrowser,
  pingDomainFromVps,
  pingDomainCombined,
} from '../../src/utils/domainPing';
import api from '../../src/api';

vi.mock('../../src/api', () => ({
  default: {
    post: vi.fn(),
  },
}));

describe('domainPing utility', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('pingDomainFromBrowser', () => {
    it('должен возвращать ошибку для пустого домена', async () => {
      const res = await pingDomainFromBrowser('');
      expect(res.reachable).toBe(false);
      expect(res.error).toBe('Некорректный домен');
    });

    it('должен успешно возвращать reachable: true при успешном ответе fetch', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        type: 'opaque',
        status: 0,
      });

      const res = await pingDomainFromBrowser('https://swdist.apple.com:443/path');
      expect(res.reachable).toBe(true);
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://swdist.apple.com/'),
        expect.objectContaining({ mode: 'no-cors' }),
      );
    });

    it('должен определять таймаут AbortError', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      globalThis.fetch = vi.fn().mockRejectedValue(abortError);

      const res = await pingDomainFromBrowser('blocked-site.com');
      expect(res.reachable).toBe(false);
      expect(res.error).toContain('Таймаут (блокировка ТСПУ/DPI)');
    });

    it('должен определять сброс соединения или ошибку сети', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const res = await pingDomainFromBrowser('speedtest.net');
      expect(res.reachable).toBe(false);
      expect(res.error).toContain('Сброс соединения / Заблокирован в РФ');
    });
  });

  describe('pingDomainFromVps', () => {
    it('должен возвращать ошибку для пустого домена', async () => {
      const res = await pingDomainFromVps('');
      expect(res.reachable).toBe(false);
      expect(res.error).toBe('Некорректный домен');
    });

    it('должен возвращать результат из API VPS', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: {
          reachable: true,
          latencyMs: 42,
          protocol: 'TLSv1.3',
        },
      });

      const res = await pingDomainFromVps('dl.google.com');
      expect(res.reachable).toBe(true);
      expect(res.latencyMs).toBe(42);
      expect(res.protocol).toBe('TLSv1.3');
      expect(api.post).toHaveBeenCalledWith('/domains/ping', { domain: 'dl.google.com' });
    });

    it('должен обрабатывать ошибку сети к VPS', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Network error'));

      const res = await pingDomainFromVps('dl.google.com');
      expect(res.reachable).toBe(false);
      expect(res.error).toBe('Ошибка запроса к VPS');
    });
  });

  describe('pingDomainCombined', () => {
    it('должен объединять результаты браузера и VPS', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ type: 'opaque' });
      vi.mocked(api.post).mockResolvedValueOnce({
        data: {
          reachable: true,
          latencyMs: 15,
          protocol: 'TLSv1.3',
        },
      });

      const res = await pingDomainCombined('swdist.apple.com');
      expect(res.domain).toBe('swdist.apple.com');
      expect(res.browser.reachable).toBe(true);
      expect(res.vps.reachable).toBe(true);
      expect(res.vps.latencyMs).toBe(15);
    });
  });
});
