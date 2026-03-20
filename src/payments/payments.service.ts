import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestPayoutDto } from './dto/request-payout.dto';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  // ─── REQUEST PAYOUT ──────────────────────────────────────────────
  // Driver requests to withdraw their wallet balance

  async requestPayout(driverId: string, dto: RequestPayoutDto) {
    // 1. Get current driver wallet balance
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      select: { id: true, name: true, walletBalance: true },
    });

    if (!driver) throw new NotFoundException('Driver not found');

    // 2. Check they have enough balance
    if (driver.walletBalance < dto.amount) {
      throw new BadRequestException(
        `Insufficient balance. Current balance: ₦${driver.walletBalance}`,
      );
    }

    // 3. Check no pending payout already exists
    // A driver can only have one pending payout at a time
    const existingPending = await this.prisma.payout.findFirst({
      where: { driverId, status: 'PENDING' },
    });

    if (existingPending) {
      throw new BadRequestException(
        'You already have a pending payout request. Wait for it to be processed.',
      );
    }

    // 4. Create payout record and deduct from wallet atomically
    // Using a transaction so both operations succeed or both fail
    const [payout] = await this.prisma.$transaction([
      this.prisma.payout.create({
        data: {
          driverId,
          amount: dto.amount,
          bankName: dto.bankName,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
          status: 'PENDING',
        },
      }),
      this.prisma.user.update({
        where: { id: driverId },
        data: { walletBalance: { decrement: dto.amount } },
      }),
    ]);

    return payout;
  }

  // ─── ADMIN: GET ALL PAYOUTS ───────────────────────────────────────

  async findAll(status?: 'PENDING' | 'PAID') {
    return this.prisma.payout.findMany({
      where: status ? { status } : undefined,
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            phone: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  // ─── DRIVER: GET OWN PAYOUTS ──────────────────────────────────────

  async findMyPayouts(driverId: string) {
    return this.prisma.payout.findMany({
      where: { driverId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  // ─── ADMIN: APPROVE PAYOUT ────────────────────────────────────────

  async approvePayout(payoutId: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) throw new NotFoundException('Payout not found');

    if (payout.status === 'PAID') {
      throw new BadRequestException('Payout already processed');
    }

    return this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: 'PAID',
        approvedAt: new Date(),
      },
      include: {
        driver: {
          select: { id: true, name: true },
        },
      },
    });
  }

  // ─── ADMIN: REJECT PAYOUT ─────────────────────────────────────────
  // Rejects payout and refunds wallet balance

  async rejectPayout(payoutId: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) throw new NotFoundException('Payout not found');

    if (payout.status === 'PAID') {
      throw new BadRequestException('Cannot reject an already paid payout');
    }

    // Refund wallet and delete payout record atomically
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: payout.driverId },
        data: { walletBalance: { increment: payout.amount } },
      }),
      this.prisma.payout.delete({
        where: { id: payoutId },
      }),
    ]);

    return { message: 'Payout rejected and wallet refunded' };
  }

  // ─── GET WALLET SUMMARY ───────────────────────────────────────────
  // Returns driver's current balance + payout history

  async getWalletSummary(driverId: string) {
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      select: { walletBalance: true, totalTrips: true, name: true },
    });

    if (!driver) throw new NotFoundException('Driver not found');

    const payouts = await this.prisma.payout.findMany({
      where: { driverId },
      orderBy: { requestedAt: 'desc' },
    });

    const totalEarned = await this.prisma.trip.aggregate({
      where: { driverId, status: 'COMPLETED' },
      _sum: { driverEarnings: true },
    });

    const totalPaidOut = payouts
      .filter((p) => p.status === 'PAID')
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      name: driver.name,
      currentBalance: driver.walletBalance,
      totalEarned: totalEarned._sum.driverEarnings ?? 0,
      totalPaidOut,
      totalTrips: driver.totalTrips,
      payouts,
    };
  }
}