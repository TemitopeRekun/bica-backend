import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { SupportCategory } from '@prisma/client';

export class CreateSupportTicketDto {
  @IsEnum(SupportCategory)
  category: SupportCategory;

  @IsUUID()
  @IsOptional()
  tripId?: string;

  @IsString()
  @IsOptional()
  paymentStatus?: string;

  @IsString()
  @IsNotEmpty()
  firstMessage: string;

  @IsString()
  @IsOptional()
  recentFailureContext?: string;

  @IsISO8601()
  openedAt: string;
}
