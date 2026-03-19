const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = '67baea48-aa1e-41aa-a45b-ba694dfa9085';
  
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const settings = await prisma.settings.findUnique({ where: { userId } });
  const keywords = await prisma.keyword.findMany({ where: { userId, active: true } });

  console.log("=== DIAGNOSTIC REPORT ===");
  console.log("User Exists:", !!user);
  if (user) console.log("User Email:", user.email);
  
  console.log("Settings Found:", !!settings);
  if (settings) {
    console.log("System Active (DB):", settings.systemActive);
    console.log("Min Likes:", settings.minLikes);
  }
  
  console.log("Active Keywords Count:", keywords.length);
  keywords.forEach(k => console.log(` - Keyword: ${k.keyword}`));
  console.log("=========================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
