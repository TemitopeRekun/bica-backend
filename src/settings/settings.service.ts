import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

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

    return this.prisma.systemSettings.update({
      where: { id: 1 },
      data: { ...dto, updatedById: adminId },
    });
  }
}