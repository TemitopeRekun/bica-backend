import { IsNumber, IsBoolean, IsOptional, Min, Max } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseFare?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerKm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  timeRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  commission?: number;

  @IsOptional()
  @IsBoolean()
  autoApprove?: boolean;
}