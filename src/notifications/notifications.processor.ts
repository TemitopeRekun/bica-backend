import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { FcmService } from './fcm.service';
import { PrismaService } from '../prisma/prisma.service';

@Processor('notifications-queue')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly fcmService: FcmService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { userId, payload } = job.data;

    this.logger.debug(`Processing notification job ${job.id} for user ${userId}`);

    try {
      // 1. Fetch fresh token from DB (to ensure we use the latest if it changed while in queue)
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fcmToken: true },
      });

      if (!user || !user.fcmToken) {
        this.logger.debug(`User ${userId} has no registered FCM token. Skipping job.`);
        return { skipped: true, reason: 'no_token' };
      }

      // 2. Send via direct method
      const response = await this.fcmService.sendDirectToToken(
        user.fcmToken,
        userId,
        payload,
      );

      return { success: true, response };
    } catch (error) {
      this.logger.error(`Failed to process notification for user ${userId}: ${error.message}`);
      throw error; // Let BullMQ handle retries
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed with error: ${error.message}`);
  }
}
