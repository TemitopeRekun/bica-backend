import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
import { UpdateApprovalDto } from './dto/update-approval.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(AuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Patch('avatar')
  @Post('upload-avatar')
  async uploadAvatar(
    @CurrentUser() user: any,
    @Req() req: FastifyRequest,
    @Body('image') image?: string,
  ) {
    if (req.isMultipart()) {
      const file = await req.file();

      if (!file) {
        throw new BadRequestException('image file is required');
      }

      const buffer = await file.toBuffer();
      return this.usersService.uploadAvatar(user.sub, buffer, file.mimetype);
    }
  
    return this.usersService.uploadAvatar(user.sub, image ?? '');
  }

  // Admin: list all users, optionally filter by role
  // GET /users
  // GET /users?role=DRIVER
  @Roles(UserRole.ADMIN)
  @Get()
  findAll(@Query('role') role?: UserRole) {
    return this.usersService.findAll(role);
  }

  // Any authenticated user: get available drivers
  // GET /users/drivers/available
  @Get('drivers/available')
  getAvailableDrivers(
    @Query('pickupLat') pickupLat?: string,
    @Query('pickupLng') pickupLng?: string,
    @Query('transmission') transmission?: string,
  ) {
    const lat = pickupLat ? parseFloat(pickupLat) : undefined;
    const lng = pickupLng ? parseFloat(pickupLng) : undefined;
    return this.usersService.getAvailableDrivers(lat, lng, transmission);
  }

  // Admin: get single user profile
  // GET /users/:id
  @Roles(UserRole.ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  // Admin: approve or reject a driver
  // PATCH /users/:id/approval
  @Roles(UserRole.ADMIN)
  @Patch(':id/approval')
  updateApproval(
    @Param('id') id: string,
    @Body() dto: UpdateApprovalDto,
  ) {
    return this.usersService.updateApproval(id, dto);
  }

  // Admin: block or unblock a user
  // PATCH /users/:id/block
  @Roles(UserRole.ADMIN)
  @Patch(':id/block')
  toggleBlock(
    @Param('id') id: string,
    @Body('isBlocked') isBlocked: boolean,
  ) {
    return this.usersService.toggleBlock(id, isBlocked);
  }

  // Driver: update their own live location
  // PATCH /users/location
  @Roles(UserRole.DRIVER)
  @Patch('location')
  updateLocation(
    @CurrentUser() user: any,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.usersService.updateLocation(user.sub, dto);
  }

  // Driver goes online or offline
  // PATCH /users/online
  @Roles(UserRole.DRIVER)
  @Patch('online')
  updateOnlineStatus(
    @CurrentUser() user: any,
    @Body('isOnline') isOnline: boolean,
  ) {
    return this.usersService.updateOnlineStatus(user.sub, isOnline);
  }
}
