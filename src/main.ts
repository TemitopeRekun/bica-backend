// src/main.ts — updated to use Fastify
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // Allow requests from your React frontend
  app.enableCors({
    origin: '*', // we'll tighten this later
  });

  await app.listen(3000, '0.0.0.0');
}
bootstrap();