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
    // Prevent multiple initializations if the module is initialized more than once
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
      // 1. Handle common formatting issues: surrounding quotes and escaped newlines
      let formattedKey = privateKey.trim().replace(/^"|"$/g, '');
      
      // Replace literal \n strings with actual newlines
      formattedKey = formattedKey.replace(/\\n/g, '\n');

      // 2. If the key still doesn't have internal newlines, it might be a single-line string
      // that needs PEM wrapping (common in some environment variable managers)
      if (!formattedKey.includes('\n', 30)) { // Check after the header
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
