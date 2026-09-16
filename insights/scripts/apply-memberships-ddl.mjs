import { config } from 'dotenv'
import { createClient } from '@libsql/client'

config({ path: process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev' })

const url = process.env.TURSO_DB_URL
const authToken = process.env.TURSO_DB_TOKEN
if (!url || !authToken) {
  console.error('Missing TURSO_DB_URL or TURSO_DB_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

async function hasTable(name) {
  const r = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])
  return r.rows.length > 0
}

async function hasColumn(table, column) {
  const r = await client.execute(`PRAGMA table_info('${table}')`)
  return r.rows.some(row => row.name === column)
}

async function foreignKeys(table) {
  try {
    const r = await client.execute(`PRAGMA foreign_key_list('${table}')`)
    return r.rows
  } catch (e) {
    return []
  }
}

async function tableColumns(table) {
  const r = await client.execute(`PRAGMA table_info('${table}')`)
  return r.rows.map(row => row.name)
}

async function main() {
  // For complex table rebuilds, temporarily disable FK checks to avoid transient violations
  try { await client.execute('PRAGMA foreign_keys=OFF') } catch {}
  // 1) Create `businesses` (renamed from `businesses`) and backfill
  const hasBusinesses = await hasTable('businesses')
  const hasCompanies = await hasTable('businesses')
  const hasCompaniesLegacy = await hasTable('companies_legacy')

  // When only businesses exists, rename to companies_legacy to preserve data snapshot
  if (!hasBusinesses && hasCompanies) {
    console.log('Renaming businesses -> companies_legacy ...')
    await client.execute(`ALTER TABLE businesses RENAME TO companies_legacy`)
  }

  // Refresh flags
  const hasCompaniesNow = await hasTable('businesses')
  const hasCompaniesLegacyNow = await hasTable('companies_legacy')

  if (!(await hasTable('businesses'))) {
    console.log('Creating businesses table (new, replacing businesses)...')
    await client.execute(`CREATE TABLE IF NOT EXISTS businesses (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL UNIQUE,
      display_name text NOT NULL,
      full_name text NOT NULL,
      plan text NOT NULL DEFAULT 'free',
      subscription_id text,
      subscription_status text,
      type text NOT NULL DEFAULT 'COMPANY',
      logo text,
      domain text,
      status text DEFAULT 'inactive',
      creator text,
      created_at integer,
      updated_at integer
    )`)

    if (hasCompaniesLegacyNow) {
      console.log('Backfilling data from companies_legacy -> businesses (dropping deprecated columns)...')
      // 注意：companies 里可能包含 domain_status 与 domain_verified_at 等被弃用字段，这里不复制
      // 仅复制业务需要的字段
      await client.execute(`INSERT INTO businesses (
        id, name, display_name, full_name, plan, subscription_id, subscription_status,
        type, logo, domain, status, creator, created_at, updated_at
      )
      SELECT 
        id, name, display_name, full_name, 
        COALESCE(plan, 'free') as plan,
        subscription_id, subscription_status,
        COALESCE(type, 'COMPANY') as type,
        logo, domain, status, creator, created_at, updated_at
      FROM companies_legacy`)
    } else {
      console.log('No legacy businesses table found. Fresh businesses table created.')
    }
  } else {
    console.log('businesses table already exists, skipping creation')
  }

  // Create memberships table if not exists
  // 2) Rebuild memberships to reference businesses
  const membershipsFks = await foreignKeys('memberships')
  const membershipRefCompanies = membershipsFks.some(fk => (fk && (fk.table === 'businesses' || fk.table === 'companies_legacy')))

  if (!(await hasTable('memberships'))) {
    console.log('Creating memberships table...')
    await client.execute(`CREATE TABLE IF NOT EXISTS memberships (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      business_id text NOT NULL,
      role text DEFAULT 'USER' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at integer,
      updated_at integer,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE NO ACTION ON DELETE CASCADE,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON UPDATE NO ACTION ON DELETE CASCADE
    )`)
    await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_membership_user_business ON memberships (user_id, business_id)`)    
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_memberships_business ON memberships (business_id)`)    
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships (user_id)`)    
  } else {
    if (membershipRefCompanies) {
      console.log('Rebuilding memberships to reference businesses...')
      await client.execute(`ALTER TABLE memberships RENAME TO memberships_old`)
      await client.execute(`CREATE TABLE memberships (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        business_id text NOT NULL,
        role text DEFAULT 'USER' NOT NULL,
        status text DEFAULT 'active' NOT NULL,
        created_at integer,
        updated_at integer,
        FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE NO ACTION ON DELETE CASCADE,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON UPDATE NO ACTION ON DELETE CASCADE
      )`)
      await client.execute(`INSERT INTO memberships (id, user_id, business_id, role, status, created_at, updated_at)
        SELECT id, user_id, business_id, role, status, created_at, updated_at FROM memberships_old`)
      await client.execute(`DROP TABLE memberships_old`)
      await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_membership_user_business ON memberships (user_id, business_id)`)
      await client.execute(`CREATE INDEX IF NOT EXISTS idx_memberships_business ON memberships (business_id)`)
      await client.execute(`CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships (user_id)`)
    } else {
      console.log('Memberships table exists and already references businesses, skipping rebuild')
    }
  }

  // Add platform_role to users if not exists
  if (!(await hasColumn('users', 'platform_role'))) {
    console.log('Altering users table to add platform_role...')
    await client.execute(`ALTER TABLE users ADD COLUMN platform_role text DEFAULT 'USER' NOT NULL`)
  } else {
    console.log('users.platform_role already exists, skipping')
  }

  // 3) Rebuild domains and users FKs if still pointing to businesses/companies_legacy
  const domainsFks = await foreignKeys('domains')
  const domainsRefCompanies = domainsFks.some(fk => (fk && (fk.table === 'businesses' || fk.table === 'companies_legacy')))
  if (await hasTable('domains')) {
    if (domainsRefCompanies) {
      console.log('Rebuilding domains to reference businesses...')
      await client.execute(`ALTER TABLE domains RENAME TO domains_old`)
      await client.execute(`CREATE TABLE domains (
        id text PRIMARY KEY NOT NULL,
        business_id text NOT NULL,
        hostname text NOT NULL UNIQUE,
        status text NOT NULL DEFAULT 'pending_dns',
        verification_method text NOT NULL DEFAULT 'cname',
        verification_value text,
        ssl_status text,
        cf_custom_hostname_id text,
        last_error text,
        created_at integer,
        updated_at integer,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON UPDATE NO ACTION ON DELETE CASCADE
      )`)
      await client.execute(`INSERT INTO domains (
        id, business_id, hostname, status, verification_method, verification_value,
        ssl_status, cf_custom_hostname_id, last_error, created_at, updated_at
      ) SELECT id, business_id, hostname, status, verification_method, verification_value,
               ssl_status, cf_custom_hostname_id, last_error, created_at, updated_at
        FROM domains_old`)
      await client.execute(`DROP TABLE domains_old`)
    } else {
      console.log('domains already references businesses, skipping rebuild')
    }
  }

  const usersFks = await foreignKeys('users')
  const usersRefCompanies = usersFks.some(fk => (fk && (fk.table === 'businesses' || fk.table === 'companies_legacy')))
  if (await hasTable('users')) {
    if (usersRefCompanies) {
      console.log('Rebuilding users to reference businesses (business_id FK)...')
      await client.execute(`ALTER TABLE users RENAME TO users_old`)
      // Re-create using current columns of users
      const cols = await tableColumns('users_old')
      // Build create SQL respecting existing columns with minimal alteration
      // Note: Keep same columns but change FK target
      await client.execute(`CREATE TABLE users (
        id text PRIMARY KEY NOT NULL,
        email text NOT NULL UNIQUE,
        emailVerified integer DEFAULT 0 NOT NULL,
        role text DEFAULT 'USER' NOT NULL,
        platform_role text DEFAULT 'USER' NOT NULL,
        name text NOT NULL,
        avatarUrl text,
        hashedPassword text,
        banned integer DEFAULT 0 NOT NULL,
        bannedReason text,
        onboarded integer DEFAULT 0 NOT NULL,
        business_id text,
        stripe_customer_id text,
        created_at integer,
        updated_at integer,
        last_active integer,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON UPDATE NO ACTION ON DELETE SET NULL
      )`)
      // insert with explicit column list intersection
      const userCols = ['id','email','emailVerified','role','platform_role','name','avatarUrl','hashedPassword','banned','bannedReason','onboarded','business_id','stripe_customer_id','created_at','updated_at','last_active']
      const present = userCols.filter(c => cols.includes(c))
      const colList = present.join(', ')
      // Insert if legacy table exists
      if (await hasTable('users_old')) {
        await client.execute(`INSERT INTO users (${colList}) SELECT ${colList} FROM users_old`)
      } else {
        console.warn('users_old not found after rename; skipping data copy (possible prior run).')
      }
      // Drop legacy table if still exists
      if (await hasTable('users_old')) {
        await client.execute(`DROP TABLE users_old`)
      } else {
        console.log('users_old already dropped, skipping')
      }
    } else {
      console.log('users.business_id already references businesses, skipping rebuild')
    }
  }

  // 4) Drop legacy businesses table if everything is migrated
  if (await hasTable('companies_legacy')) {
    console.log('Dropping companies_legacy ...')
    try {
      await client.execute(`DROP TABLE companies_legacy`)
    } catch (e) {
      console.warn('Failed to drop companies_legacy, will keep it for manual review:', e?.message || e)
    }
  }

  // Heads-up for FK constraints
  console.log('\nNOTE: Foreign keys in users/domains/memberships may still reference businesses.')
  console.log('      This script does NOT rebuild those tables. Runtime will use businesses via code schema.')
  console.log('      Plan to recreate tables later to point FKs to businesses and eventually drop businesses.')

  console.log('Done.')
  try { await client.execute('PRAGMA foreign_keys=ON') } catch {}
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
