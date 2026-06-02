import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const checks: Record<string, string> = {};
    checks.app = 'ok';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    if (process.env.REDIS_URL) {
      try {
        const redis = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          lazyConnect: true,
        });
        await redis.connect();
        await redis.ping();
        checks.redis = 'ok';
        await redis.disconnect();
      } catch {
        checks.redis = 'error';
      }
    } else {
      checks.redis = 'skipped no REDIS_URL';
    }

    const healthy = Object.values(checks).every((v) => v === 'ok');

    return {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    };
  }
}