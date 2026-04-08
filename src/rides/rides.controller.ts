import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RidesService } from "./rides.service";
import { CreateRideDto } from './dto/create-ride.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ApprovedDriverGuard } from '../common/guards/approved-driver.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { UserRole } from '@prisma/client';

@UseGuards(AuthGuard, RolesGuard)
@UseInterceptors(IdempotencyInterceptor)
@Controller('rides')
export class RidesController {
  constructor(private ridesService: RidesService) { }

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

  // Owner or driver gets their current ride context
  // GET /rides/current
  @Roles(UserRole.OWNER, UserRole.DRIVER)
  @Get('current')
  getCurrentRide(@CurrentUser() user: any) {
    return this.ridesService.getCurrentRide(user.sub, user.role);
  }

  // Driver accepts a ride request
  // POST /rides/:id/accept
  @Roles(UserRole.DRIVER)
  @UseGuards(ApprovedDriverGuard)
  @Post(':id/accept')
  acceptRide(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.ridesService.acceptRide(id, user.sub);
  }

  // Driver declines a ride request
  // POST /rides/:id/decline
  @Roles(UserRole.DRIVER)
  @UseGuards(ApprovedDriverGuard)
  @Post(':id/decline')
  declineRide(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.ridesService.declineRide(id, user.sub);
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
  @UseGuards(ApprovedDriverGuard)
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
