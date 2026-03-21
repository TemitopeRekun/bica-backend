import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RidesModule } from './rides/rides.module';
import { PaymentsModule } from './payments/payments.module';
import { LocationsModule } from './locations/locations.module';
import { AdminModule } from './admin/admin.module';
import { ConfigModule } from '@nestjs/config';
import { SettingsModule } from './settings/settings.module';
import { RedisModule } from './redis/redis.module';



@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule, 
    AuthModule,
    UsersModule,
    RidesModule,
    PaymentsModule,
    LocationsModule,
    AdminModule,
    SettingsModule,
    RedisModule,
  ],
})
export class AppModule {}
