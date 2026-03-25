import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';
import { RidesModule } from '../rides/rides.module';
import { AdminRealtimeModule } from '../admin/admin-realtime.module';

@Module({
  imports: [AuthModule, RidesModule, AdminRealtimeModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
