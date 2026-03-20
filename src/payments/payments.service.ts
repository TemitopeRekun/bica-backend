import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MonnifyService } from './monnify.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private monnify: MonnifyService,
    private config: ConfigService,
  ) {}

  // ─── CREATE MONNIFY SUB ACCOUNT ───────────────────────────────────
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

    // Skip if sub account already exists
    if (driver.monnifySubAccountCode) return;

    // Skip if bank details are missing
    if (!driver.bankCode || !driver.accountNumber) return;

    try {
      const subAccountCode = await this.monnify.createSubAccount({
        name: driver.name,
        email: driver.email,
        bankCode: driver.bankCode!,
        accountNumber: driver.accountNumber!,
      });

      await this.prisma.user.update({
        where: { id: driverId },
        data: { monnifySubAccountCode: subAccountCode },
      });

      this.logger.log(`Sub account created and stored for driver ${driverId}`);
    } catch (error) {
      // Log but don't throw — registration already succeeded
      // Admin can manually trigger sub account creation later
      this.logger.error(
        `Failed to create sub account for driver ${driverId}`,
        error,
      );
    }
  }

  // ─── INITIATE PAYMENT ─────────────────────────────────────────────
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

    // Only the owner of this trip can initiate payment
    if (trip.ownerId !== requestingUserId) {
      throw new ForbiddenException('Only the trip owner can initiate payment');
    }

    // Trip must be completed before payment
    if (trip.status !== 'COMPLETED') {
      throw new BadRequestException(
        'Payment can only be initiated for completed trips',
      );
    }

    // Don't allow duplicate payment initiation
    if (trip.paymentStatus === 'PAID') {
      throw new BadRequestException('This trip has already been paid for');
    }

    // Driver must have a Monnify sub account
    if (!trip.driver?.monnifySubAccountCode) {
      throw new BadRequestException(
        'Driver payment account not configured. Please contact support.',
      );
    }

    // Get commission percentage from system settings
    const settings = await this.prisma.systemSettings.findUnique({
      where: { id: 1 },
    });

    const driverSplitPercent = 100 - (settings?.commission ?? 25);

    // Initiate transaction with Monnify
    const { checkoutUrl, transactionReference } =
      await this.monnify.initiateTransaction({
        amount: trip.amount,
        tripId: trip.id,
        ownerEmail: trip.owner.email,
        ownerName: trip.owner.name,
        driverSubAccountCode: trip.driver.monnifySubAccountCode,
        driverSplitPercent,
      });

    // Store transaction reference on trip
    await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        paymentStatus: 'PENDING',
        monnifyTxRef: transactionReference,
      },
    });

    return {
      checkoutUrl,
      transactionReference,
      amount: trip.amount,
      driverEarnings: trip.driverEarnings,
      platformEarnings: trip.commissionAmount,
    };
  }

  // ─── PROCESS WEBHOOK ──────────────────────────────────────────────
  // Monnify calls this when payment is confirmed
  // Security: verify signature, check idempotency, verify with API

  async processWebhook(
    rawBody: string,
    signature: string,
    payload: any,
  ): Promise<void> {
    // 1. Verify webhook signature immediately
    const isValid = this.monnify.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      this.logger.warn('Rejected webhook with invalid signature');
      return; // Return silently — don't give attacker info
    }

    // 2. Only process successful payment events
    if (payload.eventType !== 'SUCCESSFUL_TRANSACTION') {
      this.logger.log(`Ignoring webhook event: ${payload.eventType}`);
      return;
    }

    const eventData = payload.eventData;
    const txRef = eventData.transactionReference;

    // 3. Find the trip by transaction reference
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

    // 4. Idempotency check — don't process same payment twice
    if (trip.paymentStatus === 'PAID') {
      this.logger.log(`Duplicate webhook ignored for trip ${trip.id}`);
      return;
    }

    // 5. Verify payment with Monnify API independently
    const verification = await this.monnify.verifyTransaction(txRef);
    if (!verification.paid) {
      this.logger.warn(`Payment verification failed for trip ${trip.id}`);
      await this.prisma.trip.update({
        where: { id: trip.id },
        data: { paymentStatus: 'FAILED' },
      });
      return;
    }

    // 6. Mark trip as paid and record full audit trail
    await this.prisma.$transaction([
      // Update trip payment status
      this.prisma.trip.update({
        where: { id: trip.id },
        data: {
          paymentStatus: 'PAID',
          paidAt: new Date(),
        },
      }),

      // Create immutable payment record for audit
      this.prisma.paymentRecord.create({
        data: {
          tripId: trip.id,
          totalAmount: verification.amount,
          driverAmount: trip.driverEarnings,
          platformAmount: trip.commissionAmount,
          monnifyTxRef: txRef,
          paymentMethod: verification.paymentMethod,
          paidAt: new Date(),
          webhookPayload: payload,
        },
      }),

      // Increment driver earnings ledger
      this.prisma.user.update({
        where: { id: trip.driverId! },
        data: {
          walletBalance: { increment: trip.driverEarnings },
        },
      }),
    ]);

    this.logger.log(
      `Payment processed for trip ${trip.id} — ₦${verification.amount}`,
    );
  }

  // ─── WALLET SUMMARY ───────────────────────────────────────────────

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

    // Total lifetime earnings from completed paid trips
    const totalEarned = await this.prisma.trip.aggregate({
      where: { driverId, status: 'COMPLETED', paymentStatus: 'PAID' },
      _sum: { driverEarnings: true },
    });

    // Recent payment records
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

  // ─── MONTHLY WALLET RESET ─────────────────────────────────────────
  // Archives current balance to history then resets to 0
  // Called by admin or scheduled job on first day of each month

  async resetWallets(adminId: string) {
    // Get all drivers with non-zero balance
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

    // Reset all balances to 0 in a single transaction
    await this.prisma.user.updateMany({
      where: {
        role: 'DRIVER',
        walletBalance: { gt: 0 },
      },
      data: { walletBalance: 0 },
    });

    this.logger.log(
      `Monthly wallet reset by admin ${adminId} — ${drivers.length} drivers reset`,
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

  // ─── PAYMENT HISTORY ──────────────────────────────────────────────

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

  // ─── ADMIN: GET ALL PENDING PAYMENTS ──────────────────────────────

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