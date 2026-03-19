const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = '67baea48-aa1e-41aa-a45b-ba694dfa9085';
  
  const updated = await prisma.settings.update({
    where: { userId },
    data: { systemActive: true }
  });

  console.log("=== FORCE START SUCCESSFUL ===");
  console.log("New System Active State:", updated.systemActive);
  console.log("===============================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
