import { PrismaClient } from '@prisma/client';

// ── Neon serverless connection config ─────────────────────────────────────────
// Add connect_timeout to the connection URL so Prisma waits up to 15s for
// Neon's auto-suspended database to wake up before throwing P1001/P1002.
function buildDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ CRITICAL: DATABASE_URL is not set in environment variables!');
    return url;
  }
  try {
    const parsed = new URL(url);
    // Only add connect_timeout if not already set
    if (!parsed.searchParams.has('connect_timeout')) {
      parsed.searchParams.set('connect_timeout', '15');
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '15');
    }
    return parsed.toString();
  } catch {
    // Unparseable URL — return as-is and let Prisma error naturally
    return url;
  }
}

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: buildDatabaseUrl(),
      },
    },
  });
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
