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
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
    beforeSend(event) {
      if (event.request?.data) {
        const data = event.request.data as any;
        const sensitiveFields = ['password', 'token', 'bica_token', 'apiKey', 'secret'];
        sensitiveFields.forEach((field) => {
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
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { Logger as PinoLogger } from 'nestjs-pino';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bufferLogs: true, rawBody: true },
  );

  app.useLogger(app.get(PinoLogger));

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const corsOrigins = (
    config.get<string>('CORS_ORIGINS') ??
    'http://localhost:3000,http://localhost:3001,http://localhost:5173,https://bicadriver.netlify.app,https://bicadrive.app,https://app.bicadriver.ng'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  logger.log(`🛡️ CORS Origins Allowed: ${corsOrigins.join(', ')}`);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      logger.warn(`🚫 CORS Blocked for origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'PUT'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Idempotency-Key',
      'x-idempotency-key',
      'idempotency-key',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, 'data:', 'validator.swagger.io', 'res.cloudinary.com'],
        scriptSrc: [`'self'`, 'https:', `'unsafe-inline'`],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
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

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const requiredEnvVars = [
    'JWT_SECRET',
    'DATABASE_URL',
    'REDIS_URL',
    'MONNIFY_API_KEY',
    'MONNIFY_SECRET_KEY',
    'MONNIFY_BASE_URL',
    'MONNIFY_CONTRACT_CODE',
  ];

  const missingVars = requiredEnvVars.filter((key) => !process.env[key]);
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('BicaDriver API')
    .setDescription('Ride-hailing backend API for BicaDriver')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

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