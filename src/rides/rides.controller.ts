import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { RidesService } from "./rides.service";
import { CreateRideDto } from './dto/create-ride.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@UseGuards(AuthGuard, RolesGuard)
@Controller('rides')
export class RidesController {
  constructor(private ridesService: RidesService) {}

  // Owner books a ride
  // POST /rides
  @Roles(UserRole.OWNER)
  @Post()
  createRide(
    @CurrentUser() user: any,
    @Body() dto: CreateRideDto,
  ) {
    return this.ridesService.createRide(user.sub, dto);
  }

  // Any authenticated user gets their trip history
  // GET /rides/history
  @Get('history')
  getHistory(@CurrentUser() user: any) {
    return this.ridesService.getHistory(user.sub, user.role);
  }

  // Get single trip — owner or driver of that trip only
  // GET /rides/:id
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.ridesService.findOne(id, user.sub);
  }

  // Driver updates trip status
  // PATCH /rides/:id/status
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.ridesService.updateStatus(id, user.sub, user.role, dto);
  }

  // Owner cancels a ride
  // POST /rides/:id/cancel
  @Post(':id/cancel')
  cancelRide(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.ridesService.cancelRide(id, user.sub, user.role);
  }
}