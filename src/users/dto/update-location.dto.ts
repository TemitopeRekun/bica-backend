import { IsOptional, IsNumber, Min, Max } from 'class-validator';

export class UpdateLocationDto {
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number | null;
}