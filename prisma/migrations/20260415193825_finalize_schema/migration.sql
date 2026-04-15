-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "latestAppVersion" TEXT NOT NULL DEFAULT '1.0.0',
ADD COLUMN     "minAppVersion" TEXT NOT NULL DEFAULT '1.0.0',
ADD COLUMN     "minimumFare" DOUBLE PRECISION NOT NULL DEFAULT 2000,
ADD COLUMN     "minimumFareDistance" DOUBLE PRECISION NOT NULL DEFAULT 4.5,
ADD COLUMN     "minimumFareDuration" DOUBLE PRECISION NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "baseFareSnapshot" DOUBLE PRECISION,
ADD COLUMN     "minimumFareDurationSnapshot" DOUBLE PRECISION,
ADD COLUMN     "minimumFareSnapshot" DOUBLE PRECISION,
ADD COLUMN     "pricePerKmSnapshot" DOUBLE PRECISION,
ADD COLUMN     "timeRateSnapshot" DOUBLE PRECISION;
