import { Module, forwardRef } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { AdminRealtimeModule } from './admin-realtime.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    AuthModule,
    AdminRealtimeModule,
    forwardRef(() => PaymentsModule),
    forwardRef(() => UsersModule),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
