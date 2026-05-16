import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole, ApprovalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApprovedDriverGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Only enforce for DRIVER role
    if (user.role !== UserRole.DRIVER) {
      return true;
    }

    // Fetch the latest user status from DB to be safe against old tokens
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { approvalStatus: true, isBlocked: true, suspendedUntil: true, suspensionTier: true },
    });

    if (!dbUser) {
      throw new UnauthorizedException('User no longer exists');
    }

    if (dbUser.isBlocked) {
      if (dbUser.suspendedUntil) {
        if (dbUser.suspendedUntil <= new Date()) {
          if (dbUser.suspensionTier === 1) {
            // Auto-lift Tier 1
            await this.prisma.user.update({
              where: { id: user.sub },
              data: { isBlocked: false, suspendedUntil: null }
            });
          } else {
            // Tier 2 -> Admin gate
            throw new ForbiddenException('Your 1-month suspension has ended. Your account is pending admin review before reinstatement. Contact support.');
          }
        } else {
          throw new ForbiddenException(`Your account is suspended until ${dbUser.suspendedUntil.toLocaleString()}. Contact support@bicadriver.com if you believe this is in error.`);
        }
      } else {
        throw new ForbiddenException('Your account is blocked. Please contact support.');
      }
    }

    if (dbUser.approvalStatus === ApprovalStatus.PENDING) {
      throw new ForbiddenException('Your driver account is pending admin approval.');
    }

    if (dbUser.approvalStatus === ApprovalStatus.REJECTED) {
      throw new ForbiddenException('Your driver application was rejected. Please contact support.');
    }

    if (dbUser.approvalStatus !== ApprovalStatus.APPROVED) {
      throw new ForbiddenException('Access denied. Driver account not approved.');
    }

    return true;
  }
}
