const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const posts = await prisma.savedPost.findMany({
    orderBy: { savedAt: 'desc' },
    take: 10
  });
  console.log(JSON.stringify(posts, null, 2));
}

run().catch(console.error).finally(() => prisma.$disconnect());
