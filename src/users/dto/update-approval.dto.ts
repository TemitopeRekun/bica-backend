import { IsEnum } from 'class-validator';
import { ApprovalStatus } from '@prisma/client';

export class UpdateApprovalDto {
  @IsEnum(ApprovalStatus)
  approvalStatus: ApprovalStatus;
}