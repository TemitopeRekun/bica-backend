import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminRealtimeGateway } from './admin-realtime.gateway';
import { PaymentsService } from '../payments/payments.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: PrismaService;

  const mockPrisma = {
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
    trip: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    payout: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockAdminRealtime = {
    notifyUserUpdated: jest.fn(),
  };

  const mockPaymentsService = {
    createDriverSubAccount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AdminRealtimeGateway, useValue: mockAdminRealtime },
        { provide: PaymentsService, useValue: mockPaymentsService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('getUsers', () => {
    it('should return users with enriched payout status', async () => {
      const mockUsers = [
        {
          id: 'driver-1',
          role: 'DRIVER',
          bankCode: '001',
          accountNumber: '12345',
          monnifySubAccountCode: 'SUB-1',
        },
        {
          id: 'driver-2', // No sub account, but has bank details
          role: 'DRIVER',
          bankCode: '001',
          accountNumber: '67890',
          monnifySubAccountCode: null,
        },
        {
          id: 'driver-3', // No bank details
          role: 'DRIVER',
          bankCode: null,
          accountNumber: null,
          monnifySubAccountCode: null,
        },
      ];

      mockPrisma.user.findMany.mockResolvedValue(mockUsers);
      mockPrisma.user.count.mockResolvedValue(3);

      const result = await service.getUsers({ page: 1, limit: 10, skip: 0, take: 10 });

      expect(result.items).toHaveLength(3);
      
      // Driver 1: active sub account
      expect(result.items[0].subAccountActive).toBe(true);
      expect(result.items[0].canRetrySubAccountSetup).toBe(false);

      // Driver 2: can retry
      expect(result.items[1].subAccountActive).toBe(false);
      expect(result.items[1].canRetrySubAccountSetup).toBe(true);

      // Driver 3: cannot retry (no bank details)
      expect(result.items[2].subAccountActive).toBe(false);
      expect(result.items[2].canRetrySubAccountSetup).toBe(false);
    });
  });

  describe('getDashboard', () => {
    it('should return mapped users in dashboard overview', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'driver-1', monnifySubAccountCode: 'SUB-1' }
      ]);
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.trip.findMany.mockResolvedValue([]);
      mockPrisma.trip.count.mockResolvedValue(0);
      mockPrisma.payout.findMany.mockResolvedValue([]);
      mockPrisma.payout.count.mockResolvedValue(0);
      mockPrisma.systemSettings.findUnique.mockResolvedValue({ id: 1 });
      mockPrisma.trip.aggregate.mockResolvedValue({ _sum: { commissionAmount: 0 } });

      const result = await service.getDashboard();

      expect(result.users[0].subAccountActive).toBe(true);
    });
  });
});
