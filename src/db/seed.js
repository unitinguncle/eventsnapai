const bcrypt = require('bcrypt');
const db = require('./client');

const SALT_ROUNDS = 12;

/**
 * Seed the default admin user from ADMIN_API_KEY.
 * Idempotent — skips if any admin already exists.
 * Called once on server startup.
 */
async function seedAdminUser() {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    console.warn('[seed] ADMIN_API_KEY is not set — skipping admin seed.');
    return;
  }

  try {
    const existing = await db.query(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );

    if (existing.rows.length > 0) {
      console.log('[seed] Admin user already exists — skipping seed.');
      return;
    }

    const hash = await bcrypt.hash(adminKey, SALT_ROUNDS);

    await db.query(
      `INSERT INTO users (username, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING`,
      ['admin', hash, 'System Admin', 'admin']
    );

    console.log('[seed] Default admin user created (username: admin).');
  } catch (err) {
    // Table may not exist yet on very first boot — schema must run first.
    // This is a non-fatal warning; the server will still start.
    console.warn('[seed] Could not seed admin user:', err.message);
  }
}

module.exports = { seedAdminUser };
