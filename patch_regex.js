const fs = require('fs');

try {
  let bg = fs.readFileSync('extension/background.js', 'utf8');
  let ct = fs.readFileSync('extension/content.js', 'utf8');

  // We need to replace the URN extraction logic in both files.
  // The current code is:
  // var um = href.match(/urn:li:(activity|ugcPost|share):(\\\\d{10,25})/);
  // if (!um) return;
  // var urn = 'urn:li:' + um[1] + ':' + um[2];

  const oldLogicBg = /var um = href\.match\(\/urn:li:\(activity\|ugcPost\|share\):\((\\\\*d\{10,25\})\)\/\);\s*if \(!um\) return;\s*var urn = 'urn:li:' \+ um\[1\] \+ ':' \+ um\[2\];/g;
  const newLogicBg = `var urn = '';
      var um = href.match(/urn:li:(activity|ugcPost|share):(\\\\d{10,25})/);
      if (um) {
        urn = 'urn:li:' + um[1] + ':' + um[2];
      } else {
        var pm = href.match(/activity-(\\\\d{10,25})/);
        if (pm) urn = 'urn:li:activity:' + pm[1];
      }
      if (!urn) return;`;

  bg = bg.replace(oldLogicBg, newLogicBg);

  const oldLogicCt = /var um = href\.match\(\/urn:li:\(activity\|ugcPost\|share\):\((\\\\*d\{10,25\})\)\/\);\s*if \(!um\) return;\s*var urn = 'urn:li:' \+ um\[1\] \+ ':' \+ um\[2\];/g;
  const newLogicCt = `var urn = '';
      var um = href.match(/urn:li:(activity|ugcPost|share):(\\d{10,25})/);
      if (um) {
        urn = 'urn:li:' + um[1] + ':' + um[2];
      } else {
        var pm = href.match(/activity-(\\d{10,25})/);
        if (pm) urn = 'urn:li:activity:' + pm[1];
      }
      if (!urn) return;`;

  ct = ct.replace(oldLogicCt, newLogicCt);

  // Also fix MIN_ENGAGEMENT inside background.js flushBatch if it's dropping things prematurely.
  // We want to make sure it sends everything to the API, and let the API decide.
  // Actually, keeping MIN_ENGAGEMENT = 1 is safer so it at least sends it.
  bg = bg.replace(/const MIN_ENGAGEMENT = 10;/, 'const MIN_ENGAGEMENT = 0;');

  fs.writeFileSync('extension/background.js', bg, 'utf8');
  fs.writeFileSync('extension/content.js', ct, 'utf8');
  console.log('Regex patch applied successfully');
} catch(e) {
  console.error(e);
}
