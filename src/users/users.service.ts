import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateApprovalDto } from './dto/update-approval.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { UpdateOnlineStatusDto } from './dto/update-online-status.dto';
import { UserRole } from '@prisma/client';
import { RidesGateway } from '../rides/rides.gateway';
import { AdminRealtimeGateway } from '../admin/admin-realtime.gateway';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private ridesGateway: RidesGateway,
    private adminRealtimeGateway: AdminRealtimeGateway,
    private cloudinaryService: CloudinaryService,
  ) { }

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
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Get a single user by ID (User Dossier)
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
        carModel: true,
        carYear: true,
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
        // Banking fields — required for Admin Dossier banking status
        bankName: true,
        bankCode: true,
        accountNumber: true,
        accountName: true,
        monnifySubAccountCode: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return {
      ...user,
      // Derived flags the frontend uses to drive the Approve button and Retry logic
      subAccountActive: !!user.monnifySubAccountCode,
      canRetrySubAccountSetup:
        !user.monnifySubAccountCode &&
        !!user.bankCode &&
        !!user.accountNumber,
    };
  }

  // Admin: approve or reject a driver
  async updateApproval(id: string, dto: UpdateApprovalDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) throw new NotFoundException('User not found');

    if (user.role !== UserRole.DRIVER) {
      throw new ForbiddenException('Approval status only applies to drivers');
    }

    // Hard Guard: Cannot approve a driver without a Monnify sub-account
    if (dto.approvalStatus === 'APPROVED' && !user.monnifySubAccountCode) {
      throw new BadRequestException(
        'Cannot approve driver: Monnify sub-account must be created and verified first. Please click "Retry Sub-Account" button.',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { approvalStatus: dto.approvalStatus },
      select: { id: true, name: true, approvalStatus: true },
    });

    this.adminRealtimeGateway.notifyUserUpdated('approval_changed', updated);
    return updated;
  }

  // Driver toggles online/offline — going online REQUIRES current GPS coords
  async updateOnlineStatus(id: string, dto: UpdateOnlineStatusDto) {
    const data: any = { isOnline: dto.isOnline };

    // Atomically update location when going online so driver is
    // never in the available pool without a known position
    if (dto.isOnline && dto.lat !== undefined && dto.lng !== undefined) {
      data.locationLat = dto.lat;
      data.locationLng = dto.lng;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        role: true,
        isOnline: true,
        locationLat: true,
        locationLng: true,
      },
    });

    this.logger.log(`Driver ${id} [Role: ${user.role}] is now ${dto.isOnline ? 'ONLINE' : 'OFFLINE'}${
      dto.isOnline ? ` at [${dto.lat}, ${dto.lng}]` : ''
    }`);

    this.ridesGateway.notifyDriverAvailabilityChanged(id, dto.isOnline, {
      locationLat: user.locationLat,
      locationLng: user.locationLng,
    });

    return user;
  }

  // Admin: block or unblock any user
  async toggleBlock(id: string, isBlocked: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isBlocked },
      select: { id: true, name: true, isBlocked: true, role: true },
    });

    this.adminRealtimeGateway.notifyUserUpdated('block_changed', updated);
    return updated;
  }

  async uploadAvatar(
    userId: string,
    image: string | Buffer,
    mimetype?: string,
  ) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    let avatarUrl: string;

    if (typeof image === 'string') {
      if (!image.trim()) {
        throw new BadRequestException('image is required');
      }

      avatarUrl = await this.cloudinaryService.uploadImage(
        image,
        'bica/avatars',
        `avatar_${userId}`,
      );
    } else {
      if (mimetype && !mimetype.startsWith('image/')) {
        throw new BadRequestException('Only image uploads are allowed');
      }

      avatarUrl = await this.cloudinaryService.uploadBuffer(
        image,
        'bica/avatars',
        `avatar_${userId}`,
      );
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: { id: true, avatarUrl: true },
    });

    this.adminRealtimeGateway.notifyUserUpdated('avatar_updated', updatedUser);
    return updatedUser;
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
  async getAvailableDrivers(
    pickupLat?: number,
    pickupLng?: number,
    transmission?: string,
  ) {
    const drivers = await this.prisma.user.findMany({
      where: {
        isOnline: true, // Wide-Net: see everyone who is online
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        approvalStatus: true,
        isBlocked: true,
        isOnline: true,
        locationLat: true,
        locationLng: true,
        transmission: true,
        rating: true,
        totalTrips: true,
        avatarUrl: true,
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

    const available = drivers.filter(d => 
      d.approvalStatus === 'APPROVED' &&
      !d.isBlocked &&
      d.locationLat !== null &&
      d.locationLng !== null &&
      d.tripsAsDriver.length === 0 &&
      (transmission === 'Manual'
        ? (d.transmission === 'MANUAL' || d.transmission === 'BOTH')
        : transmission === 'Automatic'
          ? (d.transmission === 'AUTOMATIC' || d.transmission === 'BOTH' || d.transmission === null)
          : true)
    );

    if (pickupLat !== undefined && pickupLng !== undefined) {
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

  async updateFcmToken(id: string, dto: UpdateFcmTokenDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id },
      data: {
        fcmToken: dto.token,
        deviceType: dto.deviceType,
      },
      select: { id: true, fcmToken: true, deviceType: true },
    });
  }

  // Admin: diagnose why a specific driver is not showing as available
  async diagnoseDriverAvailability(driverId: string) {
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        name: true,
        role: true,
        approvalStatus: true,
        isBlocked: true,
        isOnline: true,
        locationLat: true,
        locationLng: true,
        transmission: true,
        monnifySubAccountCode: true,
        tripsAsDriver: {
          where: {
            status: { in: ['PENDING_ACCEPTANCE', 'ASSIGNED', 'IN_PROGRESS'] },
          },
          select: { id: true, status: true },
        },
      },
    });

    if (!driver) throw new NotFoundException('Driver not found');

    const checks = {
      isDriver:           driver.role === 'DRIVER',
      isApproved:         driver.approvalStatus === 'APPROVED',
      isNotBlocked:       !driver.isBlocked,
      isOnline:           driver.isOnline,
      hasLocation:        driver.locationLat !== null && driver.locationLng !== null,
      hasNoActiveTrip:    driver.tripsAsDriver.length === 0,
      hasSubAccount:      !!driver.monnifySubAccountCode,
    };

    const failing = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([check]) => check);

    return {
      driverId: driver.id,
      name: driver.name,
      wouldAppearAsAvailable: failing.length === 0,
      failingChecks: failing,
      passingChecks: Object.entries(checks).filter(([, v]) => v).map(([k]) => k),
      raw: {
        role: driver.role,
        approvalStatus: driver.approvalStatus,
        isBlocked: driver.isBlocked,
        isOnline: driver.isOnline,
        locationLat: driver.locationLat,
        locationLng: driver.locationLng,
        transmission: driver.transmission,
        activeTrips: driver.tripsAsDriver,
      },
    };
  }
}
