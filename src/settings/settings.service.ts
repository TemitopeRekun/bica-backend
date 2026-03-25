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
    const settings = await this.prisma.systemSettings.findUnique({
      where: { id: 1 },
    });
    if (!settings) throw new NotFoundException('System settings not found');
    return settings;
  }

  async updateSettings(dto: UpdateSettingsDto, adminId: string) {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { id: 1 },
    });
    if (!settings) throw new NotFoundException('System settings not found');

    const updated = await this.prisma.systemSettings.update({
      where: { id: 1 },
      data: { ...dto, updatedById: adminId },
    });

    this.adminRealtimeGateway.notifySettingsUpdated(updated);
    return updated;
  }
}
