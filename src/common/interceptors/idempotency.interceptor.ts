import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { RedisService } from '../../redis/redis.service';

interface IdempotencyRecord {
  status: 'PROCESSING' | 'COMPLETED';
  response?: any;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly TTL_COMPLETED = 24 * 60 * 60; // 24 hours
  private readonly TTL_PROCESSING = 60; // 60 seconds

  constructor(private readonly redis: RedisService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    
    // Only apply to POST, PATCH, and DELETE
    if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) {
      return next.handle();
    }

    const key = request.headers['x-idempotency-key'];
    if (!key) {
      return next.handle();
    }

    // We use a combination of the key and the user ID to ensure isolation
    const userId = request.user?.id;
    const cacheKey = `idempotency:${userId || 'anon'}:${key}`;

    const cached = await this.redis.get<IdempotencyRecord>(cacheKey);

    if (cached) {
      if (cached.status === 'COMPLETED') {
        return of(cached.response);
      }
      
      if (cached.status === 'PROCESSING') {
        throw new ConflictException(
          'Request with this idempotency key is already in progress.',
        );
      }
    }

    // Mark as processing
    await this.redis.set(
      cacheKey,
      { status: 'PROCESSING' },
      this.TTL_PROCESSING,
    );

    return next.handle().pipe(
      tap(async (response) => {
        // Cache successful response
        await this.redis.set(
          cacheKey,
          { status: 'COMPLETED', response },
          this.TTL_COMPLETED,
        );
      }),
      catchError((error) => {
        // On error, we delete the key to allow retry
        this.redis.del(cacheKey);
        return throwError(() => error);
      }),
    );
  }
}
