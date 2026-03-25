import {
  IsString,
  IsNumber,
  IsOptional,
  IsNotEmpty,
  IsDateString,
  Min,
  Max,
} from 'class-validator';

export class CreateRideDto {
  @IsString()
  pickupAddress: string;

  @IsNumber()
  @Min(-90) @Max(90)
  pickupLat: number;

  @IsNumber()
  @Min(-180) @Max(180)
  pickupLng: number;

  @IsString()
  destAddress: string;

  @IsNumber()
  @Min(-90) @Max(90)
  destLat: number;

  @IsNumber()
  @Min(-180) @Max(180)
  destLng: number;

  @IsNumber()
  @Min(0)
  distanceKm: number;

  // From Google Distance Matrix — stored for surcharge calculation
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedMins?: number;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  transmission?: string;

  // Driver selected by owner from the list
  @IsString()
  @IsNotEmpty()
  driverId: string;
}
