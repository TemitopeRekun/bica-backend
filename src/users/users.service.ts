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
  constructor(private prisma: PrismaService) { }

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

  // Driver toggles online/offline status
  async updateOnlineStatus(id: string, isOnline: boolean) {
    return this.prisma.user.update({
      where: { id },
      data: { isOnline },
      select: { id: true, name: true, isOnline: true },
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
  async getAvailableDrivers(
    pickupLat?: number,
    pickupLng?: number,
  ) {
    // Get all online, approved, unblocked drivers with a location
    const drivers = await this.prisma.user.findMany({
      where: {
        role: UserRole.DRIVER,
        approvalStatus: 'APPROVED',
        isBlocked: false,
        isOnline: true,
        locationLat: { not: null },
        locationLng: { not: null },
      },
      select: {
        id: true,
        name: true,
        rating: true,
        totalTrips: true,
        avatarUrl: true,
        transmission: true,
        locationLat: true,
        locationLng: true,
        // Check for active trips
        tripsAsDriver: {
          where: {
            status: {
              in: ['PENDING_ACCEPTANCE', 'ASSIGNED', 'IN_PROGRESS'],
            },
          },
          select: { id: true },
        },
      },
    });

    // Filter out drivers with active trips
    const available = drivers.filter(
      (d) => d.tripsAsDriver.length === 0,
    );

    // If pickup coords provided, calculate distance and sort by nearest
    if (pickupLat && pickupLng) {
      const withDistance = available.map((driver) => {
        const distanceKm = this.calculateDistance(
          pickupLat,
          pickupLng,
          driver.locationLat!,
          driver.locationLng!,
        );
        return {
          id: driver.id,
          name: driver.name,
          rating: driver.rating,
          totalTrips: driver.totalTrips,
          avatarUrl: driver.avatarUrl,
          transmission: driver.transmission,
          locationLat: driver.locationLat,
          locationLng: driver.locationLng,
          distanceKm: Math.round(distanceKm * 10) / 10,
          estimatedArrivalMins: Math.max(
            Math.round((distanceKm / 40) * 60),
            2,
          ),
        };
      });

      // Sort by distance — nearest first
      withDistance.sort((a, b) => a.distanceKm - b.distanceKm);
      return withDistance;
    }

    return available.map((d) => ({
      ...d,
      tripsAsDriver: undefined,
      distanceKm: null,
      estimatedArrivalMins: null,
    }));
  }

  private calculateDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}