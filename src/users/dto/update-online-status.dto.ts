import { IsBoolean, IsNumber, Max, Min, ValidateIf } from 'class-validator';

export class UpdateOnlineStatusDto {
  @IsBoolean()
  isOnline: boolean;

  /**
   * Required when going ONLINE (isOnline: true).
   * Must be the driver's current live GPS latitude.
   */
  @ValidateIf((o) => o.isOnline === true)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  /**
   * Required when going ONLINE (isOnline: true).
   * Must be the driver's current live GPS longitude.
   */
  @ValidateIf((o) => o.isOnline === true)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}
