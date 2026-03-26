import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

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

  // Bank details - required for drivers
  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankCode?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  accountName?: string;
}
