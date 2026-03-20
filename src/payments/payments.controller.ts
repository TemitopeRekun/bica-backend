import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { NIGERIAN_BANKS } from './banks';



@Controller('payments')
export class PaymentsController {
    constructor(private paymentsService: PaymentsService) {}

    @Get('banks')
    getBanks() {
      return NIGERIAN_BANKS;
    }
    
    // Driver requests a payout
    // POST /payments/payout
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  @Post('payout')
  requestPayout(
    @CurrentUser() user: any,
    @Body() dto: RequestPayoutDto,
  ) {
    return this.paymentsService.requestPayout(user.sub, dto);
  }

  // Driver views their wallet summary + payout history
  // GET /payments/wallet
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  @Get('wallet')
  getWallet(@CurrentUser() user: any) {
    return this.paymentsService.getWalletSummary(user.sub);
  }

  // Driver views their own payouts
  // GET /payments/my-payouts
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  @Get('my-payouts')
  getMyPayouts(@CurrentUser() user: any) {
    return this.paymentsService.findMyPayouts(user.sub);
  }

  // Admin views all payouts, optionally filtered by status
  // GET /payments/payouts
  // GET /payments/payouts?status=PENDING
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('payouts')
  findAll(@Query('status') status?: 'PENDING' | 'PAID') {
    return this.paymentsService.findAll(status);
  }

  // Admin approves a payout
  // PATCH /payments/payouts/:id/approve
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('payouts/:id/approve')
  approvePayout(@Param('id') id: string) {
    return this.paymentsService.approvePayout(id);
  }

  // Admin rejects a payout — refunds wallet
  // DELETE /payments/payouts/:id/reject
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete('payouts/:id/reject')
  rejectPayout(@Param('id') id: string) {
    return this.paymentsService.rejectPayout(id);
  }
}