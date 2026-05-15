const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const SCRAPER_USER_ID = '5a63d778-8de4-4967-948a-115853bf1b93';

async function main() {
  // Check posts saved by scraper userId
  const posts = await p.savedPost.findMany({
    where: { userId: SCRAPER_USER_ID },
    select: { id: true, canonicalUrn: true, postAuthor: true, keyword: true, savedAt: true, likes: true, comments: true, postPreview: true },
    orderBy: { savedAt: 'desc' },
    take: 20
  });
  console.log('\n=== Posts in DB for scraper userId ===');
  console.log('Total:', posts.length);
  posts.forEach(r => {
    console.log(' -', r.keyword, '|', r.canonicalUrn);
    console.log('   author:', r.postAuthor, '| likes:', String(r.likes), '| comments:', String(r.comments));
    console.log('   preview:', (r.postPreview || '').substring(0, 80));
  });

  // Check which user account this userId belongs to
  const user = await p.user.findUnique({
    where: { id: SCRAPER_USER_ID },
    select: { id: true, email: true, name: true }
  }).catch(() => null);
  console.log('\n=== User account for scraper userId ===');
  console.log(user || 'NOT FOUND — userId in config.json does not match any user!');

  // List ALL users in the system
  const allUsers = await p.user.findMany({ select: { id: true, email: true } });
  console.log('\n=== All users in DB ===');
  allUsers.forEach(u => console.log(' -', u.id, '|', u.email));

  // Total posts per user
  const totals = await p.savedPost.groupBy({ by: ['userId'], _count: { _all: true } });
  console.log('\n=== Total saved posts per userId ===');
  totals.forEach(t => console.log(' -', t.userId, ':', t._count._all, 'posts'));
}

main().then(() => p.$disconnect()).catch(e => { console.error(e); p.$disconnect(); });
