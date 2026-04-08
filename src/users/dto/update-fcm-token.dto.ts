import { IsOptional, IsString } from 'class-validator';

export class UpdateFcmTokenDto {
  @IsString()
  token: string;

  @IsOptional()
  @IsString()
  deviceType?: string;
}
