import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
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
      // Master PEM formatting: Ensure 64-character line wrapping
      let rawKey = privateKey.trim().replace(/^"|"$/g, '');
      
      const header = '-----BEGIN PRIVATE KEY-----';
      const footer = '-----END PRIVATE KEY-----';
      
      // 1. Get just the base64 content
      let content = rawKey
        .replace(header, '')
        .replace(footer, '')
        .replace(/\s/g, ''); 

      // 2. Wrap content at 64 characters (PEM standard)
      const wrappedContent = content.match(/.{1,64}/g)?.join('\n') || '';

      // 3. Final re-assembly
      const formattedKey = `${header}\n${wrappedContent}\n${footer}\n`;

      this.logger.debug(`Formatted key check (header): ${formattedKey.startsWith(header)}`);
      this.logger.debug(`Formatted key check (footer): ${formattedKey.trim().endsWith(footer)}`);

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
   * Send a notification to a specific user by fetching their FCM token from the database.
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
      this.logger.debug(`User ${userId} has no registered FCM token. Skipping notification.`);
      return;
    }

    return this.sendDirect(user.fcmToken, userId, payload);
  }

  /**
   * Internal method to send a message via FCM.
   */
  private async sendDirect(
    token: string,
    userId: string,
    payload: { title: string; body: string; data?: Record<string, string> },
  ) {
    try {
      const message: admin.messaging.Message = {
        token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
        android: {
          priority: 'high',
          notification: {
            channelId: 'ride_updates',
            priority: 'high',
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
      
      // If the token is invalid, clear it from the database
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
}
