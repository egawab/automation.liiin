#!/usr/bin/env node
/**
 * scripts/build-extension-zip.js
 *
 * Packages the /extension folder into public/nexora-extension.zip.
 * Runs cross-platform (Windows dev + Linux/Vercel CI) — no shell utilities needed.
 *
 * Automatically called during `npm run build` so every deployment ships
 * a ZIP that exactly matches the committed extension source.
 */

const fs   = require('fs');
const path = require('path');
const JSZip = require('jszip');

const ROOT          = path.join(__dirname, '..');
const EXTENSION_DIR = path.join(ROOT, 'extension');
const OUTPUT_PATH   = path.join(ROOT, 'public', 'nexora-extension.zip');

/** Recursively read every file in a directory and add it to a JSZip folder */
function addDirectory(zip, dirPath, zipPrefix) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath   = path.join(dirPath, entry.name);
    const zipRelPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      addDirectory(zip, fullPath, zipRelPath);
    } else {
      const data = fs.readFileSync(fullPath);
      zip.file(zipRelPath, data);
    }
  }
}

async function main() {
  console.log('[build-extension-zip] Reading:', EXTENSION_DIR);

  const zip = new JSZip();
  // All extension files go in a top-level folder called "nexora-extension"
  // so Chrome's "Load unpacked" works after the user unzips it.
  const folder = zip.folder('nexora-extension');
  addDirectory(folder, EXTENSION_DIR, '');

  const buffer = await zip.generateAsync({
    type        : 'nodebuffer',
    compression : 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  fs.writeFileSync(OUTPUT_PATH, buffer);

  const kb = (buffer.length / 1024).toFixed(1);
  console.log(`[build-extension-zip] ✓ Written ${kb} KB → ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('[build-extension-zip] ✗ Failed:', err.message);
  process.exit(1);
});
