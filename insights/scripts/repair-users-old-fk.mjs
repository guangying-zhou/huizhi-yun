#!/usr/bin/env node
// Repair tables that still reference users_old -> switch FK to users
// Idempotent: Only rebuild when sqlite_master shows users_old reference

import { createClient } from '@libsql/client'

// load env
const envPath = process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev'
try {
  const dotenv = await import('dotenv')
  dotenv.config({ path: envPath })
  console.log('[repair] Loaded env from', envPath)
} catch (e) {
  console.warn('[repair] dotenv not loaded:', e?.message || e)
}

const url = process.env.TURSO_DB_URL
const authToken = process.env.TURSO_DB_TOKEN
if (!url || !authToken) {
  console.error('[repair] Missing TURSO_DB_URL/TURSO_DB_TOKEN in env')
  process.exit(1)
}

const client = createClient({ url, authToken })

async function hasUsersOldRef(table) {
  const res = await client.execute({ sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, args: [table] })
  const row = res.rows[0]
  if (!row) return false
  const sql = String(row.sql || '')
  // 宽松检测：只要出现 users_old 即认为需要修复（不同转义/引号时更稳健）
  return /users_old/i.test(sql)
}

async function tableExists(name) {
  const r = await client.execute({ sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, args: [name] })
  return r.rows.length > 0
}

async function dropIfExists(name) {
  if (await tableExists(name)) {
    await client.execute(`DROP TABLE ${name}`)
  }
}

async function rebuild_oauth_accounts() {
  if (!(await hasUsersOldRef('oauth_accounts'))) {
    console.log('[repair] oauth_accounts OK (no users_old FK)')
    return
  }
  console.log('[repair] Rebuilding oauth_accounts ...')
  await dropIfExists('oauth_accounts_new')
  await client.execute(`CREATE TABLE oauth_accounts_new (
    id text PRIMARY KEY NOT NULL,
    providerId text NOT NULL,
    providerUserId text NOT NULL,
    userId text NOT NULL,
    created_at integer,
    updated_at integer,
    FOREIGN KEY (userId) REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
  )`)
  await client.execute(`INSERT INTO oauth_accounts_new (id, providerId, providerUserId, userId, created_at, updated_at)
    SELECT id, providerId, providerUserId, userId, created_at, updated_at FROM oauth_accounts`)
  await client.execute(`DROP TABLE oauth_accounts`)
  await client.execute(`ALTER TABLE oauth_accounts_new RENAME TO oauth_accounts`)
  await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS unique_provider_user ON oauth_accounts(providerId, providerUserId)`)  
}

async function rebuild_one_time_passwords() {
  if (!(await hasUsersOldRef('one_time_passwords'))) {
    console.log('[repair] one_time_passwords OK')
    return
  }
  console.log('[repair] Rebuilding one_time_passwords ...')
  await dropIfExists('one_time_passwords_new')
  await client.execute(`CREATE TABLE one_time_passwords_new (
    id text PRIMARY KEY NOT NULL,
    userId text NOT NULL,
    identifier text NOT NULL,
    code text NOT NULL,
    type text NOT NULL DEFAULT 'SIGNUP',
    expires_at integer NOT NULL,
    FOREIGN KEY (userId) REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
  )`)
  await client.execute(`INSERT INTO one_time_passwords_new (id, userId, identifier, code, type, expires_at)
    SELECT id, userId, identifier, code, type, expires_at FROM one_time_passwords`)
  await client.execute(`DROP TABLE one_time_passwords`)
  await client.execute(`ALTER TABLE one_time_passwords_new RENAME TO one_time_passwords`)
}

async function rebuild_email_verification_codes() {
  if (!(await hasUsersOldRef('email_verification_codes'))) {
    console.log('[repair] email_verification_codes OK')
    return
  }
  console.log('[repair] Rebuilding email_verification_codes ...')
  await dropIfExists('email_verification_codes_new')
  await client.execute(`CREATE TABLE email_verification_codes_new (
    id integer PRIMARY KEY NOT NULL,
    userId text NOT NULL,
    code integer NOT NULL,
    expires_at integer NOT NULL,
    FOREIGN KEY (userId) REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
  )`)
  await client.execute(`INSERT INTO email_verification_codes_new (id, userId, code, expires_at)
    SELECT id, userId, code, expires_at FROM email_verification_codes`)
  await client.execute(`DROP TABLE email_verification_codes`)
  await client.execute(`ALTER TABLE email_verification_codes_new RENAME TO email_verification_codes`)
}

async function rebuild_password_reset_tokens() {
  if (!(await hasUsersOldRef('password_reset_tokens'))) {
    console.log('[repair] password_reset_tokens OK')
    return
  }
  console.log('[repair] Rebuilding password_reset_tokens ...')
  await dropIfExists('password_reset_tokens_new')
  await client.execute(`CREATE TABLE password_reset_tokens_new (
    id integer PRIMARY KEY NOT NULL,
    userId text NOT NULL,
    code integer NOT NULL,
    expires_at integer NOT NULL,
    FOREIGN KEY (userId) REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
  )`)
  await client.execute(`INSERT INTO password_reset_tokens_new (id, userId, code, expires_at)
    SELECT id, userId, code, expires_at FROM password_reset_tokens`)
  await client.execute(`DROP TABLE password_reset_tokens`)
  await client.execute(`ALTER TABLE password_reset_tokens_new RENAME TO password_reset_tokens`)
}

async function rebuild_credentials() {
  if (!(await hasUsersOldRef('credentials'))) {
    console.log('[repair] credentials OK')
    return
  }
  console.log('[repair] Rebuilding credentials ...')
  await dropIfExists('credentials_new')
  await client.execute(`CREATE TABLE credentials_new (
    user_id text NOT NULL,
    id text NOT NULL UNIQUE,
    name text NOT NULL,
    public_key text NOT NULL,
    counter integer NOT NULL,
    backed_up integer NOT NULL,
    transports text NOT NULL,
    created_at integer,
    FOREIGN KEY (user_id) REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
  )`)
  await client.execute(`INSERT INTO credentials_new (user_id, id, name, public_key, counter, backed_up, transports, created_at)
    SELECT user_id, id, name, public_key, counter, backed_up, transports, created_at FROM credentials`)
  await client.execute(`DROP TABLE credentials`)
  await client.execute(`ALTER TABLE credentials_new RENAME TO credentials`)
}

async function rebuild_subscriptions() {
  if (!(await hasUsersOldRef('subscriptions'))) {
    console.log('[repair] subscriptions OK')
    return
  }
  console.log('[repair] Rebuilding subscriptions ...')
  await dropIfExists('subscriptions_new')
  await client.execute(`CREATE TABLE subscriptions_new (
    id text PRIMARY KEY NOT NULL,
    userId text NOT NULL,
    customerId text NOT NULL,
    status text NOT NULL DEFAULT 'TRIALING',
    planId text NOT NULL,
    variantId text NOT NULL,
    paymentProvider text NOT NULL,
    nextPaymentDate integer NOT NULL,
    FOREIGN KEY (userId) REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
  )`)
  await client.execute(`INSERT INTO subscriptions_new (id, userId, customerId, status, planId, variantId, paymentProvider, nextPaymentDate)
    SELECT id, userId, customerId, status, planId, variantId, paymentProvider, nextPaymentDate FROM subscriptions`)
  await client.execute(`DROP TABLE subscriptions`)
  await client.execute(`ALTER TABLE subscriptions_new RENAME TO subscriptions`)
}

async function main() {
  console.log('[repair] Starting FK repair...')
  await client.execute(`PRAGMA foreign_keys=off`)
  try {
    await rebuild_oauth_accounts()
    await rebuild_one_time_passwords()
    await rebuild_email_verification_codes()
    await rebuild_password_reset_tokens()
    await rebuild_credentials()
    await rebuild_subscriptions()
  } catch (e) {
    console.error('[repair] Failed during repair:', e?.message || e)
    process.exit(1)
  } finally {
    await client.execute(`PRAGMA foreign_keys=on`)
  }
  console.log('[repair] Done.')
}

await main()
await client.close()
