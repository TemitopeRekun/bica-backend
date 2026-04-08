import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user, ip } = request;
    const userAgent = request.headers['user-agent'];

    // Only log state-changing operations
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }

    // Skip logging for internal/health check paths if any
    if (url.includes('/health') || url.includes('/metrics')) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async (response) => {
        try {
          // Identify the entity and ID from the URL (e.g., /users/:id -> User, :id)
          const urlParts = url.split('/').filter(Boolean);
          const entity = urlParts[0]?.toUpperCase() || 'UNKNOWN';
          const entityId = urlParts[1] || null;

          // Sanitize body (remove sensitive fields)
          const sanitizedBody = { ...body };
          const sensitiveFields = ['password', 'passwordHash', 'secret', 'token', 'apiKey'];
          sensitiveFields.forEach((field) => {
            if (field in sanitizedBody) {
              sanitizedBody[field] = '*****';
            }
          });

          await this.prisma.auditLog.create({
            data: {
              userId: user?.id || user?.sub || null,
              action: `${method}_${url}`,
              entity,
              entityId,
              newValue: sanitizedBody,
              ipAddress: ip,
              userAgent,
              metadata: {
                statusCode: context.switchToHttp().getResponse().statusCode,
                path: url,
              },
            },
          });
        } catch (error) {
          this.logger.error(`Failed to create audit log: ${error.message}`);
        }
      }),
    );
  }
}
