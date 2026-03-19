const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'd6b82dea-9f52-400b-ab88-e757f7d66827';
  
  const logs = await prisma.log.findMany({
    where: { userId },
    orderBy: { timestamp: 'desc' },
    take: 10
  });

  console.log("=== DETAILED LOG AUDIT ===");
  logs.forEach(l => {
    console.log(`- [${l.timestamp}] Action: ${l.action} | Detail: ${l.postUrl}`);
    console.log(`  Comment Length: ${l.comment ? l.comment.length : 'NULL'}`);
    if (l.comment) {
        console.log(`  Comment Start: ${l.comment.substring(0, 50)}...`);
    }
  });
  console.log("==========================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
