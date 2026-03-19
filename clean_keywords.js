const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = '67baea48-aa1e-41aa-a45b-ba694dfa9085';
  
  const deleted = await prisma.keyword.deleteMany({ where: { userId } });
  
  console.log("=== CLEAN SLATE SUCCESSFUL ===");
  console.log(`Deleted ${deleted.count} keywords.`);
  console.log("===============================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
