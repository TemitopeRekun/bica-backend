import { IsEnum, IsString, IsOptional } from 'class-validator';
import { TripStatus } from '@prisma/client';

export class UpdateStatusDto {
  @IsEnum(TripStatus)
  status: TripStatus;

  @IsString()
  @IsOptional()
  otp?: string;

  @IsString()
  @IsOptional()
  carFrontUrl?: string;

  @IsString()
  @IsOptional()
  carBackUrl?: string;

  @IsString()
  @IsOptional()
  carLeftUrl?: string;

  @IsString()
  @IsOptional()
  carRightUrl?: string;
}

export class AcceptRideDto {
  @IsString()
  acceptanceImageUrl: string;
}