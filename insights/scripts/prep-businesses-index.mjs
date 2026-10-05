#!/usr/bin/env node
// Pre-create a named unique index on businesses(name) to avoid
// drizzle-kit push failing with "no such index: businesses_name_unique".
// Idempotent via IF NOT EXISTS.

import { createClient } from '@libsql/client'

// Load env like drizzle.config.ts
const envPath = process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev'
try {
  const dotenv = await import('dotenv')
  dotenv.config({ path: envPath })
  console.log('[prep] Loaded env from', envPath)
} catch (e) {
  console.warn('[prep] dotenv not loaded:', e?.message || e)
}

const url = process.env.TURSO_DB_URL
const authToken = process.env.TURSO_DB_TOKEN
if (!url || !authToken) {
  console.error('[prep] Missing TURSO_DB_URL/TURSO_DB_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

async function main() {
  console.log('[prep] Ensuring expected unique indexes exist...')
  const statements = [
    // From schema.ts: businesses.name unique()
    `CREATE UNIQUE INDEX IF NOT EXISTS businesses_name_unique ON businesses(name)`,
    // From schema.ts: users.email unique()
    `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email)`,
    // From schema.ts: credentials.id unique()
    `CREATE UNIQUE INDEX IF NOT EXISTS credentials_id_unique ON credentials(id)`,
    // From schema.ts: domains.hostname unique()
    `CREATE UNIQUE INDEX IF NOT EXISTS domains_hostname_unique ON domains(hostname)`,
    // From schema.ts: uniqueIndex("unique_provider_user") on oauth_accounts(providerId, providerUserId)
    `CREATE UNIQUE INDEX IF NOT EXISTS unique_provider_user ON oauth_accounts(providerId, providerUserId)`,
    // From schema.ts: uniqueIndex('uniq_membership_user_business')
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_membership_user_business ON memberships(user_id, business_id)`,
  ]
  try {
    for (const sql of statements) {
      await client.execute(sql)
      const idxName = sql.match(/INDEX IF NOT EXISTS ([^\s]+)/i)?.[1] || sql
      console.log('[prep] Index ensured:', idxName)
    }
  } catch (e) {
    console.error('[prep] Failed to create expected indexes:', e?.message || e)
    process.exit(1)
  } finally {
    await client.close()
  }
}

await main()
