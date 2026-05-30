-- Baseline migration: captures schema drift that was applied directly to the database
-- without going through Prisma migrations. Marked as applied via `prisma migrate resolve`.

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('PAYMENT_ISSUE', 'TRIP_PROBLEM', 'DRIVER_OWNER_COMPLAINT', 'TECHNICAL_ISSUE', 'OTHER');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELLED';

-- AlterTable: User
ALTER TABLE "User"
  DROP COLUMN IF EXISTS "rating",
  ADD COLUMN IF NOT EXISTS "ratingPoints" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS "ratingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "consecutiveFiveStars" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "suspensionTier" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "suspendedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "otpCode" TEXT,
  ADD COLUMN IF NOT EXISTS "otpExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastOtpSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- AlterTable: Trip
ALTER TABLE "Trip"
  ADD COLUMN IF NOT EXISTS "otp" TEXT,
  ADD COLUMN IF NOT EXISTS "otpAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "acceptanceImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "carFrontUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "carBackUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "carLeftUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "carRightUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentReference" TEXT;

-- CreateIndex on Trip.paymentReference
CREATE UNIQUE INDEX IF NOT EXISTS "Trip_paymentReference_key" ON "Trip"("paymentReference");

-- CreateTable: Rating
CREATE TABLE IF NOT EXISTS "Rating" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on Rating
CREATE UNIQUE INDEX IF NOT EXISTS "Rating_tripId_key" ON "Rating"("tripId");
CREATE INDEX IF NOT EXISTS "Rating_driverId_idx" ON "Rating"("driverId");
CREATE INDEX IF NOT EXISTS "Rating_ownerId_idx" ON "Rating"("ownerId");

-- AddForeignKey: Rating
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: RatingAuditLog
CREATE TABLE IF NOT EXISTS "RatingAuditLog" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "previousPoints" INTEGER NOT NULL,
  "newPoints" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL,
  "streakBefore" INTEGER NOT NULL,
  "streakAfter" INTEGER NOT NULL,
  "actionTriggered" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RatingAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on RatingAuditLog
CREATE INDEX IF NOT EXISTS "RatingAuditLog_driverId_idx" ON "RatingAuditLog"("driverId");
CREATE INDEX IF NOT EXISTS "RatingAuditLog_tripId_idx" ON "RatingAuditLog"("tripId");

-- AddForeignKey: RatingAuditLog
ALTER TABLE "RatingAuditLog" ADD CONSTRAINT "RatingAuditLog_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: SupportTicket
CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userName" TEXT NOT NULL,
  "userRole" "UserRole" NOT NULL,
  "category" "SupportCategory" NOT NULL,
  "tripId" TEXT,
  "paymentStatus" TEXT,
  "firstMessage" TEXT NOT NULL,
  "recentFailureContext" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on SupportTicket
CREATE INDEX IF NOT EXISTS "SupportTicket_userId_idx" ON "SupportTicket"("userId");
CREATE INDEX IF NOT EXISTS "SupportTicket_category_idx" ON "SupportTicket"("category");
CREATE INDEX IF NOT EXISTS "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- AddForeignKey: SupportTicket
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
