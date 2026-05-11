const fs = require('fs');
const bgPath = 'extension/background.js';
const ctPath = 'extension/content.js';

try {
  let bg = fs.readFileSync(bgPath, 'utf8');

  // 1. Add keywordSavedCount to state
  bg = bg.replace(
    `cdp.keywordIndex = 0;`,
    `cdp.keywordIndex = 0; cdp.keywordSavedCount = 0;`
  );

  // 2. Modify GET_CDP_COUNT
  bg = bg.replace(
    `if (msg.action === 'GET_CDP_COUNT') { sendResponse({ count: cdp.totalSaved + cdp.batchPending.length }); return false; }`,
    `if (msg.action === 'GET_CDP_COUNT') { sendResponse({ count: (cdp.keywordSavedCount || 0) + cdp.batchPending.length }); return false; }`
  );

  // 3. Update keywordSavedCount in flushBatch
  bg = bg.replace(
    `cdp.totalSaved += data.savedCount ?? chunk.length;`,
    `cdp.totalSaved += data.savedCount ?? chunk.length;
      cdp.keywordSavedCount = (cdp.keywordSavedCount || 0) + (data.savedCount ?? chunk.length);`
  );

  // 4. Reset keywordSavedCount in finalFlush
  bg = bg.replace(
    `cdp.keywordIndex++;`,
    `cdp.keywordIndex++; cdp.keywordSavedCount = 0;`
  );

  let ct = fs.readFileSync(ctPath, 'utf8');
  
  // 5. Change content.js limit from 30 to 20
  ct = ct.replace(
    `if (count >= 30 || step >= MAX_STEPS - 5)`,
    `if (count >= 20 || step >= MAX_STEPS - 5)`
  );
  ct = ct.replace(
    `if (!clickShowMore() && count >= 30) break;`,
    `if (!clickShowMore() && count >= 20) break;`
  );

  fs.writeFileSync(bgPath, bg, 'utf8');
  fs.writeFileSync(ctPath, ct, 'utf8');
  console.log('Successfully patched for 20 posts logic!');
} catch (e) {
  console.error('Error patching:', e);
}
