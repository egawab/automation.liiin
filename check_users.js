const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({ select: { id: true, email: true } });
  console.log('\n=== All Users in DB ===');
  users.forEach(u => console.log(u.id, '|', u.email));

  const totals = await p.savedPost.groupBy({ by: ['userId'], _count: { _all: true } });
  console.log('\n=== Saved Posts per userId ===');
  totals.forEach(t => console.log(t.userId, ':', t._count._all, 'posts'));
  
  console.log('\n=== config.json userId ===');
  console.log('5a63d778-8de4-4967-948a-115853bf1b93');
  
  const match = users.find(u => u.id === '5a63d778-8de4-4967-948a-115853bf1b93');
  console.log('Match:', match || 'NO MATCH — wrong userId in config!');
}

main().then(() => p.$disconnect()).catch(e => { console.error(e.message); p.$disconnect(); });
