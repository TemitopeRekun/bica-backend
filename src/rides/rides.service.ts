import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { TripStatus, UserRole } from '@prisma/client';

@Injectable()
export class RidesService {
  constructor(private prisma: PrismaService) {}

  // ─── PRICING ENGINE ──────────────────────────────────────────────

  private calculatePrice(
    distanceKm: number,
    settings: {
      baseFare: number;
      pricePerKm: number;
      timeRate: number;
    },
  ): number {
    // Short trip flat rate rule from BICA requirements
    if (distanceKm <= 4.5) {
      return 2000;
    }

    // Standard formula for longer trips
    const price = settings.baseFare + distanceKm * settings.pricePerKm;

    // Round to nearest 50 naira
    return Math.round(price / 50) * 50;
  }

  private calculateSplit(
    amount: number,
    commissionPercent: number,
  ): { commissionAmount: number; driverEarnings: number } {
    const commissionAmount = Math.round(amount * (commissionPercent / 100));
    const driverEarnings = amount - commissionAmount;
    return { commissionAmount, driverEarnings };
  }

  // ─── HAVERSINE DISTANCE ──────────────────────────────────────────
  // Calculates straight-line distance between two GPS coordinates
  // Used to find the nearest driver to a pickup point

  private haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ─── FIND NEAREST DRIVER ─────────────────────────────────────────

  private async findNearestDriver(
    pickupLat: number,
    pickupLng: number,
    transmission?: string,
  ) {
    // Get all approved, unblocked drivers with a known location
    const drivers = await this.prisma.user.findMany({
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

    if (drivers.length === 0) return null;

    // Filter by transmission preference if specified
    const eligible = transmission
      ? drivers.filter(
          (d) =>
            d.transmission === transmission ||
            d.transmission === 'Both',
        )
      : drivers;

    if (eligible.length === 0) return null;

    // Calculate distance from each driver to pickup point
    // then sort ascending to find closest
    const withDistance = eligible.map((driver) => ({
      ...driver,
      distanceKm: this.haversineDistance(
        pickupLat,
        pickupLng,
        driver.locationLat!,
        driver.locationLng!,
      ),
    }));

    withDistance.sort((a, b) => a.distanceKm - b.distanceKm);

    // Only assign if driver is within 50km
    const nearest = withDistance[0];
    if (nearest.distanceKm > 50) return null;

    return nearest;
  }

  // ─── CREATE RIDE ─────────────────────────────────────────────────

  async createRide(ownerId: string, dto: CreateRideDto) {
    // 1. Load current system settings for pricing
    const settings = await this.prisma.systemSettings.findUnique({
      where: { id: 1 },
    });

    if (!settings) {
      throw new BadRequestException('System settings not configured');
    }

    // 2. Calculate fare
    const amount = this.calculatePrice(dto.distanceKm, settings);
    const { commissionAmount, driverEarnings } = this.calculateSplit(
      amount,
      settings.commission,
    );

    // 3. Find nearest available driver
    const nearestDriver = await this.findNearestDriver(
      dto.pickupLat,
      dto.pickupLng,
      dto.transmission,
    );

    // 4. Create the trip record
    const trip = await this.prisma.trip.create({
      data: {
        ownerId,
        driverId: nearestDriver?.id ?? null,
        status: nearestDriver ? TripStatus.ASSIGNED : TripStatus.SEARCHING,
        pickupAddress: dto.pickupAddress,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        destAddress: dto.destAddress,
        destLat: dto.destLat,
        destLng: dto.destLng,
        distanceKm: dto.distanceKm,
        amount,
        commissionAmount,
        driverEarnings,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      },
      include: {
        owner: {
          select: { id: true, name: true, phone: true, avatarUrl: true },
        },
        driver: {
          select: {
            id: true,
            name: true,
            phone: true,
            avatarUrl: true,
            rating: true,
            transmission: true,
          },
        },
      },
    });

    return {
      ...trip,
      estimatedArrivalMins: nearestDriver
        ? Math.max(Math.round((nearestDriver.distanceKm / 40) * 60), 2)
        : null,
    };
  }

  // ─── GET SINGLE TRIP ─────────────────────────────────────────────

  async findOne(tripId: string, userId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        owner: {
          select: { id: true, name: true, phone: true, avatarUrl: true },
        },
        driver: {
          select: {
            id: true,
            name: true,
            phone: true,
            avatarUrl: true,
            rating: true,
          },
        },
      },
    });

    if (!trip) throw new NotFoundException('Trip not found');

    // Users can only see their own trips
    if (trip.ownerId !== userId && trip.driverId !== userId) {
      throw new ForbiddenException('You do not have access to this trip');
    }

    return trip;
  }

  // ─── UPDATE TRIP STATUS ──────────────────────────────────────────

  async updateStatus(
    tripId: string,
    userId: string,
    userRole: UserRole,
    dto: UpdateStatusDto,
  ) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
    });

    if (!trip) throw new NotFoundException('Trip not found');

    // Validate who can change to what status
    this.validateStatusTransition(trip, userId, userRole, dto.status);

    const updateData: any = { status: dto.status };

    // If completing the trip, record the timestamp
    // and credit the driver's wallet
    if (dto.status === TripStatus.COMPLETED) {
      updateData.completedAt = new Date();

      if (trip.driverId) {
        await this.prisma.user.update({
          where: { id: trip.driverId },
          data: {
            walletBalance: { increment: trip.driverEarnings },
            totalTrips: { increment: 1 },
          },
        });

        // Also increment owner's trip count
        await this.prisma.user.update({
          where: { id: trip.ownerId },
          data: { totalTrips: { increment: 1 } },
        });
      }
    }

    return this.prisma.trip.update({
      where: { id: tripId },
      data: updateData,
      include: {
        driver: {
          select: { id: true, name: true, walletBalance: true },
        },
      },
    });
  }

  // ─── STATUS TRANSITION RULES ─────────────────────────────────────
  // Enforces who can move the trip to which status

  private validateStatusTransition(
    trip: any,
    userId: string,
    userRole: UserRole,
    newStatus: TripStatus,
  ) {
    const isOwner = trip.ownerId === userId;
    const isDriver = trip.driverId === userId;
    const isAdmin = userRole === UserRole.ADMIN;

    const allowed: Partial<Record<TripStatus, TripStatus[]>> = {
      // Driver moves these forward
      [TripStatus.ASSIGNED]: [TripStatus.IN_PROGRESS, TripStatus.CANCELLED],
      [TripStatus.IN_PROGRESS]: [TripStatus.COMPLETED],
      // Owner can cancel before trip starts
      [TripStatus.SEARCHING]: [TripStatus.CANCELLED],
    };

    const allowedNext = allowed[trip.status] ?? [];

    if (!allowedNext.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${trip.status} to ${newStatus}`,
      );
    }

    // Only driver can start/complete a trip
    if (
  ([TripStatus.IN_PROGRESS, TripStatus.COMPLETED] as TripStatus[]).includes(newStatus) &&
  !isDriver &&
  !isAdmin
) {
      throw new ForbiddenException('Only the assigned driver can do this');
    }

    // Only owner or admin can cancel
    if (newStatus === TripStatus.CANCELLED && !isOwner && !isAdmin) {
      throw new ForbiddenException('Only the owner can cancel this ride');
    }
  }

  // ─── TRIP HISTORY ────────────────────────────────────────────────

  async getHistory(userId: string, userRole: UserRole) {
    const where =
      userRole === UserRole.ADMIN
        ? {} // admin sees all trips
        : userRole === UserRole.DRIVER
          ? { driverId: userId }
          : { ownerId: userId };

    return this.prisma.trip.findMany({
      where,
      include: {
        owner: {
          select: { id: true, name: true, avatarUrl: true },
        },
        driver: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── CANCEL RIDE ─────────────────────────────────────────────────

  async cancelRide(tripId: string, userId: string, userRole: UserRole) {
    return this.updateStatus(tripId, userId, userRole, {
      status: TripStatus.CANCELLED,
    });
  }
}