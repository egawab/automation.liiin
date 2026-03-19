const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_mDXqdhVn2Mj1@ep-fragrant-haze-aijuhuz0-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"
    }
  }
});

async function main() {
  console.log("Connecting to DB...");
  const settings = await prisma.settings.findMany();
  console.log(`Found ${settings.length} settings rows.`);
  
  if (settings.length > 0) {
    console.log("Activating the first user's settings...");
    await prisma.settings.update({
      where: { id: settings[0].id },
      data: { systemActive: true, searchOnlyMode: true }
    });
    console.log("✅ Successfully activated system and searchOnlyMode for user.");
  } else {
    // If no settings exist, check if users exist
    const users = await prisma.user.findMany();
    if (users.length > 0) {
      console.log(`Found ${users.length} users but no settings. Creating settings for first user...`);
      await prisma.settings.create({
        data: {
          userId: users[0].id,
          linkedinSessionCookie: "AQEDAWC1fxcElnb7AAABnQIaurAAAAGdJic-sE0AB1a0znjQ5hAy2muWlID5-O2ZNXLFYVSJACQS3e7JcWVBei-aHlpc0qy_nrDMllQu8M5fK42btzYZxndiXUh3cQ8SoCUWiCHQh4ZOGEeyN2iE4UhB", // Replace dynamically later if needed
          systemActive: true,
          searchOnlyMode: true
        }
      });
      console.log("✅ Created and activated settings.");
    } else {
      console.log("❌ No users found in database.");
    }
  }
  
  // Create a keyword just to be safe
  const users = await prisma.user.findMany();
  if (users.length > 0) {
     const keywords = await prisma.keyword.findMany({ where: { userId: users[0].id } });
     if (keywords.length === 0) {
       await prisma.keyword.create({
         data: {
           userId: users[0].id,
           keyword: "startup",
           active: true
         }
       });
       console.log("✅ Created fallback 'startup' keyword.");
     } else {
       // Ensure at least one is active
       await prisma.keyword.update({
         where: { id: keywords[0].id },
         data: { active: true }
       });
       console.log("✅ Ensured at least one keyword is active.");
     }
  }

}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
