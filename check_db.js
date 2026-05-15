const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.savedPost.count({ where: { userId: '5a63d778-8de4-4967-948a-115853bf1b93' } });
  console.log('Posts count for user:', count);
}
main().catch(console.error).finally(() => prisma.$disconnect());
