const fs = require('fs');

function fixFile(f) {
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/e\.message!==\'ACCESS_REVOKED\'/g, "!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(e.message)");
  c = c.replace(/err\.message!==\'ACCESS_REVOKED\'/g, "!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(err.message)");
  c = c.replace(/e\.message !== \'ACCESS_REVOKED\'/g, "!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(e.message)");
  c = c.replace(/err\.message !== \'ACCESS_REVOKED\'/g, "!['ACCESS_REVOKED', 'SESSION_EXPIRED'].includes(err.message)");
  fs.writeFileSync(f, c);
}

fixFile('public/manager/index.html');
fixFile('public/client/index.html');
console.log('Done');
