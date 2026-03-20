import { IsNumber, IsString, IsOptional, Min } from 'class-validator';

export class RequestPayoutDto {
  @IsNumber()
  @Min(5000)
  amount: number;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;
}