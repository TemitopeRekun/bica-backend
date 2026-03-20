import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateApprovalDto } from './dto/update-approval.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // Get all users — admin only, with optional role filter
  async findAll(role?: UserRole) {
    return this.prisma.user.findMany({
      where: role ? { role } : undefined,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        rating: true,
        totalTrips: true,
        avatarUrl: true,
        walletBalance: true,
        isBlocked: true,
        carType: true,
        gender: true,
        address: true,
        nationality: true,
        age: true,
        nin: true,
        transmission: true,
        approvalStatus: true,
        licenseImageUrl: true,
        ninImageUrl: true,
        selfieImageUrl: true,
        backgroundCheckAccepted: true,
        locationLat: true,
        locationLng: true,
        createdAt: true,
        updatedAt: true,
        // never return passwordHash
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get a single user by ID
  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        rating: true,
        totalTrips: true,
        avatarUrl: true,
        walletBalance: true,
        isBlocked: true,
        carType: true,
        gender: true,
        address: true,
        nationality: true,
        age: true,
        nin: true,
        transmission: true,
        approvalStatus: true,
        licenseImageUrl: true,
        ninImageUrl: true,
        selfieImageUrl: true,
        backgroundCheckAccepted: true,
        locationLat: true,
        locationLng: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // Admin: approve or reject a driver
  async updateApproval(id: string, dto: UpdateApprovalDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) throw new NotFoundException('User not found');

    if (user.role !== UserRole.DRIVER) {
      throw new ForbiddenException('Approval status only applies to drivers');
    }

    return this.prisma.user.update({
      where: { id },
      data: { approvalStatus: dto.approvalStatus },
      select: { id: true, name: true, approvalStatus: true },
    });
  }

  // Admin: block or unblock any user
  async toggleBlock(id: string, isBlocked: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id },
      data: { isBlocked },
      select: { id: true, name: true, isBlocked: true },
    });
  }

  // Driver: update live GPS location
  async updateLocation(id: string, dto: UpdateLocationDto) {
    return this.prisma.user.update({
      where: { id },
      data: {
        locationLat: dto.lat,
        locationLng: dto.lng,
      },
      select: { id: true, locationLat: true, locationLng: true },
    });
  }

  // System: get all approved, online drivers
  // Used by ride assignment algorithm in Phase 4
  async getAvailableDrivers() {
    return this.prisma.user.findMany({
      where: {
        role: UserRole.DRIVER,
        approvalStatus: 'APPROVED',
        isBlocked: false,
        locationLat: { not: null },
        locationLng: { not: null },
      },
      select: {
        id: true,
        name: true,
        rating: true,
        avatarUrl: true,
        transmission: true,
        locationLat: true,
        locationLng: true,
      },
    });
  }
}