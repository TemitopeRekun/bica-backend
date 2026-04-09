import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { PaymentStatus, TripStatus, UserRole } from '@prisma/client';
import { PaginationDto } from '../common/dto/pagination.dto';
import { RidesGateway } from './rides.gateway';
import { AdminRealtimeGateway } from '../admin/admin-realtime.gateway';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { FcmService } from '../notifications/fcm.service';

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: RidesGateway,
    private adminRealtimeGateway: AdminRealtimeGateway,
    @InjectQueue('rides-queue') private rideQueue: Queue,
    private fcmService: FcmService,
  ) { }

  // ─── PRICING ENGINE ──────────────────────────────────────────────

  private calculateEstimatedFare(
    distanceKm: number,
    estimatedMins: number,
    settings: { baseFare: number; pricePerKm: number; timeRate: number },
  ): number {
    let price: number;
    if (distanceKm <= 4.5) {
      price = 2000;
      if (estimatedMins > 20) {
        price += (estimatedMins - 20) * settings.timeRate;
      }
    } else {
      price =
        settings.baseFare +
        distanceKm * settings.pricePerKm +
        estimatedMins * settings.timeRate;
    }
    return Math.round(price / 100) * 100;
  }

  private calculateFinalFare(
    distanceKm: number,
    actualMins: number,
    settings: { baseFare: number; pricePerKm: number; timeRate: number },
  ) {
    let finalFare: number;
    if (distanceKm <= 4.5) {
      finalFare = 2000;
      if (actualMins > 20) {
        finalFare += (actualMins - 20) * settings.timeRate;
      }
    } else {
      finalFare =
        settings.baseFare +
        distanceKm * settings.pricePerKm +
        actualMins * settings.timeRate;
    }

    const roundedFare = Math.round(finalFare / 100) * 100;

    return {
      finalFare: roundedFare,
      baseFare: settings.baseFare,
      distanceComponent: distanceKm * settings.pricePerKm,
      timeComponent: actualMins * settings.timeRate,
      totalMins: actualMins,
    };
  }

  private calculateSplit(totalAmount: number, commissionPercent: number) {
    const commissionAmount = (totalAmount * commissionPercent) / 100;
    return {
      commissionAmount,
      driverEarnings: totalAmount - commissionAmount,
    };
  }

  // ─── CORE RIDE ACTIONS ───────────────────────────────────────────

  async createRide(ownerId: string, dto: CreateRideDto) {
    const settings = await this.prisma.systemSettings.findUnique({ where: { id: 1 } });
    if (!settings) throw new NotFoundException('System settings not found');

    const activeTrip = await this.prisma.trip.findFirst({
      where: {
        ownerId,
        status: {
          in: [
            TripStatus.PENDING,
            TripStatus.SEARCHING,
            TripStatus.PENDING_ACCEPTANCE,
            TripStatus.ASSIGNED,
            TripStatus.IN_PROGRESS,
          ],
        },
      },
    });

    if (activeTrip) {
      throw new ForbiddenException('You already have an active ride request');
    }

    if (dto.driverId && dto.driverId === ownerId) {
      throw new BadRequestException('You cannot request a ride from yourself');
    }

    const isScheduled = !!dto.scheduledAt;
    const amount = this.calculateEstimatedFare(dto.distanceKm, dto.estimatedMins ?? 0, settings);
    const { commissionAmount, driverEarnings } = this.calculateSplit(amount, settings.commission);

    const tripStatus = isScheduled ? TripStatus.SCHEDULED : TripStatus.PENDING_ACCEPTANCE;

    this.logger.log(`📍 [RIDE REQUEST] Pickup → lat: ${dto.pickupLat} | lng: ${dto.pickupLng}`);

    const trip = await this.prisma.trip.create({
      data: {
        ownerId,
        driverId: isScheduled ? null : dto.driverId,
        status: tripStatus,
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
        commissionPercent: settings.commission as any,
        scheduledAt: isScheduled ? new Date(dto.scheduledAt!) : null,
      },
      include: {
        owner: { select: { id: true, name: true, phone: true } },
        driver: { select: { id: true, name: true, phone: true, rating: true } },
      },
    });

    if (isScheduled) {
      const schedDate = new Date(dto.scheduledAt!);
      const delayMs = Math.max(schedDate.getTime() - Date.now() - (15 * 60 * 1000), 0);
      await this.rideQueue.add('ride-search', { tripId: trip.id, pickupLat: dto.pickupLat, pickupLng: dto.pickupLng }, { delay: delayMs });
    } else {
      this.gateway.notifyDriverNewRide(dto.driverId!, trip);
      this.fcmService.sendToUser(dto.driverId!, {
        title: 'New Ride Request!',
        body: `You have a new ride request from ${trip.owner.name}.`,
        data: { tripId: trip.id, type: 'new_ride' },
      }).catch(e => this.logger.error(`FCM Error: ${e.message}`));
    }

    this.adminRealtimeGateway.notifyTripUpdated('created', trip);
    return trip;
  }

  async getHistory(userId: string, role: UserRole, pagination: PaginationDto) {
    const where = role === UserRole.DRIVER ? { driverId: userId } : { ownerId: userId };

    return this.prisma.trip.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, name: true, avatarUrl: true } },
        driver: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  async getCurrentRide(userId: string, role: UserRole) {
    const filter = role === UserRole.DRIVER ? { driverId: userId } : { ownerId: userId };
    return this.prisma.trip.findFirst({
      where: {
        ...filter,
        status: { in: [TripStatus.PENDING_ACCEPTANCE, TripStatus.ASSIGNED, TripStatus.IN_PROGRESS] },
      },
      include: {
        owner: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        driver: { select: { id: true, name: true, phone: true, avatarUrl: true, rating: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        driver: { select: { id: true, name: true, phone: true, avatarUrl: true, rating: true } },
      },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.ownerId !== userId && trip.driverId !== userId) throw new ForbiddenException('Access denied');
    return trip;
  }

  async acceptRide(tripId: string, driverId: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.status !== TripStatus.PENDING_ACCEPTANCE) throw new BadRequestException('Trip no longer available');

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.ASSIGNED, driverId },
      include: {
        owner: { select: { id: true, name: true } },
        driver: { select: { id: true, name: true, rating: true } },
      },
    });

    this.gateway.notifyTripStatusChanged(tripId, TripStatus.ASSIGNED, updated);
    this.fcmService.sendToUser(updated.ownerId, {
      title: 'Driver Found!',
      body: `${updated.driver?.name ?? 'A driver'} has accepted your ride.`,
      data: { tripId, type: 'ride_accepted' },
    }).catch(e => this.logger.error(`FCM Accept Error: ${e.message}`));

    return updated;
  }

  async declineRide(tripId: string, driverId: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.DECLINED },
    });

    this.gateway.notifyTripStatusChanged(tripId, TripStatus.DECLINED, { ownerId: trip.ownerId });
    return updated;
  }

  async cancelRide(tripId: string, userId: string, role: UserRole) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');

    if (trip.status === TripStatus.IN_PROGRESS || trip.status === TripStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel trip once it has started');
    }

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.CANCELLED },
      include: {
        owner: { select: { id: true, name: true } },
        driver: { select: { id: true, name: true } },
      },
    });

    const otherPartyId = role === UserRole.OWNER ? trip.driverId : trip.ownerId;
    if (otherPartyId) {
      this.gateway.notifyTripStatusChanged(tripId, TripStatus.CANCELLED, updated);
      
      // 🛡️ Redundancy: Send explicit ride:cancelled event to clear driver UI
      if (role === UserRole.OWNER && trip.driverId) {
        this.gateway.server.to(`user:${trip.driverId}`).emit('ride:cancelled', { tripId });
        this.logger.log(`📡 [WS] Cancellation sent to Driver ${trip.driverId} for Trip ${tripId}`);
      }

      this.fcmService.sendToUser(otherPartyId, {
        title: 'Trip Cancelled',
        body: `The trip has been cancelled by the ${role.toLowerCase()}.`,
        data: { tripId, type: 'ride_cancelled' },
      }).catch(e => this.logger.error(`FCM Cancel Error: ${e.message}`));
    }

    return updated;
  }

  async updateStatus(tripId: string, userId: string, role: UserRole, dto: UpdateStatusDto) {
    const trip = await this.prisma.trip.findUnique({ 
      where: { id: tripId },
      include: {
        owner: { select: { id: true, name: true, phone: true } },
        driver: { select: { id: true, name: true, phone: true, rating: true } },
      }
    });
    if (!trip) throw new NotFoundException('Trip not found');

    // 🛡️ Resilience: If the trip is already at or past the requested status, just return it
    // This prevents 400 errors if the app sends a stale/duplicate update
    const statusPriority = {
      [TripStatus.PENDING]: 0,
      [TripStatus.SEARCHING]: 1,
      [TripStatus.PENDING_ACCEPTANCE]: 2,
      [TripStatus.ASSIGNED]: 3,
      [TripStatus.ARRIVED]: 4,
      [TripStatus.IN_PROGRESS]: 5,
      [TripStatus.COMPLETED]: 6,
      [TripStatus.CANCELLED]: -1,
      [TripStatus.DECLINED]: -1,
    };

    if (statusPriority[trip.status] >= statusPriority[dto.status]) {
      this.logger.warn(`🔁 [STALE_UPDATE] Trip ${tripId} is already ${trip.status}. Ignoring request to move to ${dto.status}.`);
      // Re-broadcast fresh status to fix UI sync
      this.gateway.notifyTripStatusChanged(tripId, trip.status, trip);
      return trip;
    }

    this.validateStatusTransition(trip, userId, role, dto.status);

    const updateData: any = { status: dto.status };
    if (dto.status === TripStatus.IN_PROGRESS) updateData.startedAt = new Date();
    if (dto.status === TripStatus.COMPLETED) {
      updateData.completedAt = new Date();
      const settings = await this.prisma.systemSettings.findUnique({ where: { id: 1 } });
      const startedAt = trip.startedAt ?? new Date();
      const actualMins = Math.ceil((updateData.completedAt.getTime() - startedAt.getTime()) / 60000);
      const { finalFare, baseFare, distanceComponent, timeComponent, totalMins } = this.calculateFinalFare(trip.distanceKm, actualMins, settings!);
      const { commissionAmount, driverEarnings } = this.calculateSplit(finalFare, (trip as any).commissionPercent);
      
      updateData.finalFare = finalFare;
      updateData.amount = finalFare;
      updateData.commissionAmount = commissionAmount;
      updateData.driverEarnings = driverEarnings;
      updateData.fareBreakdown = { baseFare, distanceKm: trip.distanceKm, distanceComponent, timeComponent, totalMins };
    }

    const tripUpdate = await this.prisma.trip.update({
      where: { id: tripId },
      data: updateData,
      include: {
        owner: { select: { id: true, name: true, phone: true } },
        driver: { select: { id: true, name: true, phone: true, rating: true } },
      },
    });

    // 🛡️ Sync-Burst: If we jumped from Pending Acceptance, ensure Owner app 'Unlocks' first
    if (trip.status === TripStatus.PENDING_ACCEPTANCE && ([TripStatus.ASSIGNED, TripStatus.ARRIVED] as TripStatus[]).includes(dto.status)) {
      this.gateway.notifyOwnerDriverAccepted(tripUpdate.ownerId, {
        tripId: tripUpdate.id,
        driver: tripUpdate.driver,
        estimatedArrivalMins: 5 
      });
      console.log(`📡 [WS] Sync-Burst 'ride:accepted' sent to Owner ${tripUpdate.ownerId} (Stale bypass)`);
    }

    this.gateway.notifyTripStatusChanged(tripId, dto.status, tripUpdate);
    this.notifyStatusChangeViaPush(tripUpdate, dto.status);
    return tripUpdate;
  }

  private validateStatusTransition(trip: any, userId: string, role: UserRole, newStatus: TripStatus) {
    if (role === UserRole.DRIVER && trip.driverId !== userId) throw new ForbiddenException('Not your trip');
    
    // Allow ARRIVED from both ASSIGNED or PENDING_ACCEPTANCE (in case of transition sync lag)
    if (newStatus === TripStatus.ARRIVED && ![TripStatus.ASSIGNED, TripStatus.PENDING_ACCEPTANCE].includes(trip.status)) {
      this.logger.error(`🙈 [STATE_FAILED] Trip ${trip.id} cannot move from ${trip.status} to ${newStatus}`);
      throw new BadRequestException('Invalid state');
    }
    if (newStatus === TripStatus.IN_PROGRESS && trip.status !== TripStatus.ARRIVED) {
      this.logger.error(`🙈 [STATE_FAILED] Trip ${trip.id} cannot move from ${trip.status} to ${newStatus}`);
      throw new BadRequestException('Invalid state');
    }
    if (newStatus === TripStatus.COMPLETED && trip.status !== TripStatus.IN_PROGRESS) {
      this.logger.error(`🙈 [STATE_FAILED] Trip ${trip.id} cannot move from ${trip.status} to ${newStatus}`);
      throw new BadRequestException('Invalid state');
    }
  }

  private async notifyStatusChangeViaPush(trip: any, status: TripStatus) {
    const bodyMap = {
      [TripStatus.ARRIVED]: 'Driver is at your pickup location.',
      [TripStatus.IN_PROGRESS]: 'Your trip has begun.',
      [TripStatus.COMPLETED]: 'Trip completed. Please proceed to payment.',
    };
    if (bodyMap[status]) {
      this.fcmService.sendToUser(trip.ownerId, { title: 'Trip Update', body: bodyMap[status], data: { tripId: trip.id, status } }).catch(e => this.logger.error(`FCM Push Error: ${e.message}`));
    }
  }
}
