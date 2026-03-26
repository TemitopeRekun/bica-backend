import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Headers,
  Req,
  RawBodyRequest,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { NIGERIAN_BANKS } from './banks';
import { FastifyRequest } from 'fastify';

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  // ─── PUBLIC ───────────────────────────────────────────────────────

  // GET /payments/banks — no auth, used on registration screen
  @Get('banks')
  getBanks() {
    return NIGERIAN_BANKS;
  }

  // POST /payments/webhook — Monnify calls this, no JWT auth
  // Security handled inside service via signature verification
  @Post('webhook')
async handleWebhook(
  @Headers('monnify-signature') signature: string,
  @Body() payload: any,
) {
  const rawBody = JSON.stringify(payload);
    // Immediately return 200 per Monnify best practice
    // Processing happens after acknowledgement
    this.paymentsService
      .processWebhook(rawBody, signature, payload)
      .catch((err) => console.error('Webhook processing error:', err));

    return { status: 'received' };
  }

  // ─── PROTECTED ────────────────────────────────────────────────────

  // Owner initiates payment after trip completes
  // POST /payments/initiate/:tripId
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  @Post('initiate/:tripId')
  initiatePayment(
    @Param('tripId') tripId: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.initiatePayment(tripId, user.sub);
  }

  // Owner, driver, or admin checks the latest payment state for a trip
  // GET /payments/status/:tripId
  @UseGuards(AuthGuard)
  @Get('status/:tripId')
  getPaymentStatus(
    @Param('tripId') tripId: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.getPaymentStatus(tripId, user.sub, user.role);
  }

  // Driver views wallet summary and earnings
  // GET /payments/wallet
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.DRIVER)
  @Get('wallet')
  getWallet(@CurrentUser() user: any) {
    return this.paymentsService.getWalletSummary(user.sub);
  }

  // Any authenticated user views payment history
  // GET /payments/history
  @UseGuards(AuthGuard)
  @Get('history')
  getHistory(@CurrentUser() user: any) {
    return this.paymentsService.getPaymentHistory(user.sub, user.role);
  }

  // Admin views all pending payments
  // GET /payments/pending
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('pending')
  getPending() {
    return this.paymentsService.getPendingPayments();
  }

  // Admin triggers monthly wallet reset
  // POST /payments/wallet/reset
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('wallet/reset')
  resetWallets(@CurrentUser() user: any) {
    return this.paymentsService.resetWallets(user.sub);
  }
}
