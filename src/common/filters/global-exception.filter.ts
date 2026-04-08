import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(@Inject(Logger) private readonly logger: Logger) {}

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    // Capture every exception to Sentry
    Sentry.captureException(exception, {
      tags: {
        reqId: request.headers['x-request-id'] as string || 'unknown',
      },
      extra: {
        url: request.url,
        method: request.method,
        body: request.body,
      },
    });

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Log the error with full context if it's an internal server error
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({
        err: exception,
        message: exception.message,
        stack: exception.stack,
        url: request.url,
        method: request.method,
      }, 'Unhandled Exception');
    }

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: typeof message === 'object' ? (message as any).message || message : message,
      error: typeof message === 'object' ? (message as any).error : null,
    };

    response.status(status).send(errorResponse);
  }
}
