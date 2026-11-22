import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { generateErrorHtml } from '../client/templates/subscription.template';
import {
  databaseAvailability,
  formatUnknownError,
} from '../database/database-availability';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (response.headersSent) {
      return;
    }

    // Проверяем, что это браузер (не API запрос)
    const userAgent = request.headers['user-agent'] || '';
    const isBrowser = /Mozilla|Chrome|Safari|Firefox|Edge/.test(userAgent);
    const pathname = request.path ?? request.url.split('?')[0];
    const isAutomation = pathname.startsWith('/api/v1/');
    const path = isAutomation ? pathname : request.url;
    const isBusRequest = !isAutomation && request.url.includes('/bus/');

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as { message?: string | string[] })?.message;

      const errorMessage = Array.isArray(message) ? message[0] : message;

      // Для endpoint подписки /bus/* возвращаем HTML
      if (isBrowser && isBusRequest) {
        const html = generateErrorHtml('Подписка не найдена', errorMessage);
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.status(status).send(html);
      } else {
        // Для API запросов возвращаем JSON
        response.status(status).json({
          ...(typeof exceptionResponse === 'object' &&
          exceptionResponse !== null &&
          typeof (exceptionResponse as { code?: unknown }).code === 'string'
            ? { code: (exceptionResponse as { code: string }).code }
            : {}),
          statusCode: status,
          message: errorMessage,
          timestamp: new Date().toISOString(),
          path,
        });
      }
      return;
    }

    const dbError = databaseAvailability.recordFailure(
      exception,
      this.logger,
      'HttpRequest',
      {
        strict: true,
        allowSocketErrors: isBusRequest || databaseAvailability.isDegraded(),
      },
    );

    if (dbError) {
      const retryAfterSeconds = dbError.kind === 'disk_full' ? '30' : '15';
      response.setHeader('Retry-After', retryAfterSeconds);

      if (isBrowser && isBusRequest) {
        const html = generateErrorHtml(
          'Сервис временно недоступен',
          'База данных восстанавливается. Повторите попытку через несколько секунд.',
        );
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.status(HttpStatus.SERVICE_UNAVAILABLE).send(html);
      } else {
        response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
          code: 'DATABASE_UNAVAILABLE',
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Database is temporarily unavailable. Please retry shortly.',
          timestamp: new Date().toISOString(),
          path,
        });
      }
      return;
    }

    const fallbackMessage = formatUnknownError(exception);
    this.logger.error(
      `Unhandled error on ${path}: ${isAutomation ? 'automation request failed' : fallbackMessage}`,
      !isAutomation && exception instanceof Error ? exception.stack : undefined,
    );

    if (isBrowser && isBusRequest) {
      const html = generateErrorHtml(
        'Внутренняя ошибка сервера',
        'Повторите попытку позже.',
      );
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).send(html);
    } else {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        timestamp: new Date().toISOString(),
        path,
      });
    }
  }
}
