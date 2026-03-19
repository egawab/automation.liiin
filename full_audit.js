const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: {
      keywords: true,
      settings: true
    }
  });

  console.log("=== FULL DB AUDIT ===");
  console.log(`Total Users: ${users.length}`);
  
  users.forEach(u => {
    console.log(`- User: ${u.email} (ID: ${u.id})`);
    console.log(`  SystemActive: ${u.settings?.systemActive}`);
    console.log(`  Keywords (${u.keywords.length}): ${u.keywords.map(k => k.keyword).join(', ')}`);
  });
  console.log("=====================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
