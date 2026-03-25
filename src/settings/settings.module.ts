import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AuthModule } from '../auth/auth.module';
import { AdminRealtimeModule } from '../admin/admin-realtime.module';

@Module({
  imports: [AuthModule, AdminRealtimeModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
