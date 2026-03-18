import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      baseFare: 500,
      pricePerKm: 100,
      timeRate: 50,
      commission: 25,
      autoApprove: false,
    },
  });

  console.log('SystemSettings seeded');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());