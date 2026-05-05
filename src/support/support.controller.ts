import { Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SupportService } from './support.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER, UserRole.OWNER)
  @Post('tickets')
  createTicket(
    @CurrentUser() user: any,
    @Body() dto: CreateSupportTicketDto,
  ) {
    // sub comes from the JWT payload in our AuthGuard
    return this.supportService.createTicket(user.sub, dto);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('tickets')
  getTickets(@Query() pagination: PaginationDto) {
    return this.supportService.getTickets(pagination);
  }
}
