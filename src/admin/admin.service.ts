import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminRealtimeGateway } from './admin-realtime.gateway';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private adminRealtimeGateway: AdminRealtimeGateway,
  ) {}

  async getDashboard() {
    const [users, trips, payouts, settings] = await Promise.all([
      this.getUsers(),
      this.getTrips(),
      this.getPayouts(),
      this.prisma.systemSettings.findUnique({ where: { id: 1 } }),
    ]);

    if (!settings) {
      throw new NotFoundException('System settings not found');
    }

    return { users, trips, payouts, settings };
  }

  async getUsers() {
    return this.prisma.user.findMany({
      where: {
        role: { in: ['DRIVER', 'OWNER'] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        rating: true,
        totalTrips: true,
        avatarUrl: true,
        approvalStatus: true,
        isBlocked: true,
        isOnline: true,
        carType: true,
        carModel: true,
        carYear: true,
        transmission: true,
        nin: true,
        licenseImageUrl: true,
        ninImageUrl: true,
        selfieImageUrl: true,
        backgroundCheckAccepted: true,
        walletBalance: true,
        locationLat: true,
        locationLng: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTrips() {
    return this.prisma.trip.findMany({
      include: {
        owner: {
          select: {
            id: true,
            name: true,
          },
        },
        driver: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPayouts() {
    return this.prisma.payout.findMany({
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        trip: {
          select: {
            id: true,
            amount: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }
}
