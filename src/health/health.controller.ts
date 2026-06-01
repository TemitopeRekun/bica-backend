import { Controller, Get, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private prisma: PrismaClient;

  constructor() {
    if (process.env.DATABASE_URL) {
      this.prisma = new PrismaClient();
    }
  }

  @Get()
  async check() {
    const checks: Record<string, string> = {};

    // App
    checks.app = 'ok';

    // Database
    if (this.prisma) {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        checks.database = 'ok';
      } catch {
        checks.database = 'error';
      }
    } else {
      checks.database = 'skipped (no DATABASE_URL)';
    }

    // Redis
    if (process.env.REDIS_URL) {
      try {
        const { default: Redis } = await import('ioredis');
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
      checks.redis = 'skipped (no REDIS_URL)';
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
