import {
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

  // Bank details — required for drivers
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