import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FcmService } from './fcm.service';
import { NotificationsProcessor } from './notifications.processor';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'notifications-queue',
    }),
  ],
  providers: [FcmService, NotificationsProcessor],
  exports: [FcmService],
})
export class NotificationsModule {}
