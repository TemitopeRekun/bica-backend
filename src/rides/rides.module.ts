import { Module, forwardRef } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { RidesGateway } from './rides.gateway';
import { RideProcessor } from './jobs/ride.processor';
import { AuthModule } from '../auth/auth.module';
import { AdminRealtimeModule } from '../admin/admin-realtime.module';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

@Module({
  imports: [
    forwardRef(() => AuthModule), 
    AdminRealtimeModule,
    BullModule.registerQueue({
      name: 'rides-queue',
    }),
    BullBoardModule.forFeature({
      name: 'rides-queue',
      adapter: BullMQAdapter,
    }),
  ],
  controllers: [RidesController],
  providers: [RidesService, RidesGateway, RideProcessor],
  exports: [RidesService, RidesGateway],
})
export class RidesModule {}
