import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { PaymentStatus, TripStatus, UserRole } from '@prisma/client';
import { RidesGateway } from './rides.gateway';
import { AdminRealtimeGateway } from '../admin/admin-realtime.gateway';

@Injectable()
export class RidesService {
  constructor(
    private prisma: PrismaService,
    private gateway: RidesGateway,
    private adminRealtimeGateway: AdminRealtimeGateway,
  ) { }

  // ─── PRICING ENGINE ──────────────────────────────────────────────
  // Called at BOOKING time with Google's road distance + estimated mins
  // Returns the estimated fare shown to owner before confirming

  private calculateEstimatedFare(
    distanceKm: number,
    estimatedMins: number,
    settings: { baseFare: number; pricePerKm: number; timeRate: number },
  ): number {
    const price =
      settings.baseFare +
      distanceKm * settings.pricePerKm +
      estimatedMins * settings.timeRate;
    return Math.round(price / 50) * 50;
  }

  async acceptRide(tripId: string, driverId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        owner: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        driver: { select: { id: true, name: true, phone: true, avatarUrl: true, rating: true, transmission: true } },
      },
    });

    if (!trip) throw new NotFoundException('Trip not found');

    if (trip.driverId !== driverId) {
      throw new ForbiddenException('This trip was not assigned to you');
    }

    if (trip.status !== TripStatus.PENDING_ACCEPTANCE) {
      throw new BadRequestException(
        `Cannot accept a trip with status ${trip.status}`,
      );
    }

    // Cancel the auto-decline timer
    this.cancelAcceptanceTimer(tripId);

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.ASSIGNED },
      include: {
        owner: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        driver: { select: { id: true, name: true, phone: true, avatarUrl: true, rating: true, transmission: true } },
      },
    });

    // Notify owner that driver accepted
    this.gateway.notifyOwnerDriverAccepted(trip.ownerId, {
      tripId,
      driver: updated.driver,
      estimatedArrivalMins: 5, // could calculate this properly
    });

    this.adminRealtimeGateway.notifyTripUpdated('accepted', updated);
    return updated;
  }

  async declineRide(tripId: string, driverId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
    });

    if (!trip) throw new NotFoundException('Trip not found');

    if (trip.driverId !== driverId) {
      throw new ForbiddenException('This trip was not assigned to you');
    }

    if (trip.status !== TripStatus.PENDING_ACCEPTANCE) {
      throw new BadRequestException(
        `Cannot decline a trip with status ${trip.status}`,
      );
    }

    // Cancel the auto-decline timer
    this.cancelAcceptanceTimer(tripId);

    await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.DECLINED },
    });

    // Notify owner to pick another driver
    this.gateway.notifyOwnerDriverDeclined(trip.ownerId, {
      tripId,
      reason: 'declined',
      message: 'Driver declined the request. Please select another driver.',
    });

    this.adminRealtimeGateway.notifyTripUpdated('declined', {
      tripId,
      driverId,
    });
    return { message: 'Ride declined successfully' };
  }

  // Map to track active timers so we can cancel them on accept/decline
  private acceptanceTimers = new Map<string, NodeJS.Timeout>();

  private startAcceptanceTimer(
    tripId: string,
    ownerId: string,
    driverId: string,
  ) {
    const timer = setTimeout(async () => {
      // Check if trip is still pending acceptance
      const trip = await this.prisma.trip.findUnique({
        where: { id: tripId },
        select: { status: true },
      });

      if (trip?.status === TripStatus.PENDING_ACCEPTANCE) {
        // Auto-decline — driver didn't respond
        await this.prisma.trip.update({
          where: { id: tripId },
          data: { status: TripStatus.DECLINED },
        });

        // Notify owner to pick another driver
        this.gateway.notifyOwnerDriverDeclined(ownerId, {
          tripId,
          reason: 'timeout',
          message: 'Driver did not respond. Please select another driver.',
        });

        this.adminRealtimeGateway.notifyTripUpdated('timed_out', {
          tripId,
          driverId,
          ownerId,
          status: TripStatus.DECLINED,
        });

        console.log(`Trip ${tripId} auto-declined after 60s timeout`);
      }

      this.acceptanceTimers.delete(tripId);
    }, 60000); // 60 seconds

    this.acceptanceTimers.set(tripId, timer);
  }

  private cancelAcceptanceTimer(tripId: string) {
    const timer = this.acceptanceTimers.get(tripId);
    if (timer) {
      clearTimeout(timer);
      this.acceptanceTimers.delete(tripId);
    }
  }

  // ─── FINAL FARE ENGINE ───────────────────────────────────────────
  // Called at COMPLETION time with actual elapsed minutes
  // Final fare = base fare + distance component + total elapsed minutes component

  private calculateFinalFare(
    distanceKm: number,
    actualMins: number,
    settings: { baseFare: number; pricePerKm: number; timeRate: number },
  ): {
    finalFare: number;
    baseFare: number;
    distanceComponent: number;
    timeComponent: number;
    totalMins: number;
  } {
    const baseFare = settings.baseFare;
    const distanceComponent = distanceKm * settings.pricePerKm;
    const timeComponent = actualMins * settings.timeRate;

    const rawFare = baseFare + distanceComponent + timeComponent;
    const finalFare = Math.round(rawFare / 50) * 50;

    return {
      finalFare,
      baseFare: Math.round(baseFare),
      distanceComponent: Math.round(distanceComponent),
      timeComponent: Math.round(timeComponent),
      totalMins: actualMins,
    };
  }

  private calculateSplit(
    amount: number,
    commissionPercent: number,
  ): { commissionAmount: number; driverEarnings: number } {
    const commissionAmount = Math.round(amount * (commissionPercent / 100));
    const driverEarnings = amount - commissionAmount;
    return { commissionAmount, driverEarnings };
  }

  // ─── HAVERSINE (kept for driver proximity only) ───────────────────
  // NOT used for fare calculation — only for finding nearest driver

  private haversineDistance(
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
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ─── FIND NEAREST DRIVER ─────────────────────────────────────────

  private async findNearestDriver(
    pickupLat: number,
    pickupLng: number,
    transmission?: string,
  ) {
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
        avatarUrl: true,
        transmission: true,
        locationLat: true,
        locationLng: true,
      },
    });

    if (drivers.length === 0) return null;

    const eligible = transmission
      ? drivers.filter(
        (d) =>
          d.transmission === transmission || d.transmission === 'Both',
      )
      : drivers;

    if (eligible.length === 0) return null;

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
    const nearest = withDistance[0];
    if (nearest.distanceKm > 50) return null;

    return nearest;
  }

  // ─── CREATE RIDE ─────────────────────────────────────────────────
  // distanceKm and estimatedMins now come from Google Distance Matrix
  // (calculated on frontend via GET /locations/route, sent in body)

  async createRide(ownerId: string, dto: CreateRideDto) {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { id: 1 },
    });

    if (!settings) {
      throw new BadRequestException('System settings not configured');
    }

    // Verify chosen driver is still available
    const driver = await this.prisma.user.findUnique({
      where: { id: dto.driverId },
      include: {
        tripsAsDriver: {
          where: {
            status: {
              in: ['PENDING_ACCEPTANCE', 'ASSIGNED', 'IN_PROGRESS'],
            },
          },
        },
      },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    if (!driver.isOnline) {
      throw new BadRequestException('This driver is no longer online');
    }

    if (driver.tripsAsDriver.length > 0) {
      throw new BadRequestException(
        'This driver has just been assigned another trip. Please select a different driver.',
      );
    }

    const estimatedMins = dto.estimatedMins ?? 0;
    const amount = this.calculateEstimatedFare(
      dto.distanceKm,
      estimatedMins,
      settings,
    );
    const { commissionAmount, driverEarnings } = this.calculateSplit(
      amount,
      settings.commission,
    );

    const trip = await this.prisma.trip.create({
      data: {
        ownerId,
        driverId: dto.driverId,
        status: TripStatus.PENDING_ACCEPTANCE, // ← waiting for driver to accept
        pickupAddress: dto.pickupAddress,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        destAddress: dto.destAddress,
        destLat: dto.destLat,
        destLng: dto.destLng,
        distanceKm: dto.distanceKm,
        estimatedMins: dto.estimatedMins ?? null,
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

    // Notify driver via WebSocket — they have 60 seconds to respond
    this.gateway.notifyDriverNewRide(dto.driverId, {
      ...trip,
      estimatedArrivalMins: null,
    });

    // Start 60 second auto-decline timer
    this.startAcceptanceTimer(trip.id, ownerId, dto.driverId);

    const response = {
      ...trip,
      estimatedArrivalMins: null,
    };

    this.adminRealtimeGateway.notifyTripUpdated('created', response);
    return response;
  }

  async getCurrentRide(userId: string, userRole: UserRole) {
    const participantFilter =
      userRole === UserRole.DRIVER ? { driverId: userId } : { ownerId: userId };

    const include = {
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
    };

    const activeTrip = await this.prisma.trip.findFirst({
      where: {
        ...participantFilter,
        status: {
          in: [
            TripStatus.PENDING_ACCEPTANCE,
            TripStatus.ASSIGNED,
            TripStatus.IN_PROGRESS,
          ],
        },
      },
      include,
      orderBy: { updatedAt: 'desc' },
    });

    if (activeTrip) {
      return activeTrip;
    }

    return this.prisma.trip.findFirst({
      where: {
        ...participantFilter,
        status: TripStatus.COMPLETED,
        paymentStatus: {
          in: [
            PaymentStatus.UNPAID,
            PaymentStatus.PENDING,
            PaymentStatus.FAILED,
          ],
        },
      },
      include,
      orderBy: { completedAt: 'desc' },
    });
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

    this.validateStatusTransition(trip, userId, userRole, dto.status);

    const updateData: any = { status: dto.status };

    // Record startedAt when driver begins the trip
    if (dto.status === TripStatus.IN_PROGRESS) {
      updateData.startedAt = new Date();
    }

    // Calculate final fare when trip completes
    if (dto.status === TripStatus.COMPLETED) {
      updateData.completedAt = new Date();


      const settings = await this.prisma.systemSettings.findUnique({
        where: { id: 1 },

      });

      // Calculate actual elapsed minutes from startedAt
      const startedAt = trip.startedAt ?? new Date();
      const actualMins = Math.ceil(
        (updateData.completedAt.getTime() - startedAt.getTime()) / 60000,
      );

      const { finalFare, baseFare, distanceComponent, timeComponent, totalMins } =
        this.calculateFinalFare(
          trip.distanceKm,
          actualMins,
          settings!,
        );

      const { commissionAmount, driverEarnings } = this.calculateSplit(
        finalFare,
        settings!.commission,
      );

      // Update fare fields with final calculated values
      updateData.finalFare = finalFare;
      updateData.amount = finalFare; // keep amount in sync
      updateData.commissionAmount = commissionAmount;
      updateData.driverEarnings = driverEarnings;

      // Attach breakdown for response transparency
      updateData.fareBreakdown = {
        baseFare,
        distanceKm: trip.distanceKm,
        distanceComponent,
        timeComponent,
        totalMins,
        estimatedMins: trip.estimatedMins ?? null,
        actualMins,
        finalFare,
        driverEarnings,
        commissionAmount,
      };

      if (trip.driverId) {
        await this.prisma.user.update({
          where: { id: trip.driverId },
          data: {
            totalTrips: { increment: 1 },
          },
        });

        this.gateway.notifyOwnerTripCompleted(trip.ownerId, {
          tripId: trip.id,
          fareBreakdown: updateData.fareBreakdown,
        });

        await this.prisma.user.update({
          where: { id: trip.ownerId },
          data: { totalTrips: { increment: 1 } },
        });
      }
    }

    // Handle cancellation — no fare charged
    if (dto.status === TripStatus.CANCELLED) {
      updateData.amount = 0;
      updateData.commissionAmount = 0;
      updateData.driverEarnings = 0;
      updateData.finalFare = 0;
    }

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: updateData,
      include: {
        driver: {
          select: { id: true, name: true, walletBalance: true },
        },
        owner: {
          select: { id: true, name: true },
        },
      },
    });

    this.adminRealtimeGateway.notifyTripUpdated('status_changed', updated);
    return updated;
  }

  // ─── STATUS TRANSITION RULES ─────────────────────────────────────

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
      [TripStatus.PENDING_ACCEPTANCE]: [TripStatus.ASSIGNED, TripStatus.DECLINED],
      [TripStatus.ASSIGNED]: [TripStatus.IN_PROGRESS, TripStatus.CANCELLED],
      [TripStatus.IN_PROGRESS]: [TripStatus.COMPLETED],
      [TripStatus.SEARCHING]: [TripStatus.CANCELLED],
    };

    const allowedNext = allowed[trip.status] ?? [];

    if (!allowedNext.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${trip.status} to ${newStatus}`,
      );
    }

    if (
      (
        [TripStatus.IN_PROGRESS, TripStatus.COMPLETED] as TripStatus[]
      ).includes(newStatus) &&
      !isDriver &&
      !isAdmin
    ) {
      throw new ForbiddenException('Only the assigned driver can do this');
    }

    if (newStatus === TripStatus.CANCELLED && !isOwner && !isAdmin) {
      throw new ForbiddenException('Only the owner can cancel this ride');
    }
  }

  // ─── TRIP HISTORY ────────────────────────────────────────────────

  async getHistory(userId: string, userRole: UserRole) {
    const where =
      userRole === UserRole.ADMIN
        ? {}
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
