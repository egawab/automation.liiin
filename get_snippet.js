const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  const userId = 'd6b82dea-9f52-400b-ab88-e757f7d66827';
  
  const log = await prisma.log.findFirst({
    where: { userId, action: 'SEARCH', postUrl: 'ext-search:DEBUG_EMPTY_PAGE' },
    orderBy: { timestamp: 'desc' }
  });

  if (log && log.comment) {
      fs.writeFileSync('c:\\Users\\lenovo\\Downloads\\clonelink\\forensic_snippet.txt', log.comment);
      console.log("=== SNIPPET SAVED TO forensic_snippet.txt ===");
  } else {
      console.log("=== NO SNIPPET FOUND IN DB ===");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
