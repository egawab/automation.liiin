const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const latestKeywords = await prisma.keyword.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { user: { select: { email: true, id: true } } }
  });

  console.log("=== LATEST KEYWORDS ===");
  latestKeywords.forEach(k => {
    console.log(`- Keyword: "${k.keyword}" | User: ${k.user.email} (ID: ${k.user.id}) | Created: ${k.createdAt}`);
  });
  console.log("=======================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
