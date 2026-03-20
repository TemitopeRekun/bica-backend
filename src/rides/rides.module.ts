import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { RidesGateway } from './rides.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RidesController],
  providers: [RidesService, RidesGateway],
  exports: [RidesService],
})
export class RidesModule {}