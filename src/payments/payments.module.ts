import { Module, forwardRef } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { MonnifyService } from './monnify.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [PaymentsController],
  providers: [PaymentsService, MonnifyService],
  exports: [PaymentsService, MonnifyService],
})
export class PaymentsModule {}