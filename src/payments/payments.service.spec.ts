import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { MonnifyService } from './monnify.service';
import { ConfigService } from '@nestjs/config';
import { AdminRealtimeGateway } from '../admin/admin-realtime.gateway';
import { RidesGateway } from '../rides/rides.gateway';
import { UserRole } from '@prisma/client';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: PrismaService;
  let monnify: MonnifyService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    trip: {
      findUnique: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    paymentRecord: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockMonnify = {
    createSubAccount: jest.fn(),
    findSubAccountByBankDetails: jest.fn(),
    initiateTransaction: jest.fn(),
    verifyTransaction: jest.fn(),
    verifyWebhookSignature: jest.fn(),
  };

  const mockAdminRealtime = {
    notifyPaymentUpdated: jest.fn(),
  };

  const mockRides = {
    notifyOwnerPaymentUpdated: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MonnifyService, useValue: mockMonnify },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: AdminRealtimeGateway, useValue: mockAdminRealtime },
        { provide: RidesGateway, useValue: mockRides },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    prisma = module.get<PrismaService>(PrismaService);
    monnify = module.get<MonnifyService>(MonnifyService);

    jest.clearAllMocks();
  });

  describe('retryDriverSubAccount', () => {
    it('should return enriched response shape for admin retry', async () => {
      const mockDriver = {
        id: 'driver-123',
        name: 'Test Driver',
        email: 'test@driver.com',
        role: UserRole.DRIVER,
        bankName: 'Bank',
        bankCode: '001',
        accountNumber: '12345',
        monnifySubAccountCode: null,
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockDriver);
      mockMonnify.createSubAccount.mockResolvedValue('NEW-SUB-CODE');
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.retryDriverSubAccount('driver-123');

      expect(result).toEqual({
        driverId: 'driver-123',
        subAccountCode: 'NEW-SUB-CODE',
        status: 'created',
        subAccountActive: true,
        message: 'Sub account created successfully.',
      });
    });

    it('should handle already configured sub accounts', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'driver-123',
        role: UserRole.DRIVER,
        monnifySubAccountCode: 'SUB-CODE',
      });

      const result = await service.retryDriverSubAccount('driver-123');

      expect(result.status).toBe('already_configured');
      expect(result.subAccountActive).toBe(true);
      expect(result.message).toContain('already configured');
    });
  });
});
