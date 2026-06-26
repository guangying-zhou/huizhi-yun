#!/usr/bin/env node
// Drop legacy CMS-related tables that are no longer used.
// Idempotent: only drops when they exist.

import { createClient } from '@libsql/client'

const envPath = process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev'
try {
  const dotenv = await import('dotenv')
  dotenv.config({ path: envPath })
  console.log('[drop] Loaded env from', envPath)
} catch (e) {
  console.warn('[drop] dotenv not loaded:', e?.message || e)
}

const url = process.env.TURSO_DB_URL
const authToken = process.env.TURSO_DB_TOKEN
if (!url || !authToken) {
  console.error('[drop] Missing TURSO_DB_URL/TURSO_DB_TOKEN in env')
  process.exit(1)
}

const client = createClient({ url, authToken })

async function tableExists(name) {
  const r = await client.execute({ sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, args: [name] })
  return r.rows.length > 0
}

async function dropIfExists(name) {
  if (await tableExists(name)) {
    console.log(`[drop] Dropping table ${name} ...`)
    await client.execute(`DROP TABLE ${name}`)
  } else {
    console.log(`[drop] Table ${name} not found, skip`)
  }
}

async function main() {
  console.log('[drop] Start dropping legacy CMS tables')
  await client.execute(`PRAGMA foreign_keys=off`)
  const targets = [
    'content_versions',
    'images',
    'media_files',
    'pages',
    'posts',
    'templates',
    'companies_legacy',
    'users_old'
  ]
  for (const t of targets) {
    try {
      await dropIfExists(t)
    } catch (e) {
      console.warn(`[drop] Failed to drop ${t}:`, e?.message || e)
    }
  }
  await client.execute(`PRAGMA foreign_keys=on`)
  console.log('[drop] Done')
}

await main()
await client.close()
