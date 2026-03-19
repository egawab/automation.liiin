const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'd6b82dea-9f52-400b-ab88-e757f7d66827';
  
  const logs = await prisma.log.findMany({
    where: { userId },
    orderBy: { timestamp: 'desc' },
    take: 5
  });

  console.log("=== FORENSIC LOG CHECK ===");
  logs.forEach(l => {
    console.log(`- [${l.timestamp}] Action: ${l.action} | Detail: ${l.postUrl}`);
    if (l.comment) {
        console.log(`  Snippet: ${l.comment.substring(0, 500)}...`);
    }
  });
  console.log("===========================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
