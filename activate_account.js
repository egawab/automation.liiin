const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const USER_ID = 'ec0bb423-3c0f-4611-9167-01874a76b93c'; // egawab@hotmail.com

async function main() {
  // Check current settings
  const existing = await p.settings.findUnique({ where: { userId: USER_ID } });
  console.log('Current settings:', existing);

  if (!existing) {
    // Create settings row with system active
    const created = await p.settings.create({
      data: {
        userId: USER_ID,
        systemActive: true,
        searchOnlyMode: true,
        searchConfigJson: '[]',
        minLikes: 0,
        minComments: 0,
        maxLikes: 100000,
        maxComments: 100000,
      }
    });
    console.log('Created settings:', created);
  } else {
    // Update to activate
    const updated = await p.settings.update({
      where: { userId: USER_ID },
      data: { systemActive: true }
    });
    console.log('Updated settings:', updated);
  }

  // Also check subscription status
  const user = await p.user.findUnique({
    where: { id: USER_ID },
    select: { id: true, email: true, subscriptionStatus: true, trialEndsAt: true, subscriptionEndsAt: true, isAdmin: true }
  });
  console.log('\nUser subscription:', user);

  // Check keywords
  const kws = await p.keyword.findMany({ where: { userId: USER_ID, active: true } });
  console.log('\nActive keywords:', kws.length, kws.map(k => k.keyword));
}

main().then(() => p.$disconnect()).catch(e => { console.error(e.message); p.$disconnect(); });
