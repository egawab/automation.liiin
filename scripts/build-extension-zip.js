#!/usr/bin/env node
/**
 * scripts/build-extension-zip.js
 *
 * Packages /extension into every public download alias customers might hit:
 *   - public/nexora-extension.zip   (primary — Connect Extension page)
 *   - public/UPDATEFI.zip          (legacy onboarding wizard link)
 *   - public/LinkedInExtension.zip  (legacy alias)
 *
 * Runs during `npm run build` so every Vercel deploy ships the exact
 * committed extension source — never a stale zip.
 */

const fs   = require('fs');
const path = require('path');
const JSZip = require('jszip');

const ROOT          = path.join(__dirname, '..');
const EXTENSION_DIR = path.join(ROOT, 'extension');
const PUBLIC_DIR    = path.join(ROOT, 'public');

const OUTPUTS = [
  'nexora-extension.zip',
  'UPDATEFI.zip',
  'LinkedInExtension.zip',
  'LinkedInExtension_updated.zip',
];

function addDirectory(zip, dirPath, zipPrefix) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath   = path.join(dirPath, entry.name);
    const zipRelPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDirectory(zip, fullPath, zipRelPath);
    } else {
      zip.file(zipRelPath, fs.readFileSync(fullPath));
    }
  }
}

async function main() {
  if (!fs.existsSync(EXTENSION_DIR)) {
    throw new Error('extension/ folder missing');
  }
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  console.log(`[build-extension-zip] Packaging extension v${manifest.version} (${manifest.version_name || ''})`);

  const zip = new JSZip();
  // Top-level folder so "Load unpacked" works after unzip
  const folder = zip.folder('nexora-extension');
  addDirectory(folder, EXTENSION_DIR, '');

  // Stamp a version file inside the zip for support/debugging
  folder.file('VERSION.txt', [
    `Nexora Extension`,
    `version=${manifest.version}`,
    `version_name=${manifest.version_name || ''}`,
    `built_at=${new Date().toISOString()}`,
    ``,
  ].join('\n'));

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  for (const name of OUTPUTS) {
    const out = path.join(PUBLIC_DIR, name);
    fs.writeFileSync(out, buffer);
    console.log(`[build-extension-zip] ✓ ${(buffer.length / 1024).toFixed(1)} KB → public/${name}`);
  }

  // Sanity: zip must contain background.js + manifest.json
  const check = await JSZip.loadAsync(buffer);
  const required = [
    'nexora-extension/manifest.json',
    'nexora-extension/background.js',
    'nexora-extension/popup.js',
    'nexora-extension/popup.html',
    'nexora-extension/dashboard-bridge.js',
    'nexora-extension/enrich.js',
    'nexora-extension/content.js',
    'nexora-extension/VERSION.txt',
  ];
  for (const f of required) {
    if (!check.file(f)) throw new Error('ZIP missing required file: ' + f);
  }
  const shippedManifest = JSON.parse(await check.file('nexora-extension/manifest.json').async('string'));
  if (shippedManifest.version !== manifest.version) {
    throw new Error('ZIP manifest version mismatch');
  }
  console.log(`[build-extension-zip] ✓ Verified v${shippedManifest.version} contents OK`);
}

main().catch(err => {
  console.error('[build-extension-zip] ✗ Failed:', err.message);
  process.exit(1);
});
