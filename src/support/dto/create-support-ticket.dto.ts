import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { SupportCategory } from '@prisma/client';
import { SanitizeText } from '../../common/utils/sanitize.util';

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
  @SanitizeText()
  firstMessage: string;

  @IsString()
  @IsOptional()
  @SanitizeText()
  recentFailureContext?: string;

  @IsISO8601()
  openedAt: string;
}

