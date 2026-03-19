const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  if (users.length > 0) {
    console.log("=== USER ID FOUND ===");
    console.log(`Email: ${users[0].email}`);
    console.log(`User ID: ${users[0].id}`);
    console.log("=====================");
  } else {
    console.log("No users found.");
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
