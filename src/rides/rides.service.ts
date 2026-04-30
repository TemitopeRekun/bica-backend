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

  /**
   * 🛡️ SINGLE SOURCE OF TRUTH (SSOT) PRICING ENGINE (BICA VERSION)
   * All fare calculations (estimation and finalization) MUST use this method.
   */
  public calculateTripFare(
    distanceKm: number,
    durationMins: number,
    settings: { 
      baseFare: number; 
      pricePerKm: number; 
      timeRate: number;
      minimumFare?: number;
      minimumFareDistance?: number;
      minimumFareDuration?: number;
    },
  ) {
    const minFare = settings.minimumFare ?? 2000;
    const minDist = settings.minimumFareDistance ?? 4.5;
    const minDuration = settings.minimumFareDuration ?? 20;

    let finalFareRaw = 0;
    let branch = '';

    // BRANCH 1 & 2: The "Threshold Zone" (Short Distance)
    if (distanceKm <= minDist) {
      if (durationMins <= minDuration) {
        // ZONE A: Short and Fast (Fixed Rate)
        finalFareRaw = minFare;
        branch = 'ZONE_A (SHORT_FAST)';
      } else {
        // ZONE B: Short and Slow (Base + Traffic Penalty)
        const extraMins = durationMins - minDuration;
        finalFareRaw = minFare + (extraMins * settings.timeRate);
        branch = 'ZONE_B (SHORT_SLOW)';
      }
    } else {
      // BRANCH 3: Standard Long Distance Meter
      const standardFare =
        settings.baseFare +
        distanceKm * settings.pricePerKm +
        durationMins * settings.timeRate;
      
      // Global Minimum Enforcement
      if (standardFare < minFare) {
        finalFareRaw = minFare;
        branch = 'ZONE_C (LONG_BELOW_MIN)';
      } else {
        finalFareRaw = standardFare;
        branch = 'ZONE_C (STANDARD)';
      }
    }

    // Rounding Strategy (SSOT: Nearest 50 Naira)
    const finalFare = Math.round(finalFareRaw / 50) * 50;

    this.logger.debug(`💰 [PRICING_BRANCH] ${branch} | Raw: ${finalFareRaw} | Final: ${finalFare}`);

    return {
      finalFare,
      baseFare: settings.baseFare,
      distanceComponent: distanceKm * settings.pricePerKm,
      timeComponent: durationMins * settings.timeRate,
      totalMins: durationMins,
      pricingBranch: branch
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

    if (
      typeof settings.commission !== 'number' ||
      settings.commission < 0 ||
      settings.commission > 100
    ) {
      throw new BadRequestException(
        `Invalid commission rate configured (${settings.commission}). Must be 0–100.`,
      );
    }

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
    const { finalFare: amount, ...fareDetails } = this.calculateTripFare(
      dto.distanceKm, 
      dto.estimatedMins ?? 0, 
      settings as any
    );
    
    const { commissionAmount, driverEarnings } = this.calculateSplit(amount, settings.commission);

    const tripStatus = isScheduled ? TripStatus.SCHEDULED : TripStatus.PENDING_ACCEPTANCE;

    this.logger.log(`📍 [RIDE_SSOT] Created: ${amount} (Base: ${fareDetails.baseFare} | Dist: ${dto.distanceKm} | Time: ${dto.estimatedMins})`);

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
        // 🔄 Schema Alignment: Explicitly initialize optional unique fields
        paymentReference: null,
        monnifyTxRef: null,
        // 🛡️ Lock in the Snapshot (SSOT)
        baseFareSnapshot: settings.baseFare,
        pricePerKmSnapshot: settings.pricePerKm,
        timeRateSnapshot: settings.timeRate,
        minimumFareSnapshot: (settings as any).minimumFare ?? 2000,
        minimumFareDurationSnapshot: (settings as any).minimumFareDuration ?? 20,
        // minimumFareDistance is missing from schema, but we'll include it in fareBreakdown JSON below
        fareBreakdown: {
          totalAmount: amount,
          baseFare: fareDetails.baseFare,
          distanceKm: dto.distanceKm,
          distanceComponent: fareDetails.distanceComponent,
          timeComponent: fareDetails.timeComponent,
          totalMins: dto.estimatedMins,
          isEstimate: true,
          pricingBranch: fareDetails.pricingBranch,
          minimumFareDistanceSnapshot: settings.minimumFareDistance 
        },
      } as any,
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
        body: `You have a new ride request from ${(trip as any).owner.name}.`,
        data: { tripId: trip.id, type: 'new_ride' },
      }).catch(e => this.logger.error(`FCM Error: ${e.message}`));
    }

    this.adminRealtimeGateway.notifyTripUpdated('created', trip);
    return {
      ...trip,
      _debug: {
        isBackendDynamicPrice: true,
        roundedAmount: amount,
        serverTime: new Date().toISOString()
      }
    };
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
    try {
      const filter = role === UserRole.DRIVER ? { driverId: userId } : { ownerId: userId };
      const trip = await this.prisma.trip.findFirst({
        where: {
          ...filter,
          status: { 
            in: [
              TripStatus.PENDING_ACCEPTANCE, 
              TripStatus.ASSIGNED, 
              TripStatus.ARRIVED, 
              TripStatus.IN_PROGRESS
            ] 
          },
        },
        include: {
          owner: { select: { id: true, name: true, phone: true, avatarUrl: true } },
          driver: { select: { id: true, name: true, phone: true, avatarUrl: true, rating: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (trip) {
        this.logger.debug(`🔍 [REFRESH] Found current ride ${trip.id} [Status: ${trip.status}] for ${role} ${userId}`);
      } else {
        this.logger.debug(`🔍 [REFRESH] No current ride found for ${role} ${userId}`);
      }

      return trip;
    } catch (error) {
      this.logger.error(`❌ [REFRESH_ERROR] Failed to query current ride for ${role} ${userId}: ${error.message}`);
      // Safety: Return null instead of 500 Internal Server Error to avoid breaking the frontend UI.
      return null;
    }
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

  async acceptRide(tripId: string, driverId: string, acceptanceImageUrl: string) {
    try {
      const updated = await this.prisma.trip.update({
        where: { 
          id: tripId,
          status: TripStatus.PENDING_ACCEPTANCE // 🛡️ Atomic check: prevents two drivers from accepting
        },
        data: { 
          status: TripStatus.ASSIGNED, 
          driverId,
          otp,
          acceptanceImageUrl,
          otpAttempts: 0
        },
        include: {
          owner: { select: { id: true, name: true, phone: true } },
          driver: { select: { id: true, name: true, rating: true, avatarUrl: true } },
        },
      });

      this.gateway.notifyTripStatusChanged(tripId, TripStatus.ASSIGNED, updated);
      this.fcmService.sendToUser(updated.ownerId, {
        title: 'Driver Found!',
        body: `${updated.driver?.name ?? 'A driver'} has accepted your ride. Verification Code: ${otp}`,
        data: { tripId, type: 'ride_accepted', otp },
      }).catch(e => this.logger.error(`FCM Accept Error: ${e.message}`));

      return updated;
    } catch (error) {
      if (error.code === 'P2025') { // Prisma RecordNotFound (caused by the status check failing)
        throw new BadRequestException('Trip is no longer available or has already been accepted.');
      }
      throw error;
    }
  }

  async regenerateOtp(tripId: string, driverId: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.driverId !== driverId) throw new ForbiddenException('Not your trip');
    if (trip.status !== TripStatus.ARRIVED) throw new BadRequestException('Can only regenerate PIN when arrived');

    const newOtp = Math.floor(1000 + Math.random() * 9000).toString();
    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { otp: newOtp, otpAttempts: 0 },
      include: {
        owner: { select: { id: true, name: true } },
      }
    });

    // Notify owner of new PIN
    this.gateway.server.to(`user:${updated.ownerId}`).emit('ride:otp_regenerated', { tripId, otp: newOtp });
    this.fcmService.sendToUser(updated.ownerId, {
      title: 'New Verification Code',
      body: `Your new ride verification code is ${newOtp}`,
      data: { tripId, otp: newOtp, type: 'otp_regenerated' }
    }).catch(e => this.logger.error(`FCM Regenerate Error: ${e.message}`));

    return { success: true, message: 'New PIN sent to owner' };
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
    
    if (dto.status === TripStatus.IN_PROGRESS) {
      // 🛡️ PIN Verification Logic
      if (!dto.otp) {
        throw new BadRequestException('Verification code (OTP) is required to start the trip');
      }

      if (trip.otp !== dto.otp) {
        const newAttempts = (trip.otpAttempts || 0) + 1;
        await this.prisma.trip.update({
          where: { id: tripId },
          data: { otpAttempts: newAttempts }
        });

        if (newAttempts >= 5) {
          throw new BadRequestException('Too many failed attempts. Please request a new PIN from the owner.');
        }

        throw new BadRequestException(`Incorrect PIN. Attempt ${newAttempts} of 5.`);
      }

      updateData.startedAt = new Date();
      updateData.carFrontUrl = dto.carFrontUrl;
      updateData.carBackUrl = dto.carBackUrl;
      updateData.carLeftUrl = dto.carLeftUrl;
      updateData.carRightUrl = dto.carRightUrl;
    }

    if (dto.status === TripStatus.COMPLETED) {
      updateData.completedAt = new Date();
      
      const startedAt = trip.startedAt ?? new Date();
      const actualMins = Math.ceil((updateData.completedAt.getTime() - startedAt.getTime()) / 60000);
      
      // 🛡️ Snapshot Settlement (SSOT)
      // We use the rates that were 'locked in' when the ride was created.
      const lookupSettings = {
        baseFare: (trip as any).baseFareSnapshot ?? 500,
        pricePerKm: (trip as any).pricePerKmSnapshot ?? 100,
        timeRate: (trip as any).timeRateSnapshot ?? 50,
        minimumFare: (trip as any).minimumFareSnapshot ?? 2000,
        minimumFareDistance: (trip as any).fareBreakdown?.minimumFareDistanceSnapshot ?? 4.5,
        minimumFareDuration: (trip as any).minimumFareDurationSnapshot ?? 20
      };

      const { 
        finalFare, 
        baseFare, 
        distanceComponent, 
        timeComponent, 
        totalMins, 
        pricingBranch 
      } = this.calculateTripFare(trip.distanceKm, actualMins, lookupSettings);
      
      const { commissionAmount, driverEarnings } = this.calculateSplit(finalFare, (trip as any).commissionPercent);
      
      updateData.finalFare = finalFare;
      updateData.amount = finalFare;
      updateData.commissionAmount = commissionAmount;
      updateData.driverEarnings = driverEarnings;
      updateData.fareBreakdown = { 
        totalAmount: finalFare,
        baseFare, 
        distanceKm: trip.distanceKm, 
        distanceComponent, 
        timeComponent, 
        totalMins,
        isSnapshotUsed: true,
        pricingBranch // Correctly extracted here
      };
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
      this.logger.debug(`[WS] Sync-Burst ride:accepted → Owner ${tripUpdate.ownerId}`);
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
