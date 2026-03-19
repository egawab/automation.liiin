const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = '67baea48-aa1e-41aa-a45b-ba694dfa9085';
  
  const keywords = await prisma.keyword.findMany({ where: { userId } });
  
  console.log("=== KEYWORD AUDIT ===");
  console.log(`Total Keywords found: ${keywords.length}`);
  keywords.forEach((k, i) => {
    console.log(`${i+1}. Keyword: "${k.keyword}" | Active: ${k.active} | ID: ${k.id}`);
  });
  console.log("=====================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
