#!/usr/bin/env node
// Restore the encrypted development backup to a NEW isolated database; never production.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, createDecipheriv, randomBytes } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { nuxtPlatformEnv } from './platform-env.mjs'
process.on('uncaughtException', error => {
  console.error(`Platform probe failed (${error.code || 'check_failed'}); private details suppressed.`)
  process.exit(1)
})
const root = '/wiztek/hzy-test'
const backup = `${root}/backups/platform-dev-20260905`
const source = `${root}/platform-release-5f898581/platform`
const database = 'hzy_platform_upgrade_probe'
const migrations = [
  'v2.16-tenant-reserved-subdomains', 'v2.22-tenant-role-catalog-metadata',
  'v2.25-default-login-baseline-permissions', 'v2.27-tenant-runtime-enrollment',
  'v2.28-data-runtime-release-registry', 'v2.29-role-holder-cardinality', 'v2.31-monorepo-release-source'
].map(name => `HZY-Platform-SQL-Migration-${name}.sql`)
if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Unexpected host')
const receipt = JSON.parse(fs.readFileSync(`${backup}/receipt.json`, 'utf8'))
if (receipt.database !== 'hzy_platform_dev') throw new Error('Unexpected backup database')
const sql = input => execFileSync('docker', ['exec', '-i', 'hzy-test-mysql', 'sh', '-c',
  'MYSQL_PWD="$(cat /run/secrets/mysql-root)" exec mysql -uroot --batch --skip-column-names'], { input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }).toString()
const secret = (name, content) => fs.writeFileSync(`${root}/${name}`, content, { mode: 0o600, flag: 'wx' })
const mode = process.argv[2]
if (mode === '--restore') {
  if (sql(`SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${database}';`).trim() !== '0') throw new Error('Probe DB already exists')
  const encrypted = fs.readFileSync(`${backup}/database.sql.gz.enc`)
  if (createHash('sha256').update(encrypted).digest('hex') !== receipt.databaseSha256) throw new Error('Backup hash mismatch')
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(fs.readFileSync(`${backup}/backup-key`, 'utf8'), 'base64'), Buffer.from(receipt.encryption.iv, 'base64'))
  cipher.setAuthTag(Buffer.from(receipt.encryption.tag, 'base64'))
  const dump = gunzipSync(Buffer.concat([cipher.update(encrypted), cipher.final()])).toString('utf8')
  if (/^\s*(USE\s|(?:CREATE|DROP)\s+DATABASE)/mi.test(dump)) throw new Error('Dump contains an unexpected database switch')
  sql(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE ${database};\n${dump}`)
  const restoredTables = Number(sql(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}';`).trim())
  if (restoredTables !== receipt.tables) throw new Error('Restored table count mismatch')
  const evidence = []
  for (const name of migrations) {
    const content = fs.readFileSync(`${source}/docs/sql/${name}`, 'utf8')
    if (/^\s*(USE\s|(?:CREATE|DROP)\s+DATABASE)/mi.test(content)) throw new Error('Migration contains a database switch')
    sql(`USE ${database};\n${content}`)
    evidence.push({ name, sha256: createHash('sha256').update(content).digest('hex') })
    console.log(`Probe migration passed: ${name}`)
  }
  const conflicts = Number(sql(`SELECT COUNT(*) FROM (SELECT role.id FROM ${database}.tenant_roles role JOIN ${database}.tenant_subject_roles assignment ON assignment.tenant_code=role.tenant_code AND assignment.role_id=role.id AND assignment.status='active' AND (assignment.starts_at IS NULL OR assignment.starts_at<=UTC_TIMESTAMP()) AND (assignment.expired_at IS NULL OR assignment.expired_at>UTC_TIMESTAMP()) WHERE role.role_code IN ('project_director','qa') GROUP BY role.id HAVING COUNT(*)>1) conflicts;`).trim())
  if (conflicts) throw new Error('Existing test assignments violate holder cardinality')
  const password = randomBytes(32).toString('hex')
  sql(`CREATE USER 'hzy_platform_probe'@'%' IDENTIFIED BY '${password}'; GRANT SELECT,INSERT,UPDATE,DELETE,CREATE TEMPORARY TABLES ON ${database}.* TO 'hzy_platform_probe'@'%';`)
  const env = JSON.parse(fs.readFileSync(`${backup}/runtime-env.json`, 'utf8'))
  Object.assign(env, { HOST: '127.0.0.1', PORT: '3012', NITRO_HOST: '127.0.0.1', NITRO_PORT: '3012', NODE_ENV: 'production',
    DB_HOST: '127.0.0.1', DB_PORT: '13316', DB_NAME: database, DB_USER: 'hzy_platform_probe', DB_PASSWORD: password,
    DB_CONNECTION_LIMIT: '3', HZY_PLATFORM_PM2_NAME: 'hzy-platform-upgrade-probe',
    HZY_DEPLOYMENT_PROFILE: 'platform-self-hosted-db', NODE_OPTIONS: '--max-old-space-size=384' })
  for (const key of ['HOST', 'PORT', 'NAME', 'USER', 'PASSWORD', 'CONNECTION_LIMIT']) env[`NUXT_DB_${key}`] = env[`DB_${key}`]
  secret('platform-probe.config.json', JSON.stringify({ apps: [{ name: 'hzy-platform-upgrade-probe', cwd: source,
    script: '.output/server/index.mjs', interpreter: '/root/.nvm/versions/node/v24.18.0/bin/node', instances: 1,
    exec_mode: 'fork', autorestart: false, watch: false, max_memory_restart: '448M', env: nuxtPlatformEnv(env),
    error_file: `${root}/platform-probe-error.log`, out_file: `${root}/platform-probe-out.log` }] }))
  secret('platform-probe-restored.json', JSON.stringify({ database, restoredTables, migrations: evidence, at: new Date().toISOString() }, null, 2))
  console.log(`Encrypted backup restored and migrated in isolated ${database}; ${restoredTables} original tables verified.`)
} else if (mode === '--verify') {
  const diag = await fetch('http://127.0.0.1:3012/api/platform/diagnostics').then(r => r.json())
  if (diag.data?.database?.databaseName !== database || !diag.data?.signing?.privateKeyUsable) throw new Error('Probe DB/signing readiness failed')
  const env = JSON.parse(fs.readFileSync(`${backup}/runtime-env.json`, 'utf8'))
  const token = env.HZY_CLOUDFLARE_INTERNAL_TOKEN || env.PLATFORM_INTERNAL_SERVICE_TOKENS?.split(',')[0]?.trim()
  if (!token) throw new Error('No development internal credential')
  const body = JSON.stringify({ tenantCode: 'HTEST001', environment: 'test', appCode: 'console' })
  for (const [credential, expected] of [[null, 403], [token, 409]]) {
    const response = await fetch('http://127.0.0.1:3012/api/platform/internal/tenant-gateway/runtime-bootstrap-token', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential}`, 'x-hzy-internal-principal': 'console-runtime-bootstrap' } : {}) }, body
    })
    if (response.status !== expected) throw new Error(`Unexpected bootstrap status ${response.status}`)
    console.log(`Bootstrap ${credential ? 'unregistered test binding' : 'unauthenticated'}: expected HTTP ${expected}`)
  }
  const sourcePatchHashes = Object.fromEntries(['server/utils/runtimeBootstrapIssuer.ts', 'server/api/platform/internal/tenant-gateway/runtime-bootstrap-token.post.ts'].map(path => [path, createHash('sha256').update(fs.readFileSync(`${source}/${path}`)).digest('hex')]))
  const proof = JSON.stringify({ database, verifiedAt: new Date().toISOString(), signingKid: diag.data.signing.kid, sourcePatchHashes })
  if (fs.existsSync(`${root}/platform-probe-verified.json`)) fs.renameSync(`${root}/platform-probe-verified.json`, `${root}/platform-probe-verified-prior-${Date.now()}.json`)
  secret('platform-probe-verified.json', proof)
} else throw new Error('Use --restore or --verify')
