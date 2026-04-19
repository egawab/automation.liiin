const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  console.log("Found users:");
  console.log(users.map(u => ({ id: u.id, email: u.email, isAdmin: u.isAdmin })));

  // If there are users, make the first one an admin, or all of them.
  if (users.length > 0) {
      for (const u of users) {
          await prisma.user.update({
             where: { id: u.id },
             data: { isAdmin: true, subscriptionStatus: 'ACTIVE' }
          });
          console.log(`Made ${u.email} an admin and ACTIVE.`);
      }
  } else {
      console.log("No users found.");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
