import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException, Inject, forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PaymentsService } from '../payments/payments.service';


@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
  ) {}

  async register(dto: RegisterDto) {
    // 1. Check if email already exists
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    if (dto.role === UserRole.DRIVER) {

      if (!dto.bankName || !dto.bankCode || !dto.accountNumber || !dto.accountName) {
       throw new BadRequestException(
      'Drivers must provide bank details: bankName, bankCode, accountNumber, accountName',
       );
    }
}

    // 2. Hash the password — never store plain text
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // 3. Determine approval status
    // Drivers start as PENDING until admin approves
    // Owners are auto-approved
    const approvalStatus =
      dto.role === UserRole.DRIVER ? 'PENDING' : 'APPROVED';

    // 4. Create the user
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: dto.role,
        approvalStatus,
        carType: dto.carType,
        gender: dto.gender,
        address: dto.address,
        nationality: dto.nationality,
        age: dto.age,
        nin: dto.nin,
        transmission: dto.transmission,
        bankName: dto.bankName,
        bankCode: dto.bankCode,
        accountNumber: dto.accountNumber,
        accountName: dto.accountName,
      },
    });

    // 5. Issue JWT token immediately after registration
    const token = await this.signToken(user.id, user.email, user.role);

    if (dto.role === UserRole.DRIVER) {
  setImmediate(() => {
    this.paymentsService
      .createDriverSubAccount(user.id)
      .catch((err) =>
        console.error('Sub account creation failed:', err),
      );
  });
}

    // 6. Return token and user (never return passwordHash)
    return {
      token,
      user: this.sanitizeUser(user),
    };


  }

  async login(dto: LoginDto) {
    // 1. Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      // Deliberately vague — don't tell attacker if email exists
      throw new UnauthorizedException('Invalid credentials');
    }

    // 2. Check if account is blocked
    if (user.isBlocked) {
      throw new UnauthorizedException(
        'Account suspended. Please contact support.',
      );
    }

    // 3. Compare password against stored hash
    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 4. Issue JWT token
    const token = await this.signToken(user.id, user.email, user.role);

    return {
      token,
      user: this.sanitizeUser(user),
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.sanitizeUser(user);
  }

  // Signs a JWT token with the user's id, email and role embedded
  private async signToken(id: string, email: string, role: UserRole) {
  const payload = { sub: id, email, role };

  return this.jwt.signAsync(payload);
  }

  // Removes passwordHash before sending user data to frontend
  private sanitizeUser(user: any) {
    const { passwordHash, ...rest } = user;
    return rest;
  }

  
}