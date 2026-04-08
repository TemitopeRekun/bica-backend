import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminRealtimeGateway } from './admin-realtime.gateway';
import { PaginationDto } from '../common/dto/pagination.dto';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private adminRealtimeGateway: AdminRealtimeGateway,
  ) {}

  async getDashboard() {
    const defaultPage = { page: 0, limit: 10, skip: 0, take: 10 } as PaginationDto;
    const [usersRes, tripsRes, payoutsRes, settings] = await Promise.all([
      this.getUsers(defaultPage),
      this.getTrips(defaultPage),
      this.getPayouts(defaultPage),
      this.prisma.systemSettings.findUnique({ where: { id: 1 } }),
    ]);

    if (!settings) {
      throw new NotFoundException('System settings not found');
    }

    return { 
      users: usersRes.items, 
      trips: tripsRes.items, 
      payouts: payoutsRes.items, 
      settings 
    };
  }

  async getUsers(pagination: PaginationDto) {
    const where = {
      role: { in: ['DRIVER', 'OWNER'] as any[] },
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
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
          bankName: true,
          bankCode: true,
          accountNumber: true,
          accountName: true,
          monnifySubAccountCode: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return {
      items: users.map((u) => this.mapAdminUser(u)),
      meta: {
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit!),
      },
    };
  }

  async getTrips(pagination: PaginationDto) {
    const [total, items] = await Promise.all([
      this.prisma.trip.count(),
      this.prisma.trip.findMany({
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
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return {
      items,
      meta: {
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit!),
      },
    };
  }

  async getPayouts(pagination: PaginationDto) {
    const [total, items] = await Promise.all([
      this.prisma.payout.count(),
      this.prisma.payout.findMany({
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
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return {
      items,
      meta: {
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit!),
      },
    };
  }

  private mapAdminUser(user: any) {
    return {
      ...user,
      subAccountActive: !!user.monnifySubAccountCode,
      canRetrySubAccountSetup:
        !user.monnifySubAccountCode && !!user.bankCode && !!user.accountNumber,
    };
  }
}
