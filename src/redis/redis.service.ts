import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
  const url = this.config.get<string>('REDIS_URL');

  this.client = new Redis(url!, {
    maxRetriesPerRequest: 10,
    connectTimeout: 30000,
    keepAlive: 30000,
    lazyConnect: true,
    tls: url?.startsWith('rediss://') ? {} : undefined,
  });

  this.client.on('connect', () => {
    this.logger.log('Redis connected');
  });

  this.client.on('error', (err) => {
    this.logger.error('Redis connection error:', err.message);
  });

  try {
    await this.client.connect();
    this.logger.log('Redis connected successfully');
  } catch (err: any) {
    this.logger.error('Redis failed to connect:', err.message);
  }
}
  async onModuleDestroy() {
    await this.client.quit();
  }

  // Store a value with optional TTL in seconds
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, serialized);
    } else {
      await this.client.set(key, serialized);
    }
  }

  // Retrieve a value — returns null if not found or expired
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  }

  // Delete a key
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  // Check if a key exists
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  /**
   * Atomically set key=value with TTL only if the key does not already exist.
   * Returns true if the key was set (we won the lock), false if it already existed.
   */
  async setIfNotExists(key: string, value: any, ttlSeconds: number): Promise<boolean> {
    const serialized = JSON.stringify(value);
    const result = await this.client.set(key, serialized, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
}