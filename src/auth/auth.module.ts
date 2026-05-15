import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { PaymentsModule } from '../payments/payments.module';
import { AdminRealtimeModule } from '../admin/admin-realtime.module';
import { MailService } from '../common/mail.service';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
    forwardRef(() => PaymentsModule),
    AdminRealtimeModule,
    CloudinaryModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, MailService],
  exports: [AuthGuard, JwtModule, AuthService, MailService],
})
export class AuthModule {}
