import { IsInt, Max, Min } from 'class-validator';

export class RateTripDto {
  @IsInt()
  @Min(1)
  @Max(5)
  score: number;
}
