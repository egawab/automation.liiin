const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const USER_ID = 'ec0bb423-3c0f-4611-9167-01874a76b93c';

async function main() {
  // Check latest 20 posts saved for this user
  const posts = await p.savedPost.findMany({
    where: { userId: USER_ID },
    orderBy: { savedAt: 'desc' },
    take: 20,
    select: { canonicalUrn: true, keyword: true, postAuthor: true, likes: true, comments: true, savedAt: true, postPreview: true }
  });

  console.log('\n=== Latest 20 posts in DB for ec0bb423 (egawab) ===');
  console.log('Total found:', posts.length);
  posts.forEach(p => {
    console.log(`  [${p.savedAt.toISOString().substring(11,19)}] keyword=${p.keyword} | ${p.canonicalUrn} | likes=${p.likes} | author=${p.postAuthor}`);
  });

  // Check posts saved in last 30 minutes
  const since = new Date(Date.now() - 30 * 60 * 1000);
  const recent = await p.savedPost.findMany({
    where: { userId: USER_ID, savedAt: { gte: since } },
    select: { canonicalUrn: true, keyword: true, savedAt: true }
  });
  console.log(`\n=== Posts saved in last 30 min ===`);
  console.log('Count:', recent.length);
  recent.forEach(r => console.log('  ', r.keyword, r.canonicalUrn, r.savedAt));

  // Count per keyword
  const byKeyword = await p.savedPost.groupBy({
    by: ['keyword'],
    where: { userId: USER_ID },
    _count: { _all: true },
    orderBy: { _count: { _all: 'desc' } }
  });
  console.log('\n=== All keyword groups for this user ===');
  byKeyword.forEach(k => console.log(' ', k.keyword, ':', k._count._all, 'posts'));
}

main().then(() => p.$disconnect()).catch(e => { console.error(e.message); p.$disconnect(); });
