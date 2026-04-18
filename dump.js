const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const s = await prisma.settings.findFirst();
  console.log('--- START JSON ---');
  console.log(s.searchConfigJson);
  console.log('--- END JSON ---');
}
main().then(() => process.exit(0));
