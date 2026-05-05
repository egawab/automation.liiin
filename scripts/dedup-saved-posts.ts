/**
 * dedup-saved-posts.ts
 * One-shot script: for every (userId, postUrl) pair that has more than one row,
 * keep the "richest" row (longest preview, non-null likes) and delete the rest.
 *
 * Run with:
 *   npx ts-node --project tsconfig.json scripts/dedup-saved-posts.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find all (userId, postUrl) groups with more than one row
  const duplicateGroups = await prisma.$queryRaw<
    { userId: string; postUrl: string; count: bigint }[]
  >`
    SELECT "userId", "postUrl", COUNT(*) AS count
    FROM "SavedPost"
    GROUP BY "userId", "postUrl"
    HAVING COUNT(*) > 1
  `;

  console.log(`Found ${duplicateGroups.length} duplicate (userId, postUrl) groups.`);

  let totalDeleted = 0;

  for (const group of duplicateGroups) {
    const rows = await prisma.savedPost.findMany({
      where: { userId: group.userId, postUrl: group.postUrl },
      orderBy: { savedAt: 'asc' },
    });

    // Score each row: prefer longer preview and non-null likes
    const scored = rows.map(r => ({
      row: r,
      score:
        (r.postPreview ? r.postPreview.length : 0) +
        (r.postAuthor && r.postAuthor !== 'Unknown' ? 200 : 0) +
        (r.likes != null ? 100 : 0) +
        (r.comments != null ? 50 : 0),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Keep the highest-scoring row, delete all others
    const keep = scored[0].row;
    const deleteIds = scored.slice(1).map(s => s.row.id);

    await prisma.savedPost.deleteMany({ where: { id: { in: deleteIds } } });

    console.log(
      `  [${group.userId.slice(0, 8)}] "${group.postUrl.slice(-40)}" — kept id=${keep.id.slice(0, 8)}, deleted ${deleteIds.length}`
    );
    totalDeleted += deleteIds.length;
  }

  console.log(`\nDone. Deleted ${totalDeleted} duplicate rows total.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
