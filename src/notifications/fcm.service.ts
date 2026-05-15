import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @InjectQueue('notifications-queue') private readonly notificationsQueue: Queue,
  ) {}

  onModuleInit() {
    if (admin.apps.length > 0) {
      return;
    }

    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase configuration is missing. FCM notifications will be disabled.',
      );
      return;
    }

    try {
      let formattedKey = privateKey.trim().replace(/^"|"$/g, '');
      formattedKey = formattedKey.replace(/\\n/g, '\n');

      if (!formattedKey.includes('\n', 30)) {
        const header = '-----BEGIN PRIVATE KEY-----';
        const footer = '-----END PRIVATE KEY-----';
        
        let content = formattedKey
          .replace(header, '')
          .replace(footer, '')
          .replace(/\s/g, ''); 

        const wrappedContent = content.match(/.{1,64}/g)?.join('\n') || '';
        formattedKey = `${header}\n${wrappedContent}\n${footer}\n`;
      }

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: formattedKey,
        }),
      });
      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error.stack);
    }
  }

  /**
   * 🚀 Industrial Grade: Offloads the notification to a background queue.
   * This ensures the main API thread is never blocked by Firebase network latency.
   */
  async queueNotification(
    userId: string,
    payload: { title: string; body: string; data?: Record<string, string> },
  ) {
    this.logger.debug(`Queuing notification for user ${userId}`);
    await this.notificationsQueue.add('send-notification', {
      userId,
      payload,
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: true,
      removeOnFail: 1000, // Keep failed jobs for 1000 entries for debugging
    });
  }

  /**
   * Internal method used by the processor to send a message via FCM.
   */
  async sendDirectToToken(
    token: string,
    userId: string,
    payload: { title: string; body: string; data?: Record<string, string> },
  ) {
    try {
      // 🚀 Industrial Grade: Ensure all data payload values are strings.
      // FCM throws an error if any value in the 'data' record is a non-string.
      const sanitizedData: Record<string, string> = {};
      if (payload.data) {
        Object.entries(payload.data).forEach(([key, value]) => {
          sanitizedData[key] = String(value);
        });
      }

      const message: admin.messaging.Message = {
        token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: sanitizedData,
        android: {
          priority: 'high',
          notification: {
            channelId: 'ride_updates',
            priority: 'high',
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              contentAvailable: true,
              sound: 'default',
            },
          },
        },
      };

      const response = await admin.messaging().send(message);
      this.logger.log(`Successfully sent FCM message to User ${userId}: ${response}`);
      return response;
    } catch (error) {
      this.logger.error(`Error sending FCM message to User ${userId}: ${error.message}`);
      
      if (
        error.code === 'messaging/registration-token-not-registered' ||
        error.code === 'messaging/invalid-registration-token'
      ) {
        this.logger.warn(`Clearing invalid FCM token for user ${userId}`);
        await this.prisma.user.update({
          where: { id: userId },
          data: { fcmToken: null },
        });
      }
      throw error;
    }
  }

  /**
   * Legacy wrapper for synchronous sending (use queueNotification instead for scale)
   */
  async sendToUser(
    userId: string,
    payload: { title: string; body: string; data?: Record<string, string> },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    if (!user || !user.fcmToken) {
      return;
    }

    return this.sendDirectToToken(user.fcmToken, userId, payload);
  }
}
