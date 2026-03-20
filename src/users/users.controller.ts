import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateApprovalDto } from './dto/update-approval.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@UseGuards(AuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

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
  getAvailableDrivers() {
    return this.usersService.getAvailableDrivers();
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
}