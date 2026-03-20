import {
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  Min,
  Max,
} from 'class-validator';

export class CreateRideDto {
  // Pickup
  @IsString()
  pickupAddress: string;

  @IsNumber()
  @Min(-90) @Max(90)
  pickupLat: number;

  @IsNumber()
  @Min(-180) @Max(180)
  pickupLng: number;

  // Destination
  @IsString()
  destAddress: string;

  @IsNumber()
  @Min(-90) @Max(90)
  destLat: number;

  @IsNumber()
  @Min(-180) @Max(180)
  destLng: number;

  // Distance in km — calculated on frontend, verified on backend
  @IsNumber()
  @Min(0)
  distanceKm: number;

  // Optional — only for scheduled rides
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  // Vehicle details from the frontend modal
  @IsOptional()
  @IsString()
  vehicleMake?: string;

  @IsOptional()
  @IsString()
  vehicleModel?: string;

  @IsOptional()
  @IsString()
  vehicleYear?: string;

  @IsOptional()
  @IsString()
  transmission?: string;
}