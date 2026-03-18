import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

console.log('DATABASE_URL:', process.env['DATABASE_URL']);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: env('DATABASE_URL') },
});
