import { config } from 'dotenv'
import { createClient } from '@libsql/client'

// load env (dev by default)
config({ path: process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev' })

const url = process.env.TURSO_DB_URL
const authToken = process.env.TURSO_DB_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DB_URL or TURSO_DB_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

async function main() {
  const r1 = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='memberships'")
  const hasMemberships = r1.rows.length > 0

  const r2 = await client.execute("PRAGMA table_info('users')")
  const columns = r2.rows.map(r => r.name)
  const hasPlatformRole = columns.includes('platform_role')

  console.log(JSON.stringify({ hasMemberships, hasPlatformRole, usersColumns: columns }, null, 2))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
