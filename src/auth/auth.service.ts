import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException, 
  Inject, 
  forwardRef,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole, ApprovalStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PaymentsService } from '../payments/payments.service';
import { AdminRealtimeGateway } from '../admin/admin-realtime.gateway';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { MailService } from '../common/mail.service';
import { ForgotPasswordDto, ResetPasswordDto, VerifyOtpDto } from './dto/otp.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
    private adminRealtimeGateway: AdminRealtimeGateway,
    private cloudinaryService: CloudinaryService,
    private mailService: MailService,
  ) { }

  async register(dto: RegisterDto) {
    // 1. Check if email already exists
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    if (dto.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Admin accounts cannot be created via public registration',
      );
    }

    if (dto.role === UserRole.DRIVER) {

      if (!dto.bankName || !dto.bankCode || !dto.accountNumber || !dto.accountName) {
        throw new BadRequestException(
          'Drivers must provide bank details: bankName, bankCode, accountNumber, accountName',
        );
      }
    }

    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    // 2. Hash the password — never store plain text
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // 3. Determine approval status
    // Drivers start as PENDING until admin approves
    // Owners are auto-approved
    const approvalStatus =
      dto.role === UserRole.DRIVER ? 'PENDING' : 'APPROVED';

    let licenseImageUrl: string | undefined;
    let ninImageUrl: string | undefined;
    let selfieImageUrl: string | undefined;

    if (dto.role === UserRole.DRIVER) {
      const driverId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

      if (dto.licenseImageUrl) {
        licenseImageUrl = await this.cloudinaryService.uploadImage(
          dto.licenseImageUrl,
          'bica/licenses',
          `license_${driverId}`,
        );
      }
      if (dto.ninImageUrl) {
        ninImageUrl = await this.cloudinaryService.uploadImage(
          dto.ninImageUrl,
          'bica/nin',
          `nin_${driverId}`,
        );
      }
      if (dto.selfieImageUrl) {
        selfieImageUrl = await this.cloudinaryService.uploadImage(
          dto.selfieImageUrl,
          'bica/selfies',
          `selfie_${driverId}`,
        );
      }
    }

    // 5. Generate OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    // 6. Create the user
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: dto.role,
        approvalStatus,
        carType: dto.carType,
        carModel: dto.carModel,
        carYear: dto.carYear,
        gender: dto.gender,
        address: dto.address,
        nationality: dto.nationality,
        age: dto.age,
        nin: dto.nin,
        transmission: dto.transmission,
        licenseImageUrl,
        ninImageUrl,
        selfieImageUrl,
        backgroundCheckAccepted: dto.backgroundCheckAccepted,
        bankName: dto.bankName,
        bankCode: dto.bankCode,
        accountNumber: dto.accountNumber,
        accountName: dto.accountName,
        otpCode,
        otpExpiresAt,
        isEmailVerified: false,
      },
    });

    // 7. Send Verification Email
    await this.mailService.sendVerificationOtp(user.email, user.name, otpCode);

    if (dto.role === UserRole.DRIVER) {
      setImmediate(() => {
        this.paymentsService.createDriverSubAccount(user.id);
      });
      
      this.adminRealtimeGateway.notifyPendingDriver({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        approvalStatus: user.approvalStatus as ApprovalStatus,
        createdAt: user.createdAt,
      });
    }

    return {
      message: 'Registration successful! Please check your email for verification code.',
      email: user.email,
      isEmailVerified: false,
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

    // 3. Check if email is verified
    if (!user.isEmailVerified) {
      throw new ForbiddenException('Email not verified. Please verify your email to continue.');
    }

    // 3. Compare password against stored hash
    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 4. Check driver approval status
    if (user.role === UserRole.DRIVER) {
      if (user.approvalStatus === ApprovalStatus.PENDING) {
        throw new ForbiddenException('Your driver account is pending admin approval.');
      }
      if (user.approvalStatus === ApprovalStatus.REJECTED) {
        throw new ForbiddenException('Your driver application was rejected. Please contact support.');
      }
      if (user.approvalStatus !== ApprovalStatus.APPROVED) {
        throw new ForbiddenException('Access denied. Driver account not approved.');
      }
    }

    // 5. Issue JWT token
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

    // Extra safety check for drivers
    if (user.role === UserRole.DRIVER) {
      if (user.approvalStatus === ApprovalStatus.PENDING) {
        throw new ForbiddenException('Your driver account is pending admin approval.');
      }
      if (user.approvalStatus === ApprovalStatus.REJECTED) {
        throw new ForbiddenException('Your driver application was rejected. Please contact support.');
      }
      if (user.approvalStatus !== ApprovalStatus.APPROVED) {
        throw new ForbiddenException('Access denied. Driver account not approved.');
      }
    }

    return this.sanitizeUser(user);
  }

  /**
   * 🛡️ Secure Logout
   * Clears FCM token and online status to prevent data leakage between users on the same device.
   */
  async logout(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        fcmToken: null,
        isOnline: false,
        locationLat: null,
        locationLng: null,
      },
    });
  }

  /**
   * 🛡️ OTP Verification
   * Validates the 6-digit code and unlocks the account.
   */
  async verifyEmail(dto: VerifyOtpDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) throw new NotFoundException('User not found');
    if (user.isEmailVerified) return { message: 'Email already verified', success: true };

    // 1. Check Expiry FIRST (before comparing the code)
    if (!user.otpCode || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      // Clear the expired code so the user cannot retry it
      if (user.otpCode) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { otpCode: null, otpAttempts: 0 },
        });
      }
      throw new BadRequestException('Verification code has expired. Please request a new one.');
    }

    // 2. Check if OTP matches
    if (user.otpCode !== dto.otp) {
      const attempts = (user.otpAttempts || 0) + 1;

      if (attempts >= 5) {
        // Invalidate OTP after 5 failed attempts (Brute-force protection)
        await this.prisma.user.update({
          where: { id: user.id },
          data: { otpCode: null, otpAttempts: 0 },
        });
        throw new BadRequestException('Too many failed attempts. Please request a new code.');
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpAttempts: attempts },
      });

      throw new BadRequestException(`Invalid verification code. ${5 - attempts} attempt(s) remaining.`);
    }

    // 3. Success -> Unlock account
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      },
    });

    const token = await this.signToken(user.id, user.email, user.role);
    // Return sanitized user with corrected isEmailVerified flag
    const sanitized = this.sanitizeUser({ ...user, isEmailVerified: true });
    return {
      message: 'Email verified successfully!',
      token,
      user: sanitized,
    };
  }

  async resendOtp(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    // Guard: do not resend to already-verified accounts
    if (user.isEmailVerified) {
      throw new BadRequestException('This account is already verified. Please log in.');
    }

    // Rate Limit Check (60 seconds)
    if (user.lastOtpSentAt && (Date.now() - user.lastOtpSentAt.getTime() < 60000)) {
      throw new BadRequestException('Please wait 60 seconds before requesting a new code.');
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode,
        otpExpiresAt,
        otpAttempts: 0,
        lastOtpSentAt: new Date(),
      },
    });

    await this.mailService.sendVerificationOtp(user.email, user.name, otpCode);
    return { message: 'A new verification code has been sent to your email.' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      // Security: Don't reveal if email exists
      return { message: 'If an account exists with this email, a reset code has been sent.' };
    }

    // Rate Limit Check (60 seconds) — prevents inbox flooding and Resend quota abuse
    if (user.lastOtpSentAt && (Date.now() - user.lastOtpSentAt.getTime() < 60000)) {
      // Return the same message to avoid timing attacks revealing account existence
      return { message: 'If an account exists with this email, a reset code has been sent.' };
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode,
        otpExpiresAt,
        otpAttempts: 0,
        lastOtpSentAt: new Date(),
      },
    });

    await this.mailService.sendPasswordResetOtp(user.email, user.name, otpCode);
    return { message: 'If an account exists with this email, a reset code has been sent.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new NotFoundException('User not found');

    // 1. Check Expiry FIRST
    if (!user.otpCode || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      throw new BadRequestException('Reset code has expired. Please request a new one.');
    }

    // 2. Validate OTP with brute-force protection
    if (user.otpCode !== dto.otp) {
      const attempts = (user.otpAttempts || 0) + 1;

      if (attempts >= 5) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { otpCode: null, otpAttempts: 0 },
        });
        throw new BadRequestException('Too many failed attempts. Please request a new reset code.');
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: { otpAttempts: attempts },
      });

      throw new BadRequestException(`Invalid reset code. ${5 - attempts} attempt(s) remaining.`);
    }

    // 3. Update Password
    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      },
    });

    return { message: 'Password updated successfully. You can now log in.' };
  }

  // Signs a JWT token with the user's id, email and role embedded
  private async signToken(id: string, email: string, role: UserRole) {
    const payload = { sub: id, email, role };

    return this.jwt.signAsync(payload);
  }

  // Removes passwordHash before sending user data to frontend
  private sanitizeUser(user: any) {
    const { passwordHash, otpCode, otpExpiresAt, otpAttempts, lastOtpSentAt, ...rest } = user;
    return rest;
  }
}

