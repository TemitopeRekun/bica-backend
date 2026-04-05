import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { PaymentsService } from '../payments/payments.service';
import { AdminRealtimeGateway } from '../admin/admin-realtime.gateway';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { UserRole, ApprovalStatus } from '@prisma/client';
import { ForbiddenException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

describe('AuthService (Driver Approval Flow)', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwt: JwtService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockJwt = {
    signAsync: jest.fn().mockResolvedValue('test-token'),
  };

  const mockPayments = {
    createDriverSubAccount: jest.fn().mockResolvedValue({}),
  };

  const mockAdminRealtime = {
    notifyPendingDriver: jest.fn(),
  };

  const mockCloudinary = {
    uploadImage: jest.fn().mockResolvedValue('http://image.url'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: PaymentsService, useValue: mockPayments },
        { provide: AdminRealtimeGateway, useValue: mockAdminRealtime },
        { provide: CloudinaryService, useValue: mockCloudinary },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwt = module.get<JwtService>(JwtService);

    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should NOT issue a token for a new DRIVER and return a pending message', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'driver-123',
        email: 'driver@test.com',
        role: UserRole.DRIVER,
        approvalStatus: ApprovalStatus.PENDING,
        name: 'Test Driver',
        createdAt: new Date(),
      });

      const result = await service.register({
        email: 'driver@test.com',
        password: 'password',
        name: 'Test Driver',
        phone: '1234567890',
        role: UserRole.DRIVER,
        bankName: 'Bank',
        bankCode: '001',
        accountNumber: '123',
        accountName: 'Test Driver',
      } as any);

      expect(result.token).toBeUndefined();
      expect(result.message).toContain('pending admin approval');
      expect(mockAdminRealtime.notifyPendingDriver).toHaveBeenCalled();
    });

    it('should issue a token for a new OWNER immediately', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'owner-123',
        email: 'owner@test.com',
        role: UserRole.OWNER,
        approvalStatus: ApprovalStatus.APPROVED,
        name: 'Test Owner',
      });

      const result = await service.register({
        email: 'owner@test.com',
        password: 'password',
        name: 'Test Owner',
        phone: '1234567890',
        role: UserRole.OWNER,
      } as any);

      expect(result.token).toBe('test-token');
      expect(result.message).toBeUndefined();
    });
  });

  describe('login', () => {
    const passwordHash = bcrypt.hashSync('password', 10);

    it('should deny login for a PENDING driver', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'driver-123',
        email: 'driver@test.com',
        passwordHash,
        role: UserRole.DRIVER,
        approvalStatus: ApprovalStatus.PENDING,
        isBlocked: false,
      });

      await expect(service.login({
        email: 'driver@test.com',
        password: 'password',
      })).rejects.toThrow('pending admin approval');
    });

    it('should deny login for a REJECTED driver', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'driver-123',
        email: 'driver@test.com',
        passwordHash,
        role: UserRole.DRIVER,
        approvalStatus: ApprovalStatus.REJECTED,
        isBlocked: false,
      });

      await expect(service.login({
        email: 'driver@test.com',
        password: 'password',
      })).rejects.toThrow('rejected');
    });

    it('should allow login for an APPROVED driver', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'driver-123',
        email: 'driver@test.com',
        passwordHash,
        role: UserRole.DRIVER,
        approvalStatus: ApprovalStatus.APPROVED,
        isBlocked: false,
      });

      const result = await service.login({
        email: 'driver@test.com',
        password: 'password',
      });

      expect(result.token).toBe('test-token');
    });

    it('should deny login for a BLOCKED user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: 'user@test.com',
        passwordHash,
        role: UserRole.OWNER,
        isBlocked: true,
      });

      await expect(service.login({
        email: 'user@test.com',
        password: 'password',
      })).rejects.toThrow('suspended');
    });
  });

  describe('getMe', () => {
    it('should allow approved drivers', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'driver-123',
        role: UserRole.DRIVER,
        approvalStatus: ApprovalStatus.APPROVED,
      });

      const result = await service.getMe('driver-123');
      expect(result).toBeDefined();
    });

    it('should reject pending drivers in getMe', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'driver-123',
        role: UserRole.DRIVER,
        approvalStatus: ApprovalStatus.PENDING,
      });

      await expect(service.getMe('driver-123'))
        .rejects.toThrow('pending admin approval');
    });

    it('should reject rejected drivers in getMe', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'driver-123',
        role: UserRole.DRIVER,
        approvalStatus: ApprovalStatus.REJECTED,
      });

      await expect(service.getMe('driver-123'))
        .rejects.toThrow('rejected');
    });
  });
});
