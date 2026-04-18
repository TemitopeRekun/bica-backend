import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  Logger,
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
  private readonly TTL_PROCESSING = 5; // 5 seconds (ultra-permissive for high-latency)
  private readonly logger = new Logger('Idempotency');

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

    const userId = request.user?.id || 'anon';
    const cacheKey = `idempotency:${userId}:${key}`;

    // Atomically acquire the processing lock — eliminates the TOCTOU gap between
    // a GET check and a subsequent SET that two concurrent requests could race through.
    const acquired = await this.redis.setIfNotExists(
      cacheKey,
      { status: 'PROCESSING' },
      this.TTL_PROCESSING,
    );

    if (!acquired) {
      // Key already existed — read what's there
      const cached = await this.redis.get<IdempotencyRecord>(cacheKey);

      if (cached?.status === 'COMPLETED') {
        this.logger.debug(`[Hit] Returning cached response for: ${cacheKey}`);
        return of(cached.response);
      }

      this.logger.warn(`[Conflict] Request already in progress for: ${cacheKey}`);
      throw new ConflictException(
        'Request with this idempotency key is already in progress.',
      );
    }

    this.logger.debug(`[Lock] Acquired PROCESSING lock for: ${cacheKey}`);

    return next.handle().pipe(
      tap(async (response) => {
        // Cache successful response
        await this.redis.set(
          cacheKey,
          { status: 'COMPLETED', response },
          this.TTL_COMPLETED,
        );
      }),
      catchError(async (error) => {
        // On error, delete the key to allow retry
        await this.redis.del(cacheKey);
        return throwError(() => error);
      }),
    );
  }
}
