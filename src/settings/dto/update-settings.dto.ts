import { IsNumber, IsBoolean, IsOptional, Min, Max, IsString } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseFare?: number;

  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'pricePerKm must be at least 1' })
  pricePerKm?: number;

  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'timeRate must be at least 1' })
  timeRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'commission must be between 1 and 100' })
  @Max(100, { message: 'commission cannot exceed 100%' })
  commission?: number;

  @IsOptional()
  @IsBoolean()
  autoApprove?: boolean;

  @IsOptional()
  @IsString()
  minAppVersion?: string;

  @IsOptional()
  @IsString()
  latestAppVersion?: string;

  @IsOptional()
  @IsNumber()
  @Min(100, { message: 'minimumFare must be at least ₦100' })
  minimumFare?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1, { message: 'minimumFareDistance must be at least 0.1km' })
  minimumFareDistance?: number;

  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'minimumFareDuration must be at least 1 minute' })
  minimumFareDuration?: number;
}