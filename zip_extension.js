const fs = require('fs');
const archiver = require('archiver');
const path = require('path');

const output = fs.createWriteStream(path.join(__dirname, 'public', 'LinkedInExtension.zip'));
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', function() {
  console.log(archive.pointer() + ' total bytes appended');
  console.log('Archived successfully.');
});

archive.on('error', function(err) {
  throw err;
});

archive.pipe(output);
archive.directory('extension/', false);
archive.finalize();
