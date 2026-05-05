import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

  async createTicket(userId: string, dto: CreateSupportTicketDto) {
    // 1. Verify trip exists if tripId is provided
    if (dto.tripId) {
      const trip = await this.prisma.trip.findUnique({
        where: { id: dto.tripId },
      });
      if (!trip) {
        throw new NotFoundException('Trip not found');
      }
    }

    // 2. Fetch user name and role (not strictly needed for the DB record but good for confirmation)
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 3. Create the ticket
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        userName: user.name, // We snapshot these for easy admin viewing
        userRole: user.role,
        category: dto.category,
        tripId: dto.tripId,
        paymentStatus: dto.paymentStatus,
        firstMessage: dto.firstMessage,
        recentFailureContext: dto.recentFailureContext,
        openedAt: new Date(dto.openedAt),
      },
    });

    return {
      id: ticket.id,
      createdAt: ticket.createdAt,
    };
  }

  async getTickets(pagination: PaginationDto) {
    const [total, items] = await Promise.all([
      this.prisma.supportTicket.count(),
      this.prisma.supportTicket.findMany({
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          user: {
            select: {
              name: true,
              email: true,
              phone: true,
            },
          },
        },
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
}
