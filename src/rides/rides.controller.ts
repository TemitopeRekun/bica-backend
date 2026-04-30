import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { RidesService } from "./rides.service";
import { CreateRideDto } from './dto/create-ride.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ApprovedDriverGuard } from '../common/guards/approved-driver.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { TripStatus, UserRole } from '@prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import type { FastifyRequest } from 'fastify';
import { Req } from '@nestjs/common';

@UseGuards(AuthGuard, RolesGuard)
@UseInterceptors(IdempotencyInterceptor)
@Controller('rides')
export class RidesController {
  constructor(
    private ridesService: RidesService,
    private cloudinaryService: CloudinaryService
  ) { }

  @Post('upload-photo')
  async uploadPhoto(
    @CurrentUser() user: any,
    @Req() req: FastifyRequest,
    @Body('image') image?: string,
    @Body('folder') folder: string = 'rides',
  ) {
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw new BadRequestException('Image file is required');
      const buffer = await file.toBuffer();
      const url = await this.cloudinaryService.uploadBuffer(buffer, `bica/${folder}`);
      return { url };
    }
    
    if (!image) throw new BadRequestException('Image payload is required');
    const url = await this.cloudinaryService.uploadImage(image, `bica/${folder}`);
    return { url };
  }

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
  getHistory(
    @CurrentUser() user: any,
    @Query() pagination: PaginationDto,
  ) {
    return this.ridesService.getHistory(user.sub, user.role, pagination);
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
    @Body() dto: { acceptanceImageUrl: string }, // Using inline for now to avoid import issues or just import it
  ) {
    return this.ridesService.acceptRide(id, user.sub, dto.acceptanceImageUrl);
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

  // Generate new OTP after failed attempts
  @Roles(UserRole.DRIVER)
  @Post(':id/regenerate-otp')
  regenerateOtp(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.ridesService.regenerateOtp(id, user.sub);
  }
}
