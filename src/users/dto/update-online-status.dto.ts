import { IsBoolean, IsNumber, IsOptional, ValidateIf } from 'class-validator';

export class UpdateOnlineStatusDto {
  @IsBoolean()
  isOnline: boolean;

  /**
   * Required when going ONLINE (isOnline: true).
   * Must be the driver's current live GPS latitude.
   */
  @ValidateIf((o) => o.isOnline === true)
  @IsNumber()
  lat: number;

  /**
   * Required when going ONLINE (isOnline: true).
   * Must be the driver's current live GPS longitude.
   */
  @ValidateIf((o) => o.isOnline === true)
  @IsNumber()
  lng: number;
}
