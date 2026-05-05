import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';

export enum PaymentSummaryPeriod {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export class GetPaymentsSummaryDto {
  @IsEnum(PaymentSummaryPeriod)
  @IsOptional()
  period?: PaymentSummaryPeriod = PaymentSummaryPeriod.DAILY;

  @IsISO8601()
  @IsOptional()
  from?: string;

  @IsISO8601()
  @IsOptional()
  to?: string;

  @IsString()
  @IsOptional()
  timezone?: string = 'UTC';
}
