import { config } from 'dotenv'
import { createClient } from '@libsql/client'

// Prefer dev env locally; respect NODE_ENV if set
config({ path: process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev' })

const url = process.env.TURSO_DB_URL
const authToken = process.env.TURSO_DB_TOKEN

if (!url || !authToken) {
  console.error('[recreate-memberships] Missing TURSO_DB_URL or TURSO_DB_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

async function hasTable(name) {
  const r = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])
  return r.rows.length > 0
}

async function getColumns(table) {
  const r = await client.execute(`PRAGMA table_info('${table}')`)
  return r.rows.map(row => row.name)
}

async function run() {
  try {
    console.log('[recreate-memberships] Starting...')

    // Ensure FK is ON
    try { await client.execute('PRAGMA foreign_keys=ON') } catch {}

    // If memberships does not exist -> create with business_id
    if (!(await hasTable('memberships'))) {
      console.log('[recreate-memberships] Creating memberships with business_id ...')
      await client.execute(`CREATE TABLE memberships (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        business_id text NOT NULL,
        role text NOT NULL DEFAULT 'USER',
        status text NOT NULL DEFAULT 'active',
        created_at integer,
        updated_at integer,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
      )`)
    } else {
      // Exists: check columns; migrate company_id -> business_id if needed
      const cols = await getColumns('memberships')
      const hasCompanyId = cols.includes('company_id')
      const hasBusinessId = cols.includes('business_id')
      if (hasCompanyId && !hasBusinessId) {
        console.log('[recreate-memberships] Migrating memberships.company_id -> business_id ...')
        await client.execute(`ALTER TABLE memberships RENAME TO memberships_old`)
        await client.execute(`CREATE TABLE memberships (
          id text PRIMARY KEY NOT NULL,
          user_id text NOT NULL,
          business_id text NOT NULL,
          role text NOT NULL DEFAULT 'USER',
          status text NOT NULL DEFAULT 'active',
          created_at integer,
          updated_at integer,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
        )`)
        await client.execute(`INSERT INTO memberships (id, user_id, business_id, role, status, created_at, updated_at)
          SELECT id, user_id, company_id, role, status, created_at, updated_at FROM memberships_old`)
        await client.execute(`DROP TABLE memberships_old`)
      } else if (!hasBusinessId) {
        // Unexpected shape: drop and create (last resort)
        console.warn('[recreate-memberships] memberships exists without business_id; recreating table (no data copy) ...')
        await client.execute(`DROP TABLE memberships`)
        await client.execute(`CREATE TABLE memberships (
          id text PRIMARY KEY NOT NULL,
          user_id text NOT NULL,
          business_id text NOT NULL,
          role text NOT NULL DEFAULT 'USER',
          status text NOT NULL DEFAULT 'active',
          created_at integer,
          updated_at integer,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
        )`)
      } else {
        console.log('[recreate-memberships] memberships already uses business_id, skipping create')
      }
    }

    // Ensure indexes
    await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_membership_user_business ON memberships (user_id, business_id)`)
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_memberships_business ON memberships (business_id)`)
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships (user_id)`)

    // Verify columns
    const info = await client.execute("PRAGMA table_info('memberships')")
    console.log('[recreate-memberships] Table columns:')
    for (const row of info.rows) {
      console.log(` - ${row.cid}: ${row.name} ${row.type} ${row.notnull ? 'NOT NULL' : ''}`)
    }

    console.log('[recreate-memberships] Done.')
  } catch (e) {
    console.error('[recreate-memberships] Failed:', e?.message || e)
    process.exit(1)
  } finally {
    try { await client.close() } catch {}
  }
}

run()
