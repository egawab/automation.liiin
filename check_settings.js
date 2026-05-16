const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const USER_ID = 'ec0bb423-3c0f-4611-9167-01874a76b93c';

p.settings.findUnique({
  where: { userId: USER_ID },
  select: { systemActive: true, searchConfigJson: true, searchOnlyMode: true }
}).then(s => {
  console.log('Current settings in DB:');
  console.log('  systemActive:   ', s.systemActive);
  console.log('  searchOnlyMode: ', s.searchOnlyMode);
  console.log('  searchConfigJson:', s.searchConfigJson);
  p.$disconnect();
}).catch(e => { console.error(e.message); p.$disconnect(); });
