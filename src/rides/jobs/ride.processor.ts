import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RidesGateway } from '../rides.gateway';
import { TripStatus } from '@prisma/client';

export interface RideSearchJobData {
  tripId: string;
  pickupLat: number;
  pickupLng: number;
  radiusKm: number;
  transmission?: string;
}

@Processor('rides-queue')
export class RideProcessor extends WorkerHost {
  private readonly logger = new Logger(RideProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ridesGateway: RidesGateway,
    @InjectQueue('rides-queue') private readonly rideQueue: Queue,
  ) {
    super();
  }

  // Haversine distance matching the service logic
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

  async process(job: Job<RideSearchJobData, any, string>): Promise<any> {
    this.logger.log(`Processing search job for scheduled trip ${job.data.tripId}...`);

    const { tripId, pickupLat, pickupLng, radiusKm, transmission } = job.data;

    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        owner: {
          select: { id: true, name: true, phone: true, avatarUrl: true },
        },
      },
    });

    if (!trip || trip.status !== 'SCHEDULED') {
      this.logger.log(`Trip ${tripId} is no longer SCHEDULED. Aborting search.`);
      return { aborted: true, reason: 'Trip not in expected state' };
    }

    // Search for drivers within radiusKm
    const drivers = await this.prisma.user.findMany({
      where: {
        role: 'DRIVER',
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

    const eligible = transmission
      ? drivers.filter(
        (d) => d.transmission === transmission || d.transmission === 'Both',
      )
      : drivers;

    const withDistance = eligible
      .map((d) => ({
        ...d,
        distanceKm: this.haversineDistance(
          pickupLat,
          pickupLng,
          d.locationLat!,
          d.locationLng!,
        ),
      }))
      .filter((d) => d.distanceKm <= radiusKm);

    withDistance.sort((a, b) => a.distanceKm - b.distanceKm);

    if (withDistance.length > 0) {
      // Find the nearest driver that is not busy
      for (const candidate of withDistance) {
        const isBusy = await this.prisma.trip.findFirst({
          where: {
            driverId: candidate.id,
            status: { in: ['PENDING_ACCEPTANCE', 'ASSIGNED', 'IN_PROGRESS'] },
          },
        });

        if (!isBusy) {
          // Assign to this driver and transition to PENDING_ACCEPTANCE
          await this.prisma.trip.update({
            where: { id: trip.id },
            data: {
              status: TripStatus.PENDING_ACCEPTANCE,
              driverId: candidate.id,
            },
          });

          const completeTripData = await this.prisma.trip.findUnique({
            where: { id: trip.id },
            include: {
              owner: {
                select: { id: true, name: true, phone: true, avatarUrl: true },
              },
              driver: {
                select: { id: true, name: true, phone: true, avatarUrl: true, rating: true, transmission: true },
              },
            },
          });

          // Notify the selected driver
          this.ridesGateway.notifyDriverNewRide(candidate.id, {
            ...completeTripData,
            estimatedArrivalMins: null,
          });

          this.logger.log(`Trip ${trip.id} assigned to driver ${candidate.id}`);

          // Also trigger Push Notification to owner & driver here...
          // (To be implemented in NotificationsModule)

          return { assignedTo: candidate.id };
        }
      }
    }

    // If we reach here, no available driver was found within `radiusKm`
    // Escalate search radius. Dispatch windows: 5km -> 10km -> 20km
    this.logger.log(`No drivers found in ${radiusKm}km for trip ${trip.id}`);
    
    let nextRadiusKm = 0;
    if (radiusKm === 5) nextRadiusKm = 10;
    else if (radiusKm === 10) nextRadiusKm = 20;

    if (nextRadiusKm > 0) {
      this.logger.log(`Escalating search for ${trip.id} to ${nextRadiusKm}km logic`);
      
      // Delay next search by 1 minute to allow drivers to come online
      // We push a new job for the same trip with expanded radius.
      await this.rideQueue.add(
        'ride-search',
        {
          tripId,
          pickupLat,
          pickupLng,
          radiusKm: nextRadiusKm,
          transmission,
        },
        { delay: 60000 },
      );
      return { escalated: nextRadiusKm };
    }

    // Dispatch failed entirely (radius 20 exhausted). Mark as DECLINED or CANCELLED?
    // According to specs, if no driver found within 5 minutes, we must notify rider.
    this.logger.warn(`Dispatch exhausted for trip ${trip.id}. Marking as DECLINED.`);
    
    await this.prisma.trip.update({
      where: { id: trip.id },
      data: { status: TripStatus.DECLINED },
    });

    // Notify Rider failure
    this.ridesGateway.notifyOwnerTripStatus(trip.ownerId, {
      tripId: trip.id,
      status: TripStatus.DECLINED,
      message: 'No available drivers found nearby for your scheduled ride. Please try again later.',
    });

    return { failed: true, reason: 'Exhausted radii' };
  }
}
