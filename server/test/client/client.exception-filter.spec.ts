/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { HttpExceptionFilter } from 'src/client/client.exception-filter';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    filter = new HttpExceptionFilter();

    mockResponse = {
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
  });
});
