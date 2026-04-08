import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { PaginationDto } from '../common/dto/pagination.dto';

@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('dashboard')
  getDashboard() {
    return this.adminService.getDashboard();
  }

  @Get('users')
  getUsers(@Query() pagination: PaginationDto) {
    return this.adminService.getUsers(pagination);
  }

  @Get('trips')
  getTrips(@Query() pagination: PaginationDto) {
    return this.adminService.getTrips(pagination);
  }

  @Get('payouts')
  getPayouts(@Query() pagination: PaginationDto) {
    return this.adminService.getPayouts(pagination);
  }
}
