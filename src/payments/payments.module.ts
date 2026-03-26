import { Module, forwardRef } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { MonnifyService } from './monnify.service';
import { AuthModule } from '../auth/auth.module';
import { AdminRealtimeModule } from '../admin/admin-realtime.module';
import { RidesModule } from '../rides/rides.module';

@Module({
  imports: [forwardRef(() => AuthModule), AdminRealtimeModule, RidesModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, MonnifyService],
  exports: [PaymentsService, MonnifyService],
})
export class PaymentsModule {}
