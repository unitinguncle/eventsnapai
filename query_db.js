const db = require('./src/db/client');
async function run() {
  const res = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'photos';");
  console.log(res.rows);
  process.exit(0);
}
run();
