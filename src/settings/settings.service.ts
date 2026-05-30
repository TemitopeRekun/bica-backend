import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AdminRealtimeGateway } from '../admin/admin-realtime.gateway';
import { RedisService } from '../redis/redis.service';

const SETTINGS_CACHE_KEY = 'system:settings';
const SETTINGS_CACHE_TTL = 300; // 5 minutes

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private adminRealtimeGateway: AdminRealtimeGateway,
    private redis: RedisService,
  ) {}

  async getSettings() {
    const cached = await this.redis.get<object>(SETTINGS_CACHE_KEY);
    if (cached) return cached;

    const settings = await this.prisma.systemSettings.upsert({
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

    await this.redis.set(SETTINGS_CACHE_KEY, settings, SETTINGS_CACHE_TTL);
    return settings;
  }

  async updateSettings(dto: UpdateSettingsDto, adminId: string) {
    await this.getSettings();

    const updated = await this.prisma.systemSettings.update({
      where: { id: 1 },
      data: { ...dto, updatedById: adminId },
    });

    await this.redis.del(SETTINGS_CACHE_KEY);
    this.adminRealtimeGateway.notifySettingsUpdated(updated);
    return updated;
  }
}
