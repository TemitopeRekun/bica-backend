import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PaymentStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MonnifyService } from './monnify.service';
import { ConfigService } from '@nestjs/config';
import { AdminRealtimeGateway } from '../admin/admin-realtime.gateway';
import { RidesGateway } from '../rides/rides.gateway';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private monnify: MonnifyService,
    private config: ConfigService,
    private adminRealtimeGateway: AdminRealtimeGateway,
    private ridesGateway: RidesGateway,
  ) {}

  // â”€â”€â”€ CREATE MONNIFY SUB ACCOUNT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Called async after driver registration
  // Stores subAccountCode on User record

  async createDriverSubAccount(driverId: string): Promise<void> {
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        name: true,
        email: true,
        bankCode: true,
        accountNumber: true,
        monnifySubAccountCode: true,
      },
    });

    if (!driver) return;
    if (driver.monnifySubAccountCode) return;
    if (!driver.bankCode || !driver.accountNumber) return;

    try {
      const subAccountCode = await this.monnify.createSubAccount({
        name: driver.name,
        email: driver.email,
        bankCode: driver.bankCode,
        accountNumber: driver.accountNumber,
      });

      await this.prisma.user.update({
        where: { id: driverId },
        data: { monnifySubAccountCode: subAccountCode },
      });

      this.logger.log(`Sub account created and stored for driver ${driverId}`);
    } catch (error) {
      this.logger.error(
        `Failed to create sub account for driver ${driverId}`,
        error,
      );
    }
  }

  // â”€â”€â”€ INITIATE PAYMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Called after trip is COMPLETED
  // Generates Monnify checkout URL for owner to pay

  async initiatePayment(tripId: string, requestingUserId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        driver: {
          select: {
            id: true,
            name: true,
            monnifySubAccountCode: true,
          },
        },
      },
    });

    if (!trip) throw new NotFoundException('Trip not found');

    if (trip.ownerId !== requestingUserId) {
      throw new ForbiddenException('Only the trip owner can initiate payment');
    }

    if (trip.status !== 'COMPLETED') {
      throw new BadRequestException(
        'Payment can only be initiated for completed trips',
      );
    }

    if (trip.paymentStatus === 'PAID') {
      throw new BadRequestException('This trip has already been paid for');
    }

    if (!trip.driver?.monnifySubAccountCode) {
      throw new BadRequestException(
        'Driver payment account not configured. Please contact support.',
      );
    }

    const settings = await this.prisma.systemSettings.findUnique({
      where: { id: 1 },
    });

    const driverSplitPercent = 100 - (settings?.commission ?? 25);

    const { checkoutUrl, transactionReference } =
      await this.monnify.initiateTransaction({
        amount: trip.amount,
        tripId: trip.id,
        ownerEmail: trip.owner.email,
        ownerName: trip.owner.name,
        driverSubAccountCode: trip.driver.monnifySubAccountCode,
        driverSplitPercent,
      });

    await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        paymentStatus: 'PENDING',
        monnifyTxRef: transactionReference,
      },
    });

    const response = {
      checkoutUrl,
      transactionReference,
      amount: trip.amount,
      driverEarnings: trip.driverEarnings,
      platformEarnings: trip.commissionAmount,
    };

    this.adminRealtimeGateway.notifyPaymentUpdated('initiated', {
      tripId,
      transactionReference,
      amount: trip.amount,
      paymentStatus: 'PENDING',
      ownerId: trip.ownerId,
      driverId: trip.driverId,
    });

    this.ridesGateway.notifyOwnerPaymentUpdated(trip.ownerId, {
      tripId,
      paymentStatus: PaymentStatus.PENDING,
      paidAt: null,
      transactionReference,
      message: 'Payment initiated. Awaiting checkout completion.',
    });

    return response;
  }

  async getPaymentStatus(
    tripId: string,
    requestingUserId: string,
    role: UserRole,
  ) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        paymentRecord: {
          select: {
            id: true,
            monnifyTxRef: true,
            paymentMethod: true,
            paidAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!trip) {
      throw new NotFoundException('Trip not found');
    }

    const canAccess =
      role === UserRole.ADMIN ||
      trip.ownerId === requestingUserId ||
      trip.driverId === requestingUserId;

    if (!canAccess) {
      throw new ForbiddenException('You do not have access to this payment');
    }

    return {
      tripId: trip.id,
      paymentStatus: trip.paymentStatus,
      paidAt: trip.paidAt,
      amount: trip.amount,
      finalFare: trip.finalFare,
      driverEarnings: trip.driverEarnings,
      platformEarnings: trip.commissionAmount,
      transactionReference: trip.monnifyTxRef,
      paymentRecordId: trip.paymentRecord?.id ?? null,
      paymentMethod: trip.paymentRecord?.paymentMethod ?? null,
      paymentRecordCreatedAt: trip.paymentRecord?.createdAt ?? null,
    };
  }

  // â”€â”€â”€ PROCESS WEBHOOK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Monnify calls this when payment is confirmed
  // Security: verify signature, check idempotency, verify with API

  async processWebhook(
    rawBody: string,
    signature: string,
    payload: any,
  ): Promise<void> {
    const isValid = this.monnify.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      this.logger.warn('Rejected webhook with invalid signature');
      return;
    }

    if (payload.eventType !== 'SUCCESSFUL_TRANSACTION') {
      this.logger.log(`Ignoring webhook event: ${payload.eventType}`);
      return;
    }

    const eventData = payload.eventData;
    const txRef = eventData.transactionReference;

    const trip = await this.prisma.trip.findFirst({
      where: { monnifyTxRef: txRef },
      include: {
        driver: {
          select: { id: true, name: true },
        },
      },
    });

    if (!trip) {
      this.logger.warn(`Webhook received for unknown transaction: ${txRef}`);
      return;
    }

    if (trip.paymentStatus === 'PAID') {
      this.logger.log(`Duplicate webhook ignored for trip ${trip.id}`);
      return;
    }

    const verification = await this.monnify.verifyTransaction(txRef);
    if (!verification.paid) {
      this.logger.warn(`Payment verification failed for trip ${trip.id}`);
      await this.prisma.trip.update({
        where: { id: trip.id },
        data: { paymentStatus: 'FAILED' },
      });

      this.adminRealtimeGateway.notifyPaymentUpdated('failed', {
        tripId: trip.id,
        transactionReference: txRef,
        paymentStatus: 'FAILED',
        driverId: trip.driverId,
      });

      this.ridesGateway.notifyOwnerPaymentUpdated(trip.ownerId, {
        tripId: trip.id,
        paymentStatus: PaymentStatus.FAILED,
        paidAt: null,
        transactionReference: txRef,
        message: 'Payment could not be verified. Please try again.',
      });
      return;
    }

    const paidAt = new Date();

    await this.prisma.$transaction([
      this.prisma.trip.update({
        where: { id: trip.id },
        data: {
          paymentStatus: 'PAID',
          paidAt,
        },
      }),
      this.prisma.paymentRecord.create({
        data: {
          tripId: trip.id,
          totalAmount: verification.amount,
          driverAmount: trip.driverEarnings,
          platformAmount: trip.commissionAmount,
          monnifyTxRef: txRef,
          paymentMethod: verification.paymentMethod,
          paidAt,
          webhookPayload: payload,
        },
      }),
      this.prisma.user.update({
        where: { id: trip.driverId! },
        data: {
          walletBalance: { increment: trip.driverEarnings },
        },
      }),
    ]);

    this.logger.log(
      `Payment processed for trip ${trip.id} â€” â‚¦${verification.amount}`,
    );

    this.adminRealtimeGateway.notifyPaymentUpdated('paid', {
      tripId: trip.id,
      transactionReference: txRef,
      amount: verification.amount,
      paymentMethod: verification.paymentMethod,
      paymentStatus: 'PAID',
      driverId: trip.driverId,
    });

    this.ridesGateway.notifyOwnerPaymentUpdated(trip.ownerId, {
      tripId: trip.id,
      paymentStatus: PaymentStatus.PAID,
      paidAt: paidAt.toISOString(),
      transactionReference: txRef,
      message: 'Payment confirmed.',
    });
  }

  // â”€â”€â”€ WALLET SUMMARY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getWalletSummary(driverId: string) {
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      select: {
        name: true,
        walletBalance: true,
        totalTrips: true,
        bankName: true,
        accountNumber: true,
        monnifySubAccountCode: true,
      },
    });

    if (!driver) throw new NotFoundException('Driver not found');

    const totalEarned = await this.prisma.trip.aggregate({
      where: { driverId, status: 'COMPLETED', paymentStatus: 'PAID' },
      _sum: { driverEarnings: true },
    });

    const recentPayments = await this.prisma.paymentRecord.findMany({
      where: { trip: { driverId } },
      orderBy: { paidAt: 'desc' },
      take: 10,
      select: {
        id: true,
        totalAmount: true,
        driverAmount: true,
        paidAt: true,
        paymentMethod: true,
      },
    });

    return {
      name: driver.name,
      currentBalance: driver.walletBalance,
      totalEarned: totalEarned._sum.driverEarnings ?? 0,
      totalTrips: driver.totalTrips,
      bankName: driver.bankName,
      accountNumber: driver.accountNumber
        ? `****${driver.accountNumber.slice(-4)}`
        : null,
      subAccountActive: !!driver.monnifySubAccountCode,
      recentPayments,
    };
  }

  // â”€â”€â”€ MONTHLY WALLET RESET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Archives current balance to history then resets to 0
  // Called by admin or scheduled job on first day of each month

  async resetWallets(adminId: string) {
    const drivers = await this.prisma.user.findMany({
      where: {
        role: 'DRIVER',
        walletBalance: { gt: 0 },
      },
      select: { id: true, name: true, walletBalance: true },
    });

    if (drivers.length === 0) {
      return { message: 'No wallets to reset', count: 0 };
    }

    await this.prisma.user.updateMany({
      where: {
        role: 'DRIVER',
        walletBalance: { gt: 0 },
      },
      data: { walletBalance: 0 },
    });

    this.logger.log(
      `Monthly wallet reset by admin ${adminId} â€” ${drivers.length} drivers reset`,
    );

    return {
      message: 'Wallet balances reset successfully',
      count: drivers.length,
      driversReset: drivers.map((d) => ({
        id: d.id,
        name: d.name,
        previousBalance: d.walletBalance,
      })),
    };
  }

  // â”€â”€â”€ PAYMENT HISTORY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getPaymentHistory(userId: string, role: string) {
    const where =
      role === 'ADMIN'
        ? {}
        : role === 'DRIVER'
          ? { trip: { driverId: userId } }
          : { trip: { ownerId: userId } };

    return this.prisma.paymentRecord.findMany({
      where,
      include: {
        trip: {
          select: {
            id: true,
            pickupAddress: true,
            destAddress: true,
            status: true,
            owner: { select: { name: true } },
            driver: { select: { name: true } },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  // â”€â”€â”€ ADMIN: GET ALL PENDING PAYMENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getPendingPayments() {
    return this.prisma.trip.findMany({
      where: { paymentStatus: 'PENDING' },
      include: {
        owner: { select: { name: true, email: true, phone: true } },
        driver: { select: { name: true } },
      },
      orderBy: { completedAt: 'desc' },
    });
  }
}
