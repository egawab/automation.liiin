const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const USER_ID = 'ec0bb423-3c0f-4611-9167-01874a76b93c';

// Keywords to set — edit this array with whatever you want
const NEW_KEYWORDS = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : null; // null = just read, don't update

async function main() {
  const current = await p.settings.findUnique({
    where: { userId: USER_ID },
    select: { searchConfigJson: true, systemActive: true }
  });

  console.log('\nCurrent DB keywords:', current?.searchConfigJson);
  console.log('systemActive:', current?.systemActive);

  if (NEW_KEYWORDS) {
    const json = JSON.stringify(NEW_KEYWORDS);
    await p.settings.update({
      where: { userId: USER_ID },
      data: { searchConfigJson: json }
    });
    console.log('\n✅ Updated keywords to:', json);
    
    // Verify
    const verify = await p.settings.findUnique({
      where: { userId: USER_ID },
      select: { searchConfigJson: true }
    });
    console.log('Verified in DB:', verify?.searchConfigJson);
  } else {
    console.log('\n💡 To update keywords, run:');
    console.log('   node set_keywords.js "keyword1" "keyword2" "keyword3"');
    console.log('\nExample:');
    console.log('   node set_keywords.js "cairo" "egypt" "marketing" "business"');
  }
}

main().then(() => p.$disconnect()).catch(e => { console.error(e.message); p.$disconnect(); });
