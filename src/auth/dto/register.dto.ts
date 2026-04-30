import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  IsNotIn,
} from 'class-validator';
import { UserRole } from '@prisma/client';

/**
 * Monnify does NOT support split payments/sub-accounts for these
 * Nigerian fintech / mobile-money bank codes.
 * Drivers using these banks cannot receive platform payouts.
 */
const UNSUPPORTED_BANK_CODES = [
  '999992', // OPay
  '100004', // OPay (alt)
  '999991', // PalmPay
  '100033', // PalmPay (alt)
  '999981', // Kuda Bank
  '50211',  // Kuda Bank (alt)
  '090267', // Kuda MFB
  '50515',  // Moniepoint MFB
  '566',    // VFD Microfinance Bank
];

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;

  // Owner fields
  @IsOptional()
  @IsString()
  carType?: string;

  @IsOptional()
  @IsString()
  carModel?: string;

  @IsOptional()
  @IsString()
  carYear?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  age?: string;

  // Driver fields
  @IsOptional()
  @IsString()
  nin?: string;

  @IsOptional()
  @IsString()
  transmission?: string;

  @IsOptional()
  @IsString()
  licenseImageUrl?: string;

  @IsOptional()
  @IsString()
  ninImageUrl?: string;

  @IsOptional()
  @IsString()
  selfieImageUrl?: string;

  @IsOptional()
  @IsBoolean()
  backgroundCheckAccepted?: boolean;

  // Aliases for frontend compatibility
  @IsOptional()
  @IsString()
  licenseImage?: string;

  @IsOptional()
  @IsString()
  selfieImage?: string;

  @IsOptional()
  @IsString()
  ninImage?: string;

  // Bank details - required for drivers
  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  @IsNotIn(UNSUPPORTED_BANK_CODES, {
    message:
      'This bank is not supported for driver payouts. Please use a commercial bank (GTBank, Access, Zenith, UBA, First Bank, etc.)',
  })
  bankCode?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  accountName?: string;
}
