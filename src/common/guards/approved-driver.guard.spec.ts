import { Test, TestingModule } from '@nestjs/testing';
import { ApprovedDriverGuard } from './approved-driver.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole, ApprovalStatus } from '@prisma/client';

describe('ApprovedDriverGuard', () => {
  let guard: ApprovedDriverGuard;
  let prisma: PrismaService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovedDriverGuard,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    guard = module.get<ApprovedDriverGuard>(ApprovedDriverGuard);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should allow non-driver roles', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: 'owner-1', role: UserRole.OWNER } }),
      }),
    } as any;

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should allow approved drivers', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: 'driver-1', role: UserRole.DRIVER } }),
      }),
    } as any;

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'driver-1',
      approvalStatus: ApprovalStatus.APPROVED,
      isBlocked: false,
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should deny pending drivers', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: 'driver-1', role: UserRole.DRIVER } }),
      }),
    } as any;

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'driver-1',
      approvalStatus: ApprovalStatus.PENDING,
      isBlocked: false,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should deny rejected drivers', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: 'driver-1', role: UserRole.DRIVER } }),
      }),
    } as any;

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'driver-1',
      approvalStatus: ApprovalStatus.REJECTED,
      isBlocked: false,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should deny blocked drivers', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { sub: 'driver-1', role: UserRole.DRIVER } }),
      }),
    } as any;

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'driver-1',
      approvalStatus: ApprovalStatus.APPROVED,
      isBlocked: true,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should throw UnauthorizedException if no user in request', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: null }),
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
