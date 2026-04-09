import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import 'dotenv/config';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  const adminName = process.env.ADMIN_NAME?.trim() || 'Bica Admin';
  const adminPhone = process.env.ADMIN_PHONE?.trim() || '0000000000';

  if (!adminEmail || !adminPassword) {
    throw new Error(
      'Missing ADMIN_EMAIL or ADMIN_PASSWORD in environment variables.',
    );
  }

  await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: {
      minimumFare: 2000,
      minimumFareDistance: 4.5,
      minimumFareDuration: 20,
    },
    create: {
      id: 1,
      baseFare: 500,
      pricePerKm: 100,
      timeRate: 50,
      commission: 25,
      autoApprove: false,
      minimumFare: 2000,
      minimumFareDistance: 4.5,
      minimumFareDuration: 20,
    },
  });

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: adminName,
      phone: adminPhone,
      passwordHash,
      role: 'ADMIN',
      approvalStatus: 'APPROVED',
      isBlocked: false,
    },
    create: {
      name: adminName,
      email: adminEmail,
      phone: adminPhone,
      passwordHash,
      role: 'ADMIN',
      approvalStatus: 'APPROVED',
      isBlocked: false,
    },
  });

  console.log('SystemSettings seeded');
  console.log(`Admin seeded: ${adminEmail}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
