import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ApprovedDriverGuard } from '../common/guards/approved-driver.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { PaginationDto } from '../common/dto/pagination.dto';
import { NIGERIAN_BANKS } from './banks';
import { PaymentsService } from './payments.service';

@UseInterceptors(IdempotencyInterceptor)
@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Get('banks')
  getBanks() {
    return NIGERIAN_BANKS;
  }

  @Post('webhook')
  async handleWebhook(
    @Headers('monnify-signature') signature: string,
    @Body() payload: any,
  ) {
    const rawBody = JSON.stringify(payload);

    this.paymentsService
      .processWebhook(rawBody, signature, payload)
      .catch((err) => console.error('Webhook processing error:', err));

    return { status: 'received' };
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  @Post('initiate/:tripId')
  initiatePayment(
    @Param('tripId') tripId: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.initiatePayment(tripId, user.sub);
  }

  @UseGuards(AuthGuard)
  @Get('status/:tripId')
  getPaymentStatus(
    @Param('tripId') tripId: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.getPaymentStatus(tripId, user.sub, user.role);
  }

  @UseGuards(AuthGuard, RolesGuard, ApprovedDriverGuard)
  @Roles(UserRole.DRIVER)
  @Get('wallet')
  getWallet(@CurrentUser() user: any) {
    return this.paymentsService.getWalletSummary(user.sub);
  }

  @UseGuards(AuthGuard, RolesGuard, ApprovedDriverGuard)
  @Roles(UserRole.DRIVER)
  @Post('sub-account/retry')
  retryOwnSubAccount(@CurrentUser() user: any) {
    return this.paymentsService.retryDriverSubAccount(user.sub);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('sub-account/retry/:driverId')
  retryDriverSubAccount(@Param('driverId') driverId: string) {
    return this.paymentsService.retryDriverSubAccount(driverId);
  }

  @UseGuards(AuthGuard)
  @Get('history')
  getHistory(
    @CurrentUser() user: any,
    @Query() pagination: PaginationDto,
  ) {
    return this.paymentsService.getPaymentHistory(user.sub, user.role, pagination);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('pending')
  getPending(@Query() pagination: PaginationDto) {
    return this.paymentsService.getPendingPayments(pagination);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('wallet/reset')
  resetWallets(@CurrentUser() user: any) {
    return this.paymentsService.resetWallets(user.sub);
  }
}
