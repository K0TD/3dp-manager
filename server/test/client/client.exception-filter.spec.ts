/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { HttpExceptionFilter } from 'src/client/client.exception-filter';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { databaseAvailability } from 'src/database/database-availability';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    databaseAvailability.reset();
    filter = new HttpExceptionFilter();

    mockResponse = {
      headersSent: false,
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    };

    mockRequest = {
      url: '/bus/test-uuid',
      headers: {},
    };

    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: jest.fn().mockReturnValue(mockResponse),
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('catch', () => {
    it('должен вернуть HTML для браузера на /bus/', () => {
      mockRequest.headers['user-agent'] = 'Mozilla/5.0 Chrome/120.0';
      mockRequest.url = '/bus/abc-123';

      const exception = new HttpException(
        'Подписка не найдена',
        HttpStatus.NOT_FOUND,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/html; charset=utf-8',
      );
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('<!DOCTYPE html>'),
      );
    });

    it('должен вернуть JSON для API запросов', () => {
      mockRequest.headers['user-agent'] = 'axios/1.6.0';
      mockRequest.url = '/api/subscriptions';

      const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        statusCode: 404,
        message: 'Not found',
        timestamp: expect.any(String),
        path: '/api/subscriptions',
      });
    });

    it('передаёт код ошибки в JSON', () => {
      filter.catch(
        new HttpException(
          { code: 'INBOUND_DELETE_FAILED', message: 'failed' },
          400,
        ),
        mockHost,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INBOUND_DELETE_FAILED',
          message: 'failed',
        }),
      );
    });

    it('должен вернуть JSON для не-браузера на /bus/', () => {
      mockRequest.headers['user-agent'] = 'curl/7.68.0';
      mockRequest.url = '/bus/test-uuid';

      const exception = new HttpException(
        'Subscription not found',
        HttpStatus.NOT_FOUND,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalled();
      expect(mockResponse.send).not.toHaveBeenCalled();
    });

    it('должен обработать массив сообщений в ошибке', () => {
      mockRequest.headers['user-agent'] = 'axios/1.6.0';
      mockRequest.url = '/api/test';

      const exception = new HttpException(
        { message: ['Field required', 'Invalid format'], statusCode: 400 },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Field required',
          statusCode: 400,
        }),
      );
    });

    it('должен обработать строку в качестве ответа ошибки', () => {
      mockRequest.headers['user-agent'] = 'axios/1.6.0';
      mockRequest.url = '/api/test';

      const exception = new HttpException(
        'Simple error message',
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Simple error message',
          statusCode: 400,
        }),
      );
    });

    it('должен распознать браузер по User-Agent', () => {
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Mozilla/5.0 Chrome/120.0.0.0',
        'Mozilla/5.0 Safari/537.36',
        'Mozilla/5.0 Firefox/121.0',
        'Mozilla/5.0 Edge/120.0.0.0',
      ];

      userAgents.forEach((ua) => {
        mockRequest.headers['user-agent'] = ua;
        mockRequest.url = '/bus/test';

        const exception = new HttpException('Error', HttpStatus.NOT_FOUND);
        filter.catch(exception, mockHost);

        expect(mockResponse.send).toHaveBeenCalledWith(
          expect.stringContaining('<!DOCTYPE html>'),
        );
        jest.clearAllMocks();
      });
    });

    it('должен распознать не-браузер по User-Agent', () => {
      const userAgents = [
        'axios/1.6.0',
        'curl/7.68.0',
        'node-fetch/2.6.0',
        'PostmanRuntime/7.32.0',
        '',
      ];

      userAgents.forEach((ua) => {
        mockRequest.headers['user-agent'] = ua;
        mockRequest.url = '/bus/test';

        const exception = new HttpException('Error', HttpStatus.NOT_FOUND);
        filter.catch(exception, mockHost);

        expect(mockResponse.send).not.toHaveBeenCalledWith(
          expect.stringContaining('<!DOCTYPE html>'),
        );
        jest.clearAllMocks();
      });
    });

    it('возвращает 503 и Retry-After для /bus/ при 57P03 (БД в recovery)', () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mockRequest.headers['user-agent'] = 'v2rayNG/1.8.0';
      mockRequest.url = '/bus/faaf7896-91bb-43b7-9927-ada74b4bc7ca';

      const pgErr = Object.assign(
        new Error('the database system is not yet accepting connections'),
        {
          code: '57P03',
          detail: 'Consistent recovery state has not been yet reached.',
        },
      );

      filter.catch(pgErr, mockHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Retry-After', '15');
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'DATABASE_UNAVAILABLE',
          statusCode: 503,
        }),
      );
      expect(errorSpy).toHaveBeenCalledTimes(1);

      // Повторный запрос с той же ошибкой не должен спамить лог
      filter.catch(pgErr, mockHost);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });

    it('возвращает 503 HTML и Retry-After: 30 для браузера на /bus/ при 53100 (нет места на диске)', () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mockRequest.headers['user-agent'] = 'Mozilla/5.0 Chrome/120.0';
      mockRequest.url = '/bus/faaf7896-91bb-43b7-9927-ada74b4bc7ca';

      const diskFullErr = Object.assign(
        new Error('could not write init file: No space left on device'),
        { code: '53100' },
      );

      filter.catch(diskFullErr, mockHost);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Retry-After', '30');
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/html; charset=utf-8',
      );
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('Сервис временно недоступен'),
      );
      errorSpy.mockRestore();
    });

    it('возвращает 503 для /bus/ при разрыве сокета ECONNRESET', () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mockRequest.headers['user-agent'] = 'Happ/1.0';
      mockRequest.url = '/bus/test-uuid';

      const resetErr = Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
      });

      filter.catch(resetErr, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      errorSpy.mockRestore();
    });

    it('не принимает Axios ECONNREFUSED за падение БД и возвращает 500', () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mockRequest.headers['user-agent'] = 'axios/1.6.0';
      mockRequest.url = '/api/nodes';

      const axiosErr = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
        isAxiosError: true,
      });

      filter.catch(axiosErr, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Internal server error',
        }),
      );
      expect(databaseAvailability.isDegraded()).toBe(false);
      errorSpy.mockRestore();
    });

    it('ничего не отправляет, если заголовки ответа уже отправлены', () => {
      mockResponse.headersSent = true;
      filter.catch(
        new HttpException('Not found', HttpStatus.NOT_FOUND),
        mockHost,
      );
      expect(mockResponse.status).not.toHaveBeenCalled();
    });
  });
});
