const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'd6b82dea-9f52-400b-ab88-e757f7d66827';
  
  const settings = await prisma.settings.findUnique({ where: { userId } });
  
  // Use correct field names from schema: savedAt for SavedPost, timestamp for Log
  const savedPosts = await prisma.savedPost.findMany({ 
    where: { userId },
    orderBy: { savedAt: 'desc' },
    take: 10
  });
  
  const logs = await prisma.log.findMany({
    where: { userId },
    orderBy: { timestamp: 'desc' },
    take: 10
  });

  console.log("=== EXTRACTION DIAGNOSTIC (FIXED) ===");
  console.log("User Settings:");
  console.log(` - Min Likes: ${settings?.minLikes}`);
  console.log(` - Min Comments: ${settings?.minComments}`);
  
  console.log(`\nRecent Saved Posts (${savedPosts.length}):`);
  savedPosts.forEach(p => {
    console.log(` - [${p.savedAt}] Post: ${p.postUrl} | Likes: ${p.likes} | Comments: ${p.comments}`);
  });

  console.log(`\nRecent Logs (${logs.length}):`);
  logs.forEach(l => {
    console.log(` - [${l.timestamp}] Action: ${l.action} | Detail: ${l.postUrl}`);
  });
  console.log("=====================================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
