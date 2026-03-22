-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "estimatedMins" DOUBLE PRECISION,
ADD COLUMN     "finalFare" DOUBLE PRECISION,
ADD COLUMN     "startedAt" TIMESTAMP(3);
