const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const USER_ID = '5a63d778-8de4-4967-948a-115853bf1b93';

async function main() {
  const current = await p.settings.findUnique({
    where: { userId: USER_ID },
    select: { searchConfigJson: true, systemActive: true, linkedinSessionCookie: true }
  });
  console.log('fggg59@user.com Settings:', current);

  const posts = await p.savedPost.count({ where: { userId: USER_ID } });
  console.log('fggg59@user.com total posts:', posts);
}

main().then(() => p.$disconnect()).catch(e => { console.error(e.message); p.$disconnect(); });
