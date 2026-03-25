import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { RidesGateway } from './rides.gateway';
import { AuthModule } from '../auth/auth.module';
import { AdminRealtimeModule } from '../admin/admin-realtime.module';

@Module({
  imports: [AuthModule, AdminRealtimeModule],
  controllers: [RidesController],
  providers: [RidesService, RidesGateway],
  exports: [RidesService, RidesGateway],
})
export class RidesModule {}
