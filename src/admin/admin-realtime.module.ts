import { Module } from '@nestjs/common';
import { AdminRealtimeGateway } from './admin-realtime.gateway';

@Module({
  providers: [AdminRealtimeGateway],
  exports: [AdminRealtimeGateway],
})
export class AdminRealtimeModule {}
