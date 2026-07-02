import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { TEST_DATABASE_URL } from './test-env';

export default async function globalSetup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';

  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const existing = await admin.$queryRaw<
      unknown[]
    >`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
