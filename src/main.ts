import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.enableCors({ origin: '*' });

  // Activates all class-validator decorators globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // strips fields not in the DTO
      forbidNonWhitelisted: true, // throws error if unknown fields sent
      transform: true,       // auto-converts types (e.g string "5" to number 5)
    }),
  );

  await app.listen(3000, '0.0.0.0');
}
bootstrap();