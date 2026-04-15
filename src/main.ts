import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import * as dotenv from 'dotenv';

// 1. Load env before EVERYTHING
dotenv.config();

// 2. Initialize Sentry before NestJS factory
const SENTRY_DSN = process.env.SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    integrations: [
      nodeProfilingIntegration(),
    ],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
    beforeSend(event) {
      if (event.request?.data) {
        const data = event.request.data as any;
        const sensitiveFields = ['password', 'token', 'bica_token', 'apiKey', 'secret'];
        sensitiveFields.forEach(field => {
          if (data[field]) data[field] = '[REDACTED]';
        });
      }
      return event;
    },
  });
}

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const adapter = new FastifyAdapter({ 
    logger: false, 
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true // Essential for ngrok/proxy rate limiting
  });
  
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bufferLogs: true, rawBody: true },
  );

  app.useLogger(app.get(Logger));

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
        scriptSrc: [`'self'`, `https: 'unsafe-inline'`],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  });

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
  });

  const config = app.get(ConfigService);
  const corsOrigins = (
    config.get<string>('CORS_ORIGINS') ??
    'http://localhost:3001,http://localhost:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins.includes('*') ? true : corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT || 3001, '0.0.0.0');
}

// 3. Catch boot-phase errors in Sentry
bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  if (SENTRY_DSN) {
    Sentry.captureException(err);
    Sentry.close(2000).then(() => process.exit(1));
  } else {
    process.exit(1);
  }
});
