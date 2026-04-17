import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AdminRealtimeGateway } from '../admin/admin-realtime.gateway';

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private adminRealtimeGateway: AdminRealtimeGateway,
  ) {}

  async getSettings() {
    return this.prisma.systemSettings.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        baseFare: 500,
        pricePerKm: 100,
        timeRate: 50,
        commission: 25,
        autoApprove: false,
        minimumFare: 2000,
        minimumFareDistance: 4.5,
        minimumFareDuration: 20,
      },
    });
  }

  async updateSettings(dto: UpdateSettingsDto, adminId: string) {
    // Ensure settings exist before updating
    await this.getSettings();

    const updated = await this.prisma.systemSettings.update({
      where: { id: 1 },
      data: { ...dto, updatedById: adminId },
    });

    this.adminRealtimeGateway.notifySettingsUpdated(updated);
    return updated;
  }
}
