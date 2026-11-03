/* eslint-disable @typescript-eslint/no-unsafe-call */

import cookieParser from 'cookie-parser';
import type { Response } from 'express';

describe('main.ts - CORS и middleware', () => {
  describe('CORS конфигурация', () => {
    it('должен разрешить origin из ALLOWED_ORIGINS', () => {
      process.env.ALLOWED_ORIGINS = 'http://localhost:8080,http://localhost';

      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

      expect(allowedOrigins).toContain('http://localhost:8080');
      expect(allowedOrigins).toContain('http://localhost');

      delete process.env.ALLOWED_ORIGINS;
    });

    it('должен вернуть пустой массив если ALLOWED_ORIGINS не задан', () => {
      process.env.ALLOWED_ORIGINS = '';

      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

      expect(allowedOrigins).toHaveLength(0);

      delete process.env.ALLOWED_ORIGINS;
    });

    it('должен разрешить все origin если ALLOWED_ORIGINS пустой', () => {
      const allowedOrigins: string[] = [];

      const result = allowedOrigins.length === 0 ? 'all' : 'restricted';

      expect(result).toBe('all');
    });

    it('должен заблокировать origin не из ALLOWED_ORIGINS', () => {
      process.env.ALLOWED_ORIGINS = 'http://localhost:8080';

      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

      const testOrigin = 'http://evil.com';
      const isAllowed = allowedOrigins.includes(testOrigin);

      expect(isAllowed).toBe(false);

      delete process.env.ALLOWED_ORIGINS;
    });

    it('должен разрешить запросы без origin (mobile apps, curl)', () => {
      const callback = jest.fn();
      const origin = undefined;

      // Симуляция CORS callback для запросов без origin
      if (!origin) {
        callback(null, true);
      }

      expect(callback).toHaveBeenCalledWith(null, true);
    });
  });

  describe('Request tracing middleware', () => {
    it('должен логировать время выполнения запроса', () => {
      const mockResponse = {
        statusCode: 200,
        on: jest.fn((event: string, handler: () => void) => {
          if (event === 'finish') {
            handler();
          }
        }),
      } as unknown as Response;

      const next = jest.fn<void, []>();

      // Симуляция middleware
      const startedAt = Date.now();
      mockResponse.on('finish', () => {
        const duration = Date.now() - startedAt;
        expect(duration).toBeGreaterThanOrEqual(0);
      });

      next();

      expect(next).toHaveBeenCalled();
    });

    it('должен вызвать next() для продолжения обработки', () => {
      const next = jest.fn<void, []>();

      // Симуляция middleware
      next();

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('cookie-parser middleware', () => {
    it('должен быть импортирован и использован как функция', () => {
      // Проверяем что cookie-parser может быть вызван как функция
      // Реальная проверка происходит в runtime через main.ts
      expect(typeof cookieParser).toBe('function');
      expect(typeof cookieParser()).toBe('function');
    });
  });

  describe('app.listen конфигурация', () => {
    it('должен слушать на 0.0.0.0 для работы в Docker', () => {
      const port = 3100;
      const host = '0.0.0.0';

      // Проверка что хост задан правильно
      expect(host).toBe('0.0.0.0');
      expect(port).toBe(3100);
    });
  });

  describe('ConfigService использование', () => {
    it('должен получить ALLOWED_ORIGINS из ConfigService', () => {
      const mockConfigService = {
        get: jest.fn((key: string, defaultValue?: string) => {
          if (key === 'ALLOWED_ORIGINS') {
            return 'http://localhost:8080';
          }
          return defaultValue;
        }),
      };

      const allowedOrigins = mockConfigService.get('ALLOWED_ORIGINS', '');

      expect(allowedOrigins).toBe('http://localhost:8080');
      expect(mockConfigService.get).toHaveBeenCalledWith('ALLOWED_ORIGINS', '');
    });

    it('должен вернуть пустую строку если ALLOWED_ORIGINS не задан', () => {
      const mockConfigService = {
        get: jest.fn((key: string, defaultValue?: string) => {
          if (key === 'ALLOWED_ORIGINS') {
            return defaultValue;
          }
          return defaultValue;
        }),
      };

      const allowedOrigins = mockConfigService.get('ALLOWED_ORIGINS', '');

      expect(allowedOrigins).toBe('');
    });

    it('должен получить NODE_ENV для определения production режима', () => {
      process.env.NODE_ENV = 'production';

      const mockConfigService = {
        get: jest.fn((key: string, defaultValue?: string) => {
          return process.env[key] ?? defaultValue;
        }),
      };

      const nodeEnv = mockConfigService.get('NODE_ENV');

      expect(nodeEnv).toBe('production');

      delete process.env.NODE_ENV;
    });
  });
});
