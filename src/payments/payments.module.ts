import { Module, forwardRef } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { MonnifyService } from './monnify.service';
import { AuthModule } from '../auth/auth.module';
import { AdminRealtimeModule } from '../admin/admin-realtime.module';

@Module({
  imports: [forwardRef(() => AuthModule), AdminRealtimeModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, MonnifyService],
  exports: [PaymentsService, MonnifyService],
})
export class PaymentsModule {}
